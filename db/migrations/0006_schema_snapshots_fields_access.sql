-- 0006: immutable schema snapshots/fields and non-executing access truth.

set local timezone = 'UTC';
set local role ushso_catalog_owner;

create table catalog.schema_snapshots (
  schema_snapshot_revision_id text primary key references catalog.object_revisions(revision_id) on delete restrict,
  schema_snapshot_id text not null references catalog.objects(entity_id) on delete restrict,
  release_id text not null references catalog.objects(entity_id) on delete restrict,
  distribution_id text not null references catalog.objects(entity_id) on delete restrict,
  schema_digest text not null check (schema_digest ~ '^sha256:[a-f0-9]{64}$'),
  field_ids text[] not null check (cardinality(field_ids) > 0),
  immutable boolean not null check (immutable),
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  unique (schema_snapshot_id, schema_snapshot_revision_id),
  unique (distribution_id, schema_digest)
);

create index schema_snapshots_release_distribution_idx
  on catalog.schema_snapshots (release_id, distribution_id, schema_snapshot_id);

create table catalog.schema_fields (
  schema_field_revision_id text primary key references catalog.object_revisions(revision_id) on delete restrict,
  schema_field_id text not null references catalog.objects(entity_id) on delete restrict,
  schema_snapshot_id text not null references catalog.objects(entity_id) on delete restrict,
  source_name text not null check (length(source_name) between 1 and 500),
  ordinal integer not null check (ordinal between 0 and 1000000),
  source_data_type text not null check (length(source_data_type) between 1 and 300),
  description text,
  identifier_namespace text check (identifier_namespace is null or identifier_namespace ~ '^[a-z][a-z0-9._-]{1,79}$'),
  field_role text not null check (field_role in ('identifier', 'dimension', 'measure_description', 'date', 'geography', 'suppression_flag', 'metadata', 'unknown')),
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  unique (schema_field_id, schema_field_revision_id),
  unique (schema_snapshot_id, ordinal, source_name)
);

create index schema_fields_snapshot_idx on catalog.schema_fields (schema_snapshot_id, ordinal, schema_field_id);
create index schema_fields_identifier_idx on catalog.schema_fields (identifier_namespace, source_name)
  where field_role = 'identifier';

create table catalog.access_routes (
  access_route_revision_id text primary key references catalog.object_revisions(revision_id) on delete restrict,
  access_route_id text not null references catalog.objects(entity_id) on delete restrict,
  distribution_id text not null references catalog.objects(entity_id) on delete restrict,
  route_kind text not null check (route_kind in ('download', 'api', 'query_service', 'application', 'dua_request', 'license_request', 'landing_page', 'other')),
  access_class text not null check (access_class in ('public', 'registration', 'application', 'dua', 'licensed', 'paid', 'unknown')),
  locator text check (locator is null or locator ~ '^https?://'),
  human_authorization_gate boolean not null,
  requirements jsonb not null check (jsonb_typeof(requirements) = 'array'),
  stop_conditions jsonb not null check (jsonb_typeof(stop_conditions) = 'array'),
  execution_state text not null check (execution_state = 'not_executed'),
  access_workflow_submitted boolean not null check (not access_workflow_submitted),
  payloads_acquired boolean not null check (not payloads_acquired),
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  unique (access_route_id, access_route_revision_id)
);

create index access_routes_distribution_idx on catalog.access_routes (distribution_id, access_class, access_route_id);

create table catalog.access_observations (
  observation_revision_id text primary key references catalog.object_revisions(revision_id) on delete restrict,
  observation_id text not null references catalog.objects(entity_id) on delete restrict,
  access_route_id text not null references catalog.objects(entity_id) on delete restrict,
  catalog_visibility_state text not null check (catalog_visibility_state in ('visible', 'not_visible', 'blocked', 'failed', 'stale', 'unknown', 'excluded')),
  payload_access_state text not null check (payload_access_state in ('not_tested', 'metadata_only', 'accessible', 'restricted', 'blocked', 'failed', 'stale', 'unknown', 'excluded')),
  authorization_state text not null check (authorization_state in ('not_required', 'required', 'denied', 'externally_reported_authorized', 'unknown')),
  infrastructure_state text not null check (infrastructure_state in ('not_tested', 'reachable', 'unreachable', 'throttled', 'authentication_required', 'failed', 'stale', 'unknown')),
  requirement_state text not null check (requirement_state in ('none', 'documented', 'incomplete', 'conflicting', 'unknown')),
  freshness_state text not null check (freshness_state in ('current', 'stale', 'unknown', 'not_applicable')),
  stale_at timestamptz,
  check_method text not null check (check_method in ('offline_fixture', 'metadata_review', 'head', 'get_metadata_only', 'maintainer_attestation', 'external_report', 'unknown')),
  access_workflow_submitted boolean not null check (not access_workflow_submitted),
  payloads_acquired boolean not null check (not payloads_acquired),
  raw_payload_stored boolean not null check (not raw_payload_stored),
  observed_at timestamptz not null,
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  unique (observation_id, observation_revision_id)
);

create index access_observations_route_time_idx
  on catalog.access_observations (access_route_id, observed_at desc, observation_id);

create trigger schema_snapshots_append_only before update or delete on catalog.schema_snapshots
for each statement execute function ops.reject_history_mutation();
create trigger schema_fields_append_only before update or delete on catalog.schema_fields
for each statement execute function ops.reject_history_mutation();
create trigger access_routes_append_only before update or delete on catalog.access_routes
for each statement execute function ops.reject_history_mutation();
create trigger access_observations_append_only before update or delete on catalog.access_observations
for each statement execute function ops.reject_history_mutation();

reset role;

grant select on catalog.schema_snapshots, catalog.schema_fields, catalog.access_routes,
  catalog.access_observations to ushso_projector, ushso_ops;
revoke all on catalog.schema_snapshots, catalog.schema_fields, catalog.access_routes,
  catalog.access_observations from ushso_public, ushso_scheduler, ushso_harvest;

