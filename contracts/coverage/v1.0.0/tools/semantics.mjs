import {
  canonicalDigest,
  canonicalJson,
  matrixMembershipPayload,
  membershipManifestDigest,
  snapshotDigest,
  stableEqual
} from './common.mjs';

export const CANONICAL_COVERAGE_CELL_STATES = [
  'integrated',
  'candidate',
  'navigation_only',
  'evidence_gap',
  'inaccessible',
  'unknown',
  'not_assessed'
];

const EXPECTED_METRICS = new Map([
  ['coverage.configured_scope_status/v1', { units: ['connector_scope'], kind: 'partition', stage: 'registry' }],
  ['coverage.harvest_completion/v1', { units: ['connector_scope'], kind: 'conditional_rate', stage: 'enumeration' }],
  ['coverage.discovered_inventory/v1', { units: ['native_item'], kind: 'absolute_or_authoritative_total', stage: 'enumeration' }],
  ['coverage.revision_ingestion/v1', { units: ['native_item_revision'], kind: 'rate', stage: 'capture' }],
  ['coverage.normalized_outcome/v1', { units: ['native_item_revision'], kind: 'partition', stage: 'normalization' }],
  ['coverage.canonical_assets/v1', { units: ['asset'], kind: 'absolute_count', stage: 'canonical' }],
  ['coverage.canonical_releases/v1', { units: ['release'], kind: 'absolute_count', stage: 'canonical' }],
  ['coverage.canonical_families/v1', { units: ['family'], kind: 'absolute_count', stage: 'canonical' }],
  ['coverage.schema_indexed/v1', { units: ['release', 'distribution'], kind: 'rate', stage: 'schema_index' }],
  ['coverage.search_indexed/v1', { units: ['asset'], kind: 'rate', stage: 'search_index' }],
  ['coverage.current_check_coverage/v1', { units: ['endpoint_check_target'], kind: 'rate', stage: 'access_check' }],
  ['coverage.due_check_timeliness/v1', { units: ['scheduled_check_target'], kind: 'conditional_rate', stage: 'access_check' }],
  ['coverage.check_pass/v1', { units: ['checked_target'], kind: 'rate', stage: 'access_check' }],
  ['coverage.stale/v1', { units: ['named_layer_unit'], kind: 'rate', stage: 'freshness' }],
  ['coverage.failed/v1', { units: ['stage_work_item'], kind: 'rate', stage: 'pipeline' }],
  ['coverage.overdue_not_started/v1', { units: ['scheduled_work_item'], kind: 'conditional_rate', stage: 'pipeline' }],
  ['coverage.excluded_native_items/v1', { units: ['native_item'], kind: 'rate', stage: 'exclusion' }],
  ['coverage.excluded_canonical_assets/v1', { units: ['asset'], kind: 'rate', stage: 'exclusion' }]
]);

const EXPECTED_PARTITIONS = new Map([
  ['coverage.configured_scope_status/v1', {
    states: ['active', 'paused', 'excluded', 'retired', 'unassessed'],
    equation: 'active + paused + excluded + retired + unassessed = configured',
    numeratorStates: ['active', 'paused', 'excluded', 'retired', 'unassessed']
  }],
  ['coverage.normalized_outcome/v1', {
    states: ['normalized', 'pending', 'failed', 'excluded', 'not_applicable', 'unknown'],
    equation: 'normalized + pending + failed + excluded + not_applicable + unknown = ingested',
    numeratorStates: ['normalized']
  }]
]);

const EXPECTED_DIGESTS = new Map([
  ['package_file_bytes_sha256/v1', { input: 'exact_file_bytes', domainSeparator: '', exclusions: [] }],
  ['canonical_json_sha256/v1', { input: 'ushso_canonical_json_v1', domainSeparator: 'ushso:canonical-json:v1\n', exclusions: [] }],
  ['coverage_membership_manifest_sha256/v1', { input: 'ushso_canonical_json_v1', domainSeparator: 'ushso:coverage-membership-manifest:v1\n', exclusions: [] }],
  ['coverage_snapshot_sha256/v1', { input: 'ushso_canonical_json_v1', domainSeparator: 'ushso:coverage-snapshot:v1\n', exclusions: ['/immutability/canonical_digest'] }]
]);

function push(errors, code, path, detail) {
  errors.push({ code, path, detail });
}

function unique(values) {
  return new Set(values).size === values.length;
}

function pinValue(pins, key) {
  return pins?.[key]?.value ?? null;
}

function validateWindow(window, path, errors) {
  if (window.kind === 'instant' && (window.start !== null || window.end !== null)) {
    push(errors, 'INSTANT_WINDOW_HAS_BOUNDS', path, 'instant windows require explicit null bounds');
  }
  if (window.kind === 'bounded') {
    if (window.start === null || window.end === null) push(errors, 'BOUNDED_WINDOW_MISSING_BOUND', path, 'bounded windows require start and end');
    else if (Date.parse(window.start) >= Date.parse(window.end)) push(errors, 'INVALID_REPORTING_WINDOW', path, 'start must be earlier than end');
  }
}

function validateRevisionPins(pins, path, errors) {
  if (pinValue(pins, 'coverage_contract_version') !== '1.0.0') {
    push(errors, 'COVERAGE_CONTRACT_PIN_MISMATCH', `${path}/coverage_contract_version`, String(pinValue(pins, 'coverage_contract_version')));
  }
}

export function validateMetricDefinitions(document) {
  const errors = [];
  const ids = document.definitions.map(definition => definition.metric_id);
  if (!unique(ids)) push(errors, 'DUPLICATE_METRIC_DEFINITION', '/definitions', 'metric_id');
  const expectedIds = [...EXPECTED_METRICS.keys()];
  if (!stableEqual([...ids].sort(), [...expectedIds].sort())) {
    push(errors, 'METRIC_DEFINITION_SET_MISMATCH', '/definitions', `${ids.length} definitions`);
  }
  for (const [index, definition] of document.definitions.entries()) {
    const expected = EXPECTED_METRICS.get(definition.metric_id);
    const path = `/definitions/${index}`;
    if (!expected) continue;
    if (!stableEqual(definition.allowed_units, expected.units)) push(errors, 'METRIC_UNIT_DEFINITION_MISMATCH', `${path}/allowed_units`, definition.metric_id);
    if (definition.kind !== expected.kind) push(errors, 'METRIC_KIND_DEFINITION_MISMATCH', `${path}/kind`, definition.metric_id);
    if (definition.measured_stage !== expected.stage) push(errors, 'METRIC_STAGE_DEFINITION_MISMATCH', `${path}/measured_stage`, definition.metric_id);
    if (definition.allow_estimated_rate !== false) push(errors, 'ESTIMATED_RATE_NOT_FROZEN', `${path}/allow_estimated_rate`, definition.metric_id);
    if (!definition.required_revision_pins.includes('coverage_contract_version')) push(errors, 'CONTRACT_PIN_NOT_REQUIRED', `${path}/required_revision_pins`, definition.metric_id);
    const partition = EXPECTED_PARTITIONS.get(definition.metric_id);
    if (partition) {
      if (!definition.partition) push(errors, 'PARTITION_DEFINITION_MISSING', `${path}/partition`, definition.metric_id);
      else {
        if (!stableEqual(definition.partition.states, partition.states)) push(errors, 'PARTITION_STATE_TAXONOMY_MISMATCH', `${path}/partition/states`, definition.metric_id);
        if (definition.partition.equation !== partition.equation) push(errors, 'PARTITION_EQUATION_MISMATCH', `${path}/partition/equation`, definition.metric_id);
        if (!stableEqual(definition.partition.numerator_states, partition.numeratorStates)) push(errors, 'PARTITION_NUMERATOR_STATE_MISMATCH', `${path}/partition/numerator_states`, definition.metric_id);
      }
    } else if (definition.partition !== null) push(errors, 'UNEXPECTED_PARTITION_DEFINITION', `${path}/partition`, definition.metric_id);
    if (definition.kind === 'absolute_count' && definition.denominator_definition_version !== null) {
      push(errors, 'ABSOLUTE_COUNT_DENOMINATOR_VERSION', `${path}/denominator_definition_version`, definition.metric_id);
    }
    if (definition.kind !== 'absolute_count' && definition.denominator_definition_version === null) {
      push(errors, 'DENOMINATOR_DEFINITION_VERSION_MISSING', `${path}/denominator_definition_version`, definition.metric_id);
    }
  }
  return errors;
}

export function validateDigestTaxonomy(taxonomy) {
  const errors = [];
  const ids = taxonomy.digests.map(item => item.digest_id);
  if (!unique(ids)) push(errors, 'DUPLICATE_DIGEST_ID', '/digests', 'digest_id');
  if (!stableEqual([...ids].sort(), [...EXPECTED_DIGESTS.keys()].sort())) push(errors, 'DIGEST_TAXONOMY_SET_MISMATCH', '/digests', ids.join(','));
  for (const [index, item] of taxonomy.digests.entries()) {
    const expected = EXPECTED_DIGESTS.get(item.digest_id);
    if (!expected) continue;
    if (item.input !== expected.input) push(errors, 'DIGEST_INPUT_MISMATCH', `/digests/${index}/input`, item.digest_id);
    if (item.domain_separator !== expected.domainSeparator) push(errors, 'DIGEST_DOMAIN_SEPARATOR_MISMATCH', `/digests/${index}/domain_separator`, item.digest_id);
    if (!stableEqual(item.exclusions, expected.exclusions)) push(errors, 'DIGEST_EXCLUSION_MISMATCH', `/digests/${index}/exclusions`, item.digest_id);
  }
  return errors;
}

export function validateSourceScopes(scopes) {
  const errors = [];
  if (!unique(scopes.map(scope => scope.source_scope_id))) push(errors, 'DUPLICATE_SOURCE_SCOPE', '/source_scopes', 'source_scope_id');
  for (const [index, scope] of scopes.entries()) {
    const path = `/source_scopes/${index}`;
    const enumeration = scope.enumeration;
    if (scope.scope_definition.authoritative_total_supported && scope.scope_definition.completeness_denominator_definition === null) {
      push(errors, 'AUTHORITATIVE_TOTAL_DEFINITION_MISSING', `${path}/scope_definition`, scope.source_scope_id);
    }
    if (!scope.scope_definition.authoritative_total_supported && scope.scope_definition.completeness_denominator_definition !== null) {
      push(errors, 'UNSUPPORTED_AUTHORITATIVE_TOTAL_DEFINITION', `${path}/scope_definition`, scope.source_scope_id);
    }
    if (enumeration.status === 'complete') {
      if (!enumeration.sealed || enumeration.membership_revision === null || enumeration.completed_at === null || enumeration.failure_class !== null) {
        push(errors, 'SOURCE_SCOPE_COMPLETE_ENUMERATION_INVALID', `${path}/enumeration`, scope.source_scope_id);
      }
    } else if (enumeration.sealed || enumeration.failure_class === null && enumeration.status === 'failed') {
      push(errors, 'SOURCE_SCOPE_INCOMPLETE_ENUMERATION_INVALID', `${path}/enumeration`, scope.source_scope_id);
    }
    if (scope.absence_claim_permitted && (enumeration.status !== 'complete' || !enumeration.sealed)) {
      push(errors, 'FAILED_ENUMERATION_ABSENCE_CLAIM', `${path}/absence_claim_permitted`, scope.source_scope_id);
    }
    if (scope.absence_claim_permitted !== (scope.absence_reason === null)) {
      push(errors, 'ABSENCE_REASON_PAIR_INVALID', `${path}/absence_reason`, scope.source_scope_id);
    }
  }
  return errors;
}

export function validateStageFacts(facts, scopes) {
  const errors = [];
  const scopeById = new Map(scopes.map(scope => [scope.source_scope_id, scope]));
  if (!unique(facts.map(fact => fact.fact_id))) push(errors, 'DUPLICATE_STAGE_FACT', '/stage_facts', 'fact_id');
  for (const [index, fact] of facts.entries()) {
    const path = `/stage_facts/${index}`;
    validateRevisionPins(fact.revision_pins, `${path}/revision_pins`, errors);
    if (Date.parse(fact.effective_at) > Date.parse(fact.observed_at)) push(errors, 'FACT_EFFECTIVE_AFTER_OBSERVATION', path, fact.fact_id);
    if (fact.source_scope_id !== null) {
      const scope = scopeById.get(fact.source_scope_id);
      if (!scope) push(errors, 'UNKNOWN_FACT_SOURCE_SCOPE', `${path}/source_scope_id`, fact.source_scope_id);
      else {
        const comparisons = [
          ['registry_revision', scope.registry_revision],
          ['source_scope_revision', scope.source_scope_revision],
          ['connector_revision', scope.connector_revision],
          ['connector_configuration_revision', scope.connector_configuration_revision]
        ];
        for (const [key, expected] of comparisons) {
          if (pinValue(fact.revision_pins, key) !== expected) push(errors, 'FACT_REVISION_PIN_MISMATCH', `${path}/revision_pins/${key}`, fact.fact_id);
        }
        if (!Object.values(scope.policy_revisions).includes(pinValue(fact.revision_pins, 'policy_revision'))) {
          push(errors, 'STALE_POLICY_PIN_MISMATCH', `${path}/revision_pins/policy_revision`, fact.fact_id);
        }
      }
    }
  }
  return errors;
}

function validateManifestShape(manifest, definition, path, errors) {
  validateWindow(manifest.reporting_window, `${path}/reporting_window`, errors);
  validateRevisionPins(manifest.revision_pins, `${path}/revision_pins`, errors);
  if (!definition.allowed_units.includes(manifest.unit)) push(errors, 'UNIT_MIXING', `${path}/unit`, `${manifest.metric_id}:${manifest.unit}`);
  if (manifest.numerator_definition_version !== definition.numerator_definition_version) push(errors, 'NUMERATOR_DEFINITION_VERSION_MISMATCH', `${path}/numerator_definition_version`, manifest.metric_id);
  if (manifest.denominator_definition_version !== definition.denominator_definition_version) push(errors, 'DENOMINATOR_DEFINITION_VERSION_MISMATCH', `${path}/denominator_definition_version`, manifest.metric_id);
  if (!definition.allowed_denominator_status.includes(manifest.denominator_status)) push(errors, 'DENOMINATOR_STATUS_NOT_ALLOWED', `${path}/denominator_status`, manifest.metric_id);
  if (!unique(manifest.members.map(member => canonicalJson(member.member_key)))) push(errors, 'DUPLICATE_MEMBER_KEY', `${path}/members`, manifest.manifest_id);
  for (const [memberIndex, member] of manifest.members.entries()) {
    const memberPath = `${path}/members/${memberIndex}`;
    if (member.in_numerator === true && member.denominator_membership !== 'included') {
      push(errors, 'NUMERATOR_OUTSIDE_DENOMINATOR', `${memberPath}/in_numerator`, manifest.metric_id);
    }
    if (member.member_key.unit !== manifest.unit) push(errors, 'UNIT_MIXING', `${memberPath}/member_key/unit`, `${member.member_key.unit} != ${manifest.unit}`);
    if (member.state === 'excluded') {
      if (definition.exclusions_remain_in_upstream_denominator && member.denominator_membership !== 'included') {
        push(errors, 'EXCLUSION_LAUNDERING', `${memberPath}/denominator_membership`, manifest.metric_id);
      }
      if (member.policy_decision === null) push(errors, 'EXCLUSION_POLICY_EVIDENCE_MISSING', `${memberPath}/policy_decision`, manifest.metric_id);
      else if (member.policy_decision.policy_revision !== pinValue(manifest.revision_pins, 'policy_revision')) {
        push(errors, 'STALE_POLICY_PIN_MISMATCH', `${memberPath}/policy_decision/policy_revision`, manifest.metric_id);
      }
    }
  }
  if (manifest.denominator_status === 'known' && manifest.members.some(member => member.denominator_membership === 'unknown')) {
    push(errors, 'KNOWN_DENOMINATOR_HAS_UNKNOWN_MEMBERSHIP', `${path}/members`, manifest.metric_id);
  }
  if (manifest.denominator_status === 'estimated' && manifest.estimate_assertion === null) push(errors, 'ESTIMATE_ASSERTION_MISSING', `${path}/estimate_assertion`, manifest.metric_id);
  if (manifest.denominator_status !== 'estimated' && manifest.estimate_assertion !== null) push(errors, 'UNEXPECTED_ESTIMATE_ASSERTION', `${path}/estimate_assertion`, manifest.metric_id);
  if (manifest.enumeration.status === 'complete' && (!manifest.enumeration.sealed || manifest.enumeration.membership_revision === null)) {
    push(errors, 'COMPLETE_ENUMERATION_NOT_SEALED', `${path}/enumeration`, manifest.metric_id);
  }
  if (manifest.enumeration.status !== 'complete' && manifest.enumeration.sealed) push(errors, 'INCOMPLETE_ENUMERATION_SEALED', `${path}/enumeration`, manifest.metric_id);
  const memberOverlapGroups = new Set(manifest.members.flatMap(member => member.overlap_group_ids));
  if ((manifest.overlap.can_overlap || memberOverlapGroups.size > 0) && manifest.overlap.additive) {
    push(errors, 'OVERLAPPING_ADDITIVE_TOTAL', `${path}/overlap/additive`, manifest.metric_id);
  }
  for (const group of memberOverlapGroups) if (!manifest.overlap.overlap_group_ids.includes(group)) {
    push(errors, 'OVERLAP_GROUP_UNDISCLOSED', `${path}/overlap/overlap_group_ids`, group);
  }
  if (definition.overlap_policy === 'disjoint_required' && memberOverlapGroups.size > 0) push(errors, 'DISJOINT_METRIC_HAS_OVERLAP', `${path}/members`, manifest.metric_id);
}

function validateMetric(metric, manifest, definition, snapshot, path, manifestPath, errors) {
  if (metric.metric_id !== manifest.metric_id || metric.metric_version !== manifest.metric_version) push(errors, 'METRIC_MANIFEST_ID_MISMATCH', path, metric.metric_instance_id);
  if (metric.unit !== manifest.unit || !definition.allowed_units.includes(metric.unit)) push(errors, 'UNIT_MIXING', `${path}/unit`, metric.metric_id);
  if (metric.membership_manifest_id !== manifest.manifest_id) push(errors, 'MEMBERSHIP_MANIFEST_REFERENCE_MISMATCH', `${path}/membership_manifest_id`, metric.metric_id);
  if (metric.membership_manifest_hash !== membershipManifestDigest(manifest)) push(errors, 'MEMBERSHIP_MANIFEST_DIGEST_MISMATCH', `${path}/membership_manifest_hash`, metric.metric_id);
  if (metric.numerator_definition_version !== definition.numerator_definition_version) push(errors, 'NUMERATOR_DEFINITION_VERSION_MISMATCH', `${path}/numerator_definition_version`, metric.metric_id);
  if (metric.denominator_definition !== definition.denominator_definition) push(errors, 'DENOMINATOR_DEFINITION_MISMATCH', `${path}/denominator_definition`, metric.metric_id);
  if (metric.denominator_definition_version !== definition.denominator_definition_version) push(errors, 'DENOMINATOR_DEFINITION_VERSION_MISMATCH', `${path}/denominator_definition_version`, metric.metric_id);
  if (metric.as_of !== snapshot.as_of || manifest.as_of !== snapshot.as_of) push(errors, 'AS_OF_MISMATCH', `${path}/as_of`, metric.metric_id);
  if (!stableEqual(metric.reporting_window, snapshot.reporting_window) || !stableEqual(manifest.reporting_window, snapshot.reporting_window)) push(errors, 'REPORTING_WINDOW_MISMATCH', `${path}/reporting_window`, metric.metric_id);
  if (!stableEqual(metric.cohort_filters, manifest.cohort_filters)) push(errors, 'COHORT_FILTER_MISMATCH', `${path}/cohort_filters`, metric.metric_id);
  if (!stableEqual(metric.revision_pins, snapshot.revision_pins) || !stableEqual(manifest.revision_pins, snapshot.revision_pins)) {
    const code = pinValue(metric.revision_pins, 'policy_revision') !== pinValue(snapshot.revision_pins, 'policy_revision')
      || pinValue(manifest.revision_pins, 'policy_revision') !== pinValue(snapshot.revision_pins, 'policy_revision')
      ? 'STALE_POLICY_PIN_MISMATCH'
      : 'REVISION_PIN_MISMATCH';
    push(errors, code, `${path}/revision_pins`, metric.metric_id);
  }
  for (const key of definition.required_revision_pins) {
    if (pinValue(metric.revision_pins, key) === null || pinValue(manifest.revision_pins, key) === null) push(errors, 'REQUIRED_REVISION_PIN_MISSING', `${path}/revision_pins/${key}`, metric.metric_id);
  }
  for (const filter of metric.cohort_filters) {
    if (!definition.filters_known_by_stage.includes(filter.dimension)) push(errors, 'COHORT_FILTER_STAGE_OVERCLAIM', `${path}/cohort_filters`, `${metric.metric_id}:${filter.dimension}`);
    const actualUnclassified = manifest.members.filter(member => member.unclassified_dimensions.includes(filter.dimension)).length;
    if (filter.unclassified_count !== actualUnclassified) push(errors, 'FILTER_UNCLASSIFIED_COUNT_MISMATCH', `${path}/cohort_filters`, `${filter.dimension}:${actualUnclassified}`);
  }

  const denominatorMembers = manifest.members.filter(member => member.denominator_membership === 'included');
  const numeratorCount = manifest.members.filter(member => member.in_numerator).length;
  const unknownCount = manifest.members.filter(member => member.state === 'unknown').length;
  const notApplicableCount = manifest.members.filter(member => member.state === 'not_applicable').length;
  const excludedCount = manifest.members.filter(member => member.state === 'excluded').length;
  const unclassifiedCount = manifest.members.filter(member => member.state === 'unclassified' || member.unclassified_dimensions.length > 0).length;
  if (metric.numerator_count !== numeratorCount) push(errors, 'NUMERATOR_COUNT_MISMATCH', `${path}/numerator_count`, `${metric.numerator_count} != ${numeratorCount}`);
  if (metric.unknown_count !== unknownCount) push(errors, 'UNKNOWN_COUNT_MISMATCH', `${path}/unknown_count`, `${metric.unknown_count} != ${unknownCount}`);
  if (metric.not_applicable_count !== notApplicableCount) push(errors, 'NOT_APPLICABLE_COUNT_MISMATCH', `${path}/not_applicable_count`, `${metric.not_applicable_count} != ${notApplicableCount}`);
  if (metric.excluded_count !== excludedCount) push(errors, 'EXCLUDED_COUNT_MISMATCH', `${path}/excluded_count`, `${metric.excluded_count} != ${excludedCount}`);
  if (metric.unclassified_count !== unclassifiedCount) push(errors, 'UNCLASSIFIED_COUNT_MISMATCH', `${path}/unclassified_count`, `${metric.unclassified_count} != ${unclassifiedCount}`);

  if (metric.denominator_status !== manifest.denominator_status || !definition.allowed_denominator_status.includes(metric.denominator_status)) push(errors, 'DENOMINATOR_STATUS_MISMATCH', `${path}/denominator_status`, metric.metric_id);
  if (metric.denominator_status === 'known') {
    if (metric.denominator_count !== denominatorMembers.length) push(errors, 'DENOMINATOR_COUNT_MISMATCH', `${path}/denominator_count`, `${metric.denominator_count} != ${denominatorMembers.length}`);
    if (metric.denominator_count !== null && metric.numerator_count > metric.denominator_count) push(errors, 'NUMERATOR_EXCEEDS_DENOMINATOR', path, metric.metric_id);
    if (metric.denominator_count === 0) {
      if (metric.rate !== null) push(errors, 'ZERO_DENOMINATOR_PERCENTAGE', `${path}/rate`, metric.metric_id);
    } else {
      const expectedRate = metric.numerator_count / metric.denominator_count;
      if (metric.rate === null || Math.abs(metric.rate - expectedRate) > 1e-12) push(errors, 'RATE_MISMATCH', `${path}/rate`, `${metric.rate} != ${expectedRate}`);
    }
    if (metric.estimate_assertion !== null) push(errors, 'UNEXPECTED_ESTIMATE_ASSERTION', `${path}/estimate_assertion`, metric.metric_id);
  } else if (metric.denominator_status === 'unknown') {
    if (metric.denominator_count !== null) push(errors, 'UNKNOWN_DENOMINATOR_HAS_COUNT', `${path}/denominator_count`, metric.metric_id);
    if (metric.rate !== null) push(errors, 'RATE_WITHOUT_DENOMINATOR', `${path}/rate`, metric.metric_id);
    if (metric.estimate_assertion !== null) push(errors, 'UNEXPECTED_ESTIMATE_ASSERTION', `${path}/estimate_assertion`, metric.metric_id);
  } else {
    if (metric.denominator_count === null) push(errors, 'ESTIMATED_DENOMINATOR_COUNT_MISSING', `${path}/denominator_count`, metric.metric_id);
    if (metric.estimate_assertion === null || manifest.estimate_assertion === null) push(errors, 'ESTIMATE_ASSERTION_MISSING', `${path}/estimate_assertion`, metric.metric_id);
    if (!definition.allow_estimated_rate && metric.rate !== null) push(errors, 'ESTIMATED_RATE_NOT_PERMITTED', `${path}/rate`, metric.metric_id);
  }

  if (definition.partition) {
    const partition = metric.partition_counts;
    if (partition === null) push(errors, 'PARTITION_COUNTS_MISSING', `${path}/partition_counts`, metric.metric_id);
    else {
      const partitionStates = partition.map(item => item.state);
      if (!unique(partitionStates) || !stableEqual(partitionStates, definition.partition.states)) push(errors, 'PARTITION_STATE_DRIFT', `${path}/partition_counts`, metric.metric_id);
      const countByState = new Map(partition.map(item => [item.state, item.count]));
      for (const state of definition.partition.states) {
        const actual = denominatorMembers.filter(member => member.state === state).length;
        if (countByState.get(state) !== actual) push(errors, 'PARTITION_DRIFT', `${path}/partition_counts`, `${metric.metric_id}:${state}:${countByState.get(state)} != ${actual}`);
      }
      for (const member of denominatorMembers) if (!definition.partition.states.includes(member.state)) push(errors, 'PARTITION_STATE_INVALID', `${manifestPath}/members`, `${metric.metric_id}:${member.state}`);
      const total = partition.reduce((sum, item) => sum + item.count, 0);
      if (total !== metric.denominator_count) push(errors, 'PARTITION_NOT_EXHAUSTIVE', `${path}/partition_counts`, `${total} != ${metric.denominator_count}`);
      const expectedNumerator = denominatorMembers.filter(member => definition.partition.numerator_states.includes(member.state)).length;
      if (expectedNumerator !== metric.numerator_count) push(errors, 'PARTITION_NUMERATOR_DRIFT', `${path}/numerator_count`, `${expectedNumerator} != ${metric.numerator_count}`);
    }
  } else if (metric.partition_counts !== null) push(errors, 'UNEXPECTED_PARTITION_COUNTS', `${path}/partition_counts`, metric.metric_id);

  const memberGroups = new Set(manifest.members.flatMap(member => member.overlap_group_ids));
  if ((metric.overlap.can_overlap || memberGroups.size > 0) && metric.overlap.additive) push(errors, 'OVERLAPPING_ADDITIVE_TOTAL', `${path}/overlap/additive`, metric.metric_id);
  if (!stableEqual(metric.overlap, manifest.overlap)) push(errors, 'OVERLAP_DISCLOSURE_MISMATCH', `${path}/overlap`, metric.metric_id);

  const incompleteEnumeration = ['incomplete', 'failed'].includes(manifest.enumeration.status);
  if (incompleteEnumeration && metric.absence_claim_permitted) push(errors, 'FAILED_ENUMERATION_ABSENCE_CLAIM', `${path}/absence_claim_permitted`, metric.metric_id);
  if (metric.absence_claim_permitted) {
    if (metric.absence_reason !== null) push(errors, 'ABSENCE_REASON_PAIR_INVALID', `${path}/absence_reason`, metric.metric_id);
    if (!definition.absence_sensitive || metric.denominator_status !== 'known' || metric.unknown_count > 0 || metric.unclassified_count > 0) push(errors, 'ABSENCE_CLAIM_NOT_SUPPORTED', `${path}/absence_claim_permitted`, metric.metric_id);
    if (definition.measured_stage === 'search_index' && pinValue(metric.revision_pins, 'index_generation') === null) push(errors, 'ABSENCE_INDEX_PIN_MISSING', `${path}/revision_pins/index_generation`, metric.metric_id);
  } else if (metric.absence_reason === null) push(errors, 'ABSENCE_REASON_PAIR_INVALID', `${path}/absence_reason`, metric.metric_id);
  if (incompleteEnumeration && manifest.members.length > 0 && metric.partial_enumeration_label !== 'observed_processing_yield') {
    push(errors, 'PARTIAL_ENUMERATION_LABEL_MISSING', `${path}/partial_enumeration_label`, metric.metric_id);
  }
  if (!incompleteEnumeration && metric.partial_enumeration_label !== null) push(errors, 'UNEXPECTED_PARTIAL_ENUMERATION_LABEL', `${path}/partial_enumeration_label`, metric.metric_id);

  const expectedDisplay = metric.denominator_status === 'known'
    ? `${metric.numerator_count} of ${metric.denominator_count} ${metric.unit}`
    : `${metric.numerator_count} observed; denominator ${metric.denominator_status} (${metric.unit})`;
  if (metric.display.n_of_d !== expectedDisplay) push(errors, 'PUBLIC_DENOMINATOR_DISPLAY_MISMATCH', `${path}/display/n_of_d`, metric.metric_id);
}

export function validateCoverageSnapshot(snapshot, definitionsDocument) {
  const errors = [];
  validateWindow(snapshot.reporting_window, '/snapshot/reporting_window', errors);
  validateRevisionPins(snapshot.revision_pins, '/snapshot/revision_pins', errors);
  const expectedDefinitionsDigest = canonicalDigest('ushso:canonical-json:v1\n', definitionsDocument);
  if (snapshot.metric_definition_registry_hash !== expectedDefinitionsDigest) push(errors, 'METRIC_DEFINITION_REGISTRY_DIGEST_MISMATCH', '/snapshot/metric_definition_registry_hash', 'definitions');
  if (snapshot.immutability.canonical_digest !== snapshotDigest(snapshot)) push(errors, 'SNAPSHOT_DIGEST_MISMATCH', '/snapshot/immutability/canonical_digest', snapshot.coverage_snapshot_id);
  if (!unique(snapshot.metrics.map(metric => metric.metric_instance_id))) push(errors, 'DUPLICATE_METRIC_INSTANCE', '/snapshot/metrics', 'metric_instance_id');
  if (!unique(snapshot.metrics.map(metric => metric.metric_id))) push(errors, 'DUPLICATE_METRIC_ID', '/snapshot/metrics', 'metric_id');
  if (!unique(snapshot.membership_manifests.map(manifest => manifest.manifest_id))) push(errors, 'DUPLICATE_MEMBERSHIP_MANIFEST', '/snapshot/membership_manifests', 'manifest_id');
  if (!unique(snapshot.membership_manifests.map(manifest => manifest.metric_id))) push(errors, 'DUPLICATE_MANIFEST_METRIC_ID', '/snapshot/membership_manifests', 'metric_id');
  const expectedIds = [...EXPECTED_METRICS.keys()].sort();
  if (!stableEqual(snapshot.metrics.map(metric => metric.metric_id).sort(), expectedIds)) push(errors, 'SNAPSHOT_METRIC_SET_MISMATCH', '/snapshot/metrics', '18 required metrics');
  if (!stableEqual(snapshot.membership_manifests.map(manifest => manifest.metric_id).sort(), expectedIds)) push(errors, 'SNAPSHOT_MANIFEST_SET_MISMATCH', '/snapshot/membership_manifests', '18 required metrics');

  const definitionById = new Map(definitionsDocument.definitions.map(definition => [definition.metric_id, definition]));
  const manifestById = new Map(snapshot.membership_manifests.map((manifest, index) => [manifest.manifest_id, { manifest, index }]));
  for (const [index, metric] of snapshot.metrics.entries()) {
    const definition = definitionById.get(metric.metric_id);
    const manifestEntry = manifestById.get(metric.membership_manifest_id);
    if (!definition) { push(errors, 'UNKNOWN_METRIC_DEFINITION', `/snapshot/metrics/${index}/metric_id`, metric.metric_id); continue; }
    if (!manifestEntry) { push(errors, 'UNKNOWN_MEMBERSHIP_MANIFEST', `/snapshot/metrics/${index}/membership_manifest_id`, metric.metric_id); continue; }
    validateManifestShape(manifestEntry.manifest, definition, `/snapshot/membership_manifests/${manifestEntry.index}`, errors);
    validateMetric(metric, manifestEntry.manifest, definition, snapshot, `/snapshot/metrics/${index}`, `/snapshot/membership_manifests/${manifestEntry.index}`, errors);
  }
  return errors;
}

export function validateCoverageMatrix(matrix, snapshot, { requireAllCanonicalStates = false } = {}) {
  const errors = [];
  if (matrix.coverage_snapshot_id !== snapshot.coverage_snapshot_id || snapshot.matrix_id !== matrix.matrix_id) push(errors, 'MATRIX_SNAPSHOT_REFERENCE_MISMATCH', '/matrix', matrix.matrix_id);
  if (matrix.as_of !== snapshot.as_of) push(errors, 'MATRIX_AS_OF_MISMATCH', '/matrix/as_of', matrix.matrix_id);
  if (!stableEqual(matrix.revision_pins, snapshot.revision_pins)) push(errors, 'MATRIX_REVISION_PIN_MISMATCH', '/matrix/revision_pins', matrix.matrix_id);
  if (matrix.denominator.configured_cell_count !== matrix.cells.length) push(errors, 'MATRIX_DENOMINATOR_MISMATCH', '/matrix/denominator/configured_cell_count', `${matrix.denominator.configured_cell_count} != ${matrix.cells.length}`);
  const expectedHash = canonicalDigest('ushso:coverage-membership-manifest:v1\n', matrixMembershipPayload(matrix));
  if (matrix.denominator.membership_manifest_hash !== expectedHash) push(errors, 'MATRIX_MEMBERSHIP_DIGEST_MISMATCH', '/matrix/denominator/membership_manifest_hash', matrix.matrix_id);
  const keys = matrix.cells.map(cell => `${cell.jurisdiction_id}\u0000${cell.source_class_id}`);
  if (!unique(keys)) push(errors, 'DUPLICATE_COVERAGE_CELL', '/matrix/cells', 'jurisdiction_id + source_class_id');
  if (requireAllCanonicalStates) {
    const states = [...new Set(matrix.cells.map(cell => cell.coverage_cell_state))].sort();
    if (!stableEqual(states, [...CANONICAL_COVERAGE_CELL_STATES].sort())) push(errors, 'CANONICAL_COVERAGE_CELL_STATES_MISSING', '/matrix/cells', states.join(','));
  }
  for (const [index, cell] of matrix.cells.entries()) {
    const path = `/matrix/cells/${index}`;
    const comparisons = [
      ['registry_revision', pinValue(snapshot.revision_pins, 'registry_revision')],
      ['source_scope_revision', pinValue(snapshot.revision_pins, 'source_scope_revision')],
      ['policy_revision', pinValue(snapshot.revision_pins, 'policy_revision')]
    ];
    for (const [key, expected] of comparisons) if (cell[key] !== expected) push(errors, key === 'policy_revision' ? 'STALE_POLICY_PIN_MISMATCH' : 'MATRIX_CELL_PIN_MISMATCH', `${path}/${key}`, cell.cell_id);
    const failedEnumeration = cell.last_enumeration && ['incomplete', 'failed'].includes(cell.last_enumeration.status);
    if (failedEnumeration && cell.absence_claim_permitted) push(errors, 'FAILED_ENUMERATION_ABSENCE_CLAIM', `${path}/absence_claim_permitted`, cell.cell_id);
    if (cell.absence_claim_permitted !== (cell.absence_reason === null)) push(errors, 'ABSENCE_REASON_PAIR_INVALID', `${path}/absence_reason`, cell.cell_id);
    if (['candidate', 'navigation_only', 'evidence_gap', 'inaccessible', 'unknown', 'not_assessed'].includes(cell.coverage_cell_state) && cell.absence_claim_permitted) {
      push(errors, 'MATRIX_STATE_ABSENCE_OVERCLAIM', `${path}/absence_claim_permitted`, cell.cell_id);
    }
    if (cell.last_enumeration?.status === 'complete' && (!cell.last_enumeration.sealed || cell.last_enumeration.membership_revision === null)) push(errors, 'MATRIX_COMPLETE_ENUMERATION_INVALID', `${path}/last_enumeration`, cell.cell_id);
    if (cell.last_enumeration && cell.last_enumeration.status !== 'complete' && cell.last_enumeration.sealed) push(errors, 'MATRIX_INCOMPLETE_ENUMERATION_SEALED', `${path}/last_enumeration`, cell.cell_id);
    if (cell.overlap.can_overlap && cell.overlap.additive) push(errors, 'OVERLAPPING_ADDITIVE_TOTAL', `${path}/overlap/additive`, cell.cell_id);
  }
  return errors;
}

export function validateCoverageBundle(definitionsDocument, fixture, options = {}) {
  const errors = [
    ...validateMetricDefinitions(definitionsDocument),
    ...validateSourceScopes(fixture.source_scopes),
    ...validateStageFacts(fixture.stage_facts, fixture.source_scopes),
    ...validateCoverageSnapshot(fixture.snapshot, definitionsDocument),
    ...validateCoverageMatrix(fixture.matrix, fixture.snapshot, options)
  ];
  const scopeIds = new Set(fixture.source_scopes.map(scope => scope.source_scope_id));
  const factIds = new Set(fixture.stage_facts.map(fact => fact.fact_id));
  for (const id of fixture.snapshot.source_scope_ids) if (!scopeIds.has(id)) push(errors, 'SNAPSHOT_SOURCE_SCOPE_MISSING', '/snapshot/source_scope_ids', id);
  for (const id of fixture.snapshot.stage_fact_ids) if (!factIds.has(id)) push(errors, 'SNAPSHOT_STAGE_FACT_MISSING', '/snapshot/stage_fact_ids', id);
  return errors;
}
