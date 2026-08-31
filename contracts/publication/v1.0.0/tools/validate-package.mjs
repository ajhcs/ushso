import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PACKAGE_ROOT,
  canonicalJson,
  clone,
  pathExists,
  readJson,
  sha256File,
  walkFiles,
  writeJson
} from './common.mjs';
import { MANIFEST_EXCLUDES } from './build-manifest.mjs';
import { loadSchemas, validationMessage, validatorFor } from './schema.mjs';
import { validatePublicationBundle } from './semantics.mjs';

function add(errors, code, detail) {
  errors.push(`${code}:${detail}`);
}

function resolvePointer(root, pointer) {
  const parts = pointer.split('/').slice(1).map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let cursor = root;
  for (const part of parts) cursor = cursor[Array.isArray(cursor) ? Number(part) : part];
  return cursor;
}

function parentFor(root, pointer) {
  const parts = pointer.split('/').slice(1).map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let cursor = root;
  for (const part of parts.slice(0, -1)) cursor = cursor[Array.isArray(cursor) ? Number(part) : part];
  return { parent: cursor, key: parts.at(-1) };
}

export function applyMutations(base, mutations) {
  const result = clone(base);
  for (const mutation of mutations) {
    if (mutation.op === 'swap') {
      const array = resolvePointer(result, mutation.path);
      [array[mutation.left], array[mutation.right]] = [array[mutation.right], array[mutation.left]];
      continue;
    }
    const { parent, key } = parentFor(result, mutation.path);
    if (mutation.op === 'delete') {
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete parent[key];
    } else parent[Array.isArray(parent) ? Number(key) : key] = clone(mutation.value);
  }
  return result;
}

export async function loadFixtureBundle() {
  const bundle = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-publication.json'));
  const adversarial = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'adversarial-cases.json'));
  const taxonomy = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'digest-taxonomy.json'));
  return { bundle, adversarial, taxonomy };
}

export async function runAdversarialCases(bundle, adversarial, fixtureValidator) {
  const results = [];
  for (const testCase of adversarial.cases) {
    const mutated = applyMutations(bundle, testCase.mutations);
    let observed = 'ACCEPTED';
    let observedCodes = [];
    if (!fixtureValidator(mutated)) {
      observed = 'SCHEMA_INVALID';
      observedCodes = ['SCHEMA_INVALID'];
    } else {
      observedCodes = validatePublicationBundle(mutated).map(item => item.code);
      observed = observedCodes.includes(testCase.expected_code) ? testCase.expected_code : (observedCodes[0] ?? 'ACCEPTED');
    }
    results.push({
      case_id: testCase.case_id,
      expected: testCase.expected_code,
      observed,
      observed_codes: observedCodes,
      passed: observed === testCase.expected_code
    });
  }
  return results;
}

async function validatePackageManifest(ajv, errors) {
  const file = path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json');
  if (!await pathExists(file)) {
    add(errors, 'PACKAGE_MANIFEST_MISSING', 'manifests/package-manifest.json');
    return { verified: false, sha256: null, positive: 0 };
  }
  const manifest = await readJson(file);
  const validate = validatorFor(ajv, 'package-manifest.schema.json');
  if (!validate(manifest)) add(errors, 'PACKAGE_MANIFEST_SCHEMA_INVALID', validationMessage(validate));
  const physical = (await walkFiles(PACKAGE_ROOT)).filter(relative => !MANIFEST_EXCLUDES.includes(relative));
  if (canonicalJson(manifest.files.map(item => item.path)) !== canonicalJson(physical)) add(errors, 'PACKAGE_MANIFEST_FILE_SET_MISMATCH', `${manifest.files.length}:${physical.length}`);
  let bytes = 0;
  for (const item of manifest.files) {
    const absolute = path.join(PACKAGE_ROOT, item.path);
    if (!await pathExists(absolute)) { add(errors, 'PACKAGE_MANIFEST_FILE_MISSING', item.path); continue; }
    const stat = await fs.stat(absolute);
    bytes += stat.size;
    if (stat.size !== item.bytes) add(errors, 'PACKAGE_MANIFEST_BYTE_MISMATCH', item.path);
    if (await sha256File(absolute) !== item.sha256) add(errors, 'PACKAGE_MANIFEST_HASH_MISMATCH', item.path);
  }
  if (bytes !== manifest.payload_bytes) add(errors, 'PACKAGE_MANIFEST_PAYLOAD_BYTES_MISMATCH', `${bytes}:${manifest.payload_bytes}`);
  if (manifest.file_count !== manifest.files.length) add(errors, 'PACKAGE_MANIFEST_FILE_COUNT_MISMATCH', `${manifest.file_count}:${manifest.files.length}`);
  const hasManifestErrors = errors.some(error => error.startsWith('PACKAGE_MANIFEST_'));
  return { verified: !hasManifestErrors, sha256: await sha256File(file), positive: hasManifestErrors ? 0 : manifest.files.length + 4 };
}

export async function validatePackage({ writeReceipt = false } = {}) {
  const errors = [];
  let positive = 0;
  const { ajv, schemas } = await loadSchemas();
  const fixtureValidator = validatorFor(ajv, 'publication-fixture.schema.json');
  const adversarialValidator = validatorFor(ajv, 'adversarial-cases.schema.json');
  const receiptValidator = validatorFor(ajv, 'validation-receipt.schema.json');
  const { bundle, adversarial, taxonomy } = await loadFixtureBundle();
  if (!fixtureValidator(bundle)) add(errors, 'VALID_FIXTURE_SCHEMA_INVALID', validationMessage(fixtureValidator));
  else positive += 1;
  if (!adversarialValidator(adversarial)) add(errors, 'ADVERSARIAL_FIXTURE_SCHEMA_INVALID', validationMessage(adversarialValidator));
  else positive += 1;
  if (canonicalJson(bundle.digest_taxonomy) !== canonicalJson(taxonomy)) add(errors, 'EMBEDDED_DIGEST_TAXONOMY_MISMATCH', 'fixtures/valid-publication.json');
  else positive += 1;
  const semanticErrors = fixtureValidator(bundle) ? validatePublicationBundle(bundle) : [];
  for (const item of semanticErrors) add(errors, item.code, item.detail);
  if (!semanticErrors.length) positive += 22;
  const adversarialResults = await runAdversarialCases(bundle, adversarial, fixtureValidator);
  for (const result of adversarialResults) if (!result.passed) add(errors, 'ADVERSARIAL_CASE_FAILED', `${result.case_id}:${result.expected}:${result.observed}:${result.observed_codes.join(',')}`);
  positive += adversarialResults.filter(item => item.passed).length;
  const packageManifest = await validatePackageManifest(ajv, errors);
  positive += packageManifest.positive;
  const report = {
    receipt_version: 'publication-contract-validation.v1',
    package_version: '1.0.0',
    mode: 'fixture_offline',
    valid: errors.length === 0,
    schema_count: schemas.length,
    positive_check_count: positive,
    adversarial_check_count: adversarialResults.length,
    failed_count: errors.length,
    fixture_digest: await sha256File(path.join(PACKAGE_ROOT, 'fixtures', 'valid-publication.json')),
    manifest_verified: packageManifest.verified,
    manifest_sha256: packageManifest.sha256,
    external_requests: 0,
    database_writes: 0,
    publication_pointer_writes: 0,
    checks: [
      'draft-2020-12-strict-schema-compilation',
      'exact-canonical-revision-membership-and-digest',
      'complete-as-of-w1-full-snapshot-only',
      'seven-component-generation-coherence',
      'projection-obligation-acknowledgement-completeness',
      'deterministic-document-component-and-build-checksums',
      'visibility-exclusion-and-zero-absence-claim',
      'all-required-publication-barriers',
      'atomic-pointer-and-append-only-history-transaction',
      'active-and-n-minus-one-retention',
      'retired-generation-ttl-and-restart-required',
      'n-minus-one-worker-and-static-rollback-pins',
      'legacy-coverage-seo-planner-typed-unknown',
      'metadata-only-product-boundary',
      'adversarial-fixture-fail-closed',
      'exact-byte-package-manifest'
    ],
    errors,
    immutable: true
  };
  if (!receiptValidator(report)) throw new Error(`VALIDATION_RECEIPT_SCHEMA_INVALID:${validationMessage(receiptValidator)}`);
  if (writeReceipt) await writeJson(path.join(PACKAGE_ROOT, 'validation', 'validation-receipt.json'), report);
  else {
    const receiptFile = path.join(PACKAGE_ROOT, 'validation', 'validation-receipt.json');
    if (await pathExists(receiptFile)) {
      const stored = await readJson(receiptFile);
      if (!receiptValidator(stored)) add(errors, 'STORED_RECEIPT_SCHEMA_INVALID', validationMessage(receiptValidator));
      const comparable = ['valid', 'schema_count', 'positive_check_count', 'adversarial_check_count', 'failed_count', 'fixture_digest', 'manifest_verified', 'manifest_sha256'];
      for (const field of comparable) if (canonicalJson(stored[field]) !== canonicalJson(report[field])) add(errors, 'STORED_RECEIPT_STALE', field);
      report.valid = errors.length === 0;
      report.failed_count = errors.length;
      report.errors = errors;
    }
  }
  return { report, adversarialResults };
}

if (process.argv[1]?.endsWith('validate-package.mjs')) {
  validatePackage({ writeReceipt: process.argv.includes('--write-receipt') })
    .then(({ report }) => { process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!report.valid) process.exitCode = 1; })
    .catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
