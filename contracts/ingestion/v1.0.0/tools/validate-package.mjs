import fs from 'node:fs/promises';
import path from 'node:path';
import { applyMutations, canonicalJson, canonicalJsonSha256, exists, PACKAGE_ROOT, readJson, sha256File, walkFiles, writeDeterministicJson } from './common.mjs';
import { loadSchemas, validationMessage, validatorForFile } from './schema.mjs';
import { stateDefinitions, validateRecordSemantics, validateRecordSet, validateTransition } from './semantics.mjs';

const MANIFEST_PATH = path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json');
const RECEIPT_PATH = path.join(PACKAGE_ROOT, 'validation', 'validation-receipt.json');
const EXCLUDED = new Set(['manifests/package-manifest.json', 'validation/validation-receipt.json']);

function add(errors, code, detail) {
  errors.push(`${code}:${detail}`);
}

async function validateManifest(errors) {
  if (!await exists(MANIFEST_PATH)) {
    add(errors, 'MANIFEST_MISSING', 'run npm run manifest');
    return { verified: false, raw: '0'.repeat(64), canonical: '0'.repeat(64), positive: 0 };
  }
  const manifest = await readJson(MANIFEST_PATH);
  const validate = await validatorForFile('package-manifest.schema.json');
  if (!validate(manifest)) add(errors, 'MANIFEST_SCHEMA_INVALID', validationMessage(validate));
  const physical = (await walkFiles(PACKAGE_ROOT)).filter(relative => !EXCLUDED.has(relative));
  const listed = manifest.files.map(file => file.path);
  if (canonicalJson(physical) !== canonicalJson(listed)) add(errors, 'MANIFEST_FILE_SET_MISMATCH', `${physical.length}:${listed.length}`);
  let bytes = 0;
  let positive = 0;
  for (const entry of manifest.files) {
    const absolute = path.join(PACKAGE_ROOT, entry.path);
    if (!await exists(absolute)) { add(errors, 'MANIFEST_FILE_MISSING', entry.path); continue; }
    const stats = await fs.stat(absolute);
    bytes += stats.size;
    if (stats.size !== entry.bytes) add(errors, 'MANIFEST_BYTE_MISMATCH', entry.path);
    else positive += 1;
    if (await sha256File(absolute) !== entry.raw_file_sha256) add(errors, 'MANIFEST_RAW_DIGEST_MISMATCH', entry.path);
    else positive += 1;
    if (entry.path.endsWith('.json')) {
      const digest = canonicalJsonSha256(await readJson(absolute));
      if (digest !== entry.canonical_json_sha256) add(errors, 'MANIFEST_CANONICAL_DIGEST_MISMATCH', entry.path);
      else positive += 1;
    } else if (entry.canonical_json_sha256 !== null) add(errors, 'MANIFEST_CANONICAL_DIGEST_SCOPE_INVALID', entry.path);
  }
  if (manifest.file_count !== manifest.files.length) add(errors, 'MANIFEST_FILE_COUNT_MISMATCH', `${manifest.file_count}:${manifest.files.length}`);
  if (manifest.payload_bytes !== bytes) add(errors, 'MANIFEST_PAYLOAD_BYTES_MISMATCH', `${manifest.payload_bytes}:${bytes}`);
  return {
    verified: !errors.some(error => error.startsWith('MANIFEST_')),
    raw: await sha256File(MANIFEST_PATH),
    canonical: canonicalJsonSha256(manifest),
    positive
  };
}

function schemaValidate(validate, value, label, errors) {
  if (!validate(value)) {
    add(errors, 'SCHEMA_INVALID', `${label}:${validationMessage(validate)}`);
    return false;
  }
  return true;
}

async function evaluateAdversarialCase(testCase, records, recordById) {
  if (testCase.kind === 'transition') {
    const result = validateTransition(testCase.context.machine, testCase.context.from, testCase.context.to, testCase.context);
    return result.allowed ? 'ACCEPTED' : result.code;
  }
  const base = recordById.get(testCase.base_fixture_id);
  if (!base) return 'BASE_FIXTURE_MISSING';
  const mutatedValue = applyMutations(base.value, testCase.mutations);
  const schema = await validatorForFile(base.schema);
  if (!schema(mutatedValue)) return 'SCHEMA_INVALID';
  const localIssues = validateRecordSemantics(base.schema, mutatedValue);
  if (testCase.kind === 'record') return localIssues[0]?.code ?? 'ACCEPTED';
  if (localIssues.length) return localIssues[0].code;
  const candidate = { fixture_id: `adversarial_${testCase.case_id}`, schema: base.schema, value: mutatedValue };
  return validateRecordSet([...records, candidate])[0]?.code ?? 'ACCEPTED';
}

export async function validatePackage({ writeReceipt = false, checkStoredReceipt = true } = {}) {
  const errors = [];
  let positive = 0;
  const { schemas } = await loadSchemas();
  const validBundle = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-fixtures.json'));
  const adversarialBundle = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'adversarial-fixtures.json'));
  const transitions = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'state-transitions.json'));
  const fixtureBundleValidator = await validatorForFile('fixture-bundle.schema.json');
  if (schemaValidate(fixtureBundleValidator, validBundle, 'valid-fixtures.json', errors)) positive += 1;
  if (schemaValidate(fixtureBundleValidator, adversarialBundle, 'adversarial-fixtures.json', errors)) positive += 1;
  const transitionFixtureValidator = await validatorForFile('state-transition-fixture.schema.json');
  if (schemaValidate(transitionFixtureValidator, transitions, 'state-transitions.json', errors)) positive += 1;

  for (const record of validBundle.records) {
    const validate = await validatorForFile(record.schema);
    if (schemaValidate(validate, record.value, record.fixture_id, errors)) positive += 1;
    const semanticIssues = validateRecordSemantics(record.schema, record.value);
    for (const semanticIssue of semanticIssues) add(errors, semanticIssue.code, `${record.fixture_id}${semanticIssue.pointer}`);
    if (semanticIssues.length === 0) positive += 1;
  }
  const recordSetIssues = validateRecordSet(validBundle.records);
  for (const semanticIssue of recordSetIssues) add(errors, semanticIssue.code, semanticIssue.detail);
  if (recordSetIssues.length === 0) positive += 1;

  const transitionDefinitions = stateDefinitions();
  let transitionCases = 0;
  let transitionStates = 0;
  for (const machineFixture of transitions.machines) {
    transitionStates += machineFixture.states.length;
    if (canonicalJson(machineFixture.states) !== canonicalJson(transitionDefinitions[machineFixture.machine])) add(errors, 'STATE_ENUM_COVERAGE_MISMATCH', machineFixture.machine);
    else positive += 1;
    const touched = new Set();
    for (const testCase of machineFixture.cases) {
      transitionCases += 1;
      touched.add(testCase.from); touched.add(testCase.to);
      const observed = validateTransition(machineFixture.machine, testCase.from, testCase.to, testCase.context).allowed ? 'allowed' : 'rejected';
      if (observed !== testCase.expected) add(errors, 'TRANSITION_CASE_FAILED', `${machineFixture.machine}:${testCase.from}>${testCase.to}:${testCase.expected}:${observed}`);
      else positive += 1;
    }
    for (const state of machineFixture.states) if (!touched.has(state)) add(errors, 'STATE_NOT_EXERCISED', `${machineFixture.machine}:${state}`);
  }

  const recordById = new Map(validBundle.records.map(record => [record.fixture_id, record]));
  const adversarialResults = [];
  for (const testCase of adversarialBundle.cases) {
    const observedCode = await evaluateAdversarialCase(testCase, validBundle.records, recordById);
    const passed = observedCode === testCase.expected_code;
    adversarialResults.push({ case_id: testCase.case_id, expected_code: testCase.expected_code, observed_code: observedCode, passed });
    if (!passed) add(errors, 'ADVERSARIAL_CASE_FAILED', `${testCase.case_id}:${testCase.expected_code}:${observedCode}`);
    else positive += 1;
  }

  const manifest = await validateManifest(errors);
  positive += manifest.positive;
  const report = {
    receipt_version: 'ingestion-validation.v1',
    package_version: '1.0.0',
    mode: 'fixture_offline',
    offline: true,
    valid: errors.length === 0,
    schema_count: schemas.length,
    valid_fixture_count: validBundle.records.length,
    adversarial_fixture_count: adversarialBundle.cases.length,
    transition_case_count: transitionCases,
    transition_state_count: transitionStates,
    positive_check_count: positive,
    negative_check_count: adversarialResults.length,
    failed_count: errors.length,
    manifest_verified: manifest.verified,
    manifest_raw_file_sha256: manifest.raw,
    manifest_canonical_json_sha256: manifest.canonical,
    canonicalization_algorithm: 'ushso-canonical-json.v1',
    commands: ['npm run manifest --prefix contracts/ingestion/v1.0.0', 'npm test --prefix contracts/ingestion/v1.0.0', 'npm run validate --prefix contracts/ingestion/v1.0.0'],
    checks: [
      'draft-2020-12-strict-schema-compilation', 'unexpected-property-rejection', 'exact-enum-and-state-transition-coverage',
      'deterministic-idempotency-keys', 'lease-attempt-and-retry-fencing', 'four-clock-separation', 'conditional-http-304-reuse',
      'content-addressed-metadata-capture', 'zero-source-payload-truth-boundary', 'complete-enumeration-checkpoint-cas',
      'last-known-good-publication-barrier', 'transactional-outbox-duplicate-delivery', 'durable-dlq-and-replay-lineage',
      'pause-drain-zero-fetch', 'raw-and-canonical-digest-taxonomy'
    ],
    adversarial_results: adversarialResults,
    zero_action_counters: {
      external_requests: 0, source_payload_downloads: 0, source_data_rows_captured: 0, authorization_submissions: 0,
      identity_merges: 0, analyses_executed: 0, raw_questions_persisted: 0, secret_values_persisted: 0
    },
    errors,
    immutable: true
  };
  const receiptValidator = await validatorForFile('validation-receipt.schema.json');
  if (!receiptValidator(report)) throw new Error(`VALIDATION_RECEIPT_SCHEMA_INVALID:${validationMessage(receiptValidator)}`);
  if (writeReceipt) {
    if (!report.valid) throw new Error(`VALIDATION_FAILED:${errors.join('|')}`);
    await writeDeterministicJson(RECEIPT_PATH, report);
  } else if (checkStoredReceipt && await exists(RECEIPT_PATH)) {
    const stored = await readJson(RECEIPT_PATH);
    if (!receiptValidator(stored)) add(errors, 'STORED_RECEIPT_SCHEMA_INVALID', validationMessage(receiptValidator));
    else if (canonicalJson(stored) !== canonicalJson(report)) add(errors, 'STORED_RECEIPT_STALE', 'regenerate with npm run receipt');
    report.valid = errors.length === 0;
    report.failed_count = errors.length;
    report.errors = errors;
  }
  return { report, adversarialResults };
}

if (process.argv[1]?.endsWith('validate-package.mjs')) {
  validatePackage({ writeReceipt: process.argv.includes('--write-receipt') })
    .then(({ report }) => { process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!report.valid) process.exitCode = 1; })
    .catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
