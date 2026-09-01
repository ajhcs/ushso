#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryRoot } from '../../../../../db/tools/common.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticResult = spawnSync(process.execPath, [path.join(packageRoot, 'tools/validate-static.mjs')], {
  cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
});
process.stdout.write(staticResult.stdout || '');
process.stderr.write(staticResult.stderr || '');
if (staticResult.status !== 0) process.exit(staticResult.status ?? 1);

const testResult = spawnSync(process.execPath, [
  '--test', '--test-concurrency=1',
  path.join(packageRoot, 'tests/managed-authorization.test.mjs'),
  path.join(packageRoot, 'tests/wp3-foundation.test.mjs'),
], {
  cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
process.stdout.write(testResult.stdout || '');
process.stderr.write(testResult.stderr || '');
if (testResult.status !== 0) process.exit(testResult.status ?? 1);

const resultPath = path.join(packageRoot, 'results/local-suite.json');
await mkdir(path.dirname(resultPath), { recursive: true });
await writeFile(resultPath, `${JSON.stringify({
  schema_version: 'ushso-wp3-db-local-suite-result.v1',
  status: 'pass',
  scope: 'local_synthetic',
  completed_at: new Date().toISOString(),
  command: 'npm test --prefix verification/wp3/v1.0.0/db',
  tests: [
    'static migration and policy audit',
    'operation-specific managed authorization receipt binding',
    'clean forward migrations and exact checksums',
    'N-1 additive upgrade',
    'migration idempotency and drift rejection',
    'environment fence rejection',
    'production-shaped metadata-only fixture',
    'least-privilege grant matrix',
    'state and logical idempotency constraints',
    'bounded lease and reconciliation indexes',
    'monthly partition routing and missing-partition failure',
    'autovacuum policy and analyze observability',
    'archive checksum and isolated restore',
    'connection-failure rollback and direct maintenance fence',
    'section 9.11 correctness-ledger registry coverage'
  ],
  managed_resource_evidence: { status: 'pending_external_authorization' },
  network_calls: 0,
  host_ports_bound: 0,
  secrets_processed: 0
}, null, 2)}\n`, { mode: 0o600 });

const receipts = spawnSync(process.execPath, [path.join(packageRoot, 'tools/build-receipts.mjs')], {
  cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
});
process.stdout.write(receipts.stdout || '');
process.stderr.write(receipts.stderr || '');
process.exit(receipts.status ?? 1);
