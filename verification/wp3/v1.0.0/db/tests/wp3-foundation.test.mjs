import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { applyMigrations } from '../../../../../db/tools/migrate.mjs';
import { archivePartition } from '../../../../../db/tools/archive-partition.mjs';
import { restoreArchive } from '../../../../../db/tools/restore-archive.mjs';
import { repositoryRoot, runPsql, sha256File } from '../../../../../db/tools/common.mjs';
import { startLocalPostgres } from '../tools/local-postgres.mjs';

const localFingerprint = '0'.repeat(64);

function scalar(container, database, sql) {
  return runPsql({ container, database, sql, tuplesOnly: true }).stdout.trim();
}

test('WP3 local PostgreSQL foundation', async (t) => {
  const postgres = await startLocalPostgres();
  const { container } = postgres;
  try {
    await t.test('clean forward migrations and exact checksums', async () => {
      const result = await applyMigrations({
        container, database: 'ushso', environment: 'local',
        'deployment-fingerprint': localFingerprint,
        through: '0003',
      });
      assert.deepEqual(result.applied, ['0001', '0002', '0003']);
      assert.equal(scalar(container, 'ushso', 'select count(*) from public.ushso_schema_migrations;'), '3');
      assert.equal(scalar(container, 'ushso', "select environment from ops.environment_fence where singleton;"), 'local');
      assert.equal(scalar(container, 'ushso', "select count(*) from information_schema.schemata where schema_name in ('registry','ingest','catalog','identity','search','ops');"), '6');
    });

    await t.test('N-1 upgrade remains additive', async () => {
      runPsql({ container, database: 'postgres', sql: 'create database ushso_nminus1;' });
      const n1 = await applyMigrations({
        container, database: 'ushso_nminus1', environment: 'local',
        'deployment-fingerprint': localFingerprint, through: '0002',
      });
      assert.deepEqual(n1.applied, ['0001', '0002']);
      assert.equal(scalar(container, 'ushso_nminus1', "select to_regclass('ops.outbox') is null;"), 't');
      const upgraded = await applyMigrations({
        container, database: 'ushso_nminus1', environment: 'local',
        'deployment-fingerprint': localFingerprint,
        through: '0003',
      });
      assert.deepEqual(upgraded.applied, ['0003']);
      assert.equal(scalar(container, 'ushso_nminus1', "select to_regclass('ops.outbox') is not null;"), 't');
    });

    await t.test('migration rerun is idempotent and drift-safe', async () => {
      const rerun = await applyMigrations({
        container, database: 'ushso', environment: 'local',
        'deployment-fingerprint': localFingerprint,
        through: '0003',
      });
      assert.deepEqual(rerun.applied, []);
      assert.deepEqual(rerun.skipped, ['0001', '0002', '0003']);
      const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'db/migrations/manifest.json'), 'utf8'));
      for (const migration of manifest.migrations) {
        assert.equal(await sha256File(path.join(repositoryRoot, 'db/migrations', migration.file)), migration.byte_sha256);
      }
    });

    await t.test('environment fence refuses cross-environment reuse', async () => {
      await assert.rejects(
        applyMigrations({
          container, database: 'ushso', environment: 'local',
          'deployment-fingerprint': '1'.repeat(64),
        }),
        /environment fence mismatch/,
      );
      await assert.rejects(
        applyMigrations({
          container, database: 'ushso', environment: 'staging',
          'deployment-fingerprint': '2'.repeat(64),
        }),
        /pending_external_authorization/,
      );
    });

    const fixtureSql = await readFile(path.join(repositoryRoot, 'db/fixtures/production-shaped.sql'), 'utf8');
    runPsql({ container, database: 'ushso', sql: fixtureSql });

    await t.test('production-shaped fixture is complete and metadata-only', () => {
      assert.equal(scalar(container, 'ushso', 'select count(*) from registry.sources;'), '64');
      assert.equal(scalar(container, 'ushso', 'select count(*) from ingest.harvest_runs;'), '512');
      assert.equal(scalar(container, 'ushso', 'select count(*) from ingest.jobs;'), '8192');
      assert.equal(scalar(container, 'ushso', 'select count(*) from ops.outbox;'), '8192');
      assert.equal(scalar(container, 'ushso', 'select count(*) from ops.processed_event_keys;'), '8192');
      assert.equal(scalar(container, 'ushso', 'select count(*) from ingest.capture_references;'), '512');
      assert.equal(scalar(container, 'ushso', "select count(*) from information_schema.columns where table_schema in ('registry','ingest','ops') and column_name ~* '(response_body|question_text|credential_value|authorization_header|cookie_value)';"), '0');
    });

    await t.test('least-privilege grants deny public and cross-role mutation', () => {
      const workerLogins = ['ushso_public', 'ushso_scheduler', 'ushso_harvest', 'ushso_normalize', 'ushso_projector', 'ushso_ops'];
      for (const role of workerLogins) {
        assert.equal(runPsql({ container, database: 'ushso', user: role, tuplesOnly: true, sql: 'select current_user;' }).stdout.trim(), role);
      }
      assert.equal(scalar(container, 'ushso', "select count(*) from pg_roles where rolname in ('ushso_public','ushso_scheduler','ushso_harvest','ushso_normalize','ushso_projector','ushso_ops') and rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole and not rolbypassrls;"), '6');
      assert.equal(scalar(container, 'ushso', "select count(*) from pg_authid where rolname in ('ushso_public','ushso_scheduler','ushso_harvest','ushso_normalize','ushso_projector','ushso_ops') and rolpassword is not null;"), '0');
      assert.equal(scalar(container, 'ushso', "select count(*) from pg_roles where rolname ~ '^ushso_.*_owner$' and rolcanlogin;"), '0');
      assert.equal(scalar(container, 'ushso', "select count(*) from pg_auth_members m join pg_roles member_role on member_role.oid=m.member where member_role.rolname in ('ushso_public','ushso_scheduler','ushso_harvest','ushso_normalize','ushso_projector','ushso_ops');"), '0');
      runPsql({ container, database: 'ushso', user: 'ushso_registry_owner', sql: 'select 1;', expectFailure: true });
      runPsql({ container, database: 'ushso', user: 'ushso_maintenance', sql: 'select 1;', expectFailure: true });

      runPsql({ container, database: 'ushso', user: 'ushso_public', sql: 'select count(*) from search.published_runtime_status;' });
      runPsql({ container, database: 'ushso', user: 'ushso_public', sql: 'select count(*) from search.published_generation_records where index_generation_id = \'generation-local\';' });
      runPsql({ container, database: 'ushso', sql: 'set role ushso_public; select count(*) from registry.sources;', expectFailure: true });
      runPsql({ container, database: 'ushso', user: 'ushso_public', sql: 'select count(*) from registry.credential_references;', expectFailure: true });
      runPsql({ container, database: 'ushso', user: 'ushso_public', sql: 'select count(*) from ingest.capture_references;', expectFailure: true });
      runPsql({ container, database: 'ushso', user: 'ushso_public', sql: 'select count(*) from catalog.any_future_relation;', expectFailure: true });
      runPsql({ container, database: 'ushso', sql: 'set role ushso_public; create table search.public_escape(id integer);', expectFailure: true });
      runPsql({ container, database: 'ushso', sql: 'set role ushso_scheduler; select count(*) from registry.source_schedules; reset role;' });
      runPsql({ container, database: 'ushso', sql: 'set role ushso_scheduler; select count(*) from ingest.capture_references;', expectFailure: true });
      runPsql({ container, database: 'ushso', sql: 'set role ushso_projector; select count(*) from ingest.capture_references;', expectFailure: true });
      runPsql({ container, database: 'ushso', sql: 'set role ushso_harvest; update search.published_runtime_status set publication_id = \'x\';', expectFailure: true });
      assert.equal(scalar(container, 'ushso', "select count(*) from information_schema.role_table_grants where grantee = 'ushso_public' and privilege_type <> 'SELECT';"), '0');
    });

    await t.test('state and logical idempotency constraints fail closed', () => {
      runPsql({ container, database: 'ushso', sql: "update ingest.harvest_runs set state='starting' where run_id='run-1';" });
      runPsql({ container, database: 'ushso', sql: "update ingest.harvest_runs set state='projecting' where run_id='run-1';", expectFailure: true });
      assert.equal(scalar(container, 'ushso', "select state from ingest.harvest_runs where run_id='run-1';"), 'starting');
      runPsql({
        container, database: 'ushso', expectFailure: true,
        sql: "insert into ops.processed_event_keys select consumer_name,event_id,'other-effect',source_id,run_id,job_id,event_type,message_idempotency_key,run_attempt,lease_epoch,origin_id,target_class,retry_policy_version,repeat('a',64),clock_timestamp(),clock_timestamp()+interval '90 days' from ops.processed_event_keys where event_id='event-1';",
      });
      runPsql({
        container, database: 'ushso', expectFailure: true,
        sql: "insert into ingest.harvest_runs(run_id,plan_id,source_id,endpoint_id,source_configuration_revision,scheduled_slot,mode,run_idempotency_key,state,active_attempt,last_known_good_publication_id,state_changed_at,created_at,updated_at) select 'duplicate-run',plan_id,source_id,endpoint_id,source_configuration_revision,scheduled_slot,mode,'different-key','scheduled',1,'publication-static-v1',clock_timestamp(),clock_timestamp(),clock_timestamp() from ingest.harvest_runs where run_id='run-2';",
      });
    });

    await t.test('lease and reconciliation queries use bounded indexes', async () => {
      const leaseSql = await readFile(path.join(repositoryRoot, 'db/queries/lease-jobs.sql'), 'utf8');
      const plan = runPsql({
        container, database: 'ushso',
        variables: { job_type: 'harvest_page', lease_limit: '25', lease_owner: 'test-worker', lease_seconds: '30' },
        sql: `set enable_seqscan=off; explain (costs off) ${leaseSql}`,
      }).stdout;
      assert.match(plan, /jobs_lease_due_idx/);
      const leased = runPsql({
        container, database: 'ushso', tuplesOnly: true,
        variables: { job_type: 'harvest_page', lease_limit: '25', lease_owner: 'test-worker', lease_seconds: '30' },
        sql: leaseSql,
      }).stdout.trim().split('\n').filter(Boolean);
      assert.equal(leased.length, 25);
      assert.equal(scalar(container, 'ushso', "select count(*) from ingest.jobs where state='leased' and lease_owner='test-worker';"), '25');

      const outboxSql = await readFile(path.join(repositoryRoot, 'db/queries/lease-outbox.sql'), 'utf8');
      const outboxPlan = runPsql({
        container, database: 'ushso',
        variables: { lease_limit: '25', lease_owner: 'test-dispatcher', lease_seconds: '30' },
        // The small synthetic fixture can prefer the older created_at index
        // solely to avoid a cheap sort.  Disable that cost-based shortcut so
        // this assertion verifies that the due-time index is available for
        // the production-shaped access path.
        sql: `set enable_seqscan=off; set enable_sort=off; explain (costs off) ${outboxSql}`,
      }).stdout;
      assert.match(outboxPlan, /outbox_lease_due_idx/);

      const reconcileSql = await readFile(path.join(repositoryRoot, 'db/queries/reconcile-workflows.sql'), 'utf8');
      const reconcilePlan = runPsql({
        container, database: 'ushso',
        variables: { reconcile_before: '2100-01-01T00:00:00Z', reconcile_limit: '25' },
        sql: `set enable_seqscan=off; explain (costs off) ${reconcileSql}`,
      }).stdout;
      assert.match(reconcilePlan, /workflow_reconcile_idx/);

      const recoverSql = await readFile(path.join(repositoryRoot, 'db/queries/recover-expired-leases.sql'), 'utf8');
      runPsql({ container, database: 'ushso', sql: "update ingest.jobs set lease_expires_at=clock_timestamp()-interval '1 second' where lease_owner='test-worker';" });
      runPsql({ container, database: 'ushso', sql: recoverSql });
      assert.equal(scalar(container, 'ushso', "select count(*) from ingest.jobs where lease_owner='test-worker';"), '0');
    });

    await t.test('monthly partitions route data and missing partitions fail closed', () => {
      assert.equal(scalar(container, 'ushso', 'select count(*) from ops.partition_registry;'), '35');
      assert.equal(scalar(container, 'ushso', "select count(*) || ':' || min(n) || ':' || max(n) from (select regexp_replace(partition_relation, '_[0-9]{4}_[0-9]{2}$', '') parent, count(*) n from ops.partition_registry group by 1) counts;"), '7:5:5');
      assert.match(scalar(container, 'ushso', "select min(tableoid::regclass::text) from ingest.job_attempts;"), /^ingest\.job_attempts_\d{4}_\d{2}$/);
      runPsql({
        container, database: 'ushso', expectFailure: true,
        sql: "insert into ingest.job_attempts(attempt_id,job_id,run_id,source_id,delivery_attempt,outcome,database_transaction_committed,transport_action,recorded_at,trace_id) values ('outside-partition','job-1','run-1','src-1',2,'started',false,'none_pending',clock_timestamp()+interval '24 months','outside-partition-trace');",
      });
      const future = new Date();
      future.setUTCDate(1);
      future.setUTCHours(0, 0, 0, 0);
      future.setUTCMonth(future.getUTCMonth() + 4);
      const month = future.toISOString().slice(0, 10);
      const manage = spawnSync(process.execPath, [
        path.join(repositoryRoot, 'db/tools/manage-partitions.mjs'),
        '--container', container, '--database', 'ushso', '--environment', 'local',
        '--deployment-fingerprint', localFingerprint, '--parent', 'ingest.job_attempts', '--month', month,
      ], { encoding: 'utf8' });
      assert.equal(manage.status, 0, manage.stderr);
      const suffix = month.slice(0, 7).replace('-', '_');
      assert.equal(scalar(container, 'ushso', `select to_regclass('ingest.job_attempts_${suffix}') is not null;`), 't');
      assert.equal(scalar(container, 'ushso', `select count(*) from ops.partition_registry where partition_relation='ingest.job_attempts_${suffix}';`), '1');
    });

    await t.test('autovacuum policy and analyze receipts are observable', () => {
      const options = scalar(container, 'ushso', "select array_to_string(reloptions, ',') from pg_class where oid='ingest.jobs'::regclass;");
      assert.match(options, /fillfactor=75/);
      assert.match(options, /autovacuum_vacuum_scale_factor=0.02/);
      assert.match(options, /autovacuum_analyze_scale_factor=0.01/);
      runPsql({ container, database: 'ushso', sql: 'vacuum (analyze) ingest.jobs;' });
      assert.equal(scalar(container, 'ushso', "select (last_analyze is not null or last_autoanalyze is not null) from pg_stat_user_tables where relid='ingest.jobs'::regclass;"), 't');
    });

    await t.test('archive checksum, dependency proof, and isolated restore pass', async () => {
      const now = new Date();
      const lower = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const upper = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const suffix = `${lower.getUTCFullYear()}_${String(lower.getUTCMonth() + 1).padStart(2, '0')}`;
      const partition = `ingest.job_attempts_${suffix}`;
      runPsql({
        container, database: 'ushso', sql: `
          insert into ops.partition_registry(partition_relation,ledger_name,lower_bound,upper_bound,state,created_at,retention_deadline)
          values ('${partition}','run_job_attempt','${lower.toISOString()}','${upper.toISOString()}','online',clock_timestamp(),'${upper.toISOString()}'::timestamptz+interval '90 days')
          on conflict do nothing;`,
      });
      const scratch = await mkdtemp(path.join(tmpdir(), 'ushso-wp3-archive-'));
      const archivePath = path.join(scratch, `${partition.replace('.', '-')}.dump`);
      const archive = await archivePartition({
        container, database: 'ushso', environment: 'local',
        'deployment-fingerprint': localFingerprint, partition, output: archivePath,
      });
      assert.equal(archive.row_count, 8192);
      assert.match(archive.archive_object_sha256, /^[a-f0-9]{64}$/);

      runPsql({ container, database: 'postgres', sql: 'create database ushso_restore;' });
      await applyMigrations({
        container, database: 'ushso_restore', environment: 'local',
        'deployment-fingerprint': localFingerprint,
      });
      await restoreArchive({
        container, database: 'ushso_restore', environment: 'local',
        'deployment-fingerprint': localFingerprint, input: archivePath,
      });
      assert.equal(scalar(container, 'ushso_restore', `select count(*) from ${partition};`), String(archive.row_count));

      runPsql({
        container, database: 'ushso', expectFailure: true,
        sql: `insert into ops.gc_dependency_proofs values ('bad-proof','${partition}',false,true,true,true,true,true,true,true,true,'{}','test',clock_timestamp());`,
      });
      runPsql({
        container, database: 'ushso', sql: `
          insert into ops.archive_manifests
            (archive_manifest_id,partition_relation,lower_bound,upper_bound,row_count,logical_sha256,
             archive_object_sha256,archive_locator,policy_version,operator_id,archive_state,archived_at,restore_tested_at)
          values ('archive-current','${partition}','${lower.toISOString()}','${upper.toISOString()}',${archive.row_count},
            '${archive.archive_object_sha256}','${archive.archive_object_sha256}',
            'ledger-archives/sha256/${archive.archive_object_sha256.slice(0, 2)}/${archive.archive_object_sha256}',
            '1.0.0','wp3-local-test','restore_verified',clock_timestamp(),clock_timestamp());
          insert into ops.gc_dependency_proofs
            (dependency_proof_id,partition_relation,no_active_work,no_unexpired_idempotency,
             no_workflow_or_replay_dependency,no_publication_or_rollback_dependency,
             no_evidence_or_review_dependency,archive_checksum_verified,archive_restore_verified,
             backup_pitr_compatible,legal_policy_approved,evidence_payload,checked_by,checked_at)
          values ('proof-current','${partition}',true,true,true,true,true,true,true,true,true,
            '{"scope":"local_synthetic"}','wp3-local-test',clock_timestamp());
          insert into ops.gc_watermarks
            (gc_watermark_id,partition_relation,lower_bound,upper_bound,row_count,logical_sha256,
             policy_version,archive_manifest_id,dependency_proof_id,operator_id,audit_event_id,approved_at)
          values ('watermark-current','${partition}','${lower.toISOString()}','${upper.toISOString()}',${archive.row_count},
            '${archive.archive_object_sha256}','1.0.0','archive-current','proof-current','wp3-local-test','audit-local',clock_timestamp());`,
      });
      assert.equal(scalar(container, 'ushso', "select count(*) from ops.gc_watermarks where gc_watermark_id='watermark-current';"), '1');
    });

    await t.test('connection failure rolls back and direct maintenance is fenced', () => {
      const before = scalar(container, 'ushso', 'select count(*) from ops.outbox;');
      runPsql({ container: 'ushso-wp3-intentionally-absent', database: 'ushso', sql: 'select 1;', expectFailure: true });
      assert.equal(scalar(container, 'ushso', 'select count(*) from ops.outbox;'), before);
      runPsql({
        container, database: 'ushso', expectFailure: true,
        sql: "begin; insert into ops.outbox(event_id,event_type,producer,idempotency_key,state,references_payload,trace_id,attempt_count,maximum_delivery_attempts,lease_epoch,next_eligible_at,created_at,updated_at) values ('rollback-event','projection_requested','projector','rollback-key','pending','{}','rollback-transaction-trace',0,5,0,clock_timestamp(),clock_timestamp(),clock_timestamp()); do $$ begin raise exception 'injected connection-class failure'; end $$; commit;",
      });
      assert.equal(scalar(container, 'ushso', "select count(*) from ops.outbox where event_id='rollback-event';"), '0');
      runPsql({ container, database: 'ushso', sql: 'set role ushso_public; alter table search.published_runtime_status owner to ushso_public;', expectFailure: true });
      assert.equal(scalar(container, 'ushso', "select environment from ops.environment_fence where singleton;"), 'local');
      const maintenanceCheck = spawnSync(process.execPath, [
        path.join(repositoryRoot, 'db/tools/assert-direct-maintenance.mjs'),
        '--container', container, '--database', 'ushso', '--environment', 'local',
        '--deployment-fingerprint', localFingerprint,
      ], { encoding: 'utf8' });
      assert.equal(maintenanceCheck.status, 0, maintenanceCheck.stderr);
      const maintenanceResult = JSON.parse(maintenanceCheck.stdout);
      assert.equal(maintenanceResult.path, 'direct_non_hyperdrive');
      assert.equal(maintenanceResult.credential_value_emitted, false);
    });

    await t.test('correctness-ledger registry covers every section 9.11 class', () => {
      assert.equal(scalar(container, 'ushso', 'select count(*) from ops.correctness_ledger_registry;'), '7');
      assert.equal(scalar(container, 'ushso', "select count(*) from ops.correctness_ledger_registry where minimum_online_days < 90;"), '0');
      assert.equal(scalar(container, 'ushso', "select implementation_state from ops.correctness_ledger_registry where ledger_name='publication_history';"), 'planned_future_migration');
      assert.equal(scalar(container, 'ushso', 'select audit_days from ops.retention_policies where active;'), '365');
    });
  } finally {
    postgres.stop();
  }
});
