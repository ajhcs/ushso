import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertPublicSchemaBounds, auditPublicSchemaBounds } from '../src/bounds-audit.mjs';
import { runFixtureManifest } from '../src/fixture-runner.mjs';
import { createPackageManifest } from '../src/manifest.mjs';
import { createSchemaRegistry, verifyDependencyPins } from '../src/schema-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function registry() {
  return createSchemaRegistry({
    schemaDirectory: path.join(ROOT, 'schemas'),
    dependencyPinPath: path.join(ROOT, 'contracts', 'dependency-pin.json'),
    packageJsonPath: path.join(ROOT, 'package.json'),
    packageRoot: ROOT
  });
}

test('Ajv 2020 registry enforces exact dependency and format pins', async () => {
  const loaded = await registry();
  assert.equal(loaded.dependencyCheck.ok, true);
  assert.equal(loaded.schemas.length, 5);
  const mismatch = await verifyDependencyPins({
    packageRoot: ROOT,
    dependencyPin: loaded.dependencyPin,
    packageJson: { dependencies: { ajv: '8.19.0' } }
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.errors.some(error => error.code === 'DEPENDENCY_DECLARATION_MISMATCH'), true);
});

test('strict schema mode rejects unknown keywords and formats', async () => {
  const loaded = await registry();
  assert.throws(() => loaded.ajv.compile({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false, unknownKeyword: true }), /unknown keyword/u);
  assert.throws(() => loaded.ajv.compile({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string', format: 'unknown-format' }), /unknown format/u);
});

test('valid and adversarial fixture manifest passes in full', async () => {
  const loaded = await registry();
  const result = await runFixtureManifest({
    packageRoot: ROOT,
    registry: loaded,
    manifestPath: path.join(ROOT, 'fixtures', 'fixture-manifest.json'),
    semanticValidators: {
      'tooling.semantic.accept': () => true,
      'tooling.semantic.reject': () => ({ ok: false, code: 'SYNTHETIC_SEMANTIC_REJECTION' })
    }
  });
  assert.equal(result.ok, true, JSON.stringify(result.results.filter(row => !row.passed)));
  assert.equal(result.valid_fixture_count, 5);
  assert.equal(result.adversarial_fixture_count, 6);
});

test('public schema bounds audit passes bounded schemas and rejects unbounded surfaces', async () => {
  const loaded = await registry();
  assert.equal(assertPublicSchemaBounds(loaded.schemas).ok, true);
  const bad = auditPublicSchemaBounds({ type: 'object', properties: { query: { type: 'string' }, rows: { type: 'array', items: { type: 'string', maxLength: 10 } } } });
  assert.equal(bad.ok, false);
  assert.deepEqual(new Set(bad.findings.map(row => row.code)), new Set(['PUBLIC_OBJECT_NOT_CLOSED', 'PUBLIC_STRING_MAX_LENGTH_REQUIRED', 'PUBLIC_ARRAY_MAX_ITEMS_REQUIRED']));
});

test('package inventory is deterministic and keeps digest domains explicit', async () => {
  const first = await createPackageManifest({ root: ROOT, packageName: '@ushso/contract-tooling', packageVersion: '1.0.0' });
  const second = await createPackageManifest({ root: ROOT, packageName: '@ushso/contract-tooling', packageVersion: '1.0.0' });
  assert.deepEqual(first, second);
  assert.equal(first.package_content_digest.digest_type, 'package_sha256');
  assert.equal(first.files.every(file => file.byte_digest.digest_type === 'byte_sha256'), true);
  assert.equal(first.files.some(file => file.semantic_digest?.digest_type === 'canonical_json_sha256'), true);
  assert.equal(first.files.some(file => file.path.endsWith('.jsonl')), false);
  assert.equal((await fs.stat(path.join(ROOT, 'package.json'))).isFile(), true);
});
