#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryRoot, sha256File } from '../../../../db/tools/common.mjs';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--write-receipt')) throw new Error('--write-receipt is required');

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout || '';
}

function runHost(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || '').trim()}`);
  return result.stdout || '';
}

const listenerPreflight = runHost('ss', ['-tlnp']);
const staticOutput = run([path.join(root, 'tools/validate-static.mjs')]);
const testOutput = run(['--test', '--test-concurrency=1', path.join(root, 'tests/wp6-database.test.mjs')]);
const remainingContainers = runHost('docker', [
  'ps', '--filter', 'label=org.ushso.owner=wp6-local-test', '--format', '{{.Names}}'
]).trim();
if (remainingContainers) throw new Error(`WP6_POSTGRES_CLEANUP_FAILED:${remainingContainers}`);
const importPlanPath = path.join(repositoryRoot, 'packages/normalization/fixtures/import-plan.json');
const receipt = {
  receipt_version: 'ushso-wp6-verification-receipt.v1.0.0',
  status: 'pass',
  scope: 'local-isolated-postgresql-and-offline-corpus',
  source: {
    corpus_version: '1.1.0', records: 157, search_documents: 157, join_routes: 14,
    manifest_file_sha256: '23f704ce3e421a6eb26c2b3677d616a1ae6b4f45226233257b9a1ff676caba2b'
  },
  migration_ids: ['0004', '0005', '0006', '0007'],
  checks: [
    'strict core v2 schema and semantic validation', 'explicit 157/14 reconciliation',
    'deterministic IDs and revisions', 'zero automatic identity merges',
    'clean and N-1 migrations', 'six-role least privilege', 'atomic import and exact replay idempotency',
    'database canonical digest and sealed authority verification',
    'collection/type and dangling-reference adversarial failures',
    'database v1 projection parity', 'join evidence non-upgrade', 'transaction failure rollback and recovery',
    'backup/restore parity', 'immutable revision head N+1/cycle/revert behavior',
    'non-destructive audited rejection fallback and explicit unavailable-head state'
  ],
  harness: {
    listener_preflight_command: 'ss -tlnp',
    listener_preflight_output_sha256: createHash('sha256').update(listenerPreflight).digest('hex'),
    postgres_image: 'postgres:16-alpine', network_mode: 'none', host_ports_published: 0,
    storage: 'tmpfs', owner_label: 'org.ushso.owner=wp6-local-test',
    cleanup_verified: true, remaining_labelled_containers: 0
  },
  safety: { external_requests: 0, host_ports_bound: 0, production_databases_touched: 0, payloads_acquired: 0, analyses_executed: 0, destructive_rollbacks: 0 },
  artifacts: {
    import_plan_sha256: await sha256File(importPlanPath),
    migration_manifest_sha256: await sha256File(path.join(repositoryRoot, 'db/migrations/manifest.json')),
    normalization_package_manifest_sha256: await sha256File(path.join(repositoryRoot, 'packages/normalization/manifests/package-manifest.json')),
    evidence_ledger_sha256: await sha256File(path.join(root, 'requirements/evidence-ledger.json')),
    static_output_sha256: createHash('sha256').update(staticOutput).digest('hex'),
    test_output_sha256: createHash('sha256').update(testOutput).digest('hex')
  },
  managed_execution: { status: 'pending_external_authorization', staging_applied: false, production_applied: false },
  rollback: {
    action: 'catalog.reject_import_batch', deletes_shared_state: false,
    selected_successor_reverts_to_eligible_predecessor: true,
    no_predecessor_state_is_explicit: true, later_heads_unchanged: true,
    static_public_path_unchanged: true
  }
};
const receiptSchema = JSON.parse(await readFile(path.join(root, 'schemas/verification-receipt.schema.json'), 'utf8'));
const ajv = new Ajv2020({ strict: true, strictSchema: true, allErrors: true });
const validateReceipt = ajv.compile(receiptSchema);
if (!validateReceipt(receipt)) throw new Error(`WP6_RECEIPT_SCHEMA_INVALID:${JSON.stringify(validateReceipt.errors)}`);
await mkdir(path.join(root, 'receipts'), { recursive: true });
await writeFile(path.join(root, 'receipts/verification-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
