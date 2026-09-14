import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LAST_GOOD_GENERATION,
  attachRequest,
  attachResult,
  buildExamplePacket,
  representativeExamples,
  validatePacket,
} from '../../packages/enrichment/example-packet.mjs';

test('a packet is invalid if its source/schema generation differs from an attached request or result', () => {
  const packet = buildExamplePacket({
    question: 'Hospital occupancy',
    generation: LAST_GOOD_GENERATION,
    products: [{ product_key: 'cms-hcris-hospital-provider-cost-report', why_needed: 'Occupancy worksheets.' }],
    fields: ['PROVNUM'],
    access_steps: [{ id: 'docs', label: 'Read HCRIS docs', executed: false }],
  });
  assert.equal(packet.generation, LAST_GOOD_GENERATION);
  assert.throws(() => attachRequest(packet, { source_generation: 'other-generation' }), { code: 'PACKET_GENERATION_MISMATCH' });
  assert.throws(() => attachResult(packet, { schema_generation: 'other-schema' }), { code: 'PACKET_GENERATION_MISMATCH' });
  const attached = attachRequest(packet, { source_generation: LAST_GOOD_GENERATION, schema_generation: LAST_GOOD_GENERATION });
  assert.equal(attached.attached_request.source_generation, LAST_GOOD_GENERATION);
});

test('every executed step has a receipt, while a documented but unexecuted step is visibly labeled; restricted steps stay unavailable', () => {
  const examples = representativeExamples();
  const finance = examples.finance_utilization;
  assert.equal(finance.access_steps[0].executed, true);
  assert.ok(finance.access_steps[0].receipt);
  const publicHealth = examples.public_health;
  assert.equal(publicHealth.access_steps[0].executed, false);
  assert.equal(publicHealth.access_steps[0].documented_unexecuted, true);
  assert.equal(publicHealth.access_steps[0].unavailable_restricted, true);
  assert.throws(() => buildExamplePacket({
    question: 'x',
    generation: LAST_GOOD_GENERATION,
    products: [{ product_key: 'cms-hcris-hospital-provider-cost-report', why_needed: 'x' }],
    fields: ['PROVNUM'],
    access_steps: [{ id: 'live', label: 'Execute without receipt', executed: true }],
  }), { code: 'EXECUTED_STEP_REQUIRES_RECEIPT' });
});

test('a changed source schema invalidates the example and preserves its previous dated version; no live data is fabricated for a demo', () => {
  const packet = representativeExamples().insurance_geography;
  const changed = validatePacket(packet, { currentSchema: 'schema-next' });
  assert.equal(changed.valid, false);
  assert.equal(changed.invalidated_by, 'SOURCE_SCHEMA_CHANGED');
  assert.equal(changed.previous_dated_version, LAST_GOOD_GENERATION);
  assert.throws(() => attachResult(packet, { source_generation: LAST_GOOD_GENERATION, schema_generation: LAST_GOOD_GENERATION, fabricated: true }), { code: 'LIVE_DATA_FABRICATED' });
  assert.equal(packet.expected.kind, 'field_type_shape');
  assert.equal(packet.expected.values, null);
  assert.throws(() => buildExamplePacket({
    question: 'x',
    generation: LAST_GOOD_GENERATION,
    products: [{ product_key: 'cms-hcris-hospital-provider-cost-report', why_needed: 'x' }],
    fields: ['PROVNUM'],
    access_steps: [{ id: 'docs', label: 'docs', executed: false }],
    expected_values: { NET_PATIENT_REVENUE: 123456 },
  }), { code: 'FRAGILE_NUMERIC_CONSTANT' });
});
