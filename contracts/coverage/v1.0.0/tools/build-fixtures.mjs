import path from 'node:path';
import {
  PACKAGE_ROOT,
  canonicalDigest,
  matrixMembershipPayload,
  membershipManifestDigest,
  readJson,
  snapshotDigest,
  writeJson
} from './common.mjs';

const AS_OF = '2026-08-30T12:00:00Z';
const WINDOW = { kind: 'bounded', start: '2026-08-23T00:00:00Z', end: '2026-08-30T00:00:00Z' };
const PINS = {
  registry_revision: { value: 'registry:2026-08-30', not_applicable_reason: null },
  source_scope_revision: { value: 'scope-revision:2026-08-30', not_applicable_reason: null },
  policy_revision: { value: 'policy:coverage:v1', not_applicable_reason: null },
  connector_revision: { value: 'connector:dcat:v1', not_applicable_reason: null },
  connector_configuration_revision: { value: 'connector-config:fixture:v1', not_applicable_reason: null },
  canonical_revision: { value: 'canonical:fixture:v1', not_applicable_reason: null },
  coverage_contract_version: { value: '1.0.0', not_applicable_reason: null },
  index_generation: { value: 'generation:fixture:v1', not_applicable_reason: null }
};
const EVIDENCE = [{
  evidence_id: 'evidence:coverage-fixture',
  revision: 'evidence-revision:v1',
  observed_at: AS_OF
}];
const SCOPE_IDS = [
  'scope:active',
  'scope:paused',
  'scope:excluded',
  'scope:retired',
  'scope:unassessed'
];

function sourceScope(id, state, index) {
  const complete = !['unassessed'].includes(state);
  return {
    source_scope_id: id,
    registry_revision: PINS.registry_revision.value,
    source_scope_revision: PINS.source_scope_revision.value,
    registry_state: state,
    authority_level: index === 0 ? 'federal' : 'state',
    responsible_organization_id: `organization:fixture:${index}`,
    connector_id: 'connector:dcat',
    connector_revision: PINS.connector_revision.value,
    connector_configuration_revision: PINS.connector_configuration_revision.value,
    jurisdiction_ids: [index === 0 ? 'jurisdiction:US' : `jurisdiction:S${index}`],
    scope_definition: {
      counting_unit: 'native_item',
      native_id_namespace: `fixture-native-${index}`,
      bounded_scope: `Fixture coverage scope ${index} bounded to the declared catalog inventory route.`,
      completeness_denominator_definition: null,
      authoritative_total_supported: false
    },
    policy_revisions: {
      inclusion: PINS.policy_revision.value,
      exclusion: PINS.policy_revision.value,
      cadence: PINS.policy_revision.value,
      check: PINS.policy_revision.value
    },
    enumeration: complete
      ? {
          status: 'complete',
          sealed: true,
          membership_revision: `membership:scope:${index}:v1`,
          completed_at: AS_OF,
          failure_class: null
        }
      : {
          status: 'never_started',
          sealed: false,
          membership_revision: null,
          completed_at: null,
          failure_class: null
        },
    absence_claim_permitted: state === 'active',
    absence_reason: state === 'active' ? null : 'scope_not_assessed'
  };
}

function member(unit, value, state, inNumerator, denominatorMembership = 'included', options = {}) {
  const policyDecision = state === 'excluded'
    ? {
        policy_revision: PINS.policy_revision.value,
        reason_code: 'fixture:explicit-exclusion',
        decided_at: AS_OF
      }
    : null;
  return {
    member_key: { unit, namespace: `fixture:${unit}`, value },
    source_scope_id: options.source_scope_id ?? SCOPE_IDS[0],
    in_numerator: inNumerator,
    denominator_membership: denominatorMembership,
    state,
    unclassified_dimensions: options.unclassified_dimensions ?? [],
    policy_decision: options.policy_decision ?? policyDecision,
    overlap_group_ids: options.overlap_group_ids ?? [],
    evidence_refs: EVIDENCE
  };
}

function membersFor(definition) {
  const id = definition.metric_id;
  const unit = definition.allowed_units[0];
  if (id === 'coverage.configured_scope_status/v1') {
    return ['active', 'paused', 'excluded', 'retired', 'unassessed'].map((state, index) => member(unit, SCOPE_IDS[index], state, true, 'included', { source_scope_id: SCOPE_IDS[index] }));
  }
  if (id === 'coverage.normalized_outcome/v1') {
    return ['normalized', 'pending', 'failed', 'excluded', 'not_applicable', 'unknown']
      .map((state, index) => member(unit, `native-revision:${index}`, state, state === 'normalized'));
  }
  if (id === 'coverage.discovered_inventory/v1') {
    return [
      member(unit, 'native:item:1', 'observed', true, 'unknown', { overlap_group_ids: ['overlap:aggregator-member'] }),
      member(unit, 'native:item:2', 'observed', true, 'unknown', { overlap_group_ids: ['overlap:aggregator-member'] })
    ];
  }
  const stateByMetric = {
    'coverage.harvest_completion/v1': 'complete',
    'coverage.revision_ingestion/v1': 'captured',
    'coverage.canonical_assets/v1': 'included',
    'coverage.canonical_releases/v1': 'included',
    'coverage.canonical_families/v1': 'included',
    'coverage.schema_indexed/v1': 'indexed',
    'coverage.search_indexed/v1': 'indexed',
    'coverage.current_check_coverage/v1': 'current',
    'coverage.due_check_timeliness/v1': 'due',
    'coverage.check_pass/v1': 'passed',
    'coverage.stale/v1': 'stale',
    'coverage.failed/v1': 'terminal',
    'coverage.overdue_not_started/v1': 'overdue',
    'coverage.excluded_native_items/v1': 'excluded',
    'coverage.excluded_canonical_assets/v1': 'excluded'
  };
  const unknownDenominator = definition.kind === 'absolute_count';
  const options = id === 'coverage.revision_ingestion/v1' ? { unclassified_dimensions: ['jurisdiction'] } : {};
  return [member(unit, `${id}:member:1`, stateByMetric[id], true, unknownDenominator ? 'unknown' : 'included', options)];
}

function cohortFilters(definition) {
  if (definition.metric_id !== 'coverage.revision_ingestion/v1') return [];
  return [{ dimension: 'jurisdiction', values: ['jurisdiction:US'], known_at_stage: 'capture', unclassified_count: 1 }];
}

function enumerationFor(definition) {
  if (['coverage.harvest_completion/v1', 'coverage.discovered_inventory/v1', 'coverage.revision_ingestion/v1', 'coverage.normalized_outcome/v1'].includes(definition.metric_id)) {
    return {
      status: 'complete',
      sealed: true,
      run_ids: ['run:fixture:v1'],
      membership_revision: `membership:${definition.metric_id}:v1`,
      source_reported_total_admissible: false
    };
  }
  return {
    status: 'not_applicable',
    sealed: false,
    run_ids: [],
    membership_revision: null,
    source_reported_total_admissible: false
  };
}

function overlapFor(definition) {
  if (definition.metric_id === 'coverage.discovered_inventory/v1') {
    return {
      can_overlap: true,
      additive: false,
      overlap_group_ids: ['overlap:aggregator-member'],
      note: 'Aggregator and member-source cohorts overlap and their displayed totals are non-additive.'
    };
  }
  return {
    can_overlap: false,
    additive: true,
    overlap_group_ids: [],
    note: 'This fixture metric instance is a single typed cohort with no disclosed overlap.'
  };
}

function buildManifest(definition) {
  const denominatorStatus = definition.kind === 'absolute_count' || definition.metric_id === 'coverage.discovered_inventory/v1' ? 'unknown' : 'known';
  return {
    manifest_id: `membership:${definition.metric_id}`,
    manifest_version: '1.0.0',
    metric_id: definition.metric_id,
    metric_version: definition.metric_version,
    unit: definition.allowed_units[0],
    as_of: AS_OF,
    reporting_window: WINDOW,
    revision_pins: PINS,
    cohort_filters: cohortFilters(definition),
    numerator_definition_version: definition.numerator_definition_version,
    denominator_definition_version: definition.denominator_definition_version,
    denominator_status: denominatorStatus,
    estimate_assertion: null,
    enumeration: enumerationFor(definition),
    members: membersFor(definition),
    overlap: overlapFor(definition)
  };
}

function buildMetric(definition, manifest) {
  const numeratorCount = manifest.members.filter(item => item.in_numerator).length;
  const denominatorCount = manifest.denominator_status === 'known'
    ? manifest.members.filter(item => item.denominator_membership === 'included').length
    : null;
  const partitionCounts = definition.partition
    ? definition.partition.states.map(state => ({
        state,
        count: manifest.members.filter(item => item.denominator_membership === 'included' && item.state === state).length
      }))
    : null;
  const absencePermitted = definition.metric_id === 'coverage.search_indexed/v1';
  const rate = denominatorCount === null || denominatorCount === 0 ? null : numeratorCount / denominatorCount;
  const nOfD = denominatorCount === null
    ? `${numeratorCount} observed; denominator ${manifest.denominator_status} (${manifest.unit})`
    : `${numeratorCount} of ${denominatorCount} ${manifest.unit}`;
  return {
    metric_instance_id: `metric-instance:${definition.metric_id}`,
    metric_id: definition.metric_id,
    metric_version: definition.metric_version,
    unit: manifest.unit,
    numerator_count: numeratorCount,
    numerator_definition_version: definition.numerator_definition_version,
    denominator_count: denominatorCount,
    denominator_definition: definition.denominator_definition,
    denominator_definition_version: definition.denominator_definition_version,
    denominator_status: manifest.denominator_status,
    rate,
    estimate_assertion: null,
    unknown_count: manifest.members.filter(item => item.state === 'unknown').length,
    not_applicable_count: manifest.members.filter(item => item.state === 'not_applicable').length,
    excluded_count: manifest.members.filter(item => item.state === 'excluded').length,
    unclassified_count: manifest.members.filter(item => item.state === 'unclassified' || item.unclassified_dimensions.length > 0).length,
    as_of: AS_OF,
    reporting_window: WINDOW,
    revision_pins: PINS,
    cohort_filters: manifest.cohort_filters,
    membership_manifest_id: manifest.manifest_id,
    membership_manifest_hash: membershipManifestDigest(manifest),
    partition_counts: partitionCounts,
    overlap: manifest.overlap,
    parent_partition_metric_instance_id: definition.kind === 'conditional_rate' ? 'metric-instance:coverage.configured_scope_status/v1' : null,
    absence_claim_permitted: absencePermitted,
    absence_reason: absencePermitted ? null : (manifest.denominator_status === 'unknown' ? 'denominator_unknown' : 'not_an_absence_metric'),
    partial_enumeration_label: null,
    display: {
      n_of_d: nOfD,
      unit_label: manifest.unit,
      why_this_denominator: definition.denominator_definition,
      overlap_note: manifest.overlap.note
    }
  };
}

function buildStageFacts(definitions) {
  return definitions.map((definition, index) => ({
    fact_id: `coverage-fact:${index + 1}`,
    fact_version: '1.0.0',
    member_key: {
      unit: definition.allowed_units[0],
      namespace: `fixture:${definition.allowed_units[0]}`,
      value: `fact-member:${index + 1}`
    },
    stage: definition.measured_stage,
    outcome: definition.metric_id === 'coverage.failed/v1' ? 'failed' : 'observed',
    source_scope_id: SCOPE_IDS[0],
    run_id: ['registry', 'canonical'].includes(definition.measured_stage) ? null : 'run:fixture:v1',
    definition_version: definition.numerator_definition_version,
    observed_at: AS_OF,
    effective_at: '2026-08-30T11:59:00Z',
    revision_pins: PINS,
    axes: {
      milestone: definition.measured_stage === 'search_index' ? 'search_indexed' : null,
      inclusion: definition.measured_stage === 'exclusion' ? 'excluded' : null,
      pipeline: definition.metric_id === 'coverage.failed/v1' ? 'dead_letter' : 'healthy',
      freshness: definition.measured_stage === 'freshness' ? 'stale' : null,
      access: definition.measured_stage === 'access_check' ? 'current_pass' : null,
      identity: null
    },
    evidence_refs: EVIDENCE
  }));
}

function buildMatrix(snapshot) {
  const states = ['integrated', 'candidate', 'navigation_only', 'evidence_gap', 'inaccessible', 'unknown', 'not_assessed'];
  const jurisdictions = ['US', 'PA', 'CA', 'TX', 'FL', 'NY', 'AK'];
  const cells = states.map((state, index) => {
    const complete = ['integrated', 'navigation_only', 'inaccessible'].includes(state);
    const failed = state === 'evidence_gap';
    return {
      cell_id: `coverage-cell:${jurisdictions[index]}:hospital-system-data`,
      jurisdiction_id: `jurisdiction:${jurisdictions[index]}`,
      jurisdiction_type: index === 0 ? 'federal' : 'state',
      source_class_id: 'source-class:hospital-system-data',
      authority_level: index === 0 ? 'federal' : 'state',
      coverage_cell_state: state,
      state_definition_version: 'coverage-cell-state/v1',
      registry_revision: PINS.registry_revision.value,
      source_scope_revision: PINS.source_scope_revision.value,
      policy_revision: PINS.policy_revision.value,
      assessed_at: AS_OF,
      evidence_refs: EVIDENCE,
      last_enumeration: complete
        ? { status: 'complete', sealed: true, membership_revision: `matrix-membership:${index}:v1`, completed_at: AS_OF }
        : failed
          ? { status: 'failed', sealed: false, membership_revision: null, completed_at: null }
          : state === 'candidate'
            ? { status: 'incomplete', sealed: false, membership_revision: null, completed_at: null }
            : null,
      next_action: state === 'integrated' ? 'Maintain the connector and refresh policy.' : 'Follow the state-specific assessment and connector onboarding queue.',
      overlap: index === 0
        ? {
            can_overlap: true,
            additive: false,
            overlap_group_ids: ['overlap:multi-jurisdiction'],
            note: 'Federal and state assessment cohorts may describe overlapping source coverage and are not additive.'
          }
        : {
            can_overlap: false,
            additive: true,
            overlap_group_ids: [],
            note: 'This fixture cell has no separately identified overlap group.'
          },
      absence_claim_permitted: state === 'integrated',
      absence_reason: state === 'integrated' ? null : (failed ? 'enumeration_incomplete' : 'scope_not_assessed')
    };
  });
  const matrix = {
    matrix_id: 'coverage-matrix:fixture:v1',
    matrix_version: '1.0.0',
    coverage_snapshot_id: snapshot.coverage_snapshot_id,
    as_of: AS_OF,
    revision_pins: PINS,
    denominator: {
      unit: 'coverage_assessment_cell',
      configured_cell_count: cells.length,
      membership_manifest_hash: '0'.repeat(64),
      definition: 'Every configured jurisdiction and source-class assessment cell under the pinned registry revision.'
    },
    cells
  };
  matrix.denominator.membership_manifest_hash = canonicalDigest('ushso:coverage-membership-manifest:v1\n', matrixMembershipPayload(matrix));
  return matrix;
}

function adversarialCases(valid, definitions) {
  const metricIndex = new Map(valid.snapshot.metrics.map((metric, index) => [metric.metric_id, index]));
  const manifestIndex = new Map(valid.snapshot.membership_manifests.map((manifest, index) => [manifest.metric_id, index]));
  const normalizedManifest = valid.snapshot.membership_manifests[manifestIndex.get('coverage.normalized_outcome/v1')];
  const normalizedExcluded = normalizedManifest.members.findIndex(memberItem => memberItem.state === 'excluded');
  const dueMetric = metricIndex.get('coverage.due_check_timeliness/v1');
  const dueManifest = manifestIndex.get('coverage.due_check_timeliness/v1');
  const discoveredMetric = metricIndex.get('coverage.discovered_inventory/v1');
  const discoveredManifest = manifestIndex.get('coverage.discovered_inventory/v1');
  const harvestMetric = metricIndex.get('coverage.harvest_completion/v1');
  const harvestManifest = manifestIndex.get('coverage.harvest_completion/v1');
  const revisionMetric = metricIndex.get('coverage.revision_ingestion/v1');
  const searchMetric = metricIndex.get('coverage.search_indexed/v1');
  const canonicalAssetsMetric = metricIndex.get('coverage.canonical_assets/v1');
  return {
    fixture_version: '1.0.0',
    cases: [
      {
        id: 'unit-mixing-member-versus-manifest',
        expected_code: 'UNIT_MIXING',
        mutations: [{ operation: 'set', path: '/snapshot/membership_manifests/0/members/0/member_key/unit', value: 'asset' }]
      },
      {
        id: 'denominator-definition-omission',
        expected_code: 'SCHEMA_INVALID',
        mutations: [{ operation: 'delete', path: `/snapshot/metrics/${harvestMetric}/denominator_definition` }]
      },
      {
        id: 'configured-partition-drift',
        expected_code: 'PARTITION_DRIFT',
        mutations: [{ operation: 'set', path: `/snapshot/metrics/${metricIndex.get('coverage.configured_scope_status/v1')}/partition_counts/0/count`, value: 999 }]
      },
      {
        id: 'failed-enumeration-absence-claim',
        expected_code: 'FAILED_ENUMERATION_ABSENCE_CLAIM',
        mutations: [
          { operation: 'set', path: `/snapshot/membership_manifests/${harvestManifest}/enumeration/status`, value: 'failed' },
          { operation: 'set', path: `/snapshot/membership_manifests/${harvestManifest}/enumeration/sealed`, value: false },
          { operation: 'set', path: `/snapshot/metrics/${harvestMetric}/absence_claim_permitted`, value: true },
          { operation: 'set', path: `/snapshot/metrics/${harvestMetric}/absence_reason`, value: null }
        ]
      },
      {
        id: 'upstream-exclusion-laundering',
        expected_code: 'EXCLUSION_LAUNDERING',
        mutations: [{ operation: 'set', path: `/snapshot/membership_manifests/${manifestIndex.get('coverage.normalized_outcome/v1')}/members/${normalizedExcluded}/denominator_membership`, value: 'outside_conditional_cohort' }]
      },
      {
        id: 'overlapping-total-marked-additive',
        expected_code: 'OVERLAPPING_ADDITIVE_TOTAL',
        mutations: [{ operation: 'set', path: `/snapshot/metrics/${discoveredMetric}/overlap/additive`, value: true }]
      },
      {
        id: 'zero-denominator-published-as-percentage',
        expected_code: 'ZERO_DENOMINATOR_PERCENTAGE',
        mutations: [
          { operation: 'set', path: `/snapshot/membership_manifests/${dueManifest}/members/0/denominator_membership`, value: 'outside_conditional_cohort' },
          { operation: 'set', path: `/snapshot/metrics/${dueMetric}/denominator_count`, value: 0 },
          { operation: 'set', path: `/snapshot/metrics/${dueMetric}/rate`, value: 0.5 },
          { operation: 'set', path: `/snapshot/metrics/${dueMetric}/display/n_of_d`, value: '1 of 0 scheduled_check_target' }
        ]
      },
      {
        id: 'stale-policy-pin-mismatch',
        expected_code: 'STALE_POLICY_PIN_MISMATCH',
        mutations: [{ operation: 'set', path: `/snapshot/membership_manifests/${harvestManifest}/revision_pins/policy_revision/value`, value: 'policy:coverage:v0' }]
      },
      {
        id: 'unknown-folded-out-of-partition',
        expected_code: 'UNKNOWN_COUNT_MISMATCH',
        mutations: [{ operation: 'set', path: `/snapshot/metrics/${metricIndex.get('coverage.normalized_outcome/v1')}/unknown_count`, value: 0 }]
      },
      {
        id: 'not-applicable-folded-out-of-partition',
        expected_code: 'NOT_APPLICABLE_COUNT_MISMATCH',
        mutations: [{ operation: 'set', path: `/snapshot/metrics/${metricIndex.get('coverage.normalized_outcome/v1')}/not_applicable_count`, value: 0 }]
      },
      {
        id: 'unclassified-member-disappears',
        expected_code: 'UNCLASSIFIED_COUNT_MISMATCH',
        mutations: [{ operation: 'set', path: `/snapshot/metrics/${revisionMetric}/unclassified_count`, value: 0 }]
      },
      {
        id: 'membership-manifest-digest-does-not-resolve',
        expected_code: 'MEMBERSHIP_MANIFEST_DIGEST_MISMATCH',
        mutations: [{ operation: 'set', path: `/snapshot/metrics/${harvestMetric}/membership_manifest_hash`, value: '0'.repeat(64) }]
      },
      {
        id: 'duplicate-membership-key',
        expected_code: 'DUPLICATE_MEMBER_KEY',
        mutations: [{ operation: 'append', path: `/snapshot/membership_manifests/${harvestManifest}/members`, value: valid.snapshot.membership_manifests[harvestManifest].members[0] }]
      },
      {
        id: 'downstream-filter-applied-upstream',
        expected_code: 'COHORT_FILTER_STAGE_OVERCLAIM',
        mutations: [
          { operation: 'set', path: `/snapshot/metrics/${harvestMetric}/cohort_filters`, value: [{ dimension: 'identity_state', values: ['resolved'], known_at_stage: 'enumeration', unclassified_count: 0 }] },
          { operation: 'set', path: `/snapshot/membership_manifests/${harvestManifest}/cohort_filters`, value: [{ dimension: 'identity_state', values: ['resolved'], known_at_stage: 'enumeration', unclassified_count: 0 }] }
        ]
      },
      {
        id: 'source-scope-failure-claims-absence',
        expected_code: 'FAILED_ENUMERATION_ABSENCE_CLAIM',
        mutations: [
          { operation: 'set', path: '/source_scopes/0/enumeration/status', value: 'failed' },
          { operation: 'set', path: '/source_scopes/0/enumeration/sealed', value: false },
          { operation: 'set', path: '/source_scopes/0/enumeration/membership_revision', value: null },
          { operation: 'set', path: '/source_scopes/0/enumeration/completed_at', value: null },
          { operation: 'set', path: '/source_scopes/0/enumeration/failure_class', value: 'network_failure' }
        ]
      },
      {
        id: 'eighth-coverage-cell-state',
        expected_code: 'SCHEMA_INVALID',
        mutations: [{ operation: 'set', path: '/matrix/cells/0/coverage_cell_state', value: 'partially_integrated' }]
      },
      {
        id: 'matrix-failed-enumeration-claims-absence',
        expected_code: 'FAILED_ENUMERATION_ABSENCE_CLAIM',
        mutations: [
          { operation: 'set', path: '/matrix/cells/1/absence_claim_permitted', value: true },
          { operation: 'set', path: '/matrix/cells/1/absence_reason', value: null }
        ]
      },
      {
        id: 'matrix-overlap-marked-additive',
        expected_code: 'OVERLAPPING_ADDITIVE_TOTAL',
        mutations: [{ operation: 'set', path: '/matrix/cells/0/overlap/additive', value: true }]
      },
      {
        id: 'excluded-member-lacks-policy-evidence',
        expected_code: 'EXCLUSION_POLICY_EVIDENCE_MISSING',
        mutations: [{ operation: 'set', path: `/snapshot/membership_manifests/${manifestIndex.get('coverage.normalized_outcome/v1')}/members/${normalizedExcluded}/policy_decision`, value: null }]
      },
      {
        id: 'search-absence-lacks-generation-pin',
        expected_code: 'REQUIRED_REVISION_PIN_MISSING',
        mutations: [
          { operation: 'set', path: `/snapshot/metrics/${searchMetric}/revision_pins/index_generation`, value: { value: null, not_applicable_reason: 'Generation intentionally removed by adversarial fixture.' } },
          { operation: 'set', path: `/snapshot/membership_manifests/${manifestIndex.get('coverage.search_indexed/v1')}/revision_pins/index_generation`, value: { value: null, not_applicable_reason: 'Generation intentionally removed by adversarial fixture.' } }
        ]
      },
      {
        id: 'absolute-count-invents-rate',
        expected_code: 'RATE_WITHOUT_DENOMINATOR',
        mutations: [{ operation: 'set', path: `/snapshot/metrics/${canonicalAssetsMetric}/rate`, value: 1 }]
      },
      {
        id: 'estimated-denominator-lacks-evidence',
        expected_code: 'ESTIMATE_ASSERTION_MISSING',
        mutations: [
          { operation: 'set', path: `/snapshot/metrics/${discoveredMetric}/denominator_status`, value: 'estimated' },
          { operation: 'set', path: `/snapshot/metrics/${discoveredMetric}/denominator_count`, value: 20 },
          { operation: 'set', path: `/snapshot/metrics/${discoveredMetric}/display/n_of_d`, value: '2 observed; denominator estimated (native_item)' },
          { operation: 'set', path: `/snapshot/membership_manifests/${discoveredManifest}/denominator_status`, value: 'estimated' }
        ]
      },
      {
        id: 'partition-member-has-unclassified-state',
        expected_code: 'PARTITION_STATE_INVALID',
        mutations: [{ operation: 'set', path: '/snapshot/membership_manifests/0/members/0/state', value: 'included' }]
      }
    ]
  };
}

const definitionsDocument = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'metric-definitions.json'));
const definitions = definitionsDocument.definitions;
const manifests = definitions.map(buildManifest);
const metrics = definitions.map((definition, index) => buildMetric(definition, manifests[index]));
const sourceScopes = ['active', 'paused', 'excluded', 'retired', 'unassessed'].map((state, index) => sourceScope(SCOPE_IDS[index], state, index));
const stageFacts = buildStageFacts(definitions);
const snapshot = {
  coverage_snapshot_id: 'coverage-snapshot:fixture:v1',
  snapshot_version: '1.0.0',
  as_of: AS_OF,
  reporting_window: WINDOW,
  revision_pins: PINS,
  metric_definition_registry_hash: canonicalDigest('ushso:canonical-json:v1\n', definitionsDocument),
  source_scope_ids: sourceScopes.map(scope => scope.source_scope_id),
  stage_fact_ids: stageFacts.map(fact => fact.fact_id),
  membership_manifests: manifests,
  metrics,
  matrix_id: 'coverage-matrix:fixture:v1',
  public_positioning: '14-source, live-metadata-validated federal baseline plus selected state coverage',
  immutability: {
    sealed: true,
    supersedes_snapshot_id: null,
    digest_algorithm: 'coverage_snapshot_sha256/v1',
    canonical_digest: '0'.repeat(64)
  }
};
snapshot.immutability.canonical_digest = snapshotDigest(snapshot);
const fixture = {
  fixture_version: '1.0.0',
  source_scopes: sourceScopes,
  stage_facts: stageFacts,
  snapshot,
  matrix: buildMatrix(snapshot)
};

await writeJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-package.json'), fixture);
await writeJson(path.join(PACKAGE_ROOT, 'fixtures', 'adversarial-cases.json'), adversarialCases(fixture, definitions));
process.stdout.write(`Built coverage fixtures: ${definitions.length} metrics, ${fixture.matrix.cells.length} matrix cells.\n`);
