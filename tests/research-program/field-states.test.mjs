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
  createFieldObservation,
  deriveFieldObservation,
  validateFieldObservation
} from '../../packages/normalization/src/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OBSERVED_AT = '2026-09-03T22:22:33.908Z';
const schema = JSON.parse(await fs.readFile(path.join(ROOT, 'packages/normalization/schemas/field-observation.schema.json'), 'utf8'));
const ajv = new Ajv2020({ strict: true, strictSchema: true, strictTypes: true, allErrors: true });
ajv.addFormat('date-time', value => typeof value === 'string' && Number.isFinite(Date.parse(value)));
const validateSchema = ajv.compile(schema);

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
    observed_at: '2026-01-01T00:00:00.000Z',
    recorded_at: '2026-01-01T00:00:01.000Z',
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
    recorded_at: '2026-02-01T00:00:01.000Z',
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
  assert.throws(() => createFieldObservation({ ...failed, attempt_state: 'failed', attempted_at: null }), { code: 'field_observation_invalid' });
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
