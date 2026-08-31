import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { byteSha256, canonicalSha256 } from '../src/digests.mjs';
import { runFixtureManifest } from '../src/fixture-runner.mjs';
import { verifyPackageManifest, writeJsonAtomic } from '../src/manifest.mjs';
import { assertPublicSchemaBounds } from '../src/bounds-audit.mjs';
import { createSchemaRegistry } from '../src/schema-registry.mjs';
import { parseStrictJson } from '../src/strict-json.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_FILE = path.join(ROOT, 'manifests', 'package-manifest.json');
const RECEIPT_FILE = path.join(ROOT, 'validation', 'validation-receipt.json');
const FIXTURE_MANIFEST_FILE = path.join(ROOT, 'fixtures', 'fixture-manifest.json');

function keywordNegativesPass(registry) {
  const failures = [];
  try {
    registry.ajv.compile({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      inventedKeyword: true
    });
    failures.push('unknown keyword compiled');
  } catch {}
  try {
    registry.ajv.compile({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'string',
      format: 'unregistered-contract-format'
    });
    failures.push('unknown format compiled');
  } catch {}
  return { ok: failures.length === 0, failures };
}

async function buildReceipt() {
  const registry = await createSchemaRegistry({
    schemaDirectory: path.join(ROOT, 'schemas'),
    dependencyPinPath: path.join(ROOT, 'contracts', 'dependency-pin.json'),
    packageJsonPath: path.join(ROOT, 'package.json'),
    packageRoot: ROOT
  });
  const fixtureResult = await runFixtureManifest({
    packageRoot: ROOT,
    registry,
    manifestPath: FIXTURE_MANIFEST_FILE,
    semanticValidators: {
      'tooling.semantic.accept': () => true,
      'tooling.semantic.reject': () => ({ ok: false, code: 'SYNTHETIC_SEMANTIC_REJECTION' })
    }
  });
  let boundsResult;
  try {
    // Audit the full registered closure, including common definitions reached
    // through external $refs, rather than only the four public roots.
    boundsResult = assertPublicSchemaBounds(registry.schemas);
  } catch (error) {
    boundsResult = { ok: false, findings: error.findings ?? [] };
  }
  const keywordResult = keywordNegativesPass(registry);
  const manifestBytes = await fs.readFile(MANIFEST_FILE);
  const manifest = parseStrictJson(manifestBytes.toString('utf8'));
  const manifestSchema = registry.validate('https://ushso.local/contracts/tooling/v1.0.0/package-manifest.schema.json', manifest);
  const manifestVerification = manifestSchema.valid
    ? await verifyPackageManifest({ root: ROOT, manifest })
    : { ok: false };
  const errors = [
    ...fixtureResult.results.filter(result => !result.passed).map(result => `fixture:${result.id}`),
    ...(!boundsResult.ok ? boundsResult.findings.map(finding => `bounds:${finding.schema}${finding.pointer}:${finding.code}`) : []),
    ...keywordResult.failures.map(failure => `schema-keyword:${failure}`),
    ...(!manifestSchema.valid ? manifestSchema.errors.map(error => `manifest-schema:${error.instance_path}:${error.keyword}`) : []),
    ...(!manifestVerification.ok ? ['manifest-inventory:mismatch'] : [])
  ];
  const receipt = {
    receipt_version: 'ushso.tooling-validation-receipt.v1',
    package_name: '@ushso/contract-tooling',
    package_version: '1.0.0',
    validator_version: 'ushso.contract-tooling-validator.v1',
    valid: errors.length === 0,
    offline: true,
    schema_count: registry.schemas.length,
    fixture_count: fixtureResult.fixture_count,
    valid_fixture_count: fixtureResult.valid_fixture_count,
    adversarial_fixture_count: fixtureResult.adversarial_fixture_count,
    passed_fixture_count: fixtureResult.passed_count,
    dependency_pins_verified: registry.dependencyCheck.ok,
    formats_verified: registry.dependencyPin.formats.length === 10,
    public_bounds_verified: boundsResult.ok,
    schema_keyword_negatives_verified: keywordResult.ok,
    manifest_verified: manifestVerification.ok,
    manifest_byte_digest: byteSha256(manifestBytes),
    package_content_digest: manifest.package_content_digest,
    fixture_manifest_digest: canonicalSha256(parseStrictJson(await fs.readFile(FIXTURE_MANIFEST_FILE, 'utf8'))),
    checks: [
      'adversarial-fixture-rejection',
      'dependency-pin-verification',
      'deterministic-package-inventory',
      'pinned-format-registration',
      'public-schema-bounds',
      'schema-2020-12-compilation',
      'strict-keyword-and-format-rejection'
    ],
    errors,
    external_requests: 0,
    immutable: true
  };
  const receiptValidation = registry.validate('https://ushso.local/contracts/tooling/v1.0.0/validation-receipt.schema.json', receipt);
  if (!receiptValidation.valid) throw new Error(`VALIDATION_RECEIPT_SCHEMA_INVALID:${JSON.stringify(receiptValidation.errors)}`);
  return receipt;
}

const receipt = await buildReceipt();
if (process.argv.includes('--write-receipt')) {
  await writeJsonAtomic(RECEIPT_FILE, receipt);
} else {
  const stored = parseStrictJson(await fs.readFile(RECEIPT_FILE, 'utf8'));
  if (JSON.stringify(stored) !== JSON.stringify(receipt)) {
    throw new Error('VALIDATION_RECEIPT_STALE');
  }
}
console.log(JSON.stringify(receipt));
if (!receipt.valid) process.exitCode = 1;
