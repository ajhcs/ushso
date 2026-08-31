import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PostgresControlStoreError,
  assertControlStore,
  createHyperdriveOpenDatabase,
  createPostgresControlStoreFactory,
  resolveAuditActor,
  withFreshDatabaseClient
} from '../src/index.mjs';

class RecordingClient {
  static instances = [];
  static responder = () => ({ rows: [] });

  constructor(configuration) {
    this.configuration = configuration;
    this.calls = [];
    this.connected = false;
    this.ended = false;
    RecordingClient.instances.push(this);
  }

  async connect() { this.connected = true; }

  async query(text, values) {
    this.calls.push({ text, values });
    return RecordingClient.responder({ text, values, client: this });
  }

  async end() { this.ended = true; }
}

function resetClient() {
  RecordingClient.instances.length = 0;
  RecordingClient.responder = () => ({ rows: [] });
}

test('PostgreSQL factory opens a fresh connected Client and exposes the complete ControlStore port', async () => {
  resetClient();
  const openDatabase = createPostgresControlStoreFactory({
    connectionString: 'postgres://runtime:private@example.invalid/ushso',
    Client: RecordingClient,
    applicationName: 'ushso-harvest'
  });
  const first = await openDatabase();
  const second = await openDatabase();
  assertControlStore(first);
  assertControlStore(second);
  assert.notEqual(first, second);
  assert.equal(RecordingClient.instances.length, 2);
  assert.deepEqual(RecordingClient.instances.map(client => client.connected), [true, true]);
  assert.equal(RecordingClient.instances[0].configuration.connectionString, 'postgres://runtime:private@example.invalid/ushso');
  assert.equal(RecordingClient.instances[0].configuration.application_name, 'ushso-harvest');
  await first.close();
  await second.close();
  assert.deepEqual(RecordingClient.instances.map(client => client.ended), [true, true]);
});

test('Hyperdrive factory reads only the binding connectionString and withFreshDatabaseClient closes in finally', async () => {
  resetClient();
  const openDatabase = createHyperdriveOpenDatabase({
    hyperdrive: { connectionString: 'postgres://hyperdrive-secret@example.invalid/ushso', unrelated: 'ignored' },
    Client: RecordingClient
  });
  await assert.rejects(
    withFreshDatabaseClient(openDatabase, async database => {
      assertControlStore(database);
      throw Object.assign(new Error('CALLBACK_FAILED'), { code: 'CALLBACK_FAILED' });
    }),
    error => error.code === 'CALLBACK_FAILED'
  );
  assert.equal(RecordingClient.instances.length, 1);
  assert.equal(RecordingClient.instances[0].ended, true);
});

test('transaction commits successful work and rolls back rejected work without nesting', async () => {
  resetClient();
  RecordingClient.responder = ({ text }) => {
    if (text.includes('registry.can_source_fetch')) return { rows: [{ allowed: true }] };
    return { rows: [] };
  };
  const database = await createPostgresControlStoreFactory({
    connectionString: 'postgres://example.invalid/ushso', Client: RecordingClient
  })();
  const allowed = await database.transaction('fetch-gate', transaction => transaction.canSourceFetch({ sourceId: 'source_fixture' }));
  assert.equal(allowed, true);
  assert.deepEqual(RecordingClient.instances[0].calls.map(call => call.text.trim()).filter(text => ['begin', 'commit', 'rollback'].includes(text)), ['begin', 'commit']);

  await assert.rejects(
    database.transaction('rejected', async () => { throw Object.assign(new Error('WORK_REJECTED'), { code: 'WORK_REJECTED' }); }),
    error => error.code === 'WORK_REJECTED'
  );
  assert.deepEqual(RecordingClient.instances[0].calls.map(call => call.text.trim()).filter(text => ['begin', 'commit', 'rollback'].includes(text)), ['begin', 'commit', 'begin', 'rollback']);
  await database.close();
});

test('scheduler lease query is positional and complete schedule groups become one opaque lease', async () => {
  resetClient();
  RecordingClient.responder = ({ text }) => {
    if (text.includes('registry.lease_due_source_schedules')) return { rows: [
      { schedule_id: 'schedule_a', source_id: 'source_fixture', endpoint_id: 'endpoint_fixture', scope_id: 'scope_a', cadence_seconds: 3600, next_due_at: new Date('2026-08-30T00:00:00Z'), mode: 'incremental', configuration_revision: 1, optional_degradation_policy: [], lease_owner: 'scheduler_fixture', lease_epoch: '4', lease_expires_at: new Date('2026-08-30T00:01:00Z') },
      { schedule_id: 'schedule_b', source_id: 'source_fixture', endpoint_id: 'endpoint_fixture', scope_id: 'scope_b', cadence_seconds: 3600, next_due_at: new Date('2026-08-30T00:00:00Z'), mode: 'incremental', configuration_revision: 1, optional_degradation_policy: [], lease_owner: 'scheduler_fixture', lease_epoch: '8', lease_expires_at: new Date('2026-08-30T00:01:00Z') }
    ] };
    return { rows: [] };
  };
  const database = await createPostgresControlStoreFactory({ connectionString: 'postgres://example.invalid/ushso', Client: RecordingClient })();
  const due = await database.leaseDueSources({
    scheduledSlot: '2026-08-30T00:00:00.000Z', leaseAcquiredAt: '2026-08-30T00:00:00.000Z',
    leaseOwner: 'scheduler_fixture', leaseExpiresAt: '2026-08-30T00:01:00.000Z', limit: 10
  });
  assert.equal(due.length, 1);
  assert.deepEqual(due[0].scope_ids, ['scope_a', 'scope_b']);
  assert.match(due[0].source_lease_token, /^sl1\./);
  const call = RecordingClient.instances[0].calls.at(-1);
  assert.match(call.text, /\$1::timestamptz/);
  assert.equal(call.text.includes('2026-08-30T00:00:00.000Z'), false);
  assert.deepEqual(call.values, ['2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z', 'scheduler_fixture', '2026-08-30T00:01:00.000Z', 10]);
  await database.close();
});

test('database failures surface redacted structured metadata and never copy secrets or server detail', async () => {
  resetClient();
  const emitted = [];
  RecordingClient.responder = () => {
    const error = new Error('password=do-not-copy connectionString=postgres://secret upstream raw row');
    error.code = '40001';
    error.detail = 'authorization: bearer private';
    throw error;
  };
  const database = await createPostgresControlStoreFactory({
    connectionString: 'postgres://user:super-secret@example.invalid/ushso', Client: RecordingClient,
    logger: { emit(event) { emitted.push(event); } }
  })();
  await assert.rejects(
    database.canSourceFetch({ sourceId: 'source_fixture' }),
    error => {
      assert.ok(error instanceof PostgresControlStoreError);
      assert.equal(error.code, 'POSTGRES_40001');
      assert.equal(error.sqlState, '40001');
      assert.equal(error.retryable, true);
      assert.equal(error.message.includes('super-secret'), false);
      assert.equal(error.message.includes('bearer private'), false);
      return true;
    }
  );
  assert.deepEqual(emitted, [{ level: 'error', event: 'postgres.control_store_error', outcome: 'failed', safe_detail_code: 'POSTGRES_40001' }]);
  await database.close();
});

test('invalid factory configuration fails before any connection attempt', () => {
  resetClient();
  assert.throws(() => createPostgresControlStoreFactory({ connectionString: '', Client: RecordingClient }), error => error.code === 'POSTGRES_CONNECTION_STRING_MISSING');
  assert.throws(() => createHyperdriveOpenDatabase({ hyperdrive: {}, Client: RecordingClient }), error => error.code === 'HYPERDRIVE_BINDING_MISSING');
  assert.equal(RecordingClient.instances.length, 0);
});

test('audit identity is derived from trusted context and caller-supplied operator IDs fail closed', async () => {
  assert.deepEqual(
    resolveAuditActor({ auditEventId: 'audit_system', action: 'source_pause_requested' }),
    { actorId: 'ushso-ingestion-control-store', actorType: 'system_reconciler' },
  );
  assert.throws(
    () => resolveAuditActor({ auditEventId: 'audit_forged', action: 'correctness_ledger_gc', operatorId: 'operator_forged' }),
    error => error.code === 'PRIVILEGED_PRINCIPAL_BINDING_REQUIRED',
  );
  assert.throws(
    () => resolveAuditActor(
      { auditEventId: 'audit_mismatch', action: 'correctness_ledger_gc', operatorId: 'operator_forged' },
      () => ({ actorId: 'operator_trusted', actorType: 'maintenance_identity' }),
    ),
    error => error.code === 'PRIVILEGED_PRINCIPAL_BINDING_MISMATCH',
  );
  assert.deepEqual(
    resolveAuditActor(
      { auditEventId: 'audit_bound', action: 'correctness_ledger_gc', operatorId: 'operator_trusted' },
      () => ({ actorId: 'operator_trusted', actorType: 'maintenance_identity' }),
    ),
    { actorId: 'operator_trusted', actorType: 'maintenance_identity' },
  );

  resetClient();
  RecordingClient.responder = ({ text }) => {
    if (text.includes('insert into ops.audit_events')) return { rows: [] };
    if (text.includes('select * from ops.audit_events')) {
      return { rows: [{
        audit_event_id: 'audit_bound', action: 'correctness_ledger_gc', actor_id: 'operator_trusted',
        actor_type: 'maintenance_identity', object_type: 'partition', object_id: 'partition_eligible',
      }] };
    }
    return { rows: [] };
  };
  const database = await createPostgresControlStoreFactory({
    connectionString: 'postgres://example.invalid/ushso',
    Client: RecordingClient,
    trustedPrincipalSource: () => ({ actorId: 'operator_trusted', actorType: 'maintenance_identity' }),
  })();
  await database.appendAudit({
    auditEventId: 'audit_bound', action: 'correctness_ledger_gc', operatorId: 'operator_trusted',
    partitionId: 'partition_eligible', recordedAt: '2026-08-30T00:00:00.000Z',
  });
  const insert = RecordingClient.instances[0].calls.find(call => call.text.includes('insert into ops.audit_events'));
  assert.equal(insert.values[2], 'operator_trusted');
  assert.equal(insert.values[3], 'maintenance_identity');
  await database.close();

  resetClient();
  const unbound = await createPostgresControlStoreFactory({
    connectionString: 'postgres://example.invalid/ushso', Client: RecordingClient,
  })();
  await assert.rejects(
    unbound.appendAudit({
      auditEventId: 'audit_forged', action: 'correctness_ledger_gc', operatorId: 'operator_forged',
      partitionId: 'partition_eligible', recordedAt: '2026-08-30T00:00:00.000Z',
    }),
    error => error.code === 'PRIVILEGED_PRINCIPAL_BINDING_REQUIRED',
  );
  assert.equal(RecordingClient.instances[0].calls.some(call => call.text.includes('insert into ops.audit_events')), false);
  await unbound.close();
});

test('normalization success artifacts are written only after the job reaches succeeded', () => {
  const source = readFileSync(new URL('../src/postgres-control-store.mjs', import.meta.url), 'utf8');
  const completed = source.indexOf("query('complete-processed-job'");
  const artifact = source.indexOf("query('record-normalization-success-artifact'");
  assert.ok(completed >= 0 && artifact > completed, 'artifact authorization must follow the job state transition');
});
