import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { canonicalJson, canonicalJsonSha256, PACKAGE_ROOT, readJson, sha256File } from '../tools/common.mjs';
import { validateIngestionRecord } from '../tools/index.mjs';
import {
  assertCloudflareWorkflowInstanceId,
  isCloudflareWorkflowInstanceId,
  upgradeHarvestRunV10ToV11,
} from '../tools/workflow-instance-id.mjs';
import { loadSchemas, validatorForFile } from '../tools/schema.mjs';
import { stateDefinitions, validateTransition } from '../tools/semantics.mjs';
import { validatePackage } from '../tools/validate-package.mjs';
import { validateIngestionRecord as validateV10IngestionRecord } from '../../v1.0.0/tools/index.mjs';

const PREDECESSOR_ROOT = path.resolve(PACKAGE_ROOT, '../v1.0.0');
const PREDECESSOR_PINS = Object.freeze({
  'manifests/package-manifest.json': '071b06d4fa03fd38c5bb1c522493a66d59f767b51f4bea9d26edd596858f929d',
  'validation/validation-receipt.json': 'be197529eb1e1714b0756fe5cca40543f1234cc553112ff33e45817ed13969b6',
  'schemas/harvest-run.schema.json': '9ff550bc27f9e70e418c8a586b0798eeafa122357ec8e9d99c4dc2a4b566f959',
  'tools/semantics.mjs': '26801e00b82be3668e3befcf756881d1795fe8739c04237596cda8026b507639',
});

test('all JSON Schemas compile in strict 2020-12 mode and all positive fixtures validate', async () => {
  const { schemas } = await loadSchemas();
  assert.equal(schemas.length, 17);
  const fixtures = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-fixtures.json'));
  for (const fixture of fixtures.records) {
    const result = await validateIngestionRecord(fixture.schema, fixture.value);
    assert.equal(result.valid, true, `${fixture.fixture_id}: ${JSON.stringify(result.issues)}`);
  }
});

test('every adversarial fixture is rejected by its pinned stable reason code', async () => {
  const { report, adversarialResults } = await validatePackage({ checkStoredReceipt: false });
  assert.equal(report.valid, true, report.errors.join('\n'));
  assert.equal(adversarialResults.length, 28);
  assert.ok(adversarialResults.every(result => result.passed), JSON.stringify(adversarialResults.filter(result => !result.passed), null, 2));
});

test('v1.0 predecessor bytes stay sealed and non-provider semantics stay byte-identical', async () => {
  for (const [relative, expected] of Object.entries(PREDECESSOR_PINS)) {
    assert.equal(await sha256File(path.join(PREDECESSOR_ROOT, relative)), expected, relative);
  }
  assert.equal(
    await sha256File(path.join(PACKAGE_ROOT, 'tools/semantics.mjs')),
    PREDECESSOR_PINS['tools/semantics.mjs'],
  );
});

test('v1.1 is a strict provider-compatible subset with an explicit no-remap upgrade', async () => {
  const [v10Fixtures, v11Fixtures] = await Promise.all([
    readJson(path.join(PREDECESSOR_ROOT, 'fixtures/valid-fixtures.json')),
    readJson(path.join(PACKAGE_ROOT, 'fixtures/valid-fixtures.json')),
  ]);
  for (const fixture of v11Fixtures.records) {
    const downgraded = { ...fixture.value, contract_version: 'ingestion.v1.0.0' };
    const result = await validateV10IngestionRecord(fixture.schema, downgraded);
    assert.equal(result.valid, true, `${fixture.fixture_id}: ${JSON.stringify(result.issues)}`);
  }

  const v10 = structuredClone(v10Fixtures.records.find(record => record.fixture_id === 'valid_harvest_run').value);
  const v11 = structuredClone(v11Fixtures.records.find(record => record.fixture_id === 'valid_harvest_run').value);
  const upgraded = await upgradeHarvestRunV10ToV11(v10);
  assert.equal((await validateIngestionRecord('harvest-run.schema.json', upgraded)).valid, true);
  assert.deepEqual({ ...upgraded, contract_version: 'ingestion.v1.0.0' }, v10);
  assert.equal((await validateV10IngestionRecord('harvest-run.schema.json', { ...v11, contract_version: 'ingestion.v1.0.0' })).valid, true);

  const maxRunId = `run_${'a'.repeat(86)}`;
  const maxInstanceId = `harvest-${maxRunId}-1`;
  assert.equal(maxInstanceId.length, 100);
  v11.run_id = maxRunId;
  v11.workflow.instance_id = maxInstanceId;
  assert.equal((await validateIngestionRecord('harvest-run.schema.json', v11)).valid, true);

  const compatibility = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'workflow-instance-id-compatibility.json'));
  const compatibilityValidator = await validatorForFile('workflow-instance-id-compatibility-fixture.schema.json');
  assert.equal(compatibilityValidator(compatibility), true);
  for (const fixture of compatibility.cases.filter(testCase => !testCase.expected_v1_1_valid)) {
    const legacy = structuredClone(v10);
    legacy.run_id = fixture.run_id;
    legacy.active_attempt = fixture.active_attempt;
    legacy.workflow.instance_id = fixture.instance_id;
    assert.equal((await validateV10IngestionRecord('harvest-run.schema.json', legacy)).valid, true);
    await assert.rejects(upgradeHarvestRunV10ToV11(legacy), /WORKFLOW_INSTANCE_ID_PROVIDER_INCOMPATIBLE/u);
    const successorCandidate = { ...legacy, contract_version: 'ingestion.v1.1.0' };
    assert.equal((await validateIngestionRecord('harvest-run.schema.json', successorCandidate)).valid, false);
  }
});

test('Cloudflare instance-ID validator enforces the exact alphabet and 100-character bound', () => {
  assert.equal(isCloudflareWorkflowInstanceId(`harvest-run_${'a'.repeat(32)}-1`), true);
  assert.equal(isCloudflareWorkflowInstanceId(`harvest-run_${'a'.repeat(32)}:1`), false);
  assert.equal(isCloudflareWorkflowInstanceId(`harvest-run_${'a'.repeat(32)}.1`), false);
  assert.equal(isCloudflareWorkflowInstanceId(`a${'b'.repeat(99)}`), true);
  assert.equal(isCloudflareWorkflowInstanceId(`a${'b'.repeat(100)}`), false);
  for (const value of ['contains/slash', 'contains space', 'contains.dot', 'contains:colon', 'unicode-é', 'trailing-newline\n']) {
    assert.equal(isCloudflareWorkflowInstanceId(value), false, JSON.stringify(value));
  }
  assert.throws(() => assertCloudflareWorkflowInstanceId('-leading-hyphen'), /WORKFLOW_INSTANCE_ID_PROVIDER_INCOMPATIBLE/u);
});

test('v1.1 upgrade helper rejects malformed predecessor records before transforming them', async () => {
  await assert.rejects(
    upgradeHarvestRunV10ToV11({
      contract_version: 'ingestion.v1.0.0',
      run_id: 'run_0123456789abcdef0123456789abcdef',
      active_attempt: 1,
      workflow: { instance_id: 'harvest-run_0123456789abcdef0123456789abcdef-1' },
    }),
    /HARVEST_RUN_PREDECESSOR_INVALID/u,
  );
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
