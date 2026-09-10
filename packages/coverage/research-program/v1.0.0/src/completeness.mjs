import { canonicalJson, sha256Bytes } from '../../../../normalization/src/canonical.mjs';
import {
  APPLICABILITY_STATES,
  ATTEMPT_STATES,
  FIELD_ROLES,
  VALUE_STATES,
  assertFieldObservation,
  buildAccessSummary,
  createFieldObservation,
  deriveFieldObservation
} from '../../../../normalization/src/field-observation.mjs';

export const COMPLETENESS_VIEW_VERSION = 'ushso.completeness-view.v1.0.0';
export const COMPLETENESS_ARTIFACT_VERSION = 'ushso.completeness-artifact.v1.0.0';
export const READINESS_STATES = Object.freeze(['ready', 'not_ready', 'unknown']);
export const VALUE_PARTITIONS = Object.freeze([...VALUE_STATES]);
export const APPLICABILITY_PARTITIONS = Object.freeze(['supported', ...APPLICABILITY_STATES.filter(state => state !== 'supported')]);
export const ATTEMPT_PARTITIONS = Object.freeze(['succeeded', ...ATTEMPT_STATES.filter(state => state !== 'succeeded')]);

const CORE_BOUNDARIES = Object.freeze({
  catalog_membership_is_not_payload_access: true,
  metadata_reachability_is_not_payload_access: true,
  rendered_strings_and_title_tags_are_not_ledger_facts: true,
  unknown_is_not_false: true,
  unknown_cost_is_not_free: true,
  unknown_usage_limit_is_not_unlimited: true,
  aggregate_metrics_are_supplemental_to_full_vector: true,
  isolated_members_are_retained: true,
  scientific_qualification_is_not_claimed: true
});

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function assert(condition, code, message = code) {
  if (!condition) {
    const error = new TypeError(message);
    error.code = code;
    throw error;
  }
}

function iso(value, label) {
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), `${label}_invalid`, `${label} must be an ISO timestamp`);
  return value;
}

function unique(values) {
  return new Set(values).size === values.length;
}

function observationKey(recordId, sourceId, fieldId) {
  return `${recordId}\u0000${sourceId}\u0000${fieldId}`;
}

function normalizeEvidenceId(value) {
  assert(typeof value === 'string' && value.length >= 3, 'membership_evidence_id_invalid');
  return value;
}

function normalizeMembership(membership) {
  assert(Array.isArray(membership), 'membership_required', 'membership must be an array');
  const rows = membership.map((row, index) => {
    assert(row && typeof row === 'object' && !Array.isArray(row), 'membership_row_invalid', `membership row ${index} must be an object`);
    assert(typeof row.record_id === 'string' && row.record_id.length >= 3, 'membership_record_id_invalid');
    assert(typeof row.source_id === 'string' && row.source_id.length >= 3, 'membership_source_id_invalid');
    assert(Array.isArray(row.evidence_ids) && row.evidence_ids.length > 0 && unique(row.evidence_ids), 'membership_evidence_invalid', `membership ${row.record_id} requires unique evidence_ids`);
    const sourceObservedAt = row.source_observed_at ?? null;
    if (sourceObservedAt !== null) iso(sourceObservedAt, 'membership_source_observed_at');
    return {
      record_id: row.record_id,
      source_id: row.source_id,
      isolated: row.isolated === true,
      isolation_reason: row.isolation_reason ?? null,
      evidence_ids: row.evidence_ids.map(normalizeEvidenceId).sort(),
      source_observed_at: sourceObservedAt
    };
  }).sort((left, right) => left.record_id.localeCompare(right.record_id) || left.source_id.localeCompare(right.source_id));
  const keys = rows.map(row => observationKey(row.record_id, row.source_id, 'membership'));
  assert(unique(keys), 'membership_duplicate_source_row');
  return rows;
}

function membershipPayload(rows) {
  return rows.map(row => ({
    record_id: row.record_id,
    source_id: row.source_id,
    isolated: row.isolated,
    isolation_reason: row.isolation_reason,
    evidence_ids: [...row.evidence_ids],
    source_observed_at: row.source_observed_at
  }));
}

export function membershipHash(membership) {
  const rows = normalizeMembership(membership);
  return `sha256:${sha256Bytes(canonicalJson(membershipPayload(rows)))}`;
}

function normalizeFieldDefinitions(fieldDefinitions) {
  assert(Array.isArray(fieldDefinitions) && fieldDefinitions.length > 0, 'field_definitions_required');
  const definitions = fieldDefinitions.map((definition, index) => {
    assert(definition && typeof definition === 'object' && !Array.isArray(definition), 'field_definition_invalid', `field definition ${index} must be an object`);
    assert(typeof definition.field_id === 'string' && /^[a-z][a-z0-9._-]{1,119}$/u.test(definition.field_id), 'field_definition_id_invalid');
    assert(FIELD_ROLES.includes(definition.field_role), 'field_definition_role_invalid');
    assert(definition.unit === null || typeof definition.unit === 'string' && definition.unit.length > 0, 'field_definition_unit_invalid');
    if (definition.field_role === 'identifier') assert(definition.unit === null, 'field_definition_identifier_unit');
    return {
      field_id: definition.field_id,
      field_role: definition.field_role,
      unit: definition.unit ?? null,
      required_for_readiness: definition.required_for_readiness !== false,
      description: definition.description ?? null
    };
  }).sort((left, right) => left.field_id.localeCompare(right.field_id));
  assert(unique(definitions.map(definition => definition.field_id)), 'field_definition_duplicate');
  return definitions;
}

function evidenceRefFromMembership(row, asOf) {
  const observedAt = row.source_observed_at ?? asOf;
  return row.evidence_ids.map(evidenceId => ({
    evidence_id: evidenceId,
    evidence_state: 'documented',
    observed_at: observedAt,
    source_locator: null,
    claim_paths: ['/baseline_records'],
    staleness_state: 'unknown'
  }));
}

function missingObservation({ row, definition, asOf }) {
  const evidenceRefs = evidenceRefFromMembership(row, asOf);
  return createFieldObservation({
    record_id: row.record_id,
    source_id: row.source_id,
    field_id: definition.field_id,
    field_role: definition.field_role,
    unit: definition.unit,
    value: { kind: 'unknown', value: null },
    value_state: 'unknown',
    evidence_state: 'documented',
    applicability_state: 'missing',
    attempt_state: 'not_attempted',
    endpoint_scope: { endpoint_id: null, resource: null, operation: 'other' },
    evidence_refs: evidenceRefs,
    reason_codes: ['no_ledger_observation'],
    source_observed_at: row.source_observed_at,
    observed_at: asOf,
    recorded_at: asOf,
    attempted_at: null
  });
}

function vectorField(definition, observation) {
  return {
    field_id: definition.field_id,
    field_role: definition.field_role,
    unit: definition.unit,
    required_for_readiness: definition.required_for_readiness,
    observation: clone(observation)
  };
}

function compactObservation(observation) {
  return {
    observation_id: observation.observation_id,
    record_id: observation.record_id,
    source_id: observation.source_id,
    field_id: observation.field_id,
    field_role: observation.field_role,
    unit: observation.unit,
    value: clone(observation.value),
    value_state: observation.value_state,
    evidence_state: observation.evidence_state,
    applicability_state: observation.applicability_state,
    attempt_state: observation.attempt_state,
    endpoint_scope: clone(observation.endpoint_scope),
    evidence_ids: observation.evidence_refs.map(ref => ref.evidence_id),
    reason_codes: [...observation.reason_codes],
    source_observed_at: observation.source_observed_at,
    observed_at: observation.observed_at,
    recorded_at: observation.recorded_at,
    attempted_at: observation.attempted_at,
    stale_at: observation.stale_at,
    browser_observations: clone(observation.browser_observations),
    history: clone(observation.history)
  };
}

function compactRecords(records) {
  return records.map(record => ({
    ...record,
    source_vectors: record.source_vectors.map(source => ({
      ...source,
      fields: source.fields.map(field => ({ ...field, observation: compactObservation(field.observation) }))
    }))
  }));
}

function evidenceCatalog(observations) {
  const refs = new Map();
  for (const observation of observations) for (const ref of observation.evidence_refs) if (!refs.has(ref.evidence_id)) refs.set(ref.evidence_id, clone(ref));
  return [...refs.values()].sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));
}

function buildMembershipSummary(rows, denominatorStatus = 'known') {
  const sourceCounts = Object.fromEntries([...new Set(rows.map(row => row.source_id))].sort().map(sourceId => [sourceId, rows.filter(row => row.source_id === sourceId).length]));
  const isolatedRecords = rows.filter(row => row.isolated).map(row => row.record_id).sort();
  return {
    record_count: new Set(rows.map(row => row.record_id)).size,
    source_membership_count: rows.length,
    source_counts: sourceCounts,
    isolated_count: new Set(isolatedRecords).size,
    isolated_record_ids: [...new Set(isolatedRecords)],
    denominator_status: denominatorStatus,
    membership_hash: membershipHash(rows)
  };
}

function buildReadinessState(fields) {
  const required = fields.filter(field => field.required_for_readiness);
  if (required.length === 0) return 'unknown';
  if (required.some(field => ['unsupported', 'missing', 'not_applicable', 'conflicting'].includes(field.observation.applicability_state) || ['restricted', 'failed', 'blocked', 'unavailable', 'stale'].includes(field.observation.attempt_state) || ['candidate', 'ambiguous', 'disputed'].includes(field.observation.evidence_state))) return 'not_ready';
  if (required.some(field => field.observation.value_state === 'unknown' || field.observation.evidence_state === 'unknown' || field.observation.applicability_state === 'unknown' || field.observation.attempt_state === 'not_attempted' || field.observation.attempt_state === 'unknown')) return 'unknown';
  if (required.every(field => ['documented', 'observed', 'executed', 'proven'].includes(field.observation.evidence_state) && field.observation.applicability_state === 'supported' && field.observation.value_state === 'known' && field.observation.attempt_state === 'succeeded')) return 'ready';
  return 'unknown';
}

function partition(rows, selector, states) {
  const counts = Object.fromEntries(states.map(state => [state, 0]));
  for (const row of rows) {
    const state = selector(row);
    assert(Object.hasOwn(counts, state), 'partition_state_unknown', `partition state ${state} is not declared`);
    counts[state] += 1;
  }
  return states.map(state => ({ state, count: counts[state] }));
}

function metric({ metricId, fieldId, sourceId = null, rows, selector, states, context }) {
  const denominatorCount = rows.length;
  const denominatorStatus = context.denominator_status;
  const partitions = partition(rows, selector, states);
  const numeratorCount = rows.filter(row => selector(row) === states[0]).length;
  const rate = denominatorStatus === 'known' && denominatorCount > 0 ? numeratorCount / denominatorCount : null;
  return {
    metric_id: metricId,
    field_id: fieldId,
    source_id: sourceId,
    cohort_definition: context.cohort_definition,
    generation: context.generation,
    as_of: context.as_of,
    membership_hash: context.membership_hash,
    denominator_count: denominatorCount,
    denominator_status: denominatorStatus,
    numerator_count: numeratorCount,
    partitions,
    rate,
    rate_context: {
      cohort_definition: context.cohort_definition,
      generation: context.generation,
      as_of: context.as_of,
      membership_hash: context.membership_hash,
      denominator_count: denominatorCount,
      denominator_status: denominatorStatus,
      partition_states: states
    }
  };
}

function buildMetrics(records, definitions, context) {
  const allVectors = records.flatMap(record => record.source_vectors.map(source => source.fields.map(field => ({ ...field, record_id: record.record_id, source_id: source.source_id })).flat())).flat();
  const metrics = [];
  for (const definition of definitions) {
    const rows = allVectors.filter(row => row.field_id === definition.field_id);
    metrics.push(metric({
      metricId: `field.applicability.${definition.field_id}`,
      fieldId: definition.field_id,
      rows,
      selector: row => row.observation.applicability_state,
      states: APPLICABILITY_PARTITIONS,
      context
    }));
    metrics.push(metric({
      metricId: `field.attempt.${definition.field_id}`,
      fieldId: definition.field_id,
      rows,
      selector: row => row.observation.attempt_state,
      states: ATTEMPT_PARTITIONS,
      context
    }));
    metrics.push(metric({
      metricId: `field.value.${definition.field_id}`,
      fieldId: definition.field_id,
      rows,
      selector: row => row.observation.value_state,
      states: VALUE_PARTITIONS,
      context
    }));
  }
  for (const sourceId of [...new Set(allVectors.map(row => row.source_id))].sort()) {
    const sourceRows = allVectors.filter(row => row.source_id === sourceId);
    for (const definition of definitions) {
      const rows = sourceRows.filter(row => row.field_id === definition.field_id);
      metrics.push(metric({
        metricId: `source.${sourceId}.applicability.${definition.field_id}`,
        fieldId: definition.field_id,
        sourceId,
        rows,
        selector: row => row.observation.applicability_state,
        states: APPLICABILITY_PARTITIONS,
        context
      }));
    }
  }
  const readinessRows = records.map(record => ({ state: record.readiness_state }));
  metrics.push(metric({
    metricId: 'research.readiness',
    fieldId: null,
    rows: readinessRows,
    selector: row => row.state,
    states: READINESS_STATES,
    context
  }));
  return metrics;
}

function unsignedView({ cohort, generation, asOf, generatedAt, rows, definitions, observations, denominatorStatus, vectorEncoding, accessSummary }) {
  const membershipSummary = buildMembershipSummary(rows, denominatorStatus);
  const observationMap = new Map();
  const observationIds = new Set();
  for (const observation of observations) {
    const checked = assertFieldObservation(observation);
    assert(!observationIds.has(checked.observation_id), 'observation_duplicate_id', checked.observation_id);
    observationIds.add(checked.observation_id);
    const key = observationKey(checked.record_id, checked.source_id, checked.field_id);
    assert(rows.some(row => observationKey(row.record_id, row.source_id, 'membership') === observationKey(checked.record_id, checked.source_id, 'membership')), 'observation_outside_membership', key);
    if (!observationMap.has(key)) observationMap.set(key, []);
    observationMap.get(key).push(checked);
  }
  const recordsById = new Map();
  for (const row of rows) {
    const fields = definitions.map(definition => {
      const key = observationKey(row.record_id, row.source_id, definition.field_id);
      const selected = deriveFieldObservation({ recordId: row.record_id, sourceId: row.source_id, fieldId: definition.field_id, observations: observationMap.get(key) ?? [], asOf });
      return vectorField(definition, selected.current_observation ?? missingObservation({ row, definition, asOf }));
    });
    if (!recordsById.has(row.record_id)) recordsById.set(row.record_id, {
      record_id: row.record_id,
      isolated: false,
      isolation_reason: null,
      source_vectors: []
    });
    const record = recordsById.get(row.record_id);
    record.isolated = record.isolated || row.isolated;
    record.isolation_reason ??= row.isolation_reason;
    record.source_vectors.push({ source_id: row.source_id, source_observed_at: row.source_observed_at, evidence_ids: [...row.evidence_ids], fields });
  }
  const records = [...recordsById.values()].sort((left, right) => left.record_id.localeCompare(right.record_id));
  for (const record of records) {
    record.source_vectors.sort((left, right) => left.source_id.localeCompare(right.source_id));
    record.readiness_state = buildReadinessState(record.source_vectors.flatMap(source => source.fields));
  }
  const renderedRecords = vectorEncoding === 'compact-v1' ? compactRecords(records) : records;
  const renderedObservations = records.flatMap(record => record.source_vectors.flatMap(source => source.fields.map(field => field.observation)));
  const context = {
    cohort_definition: cohort,
    generation,
    as_of: asOf,
    membership_hash: membershipSummary.membership_hash,
    denominator_status: membershipSummary.denominator_status
  };
  return {
    schema_version: COMPLETENESS_VIEW_VERSION,
    artifact_version: COMPLETENESS_ARTIFACT_VERSION,
    generated_at: generatedAt,
    cohort,
    generation,
    as_of: asOf,
    membership: membershipSummary,
    vector_encoding: vectorEncoding,
    evidence_catalog: vectorEncoding === 'compact-v1' ? evidenceCatalog(renderedObservations) : [],
    access_summary: accessSummary ? clone(accessSummary) : null,
    field_definitions: clone(definitions),
    records: renderedRecords,
    aggregates: {
      metrics: buildMetrics(records, definitions, context)
    },
    boundaries: clone(CORE_BOUNDARIES)
  };
}

function digestJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    assert(Number.isFinite(value), 'digest_number_invalid');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(digestJson).join(',')}]`;
  assert(value && typeof value === 'object', 'digest_value_invalid');
  return `{${Object.keys(value).sort((left, right) => left.localeCompare(right)).map(key => `${JSON.stringify(key)}:${digestJson(value[key])}`).join(',')}}`;
}

function digestUnsigned(view) {
  return `sha256:${sha256Bytes(digestJson(view))}`;
}

export function buildCompletenessView({ membership, observations = [], fieldDefinitions, cohort, generation, asOf, generatedAt, denominatorStatus = 'known', vectorEncoding = 'full-v1', accessSummary = null }) {
  assert(typeof cohort === 'string' && cohort.length > 0, 'cohort_required');
  assert(typeof generation === 'string' && generation.length > 0, 'generation_required');
  assert(['known', 'unknown', 'incomplete'].includes(denominatorStatus), 'denominator_status_invalid');
  assert(['full-v1', 'compact-v1'].includes(vectorEncoding), 'vector_encoding_invalid');
  iso(asOf, 'as_of');
  iso(generatedAt, 'generated_at');
  const rows = normalizeMembership(membership);
  const definitions = normalizeFieldDefinitions(fieldDefinitions);
  const expectedAccessSummary = accessSummary === null
    ? null
    : buildAccessSummary({ observations, asOf, compact: vectorEncoding === 'compact-v1' });
  if (accessSummary !== null) assert(digestJson(accessSummary) === digestJson(expectedAccessSummary), 'access_summary_not_bound');
  const view = unsignedView({ cohort, generation, asOf, generatedAt, rows, definitions, observations, denominatorStatus, vectorEncoding, accessSummary: expectedAccessSummary });
  const digest = digestUnsigned(view);
  const result = {
    ...view,
    artifact_id: `urn:ushso:completeness-view:${digest.slice('sha256:'.length, 'sha256:'.length + 40)}`,
    artifact_digest: digest
  };
  return deepFreeze(result);
}

function stripDigest(view) {
  const copy = clone(view);
  delete copy.artifact_id;
  delete copy.artifact_digest;
  return copy;
}

function assertMetric(metricValue, membershipCount) {
  assert(metricValue && typeof metricValue === 'object', 'metric_invalid');
  assert(Array.isArray(metricValue.partitions) && metricValue.partitions.length > 0, 'metric_partitions_missing');
  const total = metricValue.partitions.reduce((sum, partitionValue) => sum + partitionValue.count, 0);
  assert(total === metricValue.denominator_count, 'metric_partition_not_exhaustive', metricValue.metric_id);
  if (metricValue.denominator_status !== 'known' || metricValue.denominator_count === 0) assert(metricValue.rate === null, 'unsafe_rate', metricValue.metric_id);
  else assert(typeof metricValue.rate === 'number' && metricValue.rate >= 0 && metricValue.rate <= 1, 'metric_rate_invalid', metricValue.metric_id);
  assert(metricValue.numerator_count === metricValue.partitions[0].count, 'metric_numerator_partition_drift', metricValue.metric_id);
  assert(metricValue.rate_context?.membership_hash === metricValue.membership_hash, 'metric_membership_context_drift', metricValue.metric_id);
  assert(metricValue.rate_context?.denominator_count === metricValue.denominator_count, 'metric_denominator_context_drift', metricValue.metric_id);
  assert(Array.isArray(metricValue.rate_context?.partition_states) && metricValue.rate_context.partition_states.length === metricValue.partitions.length && metricValue.rate_context.partition_states.every((state, index) => state === metricValue.partitions[index].state), 'metric_partition_context_drift', metricValue.metric_id);
  assert(metricValue.denominator_count <= membershipCount * 100, 'metric_denominator_unbounded', metricValue.metric_id);
}

function compactEvidenceRefs(observation) {
  const observedAt = observation.source_observed_at ?? observation.observed_at;
  return observation.evidence_ids.map(evidenceId => ({
    evidence_id: evidenceId,
    evidence_state: observation.evidence_state,
    observed_at: observedAt,
    source_locator: null,
    claim_paths: ['/compact/evidence_ids'],
    staleness_state: 'unknown'
  }));
}

function expandCompactObservation(observation) {
  const evidenceRefs = compactEvidenceRefs(observation);
  return {
    schema_version: 'ushso.field-observation.v1.0.0',
    observation_id: observation.observation_id,
    record_id: observation.record_id,
    source_id: observation.source_id,
    field_id: observation.field_id,
    field_role: observation.field_role,
    unit: observation.unit,
    value: observation.value,
    value_state: observation.value_state,
    evidence_state: observation.evidence_state,
    applicability_state: observation.applicability_state,
    attempt_state: observation.attempt_state,
    endpoint_scope: observation.endpoint_scope,
    evidence_refs: evidenceRefs,
    reason_codes: observation.reason_codes,
    source_observed_at: observation.source_observed_at,
    observed_at: observation.observed_at,
    recorded_at: observation.recorded_at,
    attempted_at: observation.attempted_at,
    stale_at: observation.stale_at,
    access_facts: {
      credential_requirements: [],
      cost: { state: 'unknown', amount: null, currency: null, evidence_refs: clone(evidenceRefs), observed_at: observation.observed_at },
      usage_limit: { state: 'unknown', limit: null, unit: null, evidence_refs: clone(evidenceRefs), observed_at: observation.observed_at },
      evidence_refs: clone(evidenceRefs),
      observed_at: observation.observed_at
    },
    browser_observations: observation.browser_observations,
    history: observation.history,
    core_contracts: {
      value: 'observatory-core.assertion.claimValue',
      evidence: 'observatory-core.evidenceReference',
      applicability: 'observatory-core.schemaField.field_role',
      attempt: 'observatory-core.accessObservation'
    }
  };
}

function assertCompactObservation(observation) {
  assert(observation && typeof observation === 'object', 'compact_observation_required');
  for (const key of ['observation_id', 'record_id', 'source_id', 'field_id', 'field_role', 'unit', 'value', 'value_state', 'evidence_state', 'applicability_state', 'attempt_state', 'endpoint_scope', 'evidence_ids', 'reason_codes', 'source_observed_at', 'observed_at', 'recorded_at', 'attempted_at', 'stale_at', 'browser_observations', 'history']) assert(Object.hasOwn(observation, key), 'compact_observation_field_missing', key);
  assert(Array.isArray(observation.evidence_ids) && observation.evidence_ids.length > 0 && unique(observation.evidence_ids), 'compact_observation_evidence_invalid');
  assertFieldObservation(expandCompactObservation(observation));
  return true;
}

function evidenceIdsOf(value) {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.evidence_ids)) return [...value.evidence_ids];
  if (Array.isArray(value.evidence_refs)) return value.evidence_refs.map(ref => ref.evidence_id);
  return [];
}

function scopeKeyForAccess(scope) {
  return JSON.stringify([scope.endpoint_id ?? null, scope.resource ?? null, scope.operation]);
}

function checkProjection(check) {
  if (check === null || check === undefined) return null;
  return {
    observation_id: check.observation_id,
    field_id: check.field_id,
    attempt_state: check.attempt_state,
    attempted_at: check.attempted_at,
    observed_at: check.observed_at,
    source_observed_at: check.source_observed_at,
    endpoint_scope: clone(check.endpoint_scope),
    evidence_state: check.evidence_state,
    evidence_ids: evidenceIdsOf(check),
    reason_codes: [...(check.reason_codes ?? [])]
  };
}

function browserProjection(browser) {
  return {
    state: browser.state,
    endpoint_scope: clone(browser.endpoint_scope),
    observed_at: browser.observed_at,
    evidence_ids: evidenceIdsOf(browser),
    reason_codes: [...(browser.reason_codes ?? [])]
  };
}

function accessSummaryProjection(summary) {
  return {
    schema_version: summary.schema_version,
    as_of: summary.as_of,
    endpoint_scopes: [...summary.endpoint_scopes].sort((left, right) => scopeKeyForAccess(left.endpoint_scope).localeCompare(scopeKeyForAccess(right.endpoint_scope))).map(scope => ({
      endpoint_scope: clone(scope.endpoint_scope),
      latest_successful_check: checkProjection(scope.latest_successful_check),
      latest_attempt: checkProjection(scope.latest_attempt),
      browser_observations: [...(scope.browser_observations ?? [])].sort((left, right) => String(left.observed_at).localeCompare(String(right.observed_at)) || scopeKeyForAccess(left.endpoint_scope).localeCompare(scopeKeyForAccess(right.endpoint_scope))).map(browserProjection)
    }))
  };
}

function assertAccessSummary(summary, asOf, availableEvidenceIds) {
  assert(summary && typeof summary === 'object' && !Array.isArray(summary), 'access_summary_required');
  assert(summary.schema_version === 'ushso.access-summary.v1.0.0', 'access_summary_version');
  assert(summary.as_of === asOf, 'access_summary_as_of');
  assert(Array.isArray(summary.endpoint_scopes), 'access_summary_scopes');
  const seenScopes = new Set();
  const evidencePresent = value => evidenceIdsOf(value).every(evidenceId => availableEvidenceIds.has(evidenceId));
  const timestampAtOrBefore = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.parse(asOf);
  for (const scope of summary.endpoint_scopes) {
    assert(scope && typeof scope === 'object' && scope.endpoint_scope && typeof scope.endpoint_scope === 'object', 'access_summary_scope_shape');
    const scopeKey = scopeKeyForAccess(scope.endpoint_scope);
    assert(!seenScopes.has(scopeKey), 'access_summary_scope_duplicate');
    seenScopes.add(scopeKey);
    assert(['metadata_read', 'payload_read', 'schema_read', 'browser_read', 'other'].includes(scope.endpoint_scope.operation), 'access_summary_operation');
    assert(scope.documented && typeof scope.documented === 'object', 'access_summary_documented');
    assert(Array.isArray(scope.documented.credential_requirements), 'access_summary_credentials');
    assert(timestampAtOrBefore(scope.documented.observed_at), 'access_summary_documented_time');
    assert(evidencePresent(scope.documented), 'access_summary_documented_evidence');
    for (const requirement of scope.documented.credential_requirements) {
      assert(requirement && typeof requirement === 'object', 'access_summary_requirement_shape');
      assert(typeof requirement.requirement_id === 'string' && typeof requirement.name === 'string', 'access_summary_requirement_identity');
      assert(['required', 'not_required', 'unknown', 'conflicting'].includes(requirement.state), 'access_summary_requirement_state');
      assert(timestampAtOrBefore(requirement.observed_at), 'access_summary_requirement_time');
      assert(evidencePresent(requirement), 'access_summary_requirement_evidence');
    }
    for (const key of ['cost', 'usage_limit']) {
      const facts = scope.documented[key];
      assert(facts === null || typeof facts === 'object', 'access_summary_fact_shape');
      if (facts) {
        assert(timestampAtOrBefore(facts.observed_at), 'access_summary_fact_time');
        assert(evidencePresent(facts), 'access_summary_fact_evidence');
        if (key === 'cost' && ['unknown', 'conflicting'].includes(facts.state)) assert(facts.amount === null, 'access_summary_unknown_cost');
        if (key === 'usage_limit' && ['unknown', 'conflicting', 'not_applicable'].includes(facts.state)) assert(facts.limit === null, 'access_summary_unknown_usage');
      }
    }
    for (const [key, expectedState] of [['latest_attempt', null], ['latest_successful_check', 'succeeded']]) {
      const check = scope[key];
      if (check === null) continue;
      assert(check && typeof check === 'object', 'access_summary_check_shape');
      if (expectedState) assert(check.attempt_state === expectedState, 'access_summary_success_state');
      assert(typeof check.observation_id === 'string' && check.attempt_state !== 'not_attempted', 'access_summary_check_identity');
      assert(timestampAtOrBefore(check.observed_at) && timestampAtOrBefore(check.attempted_at), 'access_summary_check_time');
      assert(check.endpoint_scope && scopeKeyForAccess(check.endpoint_scope) === scopeKey, 'access_summary_check_scope');
      assert(evidencePresent(check), 'access_summary_check_evidence');
    }
    assert(Array.isArray(scope.browser_observations), 'access_summary_browser');
    for (const browser of scope.browser_observations) {
      assert(browser && browser.endpoint_scope && browser.endpoint_scope.operation === 'browser_read', 'access_summary_browser_scope');
      assert(timestampAtOrBefore(browser.observed_at), 'access_summary_browser_time');
      assert(evidencePresent(browser), 'access_summary_browser_evidence');
    }
  }
  return true;
}

export function assertCompletenessView(view, { expectedMembershipHash = null, expectedCohort = null, expectedGeneration = null, expectedAsOf = null } = {}) {
  assert(view && typeof view === 'object' && !Array.isArray(view), 'completeness_view_required');
  assert(view.schema_version === COMPLETENESS_VIEW_VERSION, 'completeness_schema_version');
  assert(view.artifact_version === COMPLETENESS_ARTIFACT_VERSION, 'completeness_artifact_version');
  assert(['full-v1', 'compact-v1'].includes(view.vector_encoding), 'completeness_vector_encoding');
  assert(typeof view.artifact_digest === 'string' && /^sha256:[a-f0-9]{64}$/u.test(view.artifact_digest), 'completeness_digest_missing');
  assert(view.artifact_id === 'urn:ushso:completeness-view:' + view.artifact_digest.slice('sha256:'.length, 'sha256:'.length + 40), 'completeness_id_mismatch');
  assert(digestUnsigned(stripDigest(view)) === view.artifact_digest, 'completeness_digest_mismatch');
  if (expectedMembershipHash !== null) assert(view.membership?.membership_hash === expectedMembershipHash, 'completeness_expected_membership_mismatch');
  if (expectedCohort !== null) assert(view.cohort === expectedCohort, 'completeness_expected_cohort_mismatch');
  if (expectedGeneration !== null) assert(view.generation === expectedGeneration, 'completeness_expected_generation_mismatch');
  if (expectedAsOf !== null) assert(view.as_of === expectedAsOf, 'completeness_expected_as_of_mismatch');
  assert(Array.isArray(view.records), 'completeness_records_missing');
  assert(view.membership?.record_count === view.records.length, 'completeness_record_count_mismatch');
  assert(view.membership?.source_membership_count === view.records.reduce((sum, record) => sum + record.source_vectors.length, 0), 'completeness_source_count_mismatch');
  assert(view.membership?.isolated_count === view.membership?.isolated_record_ids?.length, 'completeness_isolated_count_mismatch');
  assert(unique(view.records.map(record => record.record_id)), 'completeness_record_ids_duplicate');
  assert(unique(view.membership?.isolated_record_ids ?? []), 'completeness_isolated_ids_duplicate');
  assert(Array.isArray(view.evidence_catalog), 'completeness_evidence_catalog_missing');
  const evidenceIds = view.evidence_catalog.map(ref => ref.evidence_id);
  assert(unique(evidenceIds), 'completeness_evidence_catalog_duplicate');
  const reconstructedMembership = view.records.flatMap(record => record.source_vectors.map(source => ({
    record_id: record.record_id,
    source_id: source.source_id,
    isolated: record.isolated,
    isolation_reason: record.isolation_reason,
    evidence_ids: source.evidence_ids,
    source_observed_at: source.source_observed_at
  })));
  assert(view.membership?.membership_hash === membershipHash(reconstructedMembership), 'completeness_membership_hash_mismatch');
  const expectedMembership = buildMembershipSummary(reconstructedMembership, view.membership.denominator_status);
  assert(digestJson(expectedMembership) === digestJson(view.membership), 'completeness_membership_summary_mismatch');
  const fieldIds = view.field_definitions.map(definition => definition.field_id);
  assert(unique(fieldIds), 'completeness_field_ids_duplicate');
  for (const record of view.records) {
    assert(Array.isArray(record.source_vectors) && record.source_vectors.length > 0, 'completeness_source_vectors_missing');
    assert(unique(record.source_vectors.map(source => source.source_id)), 'completeness_source_ids_duplicate');
    if (record.isolated) assert(typeof record.isolation_reason === 'string' && record.isolation_reason.length > 0, 'completeness_isolation_reason_missing');
    else assert(record.isolation_reason === null, 'completeness_nonisolated_reason');
    for (const source of record.source_vectors) {
      assert(source.fields.length === fieldIds.length, 'completeness_field_vector_incomplete');
      assert(typeof source.source_observed_at === 'string' || source.source_observed_at === null, 'completeness_source_observation_clock_missing');
      assert(unique(source.evidence_ids), 'completeness_source_evidence_duplicate');
      if (view.vector_encoding === 'compact-v1') assert(source.evidence_ids.every(evidenceId => evidenceIds.includes(evidenceId)), 'completeness_source_evidence_unlisted');
      assert(unique(source.fields.map(field => field.field_id)), 'completeness_field_vector_duplicate');
      for (const field of source.fields) {
        assert(fieldIds.includes(field.field_id), 'completeness_unknown_field');
        const definition = view.field_definitions.find(item => item.field_id === field.field_id);
        assert(definition.field_role === field.observation.field_role && definition.unit === field.observation.unit && definition.required_for_readiness === field.required_for_readiness, 'completeness_field_definition_drift');
        assert(field.observation.source_observed_at === source.source_observed_at, 'completeness_source_observation_clock_drift');
        if (view.vector_encoding === 'compact-v1') {
          assert(field.observation.evidence_ids.every(evidenceId => evidenceIds.includes(evidenceId)), 'completeness_observation_evidence_unlisted');
          assertCompactObservation(field.observation);
        } else assertFieldObservation(field.observation);
      }
    }
  }
  const vectorObservations = view.records.flatMap(record => record.source_vectors.flatMap(source => source.fields.map(field => view.vector_encoding === 'compact-v1' ? expandCompactObservation(field.observation) : field.observation)));
  const vectorEvidenceIds = new Set(vectorObservations.flatMap(observation => observation.evidence_refs.map(ref => ref.evidence_id)));
  for (const record of view.records) assert(record.readiness_state === buildReadinessState(record.source_vectors.flatMap(source => source.fields)), 'completeness_readiness_recalculation_mismatch');
  if (view.access_summary !== null) {
    assertAccessSummary(view.access_summary, view.as_of, vectorEvidenceIds);
    const expectedAccessSummary = buildAccessSummary({ observations: vectorObservations, asOf: view.as_of, compact: view.vector_encoding === 'compact-v1' });
    assert(digestJson(accessSummaryProjection(view.access_summary)) === digestJson(accessSummaryProjection(expectedAccessSummary)), 'completeness_access_summary_mismatch');
  }
  const expectedMetrics = buildMetrics(view.records, view.field_definitions, {
    cohort_definition: view.cohort,
    generation: view.generation,
    as_of: view.as_of,
    membership_hash: view.membership.membership_hash,
    denominator_status: view.membership.denominator_status
  });
  assert(digestJson(expectedMetrics) === digestJson(view.aggregates?.metrics ?? []), 'completeness_metric_recalculation_mismatch');
  for (const metricValue of view.aggregates?.metrics ?? []) {
    assertMetric(metricValue, view.membership.record_count);
    assert(metricValue.cohort_definition === view.cohort && metricValue.generation === view.generation && metricValue.as_of === view.as_of, 'metric_context_drift', metricValue.metric_id);
    assert(metricValue.rate_context?.cohort_definition === view.cohort && metricValue.rate_context?.generation === view.generation && metricValue.rate_context?.as_of === view.as_of, 'metric_rate_context_drift', metricValue.metric_id);
  }
  return true;
}

export function createOfflineCompletenessConsumer(view, { expectedDigest = null, maxPageSize = 100 } = {}) {
  assertCompletenessView(view);
  if (expectedDigest !== null) assert(expectedDigest === view.artifact_digest, 'completeness_expected_digest_mismatch');
  assert(Number.isSafeInteger(maxPageSize) && maxPageSize > 0 && maxPageSize <= 1000, 'completeness_page_size_invalid');
  const records = view.records;
  const metrics = new Map((view.aggregates?.metrics ?? []).map(metricValue => [metricValue.metric_id, metricValue]));
  const findRecord = recordId => {
    const record = records.find(item => item.record_id === recordId);
    return record ? clone(record) : null;
  };
  return Object.freeze({
    schema_version: COMPLETENESS_VIEW_VERSION,
    artifact_digest: view.artifact_digest,
    getRecord(recordId) { return findRecord(recordId); },
    listRecords({ offset = 0, limit = maxPageSize, sourceId = null } = {}) {
      assert(Number.isSafeInteger(offset) && offset >= 0, 'completeness_offset_invalid');
      assert(Number.isSafeInteger(limit) && limit > 0 && limit <= maxPageSize, 'completeness_limit_invalid');
      const filtered = sourceId === null ? records : records.filter(record => record.source_vectors.some(source => source.source_id === sourceId));
      return { offset, limit, total: filtered.length, records: filtered.slice(offset, offset + limit).map(clone), artifact_digest: view.artifact_digest };
    },
    getMetric(metricId) {
      return metrics.has(metricId) ? clone(metrics.get(metricId)) : null;
    },
    getSummary() {
      return clone({
        schema_version: view.schema_version,
        artifact_id: view.artifact_id,
        artifact_digest: view.artifact_digest,
        cohort: view.cohort,
        generation: view.generation,
        as_of: view.as_of,
        membership: view.membership,
        metric_count: view.aggregates.metrics.length,
        boundaries: view.boundaries
      });
    }
  });
}

export const buildCoverageView = buildCompletenessView;
export const createCompletenessConsumer = createOfflineCompletenessConsumer;
