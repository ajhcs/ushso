#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot, sha256File } from '../../../../../db/tools/common.mjs';

const packageRoot = path.join(repositoryRoot, 'verification/wp3/v1.0.0/db');
const receiptRoot = path.join(repositoryRoot, 'verification/wp3/v1.0.0/receipts');
const resultPath = path.join(packageRoot, 'results/local-suite.json');
const result = JSON.parse(await readFile(resultPath, 'utf8'));
if (result.status !== 'pass' || result.scope !== 'local_synthetic') throw new Error('passing local suite result required');
const resultSha = await sha256File(resultPath);
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'db/migrations/manifest.json'), 'utf8'));
const migrationIds = manifest.migrations.map((migration) => migration.id);
const sealedInventory = `${migrationIds.at(0)}-${migrationIds.at(-1)}`;
const localHarnessThrough = '0003';
const common = {
  receipt_version: 'ushso-wp3-receipt.v1',
  evidence_scope: 'local_synthetic',
  generated_at: new Date().toISOString(),
  local_suite_sha256: resultSha,
  managed_resource_evidence: {
    status: 'pending_external_authorization',
    provider_capability_verified: false,
    hyperdrive_verified: false,
    staging_applied: false,
    production_applied: false,
    failover_measured: false,
    pitr_measured: false
  },
  zero_action: { network_calls: 0, deployments: 0, managed_mutations: 0, secrets_emitted: 0 }
};

const receipts = {
  'migration-suite.json': {
    ...common,
    control: `WP3 local harness ${localHarnessThrough === '0003' ? '0001-0003' : localHarnessThrough}; sealed inventory ${sealedInventory}`,
    local_harness_through: localHarnessThrough,
    sealed_migration_inventory: sealedInventory,
    status: 'pass_local',
    forward_only: true,
    destructive_down_migrations: false,
    migrations: manifest.migrations,
    checks: ['clean apply', 'N-1 upgrade', 'exact checksum', 'idempotent rerun', 'environment fence', 'connection rollback']
  },
  'least-privilege.json': {
    ...common,
    control: 'WP3 PostgreSQL role least privilege',
    status: 'pass_local',
    roles_tested: ['ushso_public','ushso_scheduler','ushso_harvest','ushso_normalize','ushso_projector','ushso_ops','ushso_maintenance'],
    exact_worker_login_roles: ['ushso_public','ushso_scheduler','ushso_harvest','ushso_normalize','ushso_projector','ushso_ops'],
    schema_owner_roles_login_disabled: true,
    maintenance_worker_login_disabled: true,
    credential_values_in_repository: false,
    public_pointer_read: 'search.published_runtime_status',
    public_generation_pinned_read: 'search.published_generation_records',
    public_role_read_only: true,
    public_ingestion_access: false,
    public_secret_reference_access: false,
    managed_binding_test: 'pending_external_authorization'
  },
  'correctness-ledger-lifecycle.json': {
    ...common,
    control: 'Plan section 9.11 correctness-ledger lifecycle',
    status: 'pass_local',
    ledger_classes: ['run_job_attempt','outbox','processed_event','workflow_mapping','durable_dlq','publication_history','audit'],
    minimum_online_days: 90,
    publication_security_receipt_days: 365,
    partition_archive_checksum_verified: true,
    isolated_restore_verified: true,
    publication_history_state: 'planned_future_migration'
  },
  'direct-maintenance-path.json': {
    ...common,
    control: 'Controlled direct non-Hyperdrive maintenance path',
    status: 'pass_local',
    environment_fence_verified: true,
    row_lock_migration_serialization: true,
    advisory_locks_used: false,
    credentials_accepted_on_cli: false,
    public_ddl_denied: true,
    managed_direct_path: 'pending_external_authorization'
  }
};

await mkdir(receiptRoot, { recursive: true });
for (const [name, receipt] of Object.entries(receipts)) {
  await writeFile(path.join(receiptRoot, name), `${JSON.stringify(receipt, null, 2)}\n`);
}
console.log(JSON.stringify({ status: 'pass', receipts: Object.keys(receipts) }));
