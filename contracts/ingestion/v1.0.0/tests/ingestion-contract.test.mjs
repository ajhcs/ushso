import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { canonicalJson, canonicalJsonSha256, PACKAGE_ROOT, readJson } from '../tools/common.mjs';
import { validateIngestionRecord } from '../tools/index.mjs';
import { loadSchemas, validatorForFile } from '../tools/schema.mjs';
import { stateDefinitions, validateTransition } from '../tools/semantics.mjs';
import { validatePackage } from '../tools/validate-package.mjs';

test('all JSON Schemas compile in strict 2020-12 mode and all positive fixtures validate', async () => {
  const { schemas } = await loadSchemas();
  assert.equal(schemas.length, 16);
  const fixtures = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-fixtures.json'));
  for (const fixture of fixtures.records) {
    const result = await validateIngestionRecord(fixture.schema, fixture.value);
    assert.equal(result.valid, true, `${fixture.fixture_id}: ${JSON.stringify(result.issues)}`);
  }
});

test('every adversarial fixture is rejected by its pinned stable reason code', async () => {
  const { report, adversarialResults } = await validatePackage({ checkStoredReceipt: false });
  assert.equal(report.valid, true, report.errors.join('\n'));
  assert.equal(adversarialResults.length, 25);
  assert.ok(adversarialResults.every(result => result.passed), JSON.stringify(adversarialResults.filter(result => !result.passed), null, 2));
});

test('state fixtures enumerate every exact state and terminal/retry/drain transitions fail closed', async () => {
  const transitions = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'state-transitions.json'));
  const definitions = stateDefinitions();
  for (const machine of transitions.machines) assert.deepEqual(machine.states, definitions[machine.machine]);
  assert.deepEqual(validateTransition('run', 'failed', 'starting'), { allowed: false, code: 'STATE_TRANSITION_INVALID' });
  assert.deepEqual(validateTransition('job', 'leased', 'pending', { lease_expired: false }), { allowed: false, code: 'LEASE_NOT_EXPIRED' });
  assert.deepEqual(validateTransition('source', 'draining', 'paused', { drain_reconciled: false, audit_present: true }), { allowed: false, code: 'PAUSE_DRAIN_INCOMPLETE' });
});

test('strict capture and event schemas reject source payload bodies and embedded secrets', async () => {
  const fixtures = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-fixtures.json'));
  const capture = structuredClone(fixtures.records.find(record => record.fixture_id === 'valid_capture_reference').value);
  capture.payload = [{ synthetic_patient_id: 'PAYLOAD_SENTINEL' }];
  const captureSchema = await validatorForFile('capture-reference.schema.json');
  assert.equal(captureSchema(capture), false);
  const source = structuredClone(fixtures.records.find(record => record.fixture_id === 'valid_source_descriptor').value);
  source.credential_secret_locator = 'plain-text-secret';
  const sourceSchema = await validatorForFile('source-descriptor.schema.json');
  assert.equal(sourceSchema(source), false);
});

test('canonical JSON digest is key-order independent and explicitly distinct from raw file-byte hashing', async () => {
  const left = { z: 1, a: { y: 2, b: 3 } };
  const right = { a: { b: 3, y: 2 }, z: 1 };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(canonicalJsonSha256(left), canonicalJsonSha256(right));
  const manifest = await readJson(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json'));
  assert.equal(manifest.digest_taxonomy[0].digest_type, 'raw_file_sha256');
  assert.equal(manifest.digest_taxonomy[1].digest_type, 'canonical_json_sha256');
  assert.notEqual(manifest.files.find(file => file.path === 'package.json').raw_file_sha256, manifest.files.find(file => file.path === 'package.json').canonical_json_sha256);
});

test('validation report is deterministic and attests a zero-action truth boundary', async () => {
  const first = await validatePackage({ checkStoredReceipt: false });
  const second = await validatePackage({ checkStoredReceipt: false });
  assert.equal(canonicalJson(first.report), canonicalJson(second.report));
  assert.deepEqual(first.report.zero_action_counters, {
    external_requests: 0,
    source_payload_downloads: 0,
    source_data_rows_captured: 0,
    authorization_submissions: 0,
    identity_merges: 0,
    analyses_executed: 0,
    raw_questions_persisted: 0,
    secret_values_persisted: 0
  });
  assert.equal((await fs.stat(path.join(PACKAGE_ROOT, 'validation', 'validation-receipt.json'))).isFile(), true);
});
