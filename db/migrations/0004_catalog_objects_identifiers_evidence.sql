-- 0004: canonical object/revision envelope, immutable identifiers and aliases,
-- evidence lineage, and auditable normalization import batches.
-- Forward-only. Batch rollback changes eligibility; it never deletes truth.

set local timezone = 'UTC';

grant usage on schema ops to ushso_catalog_owner;
grant execute on function ops.reject_history_mutation(), ops.touch_updated_at()
  to ushso_catalog_owner;

set local role ushso_catalog_owner;

create table catalog.import_batches (
  import_id text primary key check (import_id ~ '^urn:ushso:import:[A-Za-z0-9._~-]+$'),
  contract_version text not null check (contract_version = 'ushso-normalization-import.v1.0.0'),
  source_corpus_version text not null check (source_corpus_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  source_manifest_file_sha256 text not null check (source_manifest_file_sha256 ~ '^[a-f0-9]{64}$'),
  source_content_fingerprint text not null check (source_content_fingerprint ~ '^[a-f0-9]{64}$'),
  document_fingerprint text not null check (document_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  normalizer_name text not null check (normalizer_name ~ '^[a-z][a-z0-9-]{1,79}$'),
  normalizer_version text not null check (normalizer_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  state text not null check (state in ('prepared', 'applied', 'rejected')),
  projection_eligible boolean not null default false,
  plan_payload jsonb not null check (jsonb_typeof(plan_payload) = 'object'),
  expected_record_count integer not null check (expected_record_count >= 0),
  expected_search_document_count integer not null check (expected_search_document_count >= 0),
  expected_join_route_count integer not null check (expected_join_route_count >= 0),
  canonical_revision_count integer,
  created_at timestamptz not null,
  applied_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  rejection_audit_event_id text,
  rejection_audit_event_occurred_at timestamptz,
  check ((state = 'prepared') = (applied_at is null and rejected_at is null)),
  check ((state = 'applied') = (applied_at is not null and rejected_at is null)),
  check ((state = 'rejected') = (rejected_at is not null and rejection_reason is not null and rejection_audit_event_id is not null and rejection_audit_event_occurred_at is not null)),
  check (projection_eligible = (state = 'applied')),
  unique (source_corpus_version, source_content_fingerprint, normalizer_name, normalizer_version)
);

-- An import authority is a maintenance-owned, append-only trust anchor for one
-- exact deterministic normalizer result.  The Worker may submit the document,
-- but it cannot mint or alter the fingerprints against which 0007 verifies it.
create table catalog.normalization_import_authorities (
  authority_id text primary key check (authority_id ~ '^[a-z][a-z0-9._:@-]{7,159}$'),
  contract_version text not null,
  plan_version text not null,
  import_id text not null unique,
  source_corpus_version text not null,
  source_manifest_file_sha256 text not null check (source_manifest_file_sha256 ~ '^[a-f0-9]{64}$'),
  source_content_fingerprint text not null check (source_content_fingerprint ~ '^[a-f0-9]{64}$'),
  source_records_file_sha256 text not null check (source_records_file_sha256 ~ '^[a-f0-9]{64}$'),
  source_search_documents_file_sha256 text not null check (source_search_documents_file_sha256 ~ '^[a-f0-9]{64}$'),
  source_join_routes_file_sha256 text not null check (source_join_routes_file_sha256 ~ '^[a-f0-9]{64}$'),
  normalizer_name text not null,
  normalizer_version text not null,
  expected_record_count integer not null check (expected_record_count >= 0),
  expected_search_document_count integer not null check (expected_search_document_count >= 0),
  expected_join_route_count integer not null check (expected_join_route_count >= 0),
  expected_canonical_counts jsonb not null check (jsonb_typeof(expected_canonical_counts) = 'object'),
  bundle_fingerprint text not null check (bundle_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  projection_fingerprint text not null check (projection_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  document_fingerprint text not null unique check (document_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  canonicalization_version text not null check (canonicalization_version = 'ushso-canonical-json-v1'),
  authorized_at timestamptz not null,
  rationale text not null check (length(rationale) between 10 and 1000)
);

insert into catalog.normalization_import_authorities (
  authority_id, contract_version, plan_version, import_id,
  source_corpus_version, source_manifest_file_sha256, source_content_fingerprint,
  source_records_file_sha256, source_search_documents_file_sha256,
  source_join_routes_file_sha256, normalizer_name, normalizer_version,
  expected_record_count, expected_search_document_count, expected_join_route_count,
  expected_canonical_counts, bundle_fingerprint, projection_fingerprint,
  document_fingerprint, canonicalization_version, authorized_at, rationale
) values (
  'legacy-v1.1.0:legacy-corpus-normalizer@1.0.0',
  'ushso-normalization-import.v1.0.0',
  'ushso-normalization-import-plan.v1.0.0',
  'urn:ushso:import:0a00fe54b027f45b336d3900f3d0727c0465b3eb',
  '1.1.0',
  '23f704ce3e421a6eb26c2b3677d616a1ae6b4f45226233257b9a1ff676caba2b',
  'adcfb56babc981a4c7dfc787af86d56f5fb2a31e84de02f9db8c93f0548b5d03',
  '458c8e7ec15e059e60bc908fc98f6b94f8deafd9bd1862d1dc0b576ac830f046',
  '8c7913596353d4ea2c6f5b763d3711aa77d97a457bb91b4cbce990bbf301e633',
  'f712c73fdfb78cf95c7ce29c68819c353a2ae2192a6feef78b8e6da38db4a0dc',
  'legacy-corpus-normalizer', '1.0.0', 157, 157, 14,
  '{"organizations":21,"sources":157,"assets":157,"releases":157,"distributions":157,"documentation":157,"schema_snapshots":28,"schema_fields":28,"access_routes":157,"access_observations":157,"evidence":361,"assertions":157,"relationships":300}'::jsonb,
  'sha256:37931f669b451e78e7153cacab5902be8ee5842c4d5807659abc14a30964a7f7',
  'sha256:86a0c5aedba4f3e7f2ae705148c747461d7d94d254c22ab9a1ff15f97d33ab3c',
  'sha256:ae12718d3d68605534e9275230e2b1d32f3afa082939e7e64ec51dccec3b1b9d',
  'ushso-canonical-json-v1', '2026-08-30T18:15:36.295Z',
  'Exact offline production v1.1.0 legacy corpus normalized by the reviewed deterministic WP6 implementation.'
);

create trigger normalization_import_authorities_append_only
before update or delete on catalog.normalization_import_authorities
for each statement execute function ops.reject_history_mutation();

create table catalog.import_batch_events (
  import_batch_event_id bigint generated always as identity primary key,
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  from_state text check (from_state is null or from_state in ('prepared', 'applied', 'rejected')),
  to_state text not null check (to_state in ('prepared', 'applied', 'rejected')),
  reason text not null check (length(reason) between 3 and 1000),
  audit_event_id text,
  audit_event_occurred_at timestamptz,
  actor text not null,
  recorded_at timestamptz not null,
  check ((audit_event_id is null) = (audit_event_occurred_at is null)),
  check ((to_state = 'rejected') = (audit_event_id is not null))
);

create index import_batch_events_import_idx
  on catalog.import_batch_events (import_id, recorded_at, import_batch_event_id);

create trigger import_batch_events_append_only
before update or delete on catalog.import_batch_events
for each statement execute function ops.reject_history_mutation();

create function catalog.validate_import_batch_transition()
returns trigger language plpgsql as $function$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'prepared' or new.projection_eligible
       or new.canonical_revision_count is not null or new.applied_at is not null
       or new.rejected_at is not null or new.rejection_reason is not null
       or new.rejection_audit_event_id is not null
       or new.rejection_audit_event_occurred_at is not null then
      raise exception using errcode = '23514', message = 'IMPORT_BATCH_MUST_START_PREPARED';
    end if;
    return new;
  end if;

  if old.import_id is distinct from new.import_id
     or old.contract_version is distinct from new.contract_version
     or old.source_corpus_version is distinct from new.source_corpus_version
     or old.source_manifest_file_sha256 is distinct from new.source_manifest_file_sha256
     or old.source_content_fingerprint is distinct from new.source_content_fingerprint
     or old.document_fingerprint is distinct from new.document_fingerprint
     or old.normalizer_name is distinct from new.normalizer_name
     or old.normalizer_version is distinct from new.normalizer_version
     or old.plan_payload is distinct from new.plan_payload
     or old.expected_record_count is distinct from new.expected_record_count
     or old.expected_search_document_count is distinct from new.expected_search_document_count
     or old.expected_join_route_count is distinct from new.expected_join_route_count
     or old.created_at is distinct from new.created_at then
    raise exception using errcode = '55000', message = 'IMPORT_BATCH_IMMUTABLE_RECEIPT_CHANGED';
  end if;

  if old.state = new.state then
    if new is distinct from old then
      raise exception using errcode = '55000', message = 'IMPORT_BATCH_SAME_STATE_MUTATION';
    end if;
    return new;
  end if;

  if old.state = 'prepared' and new.state = 'applied' then
    if not new.projection_eligible or new.canonical_revision_count is null
       or new.canonical_revision_count < 0 or new.applied_at is null
       or new.rejected_at is not null or new.rejection_reason is not null
       or new.rejection_audit_event_id is not null
       or new.rejection_audit_event_occurred_at is not null then
      raise exception using errcode = '23514', message = 'IMPORT_BATCH_INVALID_APPLY_RECEIPT';
    end if;
    return new;
  end if;

  if old.state in ('prepared', 'applied') and new.state = 'rejected' then
    if new.projection_eligible or new.rejected_at is null
       or length(trim(new.rejection_reason)) < 3
       or length(trim(new.rejection_audit_event_id)) < 3
       or new.rejection_audit_event_occurred_at is null
       or new.canonical_revision_count is distinct from old.canonical_revision_count
       or new.applied_at is distinct from old.applied_at then
      raise exception using errcode = '23514', message = 'IMPORT_BATCH_INVALID_REJECTION_RECEIPT';
    end if;
    return new;
  end if;

  raise exception using errcode = '23514', message = 'IMPORT_BATCH_ILLEGAL_TRANSITION';
end
$function$;

create trigger import_batches_validate_transition
before insert or update on catalog.import_batches
for each row execute function catalog.validate_import_batch_transition();

create table catalog.objects (
  entity_id text primary key check (entity_id ~ '^urn:ushso:[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$'),
  entity_type text not null check (entity_type in (
    'Organization', 'Source', 'Asset', 'Release', 'Distribution', 'Documentation',
    'SchemaSnapshot', 'SchemaField', 'AccessRoute', 'AccessObservation',
    'Evidence', 'Assertion', 'Relationship'
  )),
  first_import_id text not null references catalog.import_batches(import_id) on delete restrict,
  created_at timestamptz not null,
  unique (entity_id, entity_type)
);

create trigger objects_append_only
before update or delete on catalog.objects
for each statement execute function ops.reject_history_mutation();

create table catalog.object_revisions (
  revision_id text primary key check (revision_id ~ '^urn:ushso:revision:[A-Za-z0-9._~-]+$'),
  entity_id text not null references catalog.objects(entity_id) on delete restrict,
  entity_type text not null,
  contract_version text not null check (contract_version = 'observatory-core.v2.0.0'),
  schema_version text not null check (schema_version = '2.0.0'),
  lifecycle_state text not null check (lifecycle_state in ('active', 'inactive', 'pending_review', 'quarantined', 'superseded', 'withdrawn', 'retired', 'excluded', 'unknown')),
  canonical_content_fingerprint text not null check (canonical_content_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  revision_payload jsonb not null check (jsonb_typeof(revision_payload) = 'object'),
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  normalizer_name text not null check (normalizer_name ~ '^[a-z][a-z0-9-]{1,79}$'),
  normalizer_version text not null check (normalizer_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  first_seen_at timestamptz not null,
  observed_at timestamptz not null,
  recorded_at timestamptz not null,
  publisher_released_at timestamptz,
  publisher_modified_at timestamptz,
  superseded_at timestamptz,
  check (first_seen_at <= observed_at and observed_at <= recorded_at),
  check (publisher_released_at is null or publisher_released_at <= observed_at),
  check (publisher_modified_at is null or publisher_modified_at <= observed_at),
  check (superseded_at is null or superseded_at >= recorded_at),
  check ((lifecycle_state = 'superseded') = (superseded_at is not null)),
  foreign key (entity_id, entity_type) references catalog.objects(entity_id, entity_type) on delete restrict,
  unique (entity_id, canonical_content_fingerprint)
);

-- Revisions are immutable facts. Current selection is intentionally not
-- encoded as a mutable lifecycle bit or partial uniqueness constraint; 0007
-- adds an append-only selection ledger plus an audited head pointer.
create index object_revisions_entity_recorded_idx
  on catalog.object_revisions (entity_id, recorded_at desc, revision_id);
create index object_revisions_import_idx on catalog.object_revisions (import_id, entity_type, revision_id);
create index object_revisions_observed_idx on catalog.object_revisions (entity_type, observed_at desc, entity_id);

create trigger object_revisions_append_only
before update or delete on catalog.object_revisions
for each statement execute function ops.reject_history_mutation();

create table catalog.legacy_aliases (
  alias text primary key check (length(alias) between 1 and 240),
  entity_id text not null references catalog.objects(entity_id) on delete restrict,
  first_import_id text not null references catalog.import_batches(import_id) on delete restrict,
  permanent boolean not null check (permanent),
  recorded_at timestamptz not null
);

create index legacy_aliases_entity_idx on catalog.legacy_aliases (entity_id, alias);

create trigger legacy_aliases_append_only
before update or delete on catalog.legacy_aliases
for each statement execute function ops.reject_history_mutation();

create table catalog.native_identifiers (
  native_identifier_id bigint generated always as identity primary key,
  revision_id text not null references catalog.object_revisions(revision_id) on delete restrict,
  entity_id text not null references catalog.objects(entity_id) on delete restrict,
  source_id text not null references catalog.objects(entity_id) on delete restrict,
  namespace text not null check (namespace ~ '^[a-z][a-z0-9._-]{1,79}$'),
  exact_value text not null check (length(exact_value) between 1 and 500),
  normalized_value text,
  case_behavior text not null check (case_behavior in ('sensitive', 'insensitive', 'normalization_defined')),
  preservation text not null check (preservation = 'exact'),
  entity_scope text not null check (entity_scope in ('organization', 'source', 'asset', 'release', 'distribution', 'documentation', 'schema', 'field', 'access_route', 'unknown')),
  authority text not null check (authority in ('source_native', 'authoritative_cross_source', 'legacy_alias')),
  uniqueness_policy text not null check (uniqueness_policy in ('unique', 'reusable_over_time', 'source_scoped', 'unknown')),
  effective_from date,
  effective_to date,
  evidence_ids text[] not null check (cardinality(evidence_ids) > 0),
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  recorded_at timestamptz not null,
  check (effective_to is null or effective_from is null or effective_from <= effective_to),
  unique nulls not distinct (revision_id, source_id, namespace, exact_value, effective_from, effective_to)
);

create index native_identifiers_lookup_idx
  on catalog.native_identifiers (source_id, namespace, normalized_value, effective_from, effective_to);
create index native_identifiers_entity_idx on catalog.native_identifiers (entity_id, namespace);

create trigger native_identifiers_append_only
before update or delete on catalog.native_identifiers
for each statement execute function ops.reject_history_mutation();

create table catalog.evidence (
  evidence_revision_id text primary key references catalog.object_revisions(revision_id) on delete restrict,
  evidence_id text not null references catalog.objects(entity_id) on delete restrict,
  source_id text not null references catalog.objects(entity_id) on delete restrict,
  evidence_class text not null check (evidence_class in ('authoritative_identifier', 'publisher_metadata', 'catalog_record', 'documentation', 'schema_observation', 'access_check', 'review_decision', 'controlled_test', 'external_execution_record')),
  locator text,
  captured_content_digest text check (captured_content_digest is null or captured_content_digest ~ '^sha256:[a-f0-9]{64}$'),
  media_type text,
  availability_state text not null check (availability_state in ('available', 'unavailable', 'restricted', 'stale', 'unknown')),
  description text not null check (length(description) between 1 and 2000),
  payload_included boolean not null check (not payload_included),
  derivation_parent_ids text[] not null,
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  recorded_at timestamptz not null,
  unique (evidence_id, captured_content_digest, evidence_class)
);

-- External lineage parents are identifier-only anchors, never captured source
-- payloads.  Each anchor is deterministically derived from a provenance ID in
-- the fingerprint-bound legacy projection before Evidence rows may reference
-- it.
create table catalog.lineage_anchors (
  anchor_id text primary key check (anchor_id ~ '^urn:ushso:capture-reference:[a-f0-9]{40}$'),
  anchor_type text not null check (anchor_type = 'legacy_provenance_reference'),
  source_reference text not null check (length(source_reference) between 1 and 500),
  first_import_id text not null references catalog.import_batches(import_id) on delete restrict,
  recorded_at timestamptz not null,
  payload_included boolean not null check (not payload_included),
  unique (anchor_type, source_reference)
);

create index lineage_anchors_import_idx on catalog.lineage_anchors (first_import_id, anchor_id);

create trigger lineage_anchors_append_only
before update or delete on catalog.lineage_anchors
for each statement execute function ops.reject_history_mutation();

create index evidence_source_idx on catalog.evidence (source_id, evidence_class, recorded_at desc);
create index evidence_import_idx on catalog.evidence (import_id, evidence_id);

create trigger evidence_append_only
before update or delete on catalog.evidence
for each statement execute function ops.reject_history_mutation();

alter default privileges for role ushso_catalog_owner in schema catalog
  revoke all on tables from public;
alter default privileges for role ushso_catalog_owner in schema catalog
  revoke all on sequences from public;
alter default privileges for role ushso_catalog_owner in schema catalog
  revoke all on functions from public;

reset role;

grant select on catalog.import_batches, catalog.import_batch_events to ushso_normalize;
grant select on catalog.import_batches, catalog.import_batch_events,
  catalog.normalization_import_authorities, catalog.objects,
  catalog.object_revisions, catalog.legacy_aliases, catalog.native_identifiers,
  catalog.evidence, catalog.lineage_anchors to ushso_projector, ushso_ops;
grant usage, select on all sequences in schema catalog to ushso_catalog_owner;

revoke all on all tables in schema catalog from ushso_public, ushso_scheduler, ushso_harvest;
revoke all on all sequences in schema catalog from ushso_public, ushso_scheduler, ushso_harvest;
