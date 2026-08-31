import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDeadLetterRecoveryReconciler, createDeadLetterSink, createFakeQueue,
  createFakeQueueMessage, createFakeWorkflowPlatform, createFakeWorkflowStep,
  createHarvestWorkflow, createInMemoryControlPlane, createOutboxDispatcher,
  createQueueConsumer, createQueueRetentionReconciler, createReplayService,
  createScheduler, createSourceControlService, createStructuredLogger,
  createWorkflowStartReconciler, deterministicOpaqueId, typedFailureError
} from '../src/index.mjs';
import { createCloudflareWorkflowPlatform } from '../../../services/harvest-worker/index.mjs';
import { completeBarriers, createScheduledPlane, queueBody, seedQueueWork, SLOT } from './helpers.mjs';
import { validateIngestionRecord } from '../../../contracts/ingestion/v1.0.0/tools/index.mjs';

const PLUS = milliseconds => new Date(Date.parse(SLOT) + milliseconds).toISOString();
const TRANSPORT = Object.freeze({ maxRetries: 5, maxBatchSize: 1, deadLetterQueue: null });

function sequenceClock(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function seal(scopeId, suffix = scopeId) {
  return {
    contract_version: 'ingestion.v1.0.0', record_kind: 'enumeration_seal',
    enumeration_seal_id: `seal_${suffix}`, run_id: 'run_rebound', source_id: 'source_multi', scope_id: scopeId,
    status: 'sealed', pages_discovered: 1, pages_committed: 1, items_discovered: 2, discoveries_committed: 2,
    page_dead_letter_count: 0, cursor_expired: false, population_digest: 'a'.repeat(64),
    completeness_evidence_ref_id: `evidence_${suffix}`, sealed_at: PLUS(1_000)
  };
}

async function scheduledMultiScopePlane() {
  const plane = createInMemoryControlPlane();
  plane.seedSource({
    source_id: 'source_multi', endpoint_id: 'endpoint_multi', origin_id: 'origin_multi',
    scope_ids: ['scope_aa', 'scope_bb'], configuration_revision: 1, mode: 'full_membership', next_due_at: SLOT, state: 'active'
  });
  const scheduler = createScheduler({ openDatabase: plane.openDatabase });
  const scheduled = await scheduler.dispatchScheduledSlot({ scheduledTime: SLOT, now: SLOT });
  const runId = scheduled.runs[0].runId;
  const platform = createFakeWorkflowPlatform();
  await createWorkflowStartReconciler({ openDatabase: plane.openDatabase, workflowPlatform: platform, configuration: { clock: () => SLOT } }).reconcile({ now: SLOT });
  return { plane, runId, run: plane.inspect().runs.get(runId) };
}

test('attempt rows are contract-shaped from admission through retry and success, and lease expiry fences the commit boundary', async () => {
  {
    const plane = createInMemoryControlPlane();
    const body = queueBody({ eventId: 'event_pending_attempt', jobId: 'job_pending_attempt', runId: 'run_pending_attempt' });
    seedQueueWork(plane, body);
    const database = await plane.openDatabase();
    const prepared = await database.transaction('fixture-pending-attempt', transaction => transaction.prepareEventDelivery({
      consumerName: 'normalize_record_consumer', eventId: body.event_id, eventType: body.event_type,
      messageIdempotencyKey: body.idempotency_key, stage: 'normalize_record', sourceId: body.source_id,
      runId: body.references.run_id, jobId: body.references.job_id, runAttempt: 1, leaseEpoch: 1,
      transportAttempt: 1, now: SLOT, leaseExpiresAt: PLUS(1_000), originId: body.origin_id,
      originCapacity: 2, originRefillPerSecond: 1, targetClass: body.target_class,
      retryPolicyVersion: 'retry.v1', deadLetterQueueName: 'normalize-record-dlq'
    }));
    await database.close();
    assert.equal(prepared.decision, 'process');
    const [attempt] = plane.inspect().attempts;
    assert.equal(attempt.transport_action, 'none_pending');
    assert.equal(attempt.finished_at, null);
    assert.deepEqual(await validateIngestionRecord('ingest-attempt.schema.json', attempt), { valid: true, issues: [] });
  }

  for (const [offset, expectedAction] of [[999, 'ack'], [1_000, 'retry'], [1_001, 'retry']]) {
    const plane = createInMemoryControlPlane();
    const body = queueBody({ eventId: `event_lease_${offset}`, jobId: `job_lease_${offset}`, runId: `run_lease_${offset}` });
    seedQueueWork(plane, body);
    const consumer = createQueueConsumer({
      openDatabase: plane.openDatabase, stage: 'normalize_record',
      configuration: { processingLeaseMs: 1_000, clock: sequenceClock([SLOT, PLUS(offset)]) },
      processor: async () => ({ businessEffectDigest: 'b'.repeat(64), effect: { applied: true } })
    });
    const message = createFakeQueueMessage({ id: `transport_lease_${offset}`, body });
    await consumer.handleBatch({ queue: 'normalize-record', messages: [message] });
    assert.equal(message.action.type, expectedAction);
    assert.equal(plane.inspect().businessEffects.size, expectedAction === 'ack' ? 1 : 0);
    for (const attempt of plane.inspect().attempts) {
      assert.deepEqual(await validateIngestionRecord('ingest-attempt.schema.json', attempt), { valid: true, issues: [] });
    }
  }

  const retryPlane = createInMemoryControlPlane();
  const retryBody = queueBody({ eventId: 'event_attempt_retry', jobId: 'job_attempt_retry', runId: 'run_attempt_retry' });
  seedQueueWork(retryPlane, retryBody);
  const retryConsumer = createQueueConsumer({
    openDatabase: retryPlane.openDatabase, stage: 'normalize_record', configuration: { clock: () => SLOT },
    processor: async () => { throw typedFailureError({
      failure_type: 'rate_limited', retry_class: 'transient', target_class: 'exact_item',
      safe_detail_code: 'UPSTREAM_RATE_LIMITED', http_status: 429, observed_at: SLOT,
      retry_after_seconds: 17
    }); }
  });
  await retryConsumer.handleBatch({ queue: 'normalize-record', messages: [createFakeQueueMessage({ id: 'transport_attempt_retry', body: retryBody })] });
  const [retryAttempt] = retryPlane.inspect().attempts;
  assert.equal(retryAttempt.retry_after_seconds, 17);
  assert.equal('retry_after_seconds' in retryAttempt.failure, false);
  assert.deepEqual(await validateIngestionRecord('ingest-attempt.schema.json', retryAttempt), { valid: true, issues: [] });
});

test('concurrent duplicate delivery has one committed effect and an effect-scoped idempotency key', async () => {
  const plane = createInMemoryControlPlane();
  const body = queueBody({ eventId: 'event_concurrent', jobId: 'job_concurrent', runId: 'run_concurrent' });
  seedQueueWork(plane, body);
  let calls = 0;
  const consumer = createQueueConsumer({
    openDatabase: plane.openDatabase, stage: 'normalize_record', configuration: { clock: () => SLOT },
    processor: async () => {
      calls += 1;
      await Promise.resolve();
      return { businessEffectDigest: 'c'.repeat(64), effect: { applied: calls } };
    }
  });
  const first = createFakeQueueMessage({ id: 'transport_concurrent_a', body });
  const second = createFakeQueueMessage({ id: 'transport_concurrent_b', body });
  await Promise.all([consumer.processOne(first), consumer.processOne(second)]);
  assert.equal(calls, 1);
  assert.equal(plane.inspect().businessEffects.size, 1);
  assert.ok([...plane.inspect().businessEffects.keys()][0].startsWith('effect:'));
  assert.deepEqual(new Set([first.action.type, second.action.type]), new Set(['ack', 'retry']));
  const duplicate = createFakeQueueMessage({ id: 'transport_concurrent_c', body });
  await consumer.processOne(duplicate);
  assert.equal(duplicate.action.type, 'ack');
  assert.equal(calls, 1);
});

test('every included scope must have one foreign-free seal before checkpoints or publication', async () => {
  {
    const { plane, runId, run } = await scheduledMultiScopePlane();
    const barriers = completeBarriers();
    barriers.enumeration = { status: 'sealed', observed_at: PLUS(1_000), seals: [seal('scope_aa'), seal('scope_bb')] };
    barriers.normalization.run_id = runId;
    plane.seedBarriers(runId, barriers);
    const result = await createHarvestWorkflow({ openDatabase: plane.openDatabase, configuration: { clock: () => SLOT } }).run({ instanceId: `harvest-${runId}-1`, params: { runId, attempt: 1, deadlineAt: run.deadline_at } }, createFakeWorkflowStep());
    assert.equal(result.status, 'succeeded');
    const checkpoints = [...plane.inspect().checkpoints.values()].filter(checkpoint => checkpoint.proposed_by_run_id === runId);
    assert.deepEqual(checkpoints.map(checkpoint => checkpoint.scope_id).sort(), ['scope_aa', 'scope_bb']);
    for (const checkpoint of checkpoints) assert.deepEqual(await validateIngestionRecord('checkpoint.schema.json', checkpoint), { valid: true, issues: [] });
  }
  for (const [name, seals] of [
    ['missing', [seal('scope_aa')]],
    ['duplicate', [seal('scope_aa', 'a1'), seal('scope_aa', 'a2')]],
    ['foreign', [seal('scope_aa'), seal('scope_foreign_x')]]
  ]) {
    const { plane, runId, run } = await scheduledMultiScopePlane();
    plane.seedBarriers(runId, { enumeration: { status: 'sealed', observed_at: PLUS(1_000), seals } });
    const result = await createHarvestWorkflow({ openDatabase: plane.openDatabase, configuration: { clock: () => SLOT } }).run({ instanceId: `harvest-${runId}-1`, params: { runId, attempt: 1, deadlineAt: run.deadline_at } }, createFakeWorkflowStep());
    assert.deepEqual(result, { status: 'partial_unpublished', stage: 'enumeration' }, name);
    assert.equal(plane.inspect().checkpoints.size, 0, name);
  }
});

test('per-scope checkpoint compare-and-swap rejects a stale competing run atomically', async () => {
  const plane = createInMemoryControlPlane();
  plane.seedSource({ source_id: 'source_cas', endpoint_id: 'endpoint_cas', origin_id: 'origin_cas', scope_ids: ['scope_cas'], state: 'active' });
  for (const runId of ['run_cas_first', 'run_cas_stale']) {
    plane.seedRun({ run_id: runId, source_id: 'source_cas', scope_ids: ['scope_cas'], state: 'enumerating', scheduled_slot: SLOT });
    plane.seedBarriers(runId, { enumeration: { status: 'sealed', observed_at: PLUS(1_000), seals: [{ ...seal('scope_cas', runId), source_id: 'source_cas' }] } });
  }
  const database = await plane.openDatabase();
  const firstSealId = `seal_run_cas_first`;
  await database.transaction('fixture-cas-first', transaction => transaction.commitCheckpointAndNormalizationOutbox({ runId: 'run_cas_first', attempt: 1, enumerationSealIds: [firstSealId] }));
  await assert.rejects(database.transaction('fixture-cas-stale', transaction => transaction.commitCheckpointAndNormalizationOutbox({ runId: 'run_cas_stale', attempt: 1, enumerationSealIds: ['seal_run_cas_stale'] })), /CHECKPOINT_CAS_REJECTED/);
  await database.close();
  const state = plane.inspect();
  assert.equal([...state.checkpoints.values()].filter(checkpoint => checkpoint.state === 'committed').length, 1);
  assert.equal([...state.outbox.values()].filter(event => event.event_type === 'normalize_requested').length, 2);
});

test('normalization fan-out is exactly per sealed capture, reuses cross-run work, and permits a zero-capture run', async () => {
  const plane = createInMemoryControlPlane();
  plane.seedSource({ source_id: 'source_manifest', endpoint_id: 'endpoint_manifest', origin_id: 'origin_manifest', scope_ids: ['scope_manifest'], state: 'active' });
  const capture = { capture_ref_id: 'capture_shared', capture_sha256: 'b'.repeat(64), capture_kind: 'metadata', discovery_ref_id: 'discovery_shared' };

  plane.seedRun({ run_id: 'run_manifest_one', source_id: 'source_manifest', scope_ids: ['scope_manifest'], state: 'enumerating', scheduled_slot: SLOT });
  plane.seedNormalizationCaptures('run_manifest_one', [capture]);
  plane.seedBarriers('run_manifest_one', { enumeration: { status: 'sealed', observed_at: PLUS(1_000), seals: [{ ...seal('scope_manifest', 'manifest_one'), source_id: 'source_manifest', discoveries_committed: 1, items_discovered: 1 }] } });
  let database = await plane.openDatabase();
  const first = await database.transaction('fixture-manifest-one', transaction => transaction.commitCheckpointAndNormalizationOutbox({ runId: 'run_manifest_one', attempt: 1, enumerationSealIds: ['seal_manifest_one'] }));
  await database.close();
  assert.equal(first.normalization_job_count, 1);

  plane.seedRun({ run_id: 'run_manifest_two', source_id: 'source_manifest', scope_ids: ['scope_manifest'], state: 'enumerating', scheduled_slot: PLUS(2_000) });
  plane.seedNormalizationCaptures('run_manifest_two', [capture]);
  plane.seedBarriers('run_manifest_two', { enumeration: { status: 'sealed', observed_at: PLUS(3_000), seals: [{ ...seal('scope_manifest', 'manifest_two'), source_id: 'source_manifest', discoveries_committed: 1, items_discovered: 1, sealed_at: PLUS(3_000) }] } });
  database = await plane.openDatabase();
  const second = await database.transaction('fixture-manifest-two', transaction => transaction.commitCheckpointAndNormalizationOutbox({ runId: 'run_manifest_two', attempt: 1, enumerationSealIds: ['seal_manifest_two'] }));
  await database.close();
  assert.equal(second.normalization_job_count, 1);

  const baseRequirement = plane.inspect().normalizationRequirements.get('run_manifest_one:capture_shared');
  const failedBaseJob = plane.inspect().jobs.get(baseRequirement.job_id);
  plane.seedJob({ ...failedBaseJob, state: 'quarantined' });
  plane.seedRun({ run_id: 'run_manifest_replay', source_id: 'source_manifest', scope_ids: ['scope_manifest'], state: 'enumerating', scheduled_slot: PLUS(3_500) });
  plane.seedNormalizationCaptures('run_manifest_replay', [capture]);
  plane.seedBarriers('run_manifest_replay', { enumeration: { status: 'sealed', observed_at: PLUS(3_750), seals: [{ ...seal('scope_manifest', 'manifest_replay'), source_id: 'source_manifest', discoveries_committed: 1, items_discovered: 1, sealed_at: PLUS(3_750) }] } });
  database = await plane.openDatabase();
  const replayed = await database.transaction('fixture-manifest-replay', transaction => transaction.commitCheckpointAndNormalizationOutbox({ runId: 'run_manifest_replay', attempt: 1, enumerationSealIds: ['seal_manifest_replay'] }));
  await database.close();
  assert.equal(replayed.normalization_job_count, 1);
  const replayRequirement = plane.inspect().normalizationRequirements.get('run_manifest_replay:capture_shared');
  assert.equal(replayRequirement.satisfaction, 'replay_created');
  assert.notEqual(replayRequirement.job_id, baseRequirement.job_id);
  assert.equal(plane.inspect().jobs.get(replayRequirement.job_id).replay_of_job_id, baseRequirement.job_id);

  plane.seedRun({ run_id: 'run_manifest_zero', source_id: 'source_manifest', scope_ids: ['scope_manifest'], state: 'enumerating', scheduled_slot: PLUS(4_000) });
  plane.seedNormalizationCaptures('run_manifest_zero', []);
  plane.seedBarriers('run_manifest_zero', { enumeration: { status: 'sealed', observed_at: PLUS(5_000), seals: [{ ...seal('scope_manifest', 'manifest_zero'), source_id: 'source_manifest', discoveries_committed: 0, items_discovered: 0, sealed_at: PLUS(5_000) }] } });
  database = await plane.openDatabase();
  const zero = await database.transaction('fixture-manifest-zero', transaction => transaction.commitCheckpointAndNormalizationOutbox({ runId: 'run_manifest_zero', attempt: 1, enumerationSealIds: ['seal_manifest_zero'] }));
  await database.close();

  const state = plane.inspect();
  assert.equal(zero.normalization_job_count, 0);
  assert.equal([...state.jobs.values()].filter(job => job.job_type === 'normalize_record').length, 2);
  assert.equal([...state.outbox.values()].filter(event => event.event_type === 'normalize_requested').length, 2);
  assert.equal(state.normalizationRequirements.size, 3);
  assert.equal(state.normalizationManifests.get('run_manifest_zero').required_capture_count, 0);
});

test('duplicate ACK requires the exact message idempotency key and lease epoch', async () => {
  const plane = createInMemoryControlPlane();
  const body = queueBody({ eventId: 'event_duplicate_lineage', jobId: 'job_duplicate_lineage', runId: 'run_duplicate_lineage' });
  seedQueueWork(plane, body);
  const consumer = createQueueConsumer({
    openDatabase: plane.openDatabase, stage: 'normalize_record', configuration: { clock: () => SLOT },
    processor: async () => ({ businessEffectDigest: 'e'.repeat(64), effect: { applied: true } })
  });
  const first = createFakeQueueMessage({ id: 'transport_duplicate_lineage_one', body });
  await consumer.processOne(first);
  assert.equal(first.action.type, 'ack');

  for (const mutated of [
    { ...body, idempotency_key: `${body.idempotency_key}:mutated` },
    { ...body, delivery_fence: { ...body.delivery_fence, lease_epoch: 2 } }
  ]) {
    const duplicate = createFakeQueueMessage({ id: `transport_duplicate_lineage_${mutated.delivery_fence.lease_epoch}_${mutated.idempotency_key.length}`, body: mutated });
    await consumer.handleBatch({ queue: 'normalize-record', messages: [duplicate] });
    assert.equal(duplicate.action.type, 'retry');
  }
  assert.equal(plane.inspect().businessEffects.size, 1);
});

test('authoritative outbox routing preserves target class and independently paces two origins', async () => {
  const plane = createInMemoryControlPlane();
  const queue = createFakeQueue('normalize-record');
  for (const [suffix, originId, targetClass] of [['a', 'origin_a', 'pagination_cursor'], ['b', 'origin_b', 'exact_distribution']]) {
    const body = { ...queueBody({ eventId: `event_route_${suffix}`, jobId: `job_route_${suffix}`, runId: `run_route_${suffix}`, originId, targetClass }), source_id: `source_route_${suffix}` };
    seedQueueWork(plane, body);
    plane.seedOutbox({
      event_id: body.event_id, event_type: body.event_type, source_id: body.source_id,
      run_attempt: 1, job_lease_epoch: 1, references: body.references, created_at: SLOT,
      idempotency_key: body.idempotency_key, trace_id: body.trace_id
    });
  }
  await createOutboxDispatcher({ openDatabase: plane.openDatabase, queueForEvent: () => queue }).dispatch({ now: SLOT });
  assert.deepEqual(queue.sent.map(item => [item.body.origin_id, item.body.target_class]).sort(), [
    ['origin_a', 'pagination_cursor'], ['origin_b', 'exact_distribution']
  ]);
  const consumer = createQueueConsumer({
    openDatabase: plane.openDatabase, stage: 'normalize_record', configuration: { clock: () => SLOT },
    processor: async ({ message }) => ({ businessEffectDigest: 'd'.repeat(64), effect: { event_id: message.event_id } })
  });
  for (const [index, sent] of queue.sent.entries()) await consumer.processOne(createFakeQueueMessage({ id: `transport_route_${index}`, body: sent.body }));
  assert.deepEqual([...plane.inspect().originBuckets.keys()].sort(), ['origin_a', 'origin_b']);
});

test('auth and schema failure resumes require remediation evidence and a changed connector version', async () => {
  for (const [failureType, retryClass] of [['catalog_auth_misconfigured', 'pause_source'], ['schema_drift', 'quarantine']]) {
    const plane = createInMemoryControlPlane();
    const body = queueBody({ eventId: `event_${failureType}`, jobId: `job_${failureType}`, runId: `run_${failureType}` });
    seedQueueWork(plane, body);
    const consumer = createQueueConsumer({
      openDatabase: plane.openDatabase, stage: 'normalize_record', configuration: { clock: () => SLOT, originCapacity: 100 },
      processor: async () => { throw typedFailureError({
        failure_type: failureType, retry_class: retryClass, target_class: 'exact_item',
        safe_detail_code: failureType === 'schema_drift' ? 'UPSTREAM_SCHEMA_DRIFT' : 'CATALOG_AUTH_INVALID', observed_at: SLOT
      }); }
    });
    await consumer.processOne(createFakeQueueMessage({ id: `transport_${failureType}`, body }));
    const sourceControl = createSourceControlService({ openDatabase: plane.openDatabase });
    assert.equal(plane.inspect().sources.get(body.source_id).state, 'pause_requested');
    await sourceControl.drain({ sourceId: body.source_id, auditEventId: `audit_drain_${failureType}`, now: PLUS(1_000) });
    await assert.rejects(sourceControl.resume({ sourceId: body.source_id, auditEventId: `audit_resume_missing_${failureType}`, resumedAt: PLUS(2_000), configurationRevision: 2 }), /SOURCE_RESUME_REMEDIATION_REQUIRED/);
    await assert.rejects(sourceControl.resume({ sourceId: body.source_id, auditEventId: `audit_resume_same_${failureType}`, resumedAt: PLUS(2_000), configurationRevision: 2, remediationEvidenceRefId: `evidence_${failureType}`, connectorVersion: 'connector.v1' }), /SOURCE_RESUME_CONNECTOR_VERSION_REQUIRED/);
    const resumed = await sourceControl.resume({ sourceId: body.source_id, auditEventId: `audit_resume_valid_${failureType}`, resumedAt: PLUS(2_000), configurationRevision: 2, remediationEvidenceRefId: `evidence_${failureType}`, connectorVersion: 'connector.v2' });
    assert.equal(resumed.state, 'active');
  }
});

test('DLQ transport configuration, final page signal, physical-name mapping, and PostgreSQL-only recovery are explicit', async () => {
  assert.throws(() => createDeadLetterSink({
    openDatabase: async () => {}, configuration: { clock: () => SLOT, logicalQueueName: 'normalize-record-dlq', transport: { maxRetries: 0, maxBatchSize: 1, deadLetterQueue: null } }
  }), /DLQ_SINK_MAX_RETRIES_MISMATCH/);

  const events = [];
  const unavailable = createDeadLetterSink({
    openDatabase: async () => { const error = new Error('DATABASE_UNAVAILABLE'); error.code = 'DATABASE_UNAVAILABLE'; throw error; },
    logger: createStructuredLogger(event => events.push(event)),
    configuration: {
      clock: () => SLOT, logicalQueueName: 'normalize-record-dlq',
      physicalQueueName: 'ushso-staging-normalize-record-dlq', transport: TRANSPORT
    }
  });
  const body = queueBody({ eventId: 'event_lost_dlq', jobId: 'job_lost_dlq', runId: 'run_lost_dlq' });
  const first = createFakeQueueMessage({ id: 'transport_lost_dlq_1', body, attempts: 1 });
  const [firstResult] = await unavailable.handleBatch({ queue: 'ushso-staging-normalize-record-dlq', messages: [first] });
  assert.equal(firstResult.delaySeconds, 30);
  const final = createFakeQueueMessage({ id: 'transport_lost_dlq_6', body, attempts: 6 });
  const [finalResult] = await unavailable.handleBatch({ queue: 'ushso-staging-normalize-record-dlq', messages: [final] });
  assert.equal(finalResult.finalConfiguredDelivery, true);
  assert.equal(finalResult.delaySeconds, 300);
  assert.equal(finalResult.recoverySource, 'postgresql_run_job_outbox_failure_evidence');
  assert.ok(events.some(event => event.event === 'dlq.persistence_transport_exhausted' && event.outcome === 'page_postgresql_reconstruction_required'));

  // Cloudflare has deleted the final Queue delivery. The page event is exported
  // as an immutable operational receipt and then admitted, with an audit ID,
  // against the authoritative PostgreSQL run/job/outbox lineage. Ordinary
  // Queue-retention expiry alone is deliberately insufficient evidence.
  const plane = createInMemoryControlPlane();
  seedQueueWork(plane, body);
  plane.seedOutbox({
    event_id: body.event_id, event_type: body.event_type, source_id: body.source_id,
    run_attempt: 1, job_lease_epoch: 1, references: body.references,
    idempotency_key: body.idempotency_key, created_at: SLOT
  });
  const queue = createFakeQueue('normalize-record');
  await createOutboxDispatcher({ openDatabase: plane.openDatabase, queueForEvent: () => queue }).dispatch({ now: SLOT });
  // The lost final DLQ delivery is not authority to manufacture attempt
  // history. Seed one real failed delivery in the PostgreSQL-shaped ledger;
  // recovery must fence and reuse this exact attempt ID.
  const failedDelivery = createQueueConsumer({
    openDatabase: plane.openDatabase, stage: 'normalize_record',
    configuration: { clock: () => SLOT },
    processor: async () => { throw typedFailureError({
      failure_type: 'timeout', retry_class: 'transient', target_class: 'exact_item',
      safe_detail_code: 'UPSTREAM_TIMEOUT', observed_at: SLOT
    }, { retryAfterSeconds: 0 }); }
  });
  const failedMessage = createFakeQueueMessage({ id: 'transport_lost_dlq_database_attempt_1', body, attempts: 1 });
  await failedDelivery.handleBatch({ queue: 'normalize-record', messages: [failedMessage] });
  assert.equal(plane.inspect().attempts.length, 1);
  const recovery = createDeadLetterRecoveryReconciler({ openDatabase: plane.openDatabase, configuration: { clock: () => PLUS(2_000) } });
  const [reconstructed] = await recovery.reconcile({ transportExhaustionObservations: [{
    originalEventId: body.event_id, queueName: 'normalize-record-dlq', sourceId: body.source_id,
    runId: body.references.run_id, jobId: body.references.job_id, transportDeliveryAttempts: 6,
    observedAt: PLUS(1_000), evidenceRefId: 'evidence_cf_log_export_dlq_final_001',
    auditEventId: 'audit_admit_dlq_final_001'
  }] });
  assert.equal(reconstructed.created, true);
  const recoveredState = plane.inspect();
  const durable = recoveredState.deadLetters.get(reconstructed.deadLetterId);
  assert.equal(durable.sink_transaction_committed, true);
  assert.equal(durable.transport_delivery_attempts, 6);
  assert.equal(recoveredState.jobs.get(body.references.job_id).state, 'quarantined');
  assert.ok(recoveredState.audits.some(audit => audit.audit_event_id === 'audit_admit_dlq_final_001'));
  assert.deepEqual(await validateIngestionRecord('event-ledger.schema.json', durable), { valid: true, issues: [] });
});

test('dead-letter recovery is exact, typed observations stay DLQ-free, IDs do not collide, and persisted_at is immutable', async () => {
  const plane = createInMemoryControlPlane();
  const terminalBody = queueBody({ eventId: 'event_reconstruct', jobId: 'job_reconstruct', runId: 'run_reconstruct' });
  seedQueueWork(plane, terminalBody);
  const deadLetterId = await deterministicOpaqueId('deadletter', { queueName: 'normalize-record-dlq', originalEventId: terminalBody.event_id });
  const database = await plane.openDatabase();
  await database.transaction('fixture-missing-dlq-row', transaction => transaction.recordTerminalOutcome({
    eventId: terminalBody.event_id, jobId: terminalBody.references.job_id, runId: terminalBody.references.run_id,
    attempt: 1, disposition: 'quarantine', retryPolicyVersion: 'retry.v1', startedAt: SLOT, finishedAt: SLOT,
    durableDeadLetterId: deadLetterId, failure: {
      failure_type: 'parse_failure', retry_class: 'quarantine', target_class: 'exact_item',
      safe_detail_code: 'UPSTREAM_PARSE_FAILED', observed_at: SLOT
    }
  }));
  await database.close();
  const reconciler = createDeadLetterRecoveryReconciler({ openDatabase: plane.openDatabase, configuration: { clock: () => PLUS(2_000) } });
  assert.equal((await reconciler.reconcile())[0].created, true);
  assert.deepEqual(await reconciler.reconcile(), []);
  assert.equal(plane.inspect().deadLetters.get(deadLetterId).persisted_at, PLUS(2_000));

  const observationBody = queueBody({ eventId: 'event_typed_observation', jobId: 'job_typed_observation', runId: 'run_typed_observation', targetClass: 'exact_distribution', eventType: 'access_check_requested' });
  seedQueueWork(plane, observationBody, { jobType: 'access_check', maximumDeliveryAttempts: 4 });
  const observationConsumer = createQueueConsumer({
    openDatabase: plane.openDatabase, stage: 'access_check', configuration: { clock: () => SLOT },
    processor: async () => { throw typedFailureError({ failure_type: 'expected_access_restriction', retry_class: 'terminal_observation', target_class: 'exact_distribution', safe_detail_code: 'EXPECTED_ACCESS_RESTRICTION', observed_at: SLOT }); }
  });
  await observationConsumer.processOne(createFakeQueueMessage({ id: 'transport_typed_observation', body: observationBody }));
  assert.deepEqual(await reconciler.reconcile(), []);

  for (const [index, eventId] of ['event_a-b', 'event_a:b'].entries()) {
    const body = queueBody({ eventId, jobId: `job_${eventId}`, runId: `run_${eventId}`, originId: `origin_collision_${index}` });
    seedQueueWork(plane, body);
    const consumer = createQueueConsumer({
      openDatabase: plane.openDatabase, stage: 'normalize_record', configuration: { clock: () => SLOT, originCapacity: 100 },
      processor: async () => { throw typedFailureError({ failure_type: 'parse_failure', retry_class: 'quarantine', target_class: 'exact_item', safe_detail_code: 'UPSTREAM_PARSE_FAILED', observed_at: SLOT }); }
    });
    await consumer.processOne(createFakeQueueMessage({ id: `transport_${eventId}`, body }));
  }
  const collisionRows = [...plane.inspect().deadLetters.values()].filter(dead => ['event_a-b', 'event_a:b'].includes(dead.original_event_id));
  assert.equal(collisionRows.length, 2);
  assert.notEqual(collisionRows[0].dead_letter_id, collisionRows[1].dead_letter_id);
});

test('Workflow operational clock crossing retention never creates past the boundary, and terminal mappings close', async () => {
  const retentionMs = 120_000;
  {
    const { plane } = await createScheduledPlane({ workflowRetentionMs: retentionMs });
    const platform = createFakeWorkflowPlatform();
    const before = PLUS(retentionMs - 1);
    const boundary = PLUS(retentionMs);
    const reconciler = createWorkflowStartReconciler({
      openDatabase: plane.openDatabase, workflowPlatform: platform,
      configuration: { clock: sequenceClock([before, before, boundary, boundary, boundary]) }
    });
    await reconciler.reconcile({ now: before });
    assert.equal(platform.instances.size, 0);
    assert.equal([...plane.inspect().runs.values()][0].state, 'failed');
  }
  {
    const { plane, runId, run } = await createScheduledPlane();
    const platform = createFakeWorkflowPlatform();
    await createWorkflowStartReconciler({ openDatabase: plane.openDatabase, workflowPlatform: platform, configuration: { clock: () => SLOT } }).reconcile({ now: SLOT });
    plane.seedBarriers(runId, completeBarriers());
    await createHarvestWorkflow({ openDatabase: plane.openDatabase, configuration: { clock: () => SLOT } }).run({ instanceId: `harvest-${runId}-1`, params: { runId, attempt: 1, deadlineAt: run.deadline_at } }, createFakeWorkflowStep());
    const mapping = plane.inspect().workflowMappings.get(`${runId}:1`);
    assert.equal(mapping.is_active, false);
    assert.equal(mapping.platform_state, 'complete');
    assert.equal(mapping.terminal_at, '2026-08-30T00:15:00.000Z');
  }
});

test('Cloudflare retention strings are parsed and cannot mask a shorter platform horizon', async () => {
  const platform = createCloudflareWorkflowPlatform({
    binding: { async create(input) { return { id: input.id, async status() { return 'running'; } }; }, async get(id) { return { id, async status() { return 'running'; } }; } },
    successRetention: '1 day', errorRetention: '1 day'
  });
  await assert.rejects(platform.create({ id: 'workflow_too_long', params: {}, requestedAt: SLOT, retentionExpiresAt: PLUS(10 * 24 * 60 * 60 * 1000) }), /WORKFLOW_DATABASE_RETENTION_EXCEEDS_PLATFORM/);
});
