import assert from 'node:assert/strict';
import test from 'node:test';
import { runFixtureMatrix } from '../src/testing/fixture-matrix.mjs';

test('mandatory WP5 fixture matrix passes without external actions', async () => {
  const result = await runFixtureMatrix();
  assert.equal(result.status, 'PASS');
  assert.equal(result.fixture_scope, 'fixture_only');
  assert.equal(result.integration_level, 'local_integration');
  assert.ok(result.totals.scenarios >= 18);
  assert.ok(result.totals.assertions >= 70);
  assert.deepEqual(result.zero_external_actions, {
    dns_queries: 0,
    network_requests: 0,
    credentials_created: 0,
    r2_calls: 0,
    database_calls: 0,
    cloudflare_calls: 0,
    deployments: 0,
  });
});
