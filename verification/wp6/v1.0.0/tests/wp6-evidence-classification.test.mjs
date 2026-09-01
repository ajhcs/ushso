import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { LocalPostgresUnavailableError } from '../tools/local-postgres.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('WP6 database preflight unavailability is classified separately from a passing receipt', async () => {
  const unavailable = new LocalPostgresUnavailableError('postgres:16-alpine is unavailable locally; network pulls are forbidden');
  assert.equal(unavailable.code, 'WP6_LOCAL_POSTGRES_UNAVAILABLE');
  assert.equal(unavailable instanceof Error, true);
  assert.equal(unavailable instanceof LocalPostgresUnavailableError, true);

  const receipt = JSON.parse(await readFile(path.join(packageRoot, 'receipts/verification-receipt.json'), 'utf8'));
  assert.equal(receipt.status, 'pass');
  assert.equal(receipt.scope, 'local-isolated-postgresql-and-offline-corpus');
  assert.equal(receipt.managed_execution.status, 'pending_external_authorization');
  assert.equal(receipt.managed_execution.staging_applied, false);
  assert.equal(receipt.managed_execution.production_applied, false);
  assert.equal(receipt.harness.postgres_image, 'postgres:16-alpine');
  assert.deepEqual(receipt.migration_ids, ['0004', '0005', '0006', '0007']);
});
