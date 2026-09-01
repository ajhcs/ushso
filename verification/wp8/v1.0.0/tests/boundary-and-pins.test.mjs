import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../../../../', import.meta.url);

async function bytes(path) {
  return readFile(new URL(path, repositoryRoot));
}

async function json(path) {
  return JSON.parse(await readFile(new URL(path, repositoryRoot), 'utf8'));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('every WP1 receipt source remains byte-for-byte pinned', async () => {
  const receipt = await json('verification/wp1/v1.0.0/receipts/repository-adapter-contract.json');
  assert.equal(receipt.status, 'PASS');
  assert.ok(receipt.source_files.length >= 15);
  const paths = new Set(receipt.source_files.map(source => source.path));
  for (const required of [
    'worker/index.mjs',
    'packages/search/search-backend.mjs',
    'packages/search/static-search-backend.mjs',
    'packages/registry/publication-read-context.mjs',
  ]) assert.ok(paths.has(required), `WP1 pin missing ${required}`);
  for (const source of receipt.source_files) {
    assert.equal(sha256(await bytes(source.path)), source.sha256, `WP1 source changed: ${source.path}`);
  }
});

test('WP2 evaluator semantics remain frozen and WP8 remains explicitly pre-tuning', async () => {
  const frozen = [
    ['evaluation/harness/v2.0.0/validation/validation-receipt.json', '864b234a65de2358d888368cbdae9009c7aaeb0f2749693f2ebe6974b73d8e8b'],
    ['evaluation/bridge/v1.0.0/receipts/bridge-receipt.json', '9f42e7a26555cb6ce1465a15ac9afa1913869039e01557778c768ee1120251b5'],
    ['evaluation/harness/v2.0.0/metric-contract.json', '32c826571c7e9d44dc567664030eed67c49ae60a3574850d9bd0209fa6498cda'],
    ['evaluation/harness/v2.0.0/benchmark-pin.json', '89804a56123cb19fff40468e5fcdc05a2753ff0b4b38541386bda239cd2de398'],
  ];
  for (const [path, expected] of frozen) assert.equal(sha256(await bytes(path)), expected, `WP2 freeze changed: ${path}`);

  const [aggregate, harness, bridge] = await Promise.all([
    json('verification/wp2/v1.0.0/validation/validation-receipt.json'),
    json('evaluation/harness/v2.0.0/validation/validation-receipt.json'),
    json('evaluation/bridge/v1.0.0/receipts/bridge-receipt.json'),
  ]);
  assert.equal(aggregate.wp2_gate_pass, true);
  assert.equal(aggregate.evaluator_freeze.tuning_started, false);
  assert.equal(aggregate.evaluator_freeze.ranking_optimization_performed, false);
  assert.equal(aggregate.evaluator_freeze.release_gate_status, 'FAIL_PRE_TUNING');
  assert.equal(harness.status, 'PASS');
  assert.equal(bridge.status, 'PASS');
  assert.equal(bridge.release_gate_status, 'FAIL_PRE_TUNING');
  assert.equal(bridge.release_gate_pass, false);
  assert.equal(bridge.execution_boundary.ranking_optimization_performed, false);
});

test('the published legacy split is audit-only, never silently reused as the final gate', async () => {
  const [bridgeBuilder, authorizationRegister] = await Promise.all([
    readFile(new URL('evaluation/bridge/v1.0.0/tools/run-bridge.mjs', repositoryRoot), 'utf8'),
    json('verification/external-authorization/v1.0.0/register.json'),
  ]);
  assert.match(
    bridgeBuilder,
    /already published and evaluated by the legacy baseline[\s\S]*remain audit-only[\s\S]*not a sealed final-gate hold-out/,
  );
  const authorization = authorizationRegister.entries.find(entry => entry.id === 'AUTH-13');
  assert.ok(authorization, 'AUTH-13 final-holdout authorization entry missing');
  assert.equal(authorization.authorized, false);
  assert.equal(authorization.status, 'not_requested');
  assert.match(authorization.action, /fresh independently owned 20-item retrieval holdout/);
  assert.match(authorization.action, /one-time aggregate-only final-gate evaluation/);
  const productionSources = await Promise.all([
    'packages/search/projection-v2.mjs',
    'packages/search/publication-lifecycle-v2.mjs',
    'packages/search/postgres-search-backend-v2.mjs',
    'packages/search/generation-cursor-v2.mjs',
    'packages/search/final-holdout-guard-v2.mjs',
  ].map(path => readFile(new URL(path, repositoryRoot), 'utf8')));
  for (const source of productionSources) {
    assert.doesNotMatch(source, /evaluation\/benchmark\/v0\.1\.0/);
    assert.doesNotMatch(source, /questions\.jsonl|relevance_judgments\.jsonl|bundle_gold\.jsonl/);
  }
});
