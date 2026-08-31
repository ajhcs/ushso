import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildLegacyLaneParity, deliveryWaveManifest, validateDeliveryWaveRegistry, validateRegulatorApcdRegistry } from '../../../../packages/connectors/src/index.mjs';
import { runFixtureMatrix } from '../../../../packages/connectors/src/testing/fixture-matrix.mjs';
import { runReconciliationAudit } from '../../../../packages/connectors/src/testing/reconciliation-audit.mjs';
import { runDeliveryWaveFixtureMatrix } from '../../../../packages/connectors/src/testing/wave-fixtures.mjs';
import { connectorFingerprint, readJson, repositoryRoot, verificationRoot } from './common.mjs';

const fingerprint = await connectorFingerprint();
const ledger = await readJson('evidence-ledger.json');
const matrixReceipt = await readJson('receipts/fixture-matrix.json');
const reconciliationReceipt = await readJson('receipts/request-capture-reconciliation.json');
const r2Receipt = await readJson('receipts/r2-capture-protocol.json');
const zeroPayloadReceipt = await readJson('receipts/zero-payload-proof.json');
const activationReceipt = await readJson('receipts/activation-status.json');
const deliveryWaveReceipt = await readJson('receipts/delivery-wave-fixtures.json');
const legacyParityReceipt = await readJson('receipts/legacy-lane-parity.json');
const receipts = [matrixReceipt, reconciliationReceipt, r2Receipt, zeroPayloadReceipt, activationReceipt, deliveryWaveReceipt, legacyParityReceipt, ledger];

assert.ok(receipts.every((receipt) => receipt.implementation_fingerprint === fingerprint));
assert.equal(ledger.scope, 'fixture_only_local_integration');
assert.equal(new Set(ledger.controls.map((control) => control.id)).size, ledger.controls.length);
for (const control of ledger.controls) {
  for (const file of [...control.implementation, ...control.verification]) await access(path.join(repositoryRoot, file));
  await access(path.join(verificationRoot, control.receipt));
}

const matrix = await runFixtureMatrix();
assert.equal(matrix.status, 'PASS');
assert.equal(matrix.totals.scenarios, matrixReceipt.scenario_count);
assert.equal(matrix.totals.assertions, matrixReceipt.assertion_count);
assert.deepEqual(matrix.scenarios.map((scenario) => scenario.scenario), matrixReceipt.scenarios);
assert.ok(Object.values(matrix.zero_external_actions).every((value) => value === 0));

const deliveryWaves = await runDeliveryWaveFixtureMatrix();
assert.equal(deliveryWaves.status, 'PASS');
assert.equal(deliveryWaves.totals.scenarios, deliveryWaveReceipt.scenario_count);
assert.equal(deliveryWaves.totals.assertions, deliveryWaveReceipt.assertion_count);
assert.equal(deliveryWaves.recorded_fixtures, deliveryWaveReceipt.recorded_offline_fixtures);
assert.equal(deliveryWaves.fixture_manifest_digest, deliveryWaveReceipt.fixture_manifest_digest);
assert.deepEqual(deliveryWaves.scenarios.map((scenario) => scenario.scenario), deliveryWaveReceipt.scenarios);
assert.equal(deliveryWaveManifest().length, deliveryWaveReceipt.descriptor_templates);
assert.equal(validateDeliveryWaveRegistry().source_instances, deliveryWaveReceipt.source_specific_instances);
assert.equal(validateRegulatorApcdRegistry().entries, 8);
assert.ok(Object.values(deliveryWaves.zero_external_actions).every((value) => value === 0));

const legacyBytes = await readFile(path.join(repositoryRoot, legacyParityReceipt.source_artifact));
assert.equal(createHash('sha256').update(legacyBytes).digest('hex'), legacyParityReceipt.source_artifact_sha256);
const parity = buildLegacyLaneParity(legacyBytes.toString('utf8').trim().split(/\n/).map(JSON.parse));
assert.deepEqual(parity.counts, legacyParityReceipt.counts);
assert.equal(parity.records, legacyParityReceipt.records_reconciled);
assert.equal(parity.mapping_digest, legacyParityReceipt.mapping_digest);
assert.equal(parity.automatic_identity_merges, 0);

const reconciliation = await runReconciliationAudit();
assert.equal(reconciliation.status, 'PASS');
assert.equal(reconciliation.discoveries, reconciliationReceipt.audit_discoveries);
assert.equal(reconciliation.exact_locator_capture_links, reconciliationReceipt.audit_exact_locator_capture_links);
assert.equal(reconciliation.prohibited_capture_classifications, 0);
assert.equal(reconciliation.blocked_sentinel_transport_calls, 0);
assert.equal(reconciliation.healthcare_row_captures, 0);

assert.equal(zeroPayloadReceipt.source_data_payload_routes_declared, 0);
assert.equal(zeroPayloadReceipt.source_data_payload_captures, 0);
assert.equal(zeroPayloadReceipt.healthcare_row_captures, 0);
assert.equal(zeroPayloadReceipt.live_network_requests, 0);
assert.equal(r2Receipt.live_r2_called, false);
assert.ok(Object.values(r2Receipt.verified).every(Boolean));
assert.equal(activationReceipt.stages.fixture_only.status, 'PASS');
assert.equal(activationReceipt.stages.local_integration.status, 'PASS');
assert.equal(activationReceipt.external_authorization_gate, 'AUTH-04');
assert.equal(activationReceipt.source_specific_instances, 18);
for (const stage of ['live_shadow', 'index_shadow', 'canary', 'active']) {
  assert.equal(activationReceipt.stages[stage].status, 'PENDING_EXTERNAL_AUTHORIZATION');
}

const receiptText = await readFile(path.join(verificationRoot, 'receipts/zero-payload-proof.json'), 'utf8');
for (const forbidden of ['fixture-secret-never-persist', 'authorization: bearer', 'x-amz-signature=']) {
  assert.equal(receiptText.toLowerCase().includes(forbidden), false);
}

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  work_package: 'WP5',
  evidence_scope: 'fixture_only',
  integration_level: 'local_integration',
  implementation_fingerprint: fingerprint,
  controls: ledger.controls.length,
  fixture_scenarios: matrix.totals.scenarios,
  delivery_wave_scenarios: deliveryWaves.totals.scenarios,
  recorded_delivery_wave_fixtures: deliveryWaves.recorded_fixtures,
  assertions: matrix.totals.assertions + deliveryWaves.totals.assertions,
  legacy_lane_records_reconciled: parity.records,
  reconciled_discoveries: reconciliation.discoveries,
  prohibited_captures: 0,
  external_actions: 0,
  live_shadow: 'PENDING_EXTERNAL_AUTHORIZATION',
  canary: 'PENDING_EXTERNAL_AUTHORIZATION',
  active: 'PENDING_EXTERNAL_AUTHORIZATION'
}, null, 2)}\n`);
