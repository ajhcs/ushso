-- 0001: source registry, environment fence, and least-privilege namespaces.
-- Forward-only. Operational rollback never drops these objects.

create schema if not exists registry authorization ushso_registry_owner;
create schema if not exists ingest authorization ushso_ingest_owner;
create schema if not exists catalog authorization ushso_catalog_owner;
create schema if not exists identity authorization ushso_identity_owner;
create schema if not exists search authorization ushso_search_owner;
create schema if not exists ops authorization ushso_ops_owner;

revoke all on schema public from public;
revoke all on schema registry, ingest, catalog, identity, search, ops from public;

set local role ushso_ops_owner;

create table ops.environment_fence (
  singleton boolean primary key default true check (singleton),
  environment text not null check (environment in ('local', 'staging', 'production')),
  deployment_fingerprint text not null check (deployment_fingerprint ~ '^[a-f0-9]{64}$'),
  initialized_at timestamptz not null default clock_timestamp(),
  initialized_by text not null default session_user,
  check ((environment = 'local') or deployment_fingerprint <> repeat('0', 64))
);

create function ops.reject_history_mutation()
returns trigger
language plpgsql
as $function$
begin
  raise exception using
    errcode = '55000',
    message = format('%s.%s is append-only', tg_table_schema, tg_table_name);
end
$function$;

create function ops.touch_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := clock_timestamp();
  return new;
end
$function$;

-- Cross-schema trigger helpers remain owned by the operations schema.  Grant
-- only the minimum namespace/function privileges required for other schema
-- owners to attach the helpers to their own tables; no operations tables are
-- exposed by these grants.
grant usage on schema ops to ushso_registry_owner, ushso_ingest_owner;
grant execute on function ops.reject_history_mutation(), ops.touch_updated_at()
  to ushso_registry_owner, ushso_ingest_owner;

create table ops.state_transitions (
  machine text not null,
  from_state text not null,
  to_state text not null,
  transition_class text not null check (transition_class in ('normal', 'terminal', 'recovery')),
  primary key (machine, from_state, to_state)
);

create trigger state_transitions_append_only
before update or delete on ops.state_transitions
for each statement execute function ops.reject_history_mutation();

reset role;
set local role ushso_registry_owner;

create table registry.sources (
  source_id text primary key check (source_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  source_key text not null unique check (source_key ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  display_name text not null check (length(display_name) between 1 and 300),
  state text not null check (state in ('active', 'pause_requested', 'draining', 'paused', 'auth_blocked', 'schema_drift', 'retired')),
  current_revision_number integer not null check (current_revision_number > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  retired_at timestamptz,
  check ((state = 'retired') = (retired_at is not null)),
  check (updated_at >= created_at)
);

create table registry.source_revisions (
  source_revision_id bigint generated always as identity primary key,
  source_id text not null references registry.sources(source_id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  contract_version text not null check (contract_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  descriptor jsonb not null check (jsonb_typeof(descriptor) = 'object'),
  descriptor_sha256 text not null check (descriptor_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null,
  recorded_by text not null,
  unique (source_id, revision_number),
  unique (source_id, descriptor_sha256)
);

create index source_revisions_source_recorded_idx
  on registry.source_revisions (source_id, recorded_at desc);

create trigger source_revisions_append_only
before update or delete on registry.source_revisions
for each statement execute function ops.reject_history_mutation();

create table registry.endpoints (
  endpoint_id text primary key check (endpoint_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  source_id text not null references registry.sources(source_id) on delete restrict,
  endpoint_key text not null check (endpoint_key ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  state text not null check (state in ('active', 'paused', 'auth_blocked', 'schema_drift', 'retired')),
  current_revision_number integer not null check (current_revision_number > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (source_id, endpoint_key),
  check (updated_at >= created_at)
);

create index endpoints_source_state_idx on registry.endpoints (source_id, state);

create table registry.endpoint_revisions (
  endpoint_revision_id bigint generated always as identity primary key,
  endpoint_id text not null references registry.endpoints(endpoint_id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  source_revision_id bigint not null references registry.source_revisions(source_revision_id) on delete restrict,
  base_origin text not null check (base_origin ~ '^https://[^/?#]+$'),
  host_allowlist text[] not null check (cardinality(host_allowlist) > 0),
  redirect_host_allowlist text[] not null,
  route_templates jsonb not null check (jsonb_typeof(route_templates) = 'array'),
  secret_reference_id text,
  descriptor_sha256 text not null check (descriptor_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null,
  unique (endpoint_id, revision_number),
  unique (endpoint_id, descriptor_sha256)
);

create index endpoint_revisions_source_revision_idx
  on registry.endpoint_revisions (source_revision_id);

create trigger endpoint_revisions_append_only
before update or delete on registry.endpoint_revisions
for each statement execute function ops.reject_history_mutation();

create table registry.scopes (
  scope_id text primary key check (scope_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  endpoint_id text not null references registry.endpoints(endpoint_id) on delete restrict,
  scope_key text not null check (scope_key ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  unit text not null check (unit in ('source', 'endpoint', 'catalog', 'jurisdiction', 'asset_class')),
  jurisdiction_code text,
  inclusion_policy jsonb not null check (jsonb_typeof(inclusion_policy) = 'object'),
  exclusion_policy jsonb not null check (jsonb_typeof(exclusion_policy) = 'object'),
  denominator_definition jsonb not null check (jsonb_typeof(denominator_definition) = 'object'),
  state text not null check (state in ('active', 'paused', 'retired')),
  configuration_revision integer not null check (configuration_revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (endpoint_id, scope_key),
  check (updated_at >= created_at)
);

create index scopes_endpoint_state_idx on registry.scopes (endpoint_id, state);

create table registry.credential_references (
  credential_reference_id text primary key check (credential_reference_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  source_id text not null references registry.sources(source_id) on delete restrict,
  secret_locator text not null check (secret_locator ~ '^(secret|cloudflare-secret)://[A-Za-z0-9._/-]{3,300}$'),
  purpose text not null check (purpose in ('catalog_auth', 'metadata_auth', 'documentation_auth')),
  state text not null check (state in ('active', 'rotation_pending', 'revoked')),
  recorded_at timestamptz not null,
  rotated_at timestamptz,
  unique (source_id, secret_locator),
  check (secret_locator !~ '[?&#=]')
);

alter table registry.endpoint_revisions
  add constraint endpoint_revisions_secret_reference_fk
  foreign key (secret_reference_id)
  references registry.credential_references(credential_reference_id)
  on delete restrict;

create index endpoint_revisions_secret_reference_idx
  on registry.endpoint_revisions (secret_reference_id)
  where secret_reference_id is not null;

create table registry.source_terms_reviews (
  terms_review_id text primary key check (terms_review_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  source_id text not null references registry.sources(source_id) on delete restrict,
  policy_version text not null,
  decision text not null check (decision in ('approved_metadata_only', 'restricted', 'blocked', 'review_required')),
  evidence_reference_id text not null,
  reviewed_by text not null,
  reviewed_at timestamptz not null,
  next_review_at timestamptz,
  unique (source_id, policy_version)
);

create trigger source_terms_reviews_append_only
before update or delete on registry.source_terms_reviews
for each statement execute function ops.reject_history_mutation();

create table registry.source_schedules (
  schedule_id text primary key check (schedule_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  source_id text not null references registry.sources(source_id) on delete restrict,
  scope_id text not null references registry.scopes(scope_id) on delete restrict,
  cadence_seconds integer not null check (cadence_seconds between 300 and 31536000),
  next_due_at timestamptz not null,
  last_scheduled_slot timestamptz,
  mode text not null check (mode in ('incremental', 'full_membership')),
  state text not null check (state in ('active', 'paused', 'retired')),
  configuration_revision integer not null check (configuration_revision > 0),
  updated_at timestamptz not null,
  unique (source_id, scope_id)
);

create index source_schedules_due_active_idx
  on registry.source_schedules (next_due_at, schedule_id)
  include (source_id, scope_id, mode, configuration_revision)
  where state = 'active';

create trigger sources_touch_updated_at
before update on registry.sources
for each row execute function ops.touch_updated_at();

create trigger endpoints_touch_updated_at
before update on registry.endpoints
for each row execute function ops.touch_updated_at();

create trigger scopes_touch_updated_at
before update on registry.scopes
for each row execute function ops.touch_updated_at();

reset role;

-- Ingest and operations tables carry restrictive foreign keys back to the
-- registry.  REFERENCES is deliberately narrower than SELECT and prevents
-- either owner from reading registry data merely because it owns a dependent
-- schema.
grant usage on schema registry to ushso_ingest_owner, ushso_ops_owner;
grant references on registry.sources, registry.endpoints, registry.scopes
  to ushso_ingest_owner, ushso_ops_owner;

grant usage on schema search to ushso_public;
grant usage on schema registry, ingest, ops to ushso_scheduler;
grant usage on schema registry, ingest, ops to ushso_harvest;
grant usage on schema ingest, ops to ushso_normalize;
grant usage on schema catalog, identity, search, ops to ushso_projector;
grant usage on schema registry, ingest, catalog, identity, search, ops to ushso_ops;

grant select on registry.sources, registry.endpoints, registry.scopes,
  registry.source_schedules to ushso_scheduler;
grant select on registry.sources, registry.source_revisions, registry.endpoints,
  registry.endpoint_revisions, registry.scopes, registry.credential_references,
  registry.source_terms_reviews to ushso_harvest;

revoke all on ops.environment_fence, ops.state_transitions from ushso_public,
  ushso_scheduler, ushso_harvest, ushso_normalize, ushso_projector;

alter default privileges for role ushso_registry_owner in schema registry
  revoke all on tables from public;
alter default privileges for role ushso_ingest_owner in schema ingest
  revoke all on tables from public;
alter default privileges for role ushso_catalog_owner in schema catalog
  revoke all on tables from public;
alter default privileges for role ushso_identity_owner in schema identity
  revoke all on tables from public;
alter default privileges for role ushso_search_owner in schema search
  revoke all on tables from public;
alter default privileges for role ushso_ops_owner in schema ops
  revoke all on tables from public;

reset role;
