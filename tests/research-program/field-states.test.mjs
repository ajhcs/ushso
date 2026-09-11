import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  ACCESS_SUMMARY_VERSION,
  appendFieldObservationRevision,
  buildAccessSummary,
  compareRfc3339,
  createFieldObservation,
  deriveFieldObservation,
  isRfc3339DateTime,
  validateFieldObservation
} from '../../packages/normalization/src/index.mjs';
import { assertCompletenessView, buildCompletenessView, createOfflineCompletenessConsumer } from '../../packages/coverage/index.mjs';
import { sha256Bytes } from '../../packages/normalization/src/canonical.mjs';
import { verificationTempRoot } from '../../scripts/verification-temp-root.mjs';
import {
  ORIGINAL_DECODED_BYTES,
  ORIGINAL_DECODED_SHA256,
  assertPackagedManifestConsistency,
  gzipCompletenessBytes,
  gunzipCompletenessBytes,
  loadPackagedCompletenessView,
  sha256Hex
} from '../../verification/research-program/pr-004/completeness-view-packaging.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OBSERVED_AT = '2026-09-03T22:22:33.908Z';
const INPUT_DIGEST = 'sha256:' + 'a'.repeat(64);
const schema = JSON.parse(await fs.readFile(path.join(ROOT, 'packages/normalization/schemas/field-observation.schema.json'), 'utf8'));
const completenessSchema = JSON.parse(await fs.readFile(path.join(ROOT, 'packages/coverage/research-program/v1.0.0/schemas/completeness-view.schema.json'), 'utf8'));
const ajv = new Ajv2020({ strict: true, strictSchema: true, strictTypes: true, allErrors: true });
ajv.addFormat('date-time', isRfc3339DateTime);
const validateSchema = ajv.compile(schema);
const validateCompletenessSchema = ajv.compile(completenessSchema);

function evidence(id = 'evidence:field-state.fixture', observedAt = OBSERVED_AT) {
  return {
    evidence_id: id,
    evidence_state: 'observed',
    observed_at: observedAt,
    source_locator: 'https://example.invalid/retained-fixture',
    claim_paths: ['/fixture'],
    staleness_state: 'current'
  };
}

function field(overrides = {}) {
  const refs = overrides.evidence_refs ?? [evidence()];
  return createFieldObservation({
    record_id: 'record:fixture-1',
    source_id: 'source:fixture',
    field_id: 'payload.count',
    field_role: 'measure_description',
    unit: 'item',
    value: { kind: 'integer', value: 4 },
    value_state: 'known',
    evidence_state: 'observed',
    applicability_state: 'supported',
    attempt_state: 'succeeded',
    endpoint_scope: { endpoint_id: 'endpoint:fixture', resource: 'resource:payload', operation: 'payload_read' },
    evidence_refs: refs,
    reason_codes: ['fixture_observed'],
    source_observed_at: OBSERVED_AT,
    observed_at: OBSERVED_AT,
    recorded_at: OBSERVED_AT,
    attempted_at: OBSERVED_AT,
    ...overrides
  });
}

function assertSchema(value) {
  assert.equal(validateSchema(value), true, JSON.stringify(validateSchema.errors));
}

function digestJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(digestJson).join(',') + ']';
  return '{' + Object.keys(value).sort((left, right) => left.localeCompare(right)).map(key => JSON.stringify(key) + ':' + digestJson(value[key])).join(',') + '}';
}

function rehashView(value) {
  const copy = structuredClone(value);
  delete copy.artifact_id;
  delete copy.artifact_digest;
  const digest = 'sha256:' + sha256Bytes(digestJson(copy));
  copy.artifact_id = 'urn:ushso:completeness-view:' + digest.slice('sha256:'.length, 'sha256:'.length + 40);
  copy.artifact_digest = digest;
  return copy;
}

test('field observation keeps unknown distinct from false and identifiers unitless', () => {
  const falseValue = field({
    field_id: 'facility.is_active',
    field_role: 'metadata',
    unit: null,
    value: { kind: 'boolean', value: false },
    value_state: 'known',
    reason_codes: ['source_reported_false']
  });
  const unknown = field({
    field_id: 'facility.name',
    field_role: 'identifier',
    unit: null,
    value: { kind: 'unknown', value: null },
    value_state: 'unknown',
    evidence_state: 'unknown',
    applicability_state: 'unknown',
    attempt_state: 'not_attempted',
    attempted_at: null,
    reason_codes: ['payload_not_tested']
  });
  assertSchema(falseValue);
  assertSchema(unknown);
  assert.equal(falseValue.value.value, false);
  assert.equal(falseValue.value_state, 'known');
  assert.equal(unknown.value_state, 'unknown');
  assert.equal(unknown.value.value, null);
  assert.equal(unknown.unit, null);
  assert.equal(validateFieldObservation(unknown).length, 0);
  assert.throws(() => createFieldObservation({ ...unknown, value: { kind: 'boolean', value: false }, value_state: 'unknown' }), { code: 'field_observation_invalid' });
  assert.throws(() => createFieldObservation({ ...falseValue, field_role: 'identifier', unit: 'count' }), { code: 'field_observation_invalid' });
});

test('failed or expired attempts retain the historical successful observation', () => {
  const historical = field({
    observation_id: 'urn:ushso:field-observation:historical-success',
    evidence_refs: [evidence('evidence:historical-success', '2026-01-01T00:00:00.000Z')],
    observed_at: '2026-01-01T00:00:00.000Z',
    recorded_at: '2026-01-01T00:00:03.000Z',
    source_observed_at: '2025-12-31T00:00:00.000Z',
    attempted_at: '2026-01-01T00:00:02.000Z',
    reason_codes: ['historical_payload_success']
  });
  const failed = appendFieldObservationRevision(historical, {
    observation_id: 'urn:ushso:field-observation:current-failure',
    record_id: historical.record_id,
    source_id: historical.source_id,
    field_id: historical.field_id,
    field_role: historical.field_role,
    unit: historical.unit,
    value: { kind: 'unknown', value: null },
    value_state: 'unknown',
    evidence_state: 'observed',
    applicability_state: 'supported',
    attempt_state: 'restricted',
    endpoint_scope: historical.endpoint_scope,
    evidence_refs: [evidence('evidence:field-state.restricted', '2026-02-01T00:00:00.000Z')],
    reason_codes: ['credential_required'],
    source_observed_at: '2026-02-01T00:00:00.000Z',
    observed_at: '2026-02-01T00:00:00.000Z',
    recorded_at: '2026-02-01T00:00:03.000Z',
    attempted_at: '2026-02-01T00:00:02.000Z'
  });
  assertSchema(failed);
  const derived = deriveFieldObservation({
    recordId: historical.record_id,
    sourceId: historical.source_id,
    fieldId: historical.field_id,
    observations: [historical, failed],
    asOf: '2026-03-01T00:00:00.000Z'
  });
  assert.equal(derived.current_state, 'restricted');
  assert.equal(derived.current_value_state, 'unknown');
  assert.equal(derived.historical_success.observation_id, historical.observation_id);
  assert.equal(derived.historical_success.value.value, 4);
  assert.equal(derived.historical_success_retained, true);
  assert.equal(failed.history.some(item => item.revision_id === historical.observation_id), true);
  const expiring = field({
    observation_id: 'urn:ushso:field-observation:expiring-success',
    evidence_refs: [evidence('evidence:expiring-success', '2026-01-15T00:00:00.000Z')],
    observed_at: '2026-01-15T00:00:00.000Z',
    recorded_at: '2026-01-15T00:00:03.000Z',
    source_observed_at: '2026-01-14T00:00:00.000Z',
    attempted_at: '2026-01-15T00:00:02.000Z',
    stale_at: '2026-02-15T00:00:00.000Z',
    reason_codes: ['expiring_payload_success']
  });
  const expired = deriveFieldObservation({
    recordId: expiring.record_id,
    sourceId: expiring.source_id,
    fieldId: expiring.field_id,
    observations: [expiring],
    asOf: '2026-03-01T00:00:00.000Z'
  });
  assert.equal(expired.current_state, 'stale');
  assert.equal(expired.current_observation.stale_at, '2026-02-15T00:00:00.000Z');
  assert.equal(expired.current_observation.reason_codes.includes('observation_expired'), true);
  assert.equal(expired.historical_success.observation_id, expiring.observation_id);
  assert.equal(expired.historical_success_retained, true);
  const historyOnly = deriveFieldObservation({
    recordId: failed.record_id,
    sourceId: failed.source_id,
    fieldId: failed.field_id,
    observations: [failed],
    asOf: '2026-03-01T00:00:00.000Z'
  });
  assert.equal(historyOnly.historical_success.observation_id, historical.observation_id);
  assert.equal(historyOnly.historical_success.evidence_refs[0].evidence_id, historical.evidence_refs[0].evidence_id);
  assert.deepEqual(historyOnly.historical_success.endpoint_scope, historical.endpoint_scope);
  assert.equal(historyOnly.historical_success.access_facts.observed_at, historical.access_facts.observed_at);
  assert.equal(historyOnly.historical_success.recorded_at, historical.recorded_at);
  const retainedSummary = buildAccessSummary({ observations: [failed], asOf: '2026-03-01T00:00:00.000Z' });
  const retainedScope = retainedSummary.endpoint_scopes[0];
  assert.equal(retainedScope.latest_successful_check.observation_id, historical.observation_id);
  assert.equal(retainedScope.revision_history.some(check => check.revision_id === historical.observation_id && check.record_id === historical.record_id && check.source_id === historical.source_id && check.recorded_at === historical.recorded_at), true);
  assert.throws(() => createFieldObservation({ ...failed, attempt_state: 'failed', attempted_at: null }), { code: 'field_observation_invalid' });
});

test('as-of derivation and endpoint/browser scope reject future or unscoped outcomes', () => {
  const future = field({
    evidence_refs: [evidence('evidence:future-observation', '2026-04-01T00:00:00.000Z')],
    source_observed_at: '2026-04-01T00:00:00.000Z',
    observed_at: '2026-04-01T00:00:00.000Z',
    recorded_at: '2026-04-02T00:00:02.000Z',
    attempted_at: '2026-04-02T00:00:01.000Z'
  });
  const derived = deriveFieldObservation({
    recordId: future.record_id,
    sourceId: future.source_id,
    fieldId: future.field_id,
    observations: [future],
    asOf: '2026-04-01T12:00:00.000Z'
  });
  assert.equal(derived.current_observation, null);
  assert.equal(buildAccessSummary({ observations: [future], asOf: '2026-04-01T12:00:00.000Z' }).endpoint_scopes.length, 0);
  assert.throws(() => field({
    evidence_refs: [evidence('evidence:source-after-observation', '2026-04-01T00:00:00.000Z')],
    observed_at: '2026-04-01T00:00:00.000Z',
    recorded_at: '2026-04-01T00:00:00.000Z',
    attempted_at: '2026-04-01T00:00:00.000Z',
    source_observed_at: '2026-04-02T00:00:00.000Z'
  }), { code: 'field_observation_invalid' });
  assert.throws(() => field({
    endpoint_scope: { endpoint_id: null, resource: null, operation: 'other' }
  }), { code: 'field_observation_invalid' });
  assert.throws(() => field({
    browser_observations: [{
      state: 'succeeded',
      endpoint_scope: { endpoint_id: 'endpoint:wrong', resource: 'resource:payload', operation: 'payload_read' },
      observed_at: OBSERVED_AT,
      evidence_refs: [evidence('evidence:browser:wrong-operation')],
      reason_codes: ['wrong_scope']
    }]
  }), { code: 'field_observation_invalid' });
});

test('documented requirements and access observations remain separate and conservative', () => {
  const documented = field({
    field_id: 'payload.value',
    access_facts: {
      credential_requirements: [{
        requirement_id: 'requirement:api-key',
        kind: 'credential',
        name: 'api_key',
        state: 'required',
        evidence_refs: [evidence('evidence:credential.documented')],
        observed_at: OBSERVED_AT
      }],
      cost: { state: 'unknown', amount: null, currency: null, evidence_refs: [evidence('evidence:cost.unknown')], observed_at: OBSERVED_AT },
      usage_limit: { state: 'unknown', limit: null, unit: null, evidence_refs: [evidence('evidence:quota.unknown')], observed_at: OBSERVED_AT },
      evidence_refs: [evidence('evidence:access.documented')],
      observed_at: OBSERVED_AT
    },
    browser_observations: [{
      state: 'not_tested',
      endpoint_scope: { endpoint_id: 'endpoint:fixture', resource: 'resource:payload', operation: 'browser_read' },
      observed_at: OBSERVED_AT,
      evidence_refs: [evidence('evidence:browser.not-tested')],
      reason_codes: ['browser_check_not_run']
    }]
  });
  assertSchema(documented);
  const summary = buildAccessSummary({ observations: [documented], asOf: '2026-09-04T00:00:00.000Z' });
  assert.equal(summary.schema_version, ACCESS_SUMMARY_VERSION);
  assert.equal(summary.endpoint_scopes.length, 1);
  const endpoint = summary.endpoint_scopes[0];
  assert.equal(endpoint.documented.credential_requirements[0].name, 'api_key');
  assert.equal(endpoint.documented.cost.state, 'unknown');
  assert.equal(endpoint.documented.cost.amount, null);
  assert.equal(endpoint.documented.usage_limit.state, 'unknown');
  assert.equal(endpoint.documented.usage_limit.limit, null);
  assert.equal(endpoint.latest_successful_check.observation_id, documented.observation_id);
  assert.equal(endpoint.latest_successful_check.endpoint_scope.operation, 'payload_read');
  assert.equal(endpoint.browser_observations[0].endpoint_scope.operation, 'browser_read');
  assert.equal(endpoint.boundaries.server_success_does_not_imply_browser_usability, true);
  assert.throws(() => createFieldObservation({ ...documented, access_facts: { ...documented.access_facts, cost: { ...documented.access_facts.cost, amount: 0 } } }), { code: 'field_observation_invalid' });
  assert.throws(() => createFieldObservation({ ...documented, access_facts: { ...documented.access_facts, usage_limit: { ...documented.access_facts.usage_limit, limit: 0 } } }), { code: 'field_observation_invalid' });
  assert.throws(() => createFieldObservation({ ...documented, access_facts: { ...documented.access_facts, credential_requirements: [{ ...documented.access_facts.credential_requirements[0], name: 'api_key=secret-value' }] } }), { code: 'field_observation_invalid' });
});

test('access history is order invariant, attempts use attempt time, and dates are calendar-valid', () => {
  const accessObservation = ({ observationId, observedAt, credentialState, attemptedAt = observedAt }) => {
    const refs = [evidence('evidence:access:' + observationId, observedAt)];
    return field({
      observation_id: observationId,
      observed_at: observedAt,
      recorded_at: observedAt,
      attempted_at: attemptedAt,
      source_observed_at: '2026-09-01T00:00:00.000Z',
      evidence_refs: refs,
      access_facts: {
        credential_requirements: [{
          requirement_id: 'requirement:api-key',
          kind: 'credential',
          name: 'api_key',
          state: credentialState,
          evidence_refs: refs,
          observed_at: observedAt
        }],
        cost: { state: 'unknown', amount: null, currency: null, evidence_refs: refs, observed_at: observedAt },
        usage_limit: { state: 'unknown', limit: null, unit: null, evidence_refs: refs, observed_at: observedAt },
        evidence_refs: refs,
        observed_at: observedAt
      }
    });
  };
  const older = accessObservation({
    observationId: 'urn:ushso:field-observation:credential-older',
    observedAt: '2026-09-02T00:00:00.000Z',
    credentialState: 'required'
  });
  const newer = accessObservation({
    observationId: 'urn:ushso:field-observation:credential-newer',
    observedAt: '2026-09-04T00:00:00.000Z',
    credentialState: 'not_required'
  });
  const forward = buildAccessSummary({ observations: [older, newer], asOf: '2026-09-10T00:00:00.000Z' });
  const reverse = buildAccessSummary({ observations: [newer, older], asOf: '2026-09-10T00:00:00.000Z' });
  assert.equal(forward.endpoint_scopes[0].documented.credential_requirements[0].state, 'conflicting');
  assert.deepEqual(forward.endpoint_scopes[0].documented.credential_requirements, reverse.endpoint_scopes[0].documented.credential_requirements);

  const recordedLater = accessObservation({
    observationId: 'urn:ushso:field-observation:attempt-recorded-later',
    observedAt: '2026-09-05T00:00:00.000Z',
    credentialState: 'required',
    attemptedAt: '2026-09-01T00:00:00.000Z'
  });
  const attemptedLater = accessObservation({
    observationId: 'urn:ushso:field-observation:attempt-newer',
    observedAt: '2026-09-04T00:00:00.000Z',
    credentialState: 'required',
    attemptedAt: '2026-09-03T00:00:00.000Z'
  });
  const attempts = buildAccessSummary({ observations: [recordedLater, attemptedLater], asOf: '2026-09-10T00:00:00.000Z' }).endpoint_scopes[0];
  assert.equal(attempts.latest_attempt.observation_id, attemptedLater.observation_id);
  assert.equal(attempts.latest_successful_check.observation_id, attemptedLater.observation_id);

  assert.throws(() => field({
    field_id: 'payload.calendar_date',
    field_role: 'date',
    value: { kind: 'date', value: '2026-02-31' },
    value_state: 'known'
  }), { code: 'field_observation_invalid' });
});

test('flat observation ledgers retain prior revisions and scope local revision identities', () => {
  const oldAt = '2026-09-01T00:00:00.1238Z';
  const currentAt = '2026-09-02T00:00:00.1239Z';
  const asOf = '2026-09-10T00:00:00.000Z';
  const old = field({
    observation_id: 'revision:local-success',
    record_id: 'record:flat-history',
    source_id: 'source:flat-history',
    observed_at: oldAt,
    recorded_at: oldAt,
    attempted_at: oldAt,
    source_observed_at: oldAt,
    evidence_refs: [evidence('evidence:flat-history-old', oldAt)],
    reason_codes: ['flat_history_success']
  });
  const current = field({
    observation_id: 'revision:flat-failure',
    record_id: old.record_id,
    source_id: old.source_id,
    observed_at: currentAt,
    recorded_at: currentAt,
    attempted_at: currentAt,
    source_observed_at: currentAt,
    evidence_refs: [evidence('evidence:flat-history-current', currentAt)],
    value: { kind: 'unknown', value: null },
    value_state: 'unknown',
    attempt_state: 'failed',
    reason_codes: ['flat_history_failure']
  });
  const derived = deriveFieldObservation({ recordId: old.record_id, sourceId: old.source_id, fieldId: old.field_id, observations: [old, current], asOf });
  assert.equal(derived.current_state, 'failed');
  assert.deepEqual(derived.current_observation.history.map(item => item.revision_id), [old.observation_id]);
  const summary = buildAccessSummary({ observations: [old, current], asOf });
  assert.deepEqual(summary.endpoint_scopes[0].revision_history.map(item => item.revision_id), [current.observation_id, old.observation_id]);
  const view = buildCompletenessView({
    membership: [{ record_id: old.record_id, source_id: old.source_id, isolated: false, evidence_ids: ['evidence:flat-history-membership'], source_observed_at: currentAt }],
    observations: [old, current],
    fieldDefinitions: [{ field_id: old.field_id, field_role: old.field_role, unit: old.unit, description: 'Flat history fixture.' }],
    cohort: 'flat history fixture',
    generation: 'flat-history-generation',
    asOf,
    generatedAt: asOf,
    accessSummary: summary
  });
  assertCompletenessView(view);
  const vectorObservation = view.records[0].source_vectors[0].fields[0].observation;
  assert.deepEqual(vectorObservation.history.map(item => item.revision_id), [old.observation_id]);
  assert.equal(view.evidence_catalog.find(item => item.evidence_id === 'evidence:flat-history-old').bindings.some(binding => binding.location === 'history' && binding.revision_id === old.observation_id), true);

  const otherOld = field({
    observation_id: old.observation_id,
    record_id: 'record:flat-history-other',
    source_id: 'source:flat-history-other',
    observed_at: oldAt,
    recorded_at: oldAt,
    attempted_at: oldAt,
    source_observed_at: oldAt,
    evidence_refs: [evidence('evidence:flat-history-other-old', oldAt)],
    reason_codes: ['other_flat_history_success']
  });
  const otherCurrent = field({
    observation_id: 'revision:flat-failure-other',
    record_id: otherOld.record_id,
    source_id: otherOld.source_id,
    observed_at: currentAt,
    recorded_at: currentAt,
    attempted_at: currentAt,
    source_observed_at: currentAt,
    evidence_refs: [evidence('evidence:flat-history-other-current', currentAt)],
    value: { kind: 'unknown', value: null },
    value_state: 'unknown',
    attempt_state: 'failed',
    reason_codes: ['other_flat_history_failure']
  });
  const scopedSummary = buildAccessSummary({ observations: [current, otherCurrent, old, otherOld], asOf });
  const historicalIds = scopedSummary.endpoint_scopes.flatMap(scope => scope.revision_history).filter(item => item.attempt_state === 'succeeded').map(item => `${item.record_id}:${item.revision_id}`);
  assert.equal(historicalIds.length, 2);
  assert.equal(new Set(historicalIds).size, 2);
  assert.throws(() => buildAccessSummary({ observations: [old, { ...old, value: { kind: 'integer', value: 99 } }], asOf }), { code: 'field_observation_revision_conflict' });
});


test('mixed flat and nested revisions deduplicate canonical payloads and reject content conflicts', () => {
  const asOf = '2026-09-10T00:00:00.000Z';
  const a = field({
    observation_id: 'revision:mixed-a',
    observed_at: '2026-09-01T00:00:00.1001Z',
    recorded_at: '2026-09-01T00:00:00.1001Z',
    attempted_at: '2026-09-01T00:00:00.1001Z',
    source_observed_at: '2026-09-01T00:00:00.1001Z',
    evidence_refs: [evidence('evidence:mixed-a', '2026-09-01T00:00:00.1001Z')],
    reason_codes: ['mixed_revision_a']
  });
  const b = appendFieldObservationRevision(a, field({
    observation_id: 'revision:mixed-b',
    observed_at: '2026-09-02T00:00:00.1002Z',
    recorded_at: '2026-09-02T00:00:00.1002Z',
    attempted_at: '2026-09-02T00:00:00.1002Z',
    source_observed_at: '2026-09-02T00:00:00.1002Z',
    evidence_refs: [evidence('evidence:mixed-b', '2026-09-02T00:00:00.1002Z')],
    reason_codes: ['mixed_revision_b'],
    value: { kind: 'integer', value: 5 }
  }));
  const c = appendFieldObservationRevision(b, field({
    observation_id: 'revision:mixed-c',
    observed_at: '2026-09-03T00:00:00.1003Z',
    recorded_at: '2026-09-03T00:00:00.1003Z',
    attempted_at: '2026-09-03T00:00:00.1003Z',
    source_observed_at: '2026-09-03T00:00:00.1003Z',
    evidence_refs: [evidence('evidence:mixed-c', '2026-09-03T00:00:00.1003Z')],
    reason_codes: ['mixed_revision_c'],
    value: { kind: 'unknown', value: null },
    value_state: 'unknown',
    attempt_state: 'failed'
  }));

  const summary = buildAccessSummary({ observations: [a, b, c], asOf });
  const revisions = summary.endpoint_scopes[0].revision_history;
  assert.deepEqual(revisions.map(item => item.revision_id), ['revision:mixed-c', 'revision:mixed-b', 'revision:mixed-a']);
  assert.equal(new Set(revisions.map(item => item.revision_id)).size, 3);
  assert.deepEqual(revisions.find(item => item.revision_id === 'revision:mixed-a').evidence_refs.map(item => item.evidence_id), ['evidence:mixed-a']);
  assert.deepEqual(buildAccessSummary({ observations: [c], asOf }).endpoint_scopes[0].revision_history.map(item => item.revision_id), ['revision:mixed-c', 'revision:mixed-b', 'revision:mixed-a']);

  const conflictingNestedRevision = structuredClone(c);
  const nestedB = conflictingNestedRevision.history.find(item => item.revision_id === b.observation_id);
  nestedB.value = { kind: 'integer', value: 99 };
  assert.throws(() => buildAccessSummary({ observations: [c, conflictingNestedRevision], asOf }), { code: 'field_observation_revision_conflict' });
});

test('strict RFC3339 validation rejects normalized dates and preserves sub-millisecond ordering', () => {
  assert.equal(isRfc3339DateTime('2026-02-31T00:00:00.000Z'), false);
  assert.equal(isRfc3339DateTime('09/01/2026'), false);
  assert.equal(compareRfc3339('2026-09-01T00:00:00.1239Z', '2026-09-01T00:00:00.1238Z') > 0, true);
  assert.throws(() => field({ observed_at: '2026-02-31T00:00:00.000Z' }), /FIELD_OBSERVATION_OBSERVED_AT_REQUIRED/u);
  assert.throws(() => field({ observed_at: '09/01/2026' }), /FIELD_OBSERVATION_OBSERVED_AT_REQUIRED/u);
  const malformed = structuredClone(field());
  malformed.observed_at = '2026-02-31T00:00:00.000Z';
  assert.equal(validateSchema(malformed), false);
  assert.match(JSON.stringify(validateSchema.errors), /date-time/u);
});

test('completeness binds access summaries to the vector in full and compact views', () => {
  const membership = [{
    record_id: 'record:access-binding',
    source_id: 'source:access-binding',
    isolated: false,
    evidence_ids: ['evidence:access-binding'],
    source_observed_at: OBSERVED_AT
  }];
  const definitions = [{
    field_id: 'payload.access',
    field_role: 'metadata',
    unit: null,
    required_for_readiness: true,
    description: 'Access binding fixture.'
  }];
  const unattempted = field({
    record_id: membership[0].record_id,
    source_id: membership[0].source_id,
    field_id: 'payload.access',
    field_role: 'metadata',
    unit: null,
    evidence_refs: [evidence('evidence:access-binding-unattempted')],
    value: { kind: 'unknown', value: null },
    value_state: 'unknown',
    applicability_state: 'unknown',
    attempt_state: 'not_attempted',
    attempted_at: null,
    endpoint_scope: { endpoint_id: 'endpoint:access-binding', resource: 'resource:payload', operation: 'payload_read' },
    reason_codes: ['payload_access_not_tested']
  });
  const success = field({
    record_id: membership[0].record_id,
    source_id: membership[0].source_id,
    field_id: 'payload.access',
    field_role: 'metadata',
    unit: null,
    evidence_refs: [evidence('evidence:access-binding-unattempted')],
    reason_codes: ['payload_access_succeeded']
  });
  const fullSuccessSummary = buildAccessSummary({
    observations: [success],
    asOf: '2026-09-04T00:00:00.000Z'
  });
  const compactSuccessSummary = buildAccessSummary({
    observations: [success],
    asOf: '2026-09-04T00:00:00.000Z',
    compact: true
  });
  const input = {
    membership,
    observations: [unattempted],
    fieldDefinitions: definitions,
    cohort: 'access binding fixture',
    generation: 'generation-fixture',
    asOf: '2026-09-04T00:00:00.000Z',
    generatedAt: '2026-09-04T00:00:00.000Z'
  };
  assert.throws(() => buildCompletenessView({ ...input, accessSummary: fullSuccessSummary }), { code: 'access_summary_not_bound' });
  assert.throws(() => buildCompletenessView({ ...input, vectorEncoding: 'compact-v1', accessSummary: compactSuccessSummary }), { code: 'access_summary_not_bound' });
  const honest = buildCompletenessView({
    ...input,
    accessSummary: buildAccessSummary({ observations: [unattempted], asOf: input.asOf })
  });
  assertCompletenessView(honest);
  const compactWithFullSummary = buildCompletenessView({
    ...input,
    vectorEncoding: 'compact-v1',
    accessSummary: buildAccessSummary({ observations: [unattempted], asOf: input.asOf })
  });
  assertCompletenessView(compactWithFullSummary);
  const tampered = rehashView({ ...honest, access_summary: fullSuccessSummary });
  assert.throws(() => assertCompletenessView(tampered), { code: 'completeness_access_summary_mismatch' });
  const forgedFacts = structuredClone(honest);
  forgedFacts.access_summary.endpoint_scopes[0].documented.cost = {
    ...forgedFacts.access_summary.endpoint_scopes[0].documented.cost,
    state: 'documented_free',
    amount: 0,
    currency: 'USD'
  };
  assert.throws(() => assertCompletenessView(rehashView(forgedFacts)), { code: 'completeness_access_summary_mismatch' });
  const forgedBoundary = structuredClone(honest);
  forgedBoundary.access_summary.boundaries.unknown_cost_is_not_free = false;
  assert.throws(() => assertCompletenessView(rehashView(forgedBoundary)), { code: 'access_summary_boundary:unknown_cost_is_not_free' });
});

test('offline views reject future nested clocks and forged evidence bindings', () => {
  const membership = [{ record_id: 'record:clock-binding', source_id: 'source:clock-binding', isolated: false, evidence_ids: ['evidence:clock-binding'], source_observed_at: OBSERVED_AT }];
  const observation = field({
    record_id: membership[0].record_id,
    source_id: membership[0].source_id,
    field_id: 'payload.clock',
    evidence_refs: [evidence('evidence:clock-observation')],
    reason_codes: ['clock_fixture']
  });
  const view = buildCompletenessView({
    membership,
    observations: [observation],
    fieldDefinitions: [{ field_id: 'payload.clock', field_role: 'measure_description', unit: 'item', description: 'Clock fixture.' }],
    cohort: 'clock fixture',
    generation: 'generation-fixture',
    asOf: '2026-09-04T00:00:00.000Z',
    generatedAt: '2026-09-05T00:00:00.000Z',
    inputDigest: INPUT_DIGEST
  });
  assertCompletenessView(view, { expectedInputDigest: INPUT_DIGEST });
  const futureClock = structuredClone(view);
  futureClock.records[0].source_vectors[0].fields[0].observation.stale_at = '2026-09-05T00:00:00.000Z';
  assert.throws(() => assertCompletenessView(rehashView(futureClock)), { code: 'completeness_observation_stale_at' });
  const forgedBinding = structuredClone(view);
  forgedBinding.evidence_catalog[0].bindings[0].record_id = 'record:forged-binding';
  assert.throws(() => assertCompletenessView(rehashView(forgedBinding)), { code: 'completeness_evidence_binding_missing' });
  assert.throws(() => assertCompletenessView(view, { expectedInputDigest: 'sha256:' + '0'.repeat(64) }), { code: 'completeness_expected_input_digest_mismatch' });
});

test('coverage is derived from frozen membership and keeps isolated records in every partition', () => {
  const membership = [
    { record_id: 'record:001', source_id: 'source:catalog', isolated: false, evidence_ids: ['evidence:membership:001'], source_observed_at: OBSERVED_AT },
    { record_id: 'record:002', source_id: 'source:catalog', isolated: false, evidence_ids: ['evidence:membership:002'], source_observed_at: OBSERVED_AT },
    { record_id: 'record:003', source_id: 'source:catalog', isolated: true, isolation_reason: 'description_missing', evidence_ids: ['evidence:membership:003'], source_observed_at: OBSERVED_AT }
  ];
  const definitions = [
    { field_id: 'record.identifier', field_role: 'identifier', unit: null, required_for_readiness: true, description: 'Stable source identifier.' },
    { field_id: 'payload.value', field_role: 'measure_description', unit: 'item', required_for_readiness: true, description: 'Payload value when a scoped check supports it.' }
  ];
  const observations = [
    field({ record_id: 'record:001', source_id: 'source:catalog', field_id: 'record.identifier', field_role: 'identifier', unit: null, value: { kind: 'identifier', value: 'record:001' }, reason_codes: ['metadata_identity_observed'], endpoint_scope: { endpoint_id: 'endpoint:catalog', resource: 'resource:metadata', operation: 'metadata_read' } }),
    field({ record_id: 'record:001', source_id: 'source:catalog', field_id: 'payload.value', value: { kind: 'integer', value: 5 }, reason_codes: ['payload_check_succeeded'] }),
    field({ record_id: 'record:002', source_id: 'source:catalog', field_id: 'record.identifier', field_role: 'identifier', unit: null, value: { kind: 'identifier', value: 'record:002' }, reason_codes: ['metadata_identity_observed'], endpoint_scope: { endpoint_id: 'endpoint:catalog', resource: 'resource:metadata', operation: 'metadata_read' } }),
    field({ record_id: 'record:002', source_id: 'source:catalog', field_id: 'payload.value', value: { kind: 'unknown', value: null }, value_state: 'unknown', applicability_state: 'supported', attempt_state: 'restricted', attempted_at: OBSERVED_AT, reason_codes: ['credential_required'] })
  ];
  const view = buildCompletenessView({
    membership,
    observations,
    fieldDefinitions: definitions,
    cohort: 'PR-002 accepted baseline_records',
    generation: 'live-2026-09-03-85b50522b420',
    asOf: '2026-09-04T00:00:00.000Z',
    generatedAt: '2026-09-04T00:00:00.000Z'
  });
  assertCompletenessView(view);
  assert.equal(validateCompletenessSchema(view), true, JSON.stringify(validateCompletenessSchema.errors));
  assert.equal(view.membership.record_count, 3);
  assert.equal(view.membership.source_membership_count, 3);
  assert.equal(view.membership.isolated_count, 1);
  assert.equal(view.records.length, 3);
  assert.equal(view.records.find(record => record.record_id === 'record:003').isolated, true);
  const missing = view.records.find(record => record.record_id === 'record:003').source_vectors[0].fields.find(item => item.field_id === 'payload.value').observation;
  assert.equal(missing.applicability_state, 'missing');
  assert.equal(missing.attempt_state, 'not_attempted');
  assert.equal(missing.value_state, 'unknown');
  assert.equal(view.records.find(record => record.record_id === 'record:001').readiness_state, 'ready');
  assert.equal(view.records.find(record => record.record_id === 'record:002').readiness_state, 'not_ready');
  const tampered = structuredClone(view);
  tampered.aggregates.metrics[0].partitions[0].count += 1;
  tampered.aggregates.metrics[0].partitions[tampered.aggregates.metrics[0].partitions.length - 1].count -= 1;
  const rehashed = rehashView(tampered);
  assert.throws(() => assertCompletenessView(rehashed), { code: 'completeness_metric_recalculation_mismatch' });
  const payloadMetric = view.aggregates.metrics.find(metric => metric.metric_id === 'field.applicability.payload.value');
  assert.equal(payloadMetric.denominator_count, 3);
  assert.equal(payloadMetric.partitions.reduce((sum, item) => sum + item.count, 0), 3);
  assert.equal(payloadMetric.partitions.find(item => item.state === 'supported').count, 2);
  assert.equal(payloadMetric.rate_context.cohort_definition, 'PR-002 accepted baseline_records');
  assert.equal(payloadMetric.rate_context.generation, 'live-2026-09-03-85b50522b420');
  assert.equal(payloadMetric.rate_context.membership_hash, view.membership.membership_hash);
  assert.equal(view.aggregates.metrics.find(metric => metric.metric_id === 'research.readiness').partitions.reduce((sum, item) => sum + item.count, 0), 3);
});

test('candidate, ambiguous and disputed evidence cannot produce research readiness', () => {
  const membership = [{ record_id: 'record:evidence-state', source_id: 'source:evidence-state', isolated: false, evidence_ids: ['evidence:evidence-state'], source_observed_at: OBSERVED_AT }];
  for (const evidenceState of ['candidate', 'ambiguous', 'disputed']) {
    const observation = field({
      record_id: membership[0].record_id,
      source_id: membership[0].source_id,
      field_id: 'payload.readiness_' + evidenceState,
      evidence_state: evidenceState,
      reason_codes: ['unqualified_evidence']
    });
    const view = buildCompletenessView({
      membership,
      observations: [observation],
      fieldDefinitions: [{ field_id: observation.field_id, field_role: 'measure_description', unit: 'item', required_for_readiness: true, description: 'Evidence readiness fixture.' }],
      cohort: 'evidence readiness fixture',
      generation: 'generation-fixture',
      asOf: '2026-09-04T00:00:00.000Z',
      generatedAt: '2026-09-04T00:00:00.000Z'
    });
    assert.equal(view.records[0].readiness_state, 'not_ready');
  }
});

test('offline coverage consumer is bounded and rejects digest drift or unknown metrics', () => {
  const membership = [
    { record_id: 'record:consumer-1', source_id: 'source:consumer', isolated: false, evidence_ids: ['evidence:consumer:1'], source_observed_at: OBSERVED_AT },
    { record_id: 'record:consumer-2', source_id: 'source:consumer', isolated: false, evidence_ids: ['evidence:consumer:2'], source_observed_at: OBSERVED_AT }
  ];
  const view = buildCompletenessView({
    membership,
    fieldDefinitions: [{ field_id: 'record.identifier', field_role: 'identifier', unit: null, description: 'Identifier.' }],
    cohort: 'consumer fixture',
    generation: 'generation-fixture',
    asOf: '2026-09-04T00:00:00.000Z',
    generatedAt: '2026-09-04T00:00:00.000Z',
    inputDigest: INPUT_DIGEST
  });
  assert.equal(validateCompletenessSchema(view), true, JSON.stringify(validateCompletenessSchema.errors));
  const consumerContext = {
    expectedDigest: view.artifact_digest,
    expectedInputDigest: INPUT_DIGEST,
    expectedMembershipHash: view.membership.membership_hash,
    expectedCohort: 'consumer fixture',
    expectedGeneration: 'generation-fixture',
    expectedAsOf: '2026-09-04T00:00:00.000Z'
  };
  const consumer = createOfflineCompletenessConsumer(view, { ...consumerContext, maxPageSize: 1 });
  assert.equal(consumer.getSummary().membership.record_count, 2);
  assert.equal(consumer.listRecords({ limit: 1 }).records.length, 1);
  assert.equal(consumer.listRecords({ offset: 1, limit: 1 }).records[0].record_id, 'record:consumer-2');
  assert.equal(consumer.getMetric('not-a-real-metric'), null);
  assert.equal(consumer.getRecord('record:consumer-1').record_id, 'record:consumer-1');
  assert.throws(() => createOfflineCompletenessConsumer(view, { ...consumerContext, expectedDigest: 'sha256:' + '0'.repeat(64) }), { code: 'completeness_expected_digest_mismatch' });
  assert.throws(() => createOfflineCompletenessConsumer(view, { expectedDigest: view.artifact_digest }), { code: 'completeness_consumer_context_required' });
  assert.throws(() => consumer.listRecords({ limit: 2 }), { code: 'completeness_limit_invalid' });
  const unknownDenominator = buildCompletenessView({
    membership,
    fieldDefinitions: [{ field_id: 'record.identifier', field_role: 'identifier', unit: null, description: 'Identifier.' }],
    cohort: 'unknown denominator fixture',
    generation: 'generation-fixture',
    asOf: '2026-09-04T00:00:00.000Z',
    generatedAt: '2026-09-04T00:00:00.000Z',
    denominatorStatus: 'unknown'
  });
  assert.equal(unknownDenominator.aggregates.metrics.every(metric => metric.rate === null), true);
});

test('one record keeps successful, restricted and failed checks visible in the vector', () => {
  const membership = [{ record_id: 'record:mixed', source_id: 'source:mixed', isolated: false, evidence_ids: ['evidence:mixed'], source_observed_at: OBSERVED_AT }];
  const success = field({ record_id: 'record:mixed', source_id: 'source:mixed', field_id: 'payload.success', reason_codes: ['payload_success'] });
  const restricted = field({
    record_id: 'record:mixed',
    source_id: 'source:mixed',
    field_id: 'payload.restricted',
    value: { kind: 'unknown', value: null },
    value_state: 'unknown',
    applicability_state: 'supported',
    attempt_state: 'restricted',
    attempted_at: OBSERVED_AT,
    reason_codes: ['credential_required']
  });
  const failed = field({
    record_id: 'record:mixed',
    source_id: 'source:mixed',
    field_id: 'payload.failed',
    value: { kind: 'unknown', value: null },
    value_state: 'unknown',
    applicability_state: 'supported',
    attempt_state: 'failed',
    attempted_at: '2026-09-03T22:22:35.000Z',
    observed_at: '2026-09-03T22:22:35.000Z',
    recorded_at: '2026-09-03T22:22:36.000Z',
    reason_codes: ['malformed_response']
  });
  const view = buildCompletenessView({
    membership,
    observations: [success, restricted, failed],
    fieldDefinitions: [
      { field_id: 'payload.success', field_role: 'measure_description', unit: 'item', description: 'Successful fixture check.' },
      { field_id: 'payload.restricted', field_role: 'measure_description', unit: 'item', description: 'Restricted fixture check.' },
      { field_id: 'payload.failed', field_role: 'measure_description', unit: 'item', description: 'Failed fixture check.' }
    ],
    cohort: 'mixed fixture',
    generation: 'generation-fixture',
    asOf: '2026-09-04T00:00:00.000Z',
    generatedAt: '2026-09-04T00:00:00.000Z',
    accessSummary: buildAccessSummary({ observations: [success, restricted, failed], asOf: '2026-09-04T00:00:00.000Z' })
  });
  assertCompletenessView(view);
  const attempts = view.records[0].source_vectors[0].fields.map(item => item.observation.attempt_state);
  assert.deepEqual(attempts.sort(), ['failed', 'restricted', 'succeeded']);
  assert.equal(view.records[0].readiness_state, 'not_ready');
  assert.equal(view.access_summary.endpoint_scopes.length, 1);
  assert.equal(view.access_summary.endpoint_scopes[0].latest_successful_check.attempt_state, 'succeeded');
  assert.equal(view.access_summary.endpoint_scopes[0].latest_attempt.attempt_state, 'failed');
});

test('checked-in completeness artifact validates as an offline compact view', async () => {
  const packaged = await loadPackagedCompletenessView({ root: ROOT });
  const artifact = packaged.view;
  assert.equal(packaged.decoded.length, ORIGINAL_DECODED_BYTES);
  assert.equal(sha256Hex(packaged.decoded), ORIGINAL_DECODED_SHA256);
  assert.equal(gzipCompletenessBytes(packaged.decoded).equals(packaged.transport), true);
  assert.equal(validateCompletenessSchema(artifact), true, JSON.stringify(validateCompletenessSchema.errors));
  assertCompletenessView(artifact);
  const cohortBytes = await fs.readFile(path.join(ROOT, 'evaluation/research-program/cohorts.json'));
  const artifactContext = {
    expectedDigest: artifact.artifact_digest,
    expectedInputDigest: 'sha256:' + sha256Bytes(cohortBytes),
    expectedMembershipHash: artifact.membership.membership_hash,
    expectedCohort: artifact.cohort,
    expectedGeneration: artifact.generation,
    expectedAsOf: artifact.as_of
  };
  const consumer = createOfflineCompletenessConsumer(artifact, { ...artifactContext, maxPageSize: 25 });
  assert.equal(artifact.vector_encoding, 'compact-v1');
  const compactObservation = artifact.records[0].source_vectors[0].fields[0].observation;
  assert.equal(typeof compactObservation.access_facts === 'object', true);
  assert.equal(typeof compactObservation.core_contracts === 'object', true);
  assert.equal(artifact.evidence_catalog.every(ref => Array.isArray(ref.bindings) && ref.bindings.length > 0), true);
  assert.equal(artifact.evidence_catalog.every(ref => ref.bindings.some(binding => binding.location === 'membership')), true);
  assert.equal(artifact.membership.record_count, 3434);
  assert.equal(artifact.membership.source_membership_count, 3434);
  assert.equal(artifact.membership.isolated_count, 4);
  assert.equal(artifact.records.flatMap(record => record.source_vectors.flatMap(source => source.fields)).length, 13736);
  assert.equal(artifact.aggregates.metrics.length, 25);
  assert.equal(consumer.listRecords({ limit: 25 }).records.length, 25);
  assert.equal(consumer.getSummary().boundaries.aggregate_metrics_are_supplemental_to_full_vector, true);
  assert.equal(artifact.access_summary.boundaries.unknown_cost_is_not_free, true);
  assert.equal(artifact.access_summary.boundaries.unknown_usage_limit_is_not_unlimited, true);
  await assert.rejects(fs.access(packaged.paths.decodedForbidden), { code: 'ENOENT' });
});

test('completeness packaging rejects corrupt, truncated, mismatched-hash and oversize decoding', async () => {
  const packaged = await loadPackagedCompletenessView({ root: ROOT });
  assert.equal(packaged.transport.length, packaged.manifest.transport.bytes);
  assert.equal(sha256Hex(packaged.transport), packaged.manifest.transport.sha256);

  const truncated = packaged.transport.subarray(0, 16);
  assert.throws(() => gunzipCompletenessBytes(truncated), { code: 'completeness_gzip_truncated' });

  const small = Buffer.from('{"fixture":true}\n');
  const smallGzip = gzipCompletenessBytes(small);
  const corrupt = Buffer.from(smallGzip);
  corrupt[corrupt.length - 5] ^= 0xff;
  assert.throws(() => gunzipCompletenessBytes(corrupt), { code: 'completeness_gzip_corrupt' });
  assert.throws(() => gunzipCompletenessBytes(smallGzip, { maxOutputLength: small.length - 1 }), { code: 'completeness_decoded_size_bound' });
  assert.equal(gunzipCompletenessBytes(smallGzip, { maxOutputLength: small.length }).equals(small), true);

  await assert.rejects(
    loadPackagedCompletenessView({
      root: ROOT,
      transportBytes: packaged.transport,
      expectedDecoded: { bytes: ORIGINAL_DECODED_BYTES, sha256: '0'.repeat(64) }
    }),
    { code: 'completeness_decoded_hash_mismatch' }
  );

  const wrongTransportManifest = structuredClone(packaged.manifest);
  wrongTransportManifest.transport.sha256 = '0'.repeat(64);
  await assert.rejects(
    loadPackagedCompletenessView({
      root: ROOT,
      manifestBytes: Buffer.from(`${JSON.stringify(wrongTransportManifest)}\n`),
      transportBytes: packaged.transport
    }),
    { code: 'completeness_transport_hash_mismatch' }
  );

  const tempRoot = await verificationTempRoot();
  const fixtureDir = await fs.mkdtemp(path.join(tempRoot, 'pr004-packaging-'));
  try {
    const fixtureGzip = path.join(fixtureDir, 'truncated.json.gz');
    await fs.writeFile(fixtureGzip, truncated);
    const fixtureBytes = await fs.readFile(fixtureGzip);
    assert.throws(() => gunzipCompletenessBytes(fixtureBytes), { code: 'completeness_gzip_truncated' });
  } finally {
    await fs.rm(fixtureDir, { recursive: true, force: true });
  }
});

function setManifestField(manifest, field, value) {
  const next = structuredClone(manifest);
  const parts = field.split('.');
  let cursor = next;
  for (const part of parts.slice(0, -1)) cursor = cursor[part];
  cursor[parts.at(-1)] = value;
  return next;
}

test('completeness packaging rejects independently altered manifest metadata', async () => {
  const packaged = await loadPackagedCompletenessView({ root: ROOT });
  const cases = [
    ['transport.path', 'controller-fixture-wrong-path.json.gz'],
    ['transport.encoding', 'controller-fixture-wrong-encoding'],
    ['decoded.path', 'controller-fixture-wrong-decoded.json'],
    ['decoded.encoding', 'latin1'],
    ['decoded.git_snapshot.commit', '0'.repeat(40)],
    ['decoded.git_snapshot.path', 'controller-fixture-wrong-snapshot.json'],
    ['compressor.module', 'python:gzip'],
    ['compressor.method', 'compress'],
    ['compressor.level', 1],
    ['compressor.header.mtime', 1],
    ['compressor.header.os', 0],
    ['compressor.header.xfl', 0],
    ['offline_consumption.loader', 'controller-fixture-wrong-loader.mjs'],
    ['offline_consumption.verifier', 'controller-fixture-wrong-verifier.mjs'],
    ['logical.schema_version', 'ushso.completeness-view.v0.0.0'],
    ['logical.artifact_id', 'urn:ushso:completeness-view:controller-fixture'],
    ['logical.artifact_digest', `sha256:${'0'.repeat(64)}`],
    ['logical.vector_encoding', 'full-v1'],
    ['logical.cohort', 'controller-fixture-wrong-cohort'],
    ['logical.generation', 'controller-fixture-wrong-generation'],
    ['logical.as_of', '1999-01-01T00:00:00.000Z'],
    ['logical.input_digest', `sha256:${'0'.repeat(64)}`],
    ['logical.record_count', 1],
    ['logical.source_membership_count', 1],
    ['logical.isolated_count', 0],
    ['logical.searchable_record_count', 1],
    ['logical.vector_field_count', 1],
    ['logical.metric_count', 1],
    ['logical.evidence_catalog_count', 1]
  ];

  const seen = new Set();
  for (const [field, value] of cases) {
    assert.equal(seen.has(field), false, `duplicate negative case for ${field}`);
    seen.add(field);
    const mutated = setManifestField(packaged.manifest, field, value);
    assert.throws(
      () => assertPackagedManifestConsistency({
        manifest: mutated,
        transportBytes: packaged.transport,
        decodedBytes: packaged.decoded,
        view: packaged.view
      }),
      { code: 'completeness_manifest_inconsistent', field },
      field
    );
  }

  const combined = structuredClone(packaged.manifest);
  combined.logical.generation = 'controller-fixture-wrong-generation';
  combined.logical.record_count = 1;
  combined.transport.path = 'controller-fixture-wrong-path.json.gz';
  combined.transport.encoding = 'controller-fixture-wrong-encoding';
  await assert.rejects(
    loadPackagedCompletenessView({
      root: ROOT,
      manifestBytes: Buffer.from(`${JSON.stringify(combined)}\n`),
      transportBytes: packaged.transport
    }),
    { code: 'completeness_manifest_inconsistent' }
  );
});
