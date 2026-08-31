#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, requireEnvironmentFence, verifyManagedAuthorization } from './common.mjs';

export async function restoreArchive(options) {
  const args = options ?? parseArgs();
  const fence = requireEnvironmentFence(args);
  await verifyManagedAuthorization(fence);
  if (!args.input || !args.container || !args.database) throw new Error('--input, --container, and --database are required');
  if (fence.environment !== 'local') throw new Error('managed restore remains pending_external_authorization');
  const bytes = await readFile(path.resolve(args.input));
  const restored = spawnSync('docker', ['exec', '-i', args.container, 'pg_restore', '-U', 'postgres', '-d', args.database, '--data-only', '--exit-on-error'], {
    input: bytes,
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (restored.status !== 0) throw new Error(`archive restore failed: ${Buffer.from(restored.stderr || '').toString('utf8').trim()}`);
  return { status: 'restore_completed', environment: fence.environment, database: args.database, byte_count: bytes.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  restoreArchive().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
