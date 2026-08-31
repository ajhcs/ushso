import fs from 'node:fs/promises';
import path from 'node:path';
import { applyMutations, canonicalJson, canonicalJsonSha256, exists, PACKAGE_ROOT, readJson, sha256File, walkFiles, writeDeterministicJson } from './common.mjs';
import { loadSchemas, validationMessage, validatorForFile } from './schema.mjs';
import { stateDefinitions, validateRecordSemantics, validateRecordSet, validateTransition } from './semantics.mjs';
import { upgradeHarvestRunV10ToV11 } from './workflow-instance-id.mjs';
import { validateIngestionRecord as validateV10IngestionRecord } from '../../v1.0.0/tools/index.mjs';

const MANIFEST_PATH = path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json');
const RECEIPT_PATH = path.join(PACKAGE_ROOT, 'validation', 'validation-receipt.json');
const PREDECESSOR_ROOT = path.resolve(PACKAGE_ROOT, '../v1.0.0');
const EXCLUDED = new Set(['manifests/package-manifest.json', 'validation/validation-receipt.json']);
const PREDECESSOR_PINS = Object.freeze({
  'manifests/package-manifest.json': '071b06d4fa03fd38c5bb1c522493a66d59f767b51f4bea9d26edd596858f929d',
  'validation/validation-receipt.json': 'be197529eb1e1714b0756fe5cca40543f1234cc553112ff33e45817ed13969b6',
  'schemas/harvest-run.schema.json': '9ff550bc27f9e70e418c8a586b0798eeafa122357ec8e9d99c4dc2a4b566f959',
  'tools/semantics.mjs': '26801e00b82be3668e3befcf756881d1795fe8739c04237596cda8026b507639',
});

function add(errors, code, detail) {
  errors.push(`${code}:${detail}`);
}

function normalizeSuccessorVersion(value) {
  if (typeof value === 'string') return value.replaceAll('v1.1.0', 'v1.0.0');
  if (Array.isArray(value)) return value.map(normalizeSuccessorVersion);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeSuccessorVersion(child)]));
  }
  return value;
}

async function validatePredecessorManifest(errors) {
  const manifest = await readJson(path.join(PREDECESSOR_ROOT, 'manifests', 'package-manifest.json'));
  const physical = (await walkFiles(PREDECESSOR_ROOT)).filter(relative => !EXCLUDED.has(relative));
  const listed = manifest.files.map(file => file.path);
  let valid = true;
  const fail = (detail) => {
    valid = false;
    add(errors, 'PREDECESSOR_MANIFEST_INVALID', detail);
  };
  if (canonicalJson(physical) !== canonicalJson(listed)) fail('file_set');
  if (manifest.file_count !== manifest.files.length) fail('file_count');
  let payloadBytes = 0;
  for (const entry of manifest.files) {
    const absolute = path.join(PREDECESSOR_ROOT, entry.path);
    if (!await exists(absolute)) { fail(`missing:${entry.path}`); continue; }
    const stats = await fs.stat(absolute);
    payloadBytes += stats.size;
    if (stats.size !== entry.bytes) fail(`bytes:${entry.path}`);
    if (await sha256File(absolute) !== entry.raw_file_sha256) fail(`raw_digest:${entry.path}`);
    if (entry.path.endsWith('.json')) {
      if (canonicalJsonSha256(await readJson(absolute)) !== entry.canonical_json_sha256) {
        fail(`canonical_digest:${entry.path}`);
      }
    } else if (entry.canonical_json_sha256 !== null) fail(`canonical_scope:${entry.path}`);
  }
  if (manifest.payload_bytes !== payloadBytes) fail('payload_bytes');
  return valid;
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

async function validatePredecessor(errors) {
  const observed = {};
  for (const [relative, expected] of Object.entries(PREDECESSOR_PINS)) {
    const digest = await sha256File(path.join(PREDECESSOR_ROOT, relative));
    observed[relative] = digest;
    if (digest !== expected) add(errors, 'PREDECESSOR_PIN_MISMATCH', relative);
  }
  const successorSemantics = await sha256File(path.join(PACKAGE_ROOT, 'tools/semantics.mjs'));
  if (successorSemantics !== PREDECESSOR_PINS['tools/semantics.mjs']) add(errors, 'NON_PROVIDER_SEMANTICS_CHANGED', 'tools/semantics.mjs');
  const predecessorValidationValid = await validatePredecessorManifest(errors);

  const predecessorSchemaNames = (await fs.readdir(path.join(PREDECESSOR_ROOT, 'schemas')))
    .filter(name => name.endsWith('.schema.json'))
    .sort();
  const expectedVersionOnly = predecessorSchemaNames.filter(name => ![
    'common.schema.json', 'harvest-run.schema.json', 'package-manifest.schema.json', 'validation-receipt.schema.json'
  ].includes(name));
  let nonErratumSchemasMatch = true;
  for (const name of expectedVersionOnly) {
    const predecessor = await readJson(path.join(PREDECESSOR_ROOT, 'schemas', name));
    const successor = normalizeSuccessorVersion(await readJson(path.join(PACKAGE_ROOT, 'schemas', name)));
    if (canonicalJson(successor) !== canonicalJson(predecessor)) {
      nonErratumSchemasMatch = false;
      add(errors, 'NON_ERRATUM_SCHEMA_CHANGED', name);
    }
  }
  const predecessorCommon = await readJson(path.join(PREDECESSOR_ROOT, 'schemas', 'common.schema.json'));
  const successorCommon = normalizeSuccessorVersion(await readJson(path.join(PACKAGE_ROOT, 'schemas', 'common.schema.json')));
  delete successorCommon.$defs.CloudflareWorkflowInstanceId;
  if (canonicalJson(successorCommon) !== canonicalJson(predecessorCommon)) {
    nonErratumSchemasMatch = false;
    add(errors, 'NON_ERRATUM_SCHEMA_CHANGED', 'common.schema.json');
  }
  const predecessorHarvestRun = await readJson(path.join(PREDECESSOR_ROOT, 'schemas', 'harvest-run.schema.json'));
  const successorHarvestRun = normalizeSuccessorVersion(await readJson(path.join(PACKAGE_ROOT, 'schemas', 'harvest-run.schema.json')));
  successorHarvestRun.properties.workflow.properties.instance_id = structuredClone(
    predecessorHarvestRun.properties.workflow.properties.instance_id,
  );
  if (canonicalJson(successorHarvestRun) !== canonicalJson(predecessorHarvestRun)) {
    nonErratumSchemasMatch = false;
    add(errors, 'NON_ERRATUM_SCHEMA_CHANGED', 'harvest-run.schema.json');
  }
  const nonErratumSchemaCount = expectedVersionOnly.length + 2;
  return {
    package_version: '1.0.0',
    manifest_raw_file_sha256: observed['manifests/package-manifest.json'],
    validation_receipt_raw_file_sha256: observed['validation/validation-receipt.json'],
    harvest_run_schema_raw_file_sha256: observed['schemas/harvest-run.schema.json'],
    semantics_raw_file_sha256: observed['tools/semantics.mjs'],
    successor_semantics_raw_file_sha256: successorSemantics,
    predecessor_validation_valid: predecessorValidationValid,
    non_erratum_schema_count: nonErratumSchemaCount,
    non_erratum_schemas_match: nonErratumSchemasMatch,
    all_match: Object.entries(PREDECESSOR_PINS).every(([relative, expected]) => observed[relative] === expected)
      && successorSemantics === PREDECESSOR_PINS['tools/semantics.mjs']
      && predecessorValidationValid
      && nonErratumSchemasMatch,
  };
}

async function validateCompatibilityFixtures(bundle, validBundle, errors) {
  const bundleValidator = await validatorForFile('workflow-instance-id-compatibility-fixture.schema.json');
  if (!bundleValidator(bundle)) {
    add(errors, 'COMPATIBILITY_FIXTURE_SCHEMA_INVALID', validationMessage(bundleValidator));
    return [];
  }
  const baseline = validBundle.records.find(record => record.fixture_id === 'valid_harvest_run')?.value;
  if (!baseline) {
    add(errors, 'COMPATIBILITY_BASE_FIXTURE_MISSING', 'valid_harvest_run');
    return [];
  }
  const results = [];
  for (const testCase of bundle.cases) {
    const v10Value = structuredClone({
      ...baseline,
      contract_version: 'ingestion.v1.0.0',
      run_id: testCase.run_id,
      active_attempt: testCase.active_attempt,
      workflow: { ...baseline.workflow, instance_id: testCase.instance_id },
    });
    const v11Value = { ...v10Value, contract_version: 'ingestion.v1.1.0' };
    const v10Valid = (await validateV10IngestionRecord('harvest-run.schema.json', v10Value)).valid;
    const v11Validator = await validatorForFile('harvest-run.schema.json');
    const v11ShapeValid = v11Validator(v11Value);
    const v11Valid = v11ShapeValid && validateRecordSemantics('harvest-run.schema.json', v11Value).length === 0;
    let observedUpgradeAction = 'retain_v1_0_audit_only';
    let observedErrorCode = null;
    try {
      const upgraded = await upgradeHarvestRunV10ToV11(v10Value);
      if (canonicalJson(upgraded) === canonicalJson(v11Value)) observedUpgradeAction = 'version_only';
      else observedUpgradeAction = 'unexpected_error';
    } catch (error) {
      observedErrorCode = error?.code ?? 'UNEXPECTED_ERROR';
      if (observedErrorCode !== 'WORKFLOW_INSTANCE_ID_PROVIDER_INCOMPATIBLE') {
        observedUpgradeAction = 'unexpected_error';
      }
    }
    const passed = v10Valid === testCase.expected_v1_0_valid
      && v11Valid === testCase.expected_v1_1_valid
      && observedUpgradeAction === testCase.expected_upgrade_action;
    results.push({
      case_id: testCase.case_id,
      expected_v1_0_valid: testCase.expected_v1_0_valid,
      observed_v1_0_valid: v10Valid,
      expected_v1_1_valid: testCase.expected_v1_1_valid,
      observed_v1_1_valid: v11Valid,
      expected_upgrade_action: testCase.expected_upgrade_action,
      observed_upgrade_action: observedUpgradeAction,
      observed_error_code: observedErrorCode,
      passed,
    });
    if (!passed) add(errors, 'COMPATIBILITY_CASE_FAILED', testCase.case_id);
  }
  return results;
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
  const predecessorVerification = await validatePredecessor(errors);
  if (predecessorVerification.all_match) {
    positive += Object.keys(PREDECESSOR_PINS).length + 2 + predecessorVerification.non_erratum_schema_count;
  }
  const commonSchema = schemas.find(entry => entry.name === 'common.schema.json')?.schema;
  const workflowIdDefinition = commonSchema?.$defs?.CloudflareWorkflowInstanceId;
  if (workflowIdDefinition?.pattern !== '^[A-Za-z0-9_][A-Za-z0-9_-]*$'
      || workflowIdDefinition?.maxLength !== 100
      || workflowIdDefinition?.minLength !== 1) {
    add(errors, 'WORKFLOW_INSTANCE_ID_PROVIDER_BOUNDARY_MISMATCH', 'common.schema.json');
  } else positive += 1;
  const validBundle = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-fixtures.json'));
  const adversarialBundle = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'adversarial-fixtures.json'));
  const transitions = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'state-transitions.json'));
  const compatibilityBundle = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'workflow-instance-id-compatibility.json'));
  const fixtureBundleValidator = await validatorForFile('fixture-bundle.schema.json');
  if (schemaValidate(fixtureBundleValidator, validBundle, 'valid-fixtures.json', errors)) positive += 1;
  if (schemaValidate(fixtureBundleValidator, adversarialBundle, 'adversarial-fixtures.json', errors)) positive += 1;
  const transitionFixtureValidator = await validatorForFile('state-transition-fixture.schema.json');
  if (schemaValidate(transitionFixtureValidator, transitions, 'state-transitions.json', errors)) positive += 1;
  const compatibilityResults = await validateCompatibilityFixtures(compatibilityBundle, validBundle, errors);
  positive += compatibilityResults.filter(result => result.passed).length;

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
    package_version: '1.1.0',
    mode: 'fixture_offline',
    offline: true,
    valid: errors.length === 0,
    schema_count: schemas.length,
    valid_fixture_count: validBundle.records.length,
    adversarial_fixture_count: adversarialBundle.cases.length,
    compatibility_fixture_count: compatibilityBundle.cases.length,
    transition_case_count: transitionCases,
    transition_state_count: transitionStates,
    positive_check_count: positive,
    negative_check_count: adversarialResults.length
      + compatibilityResults.filter(result => !result.expected_v1_1_valid).length,
    failed_count: errors.length,
    manifest_verified: manifest.verified,
    manifest_raw_file_sha256: manifest.raw,
    manifest_canonical_json_sha256: manifest.canonical,
    canonicalization_algorithm: 'ushso-canonical-json.v1',
    commands: ['npm run manifest --prefix contracts/ingestion/v1.1.0', 'npm test --prefix contracts/ingestion/v1.1.0', 'npm run validate --prefix contracts/ingestion/v1.1.0'],
    checks: [
      'draft-2020-12-strict-schema-compilation', 'unexpected-property-rejection', 'exact-enum-and-state-transition-coverage',
      'deterministic-idempotency-keys', 'lease-attempt-and-retry-fencing', 'four-clock-separation', 'conditional-http-304-reuse',
      'content-addressed-metadata-capture', 'zero-source-payload-truth-boundary', 'complete-enumeration-checkpoint-cas',
      'last-known-good-publication-barrier', 'transactional-outbox-duplicate-delivery', 'durable-dlq-and-replay-lineage',
      'pause-drain-zero-fetch', 'raw-and-canonical-digest-taxonomy', 'cloudflare-workflow-instance-id-boundary',
      'v1-0-predecessor-byte-pins', 'non-erratum-schema-structural-equivalence', 'strict-subset-no-remap-compatibility'
    ],
    predecessor_verification: predecessorVerification,
    compatibility_results: compatibilityResults,
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
