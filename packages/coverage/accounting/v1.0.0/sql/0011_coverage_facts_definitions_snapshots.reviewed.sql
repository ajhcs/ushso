-- 0011: immutable coverage definitions, facts, memberships, snapshots, and matrix.
-- REVIEW STATUS: offline technical review complete for WP9; not applied.
-- SEQUENCE GATE: move into db/migrations only after 0007 through 0010 are sealed
-- and the migration manifest is reviewed. This proposal performs no destructive
-- down migration and grants no direct public access to operations truth.

set local timezone = 'UTC';
set local role ushso_ops_owner;

create table ops.coverage_metric_definitions (
  metric_id text not null,
  metric_version text not null check (metric_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  definition_sha256 text not null check (definition_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null,
  primary key (metric_id, metric_version),
  unique (definition_sha256)
);

create table ops.coverage_source_scope_facts (
  source_scope_id text not null,
  source_scope_revision text not null,
  registry_scope_id text references registry.scopes(scope_id) on delete restrict,
  registry_revision text not null,
  registry_state text not null check (registry_state in ('active', 'paused', 'excluded', 'retired', 'unassessed')),
  authority_level text not null check (authority_level in ('federal', 'state', 'local', 'multi_jurisdiction', 'other')),
  responsible_organization_id text not null,
  connector_id text not null,
  connector_revision text not null,
  connector_configuration_revision text not null,
  jurisdiction_ids text[] not null check (cardinality(jurisdiction_ids) > 0),
  scope_definition jsonb not null check (jsonb_typeof(scope_definition) = 'object'),
  policy_revisions jsonb not null check (jsonb_typeof(policy_revisions) = 'object'),
  enumeration jsonb not null check (jsonb_typeof(enumeration) = 'object'),
  absence_claim_permitted boolean not null,
  absence_reason text check (absence_reason in (
    'enumeration_incomplete', 'denominator_unknown', 'scope_not_assessed',
    'policy_mismatch', 'not_an_absence_metric', 'evidence_insufficient',
    'excluded_or_quarantined', 'unknown_membership'
  )),
  effective_at timestamptz not null,
  recorded_at timestamptz not null,
  source_fact_sha256 text not null check (source_fact_sha256 ~ '^[a-f0-9]{64}$'),
  primary key (source_scope_id, source_scope_revision),
  unique (source_fact_sha256),
  check (recorded_at >= effective_at),
  check (absence_claim_permitted = (absence_reason is null)),
  check (not absence_claim_permitted or (enumeration ->> 'status' = 'complete' and enumeration ->> 'sealed' = 'true'))
);

create index coverage_source_scope_registry_state_idx
  on ops.coverage_source_scope_facts (registry_revision, registry_state, source_scope_id);

create table ops.coverage_stage_facts (
  fact_id text primary key,
  fact_version text not null check (fact_version = '1.0.0'),
  unit text not null check (unit in (
    'connector_scope', 'native_item', 'native_item_revision', 'asset', 'release',
    'distribution', 'family', 'endpoint_check_target', 'scheduled_check_target',
    'checked_target', 'named_layer_unit', 'stage_work_item',
    'scheduled_work_item', 'coverage_assessment_cell'
  )),
  member_namespace text not null,
  member_value text not null,
  stage text not null check (stage in (
    'registry', 'enumeration', 'capture', 'normalization', 'canonical',
    'schema_index', 'search_index', 'access_check', 'freshness', 'pipeline', 'exclusion'
  )),
  outcome text not null,
  source_scope_id text,
  source_scope_revision text,
  run_id text,
  definition_version text not null,
  observed_at timestamptz not null,
  effective_at timestamptz not null,
  revision_pins jsonb not null check (jsonb_typeof(revision_pins) = 'object'),
  axes jsonb not null check (jsonb_typeof(axes) = 'object'),
  evidence_refs jsonb not null check (jsonb_typeof(evidence_refs) = 'array' and jsonb_array_length(evidence_refs) > 0),
  fact_sha256 text not null check (fact_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null,
  unique (unit, member_namespace, member_value, stage, effective_at, fact_sha256),
  unique (fact_sha256),
  check (observed_at >= effective_at),
  check ((source_scope_id is null and source_scope_revision is null) or (source_scope_id is not null and source_scope_revision is not null))
);

create index coverage_stage_facts_scope_stage_time_idx
  on ops.coverage_stage_facts (source_scope_id, stage, effective_at desc, fact_id);
create index coverage_stage_facts_run_stage_idx
  on ops.coverage_stage_facts (run_id, stage, fact_id) where run_id is not null;

create table ops.coverage_membership_manifests (
  membership_manifest_id text primary key,
  metric_id text not null,
  metric_version text not null,
  unit text not null,
  as_of timestamptz not null,
  reporting_window jsonb not null check (jsonb_typeof(reporting_window) = 'object'),
  revision_pins jsonb not null check (jsonb_typeof(revision_pins) = 'object'),
  cohort_filters jsonb not null check (jsonb_typeof(cohort_filters) = 'array'),
  denominator_status text not null check (denominator_status in ('known', 'estimated', 'unknown')),
  enumeration jsonb not null check (jsonb_typeof(enumeration) = 'object'),
  membership jsonb not null check (jsonb_typeof(membership) = 'array'),
  overlap jsonb not null check (jsonb_typeof(overlap) = 'object'),
  membership_manifest_sha256 text not null check (membership_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null,
  unique (membership_manifest_sha256),
  foreign key (metric_id, metric_version)
    references ops.coverage_metric_definitions(metric_id, metric_version) on delete restrict,
  check (
    denominator_status <> 'known'
    or not jsonb_path_exists(membership, '$[*] ? (@.denominator_membership == "unknown")')
  )
);

create index coverage_membership_metric_time_idx
  on ops.coverage_membership_manifests (metric_id, as_of desc, membership_manifest_id);

create table ops.coverage_snapshots (
  coverage_snapshot_id text primary key,
  snapshot_version text not null check (snapshot_version = '1.0.0'),
  as_of timestamptz not null,
  reporting_window jsonb not null check (jsonb_typeof(reporting_window) = 'object'),
  revision_pins jsonb not null check (jsonb_typeof(revision_pins) = 'object'),
  metric_definition_registry_sha256 text not null check (metric_definition_registry_sha256 ~ '^[a-f0-9]{64}$'),
  source_scope_ids text[] not null check (cardinality(source_scope_ids) > 0),
  stage_fact_ids text[] not null check (cardinality(stage_fact_ids) > 0),
  matrix_id text not null,
  public_positioning text not null,
  supersedes_snapshot_id text references ops.coverage_snapshots(coverage_snapshot_id) on delete restrict,
  canonical_digest text not null check (canonical_digest ~ '^[a-f0-9]{64}$'),
  sealed boolean not null check (sealed),
  sealed_at timestamptz not null,
  build_receipt_ref text not null,
  unique (canonical_digest),
  check (sealed_at >= as_of),
  check (supersedes_snapshot_id is null or supersedes_snapshot_id <> coverage_snapshot_id)
);

create table ops.coverage_snapshot_metrics (
  coverage_snapshot_id text not null references ops.coverage_snapshots(coverage_snapshot_id) on delete restrict,
  metric_instance_id text not null,
  metric_id text not null,
  metric_version text not null,
  unit text not null,
  numerator_count bigint not null check (numerator_count >= 0),
  denominator_count bigint check (denominator_count >= 0),
  denominator_status text not null check (denominator_status in ('known', 'estimated', 'unknown')),
  rate numeric,
  unknown_count bigint not null check (unknown_count >= 0),
  not_applicable_count bigint not null check (not_applicable_count >= 0),
  excluded_count bigint not null check (excluded_count >= 0),
  unclassified_count bigint not null check (unclassified_count >= 0),
  numerator_definition_version text not null,
  denominator_definition text not null,
  denominator_definition_version text,
  as_of timestamptz not null,
  reporting_window jsonb not null check (jsonb_typeof(reporting_window) = 'object'),
  revision_pins jsonb not null check (jsonb_typeof(revision_pins) = 'object'),
  cohort_filters jsonb not null check (jsonb_typeof(cohort_filters) = 'array'),
  membership_manifest_id text not null references ops.coverage_membership_manifests(membership_manifest_id) on delete restrict,
  membership_manifest_sha256 text not null check (membership_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  partition_counts jsonb check (partition_counts is null or jsonb_typeof(partition_counts) = 'array'),
  overlap jsonb not null check (jsonb_typeof(overlap) = 'object'),
  absence_claim_permitted boolean not null,
  absence_reason text check (absence_reason in (
    'enumeration_incomplete', 'denominator_unknown', 'scope_not_assessed',
    'policy_mismatch', 'not_an_absence_metric', 'evidence_insufficient',
    'excluded_or_quarantined', 'unknown_membership'
  )),
  partial_enumeration_label text check (partial_enumeration_label is null or partial_enumeration_label = 'observed_processing_yield'),
  display jsonb not null check (jsonb_typeof(display) = 'object'),
  primary key (coverage_snapshot_id, metric_instance_id),
  unique (coverage_snapshot_id, metric_id),
  foreign key (metric_id, metric_version)
    references ops.coverage_metric_definitions(metric_id, metric_version) on delete restrict,
  check (absence_claim_permitted = (absence_reason is null)),
  check (
    (denominator_status = 'known' and denominator_count is not null)
    or (denominator_status = 'estimated' and denominator_count is not null and rate is null)
    or (denominator_status = 'unknown' and denominator_count is null and rate is null)
  ),
  check (denominator_status <> 'known' or numerator_count <= denominator_count),
  check (denominator_count is distinct from 0 or rate is null),
  check (rate is null or (rate between 0 and 1 and denominator_status = 'known' and denominator_count > 0)),
  check (rate is null or rate = numerator_count::numeric / denominator_count::numeric)
);

create index coverage_snapshot_metrics_lookup_idx
  on ops.coverage_snapshot_metrics (metric_id, as_of desc, coverage_snapshot_id);

create table ops.coverage_source_classes (
  source_class_id text not null,
  source_class_revision text not null,
  label text not null,
  definition text not null,
  recorded_at timestamptz not null,
  primary key (source_class_id, source_class_revision)
);

create table ops.coverage_matrix_cells (
  coverage_snapshot_id text not null references ops.coverage_snapshots(coverage_snapshot_id) on delete restrict,
  cell_id text not null,
  jurisdiction_id text not null,
  jurisdiction_type text not null check (jurisdiction_type in ('federal', 'state', 'district', 'territory', 'multi')),
  source_class_id text not null,
  source_class_revision text not null,
  authority_level text not null check (authority_level in ('federal', 'state', 'local', 'multi_jurisdiction', 'other')),
  agency_operator_status text not null check (agency_operator_status in ('identified', 'not_identified')),
  agency_operator_id text,
  agency_operator_name text,
  denominator_type text not null check (denominator_type = 'coverage_assessment_cell'),
  coverage_cell_state text not null check (coverage_cell_state in (
    'integrated', 'candidate', 'navigation_only', 'evidence_gap',
    'inaccessible', 'unknown', 'not_assessed'
  )),
  state_definition_version text not null check (state_definition_version = 'coverage-cell-state/v1'),
  registry_revision text not null,
  source_scope_revision text not null,
  policy_revision text not null,
  assessed_at timestamptz not null,
  evidence_refs jsonb not null check (jsonb_typeof(evidence_refs) = 'array' and jsonb_array_length(evidence_refs) > 0),
  last_enumeration jsonb check (last_enumeration is null or jsonb_typeof(last_enumeration) = 'object'),
  next_action text not null,
  overlap jsonb not null check (jsonb_typeof(overlap) = 'object'),
  absence_claim_permitted boolean not null,
  absence_reason text check (absence_reason in (
    'enumeration_incomplete', 'denominator_unknown', 'scope_not_assessed',
    'policy_mismatch', 'not_an_absence_metric', 'evidence_insufficient',
    'excluded_or_quarantined', 'unknown_membership'
  )),
  recorded_at timestamptz not null,
  primary key (coverage_snapshot_id, cell_id),
  unique (coverage_snapshot_id, jurisdiction_id, source_class_id),
  foreign key (source_class_id, source_class_revision)
    references ops.coverage_source_classes(source_class_id, source_class_revision) on delete restrict,
  check (
    (agency_operator_status = 'identified' and agency_operator_id is not null and agency_operator_name is not null)
    or (agency_operator_status = 'not_identified' and agency_operator_id is null and agency_operator_name is null)
  ),
  check (absence_claim_permitted = (absence_reason is null)),
  check (coverage_cell_state = 'integrated' or not absence_claim_permitted),
  check (last_enumeration is null or last_enumeration ->> 'status' in ('complete', 'incomplete', 'failed')),
  check (last_enumeration is null or last_enumeration ->> 'status' <> 'complete' or last_enumeration ->> 'sealed' = 'true')
);

create index coverage_matrix_cells_state_idx
  on ops.coverage_matrix_cells (coverage_snapshot_id, coverage_cell_state, jurisdiction_id, source_class_id);

create view ops.coverage_snapshot_metric_view as
select
  snapshot.coverage_snapshot_id,
  snapshot.canonical_digest as coverage_snapshot_digest,
  snapshot.as_of,
  snapshot.revision_pins,
  metric.metric_instance_id,
  metric.metric_id,
  metric.unit,
  metric.numerator_count,
  metric.denominator_count,
  metric.denominator_status,
  metric.denominator_definition,
  metric.rate,
  metric.unknown_count,
  metric.not_applicable_count,
  metric.excluded_count,
  metric.unclassified_count,
  metric.membership_manifest_sha256,
  metric.partition_counts,
  metric.overlap,
  metric.absence_claim_permitted,
  metric.absence_reason,
  metric.display
from ops.coverage_snapshots snapshot
join ops.coverage_snapshot_metrics metric using (coverage_snapshot_id)
where snapshot.sealed;

create view ops.coverage_matrix_cell_view as
select
  snapshot.coverage_snapshot_id,
  snapshot.canonical_digest as coverage_snapshot_digest,
  snapshot.as_of,
  cell.cell_id,
  cell.jurisdiction_id,
  cell.jurisdiction_type,
  cell.source_class_id,
  source_class.label as source_class_label,
  cell.agency_operator_status,
  cell.agency_operator_id,
  cell.agency_operator_name,
  cell.denominator_type,
  cell.coverage_cell_state,
  cell.evidence_refs,
  cell.last_enumeration,
  cell.next_action,
  cell.overlap,
  cell.absence_claim_permitted,
  cell.absence_reason
from ops.coverage_snapshots snapshot
join ops.coverage_matrix_cells cell using (coverage_snapshot_id)
join ops.coverage_source_classes source_class
  on source_class.source_class_id = cell.source_class_id
 and source_class.source_class_revision = cell.source_class_revision
where snapshot.sealed;

create trigger coverage_metric_definitions_append_only
before update or delete on ops.coverage_metric_definitions
for each statement execute function ops.reject_history_mutation();
create trigger coverage_source_scope_facts_append_only
before update or delete on ops.coverage_source_scope_facts
for each statement execute function ops.reject_history_mutation();
create trigger coverage_stage_facts_append_only
before update or delete on ops.coverage_stage_facts
for each statement execute function ops.reject_history_mutation();
create trigger coverage_membership_manifests_append_only
before update or delete on ops.coverage_membership_manifests
for each statement execute function ops.reject_history_mutation();
create trigger coverage_snapshots_append_only
before update or delete on ops.coverage_snapshots
for each statement execute function ops.reject_history_mutation();
create trigger coverage_snapshot_metrics_append_only
before update or delete on ops.coverage_snapshot_metrics
for each statement execute function ops.reject_history_mutation();
create trigger coverage_source_classes_append_only
before update or delete on ops.coverage_source_classes
for each statement execute function ops.reject_history_mutation();
create trigger coverage_matrix_cells_append_only
before update or delete on ops.coverage_matrix_cells
for each statement execute function ops.reject_history_mutation();

reset role;

grant select on
  ops.coverage_metric_definitions,
  ops.coverage_source_scope_facts,
  ops.coverage_stage_facts,
  ops.coverage_membership_manifests,
  ops.coverage_snapshots,
  ops.coverage_snapshot_metrics,
  ops.coverage_source_classes,
  ops.coverage_matrix_cells,
  ops.coverage_snapshot_metric_view,
  ops.coverage_matrix_cell_view
to ushso_projector, ushso_ops;

grant insert on
  ops.coverage_stage_facts,
  ops.coverage_membership_manifests,
  ops.coverage_snapshots,
  ops.coverage_snapshot_metrics,
  ops.coverage_matrix_cells
to ushso_projector;

revoke all on
  ops.coverage_metric_definitions,
  ops.coverage_source_scope_facts,
  ops.coverage_stage_facts,
  ops.coverage_membership_manifests,
  ops.coverage_snapshots,
  ops.coverage_snapshot_metrics,
  ops.coverage_source_classes,
  ops.coverage_matrix_cells,
  ops.coverage_snapshot_metric_view,
  ops.coverage_matrix_cell_view
from ushso_public, ushso_scheduler, ushso_harvest, ushso_normalize;
