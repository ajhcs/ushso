import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  DATABASE_RECEIPTS,
  INFRA_RECEIPTS,
  packageRoot,
  repositoryRoot,
  validateWp3Aggregate,
} from '../tools/wp3-validation.mjs';

const offlineEnvironment = {
  ...process.env,
  CI: '1',
  TZ: 'UTC',
  NO_COLOR: '1',
  WRANGLER_SEND_METRICS: 'false',
  USHSO_LIVE_SOURCE_REQUESTS: 'forbidden',
  USHSO_ALLOW_LIVE_SOURCE_REQUESTS: '0',
  USHSO_NETWORK_POLICY: 'authoritative-sources-forbidden',
  USHSO_ALLOW_RECEIPT_WRITES: '0',
  USHSO_RECEIPT_MODE: 'verify-only',
};

function run(label, command, arguments_) {
  const execution = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    env: offlineEnvironment,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  });
  assert.equal(execution.signal, null, `${label}: signal ${execution.signal}\n${execution.stderr}`);
  assert.equal(execution.status, 0, `${label}: exit ${execution.status}\n${execution.stdout}\n${execution.stderr}`);
}

test('WP3 generic runner executes every safe offline/static lane in both domains', () => {
  const infraTests = readdirSync(path.resolve(packageRoot, 'infra/tests'))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => path.resolve(packageRoot, 'infra/tests', name));
  assert.ok(infraTests.length > 0, 'infrastructure test discovery must not be empty');
  run('infrastructure tests', process.execPath, ['--test', ...infraTests]);
  run('deterministic Wrangler rendering', process.execPath, [path.resolve(packageRoot, 'infra/tools/render-wrangler.mjs'), '--check']);
  run('offline Wrangler bundling', 'bash', [path.resolve(packageRoot, 'infra/tools/run-wrangler-dry-run.sh')]);
  run('infrastructure static validation', process.execPath, [path.resolve(packageRoot, 'infra/tools/validate-foundation.mjs')]);
  run('database static validation', process.execPath, [path.resolve(packageRoot, 'db/tools/validate-static.mjs')]);
});

test('WP3 aggregate validates both receipt domains and names excluded lanes explicitly', () => {
  const validation = validateWp3Aggregate();
  assert.equal(validation.status, 'pass');
  assert.equal(validation.domains.infrastructure.receipt_count, INFRA_RECEIPTS.length);
  assert.equal(validation.domains.database.receipt_count, DATABASE_RECEIPTS.length);
  assert.deepEqual(
    validation.excluded_lanes.map((lane) => lane.id),
    [
      'database_local_docker_rehearsal',
      'terraform_provider_schema_validation',
      'managed_plan_apply_behavior_and_recovery',
    ],
  );
  assert.equal(validation.excluded_lanes.at(-1).generic_runner_execution, 'pending_external_authorization');
});
