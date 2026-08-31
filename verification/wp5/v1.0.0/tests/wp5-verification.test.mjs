import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { buildLegacyLaneParity, deliveryWaveManifest, validateDeliveryWaveRegistry, validateRegulatorApcdRegistry } from '../../../../packages/connectors/src/index.mjs';
import { runFixtureMatrix } from '../../../../packages/connectors/src/testing/fixture-matrix.mjs';
import { runReconciliationAudit } from '../../../../packages/connectors/src/testing/reconciliation-audit.mjs';
import { runDeliveryWaveFixtureMatrix } from '../../../../packages/connectors/src/testing/wave-fixtures.mjs';
import { connectorFingerprint, readJson, repositoryRoot, verificationRoot } from '../tools/common.mjs';

test('pinned implementation fingerprint matches current connector bytes', async () => {
  const expected = 'd03bc9986c768dc16ad6bc96191bee9fea691ee8803af4311c4e1ec945944003';
  assert.equal(await connectorFingerprint(), expected);
  const receipts = await Promise.all([
    'receipts/fixture-matrix.json', 'receipts/request-capture-reconciliation.json',
    'receipts/r2-capture-protocol.json', 'receipts/zero-payload-proof.json',
    'receipts/activation-status.json', 'receipts/delivery-wave-fixtures.json',
    'receipts/legacy-lane-parity.json', 'evidence-ledger.json',
  ].map(readJson));
  assert.ok(receipts.every((receipt) => receipt.implementation_fingerprint === expected));
});

test('delivery-wave receipt exactly matches executable adapters, descriptors, fixtures, and registries', async () => {
  const receipt = await readJson('receipts/delivery-wave-fixtures.json');
  const matrix = await runDeliveryWaveFixtureMatrix();
  assert.equal(receipt.status, 'PASS_FIXTURE_ONLY_EXTERNAL_STAGES_PENDING');
  assert.equal(receipt.descriptor_templates, deliveryWaveManifest().length);
  assert.equal(receipt.source_specific_instances, validateDeliveryWaveRegistry().source_instances);
  assert.equal(validateRegulatorApcdRegistry().entries, 8);
  assert.equal(receipt.recorded_offline_fixtures, matrix.recorded_fixtures);
  assert.equal(receipt.fixture_manifest_digest, matrix.fixture_manifest_digest);
  assert.equal(receipt.scenario_count, matrix.totals.scenarios);
  assert.equal(receipt.assertion_count, matrix.totals.assertions);
  assert.deepEqual(receipt.scenarios, matrix.scenarios.map((scenario) => scenario.scenario));
  assert.equal(receipt.external_authorization_gate, 'AUTH-04');
  assert.equal(receipt.activation_authorized, false);
  assert.ok(Object.values(matrix.zero_external_actions).every((value) => value === 0));
});

test('legacy Dataverse/DataCite parity receipt matches the pinned canonical corpus', async () => {
  const receipt = await readJson('receipts/legacy-lane-parity.json');
  const bytes = await readFile(path.join(repositoryRoot, receipt.source_artifact));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.source_artifact_sha256);
  const parity = buildLegacyLaneParity(bytes.toString('utf8').trim().split(/\n/).map(JSON.parse));
  assert.deepEqual(receipt.counts, parity.counts);
  assert.equal(receipt.records_reconciled, parity.records);
  assert.equal(receipt.mapping_digest, parity.mapping_digest);
  assert.equal(receipt.stable_id_collisions, 0);
  assert.equal(receipt.missing_source_evidence, 0);
  assert.equal(receipt.missing_provenance_links, 0);
  assert.equal(receipt.automatic_identity_merges, 0);
  assert.equal(receipt.authority_precedence, 'below_first_party_government');
});

test('fixture matrix receipt exactly matches executable matrix', async () => {
  const receipt = await readJson('receipts/fixture-matrix.json');
  const matrix = await runFixtureMatrix();
  assert.equal(receipt.status, matrix.status);
  assert.equal(receipt.evidence_scope, matrix.fixture_scope);
  assert.equal(receipt.integration_level, matrix.integration_level);
  assert.equal(receipt.scenario_count, matrix.totals.scenarios);
  assert.equal(receipt.assertion_count, matrix.totals.assertions);
  assert.deepEqual(receipt.scenarios, matrix.scenarios.map((scenario) => scenario.scenario));
  assert.equal(receipt.external_actions, 0);
});

test('request/capture receipt exactly matches executable reconciliation audit', async () => {
  const receipt = await readJson('receipts/request-capture-reconciliation.json');
  const audit = await runReconciliationAudit();
  assert.equal(receipt.status, audit.status);
  assert.equal(receipt.approved_descriptor_templates, audit.approved_descriptor_templates);
  assert.equal(receipt.declared_route_templates, audit.declared_routes);
  assert.equal(receipt.audit_outbound_requests_ledgered, audit.outbound_requests_ledgered);
  assert.equal(receipt.audit_discoveries, audit.discoveries);
  assert.equal(receipt.audit_exact_locator_capture_links, audit.exact_locator_capture_links);
  assert.equal(receipt.audit_capture_references, audit.capture_references);
  assert.equal(receipt.audit_content_addressed_objects, audit.content_addressed_objects);
  assert.deepEqual(receipt.accepted_capture_classifications, audit.accepted_capture_classifications);
  assert.equal(receipt.prohibited_capture_classifications, audit.prohibited_capture_classifications);
  assert.equal(receipt.blocked_sentinel_transport_calls, audit.blocked_sentinel_transport_calls);
  assert.equal(receipt.healthcare_row_captures, audit.healthcare_row_captures);
});

test('activation receipt claims only fixture and local integration passes', async () => {
  const receipt = await readJson('receipts/activation-status.json');
  assert.equal(receipt.stages.fixture_only.status, 'PASS');
  assert.equal(receipt.stages.local_integration.status, 'PASS');
  for (const stage of ['live_shadow', 'index_shadow', 'canary', 'active']) {
    assert.equal(receipt.stages[stage].status, 'PENDING_EXTERNAL_AUTHORIZATION');
  }
  assert.equal(receipt.authorization_not_granted, true);
  assert.equal(receipt.external_authorization_gate, 'AUTH-04');
  assert.equal(receipt.source_specific_instances, 18);
  assert.equal(receipt.all_sources_fixture_only_paused_candidate, true);
  assert.equal(receipt.deployment_performed, false);
  assert.equal(receipt.paid_infrastructure_used, false);
});

test('evidence ledger is complete, path-resolved, and honest about external work', async () => {
  const ledger = await readJson('evidence-ledger.json');
  assert.ok(ledger.controls.length >= 24);
  const ids = new Set();
  for (const control of ledger.controls) {
    assert.equal(ids.has(control.id), false, control.id);
    ids.add(control.id);
    assert.ok(['PASS_LOCAL', 'PASS_FIXTURE_TEMPLATE_ONLY', 'PENDING_EXTERNAL_AUTHORIZATION'].includes(control.status));
    for (const file of [...control.implementation, ...control.verification]) await access(path.join(repositoryRoot, file));
    await access(path.join(verificationRoot, control.receipt));
  }
  assert.equal(ledger.controls.find((control) => control.id === 'WP5-ACTIVATION').status, 'PENDING_EXTERNAL_AUTHORIZATION');
});

test('zero-payload and R2 receipts do not overclaim live execution', async () => {
  const zero = await readJson('receipts/zero-payload-proof.json');
  assert.equal(zero.source_data_payload_transport_calls, 0);
  assert.equal(zero.source_data_payload_captures, 0);
  assert.equal(zero.healthcare_row_captures, 0);
  assert.equal(zero.credential_values_persisted, 0);
  assert.equal(zero.live_dns_queries, 0);
  assert.equal(zero.live_network_requests, 0);
  const r2 = await readJson('receipts/r2-capture-protocol.json');
  assert.equal(r2.live_r2_called, false);
  assert.equal(r2.port_under_test, 'fake_object_store_with_r2_semantics');
  assert.ok(Object.values(r2.verified).every(Boolean));
});
