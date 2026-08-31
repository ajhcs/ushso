import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertQueueControlEnvelope, classifyFailure, createFakeQueue, createFakeQueueMessage,
  createFakeWorkflowPlatform, createInMemoryControlPlane, createOutboxDispatcher,
  createQueueConsumer, createQueueRetentionReconciler, createWorkflowStartReconciler,
  fullJitterDelaySeconds, queueMessageFromOutbox, STAGE_POLICIES
} from '../src/index.mjs';
import { createHarvestWorker, createCloudflareWorkflowPlatform, createHarvestWorkflowEntrypoint } from '../../../services/harvest-worker/index.mjs';
import { createSchedulerWorker } from '../../../services/scheduler-worker/index.mjs';
import { createScheduledPlane, queueBody, seedQueueWork, SLOT } from './helpers.mjs';

const PLUS = milliseconds => new Date(Date.parse(SLOT) + milliseconds).toISOString();

test('Queue-retention reconciliation restores full identity with a new fence and rejects stale delivery', async () => {
  const plane = createInMemoryControlPlane();
  const body = queueBody({ eventId: 'event_expired_queue', jobId: 'job_expired_queue', runId: 'run_expired_queue' });
  body.references.capture_ref_id = 'capture_metadata_fixture';
  body.references.cursor_ref_id = 'cursor_fixture_page_2';
  seedQueueWork(plane, body, { transportRetentionExpiresAt: PLUS(60_000) });
  const reconciler = createQueueRetentionReconciler({ openDatabase: plane.openDatabase, configuration: { queueRetentionMs: 120_000 } });
  assert.deepEqual(await reconciler.reconcile({ now: PLUS(59_999) }), []);
  const [recovered] = await reconciler.reconcile({ now: PLUS(60_000) });
  assert.equal(recovered.outcome, 'reledgered');
  const state = plane.inspect();
  const job = state.jobs.get(body.references.job_id);
  assert.equal(job.delivery_fence.lease_epoch, 2);
  const recoveryEvent = state.outbox.get(recovered.eventId);
  assert.equal(recoveryEvent.references.capture_ref_id, 'capture_metadata_fixture');
  assert.equal(recoveryEvent.references.cursor_ref_id, 'cursor_fixture_page_2');
  assert.equal(recoveryEvent.event_type, 'normalize_requested');

  let processorCalls = 0;
  const consumer = createQueueConsumer({
    openDatabase: plane.openDatabase, stage: 'normalize_record', configuration: { clock: () => PLUS(60_001) },
    processor: async () => { processorCalls += 1; return { effect: { restored: true } }; }
  });
  const stale = createFakeQueueMessage({ id: 'transport_stale', body, attempts: 1 });
  const [staleResult] = await consumer.handleBatch({ queue: 'normalize-record', messages: [stale] });
  assert.equal(stale.action.type, 'ack');
  assert.equal(staleResult.suppressedReason, 'stale_job_fence');
  assert.equal(processorCalls, 0);

  const queue = createFakeQueue('normalize-record');
  const dispatcher = createOutboxDispatcher({ openDatabase: plane.openDatabase, queueForEvent: () => queue, configuration: { queueRetentionMs: 120_000 } });
  await dispatcher.dispatch({ now: PLUS(60_001) });
  const restoredBody = queue.sent[0].body;
  assert.equal(restoredBody.delivery_fence.lease_epoch, 2);
  const restored = createFakeQueueMessage({ id: 'transport_restored', body: restoredBody, attempts: 1 });
  await consumer.handleBatch({ queue: 'normalize-record', messages: [restored] });
  assert.equal(restored.action.type, 'ack');
  assert.equal(processorCalls, 1);
});

test('Workflow retention is inclusive at the boundary for unresolved and mapped attempts', async () => {
  const retentionMs = 120_000;
  {
    const { plane } = await createScheduledPlane({ workflowRetentionMs: retentionMs });
    const platform = createFakeWorkflowPlatform();
    const reconciler = createWorkflowStartReconciler({ openDatabase: plane.openDatabase, workflowPlatform: platform, configuration: { clock: () => PLUS(retentionMs - 1) } });
    const result = await reconciler.reconcile({ now: PLUS(retentionMs - 1) });
    assert.equal(result[0].outcome, 'resolved');
    assert.equal(platform.instances.size, 1);
  }
  for (const offset of [retentionMs, retentionMs + 1]) {
    const { plane, runId } = await createScheduledPlane({ workflowRetentionMs: retentionMs });
    const platform = createFakeWorkflowPlatform();
    const result = await createWorkflowStartReconciler({ openDatabase: plane.openDatabase, workflowPlatform: platform, configuration: { clock: () => PLUS(offset) } }).reconcile({ now: PLUS(offset) });
    assert.equal(result[0].outcome, 'retention_expired');
    assert.equal(platform.instances.size, 0);
    assert.equal(plane.inspect().outbox.get(`event_workflow_${runId}`).state, 'dead');
  }
  {
    const { plane, runId } = await createScheduledPlane({ workflowRetentionMs: retentionMs });
    const platform = createFakeWorkflowPlatform();
    let operationalNow = SLOT;
    const reconciler = createWorkflowStartReconciler({ openDatabase: plane.openDatabase, workflowPlatform: platform, configuration: { clock: () => operationalNow } });
    await reconciler.reconcile({ now: SLOT });
    operationalNow = PLUS(retentionMs);
    const result = await reconciler.reconcile({ now: PLUS(retentionMs) });
    assert.equal(result[0].outcome, 'retention_expired');
    assert.equal(plane.inspect().runs.get(runId).state, 'failed');
  }
});

test('stale outbox lease is fenced and a poison event cannot abort later batch rows', async () => {
  const plane = createInMemoryControlPlane();
  plane.seedOutbox({
    event_id: 'event_stale_lease', event_type: 'normalize_requested', source_id: 'source_fixture', run_attempt: 1, job_lease_epoch: 1,
    references: { run_id: 'run_fixture', job_id: 'job_fixture' }, created_at: SLOT
  });
  const firstClient = await plane.openDatabase();
  const [firstLease] = await firstClient.transaction('fixture-first-lease', tx => tx.leaseOutbox({ now: SLOT, ownerId: 'owner_first', leaseExpiresAt: PLUS(1_000), transportRetentionExpiresAt: PLUS(10_000), limit: 1 }));
  await firstClient.close();
  const secondClient = await plane.openDatabase();
  const secondLease = await secondClient.transaction('fixture-second-lease', tx => tx.leaseOutbox({ now: PLUS(1_000), ownerId: 'owner_second', leaseExpiresAt: PLUS(2_000), transportRetentionExpiresAt: PLUS(11_000), limit: 1 }));
  assert.deepEqual(secondLease, []);
  assert.equal(plane.inspect().outbox.get('event_stale_lease').safe_detail_code, 'OUTBOX_SEND_OUTCOME_UNKNOWN_AWAITING_QUEUE_RETENTION');
  await assert.rejects(secondClient.transaction('fixture-stale-mark', tx => tx.markOutboxPublished({ eventId: firstLease.event_id, leaseToken: firstLease.lease_token, publishedAt: PLUS(1_001), transportRetentionExpiresAt: PLUS(10_000) })), /OUTBOX_LEASE_FENCE_REJECTED/);
  await secondClient.close();

  const poisonPlane = createInMemoryControlPlane();
  poisonPlane.seedOutbox({
    event_id: 'event_a_poison', event_type: 'normalize_requested', maximum_delivery_attempts: 1,
    references: { run_id: 'run_poison', job_id: 'job_poison' }, created_at: SLOT
  });
  poisonPlane.seedOutbox({
    event_id: 'event_z_valid', event_type: 'normalize_requested', source_id: 'source_fixture', run_attempt: 1, job_lease_epoch: 1,
    references: { run_id: 'run_valid', job_id: 'job_valid' }, created_at: SLOT
  });
  poisonPlane.seedSource({ source_id: 'source_fixture', endpoint_id: 'endpoint_fixture', scope_ids: ['scope_fixture'], origin_id: 'origin_fixture', state: 'active' });
  poisonPlane.seedRun({ run_id: 'run_valid', source_id: 'source_fixture', state: 'normalizing' });
  poisonPlane.seedJob({
    job_id: 'job_valid', run_id: 'run_valid', source_id: 'source_fixture', job_type: 'normalize_record',
    target_class: 'exact_item', origin_id: 'origin_fixture', delivery_fence: { run_attempt: 1, lease_epoch: 1 },
    message_references: { run_id: 'run_valid', job_id: 'job_valid' }
  });
  const queue = createFakeQueue('normalize-record');
  const results = await createOutboxDispatcher({ openDatabase: poisonPlane.openDatabase, queueForEvent: () => queue }).dispatch({ now: SLOT });
  assert.deepEqual(results.map(result => result.outcome), ['dead', 'published']);
  assert.equal(poisonPlane.inspect().outbox.get('event_a_poison').state, 'dead');
  assert.equal(queue.sent.length, 1);
});

test('typed failure table and retry budgets match the ingestion contract exactly', async () => {
  const transient = ['rate_limited', 'upstream_5xx', 'timeout', 'dns_failure', 'tls_failure', 'internal_failure'];
  const quarantine = ['redirect_unapproved', 'schema_drift', 'parse_failure', 'unexpected_content_type', 'response_too_large', 'canonical_invariant_failure'];
  const pause = ['catalog_auth_misconfigured', 'policy_blocked'];
  const typed = ['expected_access_restriction', 'not_found', 'gone'];
  const failure = (failure_type, target_class, retry_class) => ({ failure_type, target_class, retry_class, safe_detail_code: 'FIXTURE_FAILURE', observed_at: SLOT });
  for (const type of transient) assert.equal(classifyFailure(failure(type, 'exact_item', 'transient')).disposition, 'retry');
  for (const type of quarantine) assert.equal(classifyFailure(failure(type, 'exact_item', 'quarantine')).disposition, 'quarantine');
  for (const type of pause) {
    const result = classifyFailure(failure(type, 'exact_item', 'pause_source'));
    assert.equal(result.disposition, 'pause_source'); assert.equal(result.circuitEffect, 'open_source_circuit');
  }
  for (const type of typed) {
    assert.equal(classifyFailure(failure(type, 'exact_distribution', 'terminal_observation')).disposition, 'typed_observation');
    assert.equal(classifyFailure(failure(type, 'collection', 'enumeration_terminal')).disposition, 'fail_enumeration');
  }
  assert.equal(classifyFailure(failure('cursor_expired', 'pagination_cursor', 'enumeration_terminal')).disposition, 'fail_enumeration');
  assert.equal(classifyFailure(failure('cursor_expired', 'exact_item', 'quarantine')).disposition, 'quarantine');
  assert.throws(() => classifyFailure(failure('timeout', 'exact_item', 'quarantine')), /FAILURE_RETRY_CLASS_MISMATCH/);

  for (const [stage, policy] of Object.entries(STAGE_POLICIES)) {
    const bounded = await fullJitterDelaySeconds({ stage, attempt: policy.maximumDeliveryAttempts, entropyKey: `fixture:${stage}` });
    assert.ok(bounded >= policy.minimumDelaySeconds && bounded <= policy.maximumDelaySeconds);
    assert.equal(await fullJitterDelaySeconds({ stage, attempt: 1, retryAfterSeconds: policy.maximumDelaySeconds + 100, entropyKey: 'ignored' }), policy.maximumDelaySeconds);
  }
});

test('Queue truth boundary rejects payloads and secrets while outbox projection emits IDs only', () => {
  const valid = queueBody();
  assert.equal(assertQueueControlEnvelope(valid), true);
  assert.throws(() => assertQueueControlEnvelope({ ...valid, raw_healthcare_rows: [{ patient_id: 'p1' }] }), /QUEUE_ENVELOPE_FIELD_REJECTED/);
  assert.throws(() => assertQueueControlEnvelope({ ...valid, trace_id: 'secret:\/\/connector/token' }), /QUEUE_ENVELOPE_SECRET_REJECTED/);
  const projected = queueMessageFromOutbox({
    event_id: 'event_boundary', event_type: 'normalize_requested', idempotency_key: 'event:normalize_requested:boundary',
    trace_id: 'trace_boundary', attempt_count: 1, retry_policy_version: 'retry.v1', source_id: 'source_fixture',
    run_attempt: 1, job_lease_epoch: 1, references: valid.references,
    raw_payload: [{ forbidden: true }], healthcare_rows: [{ forbidden: true }]
  }, { origin_id: 'origin_catalog_example', target_class: 'exact_item' });
  assert.equal('raw_payload' in projected, false);
  assert.equal('healthcare_rows' in projected, false);
  assert.equal(assertQueueControlEnvelope(projected), true);
});

test('Cloudflare composition adapters are dependency-injected and normalize current APIs', async () => {
  const calls = [];
  const schedulerWorker = createSchedulerWorker({
    clock: () => PLUS(5_000),
    scheduler: { async dispatchScheduledSlot(input) { calls.push(['scheduler', input]); return { ok: true }; } },
    workflowStartReconciler: { async reconcile(input) { calls.push(['workflow', input]); return []; } },
    queueRetentionReconciler: { async reconcile(input) { calls.push(['queue-retention', input]); return []; } },
    deadLetterRecoveryReconciler: { async reconcile() { calls.push(['dead-letter-recovery', {}]); return []; } },
    outboxDispatcher: { async dispatch(input) { calls.push(['outbox', input]); return []; } }
  });
  const scheduled = await schedulerWorker.scheduled({ scheduledTime: Date.parse(SLOT), cron: '*/5 * * * *' });
  assert.equal(scheduled.completedAt, PLUS(5_000));
  assert.equal(calls[0][1].scheduledTime, Date.parse(SLOT));
  assert.equal(calls[0][1].now, PLUS(5_000));
  assert.deepEqual(calls.map(call => call[0]), ['scheduler', 'workflow', 'dead-letter-recovery', 'queue-retention', 'outbox']);

  const configured = createFakeQueueMessage({ id: 'configured', body: queueBody() });
  const unconfigured = createFakeQueueMessage({ id: 'unconfigured', body: queueBody({ eventId: 'event_unconfigured' }) });
  const harvestWorker = createHarvestWorker({ queueConsumers: { 'normalize-record': { async handleBatch(batch) { batch.messages[0].ack(); return ['handled']; } } } });
  assert.deepEqual(await harvestWorker.queue({ queue: 'normalize-record', messages: [configured] }), ['handled']);
  assert.equal(configured.action.type, 'ack');
  await harvestWorker.queue({ queue: 'unknown-queue', messages: [unconfigured] });
  assert.deepEqual(unconfigured.action, { type: 'retry', delaySeconds: 60 });

  let createInput;
  const binding = {
    async create(input) { createInput = input; return { id: input.id, async status() { return { status: 'running' }; } }; },
    async get(id) { return { id, async status() { return 'running'; } }; }
  };
  const platform = createCloudflareWorkflowPlatform({
    binding, successRetention: '30 days', errorRetention: '30 days', maximumSupportedRetentionMs: 30 * 24 * 60 * 60 * 1000
  });
  const instance = await platform.create({ id: 'workflow_fixture', params: { runId: 'run_fixture' }, requestedAt: SLOT, retentionExpiresAt: PLUS(10 * 24 * 60 * 60 * 1000) });
  assert.equal(instance.status, 'running');
  assert.deepEqual(createInput.retention, { successRetention: '30 days', errorRetention: '30 days' });
  await assert.rejects(platform.create({ id: 'too_long', params: {}, requestedAt: SLOT, retentionExpiresAt: PLUS(31 * 24 * 60 * 60 * 1000) }), /WORKFLOW_DATABASE_RETENTION_EXCEEDS_PLATFORM/);

  class FakeWorkflowBase { constructor(context, env) { this.baseContext = context; this.baseEnv = env; } }
  let factoryInput;
  const Entrypoint = createHarvestWorkflowEntrypoint({
    WorkflowEntrypointBase: FakeWorkflowBase,
    createWorkflow(input) { factoryInput = input; return { async run(event) { return event.params; } }; }
  });
  const env = { binding: 'fixture' };
  const entrypoint = new Entrypoint({ ctx: true }, env);
  assert.equal(factoryInput.env, env);
  assert.deepEqual(await entrypoint.run({ params: { ok: true } }, {}), { ok: true });
});
