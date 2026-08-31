#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARTITION_PATTERN } from './archive-partition.mjs';
import { parseArgs, requireEnvironmentFence, verifyManagedAuthorization } from './common.mjs';

function isolatedFlag(value) {
  return value === true || value === 'true';
}

export async function restoreArchive(options) {
  const args = options ?? parseArgs();
  const fence = requireEnvironmentFence(args);
  await verifyManagedAuthorization(fence);
  if (!args.input || !args.container || !args.database || !args.partition) {
    throw new Error('--input, --container, --database, and --partition are required');
  }
  if (fence.environment !== 'local') throw new Error('managed restore remains pending_external_authorization');
  if (!isolatedFlag(args['isolated-target'])) throw new Error('isolated restore requires --isolated-target');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(args.database)) throw new Error('restore database name is invalid');
  const sourceDatabase = args['source-database'] || 'ushso';
  if (args.database === sourceDatabase) throw new Error('restore target must be an isolated database, not the source');
  if (!PARTITION_PATTERN.test(args.partition)) throw new Error('partition is not an allowlisted monthly correctness-ledger relation');
  const bytes = await readFile(path.resolve(args.input));
  const archiveSha256 = createHash('sha256').update(bytes).digest('hex');
  if (!args['expected-sha256'] || args['expected-sha256'] !== archiveSha256) {
    throw new Error('archive checksum mismatch');
  }
  // The archive is a data-only partition snapshot.  Its rows can reference
  // live control-plane rows that are intentionally absent from an isolated
  // restore target, so replay the dump with triggers disabled; the source
  // partition was already validated before it was archived.
  const restored = spawnSync('docker', [
    'exec', '-i', args.container, 'pg_restore', '-U', 'postgres', '-d', args.database,
    '--data-only', '--disable-triggers', '--exit-on-error', `--table=${args.partition.split('.').at(-1)}`,
  ], {
    input: bytes,
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (restored.status !== 0) throw new Error(`archive restore failed: ${Buffer.from(restored.stderr || '').toString('utf8').trim()}`);
  return {
    status: 'restore_completed',
    environment: fence.environment,
    database: args.database,
    partition: args.partition,
    byte_count: bytes.length,
    archive_object_sha256: archiveSha256,
    isolated_target: true,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  restoreArchive().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
