import fs from 'node:fs/promises';
import path from 'node:path';
import { PACKAGE_ROOT, PROJECT_ROOT, pathExists, publishImmutable, readJson, sha256File, stableJson, walkFiles } from './common.mjs';
import { mutateAtPath, validateAccessRecipe, validateBundle, validateSourceTruthSet, validateUseCard } from './semantics.mjs';
import { loadSchemas, validationMessage } from './schema.mjs';

const EXCLUDES = ['manifests/package-manifest.json', 'validation/validation-receipt.json'];
function add(errors, code, detail) { errors.push(`${code}:${detail}`); }

async function validateManifest(ajv, errors) {
  const manifestPath = path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json');
  if (!await pathExists(manifestPath)) { add(errors, 'MANIFEST_MISSING', 'manifests/package-manifest.json'); return { verified: false, sha256: null, positive: 0 }; }
  const manifest = await readJson(manifestPath);
  const validate = ajv.getSchema('https://hackyard.local/observatory/use-access/v1.0.0/package-manifest.schema.json');
  if (!validate(manifest)) add(errors, 'SCHEMA_INVALID', `package-manifest:${validationMessage(validate)}`);
  const physical = (await walkFiles(PACKAGE_ROOT)).filter(relative => !EXCLUDES.includes(relative));
  const listed = manifest.files.map(item => item.path);
  if (stableJson(physical) !== stableJson(listed)) add(errors, 'MANIFEST_FILE_SET_MISMATCH', `${physical.length}:${listed.length}`);
  let bytes = 0;
  for (const item of manifest.files) {
    const file = path.join(PACKAGE_ROOT, item.path);
    if (!await pathExists(file)) { add(errors, 'MANIFEST_FILE_MISSING', item.path); continue; }
    const stat = await fs.stat(file);
    bytes += stat.size;
    if (stat.size !== item.bytes) add(errors, 'MANIFEST_BYTE_MISMATCH', item.path);
    if (await sha256File(file) !== item.sha256) add(errors, 'MANIFEST_HASH_MISMATCH', item.path);
  }
  if (bytes !== manifest.payload_bytes) add(errors, 'MANIFEST_PAYLOAD_BYTES_MISMATCH', `${bytes}:${manifest.payload_bytes}`);
  if (manifest.file_count !== manifest.files.length) add(errors, 'MANIFEST_FILE_COUNT_MISMATCH', `${manifest.file_count}:${manifest.files.length}`);
  return { verified: !errors.some(error => error.startsWith('MANIFEST_') || error.startsWith('SCHEMA_INVALID:package-manifest')), sha256: await sha256File(manifestPath), positive: manifest.files.length + 3 };
}

function schemaValidate(validate, value, label, errors) {
  if (!validate(value)) { add(errors, 'SCHEMA_INVALID', `${label}:${validationMessage(validate)}`); return false; }
  return true;
}

export async function loadFixtureBundle() {
  const sourceTruthFixture = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'source-truth.json'));
  const useCardFixture = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'use-cards.json'));
  const recipeFixture = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'access-recipes.json'));
  const invalidFixture = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'invalid-cases.json'));
  return { sourceTruthFixture, useCardFixture, recipeFixture, invalidFixture };
}

export async function runNegativeCases(bundle, validators, truthById) {
  const results = [];
  const useById = new Map(bundle.useCardFixture.records.map(record => [record.use_card_id, record]));
  const recipeById = new Map(bundle.recipeFixture.records.map(record => [record.recipe_id, record]));
  for (const testCase of bundle.invalidFixture.cases) {
    const base = testCase.kind === 'use_card' ? useById.get(testCase.base_id) : recipeById.get(testCase.base_id);
    if (!base) { results.push({ case_id: testCase.case_id, expected: testCase.expected_code, observed: 'BASE_NOT_FOUND', passed: false }); continue; }
    const mutated = mutateAtPath(base, testCase.mutation.path, testCase.mutation.value);
    const validate = testCase.kind === 'use_card' ? validators.useCard : validators.accessRecipe;
    let observed = 'ACCEPTED';
    if (!validate(mutated)) observed = 'SCHEMA_INVALID';
    else {
      const semantic = testCase.kind === 'use_card' ? validateUseCard(mutated, truthById) : validateAccessRecipe(mutated, truthById);
      if (semantic.length) observed = semantic[0].code;
    }
    results.push({ case_id: testCase.case_id, expected: testCase.expected_code, observed, passed: observed === testCase.expected_code });
  }
  return results;
}

export async function validatePackage({ writeReport = false } = {}) {
  const errors = [];
  let positive = 0;
  const { ajv, schemas } = await loadSchemas();
  const get = name => ajv.getSchema(`https://hackyard.local/observatory/use-access/v1.0.0/${name}`);
  const validators = {
    policy: get('policy.schema.json'), dependency: get('dependency-pin.schema.json'), sourceTruth: get('source-truth.schema.json'),
    useCard: get('use-card.schema.json'), accessRecipe: get('access-recipe.schema.json'), receipt: get('validation-receipt.schema.json')
  };
  const policy = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'policy.json'));
  const dependencyPin = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'dependency-pin.json'));
  if (schemaValidate(validators.policy, policy, 'contracts/policy.json', errors)) positive += 1;
  if (schemaValidate(validators.dependency, dependencyPin, 'contracts/dependency-pin.json', errors)) positive += 1;
  const bundle = await loadFixtureBundle();
  if (bundle.sourceTruthFixture.fixture_version !== 'use-access-source-truth.v1.0.0') add(errors, 'FIXTURE_VERSION_INVALID', 'source-truth');
  if (bundle.useCardFixture.fixture_version !== 'use-card-fixtures.v1.0.0') add(errors, 'FIXTURE_VERSION_INVALID', 'use-cards');
  if (bundle.recipeFixture.fixture_version !== 'access-recipe-fixtures.v1.0.0') add(errors, 'FIXTURE_VERSION_INVALID', 'access-recipes');
  if (bundle.invalidFixture.fixture_version !== 'use-access-invalid-cases.v1.0.0') add(errors, 'FIXTURE_VERSION_INVALID', 'invalid-cases');
  const dependencyFile = path.join(PROJECT_ROOT, dependencyPin.path);
  let dependencyVerified = false;
  let curated = null;
  if (!await pathExists(dependencyFile)) add(errors, 'DEPENDENCY_MISSING', dependencyPin.path);
  else {
    const currentHash = await sha256File(dependencyFile);
    if (currentHash !== dependencyPin.sha256) add(errors, 'DEPENDENCY_HASH_MISMATCH', `${dependencyPin.sha256}:${currentHash}`);
    else { dependencyVerified = true; positive += 1; }
    curated = await readJson(dependencyFile);
    if (curated.fixture_version !== dependencyPin.fixture_version) add(errors, 'DEPENDENCY_VERSION_MISMATCH', `${dependencyPin.fixture_version}:${curated.fixture_version}`);
    else positive += 1;
  }
  for (const record of bundle.sourceTruthFixture.records) if (schemaValidate(validators.sourceTruth, record, record.source_truth_id, errors)) positive += 1;
  for (const record of bundle.useCardFixture.records) if (schemaValidate(validators.useCard, record, record.use_card_id, errors)) positive += 1;
  for (const record of bundle.recipeFixture.records) if (schemaValidate(validators.accessRecipe, record, record.recipe_id, errors)) positive += 1;
  const sourceSemantic = validateSourceTruthSet(bundle.sourceTruthFixture.records, dependencyPin, curated);
  for (const item of sourceSemantic) add(errors, item.code, item.detail);
  if (!sourceSemantic.length) positive += 1;
  const truthById = new Map(bundle.sourceTruthFixture.records.map(record => [record.source_truth_id, record]));
  const bundleSemantic = validateBundle(bundle.useCardFixture.records, bundle.recipeFixture.records, truthById);
  for (const item of bundleSemantic) add(errors, item.code, item.detail);
  if (!bundleSemantic.length) positive += 1;
  const negativeResults = await runNegativeCases(bundle, validators, truthById);
  for (const result of negativeResults) if (!result.passed) add(errors, 'NEGATIVE_CASE_FAILED', `${result.case_id}:${result.expected}:${result.observed}`);
  const manifest = await validateManifest(ajv, errors);
  positive += manifest.positive;
  const report = {
    receipt_version: 'use-access-validation.v1', package_version: '1.0.0', mode: 'fixture_offline', offline: true,
    valid: errors.length === 0, schema_count: schemas.length, source_truth_count: bundle.sourceTruthFixture.records.length,
    use_card_count: bundle.useCardFixture.records.length, access_recipe_count: bundle.recipeFixture.records.length,
    positive_check_count: positive, negative_check_count: negativeResults.length, failed_count: errors.length,
    external_requests: 0, payload_downloads: 0, identity_merges: 0, coverage_executions: 0, lock_touches: 0,
    authorization_present: false, execution_allowed: false, dependency_pin_verified: dependencyVerified,
    manifest_verified: manifest.verified, manifest_sha256: manifest.sha256,
    checks: ['draft-2020-12-strict-schema-compilation', 'source-truth-use-assertion-separation', 'dependency-hash-and-record-match', 'no-llm-truth-boundary', 'fitness-measure-unit-geography-time-evidence-semantics', 'distinct-hcris-phc4-public-phc4-custom-routes', 'ordered-agent-and-human-recipes', 'authorization-gates-default-deny', 'typed-failure-no-not-found-translation', 'negative-fixture-rejection', 'manifest-file-byte-hash-integrity'],
    errors, immutable: true
  };
  if (!validators.receipt(report)) throw new Error(`VALIDATION_RECEIPT_INVALID:${validationMessage(validators.receipt)}`);
  const storedPath = path.join(PACKAGE_ROOT, 'validation', 'validation-receipt.json');
  if (writeReport) await publishImmutable(storedPath, `${JSON.stringify(report, null, 2)}\n`);
  else if (await pathExists(storedPath)) {
    const stored = await readJson(storedPath);
    if (!validators.receipt(stored)) add(errors, 'STORED_RECEIPT_SCHEMA_INVALID', validationMessage(validators.receipt));
    const critical = ['valid', 'schema_count', 'source_truth_count', 'use_card_count', 'access_recipe_count', 'negative_check_count', 'failed_count', 'external_requests', 'manifest_sha256'];
    for (const field of critical) if (stableJson(stored[field]) !== stableJson(report[field])) add(errors, 'STORED_RECEIPT_STALE', field);
    report.valid = errors.length === 0;
    report.failed_count = errors.length;
    report.errors = errors;
  }
  return { report, negativeResults };
}

if (process.argv[1]?.endsWith('validate-package.mjs')) validatePackage({ writeReport: process.argv.includes('--write-report') })
  .then(({ report }) => { process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!report.valid) process.exitCode = 1; })
  .catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
