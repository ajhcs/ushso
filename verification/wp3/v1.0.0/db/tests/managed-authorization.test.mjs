import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DATABASE_AUTHORIZATION_RECEIPT_VERSION,
  DATABASE_OPERATION_ACTIONS,
  verifyManagedAuthorization,
} from '../../../../../db/tools/common.mjs';

const now = Date.parse('2026-09-01T12:00:00.000Z');
const fence = Object.freeze({
  environment: 'staging',
  fingerprint: 'a'.repeat(64),
});
const expected = Object.freeze({
  action: DATABASE_OPERATION_ACTIONS.ARCHIVE_PARTITION,
  database: 'ushso',
  parameters: Object.freeze({ partition: 'ingest.job_attempts_2026_08' }),
});

function receipt(overrides = {}) {
  return {
    receipt_version: DATABASE_AUTHORIZATION_RECEIPT_VERSION,
    authorization_id: 'authorization:db:archive-2026-08',
    authorized: true,
    environment: fence.environment,
    database: expected.database,
    deployment_fingerprint: fence.fingerprint,
    action: expected.action,
    parameters: { ...expected.parameters },
    reviewer: 'operations-owner',
    approved_at: '2026-09-01T11:30:00.000Z',
    expires_at: '2026-09-01T12:30:00.000Z',
    ...overrides,
  };
}

async function withReceipt(value, callback) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ushso-db-auth-'));
  const file = path.join(directory, 'receipt.json');
  await writeFile(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  try {
    return await callback({ ...fence, receiptPath: file });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('managed database authorization is exact, current, and operation-bound', async () => {
  const result = await withReceipt(receipt(), (managedFence) => verifyManagedAuthorization(managedFence, { ...expected, now }));
  assert.deepEqual(result, {
    authorizationId: 'authorization:db:archive-2026-08',
    approvedAt: '2026-09-01T11:30:00.000Z',
    expiresAt: '2026-09-01T12:30:00.000Z',
  });

  const attacks = [
    { extra: true },
    { authorized: false },
    { action: DATABASE_OPERATION_ACTIONS.RESTORE_ARCHIVE },
    { database: 'other' },
    { deployment_fingerprint: 'b'.repeat(64) },
    { parameters: { partition: 'ops.audit_events_2026_08' } },
    { approved_at: '2026-09-01T12:01:00.000Z' },
    { expires_at: '2026-09-01T12:00:00.000Z' },
    { expires_at: '2026-09-02T12:30:00.000Z' },
    { reviewer: 'x' },
  ];
  for (const attack of attacks) {
    await assert.rejects(
      withReceipt(receipt(attack), (managedFence) => verifyManagedAuthorization(managedFence, { ...expected, now })),
      /authorization receipt does not authorize exact database operation/u,
    );
  }
});

test('canonical parameter ordering is accepted but local execution remains receipt-free', async () => {
  const reordered = receipt({ parameters: { partition: expected.parameters.partition } });
  const result = await withReceipt(reordered, (managedFence) => verifyManagedAuthorization(managedFence, {
    ...expected,
    parameters: { partition: expected.parameters.partition },
    now: new Date(now),
  }));
  assert.equal(result.authorizationId, 'authorization:db:archive-2026-08');
  assert.equal(await verifyManagedAuthorization({ environment: 'local', fingerprint: '0'.repeat(64) }, { ...expected }), null);
});

test('malformed or missing managed receipts fail closed without exposing receipt content', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ushso-db-auth-invalid-'));
  const malformed = path.join(directory, 'malformed.json');
  await writeFile(malformed, '{not-json}\n', { mode: 0o600 });
  try {
    await assert.rejects(
      verifyManagedAuthorization({ ...fence, receiptPath: malformed }, { ...expected, now }),
      /authorization receipt does not authorize exact database operation/u,
    );
    await assert.rejects(
      verifyManagedAuthorization({ ...fence, receiptPath: path.join(directory, 'missing.json') }, { ...expected, now }),
      /authorization receipt does not authorize exact database operation/u,
    );
    await writeFile(malformed, 'null\n', { mode: 0o600 });
    await assert.rejects(
      verifyManagedAuthorization({ ...fence, receiptPath: malformed }, { ...expected, now }),
      /authorization receipt does not authorize exact database operation/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
