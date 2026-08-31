-- Reviewed WP8 successor SQL for later migration 0010 integration.
-- This file is intentionally not a migration and is not executed by ordinary CI.
-- It assumes PostgreSQL 16+ and pre-provisioned nologin roles:
--   ushso_public, ushso_projector, ushso_ops, ushso_maintenance,
--   ushso_evaluation_custodian.
-- Canonical PostgreSQL remains authoritative. Everything in this schema is an
-- immutable, replaceable, source_of_truth=false publication projection.

create schema if not exists ushso_search;
revoke all on schema ushso_search from public;

create or replace function ushso_search.require_role(required_role name)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  resolved_role oid;
begin
  select oid into resolved_role from pg_roles where rolname = required_role;
  if resolved_role is null or not pg_has_role(session_user, resolved_role, 'member') then
    raise exception using errcode = '42501', message = format('required database role missing: %I', required_role);
  end if;
end
$$;

create table if not exists ushso_search.canonical_revision_manifests (
  manifest_id text primary key,
  membership_sha256 text not null unique check (membership_sha256 ~ '^[a-f0-9]{64}$'),
  canonical_as_of timestamptz not null,
  sealed_at timestamptz not null check (sealed_at >= canonical_as_of),
  revision_count bigint not null check (revision_count > 0),
  projection_obligation_count bigint not null check (projection_obligation_count > 0),
  selection_model text not null check (selection_model = 'exact_immutable_revision_membership'),
  source_of_truth boolean not null default false check (source_of_truth = false),
  immutable boolean not null default true check (immutable = true)
);

create table if not exists ushso_search.canonical_revision_members (
  manifest_id text not null references ushso_search.canonical_revision_manifests(manifest_id) on delete restrict,
  canonical_id text not null,
  revision_id text not null,
  revision_sha256 text not null check (revision_sha256 ~ '^[a-f0-9]{64}$'),
  object_type text not null check (object_type in (
    'organization', 'source', 'asset', 'release', 'distribution', 'documentation',
    'schema_snapshot', 'field', 'access_route', 'access_observation', 'relationship'
  )),
  visibility_state text not null check (visibility_state in ('public', 'excluded', 'quarantined', 'tombstoned', 'internal')),
  projection_obligations text[] not null check (cardinality(projection_obligations) between 1 and 7),
  canonical_source_ref jsonb not null,
  primary key (manifest_id, canonical_id),
  unique (manifest_id, revision_id),
  unique (manifest_id, canonical_id, revision_id, revision_sha256),
  check (projection_obligations <@ array[
    'asset_search', 'release_distribution_search', 'schema_field_search',
    'join_edge_search', 'source_search', 'seo', 'coverage'
  ]::text[])
);

create index if not exists canonical_revision_members_revision_idx
  on ushso_search.canonical_revision_members (manifest_id, revision_id);
create index if not exists canonical_revision_members_visibility_idx
  on ushso_search.canonical_revision_members (manifest_id, visibility_state, canonical_id);

create table if not exists ushso_search.reference_inventory (
  manifest_id text not null references ushso_search.canonical_revision_manifests(manifest_id) on delete restrict,
  reference_kind text not null check (reference_kind in ('evidence', 'assertions', 'access_observations', 'documentation', 'relationships')),
  reference_id text not null,
  visibility_state text not null check (visibility_state in ('public', 'excluded', 'quarantined', 'tombstoned', 'internal')),
  primary key (manifest_id, reference_kind, reference_id)
);

create table if not exists ushso_search.projection_generations (
  generation_id text primary key,
  component_kind text not null check (component_kind in (
    'asset_search', 'release_distribution_search', 'schema_field_search', 'source_search',
    'join_edge_search', 'seo', 'coverage'
  )),
  canonical_manifest_id text not null references ushso_search.canonical_revision_manifests(manifest_id) on delete restrict,
  state text not null check (state in ('building', 'validated', 'published', 'retired', 'rejected', 'physically_expired')),
  projector_version text not null,
  projector_fingerprint text not null check (projector_fingerprint ~ '^[a-f0-9]{64}$'),
  projection_schema_version text not null,
  build_transaction_id text not null check (length(build_transaction_id) between 3 and 192),
  build_strategy text not null check (build_strategy = 'complete_as_of_exact_revision_manifest'),
  document_count bigint,
  acknowledgement_count bigint,
  projected_count bigint,
  excluded_count bigint,
  projection_set_sha256 text check (projection_set_sha256 is null or projection_set_sha256 ~ '^[a-f0-9]{64}$'),
  component_sha256 text check (component_sha256 is null or component_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  sealed_at timestamptz,
  retained_until timestamptz not null,
  rejected_reason_code text,
  safety_revoked_at timestamptz,
  safety_revocation_audit_ref text,
  source_of_truth boolean not null default false check (source_of_truth = false),
  immutable_after_validation boolean not null default true check (immutable_after_validation = true),
  unique (generation_id, component_kind),
  check (retained_until >= created_at),
  check ((state = 'building' and sealed_at is null and component_sha256 is null)
      or (state <> 'building')),
  check ((state in ('validated', 'published', 'retired', 'physically_expired') and component_sha256 is not null)
      or state = 'rejected'
      or (state = 'building' and component_sha256 is null))
);

create index if not exists projection_generations_manifest_state_idx
  on ushso_search.projection_generations (canonical_manifest_id, state, component_kind);
create index if not exists projection_generations_retention_idx
  on ushso_search.projection_generations (state, retained_until)
  where state = 'retired';

create table if not exists ushso_search.generation_state_events (
  generation_id text not null references ushso_search.projection_generations(generation_id) on delete restrict,
  event_sequence bigint not null check (event_sequence > 0),
  event_id text not null unique,
  component_kind text not null,
  from_state text,
  to_state text not null,
  occurred_at timestamptz not null,
  reason_code text not null,
  transaction_id text not null,
  pin_behavior text not null check (pin_behavior in ('unavailable', 'serve_pinned', 'restart_required')),
  append_only boolean not null default true check (append_only = true),
  primary key (generation_id, event_sequence),
  foreign key (generation_id, component_kind)
    references ushso_search.projection_generations(generation_id, component_kind) on delete restrict
);

create table if not exists ushso_search.projection_documents (
  generation_id text not null,
  document_id text not null,
  document_type text not null,
  projection_schema_version text not null,
  primary_canonical_id text not null,
  primary_revision_id text not null,
  visibility_state text not null check (visibility_state = 'public'),
  document_checksum text not null check (document_checksum ~ '^[a-f0-9]{64}$'),
  title text not null,
  description text,
  authority_tier text,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  search_text text not null,
  search_vector tsvector generated always as (to_tsvector('english', search_text)) stored,
  projected_at timestamptz not null,
  source_of_truth boolean not null default false check (source_of_truth = false),
  immutable boolean not null default true check (immutable = true),
  primary key (generation_id, document_id),
  foreign key (generation_id, document_type)
    references ushso_search.projection_generations(generation_id, component_kind) on delete restrict,
  check (octet_length(search_text) <= 131072),
  check (pg_column_size(content) <= 131072)
);

create index if not exists projection_documents_public_fts_idx
  on ushso_search.projection_documents using gin (search_vector)
  where visibility_state = 'public';
create index if not exists projection_documents_browse_idx
  on ushso_search.projection_documents
  (generation_id, document_type, visibility_state, primary_canonical_id, document_id)
  include (primary_revision_id, document_checksum, title, authority_tier);
create index if not exists projection_documents_canonical_idx
  on ushso_search.projection_documents (generation_id, primary_canonical_id, primary_revision_id);

create table if not exists ushso_search.projection_document_revisions (
  generation_id text not null,
  document_id text not null,
  canonical_manifest_id text not null,
  canonical_id text not null,
  revision_id text not null,
  revision_sha256 text not null check (revision_sha256 ~ '^[a-f0-9]{64}$'),
  primary key (generation_id, document_id, canonical_id, revision_id),
  foreign key (generation_id, document_id)
    references ushso_search.projection_documents(generation_id, document_id) on delete restrict,
  foreign key (canonical_manifest_id, canonical_id, revision_id, revision_sha256)
    references ushso_search.canonical_revision_members(manifest_id, canonical_id, revision_id, revision_sha256) on delete restrict
);

create index if not exists projection_document_revisions_hydration_idx
  on ushso_search.projection_document_revisions (generation_id, canonical_id, revision_id)
  include (document_id, revision_sha256, canonical_manifest_id);

create table if not exists ushso_search.projection_truth_refs (
  generation_id text not null,
  document_id text not null,
  canonical_manifest_id text not null,
  reference_kind text not null,
  reference_id text not null,
  primary key (generation_id, document_id, reference_kind, reference_id),
  foreign key (generation_id, document_id)
    references ushso_search.projection_documents(generation_id, document_id) on delete restrict,
  foreign key (canonical_manifest_id, reference_kind, reference_id)
    references ushso_search.reference_inventory(manifest_id, reference_kind, reference_id) on delete restrict
);

create index if not exists projection_truth_refs_reverse_idx
  on ushso_search.projection_truth_refs (canonical_manifest_id, reference_kind, reference_id, generation_id);

create table if not exists ushso_search.projection_facets (
  generation_id text not null,
  document_id text not null,
  facet_name text not null check (facet_name in (
    'access_classes', 'authority_tiers', 'exact_native_ids', 'family_ids',
    'geographies', 'identifier_namespaces'
  )),
  facet_value text not null check (length(facet_value) between 1 and 192),
  primary key (generation_id, document_id, facet_name, facet_value),
  foreign key (generation_id, document_id)
    references ushso_search.projection_documents(generation_id, document_id) on delete restrict
);

create index if not exists projection_facets_lookup_idx
  on ushso_search.projection_facets (generation_id, facet_name, facet_value, document_id);

create table if not exists ushso_search.projection_acknowledgements (
  generation_id text not null,
  acknowledgement_id text not null,
  component_kind text not null,
  canonical_manifest_id text not null,
  canonical_id text not null,
  revision_id text not null,
  visibility_state text not null check (visibility_state in ('public', 'excluded', 'quarantined', 'tombstoned', 'internal')),
  result text not null check (result in ('projected', 'excluded')),
  exclusion_reason_code text,
  exclusion_evidence_refs text[],
  absence_claim_permitted boolean not null default false check (absence_claim_permitted = false),
  acknowledged_at timestamptz not null,
  immutable boolean not null default true check (immutable = true),
  primary key (generation_id, canonical_id, revision_id),
  unique (generation_id, acknowledgement_id),
  foreign key (generation_id, component_kind)
    references ushso_search.projection_generations(generation_id, component_kind) on delete restrict,
  foreign key (canonical_manifest_id, canonical_id)
    references ushso_search.canonical_revision_members(manifest_id, canonical_id) on delete restrict,
  check ((result = 'projected' and visibility_state = 'public' and exclusion_reason_code is null)
      or (result = 'excluded' and visibility_state <> 'public' and exclusion_reason_code is not null
          and cardinality(exclusion_evidence_refs) > 0))
);

create index if not exists projection_acknowledgements_outcome_idx
  on ushso_search.projection_acknowledgements (generation_id, result, canonical_id);

create table if not exists ushso_search.acknowledgement_documents (
  generation_id text not null,
  acknowledgement_id text not null,
  document_id text not null,
  document_checksum text not null check (document_checksum ~ '^[a-f0-9]{64}$'),
  primary key (generation_id, acknowledgement_id, document_id),
  foreign key (generation_id, document_id)
    references ushso_search.projection_documents(generation_id, document_id) on delete restrict,
  foreign key (generation_id, acknowledgement_id)
    references ushso_search.projection_acknowledgements(generation_id, acknowledgement_id) on delete restrict
);

create table if not exists ushso_search.publication_builds (
  build_receipt_id text primary key,
  canonical_manifest_id text not null references ushso_search.canonical_revision_manifests(manifest_id) on delete restrict,
  build_strategy text not null check (build_strategy = 'complete_as_of_exact_revision_manifest'),
  candidate_outcome text not null check (candidate_outcome in ('validated', 'rejected')),
  deterministic_build_sha256 text not null check (deterministic_build_sha256 ~ '^[a-f0-9]{64}$'),
  started_at timestamptz not null,
  sealed_at timestamptz not null check (sealed_at >= started_at),
  receipt jsonb not null,
  immutable boolean not null default true check (immutable = true)
);

create table if not exists ushso_search.publication_build_components (
  build_receipt_id text not null references ushso_search.publication_builds(build_receipt_id) on delete restrict,
  component_kind text not null check (component_kind in (
    'asset_search', 'release_distribution_search', 'schema_field_search', 'source_search',
    'join_edge_search', 'seo', 'coverage'
  )),
  generation_id text not null,
  component_sha256 text not null check (component_sha256 ~ '^[a-f0-9]{64}$'),
  primary key (build_receipt_id, component_kind),
  unique (build_receipt_id, generation_id),
  foreign key (generation_id, component_kind)
    references ushso_search.projection_generations(generation_id, component_kind) on delete restrict
);

create table if not exists ushso_search.publication_manifests (
  publication_id text primary key,
  publication_sha256 text not null unique check (publication_sha256 ~ '^[a-f0-9]{64}$'),
  canonical_manifest_id text not null references ushso_search.canonical_revision_manifests(manifest_id) on delete restrict,
  canonical_as_of timestamptz not null,
  coverage_snapshot_id text not null,
  build_receipt_id text not null references ushso_search.publication_builds(build_receipt_id) on delete restrict,
  quality_gate_status text not null check (quality_gate_status in ('PASS', 'FAIL_PRE_TUNING', 'FAIL')),
  release_ready boolean not null default false,
  public_cutover_authorization_ref text,
  previous_publication_id text references ushso_search.publication_manifests(publication_id) on delete restrict,
  sealed_at timestamptz not null,
  rollback_eligible_until timestamptz not null check (rollback_eligible_until >= sealed_at),
  manifest jsonb not null,
  immutable boolean not null default true check (immutable = true),
  check ((quality_gate_status = 'PASS' and release_ready = true)
      or (quality_gate_status <> 'PASS' and release_ready = false)),
  check ((release_ready = true and public_cutover_authorization_ref is not null)
      or release_ready = false)
);

create table if not exists ushso_search.publication_components (
  publication_id text not null references ushso_search.publication_manifests(publication_id) on delete restrict,
  component_kind text not null check (component_kind in (
    'asset_search', 'release_distribution_search', 'schema_field_search', 'source_search',
    'join_edge_search', 'seo', 'coverage'
  )),
  generation_id text not null,
  component_sha256 text not null check (component_sha256 ~ '^[a-f0-9]{64}$'),
  primary key (publication_id, component_kind),
  unique (publication_id, generation_id),
  foreign key (generation_id, component_kind)
    references ushso_search.projection_generations(generation_id, component_kind) on delete restrict
);

create index if not exists publication_components_generation_idx
  on ushso_search.publication_components (generation_id, publication_id);

create table if not exists ushso_search.promotion_gates (
  publication_id text not null references ushso_search.publication_manifests(publication_id) on delete restrict,
  gate_name text not null check (gate_name in (
    'complete_sealed_enumeration', 'membership_checkpoint_committed', 'terminal_normalized_or_excluded',
    'w1_sealed', 'all_projection_obligations_acknowledged', 'references_resolved', 'checksums_verified',
    'visibility_reconciled', 'search_seo_coverage_reconciled', 'retrieval_quality', 'security',
    'performance', 'coverage'
  )),
  status text not null check (status in ('passed', 'failed', 'not_run')),
  -- The text IDs remain an audit index. Promotion also requires the complete,
  -- generation-bound receipts below; opaque IDs alone are not evidence.
  evidence_refs text[] not null check (cardinality(evidence_refs) > 0),
  evidence_receipts jsonb not null check (case when jsonb_typeof(evidence_receipts) = 'array' then jsonb_array_length(evidence_receipts) > 0 else false end),
  verified_at timestamptz not null,
  primary key (publication_id, gate_name)
);

create or replace function ushso_search.promotion_gate_evidence_is_bound(
  p_publication_id text,
  p_gate_name text,
  p_publication_sha256 text,
  p_occurred_at timestamptz,
  p_evidence_refs text[],
  p_evidence_receipts jsonb
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, ushso_search
as $$
declare
  evidence jsonb;
  evidence_id text;
  expected_generation_ids text[];
  receipt_generation_ids text[];
  issued_at timestamptz;
  expires_at timestamptz;
begin
  if p_evidence_refs is null or cardinality(p_evidence_refs) < 1
      or p_publication_sha256 is null then
    return false;
  end if;
  if jsonb_typeof(p_evidence_receipts) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_evidence_receipts) < 1
      or jsonb_array_length(p_evidence_receipts) <> cardinality(p_evidence_refs) then
    return false;
  end if;
  if (select count(*) from unnest(p_evidence_refs) as ref(value) where value is null) > 0
      or (select count(distinct value) from unnest(p_evidence_refs) as ref(value)) <> cardinality(p_evidence_refs) then
    return false;
  end if;

  select coalesce(array_agg(component.generation_id order by component.generation_id), '{}'::text[])
    into expected_generation_ids
  from ushso_search.publication_components component
  where component.publication_id = p_publication_id;
  if cardinality(expected_generation_ids) < 1 then
    return false;
  end if;

  for evidence in
    select item.value
    from jsonb_array_elements(p_evidence_receipts) as item(value)
  loop
    if jsonb_typeof(evidence) <> 'object' then
      return false;
    end if;
    if jsonb_object_length(evidence) <> 11
        or not (evidence ?& array[
          'receipt_version', 'evidence_id', 'gate', 'publication_id',
          'publication_digest', 'generation_ids', 'status',
          'verification_state', 'issued_at', 'expires_at', 'evidence_digest'
        ]) then
      return false;
    end if;
    evidence_id := evidence ->> 'evidence_id';
    if evidence_id is null or evidence_id !~ '^[a-z][a-z0-9_.:-]{2,191}$'
        or (select count(*) from unnest(p_evidence_refs) as ref(value) where value = evidence_id) <> 1 then
      return false;
    end if;
    if evidence ->> 'receipt_version' <> 'promotion-gate-evidence.v1'
        or evidence ->> 'gate' <> p_gate_name
        or evidence ->> 'publication_id' <> p_publication_id
        or evidence ->> 'status' <> 'passed'
        or evidence ->> 'verification_state' <> 'verified' then
      return false;
    end if;
    if jsonb_typeof(evidence -> 'publication_digest') <> 'object' then
      return false;
    end if;
    if jsonb_object_length(evidence -> 'publication_digest') <> 4
        or not (evidence -> 'publication_digest' ?& array['algorithm', 'canonicalization', 'domain', 'value'])
        or evidence #>> '{publication_digest,algorithm}' <> 'sha256'
        or evidence #>> '{publication_digest,canonicalization}' <> 'ushso-canonical-json-v1'
        or evidence #>> '{publication_digest,domain}' <> 'publication_manifest'
        or evidence #>> '{publication_digest,value}' <> p_publication_sha256 then
      return false;
    end if;
    if jsonb_typeof(evidence -> 'evidence_digest') <> 'object' then
      return false;
    end if;
    if jsonb_object_length(evidence -> 'evidence_digest') <> 3
        or not (evidence -> 'evidence_digest' ?& array['digest_type', 'algorithm', 'value'])
        or evidence #>> '{evidence_digest,digest_type}' <> 'canonical_json_sha256'
        or evidence #>> '{evidence_digest,algorithm}' <> 'sha256'
        or evidence #>> '{evidence_digest,value}' !~ '^[a-f0-9]{64}$' then
      return false;
    end if;
    if jsonb_typeof(evidence -> 'generation_ids') <> 'array' then
      return false;
    end if;
    if jsonb_array_length(evidence -> 'generation_ids') <> cardinality(expected_generation_ids)
        or exists (
          select 1
          from jsonb_array_elements(evidence -> 'generation_ids') as generation(value)
          where jsonb_typeof(generation.value) <> 'string'
        ) then
      return false;
    end if;
    select array_agg(generation.value order by generation.value)
      into receipt_generation_ids
    from jsonb_array_elements_text(evidence -> 'generation_ids') as generation(value);
    if (select count(distinct generation.value) from jsonb_array_elements_text(evidence -> 'generation_ids') as generation(value)) <> cardinality(receipt_generation_ids)
        or receipt_generation_ids <> expected_generation_ids then
      return false;
    end if;
    if evidence ->> 'issued_at' is null
        or evidence ->> 'issued_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$'
        or evidence ->> 'expires_at' is null
        or evidence ->> 'expires_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$' then
      return false;
    end if;
    begin
      issued_at := (evidence ->> 'issued_at')::timestamptz;
      expires_at := (evidence ->> 'expires_at')::timestamptz;
    exception when others then
      return false;
    end;
    if issued_at > p_occurred_at or expires_at <= p_occurred_at or expires_at <= issued_at then
      return false;
    end if;
  end loop;

  if (select count(distinct item.value ->> 'evidence_id')
      from jsonb_array_elements(p_evidence_receipts) as item(value)) <> jsonb_array_length(p_evidence_receipts)
      or exists (
        select 1
        from unnest(p_evidence_refs) as ref(value)
        where not exists (
          select 1
          from jsonb_array_elements(p_evidence_receipts) as item(value)
          where item.value ->> 'evidence_id' = ref.value
        )
      ) then
    return false;
  end if;
  return true;
end
$$;

create table if not exists ushso_search.publication_pointer (
  pointer_id text primary key check (pointer_id = 'ushso:publication:active'),
  sequence bigint not null default 0 check (sequence >= 0),
  active_publication_id text references ushso_search.publication_manifests(publication_id) on delete restrict,
  previous_publication_id text references ushso_search.publication_manifests(publication_id) on delete restrict,
  switched_at timestamptz,
  history_event_id text,
  transaction_id text,
  pointer_lookup_cache_disabled boolean not null default true check (pointer_lookup_cache_disabled = true)
);

insert into ushso_search.publication_pointer (pointer_id)
values ('ushso:publication:active')
on conflict (pointer_id) do nothing;

create table if not exists ushso_search.publication_history (
  sequence bigint primary key check (sequence > 0),
  event_id text not null unique,
  action text not null check (action in ('promote', 'rollback')),
  from_publication_id text references ushso_search.publication_manifests(publication_id) on delete restrict,
  to_publication_id text not null references ushso_search.publication_manifests(publication_id) on delete restrict,
  occurred_at timestamptz not null,
  transaction_id text not null,
  actor_kind text not null check (actor_kind in ('projector', 'operations')),
  reason_code text not null check (reason_code in ('all_gates_passed', 'restore_previous_validated')),
  atomic_commit boolean not null default true check (atomic_commit = true)
);

create table if not exists ushso_search.retention_audit (
  audit_id bigint generated always as identity primary key,
  generation_id text not null references ushso_search.projection_generations(generation_id) on delete restrict,
  action text not null check (action in ('safety_revoke', 'physical_expiry', 'retention_override')),
  reason_code text not null,
  evidence_ref text not null,
  actor text not null default session_user,
  occurred_at timestamptz not null default clock_timestamp()
);

-- This ledger stores no holdout items or item-level results. The package digest
-- is globally unique, so a failed or successful lease permanently consumes the
-- sealed package for final-gate use.
create table if not exists ushso_search.final_holdout_uses (
  package_content_sha256 text primary key check (package_content_sha256 ~ '^[a-f0-9]{64}$'),
  package_id text not null unique,
  candidate_id text not null,
  ranking_fingerprint_sha256 text not null check (ranking_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  authorization_id text not null unique,
  authorized_evaluator_id text not null,
  authorization_expires_at timestamptz not null,
  authorization_verification_sha256 text not null check (authorization_verification_sha256 ~ '^[a-f0-9]{64}$'),
  lease_sha256 text not null unique check (lease_sha256 ~ '^[a-f0-9]{64}$'),
  item_count integer not null check (item_count = 20),
  consumed_at timestamptz not null,
  lease jsonb not null,
  ordinary_test_access boolean not null default false check (ordinary_test_access = false),
  aggregate_only_output boolean not null default true check (aggregate_only_output = true),
  single_use boolean not null default true check (single_use = true),
  verification_state text not null check (verification_state = 'verified_production'),
  immutable boolean not null default true check (immutable = true)
);

create table if not exists ushso_search.final_holdout_terminal_receipts (
  package_content_sha256 text primary key
    references ushso_search.final_holdout_uses(package_content_sha256) on delete restrict,
  lease_sha256 text not null unique,
  threshold_status text not null check (threshold_status in ('PASS', 'FAIL', 'ERROR')),
  completed_at timestamptz not null,
  receipt_sha256 text not null unique check (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  evaluator_actor_id text not null,
  authorization_verification_sha256 text not null check (authorization_verification_sha256 ~ '^[a-f0-9]{64}$'),
  terminal_verification_sha256 text not null check (terminal_verification_sha256 ~ '^[a-f0-9]{64}$'),
  terminal_receipt jsonb not null,
  aggregate_only_output_contract boolean not null default true check (aggregate_only_output_contract = true),
  guard_receipt_contains_per_item_data boolean not null default false check (guard_receipt_contains_per_item_data = false),
  external_per_item_side_outputs_proven_absent boolean not null default false check (external_per_item_side_outputs_proven_absent = false),
  verification_state text not null check (verification_state = 'verified_production_receipts'),
  immutable boolean not null default true check (immutable = true)
);

create or replace function ushso_search.prevent_immutable_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '55000', message = format('%s is immutable', tg_table_name);
end
$$;

do $immutable_triggers$
declare
  immutable_table text;
begin
  foreach immutable_table in array array[
    'canonical_revision_manifests', 'canonical_revision_members', 'reference_inventory',
    'generation_state_events', 'projection_documents', 'projection_document_revisions',
    'projection_truth_refs', 'projection_facets', 'projection_acknowledgements',
    'acknowledgement_documents', 'publication_builds', 'publication_build_components',
    'publication_manifests', 'publication_components', 'promotion_gates',
    'publication_history', 'retention_audit', 'final_holdout_uses',
    'final_holdout_terminal_receipts'
  ] loop
    execute format('drop trigger if exists %I on ushso_search.%I', immutable_table || '_immutable', immutable_table);
    execute format(
      'create trigger %I before update or delete on ushso_search.%I for each row execute function ushso_search.prevent_immutable_change()',
      immutable_table || '_immutable', immutable_table
    );
  end loop;
end
$immutable_triggers$;

create or replace function ushso_search.record_generation_build_start()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ushso_search
as $$
begin
  perform ushso_search.require_role('ushso_projector');
  if new.state <> 'building' or new.sealed_at is not null or new.component_sha256 is not null
      or new.document_count is not null or new.acknowledgement_count is not null then
    raise exception using errcode = '23514', message = 'new generation must begin in an empty building state';
  end if;
  insert into ushso_search.generation_state_events (
    generation_id, event_sequence, event_id, component_kind, from_state, to_state,
    occurred_at, reason_code, transaction_id, pin_behavior
  ) values (
    new.generation_id, 1, 'generation-event:' || new.generation_id || ':1', new.component_kind,
    null, 'building', new.created_at, 'build_started', new.build_transaction_id, 'unavailable'
  );
  return new;
end
$$;

drop trigger if exists projection_generation_build_start on ushso_search.projection_generations;
create trigger projection_generation_build_start
after insert on ushso_search.projection_generations
for each row execute function ushso_search.record_generation_build_start();

create or replace function ushso_search.require_building_generation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ushso_search
as $$
declare
  generation_state text;
begin
  perform ushso_search.require_role('ushso_projector');
  select state into generation_state
  from ushso_search.projection_generations
  where generation_id = new.generation_id
  for key share;
  if generation_state is distinct from 'building' then
    raise exception using errcode = '55000', message = 'projection writes require a building generation';
  end if;
  return new;
end
$$;

do $building_only_triggers$
declare
  projection_table text;
begin
  foreach projection_table in array array[
    'projection_documents', 'projection_document_revisions', 'projection_truth_refs',
    'projection_facets', 'projection_acknowledgements', 'acknowledgement_documents'
  ] loop
    execute format('drop trigger if exists %I on ushso_search.%I', projection_table || '_building_only', projection_table);
    execute format(
      'create trigger %I before insert on ushso_search.%I for each row execute function ushso_search.require_building_generation()',
      projection_table || '_building_only', projection_table
    );
  end loop;
end
$building_only_triggers$;

create or replace function ushso_search.transition_generation(
  p_generation_id text,
  p_to_state text,
  p_reason_code text,
  p_transaction_id text,
  p_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, ushso_search
as $$
declare
  current_generation ushso_search.projection_generations%rowtype;
  next_sequence bigint;
  transition_key text;
  next_pin text;
begin
  if not exists (
    select 1
    from pg_roles
    where rolname in ('ushso_projector', 'ushso_ops', 'ushso_maintenance')
      and pg_has_role(session_user, oid, 'member')
  ) then
    raise exception using errcode = '42501', message = 'projector, operations, or maintenance role required';
  end if;
  if p_occurred_at is null or length(p_transaction_id) not between 3 and 192
      or length(p_reason_code) not between 3 and 192 then
    raise exception using errcode = '22023', message = 'generation transition audit fields invalid';
  end if;
  select * into strict current_generation
  from ushso_search.projection_generations
  where generation_id = p_generation_id
  for update;
  transition_key := current_generation.state || '>' || p_to_state;
  if transition_key not in (
    'building>rejected', 'validated>published', 'validated>rejected',
    'published>retired', 'retired>published', 'retired>physically_expired'
  ) then
    raise exception using errcode = '23514', message = format('invalid generation transition %s', transition_key);
  end if;
  if p_to_state in ('published', 'retired') then next_pin := 'serve_pinned';
  elsif p_to_state = 'physically_expired' then next_pin := 'restart_required';
  else next_pin := 'unavailable';
  end if;
  select coalesce(max(event_sequence), 0) + 1 into next_sequence
  from ushso_search.generation_state_events
  where generation_id = p_generation_id;
  update ushso_search.projection_generations
  set state = p_to_state,
      rejected_reason_code = case when p_to_state = 'rejected' then p_reason_code else rejected_reason_code end
  where generation_id = p_generation_id;
  insert into ushso_search.generation_state_events (
    generation_id, event_sequence, event_id, component_kind, from_state, to_state,
    occurred_at, reason_code, transaction_id, pin_behavior
  ) values (
    p_generation_id, next_sequence, 'generation-event:' || p_generation_id || ':' || next_sequence,
    current_generation.component_kind, current_generation.state, p_to_state,
    p_occurred_at, p_reason_code, p_transaction_id, next_pin
  );
end
$$;

create or replace function ushso_search.validate_generation(
  p_generation_id text,
  p_document_count bigint,
  p_acknowledgement_count bigint,
  p_projected_count bigint,
  p_excluded_count bigint,
  p_projection_set_sha256 text,
  p_component_sha256 text,
  p_sealed_at timestamptz,
  p_transaction_id text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, ushso_search
as $$
declare
  generation ushso_search.projection_generations%rowtype;
  actual_documents bigint;
  actual_acknowledgements bigint;
  actual_projected bigint;
  actual_excluded bigint;
  expected_obligations bigint;
  next_sequence bigint;
begin
  perform ushso_search.require_role('ushso_projector');
  select * into strict generation
  from ushso_search.projection_generations
  where generation_id = p_generation_id
  for update;
  if generation.state <> 'building' then
    raise exception using errcode = '55000', message = 'only building generations may validate';
  end if;
  if p_document_count < 0 or p_acknowledgement_count < 1 or p_projected_count < 0 or p_excluded_count < 0
      or p_projected_count + p_excluded_count <> p_acknowledgement_count
      or p_projection_set_sha256 !~ '^[a-f0-9]{64}$'
      or p_component_sha256 !~ '^[a-f0-9]{64}$'
      or p_sealed_at < generation.created_at
      or length(p_transaction_id) not between 3 and 192 then
    raise exception using errcode = '22023', message = 'generation validation receipt fields invalid';
  end if;
  select count(*) into actual_documents from ushso_search.projection_documents where generation_id = p_generation_id;
  select count(*), count(*) filter (where result = 'projected'), count(*) filter (where result = 'excluded')
    into actual_acknowledgements, actual_projected, actual_excluded
  from ushso_search.projection_acknowledgements where generation_id = p_generation_id;
  select count(*) into expected_obligations
  from ushso_search.canonical_revision_members member
  where member.manifest_id = generation.canonical_manifest_id
    and generation.component_kind = any(member.projection_obligations);
  if (actual_documents, actual_acknowledgements, actual_projected, actual_excluded)
      is distinct from (p_document_count, p_acknowledgement_count, p_projected_count, p_excluded_count) then
    raise exception using errcode = '23514', message = 'declared projection counts do not match stored rows';
  end if;
  if actual_acknowledgements <> expected_obligations then
    raise exception using errcode = '23514', message = 'projection obligations are not fully acknowledged';
  end if;
  if exists (
    select 1
    from ushso_search.canonical_revision_members member
    left join ushso_search.projection_acknowledgements ack
      on ack.generation_id = p_generation_id
     and ack.canonical_manifest_id = member.manifest_id
     and ack.canonical_id = member.canonical_id
     and ack.revision_id = member.revision_id
    where member.manifest_id = generation.canonical_manifest_id
      and generation.component_kind = any(member.projection_obligations)
      and (
        ack.acknowledgement_id is null
        or (member.visibility_state = 'public' and ack.result <> 'projected')
        or (member.visibility_state <> 'public' and ack.result <> 'excluded')
      )
  ) then
    raise exception using errcode = '23514', message = 'visibility or acknowledgement reconciliation failed';
  end if;
  if exists (
    select 1 from ushso_search.acknowledgement_documents ad
    join ushso_search.projection_documents d
      on d.generation_id = ad.generation_id and d.document_id = ad.document_id
    where ad.generation_id = p_generation_id and ad.document_checksum <> d.document_checksum
  ) then
    raise exception using errcode = '23514', message = 'acknowledged document checksum mismatch';
  end if;
  if exists (
    select 1 from ushso_search.projection_documents d
    left join ushso_search.acknowledgement_documents ad
      on ad.generation_id = d.generation_id and ad.document_id = d.document_id
    where d.generation_id = p_generation_id and ad.document_id is null
  ) then
    raise exception using errcode = '23514', message = 'unacknowledged projection document';
  end if;
  if exists (
    select 1
    from ushso_search.projection_acknowledgements ack
    left join ushso_search.acknowledgement_documents ad
      on ad.generation_id = ack.generation_id and ad.acknowledgement_id = ack.acknowledgement_id
    where ack.generation_id = p_generation_id
    group by ack.generation_id, ack.acknowledgement_id, ack.result
    having (ack.result = 'projected' and count(ad.document_id) = 0)
        or (ack.result = 'excluded' and count(ad.document_id) <> 0)
  ) then
    raise exception using errcode = '23514', message = 'acknowledgement document reconciliation failed';
  end if;
  if exists (
    select 1
    from ushso_search.projection_documents document
    left join ushso_search.projection_document_revisions revision
      on revision.generation_id = document.generation_id
     and revision.document_id = document.document_id
    where document.generation_id = p_generation_id
    group by document.generation_id, document.document_id,
      document.primary_canonical_id, document.primary_revision_id
    having count(revision.revision_id) = 0
       or count(*) filter (
         where revision.canonical_manifest_id = generation.canonical_manifest_id
           and revision.canonical_id = document.primary_canonical_id
           and revision.revision_id = document.primary_revision_id
       ) <> 1
       or count(*) filter (where revision.canonical_manifest_id <> generation.canonical_manifest_id) <> 0
  ) then
    raise exception using errcode = '23514', message = 'document canonical revision reconciliation failed';
  end if;
  if exists (
    select 1
    from ushso_search.projection_documents document
    left join ushso_search.projection_truth_refs truth_ref
      on truth_ref.generation_id = document.generation_id and truth_ref.document_id = document.document_id
    left join ushso_search.reference_inventory inventory
      on inventory.manifest_id = truth_ref.canonical_manifest_id
     and inventory.reference_kind = truth_ref.reference_kind
     and inventory.reference_id = truth_ref.reference_id
    where document.generation_id = p_generation_id
    group by document.generation_id, document.document_id
    having count(truth_ref.reference_id) = 0
       or count(*) filter (
         where truth_ref.canonical_manifest_id <> generation.canonical_manifest_id
            or inventory.visibility_state <> 'public'
       ) <> 0
  ) then
    raise exception using errcode = '23514', message = 'truth reference visibility reconciliation failed';
  end if;
  select coalesce(max(event_sequence), 0) + 1 into next_sequence
  from ushso_search.generation_state_events
  where generation_id = p_generation_id;
  update ushso_search.projection_generations
  set document_count = p_document_count,
      acknowledgement_count = p_acknowledgement_count,
      projected_count = p_projected_count,
      excluded_count = p_excluded_count,
      projection_set_sha256 = p_projection_set_sha256,
      component_sha256 = p_component_sha256,
      sealed_at = p_sealed_at,
      state = 'validated'
  where generation_id = p_generation_id;
  insert into ushso_search.generation_state_events (
    generation_id, event_sequence, event_id, component_kind, from_state, to_state,
    occurred_at, reason_code, transaction_id, pin_behavior
  ) values (
    p_generation_id, next_sequence, 'generation-event:' || p_generation_id || ':' || next_sequence,
    generation.component_kind, 'building', 'validated', p_sealed_at,
    'validation_passed', p_transaction_id, 'unavailable'
  );
end
$$;

create or replace function ushso_search.facets_match(
  p_generation_id text,
  p_document_id text,
  p_filters jsonb
)
returns boolean
language sql
stable
parallel safe
set search_path = pg_catalog, ushso_search
as $$
  select jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) = 'object'
    and not exists (
      select 1
      from jsonb_each(coalesce(p_filters, '{}'::jsonb)) requested_filter
      where requested_filter.key not in (
        'access_classes', 'authority_tiers', 'exact_native_ids', 'family_ids',
        'geographies', 'identifier_namespaces'
      )
      or jsonb_typeof(requested_filter.value) <> 'array'
      or jsonb_array_length(requested_filter.value) = 0
      or not exists (
        select 1
        from jsonb_array_elements_text(requested_filter.value) requested_value
        join ushso_search.projection_facets facet
          on facet.generation_id = p_generation_id
         and facet.document_id = p_document_id
         and facet.facet_name = requested_filter.key
         and facet.facet_value = requested_value.value
      )
    )
$$;

create or replace function ushso_search.assert_publication_generation_pin(
  p_publication_id text,
  p_generation_id text
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, ushso_search
as $$
declare
  component_kind text;
  generation_state text;
  retained_until timestamptz;
  revoked_at timestamptz;
begin
  select pc.component_kind, g.state, g.retained_until, g.safety_revoked_at
    into strict component_kind, generation_state, retained_until, revoked_at
  from ushso_search.publication_components pc
  join ushso_search.projection_generations g on g.generation_id = pc.generation_id
  where pc.publication_id = p_publication_id and pc.generation_id = p_generation_id;
  if revoked_at is not null then
    raise exception using errcode = '55000', message = 'generation_safety_revoked';
  end if;
  if generation_state not in ('published', 'retired') or retained_until <= statement_timestamp() then
    raise exception using errcode = '55000', message = 'generation_restart_required';
  end if;
  return component_kind;
end
$$;

create or replace function ushso_search.search_candidates(
  p_publication_id text,
  p_generation_id text,
  p_query text,
  p_filters jsonb,
  p_limit integer,
  p_cursor_rank_micros bigint,
  p_cursor_canonical_id text,
  p_cursor_document_id text
)
returns table (
  generation_id text,
  document_id text,
  document_type text,
  canonical_id text,
  revision_id text,
  document_checksum text,
  visibility_state text,
  rank_micros bigint,
  title text,
  description text,
  authority_tier text,
  match_reason_code text,
  match_reason text,
  near_miss boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, ushso_search
set statement_timeout = '600ms'
as $$
declare
  pinned_component text;
begin
  perform ushso_search.require_role('ushso_public');
  if p_limit < 1 or p_limit > 51 or length(p_query) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'bounded search input invalid';
  end if;
  pinned_component := ushso_search.assert_publication_generation_pin(p_publication_id, p_generation_id);
  return query
  with parsed_query as (
    select websearch_to_tsquery('english', p_query) as query
  ), ranked as materialized (
    select
      d.generation_id,
      d.document_id,
      d.document_type,
      d.primary_canonical_id as canonical_id,
      d.primary_revision_id as revision_id,
      d.document_checksum,
      d.visibility_state,
      greatest(0, round(ts_rank_cd(d.search_vector, q.query)::numeric * 1000000)::bigint) as rank_micros,
      d.title,
      d.description,
      d.authority_tier
    from ushso_search.projection_documents d
    cross join parsed_query q
    where d.generation_id = p_generation_id
      and d.document_type = pinned_component
      and d.visibility_state = 'public'
      and d.search_vector @@ q.query
      and ushso_search.facets_match(d.generation_id, d.document_id, p_filters)
  )
  select
    r.generation_id, r.document_id, r.document_type, r.canonical_id, r.revision_id,
    r.document_checksum, r.visibility_state, r.rank_micros, r.title, r.description,
    r.authority_tier, 'untuned_lexical_metadata_match'::text,
    'Matched indexed public metadata in the pinned generation.'::text,
    false
  from ranked r
  where p_cursor_rank_micros is null
     or r.rank_micros < p_cursor_rank_micros
     or (r.rank_micros = p_cursor_rank_micros and r.canonical_id > p_cursor_canonical_id)
     or (r.rank_micros = p_cursor_rank_micros and r.canonical_id = p_cursor_canonical_id and r.document_id > p_cursor_document_id)
  order by r.rank_micros desc, r.canonical_id asc, r.document_id asc
  limit p_limit;
end
$$;

create or replace function ushso_search.browse_candidates(
  p_publication_id text,
  p_generation_id text,
  p_filters jsonb,
  p_limit integer,
  p_cursor_canonical_id text,
  p_cursor_document_id text
)
returns table (
  generation_id text,
  document_id text,
  document_type text,
  canonical_id text,
  revision_id text,
  document_checksum text,
  visibility_state text,
  rank_micros bigint,
  title text,
  description text,
  authority_tier text,
  match_reason_code text,
  match_reason text,
  near_miss boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, ushso_search
set statement_timeout = '600ms'
as $$
declare
  pinned_component text;
begin
  perform ushso_search.require_role('ushso_public');
  if p_limit < 1 or p_limit > 51 then raise exception using errcode = '22023', message = 'bounded browse limit invalid'; end if;
  pinned_component := ushso_search.assert_publication_generation_pin(p_publication_id, p_generation_id);
  return query
  select
    d.generation_id, d.document_id, d.document_type, d.primary_canonical_id,
    d.primary_revision_id, d.document_checksum, d.visibility_state, 0::bigint,
    d.title, d.description, d.authority_tier, 'pinned_catalog_browse'::text,
    'Included in the bounded pinned-generation browse view.'::text, false
  from ushso_search.projection_documents d
  where d.generation_id = p_generation_id
    and d.document_type = pinned_component
    and d.visibility_state = 'public'
    and ushso_search.facets_match(d.generation_id, d.document_id, p_filters)
    and (
      p_cursor_canonical_id is null
      or (d.primary_canonical_id, d.document_id) > (p_cursor_canonical_id, p_cursor_document_id)
    )
  order by d.primary_canonical_id asc, d.document_id asc
  limit p_limit;
end
$$;

create or replace function ushso_search.hydrate_exact_revisions(
  p_publication_id text,
  p_generation_id text,
  p_pins jsonb
)
returns table (
  generation_id text,
  document_id text,
  canonical_manifest_id text,
  canonical_id text,
  revision_id text,
  revision_sha256 text,
  canonical_source_ref jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, ushso_search
set statement_timeout = '600ms'
as $$
begin
  perform ushso_search.require_role('ushso_public');
  perform ushso_search.assert_publication_generation_pin(p_publication_id, p_generation_id);
  if jsonb_typeof(p_pins) <> 'array' or jsonb_array_length(p_pins) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'bounded hydration pins invalid';
  end if;
  return query
  with requested as (
    select distinct pin.canonical_id, pin.revision_id
    from jsonb_to_recordset(p_pins) as pin(canonical_id text, revision_id text)
  )
  select
    revisions.generation_id,
    revisions.document_id,
    revisions.canonical_manifest_id,
    revisions.canonical_id,
    revisions.revision_id,
    revisions.revision_sha256,
    member.canonical_source_ref
  from requested
  join ushso_search.projection_document_revisions revisions
    on revisions.generation_id = p_generation_id
   and revisions.canonical_id = requested.canonical_id
   and revisions.revision_id = requested.revision_id
  join ushso_search.canonical_revision_members member
    on member.manifest_id = revisions.canonical_manifest_id
   and member.canonical_id = revisions.canonical_id
   and member.revision_id = revisions.revision_id
   and member.revision_sha256 = revisions.revision_sha256
  order by revisions.canonical_id, revisions.revision_id;
end
$$;

-- This is the only cache-disabled public pointer lookup. A request calls it
-- once, freezes the returned identifiers, and passes those exact identifiers
-- to every cacheable search/hydration call for the remainder of the request.
create or replace function ushso_search.resolve_active_publication()
returns table (
  pointer_sequence bigint,
  publication_id text,
  publication_sha256 text,
  canonical_manifest_id text,
  canonical_membership_sha256 text,
  canonical_as_of timestamptz,
  coverage_snapshot_id text,
  component_generations jsonb,
  component_checksums jsonb,
  component_retained_until jsonb,
  resolved_at timestamptz,
  pointer_lookup_cache_disabled boolean
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, ushso_search
set statement_timeout = '250ms'
as $$
declare
  pointer ushso_search.publication_pointer%rowtype;
  publication ushso_search.publication_manifests%rowtype;
  generations jsonb;
  checksums jsonb;
  retained_until jsonb;
  component_count integer;
begin
  perform ushso_search.require_role('ushso_public');
  select * into strict pointer
  from ushso_search.publication_pointer
  where pointer_id = 'ushso:publication:active';
  if pointer.active_publication_id is null or pointer.pointer_lookup_cache_disabled is not true then
    raise exception using errcode = '55000', message = 'active publication pointer unavailable';
  end if;
  select * into strict publication
  from ushso_search.publication_manifests manifest
  where manifest.publication_id = pointer.active_publication_id;
  select
    jsonb_object_agg(component.component_kind, component.generation_id order by component.component_kind),
    jsonb_object_agg(component.component_kind, component.component_sha256 order by component.component_kind),
    jsonb_object_agg(
      component.component_kind,
      to_char(generation.retained_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      order by component.component_kind
    ),
    count(*)
  into generations, checksums, retained_until, component_count
  from ushso_search.publication_components component
  join ushso_search.projection_generations generation
    on generation.generation_id = component.generation_id
  where component.publication_id = pointer.active_publication_id;
  if component_count <> 7 then
    raise exception using errcode = '23514', message = 'active publication component set incomplete';
  end if;
  return query select
    pointer.sequence,
    publication.publication_id,
    publication.publication_sha256,
    publication.canonical_manifest_id,
    (select manifest.membership_sha256
     from ushso_search.canonical_revision_manifests manifest
     where manifest.manifest_id = publication.canonical_manifest_id),
    publication.canonical_as_of,
    publication.coverage_snapshot_id,
    generations,
    checksums,
    retained_until,
    clock_timestamp(),
    true;
end
$$;

create or replace function ushso_search.safety_revoke_generation(
  p_generation_id text,
  p_reason_code text,
  p_evidence_ref text,
  p_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, ushso_search
as $$
declare
  generation ushso_search.projection_generations%rowtype;
begin
  perform ushso_search.require_role('ushso_ops');
  if length(p_reason_code) not between 3 and 192 or length(p_evidence_ref) not between 3 and 512
      or p_occurred_at is null then
    raise exception using errcode = '22023', message = 'safety revocation audit fields invalid';
  end if;
  select * into strict generation
  from ushso_search.projection_generations
  where generation_id = p_generation_id
  for update;
  if generation.safety_revoked_at is not null then
    raise exception using errcode = '55000', message = 'generation already safety revoked';
  end if;
  update ushso_search.projection_generations
  set safety_revoked_at = p_occurred_at,
      safety_revocation_audit_ref = p_evidence_ref
  where generation_id = p_generation_id;
  insert into ushso_search.retention_audit (
    generation_id, action, reason_code, evidence_ref, occurred_at
  ) values (p_generation_id, 'safety_revoke', p_reason_code, p_evidence_ref, p_occurred_at);
end
$$;

-- Records physical expiry only after the maintenance caller has an immutable
-- cleanup receipt. Active and N-1 pointer targets can never be expired.
create or replace function ushso_search.expire_retired_generation(
  p_generation_id text,
  p_transaction_id text,
  p_reason_code text,
  p_cleanup_evidence_ref text,
  p_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, ushso_search
as $$
declare
  generation ushso_search.projection_generations%rowtype;
begin
  perform ushso_search.require_role('ushso_maintenance');
  select * into strict generation
  from ushso_search.projection_generations
  where generation_id = p_generation_id
  for update;
  if generation.state <> 'retired' or generation.retained_until > p_occurred_at then
    raise exception using errcode = '55000', message = 'generation is not eligible for physical expiry';
  end if;
  if length(p_cleanup_evidence_ref) not between 3 and 512 then
    raise exception using errcode = '22023', message = 'cleanup evidence reference invalid';
  end if;
  if exists (
    select 1
    from ushso_search.publication_pointer pointer
    join ushso_search.publication_components component
      on component.publication_id in (pointer.active_publication_id, pointer.previous_publication_id)
    where pointer.pointer_id = 'ushso:publication:active'
      and component.generation_id = p_generation_id
  ) then
    raise exception using errcode = '55000', message = 'generation is protected by active or N-1 pointer';
  end if;
  perform ushso_search.transition_generation(
    p_generation_id, 'physically_expired', p_reason_code, p_transaction_id, p_occurred_at
  );
  insert into ushso_search.retention_audit (
    generation_id, action, reason_code, evidence_ref, occurred_at
  ) values (p_generation_id, 'physical_expiry', p_reason_code, p_cleanup_evidence_ref, p_occurred_at);
end
$$;

create or replace function ushso_search.consume_final_holdout_lease(p_lease jsonb)
returns table (accepted boolean, package_content_sha256 text, lease_sha256 text)
language plpgsql
security definer
set search_path = pg_catalog, ushso_search
as $$
declare
  package_sha text;
  lease_sha text;
begin
  perform ushso_search.require_role('ushso_evaluation_custodian');
  if jsonb_typeof(p_lease) <> 'object'
      or p_lease ->> 'lease_version' <> 'ushso-final-holdout-lease.v1'
      or (p_lease ->> 'item_count')::integer <> 20
      or (p_lease ->> 'ordinary_test_access')::boolean is not false
      or (p_lease ->> 'aggregate_only_output')::boolean is not true
      or (p_lease ->> 'single_use')::boolean is not true
      or (p_lease ->> 'package_contents_included')::boolean is not false
      or p_lease ->> 'verification_state' <> 'verified_production'
      or p_lease -> 'terminal_receipt' <> 'null'::jsonb then
    raise exception using errcode = '22023', message = 'final holdout lease policy invalid';
  end if;
  if p_lease #>> '{package_content_digest,digest_type}' <> 'package_sha256'
      or p_lease #>> '{package_content_digest,algorithm}' <> 'sha256'
      or p_lease #>> '{lease_digest,digest_type}' <> 'canonical_json_sha256'
      or p_lease #>> '{lease_digest,algorithm}' <> 'sha256'
      or p_lease #>> '{authorization_verification_receipt_digest,digest_type}' <> 'canonical_json_sha256'
      or p_lease #>> '{authorization_verification_receipt_digest,algorithm}' <> 'sha256' then
    raise exception using errcode = '22023', message = 'final holdout digest taxonomy invalid';
  end if;
  package_sha := p_lease #>> '{package_content_digest,value}';
  lease_sha := p_lease #>> '{lease_digest,value}';
  if package_sha !~ '^[a-f0-9]{64}$' or lease_sha !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'final holdout digest invalid';
  end if;
  begin
    insert into ushso_search.final_holdout_uses (
      package_content_sha256, package_id, candidate_id, ranking_fingerprint_sha256,
      authorization_id, authorized_evaluator_id, authorization_expires_at,
      authorization_verification_sha256, lease_sha256, item_count, consumed_at,
      lease, verification_state
    ) values (
      package_sha, p_lease ->> 'package_id', p_lease ->> 'candidate_id',
      p_lease ->> 'ranking_fingerprint_sha256', p_lease ->> 'authorization_id',
      p_lease ->> 'authorized_evaluator_id', (p_lease ->> 'authorization_expires_at')::timestamptz,
      p_lease #>> '{authorization_verification_receipt_digest,value}',
      lease_sha, 20, (p_lease ->> 'issued_at')::timestamptz, p_lease, 'verified_production'
    );
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'final holdout package already consumed';
  end;
  return query select true, package_sha, lease_sha;
end
$$;

create or replace function ushso_search.complete_final_holdout_lease(
  p_package_content_sha256 text,
  p_lease_sha256 text,
  p_terminal_receipt jsonb
)
returns table (
  accepted boolean,
  package_content_sha256 text,
  lease_sha256 text,
  terminal_receipt_sha256 text
)
language plpgsql
security definer
set search_path = pg_catalog, ushso_search
as $$
declare
  expected_lease_sha text;
  expected_evaluator_id text;
  expected_authorization_expires_at timestamptz;
  expected_authorization_verification_sha text;
  receipt_sha text;
  terminal_status text;
  terminal_verification_sha text;
begin
  perform ushso_search.require_role('ushso_evaluation_custodian');
  select holdout_use.lease_sha256, holdout_use.authorized_evaluator_id,
    holdout_use.authorization_expires_at, holdout_use.authorization_verification_sha256
  into strict expected_lease_sha, expected_evaluator_id,
    expected_authorization_expires_at, expected_authorization_verification_sha
  from ushso_search.final_holdout_uses holdout_use
  where holdout_use.package_content_sha256 = p_package_content_sha256
  for update;
  if expected_lease_sha <> p_lease_sha256 then
    raise exception using errcode = '23514', message = 'final holdout lease digest mismatch';
  end if;
  if jsonb_typeof(p_terminal_receipt) <> 'object'
      or p_terminal_receipt ->> 'receipt_version' <> 'ushso-final-holdout-single-use-receipt.v1'
      or (p_terminal_receipt ->> 'aggregate_only_output_contract')::boolean is not true
      or (p_terminal_receipt ->> 'guard_receipt_contains_per_item_data')::boolean is not false
      or (p_terminal_receipt ->> 'external_per_item_side_outputs_proven_absent')::boolean is not false
      or (p_terminal_receipt ->> 'single_use_consumed')::boolean is not true
      or p_terminal_receipt ->> 'verification_state' <> 'verified_production_receipts'
      or p_terminal_receipt ->> 'evaluator_actor_id' <> expected_evaluator_id
      or (p_terminal_receipt ->> 'completed_at')::timestamptz >= expected_authorization_expires_at
      or (p_terminal_receipt ->> 'completion_observed_at')::timestamptz >= expected_authorization_expires_at
      or (p_terminal_receipt ->> 'completed_at')::timestamptz
        > (p_terminal_receipt ->> 'completion_observed_at')::timestamptz
      or clock_timestamp() >= expected_authorization_expires_at
      or p_terminal_receipt #>> '{package_content_digest,value}' <> p_package_content_sha256
      or p_terminal_receipt #>> '{lease_digest,value}' <> p_lease_sha256
      or p_terminal_receipt #>> '{lease_digest,digest_type}' <> 'canonical_json_sha256'
      or p_terminal_receipt #>> '{authorization_verification_receipt_digest,value}' <> expected_authorization_verification_sha
      or p_terminal_receipt #>> '{receipt_digest,digest_type}' <> 'canonical_json_sha256'
      or p_terminal_receipt #>> '{receipt_digest,algorithm}' <> 'sha256' then
    raise exception using errcode = '22023', message = 'final holdout terminal receipt policy invalid';
  end if;
  receipt_sha := p_terminal_receipt #>> '{receipt_digest,value}';
  terminal_verification_sha := p_terminal_receipt #>> '{terminal_verification_receipt_digest,value}';
  terminal_status := p_terminal_receipt #>> '{aggregate_result,threshold_status}';
  if receipt_sha !~ '^[a-f0-9]{64}$' or terminal_verification_sha !~ '^[a-f0-9]{64}$'
      or p_terminal_receipt #>> '{terminal_verification_receipt_digest,digest_type}' <> 'canonical_json_sha256'
      or terminal_status not in ('PASS', 'FAIL', 'ERROR') then
    raise exception using errcode = '22023', message = 'final holdout terminal receipt digest or status invalid';
  end if;
  begin
    insert into ushso_search.final_holdout_terminal_receipts (
      package_content_sha256, lease_sha256, threshold_status, completed_at,
      receipt_sha256, evaluator_actor_id, authorization_verification_sha256,
      terminal_verification_sha256, terminal_receipt, verification_state
    ) values (
      p_package_content_sha256, p_lease_sha256, terminal_status,
      (p_terminal_receipt ->> 'completed_at')::timestamptz, receipt_sha,
      expected_evaluator_id, expected_authorization_verification_sha,
      terminal_verification_sha, p_terminal_receipt, 'verified_production_receipts'
    );
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'final holdout terminal receipt already recorded';
  end;
  return query select true, p_package_content_sha256, p_lease_sha256, receipt_sha;
end
$$;

create or replace function ushso_search.promote_publication(
  p_publication_id text,
  p_transaction_id text,
  p_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, ushso_search
as $$
declare
  pointer ushso_search.publication_pointer%rowtype;
  candidate ushso_search.publication_manifests%rowtype;
  next_sequence bigint;
  current_component record;
  candidate_component record;
begin
  perform ushso_search.require_role('ushso_ops');
  select * into strict pointer from ushso_search.publication_pointer
    where pointer_id = 'ushso:publication:active' for update;
  select * into strict candidate from ushso_search.publication_manifests
    where publication_id = p_publication_id;
  if candidate.quality_gate_status <> 'PASS' or candidate.release_ready is not true
      or candidate.public_cutover_authorization_ref is null then
    raise exception using errcode = '55000', message = 'publication is not release-ready or externally authorized';
  end if;
  if candidate.previous_publication_id is distinct from pointer.active_publication_id then
    raise exception using errcode = '40001', message = 'publication previous pointer changed';
  end if;
  if (select count(*) from ushso_search.publication_components where publication_id = p_publication_id) <> 7 then
    raise exception using errcode = '23514', message = 'publication component set is incomplete';
  end if;
  if not exists (
    select 1
    from ushso_search.publication_builds build
    where build.build_receipt_id = candidate.build_receipt_id
      and build.candidate_outcome = 'validated'
      and build.canonical_manifest_id = candidate.canonical_manifest_id
  ) or exists (
    select 1
    from ushso_search.publication_components component
    left join ushso_search.publication_build_components build_component
      on build_component.build_receipt_id = candidate.build_receipt_id
     and build_component.component_kind = component.component_kind
    where component.publication_id = p_publication_id
      and (
        build_component.component_kind is null
        or build_component.generation_id <> component.generation_id
        or build_component.component_sha256 <> component.component_sha256
      )
  ) then
    raise exception using errcode = '23514', message = 'publication does not match its validated build receipt';
  end if;
  if exists (
    select 1 from ushso_search.publication_components pc
    join ushso_search.projection_generations g on g.generation_id = pc.generation_id
    where pc.publication_id = p_publication_id
      and (g.state <> 'validated' or g.canonical_manifest_id <> candidate.canonical_manifest_id
           or g.component_sha256 <> pc.component_sha256 or g.retained_until <= p_occurred_at
           or g.safety_revoked_at is not null)
  ) then
    raise exception using errcode = '23514', message = 'publication component is not a validated W1 match';
  end if;
  if exists (
    select 1
    from ushso_search.promotion_gates gate
    where gate.publication_id = p_publication_id
      and not ushso_search.promotion_gate_evidence_is_bound(
        p_publication_id,
        gate.gate_name,
        candidate.publication_sha256,
        p_occurred_at,
        gate.evidence_refs,
        gate.evidence_receipts
      )
  ) then
    raise exception using errcode = '23514', message = 'publication gate evidence is not bound to this publication';
  end if;
  if exists (
    select required.gate_name
    from unnest(array[
      'complete_sealed_enumeration', 'membership_checkpoint_committed', 'terminal_normalized_or_excluded',
      'w1_sealed', 'all_projection_obligations_acknowledged', 'references_resolved', 'checksums_verified',
      'visibility_reconciled', 'search_seo_coverage_reconciled', 'retrieval_quality', 'security',
      'performance', 'coverage'
    ]) required(gate_name)
    left join ushso_search.promotion_gates gate
      on gate.publication_id = p_publication_id and gate.gate_name = required.gate_name
    where gate.status is distinct from 'passed'
  ) then
    raise exception using errcode = '23514', message = 'publication gates are incomplete';
  end if;
  next_sequence := pointer.sequence + 1;
  insert into ushso_search.publication_history (
    sequence, event_id, action, from_publication_id, to_publication_id,
    occurred_at, transaction_id, actor_kind, reason_code
  ) values (
    next_sequence, 'publication-history:' || next_sequence, 'promote', pointer.active_publication_id,
    p_publication_id, p_occurred_at, p_transaction_id, 'operations', 'all_gates_passed'
  );
  if pointer.active_publication_id is not null then
    for current_component in
      select generation_id from ushso_search.publication_components where publication_id = pointer.active_publication_id order by generation_id
    loop
      perform ushso_search.transition_generation(current_component.generation_id, 'retired', 'superseded', p_transaction_id, p_occurred_at);
    end loop;
  end if;
  for candidate_component in
    select generation_id from ushso_search.publication_components where publication_id = p_publication_id order by generation_id
  loop
    perform ushso_search.transition_generation(candidate_component.generation_id, 'published', 'atomic_promotion', p_transaction_id, p_occurred_at);
  end loop;
  update ushso_search.publication_pointer
  set sequence = next_sequence,
      active_publication_id = p_publication_id,
      previous_publication_id = pointer.active_publication_id,
      switched_at = p_occurred_at,
      history_event_id = 'publication-history:' || next_sequence,
      transaction_id = p_transaction_id
  where pointer_id = 'ushso:publication:active';
end
$$;

create or replace function ushso_search.rollback_publication(
  p_target_publication_id text,
  p_transaction_id text,
  p_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, ushso_search
as $$
declare
  pointer ushso_search.publication_pointer%rowtype;
  target ushso_search.publication_manifests%rowtype;
  next_sequence bigint;
  component record;
begin
  perform ushso_search.require_role('ushso_ops');
  select * into strict pointer from ushso_search.publication_pointer
    where pointer_id = 'ushso:publication:active' for update;
  if pointer.active_publication_id is null or pointer.previous_publication_id is distinct from p_target_publication_id then
    raise exception using errcode = '55000', message = 'rollback is restricted to the retained N-1 publication';
  end if;
  select * into strict target from ushso_search.publication_manifests
    where publication_id = p_target_publication_id;
  if pointer.active_publication_id = p_target_publication_id then
    raise exception using errcode = '55000', message = 'rollback target is already active';
  end if;
  if target.rollback_eligible_until <= p_occurred_at then
    raise exception using errcode = '55000', message = 'rollback target retention expired';
  end if;
  if (select count(*) from ushso_search.publication_components where publication_id = p_target_publication_id) <> 7
      or exists (
        select 1 from ushso_search.publication_components pc
        join ushso_search.projection_generations g on g.generation_id = pc.generation_id
        where pc.publication_id = p_target_publication_id
          and (g.state <> 'retired' or g.retained_until <= p_occurred_at or g.safety_revoked_at is not null)
      ) then
    raise exception using errcode = '55000', message = 'rollback target is not retained';
  end if;
  next_sequence := pointer.sequence + 1;
  insert into ushso_search.publication_history (
    sequence, event_id, action, from_publication_id, to_publication_id,
    occurred_at, transaction_id, actor_kind, reason_code
  ) values (
    next_sequence, 'publication-history:' || next_sequence, 'rollback', pointer.active_publication_id,
    p_target_publication_id, p_occurred_at, p_transaction_id, 'operations', 'restore_previous_validated'
  );
  for component in select generation_id from ushso_search.publication_components where publication_id = pointer.active_publication_id order by generation_id loop
    perform ushso_search.transition_generation(component.generation_id, 'retired', 'superseded', p_transaction_id, p_occurred_at);
  end loop;
  for component in select generation_id from ushso_search.publication_components where publication_id = p_target_publication_id order by generation_id loop
    perform ushso_search.transition_generation(component.generation_id, 'published', 'rollback_restored', p_transaction_id, p_occurred_at);
  end loop;
  update ushso_search.publication_pointer
  set sequence = next_sequence,
      active_publication_id = p_target_publication_id,
      previous_publication_id = pointer.active_publication_id,
      switched_at = p_occurred_at,
      history_event_id = 'publication-history:' || next_sequence,
      transaction_id = p_transaction_id
  where pointer_id = 'ushso:publication:active';
end
$$;

revoke all on all tables in schema ushso_search from public;
revoke all on all functions in schema ushso_search from public;

-- Role grants deliberately fail the later migration review if infrastructure
-- has not provisioned the named roles. The public role gets execute-only access
-- to generation-pinned functions and cannot read the mutable pointer directly.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ushso_public')
     or not exists (select 1 from pg_roles where rolname = 'ushso_projector')
     or not exists (select 1 from pg_roles where rolname = 'ushso_ops')
     or not exists (select 1 from pg_roles where rolname = 'ushso_maintenance')
     or not exists (select 1 from pg_roles where rolname = 'ushso_evaluation_custodian') then
    raise exception 'required USHSO database roles are not provisioned';
  end if;
  grant usage on schema ushso_search to ushso_public, ushso_projector, ushso_ops,
    ushso_maintenance, ushso_evaluation_custodian;
  grant execute on function ushso_search.resolve_active_publication() to ushso_public;
  grant execute on function ushso_search.search_candidates(text,text,text,jsonb,integer,bigint,text,text) to ushso_public;
  grant execute on function ushso_search.browse_candidates(text,text,jsonb,integer,text,text) to ushso_public;
  grant execute on function ushso_search.hydrate_exact_revisions(text,text,jsonb) to ushso_public;
  grant select, insert on ushso_search.canonical_revision_manifests,
    ushso_search.canonical_revision_members, ushso_search.reference_inventory,
    ushso_search.projection_generations, ushso_search.generation_state_events,
    ushso_search.projection_documents, ushso_search.projection_document_revisions,
    ushso_search.projection_truth_refs, ushso_search.projection_facets,
    ushso_search.projection_acknowledgements, ushso_search.acknowledgement_documents,
    ushso_search.publication_builds, ushso_search.publication_build_components,
    ushso_search.publication_manifests, ushso_search.publication_components,
    ushso_search.promotion_gates to ushso_projector;
  grant execute on function ushso_search.validate_generation(text,bigint,bigint,bigint,bigint,text,text,timestamptz,text) to ushso_projector;
  grant select on all tables in schema ushso_search to ushso_ops;
  grant insert on ushso_search.retention_audit to ushso_ops;
  grant execute on function ushso_search.promote_publication(text,text,timestamptz) to ushso_ops;
  grant execute on function ushso_search.rollback_publication(text,text,timestamptz) to ushso_ops;
  grant execute on function ushso_search.promotion_gate_evidence_is_bound(text,text,text,timestamptz,text[],jsonb) to ushso_ops;
  grant execute on function ushso_search.safety_revoke_generation(text,text,text,timestamptz) to ushso_ops;
  grant select on ushso_search.projection_generations, ushso_search.publication_pointer,
    ushso_search.publication_components to ushso_maintenance;
  grant execute on function ushso_search.expire_retired_generation(text,text,text,text,timestamptz) to ushso_maintenance;
  grant execute on function ushso_search.consume_final_holdout_lease(jsonb) to ushso_evaluation_custodian;
  grant execute on function ushso_search.complete_final_holdout_lease(text,text,jsonb) to ushso_evaluation_custodian;
end
$$;
