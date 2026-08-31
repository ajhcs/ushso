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
assert.doesNotMatch(allSql, /drop\s+(table|schema|database)/);
assert.doesNotMatch(allSql, /password\s+['"]/);
const leaseSql = (await Promise.all(['lease-due-sources.sql','lease-jobs.sql','lease-outbox.sql','reconcile-workflows.sql'].map((file) => readFile(path.join(repositoryRoot, 'db/queries', file), 'utf8')))).join('\n').toLowerCase();
assert.match(leaseSql, /for update skip locked/);
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

const ledger = JSON.parse(await readFile(path.join(repositoryRoot, 'db/policies/correctness-ledgers.v1.json'), 'utf8'));
assert.deepEqual(ledger.ledgers.map((entry) => entry.name).sort(), [
  'audit', 'durable_dlq', 'outbox', 'processed_event', 'publication_history', 'run_job_attempt', 'workflow_mapping',
]);
assert.equal(ledger.minimum_online_days, 90);
assert.equal(ledger.publication_and_security_receipt_days, 365);

console.log(JSON.stringify({ status: 'pass', migrations: manifest.migrations.length, wp3_migration_prefix: 3, ledger_classes: 7, worker_login_roles: 6 }));
