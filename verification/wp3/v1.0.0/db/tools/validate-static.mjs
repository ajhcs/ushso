#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot, sha256File } from '../../../../../db/tools/common.mjs';

const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'db/migrations/manifest.json'), 'utf8'));
assert.equal(manifest.forward_only, true);
assert.equal(manifest.destructive_down_migrations, false);
assert.deepEqual(manifest.migrations.slice(0, 3).map((entry) => entry.id), ['0001', '0002', '0003']);
for (const migration of manifest.migrations) {
  assert.equal(await sha256File(path.join(repositoryRoot, 'db/migrations', migration.file)), migration.byte_sha256);
}

const allSql = (await Promise.all(manifest.migrations.map((entry) => readFile(path.join(repositoryRoot, 'db/migrations', entry.file), 'utf8')))).join('\n').toLowerCase();
assert.doesNotMatch(allSql, /pg_advisory|listen\s+|notify\s+/);
// Controlled partition GC uses allowlisted, validated relation names with
// parameterized dynamic SQL. Reject literal down-migration targets while
// preserving that separately authorized maintenance path.
assert.doesNotMatch(allSql, /drop\s+(table|schema|database)\s+(?:[a-z][a-z0-9_]*\.)?[a-z][a-z0-9_]*/);
assert.doesNotMatch(allSql, /password\s+['"]/);
const leaseSql = (await Promise.all(['lease-due-sources.sql','lease-jobs.sql','lease-outbox.sql','reconcile-workflows.sql'].map((file) => readFile(path.join(repositoryRoot, 'db/queries', file), 'utf8')))).join('\n').toLowerCase();
assert.match(leaseSql, /for update skip locked/);
assert.match(allSql, /foreign key \(run_id, source_id\) references ingest\.harvest_runs\(run_id, source_id\)/);
assert.match(allSql, /foreign key \(run_id, source_id, capture_reference_id\)\s+references ingest\.capture_references\(run_id, source_id, capture_reference_id\)/);
assert.match(allSql, /foreign key \(run_id, capture_reference_id\)\s+references ingest\.capture_references\(run_id, capture_reference_id\)/);
assert.match(allSql, /create function ingest\.assert_normalization_success_artifact_job/);
assert.match(allSql, /autovacuum_vacuum_scale_factor/);
assert.match(allSql, /partition by range/);

const rolesSql = (await readFile(path.join(repositoryRoot, 'db/bootstrap/roles.sql'), 'utf8')).toLowerCase();
const roleMatrix = JSON.parse(await readFile(path.join(repositoryRoot, 'db/bootstrap/role-matrix.v1.json'), 'utf8'));
const workerLoginRoles = ['ushso_public','ushso_scheduler','ushso_harvest','ushso_normalize','ushso_projector','ushso_ops'];
for (const role of workerLoginRoles) {
  assert.match(rolesSql, new RegExp(`alter role ${role} login`));
  assert.equal(roleMatrix.roles[role].login_identity, true);
  assert.match(roleMatrix.roles[role].credential_boundary, /^dedicated_ushso_/);
}
for (const role of ['ushso_registry_owner','ushso_ingest_owner','ushso_catalog_owner','ushso_identity_owner','ushso_search_owner','ushso_ops_owner','ushso_maintenance']) {
  assert.match(rolesSql, new RegExp(`alter role ${role} nologin`));
}
assert.equal(roleMatrix.credential_values_in_repository, false);
assert.doesNotMatch(rolesSql, /password\s+['"]/);
assert.match(allSql, /grant select on search\.published_runtime_status, search\.published_generation_records\s+to ushso_public/);

const databaseToolSources = await Promise.all([
  'db/tools/migrate.mjs',
  'db/tools/manage-partitions.mjs',
  'db/tools/archive-partition.mjs',
  'db/tools/restore-archive.mjs',
  'db/tools/assert-direct-maintenance.mjs',
  'db/bootstrap/reconcile-roles.mjs',
].map(async (file) => readFile(path.join(repositoryRoot, file), 'utf8')));
assert.ok(databaseToolSources.every((source) => source.includes('verifyManagedAuthorization(fence, {')));
assert.ok(databaseToolSources.every((source) => source.includes('DATABASE_OPERATION_ACTIONS.')));
const authorizationSchema = JSON.parse(await readFile(path.join(repositoryRoot, 'db/schemas/managed-authorization-receipt.v1.schema.json'), 'utf8'));
assert.equal(authorizationSchema.additionalProperties, false);
assert.deepEqual(authorizationSchema.properties.action.enum, [
  'database_foundation_apply',
  'database_role_reconciliation',
  'database_partition_manage',
  'database_archive_partition',
  'database_restore_archive',
  'database_direct_maintenance_assert',
]);

const ledger = JSON.parse(await readFile(path.join(repositoryRoot, 'db/policies/correctness-ledgers.v1.json'), 'utf8'));
assert.deepEqual(ledger.ledgers.map((entry) => entry.name).sort(), [
  'audit', 'durable_dlq', 'outbox', 'processed_event', 'publication_history', 'run_job_attempt', 'workflow_mapping',
]);
assert.equal(ledger.minimum_online_days, 90);
assert.equal(ledger.publication_and_security_receipt_days, 365);

console.log(JSON.stringify({ status: 'pass', migrations: manifest.migrations.length, wp3_migration_prefix: 3, ledger_classes: 7, worker_login_roles: 6 }));
