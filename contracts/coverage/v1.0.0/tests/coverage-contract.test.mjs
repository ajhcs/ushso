import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  PACKAGE_ROOT,
  canonicalDigest,
  canonicalJson,
  membershipManifestDigest,
  readJson,
  sha256File,
  snapshotDigest,
  walkFiles
} from '../tools/common.mjs';
import { loadSchemas, validatorFor } from '../tools/schema.mjs';
import { CANONICAL_COVERAGE_CELL_STATES, validateCoverageBundle } from '../tools/semantics.mjs';
import { validatePackage } from '../tools/validate-package.mjs';

test('all strict JSON Schema 2020-12 contracts compile and the complete fixture validates', async () => {
  const { schemas } = await loadSchemas();
  assert.equal(schemas.length, 11);
  const { report } = await validatePackage();
  assert.equal(report.valid, true, report.errors.join('\n'));
  assert.equal(report.metric_definition_count, 18);
  assert.equal(report.metric_instance_count, 18);
  assert.equal(report.membership_manifest_count, 18);
  assert.equal(report.partition_equations_verified, 2);
  assert.equal(report.external_requests, 0);
});

test('schemas reject unexpected properties and denominator omission', async () => {
  const fixture = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-package.json'));
  const metricValidator = await validatorFor('coverage-metric.schema.json');
  const extra = { ...fixture.snapshot.metrics[0], invented_percentage: 100 };
  assert.equal(metricValidator(extra), false);
  const missing = structuredClone(fixture.snapshot.metrics[0]);
  delete missing.denominator_definition;
  assert.equal(metricValidator(missing), false);
});

test('all 18 glossary metrics and both exhaustive equations are frozen', async () => {
  const definitions = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'metric-definitions.json'));
  assert.equal(definitions.definitions.length, 18);
  assert.equal(new Set(definitions.definitions.map(definition => definition.metric_id)).size, 18);
  assert.deepEqual(definitions.definitions.filter(definition => definition.partition).map(definition => definition.partition.equation), [
    'active + paused + excluded + retired + unassessed = configured',
    'normalized + pending + failed + excluded + not_applicable + unknown = ingested'
  ]);
  const projectRoot = path.resolve(PACKAGE_ROOT, '..', '..', '..');
  const glossary = await fs.readFile(path.join(projectRoot, 'docs', 'COVERAGE_DENOMINATOR_GLOSSARY.md'), 'utf8');
  for (const definition of definitions.definitions) assert.match(glossary, new RegExp(definition.metric_id.replaceAll('/', '\\/')));
});

test('state/federal matrix preserves exactly the seven canonical assessment values', async () => {
  const fixture = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-package.json'));
  const observed = [...new Set(fixture.matrix.cells.map(cell => cell.coverage_cell_state))].sort();
  assert.deepEqual(observed, [...CANONICAL_COVERAGE_CELL_STATES].sort());
  assert.equal(fixture.matrix.denominator.configured_cell_count, fixture.matrix.cells.length);
  assert.ok(fixture.matrix.cells.some(cell => cell.jurisdiction_type === 'federal'));
  assert.ok(fixture.matrix.cells.some(cell => cell.jurisdiction_type === 'state'));
});

test('canonical digest domains distinguish logical objects, membership manifests, snapshots, and file bytes', async () => {
  assert.equal(canonicalJson({ z: 1, a: -0 }), canonicalJson({ a: 0, z: 1 }));
  const logical = canonicalDigest('ushso:canonical-json:v1\n', { a: 1 });
  const membership = canonicalDigest('ushso:coverage-membership-manifest:v1\n', { a: 1 });
  assert.notEqual(logical, membership);
  const fixture = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-package.json'));
  for (const metric of fixture.snapshot.metrics) {
    const manifest = fixture.snapshot.membership_manifests.find(item => item.manifest_id === metric.membership_manifest_id);
    assert.equal(metric.membership_manifest_hash, membershipManifestDigest(manifest));
  }
  assert.equal(fixture.snapshot.immutability.canonical_digest, snapshotDigest(fixture.snapshot));
});

test('every adversarial fixture is rejected by its named schema or semantic invariant', async () => {
  const { report, adversarialResults } = await validatePackage();
  assert.ok(adversarialResults.length >= 20);
  assert.deepEqual(adversarialResults.filter(result => !result.passed), []);
  assert.equal(report.adversarial_cases_rejected, report.adversarial_case_count);
});

test('valid fixture exposes explicit unknown, not-applicable, excluded, unclassified, overlap, and absence fields', async () => {
  const definitions = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'metric-definitions.json'));
  const fixture = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'valid-package.json'));
  assert.deepEqual(validateCoverageBundle(definitions, fixture, { requireAllCanonicalStates: true }), []);
  const normalized = fixture.snapshot.metrics.find(metric => metric.metric_id === 'coverage.normalized_outcome/v1');
  assert.equal(normalized.unknown_count, 1);
  assert.equal(normalized.not_applicable_count, 1);
  assert.equal(normalized.excluded_count, 1);
  const ingestion = fixture.snapshot.metrics.find(metric => metric.metric_id === 'coverage.revision_ingestion/v1');
  assert.equal(ingestion.unclassified_count, 1);
  const discovered = fixture.snapshot.metrics.find(metric => metric.metric_id === 'coverage.discovered_inventory/v1');
  assert.equal(discovered.overlap.can_overlap, true);
  assert.equal(discovered.overlap.additive, false);
  assert.equal(discovered.denominator_count, null);
  assert.equal(discovered.rate, null);
  assert.ok(fixture.source_scopes.every(scope => typeof scope.absence_claim_permitted === 'boolean'));
  assert.ok(fixture.snapshot.metrics.every(metric => typeof metric.absence_claim_permitted === 'boolean'));
  assert.ok(fixture.matrix.cells.every(cell => typeof cell.absence_claim_permitted === 'boolean'));
});

test('package manifest covers every normative file by exact byte count and SHA-256', async () => {
  const manifest = await readJson(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json'));
  const excluded = new Set(['manifests/package-manifest.json', 'validation/validation-receipt.json']);
  const physical = (await walkFiles(PACKAGE_ROOT)).filter(file => !excluded.has(file));
  assert.deepEqual(manifest.files.map(file => file.path), physical);
  for (const item of manifest.files) {
    const file = path.join(PACKAGE_ROOT, item.path);
    assert.equal((await fs.stat(file)).size, item.bytes, item.path);
    assert.equal(await sha256File(file), item.sha256, item.path);
  }
});
