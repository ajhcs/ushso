import fs from 'node:fs/promises';
import path from 'node:path';
import { contentFingerprint, exists, ROOT, semanticContentFingerprint, sha256File, walkFiles, writeAtomic } from './common.mjs';
import { EXCLUDED_PATHS } from './build-manifest.mjs';
import { loadSchemas, schemaErrors } from './schema.mjs';
import { applyAdversarialCase, semanticErrors } from './semantics.mjs';

function add(errors, code, pathValue, message) {
  errors.push({ code, path: pathValue, message });
}

async function validatePackageManifest(ajv, errors) {
  const manifestPath = path.join(ROOT, 'manifests', 'package-manifest.json');
  if (!await exists(manifestPath)) {
    add(errors, 'PACKAGE_MANIFEST_MISSING', '/manifests/package-manifest.json', 'package manifest has not been built');
    return false;
  }
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const validate = ajv.getSchema('https://ushso.org/contracts/core/v2.0.0/schemas/package-manifest.schema.json');
  if (!validate(manifest)) errors.push(...schemaErrors(validate, '/manifests/package-manifest.json'));
  const actualPaths = (await walkFiles(ROOT)).filter(relative => !EXCLUDED_PATHS.includes(relative));
  const declaredPaths = manifest.files?.map(row => row.path) ?? [];
  if (JSON.stringify(actualPaths) !== JSON.stringify(declaredPaths)) add(errors, 'PACKAGE_MANIFEST_PATH_MISMATCH', '/manifests/package-manifest.json/files', 'declared file inventory does not equal package inventory');
  for (const row of manifest.files ?? []) {
    const file = path.join(ROOT, row.path);
    if (!await exists(file)) { add(errors, 'PACKAGE_FILE_MISSING', `/manifests/package-manifest.json/files/${row.path}`, 'declared package file is absent'); continue; }
    const stat = await fs.stat(file);
    if (stat.size !== row.bytes) add(errors, 'FILE_BYTES_MISMATCH', row.path, 'exact byte count does not match manifest');
    if (await sha256File(file) !== row.file_sha256) add(errors, 'FILE_SHA256_MISMATCH', row.path, 'exact file-byte SHA-256 does not match manifest');
    if (await semanticContentFingerprint(file) !== row.content_fingerprint) add(errors, 'CONTENT_FINGERPRINT_MISMATCH', row.path, 'semantic content fingerprint does not match manifest');
  }
  return true;
}

export async function validatePackage({ writeReceipt = false } = {}) {
  const errors = [];
  const { ajv, rows: schemaRows } = await loadSchemas();
  const fixtureManifest = JSON.parse(await fs.readFile(path.join(ROOT, 'fixtures', 'fixture-manifest.json'), 'utf8'));
  const validateFixtureManifest = ajv.getSchema('https://ushso.org/contracts/core/v2.0.0/schemas/fixture-manifest.schema.json');
  if (!validateFixtureManifest(fixtureManifest)) errors.push(...schemaErrors(validateFixtureManifest, '/fixtures/fixture-manifest.json'));

  const bundlePath = path.join(ROOT, fixtureManifest.valid_bundle ?? 'bundle/valid-bundle.json');
  const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
  const validateBundle = ajv.getSchema('https://ushso.org/contracts/core/v2.0.0/schemas/fixture-bundle.schema.json');
  if (!validateBundle(bundle)) errors.push(...schemaErrors(validateBundle, '/bundle/valid-bundle.json'));
  errors.push(...semanticErrors(bundle));

  const adversarial = JSON.parse(await fs.readFile(path.join(ROOT, 'fixtures', 'adversarial-cases.json'), 'utf8'));
  const validateAdversarial = ajv.getSchema('https://ushso.org/contracts/core/v2.0.0/schemas/adversarial-cases.schema.json');
  if (!validateAdversarial(adversarial)) errors.push(...schemaErrors(validateAdversarial, '/fixtures/adversarial-cases.json'));
  for (const adversarialCase of adversarial.cases ?? []) {
    const mutated = applyAdversarialCase(bundle, adversarialCase);
    const caseErrors = [];
    if (!validateBundle(mutated)) caseErrors.push(...schemaErrors(validateBundle));
    caseErrors.push(...semanticErrors(mutated, { verifyFingerprints: false }));
    const codes = new Set(caseErrors.map(error => error.code));
    if (caseErrors.length === 0) add(errors, 'ADVERSARIAL_CASE_ACCEPTED', `/fixtures/adversarial-cases.json/${adversarialCase.case_id}`, 'adversarial mutation was accepted');
    for (const expected of adversarialCase.expected_error_codes) if (!codes.has(expected)) add(errors, 'ADVERSARIAL_EXPECTATION_MISSING', `/fixtures/adversarial-cases.json/${adversarialCase.case_id}`, `expected rejection code not observed: ${expected}`);
  }

  const buildReceiptPath = path.join(ROOT, 'receipts', 'fixture-build.json');
  const buildReceipt = JSON.parse(await fs.readFile(buildReceiptPath, 'utf8'));
  const validateBuildReceipt = ajv.getSchema('https://ushso.org/contracts/core/v2.0.0/schemas/build-receipt.schema.json');
  if (!validateBuildReceipt(buildReceipt)) errors.push(...schemaErrors(validateBuildReceipt, '/receipts/fixture-build.json'));
  if (buildReceipt.fixture_manifest_file_sha256 !== await sha256File(path.join(ROOT, 'fixtures', 'fixture-manifest.json'))) add(errors, 'BUILD_RECEIPT_HASH_MISMATCH', '/receipts/fixture-build.json/fixture_manifest_file_sha256', 'fixture manifest file hash mismatch');
  if (buildReceipt.bundle_file_sha256 !== await sha256File(bundlePath)) add(errors, 'BUILD_RECEIPT_HASH_MISMATCH', '/receipts/fixture-build.json/bundle_file_sha256', 'bundle file hash mismatch');
  if (buildReceipt.bundle_content_fingerprint !== contentFingerprint(bundle)) add(errors, 'BUILD_RECEIPT_FINGERPRINT_MISMATCH', '/receipts/fixture-build.json/bundle_content_fingerprint', 'bundle semantic fingerprint mismatch');

  const packageManifestChecked = await validatePackageManifest(ajv, errors);
  const recordCounts = Object.fromEntries(Object.entries(bundle).filter(([, value]) => Array.isArray(value)).map(([name, rows]) => [name, rows.length]));
  const report = {
    report_version: 'observatory-core-validation.v2.0.0',
    contract_version: 'observatory-core.v2.0.0',
    offline: true,
    valid: errors.length === 0,
    schema_count: schemaRows.length,
    record_counts: recordCounts,
    adversarial_case_count: adversarial.cases?.length ?? 0,
    checks: [
      'strict-draft-2020-12-unevaluated-properties',
      'four-clock-temporal-order',
      'append-only-bidirectional-acyclic-history',
      'evidence-resolution-and-claim-paths',
      'exact-source-native-identifiers',
      'visibility-access-authorization-separation',
      'unknown-state-preservation',
      'identity-family-join-orthogonality',
      'join-evidence-non-upgrade',
      'metadata-only-no-analysis-boundary',
      'canonical-record-content-fingerprints',
      'exact-file-byte-sha256',
      'adversarial-rejection-corpus',
      'package-manifest-inventory-and-digests'
    ],
    errors,
    package_manifest_checked: packageManifestChecked
  };
  const validateReport = ajv.getSchema('https://ushso.org/contracts/core/v2.0.0/schemas/validation-report.schema.json');
  if (!validateReport(report)) throw new Error(`VALIDATION_REPORT_SCHEMA_INVALID:${JSON.stringify(schemaErrors(validateReport))}`);
  if (writeReceipt) await writeAtomic(path.join(ROOT, 'validation', 'validation-receipt.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1]?.endsWith('validate-package.mjs')) {
  try {
    const unknown = process.argv.slice(2).filter(value => value !== '--write-receipt');
    if (unknown.length) throw new Error(`UNKNOWN_ARGUMENT:${unknown.join(',')}`);
    const report = await validatePackage({ writeReceipt: process.argv.includes('--write-receipt') });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.valid) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
