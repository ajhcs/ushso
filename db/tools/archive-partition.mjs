#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, requireEnvironmentFence, runPsql, verifyManagedAuthorization } from './common.mjs';

export const PARTITION_PATTERN = /^(ingest\.(run_state_events|job_attempts|workflow_reconciliation_events)|ops\.(outbox_attempt_events|processed_event_history|dead_letter_events|audit_events))_\d{4}_\d{2}$/;

export async function archivePartition(options) {
  const args = options ?? parseArgs();
  const fence = requireEnvironmentFence(args);
  await verifyManagedAuthorization(fence);
  const partition = args.partition;
  if (!PARTITION_PATTERN.test(partition || '')) throw new Error('partition is not an allowlisted monthly correctness-ledger relation');
  if (!args.output) throw new Error('--output is required');
  const database = args.database || 'ushso';
  const container = args.container || null;
  if (!container) throw new Error('direct managed archive execution remains pending_external_authorization');

  const registered = runPsql({
    container, database, tuplesOnly: true,
    sql: `select state from ops.partition_registry where partition_relation = '${partition}';`,
  }).stdout.trim();
  if (registered !== 'online' && registered !== 'archive_requested') throw new Error('partition is not registered as online/archive_requested');

  const count = Number(runPsql({ container, database, tuplesOnly: true, sql: `select count(*) from ${partition};` }).stdout.trim());
  const dump = spawnSync('docker', ['exec', container, 'pg_dump', '-U', 'postgres', '-d', database, '--format=custom', '--data-only', `--table=${partition}`], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (dump.status !== 0) throw new Error(`partition archive failed: ${Buffer.from(dump.stderr || '').toString('utf8').trim()}`);
  const bytes = Buffer.from(dump.stdout);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const output = path.resolve(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, bytes, { mode: 0o600 });
  return { status: 'written', environment: fence.environment, partition, row_count: count, byte_count: bytes.length, archive_object_sha256: sha256, output };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  archivePartition().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

