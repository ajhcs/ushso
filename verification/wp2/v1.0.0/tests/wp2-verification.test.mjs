import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { PACKAGE_ROOT, canonicalJson, readJson, sha256File } from '../tools/common.mjs';
import { auditAllPackages } from '../tools/package-audit.mjs';
import { auditSchemas } from '../tools/schema-audit.mjs';
import { auditCrossContractSemantics, auditEvaluatorFreeze } from '../tools/cross-contract-audit.mjs';

test('registry freezes exactly the ten required WP2 packages and public commands', async () => {
  const registry = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'package-registry.json'));
  assert.equal(registry.required_package_count, 10);
  assert.equal(registry.packages.length, 10);
  assert.equal(new Set(registry.packages.map(item => item.package_id)).size, 10);
  assert.equal(new Set(registry.packages.map(item => item.path)).size, 10);
  assert.ok(registry.packages.every(item => item.manifest_path && item.receipt_path));
});

test('aggregate receipt schema is Draft 2020-12 and rejects unexpected properties', async () => {
  const schema = await readJson(path.join(PACKAGE_ROOT, 'schemas', 'validation-receipt.schema.json'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  const validate = ajv.compile(schema);
  assert.equal(validate({ __wp2_unexpected_property_probe__: true }), false);
  assert.ok(validate.errors.some(error => error.keyword === 'additionalProperties' && error.params.additionalProperty === '__wp2_unexpected_property_probe__'));
});

test('all required package manifests, receipts, digest taxonomies, boundaries, and nonzero tests audit cleanly', async () => {
  const registry = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'package-registry.json'));
  const audit = await auditAllPackages(registry);
  assert.deepEqual(audit.errors, []);
  assert.ok(audit.results.every(result => result.test_file_count > 0 && result.declared_test_case_count > 0));
  assert.ok(audit.results.every(result => result.digest_taxonomy_verified));
  assert.ok(audit.results.every(result => result.zero_action_assertion_count > 0));
});

test('every required schema compiles and every root object rejects the shared unexpected-property probe', async () => {
  const registry = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'package-registry.json'));
  const probe = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'unexpected-property-probe.json'));
  const audit = await auditSchemas(registry, probe);
  assert.deepEqual(audit.errors, []);
  for (const packageResult of audit.packageResults.values()) {
    assert.equal(packageResult.schema_count, packageResult.compiled_schema_count, packageResult.package_id);
    assert.equal(packageResult.root_object_schema_count, packageResult.unexpected_property_probe_count, packageResult.package_id);
  }
});

test('shared evidence, access, coverage, plan, truth, and generation-pin semantics agree', async () => {
  const audit = await auditCrossContractSemantics();
  assert.equal(audit.passed, true, audit.errors.join('\n'));
  assert.deepEqual(audit.checks.filter(check => !check.passed), []);
  assert.ok(audit.checks.length >= 10);
});

test('evaluator metrics, benchmark, cohort, policy, and algorithms are cryptographically pre-tuning', async () => {
  const audit = await auditEvaluatorFreeze();
  assert.equal(audit.passed, true, audit.errors.join('\n'));
  assert.equal(audit.tuning_started, false);
  assert.equal(audit.release_gate_status, 'FAIL_PRE_TUNING');
  assert.equal(audit.ranking_optimization_performed, false);
  assert.equal(audit.benchmark_mutation_allowed, false);
});

test('canonical comparison used by aggregate checks is key-order invariant', async () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: -0 } }), canonicalJson({ a: { x: 0, y: 2 }, z: 1 }));
  assert.match(await sha256File(path.join(PACKAGE_ROOT, 'contracts', 'package-registry.json')), /^[a-f0-9]{64}$/);
});
