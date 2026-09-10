import { canonicalJson, sha256Bytes } from '../../../../normalization/src/canonical.mjs';
import {
  APPLICABILITY_STATES,
  ATTEMPT_STATES,
  EVIDENCE_STATES,
  FIELD_ROLES,
  VALUE_STATES,
  assertFieldObservation,
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
  if (required.some(field => ['unsupported', 'missing', 'not_applicable', 'conflicting'].includes(field.observation.applicability_state) || ['restricted', 'failed', 'blocked', 'unavailable'].includes(field.observation.attempt_state))) return 'not_ready';
  if (required.some(field => field.observation.value_state === 'unknown' || field.observation.evidence_state === 'unknown' || field.observation.applicability_state === 'unknown' || field.observation.attempt_state === 'not_attempted' || field.observation.attempt_state === 'unknown')) return 'unknown';
  if (required.every(field => field.observation.applicability_state === 'supported' && field.observation.value_state === 'known' && field.observation.attempt_state === 'succeeded')) return 'ready';
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

function unsignedView({ cohort, generation, asOf, generatedAt, rows, definitions, observations, denominatorStatus }) {
  const membershipSummary = buildMembershipSummary(rows, denominatorStatus);
  const observationMap = new Map();
  for (const observation of observations) {
    const checked = assertFieldObservation(observation);
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
    field_definitions: clone(definitions),
    records,
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

export function buildCompletenessView({ membership, observations = [], fieldDefinitions, cohort, generation, asOf, generatedAt, denominatorStatus = 'known' }) {
  assert(typeof cohort === 'string' && cohort.length > 0, 'cohort_required');
  assert(typeof generation === 'string' && generation.length > 0, 'generation_required');
  assert(['known', 'unknown', 'incomplete'].includes(denominatorStatus), 'denominator_status_invalid');
  iso(asOf, 'as_of');
  iso(generatedAt, 'generated_at');
  const rows = normalizeMembership(membership);
  const definitions = normalizeFieldDefinitions(fieldDefinitions);
  const view = unsignedView({ cohort, generation, asOf, generatedAt, rows, definitions, observations, denominatorStatus });
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
  assert(metricValue.rate_context?.membership_hash === metricValue.membership_hash, 'metric_membership_context_drift', metricValue.metric_id);
  assert(metricValue.rate_context?.denominator_count === metricValue.denominator_count, 'metric_denominator_context_drift', metricValue.metric_id);
  assert(metricValue.denominator_count <= membershipCount * 100, 'metric_denominator_unbounded', metricValue.metric_id);
}

export function assertCompletenessView(view) {
  assert(view && typeof view === 'object' && !Array.isArray(view), 'completeness_view_required');
  assert(view.schema_version === COMPLETENESS_VIEW_VERSION, 'completeness_schema_version');
  assert(view.artifact_version === COMPLETENESS_ARTIFACT_VERSION, 'completeness_artifact_version');
  assert(typeof view.artifact_digest === 'string' && /^sha256:[a-f0-9]{64}$/u.test(view.artifact_digest), 'completeness_digest_missing');
  assert(digestUnsigned(stripDigest(view)) === view.artifact_digest, 'completeness_digest_mismatch');
  assert(Array.isArray(view.records), 'completeness_records_missing');
  assert(view.membership?.record_count === view.records.length, 'completeness_record_count_mismatch');
  assert(view.membership?.source_membership_count === view.records.reduce((sum, record) => sum + record.source_vectors.length, 0), 'completeness_source_count_mismatch');
  assert(unique(view.records.map(record => record.record_id)), 'completeness_record_ids_duplicate');
  assert(view.membership?.membership_hash === membershipHash(view.records.flatMap(record => record.source_vectors.map(source => ({
    record_id: record.record_id,
    source_id: source.source_id,
    isolated: record.isolated,
    isolation_reason: record.isolation_reason,
    evidence_ids: source.evidence_ids,
    source_observed_at: source.source_observed_at
  })))), 'completeness_membership_hash_mismatch');
  const fieldIds = view.field_definitions.map(definition => definition.field_id);
  assert(unique(fieldIds), 'completeness_field_ids_duplicate');
  for (const record of view.records) {
    assert(Array.isArray(record.source_vectors) && record.source_vectors.length > 0, 'completeness_source_vectors_missing');
    for (const source of record.source_vectors) {
      assert(source.fields.length === fieldIds.length, 'completeness_field_vector_incomplete');
      assert(typeof source.source_observed_at === 'string' || source.source_observed_at === null, 'completeness_source_observation_clock_missing');
      assert(unique(source.fields.map(field => field.field_id)), 'completeness_field_vector_duplicate');
      for (const field of source.fields) {
        assert(fieldIds.includes(field.field_id), 'completeness_unknown_field');
        const definition = view.field_definitions.find(item => item.field_id === field.field_id);
        assert(definition.field_role === field.observation.field_role && definition.unit === field.observation.unit, 'completeness_field_definition_drift');
        assertFieldObservation(field.observation);
      }
    }
  }
  for (const metricValue of view.aggregates?.metrics ?? []) assertMetric(metricValue, view.membership.record_count);
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
