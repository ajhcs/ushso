import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { PACKAGE_ROOT, readJson, sha256File, stableJson, walkFiles } from '../tools/common.mjs';
import { loadSchemas } from '../tools/schema.mjs';
import { validatePackage } from '../tools/validate-package.mjs';

test('strict schemas compile and complete fixture package validates offline', async () => {
  const { schemas } = await loadSchemas();
  assert.equal(schemas.length, 7);
  const { report } = await validatePackage();
  assert.equal(report.valid, true, report.errors.join('\n'));
  assert.equal(report.external_requests, 0);
  assert.equal(report.payload_downloads, 0);
  assert.equal(report.identity_merges, 0);
  assert.equal(report.coverage_executions, 0);
  assert.equal(report.lock_touches, 0);
  assert.equal(report.execution_allowed, false);
  assert.equal(report.authorization_present, false);
});

test('negative fixtures fail closed for LLM truth, authorization, not_found, references, ordering, and extras', async () => {
  const { negativeResults } = await validatePackage();
  assert.equal(negativeResults.length, 9);
  assert.deepEqual(negativeResults.filter(result => !result.passed), []);
});

test('source truth, use assertions, and access recipes remain separate stores', async () => {
  const truth = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'source-truth.json'));
  const cards = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'use-cards.json'));
  const recipes = await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'access-recipes.json'));
  assert.equal(truth.records.length, 3);
  assert.equal(cards.records.length, 3);
  assert.equal(recipes.records.length, 3);
  assert.ok(cards.records.every(card => card.assertion_type === 'curated_analytical_fit_not_source_truth'));
  assert.ok(cards.records.every(card => card.truth_boundary.llm_generated_truth_allowed === false));
  assert.ok(recipes.records.every(recipe => recipe.authorization.execution_allowed === false));
  assert.ok(recipes.records.every(recipe => recipe.typed_failure_outcomes.every(outcome => outcome.translation_to_not_found === false && outcome.outcome !== 'not_found')));
});

test('CMS HCRIS, PHC4 public reports, and PHC4 custom request are distinct assets and routes', async () => {
  const recipes = (await readJson(path.join(PACKAGE_ROOT, 'fixtures', 'access-recipes.json'))).records;
  assert.deepEqual(recipes.map(recipe => recipe.asset_id).sort(), [
    'obs:asset:cms-hcris-hospital-cost-reports',
    'obs:asset:pa-phc4-custom-data',
    'obs:asset:pa-phc4-public-financial-reports'
  ]);
  assert.equal(new Set(recipes.map(recipe => recipe.route_id)).size, 3);
  assert.deepEqual(recipes.map(recipe => recipe.route_kind).sort(), ['custom_application_request', 'public_bulk_or_api', 'public_report_publication']);
});

test('manifest covers every payload file by exact byte count and sha256', async () => {
  const excludes = ['manifests/package-manifest.json', 'validation/validation-receipt.json'];
  const manifest = await readJson(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json'));
  const physical = (await walkFiles(PACKAGE_ROOT)).filter(relative => !excludes.includes(relative));
  assert.equal(stableJson(manifest.files.map(file => file.path)), stableJson(physical));
  for (const item of manifest.files) {
    const file = path.join(PACKAGE_ROOT, item.path);
    assert.equal((await fs.stat(file)).size, item.bytes, item.path);
    assert.equal(await sha256File(file), item.sha256, item.path);
  }
});
