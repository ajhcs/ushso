import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFoundation } from '../infra/tools/foundation-validation.mjs';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repositoryRoot = path.resolve(packageRoot, '../../..');

export const INFRA_RECEIPTS = Object.freeze([
  'capacity-and-connection-budget.json',
  'cloudflare-config-validation.json',
  'environment-isolation.json',
  'observability-and-alerts.json',
  'provider-capability-review.json',
  'recovery-drills.json',
  'security-privacy-foundation.json',
]);

export const DATABASE_RECEIPTS = Object.freeze([
  'correctness-ledger-lifecycle.json',
  'direct-maintenance-path.json',
  'least-privilege.json',
  'migration-suite.json',
]);

function readJson(relativePath) {
  const file = path.resolve(repositoryRoot, relativePath);
  let parsed;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  }, `${relativePath} must be valid JSON`);
  return parsed;
}

function sha256(relativePath) {
  return crypto.createHash('sha256')
    .update(readFileSync(path.resolve(repositoryRoot, relativePath)))
    .digest('hex');
}

function sameMembers(actual, expected, label) {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
}

function validateDatabaseReceiptEnvelope(receipt, name, resultSha, completedAt) {
  assert.equal(receipt.receipt_version, 'ushso-wp3-receipt.v1', `${name}: receipt version`);
  assert.equal(receipt.evidence_scope, 'local_synthetic', `${name}: evidence scope`);
  assert.equal(receipt.status, 'pass_local', `${name}: local status`);
  assert.ok(Number.isFinite(Date.parse(receipt.generated_at)), `${name}: generated_at`);
  assert.ok(Date.parse(receipt.generated_at) >= completedAt, `${name}: predates its local suite`);
  assert.equal(receipt.local_suite_sha256, resultSha, `${name}: stale local suite digest`);
  assert.deepEqual(receipt.zero_action, {
    network_calls: 0,
    deployments: 0,
    managed_mutations: 0,
    secrets_emitted: 0,
  }, `${name}: zero-action boundary`);
  assert.equal(receipt.managed_resource_evidence?.status, 'pending_external_authorization', `${name}: managed status`);
  for (const field of [
    'provider_capability_verified', 'hyperdrive_verified', 'staging_applied',
    'production_applied', 'failover_measured', 'pitr_measured',
  ]) {
    assert.equal(receipt.managed_resource_evidence[field], false, `${name}: ${field} must remain false`);
  }
}

export function validateDatabaseReceipts() {
  const receiptDirectory = path.resolve(packageRoot, 'receipts');
  const actual = readdirSync(receiptDirectory)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const expected = [...INFRA_RECEIPTS, ...DATABASE_RECEIPTS].sort();
  assert.deepEqual(actual, expected, 'WP3 receipt set must cover exactly both domains');

  const resultPath = 'verification/wp3/v1.0.0/db/results/local-suite.json';
  const result = readJson(resultPath);
  assert.equal(result.schema_version, 'ushso-wp3-db-local-suite-result.v1');
  assert.equal(result.status, 'pass');
  assert.equal(result.scope, 'local_synthetic');
  assert.equal(result.command, 'npm test --prefix verification/wp3/v1.0.0/db');
  assert.equal(result.managed_resource_evidence?.status, 'pending_external_authorization');
  assert.deepEqual(
    { network_calls: result.network_calls, host_ports_bound: result.host_ports_bound, secrets_processed: result.secrets_processed },
    { network_calls: 0, host_ports_bound: 0, secrets_processed: 0 },
    'database local result must preserve its zero-action boundary',
  );
  const completedAt = Date.parse(result.completed_at);
  assert.ok(Number.isFinite(completedAt), 'database local result completed_at');
  const resultSha = sha256(resultPath);

  const receipts = Object.fromEntries(DATABASE_RECEIPTS.map((name) => {
    const receipt = readJson(`verification/wp3/v1.0.0/receipts/${name}`);
    validateDatabaseReceiptEnvelope(receipt, name, resultSha, completedAt);
    return [name, receipt];
  }));

  const manifest = readJson('db/migrations/manifest.json');
  assert.equal(manifest.forward_only, true);
  assert.equal(manifest.destructive_down_migrations, false);
  assert.ok(manifest.migrations.length > 0, 'migration manifest may not be empty');
  for (const migration of manifest.migrations) {
    assert.equal(
      sha256(`db/migrations/${migration.file}`),
      migration.byte_sha256,
      `migration manifest digest: ${migration.file}`,
    );
  }
  const migrationReceipt = receipts['migration-suite.json'];
  assert.deepEqual(migrationReceipt.migrations, manifest.migrations, 'migration receipt must seal the current manifest');
  assert.equal(migrationReceipt.forward_only, manifest.forward_only);
  assert.equal(migrationReceipt.destructive_down_migrations, manifest.destructive_down_migrations);
  assert.equal(
    migrationReceipt.control,
    `WP3 migrations ${manifest.migrations.at(0).id}-${manifest.migrations.at(-1).id}`,
    'migration receipt scope must name the current migration range',
  );

  const expectedWorkerRoles = [
    'ushso_public', 'ushso_scheduler', 'ushso_harvest',
    'ushso_normalize', 'ushso_projector', 'ushso_ops',
  ];
  const leastPrivilege = receipts['least-privilege.json'];
  sameMembers(leastPrivilege.exact_worker_login_roles, expectedWorkerRoles, 'database Worker login roles');
  sameMembers(leastPrivilege.roles_tested, [...expectedWorkerRoles, 'ushso_maintenance'], 'database tested roles');
  assert.equal(leastPrivilege.schema_owner_roles_login_disabled, true);
  assert.equal(leastPrivilege.maintenance_worker_login_disabled, true);
  assert.equal(leastPrivilege.credential_values_in_repository, false);
  assert.equal(leastPrivilege.public_role_read_only, true);
  assert.equal(leastPrivilege.managed_binding_test, 'pending_external_authorization');

  const ledgerPolicy = readJson('db/policies/correctness-ledgers.v1.json');
  const ledgerReceipt = receipts['correctness-ledger-lifecycle.json'];
  sameMembers(ledgerReceipt.ledger_classes, ledgerPolicy.ledgers.map((entry) => entry.name), 'correctness ledger classes');
  assert.equal(ledgerReceipt.minimum_online_days, ledgerPolicy.minimum_online_days);
  assert.equal(ledgerReceipt.publication_security_receipt_days, ledgerPolicy.publication_and_security_receipt_days);

  const maintenance = receipts['direct-maintenance-path.json'];
  assert.equal(maintenance.environment_fence_verified, true);
  assert.equal(maintenance.row_lock_migration_serialization, true);
  assert.equal(maintenance.advisory_locks_used, false);
  assert.equal(maintenance.credentials_accepted_on_cli, false);
  assert.equal(maintenance.public_ddl_denied, true);
  assert.equal(maintenance.managed_direct_path, 'pending_external_authorization');

  return {
    status: 'pass',
    receipt_count: DATABASE_RECEIPTS.length,
    migration_count: manifest.migrations.length,
    local_suite_sha256: resultSha,
  };
}

export function validateWp3Aggregate() {
  const infrastructure = validateFoundation(repositoryRoot);
  assert.equal(infrastructure.status, 'pass');
  const database = validateDatabaseReceipts();
  return {
    schema_version: 'ushso-wp3-aggregate-local-validation.v1.0.0',
    status: 'pass',
    scope: 'offline_static_and_receipted_local_evidence',
    domains: {
      infrastructure: { status: 'pass', receipt_count: INFRA_RECEIPTS.length, counts: infrastructure.counts },
      database: database,
    },
    excluded_lanes: [
      {
        id: 'database_local_docker_rehearsal',
        generic_runner_execution: 'excluded_explicit_opt_in',
        command: 'npm run test:db:local-docker --prefix verification/wp3/v1.0.0',
        evidence: 'verification/wp3/v1.0.0/db/results/local-suite.json',
      },
      {
        id: 'terraform_provider_schema_validation',
        generic_runner_execution: 'excluded_receipt_verified',
        evidence: 'verification/wp3/v1.0.0/receipts/provider-capability-review.json',
      },
      {
        id: 'managed_plan_apply_behavior_and_recovery',
        generic_runner_execution: 'pending_external_authorization',
        authorization_gates: ['AUTH-01', 'AUTH-02', 'AUTH-03', 'AUTH-05', 'AUTH-11'],
      },
    ],
  };
}
