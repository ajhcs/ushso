import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDeadLetterSink, createFakeQueue, createFakeQueueMessage, createInMemoryControlPlane,
  createDlqTransportExhaustionObservationIngress, createOriginController, createOutboxDispatcher, createQueueConsumer, createReplayService,
  FaultInjector, typedFailureError
} from '../src/index.mjs';
import { queueBody, seedQueueWork, SLOT } from './helpers.mjs';
import { validateIngestionRecord } from '../../../contracts/ingestion/v1.0.0/tools/index.mjs';

function seedProjectionOutbox(plane, eventId = 'event_projection_fixture') {
  plane.seedSource({
    source_id: 'source_cms_catalog', endpoint_id: 'endpoint_cms_catalog', scope_ids: ['scope_cms_public'],
    origin_id: 'origin_data_cms_gov', configuration_revision: 1, next_due_at: SLOT, state: 'active'
  });
  plane.seedRun({ run_id: 'run_fixture_001', source_id: 'source_cms_catalog', state: 'projecting' });
  plane.seedJob({
    job_id: 'job_fixture_001', run_id: 'run_fixture_001', source_id: 'source_cms_catalog',
    job_type: 'project_index', state: 'pending', target_class: 'exact_item', origin_id: 'origin_data_cms_gov',
    delivery_fence: { run_attempt: 1, lease_epoch: 1 },
    message_references: { run_id: 'run_fixture_001', job_id: 'job_fixture_001', canonical_id: 'asset_fixture_001', canonical_revision_id: 'revision_fixture_001' }
  });
  plane.seedOutbox({
    event_id: eventId, event_type: 'projection_requested', state: 'pending', trace_id: 'trace_projection_fixture',
    idempotency_key: `event:projection_requested:${eventId}`, source_id: 'source_cms_catalog', run_attempt: 1, job_lease_epoch: 1,
    references: { run_id: 'run_fixture_001', job_id: 'job_fixture_001', canonical_id: 'asset_fixture_001', canonical_revision_id: 'revision_fixture_001' },
    created_at: SLOT
  });
}

test('outbox commit/send/mark crash matrix never loses work and permits only safe duplicate transport', async () => {
  {
    const faults = new FaultInjector(); const plane = createInMemoryControlPlane({ faults }); const queue = createFakeQueue('project-index');
    seedProjectionOutbox(plane); faults.arm('transaction.outbox-lease.before_commit');
    const dispatcher = createOutboxDispatcher({ openDatabase: plane.openDatabase, queueForEvent: () => queue, faults });
    await assert.rejects(dispatcher.dispatch({ now: SLOT }), /INJECTED_FAULT/);
    assert.equal(queue.sent.length, 0); assert.equal(plane.inspect().outbox.get('event_projection_fixture').state, 'pending');
  }
  {
    const plane = createInMemoryControlPlane(); const queue = createFakeQueue('project-index', { faultOnSend: 1 });
    seedProjectionOutbox(plane); const dispatcher = createOutboxDispatcher({ openDatabase: plane.openDatabase, queueForEvent: () => queue });
    await dispatcher.dispatch({ now: SLOT });
    assert.equal(plane.inspect().outbox.get('event_projection_fixture').state, 'retry_wait');
    await dispatcher.dispatch({ now: '2026-08-30T00:00:31.000Z' });
    assert.equal(queue.sent.length, 1); assert.equal(plane.inspect().outbox.get('event_projection_fixture').state, 'published');
  }
  {
    const faults = new FaultInjector(); const plane = createInMemoryControlPlane({ faults }); const queue = createFakeQueue('project-index');
    seedProjectionOutbox(plane); faults.arm('outbox.after_send_before_mark');
    const dispatcher = createOutboxDispatcher({ openDatabase: plane.openDatabase, queueForEvent: () => queue, faults });
    await dispatcher.dispatch({ now: SLOT });
    assert.equal(queue.sent.length, 1); assert.equal(plane.inspect().outbox.get('event_projection_fixture').state, 'leased');
    await dispatcher.dispatch({ now: '2026-08-30T00:01:01.000Z' });
    assert.equal(queue.sent.length, 1);
    const uncertain = plane.inspect().outbox.get('event_projection_fixture');
    assert.equal(uncertain.state, 'published');
    assert.equal(uncertain.safe_detail_code, 'OUTBOX_SEND_OUTCOME_UNKNOWN_AWAITING_QUEUE_RETENTION');
    assert.ok(plane.inspect().audits.some(event => event.action === 'outbox_send_outcome_unknown'));
  }
  {
    const faults = new FaultInjector(); const plane = createInMemoryControlPlane({ faults }); const queue = createFakeQueue('project-index');
    seedProjectionOutbox(plane); faults.arm('transaction.outbox-mark-published.before_commit');
    const dispatcher = createOutboxDispatcher({ openDatabase: plane.openDatabase, queueForEvent: () => queue, faults });
    await dispatcher.dispatch({ now: SLOT });
    assert.equal(queue.sent.length, 1); assert.equal(plane.inspect().outbox.get('event_projection_fixture').state, 'leased');
  }
});

test('processed-event guard makes duplicate deliveries and crash-after-commit one logical effect', async () => {
  const faults = new FaultInjector(); const plane = createInMemoryControlPlane({ faults }); let calls = 0;
  const body = queueBody(); seedQueueWork(plane, body);
  const consumer = createQueueConsumer({
    openDatabase: plane.openDatabase, stage: 'normalize_record', faults,
    configuration: { clock: () => SLOT },
    processor: async ({ message }) => ({ businessEffectDigest: 'a'.repeat(64), effect: { event_id: message.event_id, applied: ++calls } })
  });
  faults.arm('consumer.after_commit_before_ack');
  const first = createFakeQueueMessage({ id: 'transport_1', body, attempts: 1 });
  await consumer.handleBatch({ queue: 'normalize-record', messages: [first] });
  assert.equal(first.action.type, 'retry');
  const redelivery = createFakeQueueMessage({ id: 'transport_1_retry', body, attempts: 2 });
  await consumer.handleBatch({ queue: 'normalize-record', messages: [redelivery] });
  const duplicate = createFakeQueueMessage({ id: 'transport_1_duplicate', body, attempts: 2 });
  await consumer.handleBatch({ queue: 'normalize-record', messages: [duplicate] });
  assert.equal(redelivery.action.type, 'ack'); assert.equal(duplicate.action.type, 'ack'); assert.equal(calls, 1);
  assert.equal(plane.inspect().processedEvents.size, 1); assert.equal(plane.inspect().businessEffects.size, 1);
});

test('transient retry, open-circuit reledger, exhaustion, and terminal absence use distinct explicit actions', async () => {
  {
    const plane = createInMemoryControlPlane();
    const body = queueBody({ eventId: 'event_transient' }); seedQueueWork(plane, body);
    const consumer = createQueueConsumer({
      openDatabase: plane.openDatabase, stage: 'normalize_record',
      configuration: { clock: () => SLOT },
      processor: async () => { throw typedFailureError({ failure_type: 'timeout', retry_class: 'transient', target_class: 'exact_item', safe_detail_code: 'UPSTREAM_TIMEOUT', observed_at: SLOT }); }
    });
    const message = createFakeQueueMessage({ id: 'transient', body, attempts: 1 });
    await consumer.handleBatch({ queue: 'normalize-record', messages: [message] });
    assert.deepEqual(message.action, { type: 'retry', delaySeconds: 2 });
    assert.equal(plane.inspect().attempts.length, 1);
  }
  {
    const plane = createInMemoryControlPlane();
    const origin = createOriginController({ openDatabase: plane.openDatabase, configuration: { circuitThreshold: 1 } });
    await origin.failure({ originId: 'origin_data_cms_gov', now: SLOT, failure: { failure_type: 'timeout', target_class: 'exact_item', safe_detail_code: 'UPSTREAM_TIMEOUT', observed_at: SLOT } });
    const body = queueBody({ eventId: 'event_circuit' }); seedQueueWork(plane, body);
    const consumer = createQueueConsumer({
      openDatabase: plane.openDatabase, stage: 'normalize_record',
      configuration: { clock: () => SLOT },
      processor: async () => { throw typedFailureError({ failure_type: 'timeout', retry_class: 'transient', target_class: 'exact_item', safe_detail_code: 'UPSTREAM_TIMEOUT', observed_at: SLOT }); }
    });
    const message = createFakeQueueMessage({ id: 'circuit', body, attempts: 2 });
    const [result] = await consumer.handleBatch({ queue: 'normalize-record', messages: [message] });
    assert.equal(result.action, 'ack_reledgered'); assert.equal(message.action.type, 'ack');
    assert.ok([...plane.inspect().outbox.values()].some(event => event.event_type === 'normalize_requested' && event.next_eligible_at));
  }
  {
    const plane = createInMemoryControlPlane();
    const body = queueBody({ eventId: 'event_exhausted' }); seedQueueWork(plane, body);
    let attemptNow = SLOT;
    const consumer = createQueueConsumer({
      openDatabase: plane.openDatabase, stage: 'normalize_record',
      configuration: { clock: () => attemptNow },
      processor: async () => { throw typedFailureError({ failure_type: 'timeout', retry_class: 'transient', target_class: 'exact_item', safe_detail_code: 'UPSTREAM_TIMEOUT', observed_at: attemptNow }, { retryAfterSeconds: 0 }); }
    });
    let result;
    let message;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      attemptNow = new Date(Date.parse(SLOT) + attempt * 3_600_000).toISOString();
      message = createFakeQueueMessage({ id: `exhausted-${attempt}`, body, attempts: attempt });
      [result] = await consumer.handleBatch({ queue: 'normalize-record', messages: [message] });
    }
    assert.equal(result.action, 'ack_durable_dlq'); assert.equal(message.action.type, 'ack'); assert.equal(plane.inspect().deadLetters.size, 1);
    assert.equal(plane.inspect().deadLetters.values().next().value.attempt_ids.length, 5);
  }
  {
    const plane = createInMemoryControlPlane();
    const body = queueBody({ eventId: 'event_cursor404', targetClass: 'pagination_cursor', eventType: 'harvest_page_requested' }); seedQueueWork(plane, body, { jobType: 'harvest_page', maximumDeliveryAttempts: 6 });
    const consumer = createQueueConsumer({
      openDatabase: plane.openDatabase, stage: 'harvest_page',
      configuration: { clock: () => SLOT },
      processor: async () => { throw typedFailureError({ failure_type: 'not_found', retry_class: 'enumeration_terminal', target_class: 'pagination_cursor', safe_detail_code: 'CURSOR_NOT_FOUND', observed_at: SLOT }); }
    });
    const message = createFakeQueueMessage({ id: 'cursor404', body, attempts: 1 });
    const [result] = await consumer.handleBatch({ queue: 'harvest-page', messages: [message] });
    assert.equal(result.disposition, 'fail_enumeration'); assert.equal(message.action.type, 'ack'); assert.equal(plane.inspect().deadLetters.size, 1);
  }
});

test('DLQ sink acknowledges only after durable commit and replay preserves immutable lineage', async () => {
  const faults = new FaultInjector(); const plane = createInMemoryControlPlane({ faults });
  const body = queueBody({ eventId: 'event_dlq_fixture', targetClass: 'collection' });
  seedQueueWork(plane, body);
  const terminalConsumer = createQueueConsumer({
    openDatabase: plane.openDatabase, stage: 'normalize_record', configuration: { clock: () => SLOT },
    processor: async () => { throw typedFailureError({ failure_type: 'parse_failure', retry_class: 'quarantine', target_class: 'collection', safe_detail_code: 'CATALOG_PARSE_FAILED', observed_at: SLOT }); }
  });
  const originalDelivery = createFakeQueueMessage({ id: 'transport_original_dlq_fixture', body, attempts: 1 });
  await terminalConsumer.handleBatch({ queue: 'normalize-record', messages: [originalDelivery] });
  assert.equal(originalDelivery.action.type, 'ack');
  const deadLetterId = [...plane.inspect().deadLetters.keys()][0];
  // Workflow terminalization would happen after its required normalization
  // barrier sees this durable DLQ; seed that accounted terminal state here.
  plane.seedRun({ run_id: body.references.run_id, source_id: body.source_id, active_attempt: 1, state: 'partial_unpublished', terminal_at: '2026-08-30T00:01:00.000Z' });

  const sink = createDeadLetterSink({
    openDatabase: plane.openDatabase, faults,
    configuration: {
      clock: () => '2026-08-30T00:02:00.000Z', logicalQueueName: 'normalize-record-dlq',
      transport: { maxRetries: 5, maxBatchSize: 1, deadLetterQueue: null }
    }
  });
  faults.arm('dlq.after_commit_before_ack');
  const first = createFakeQueueMessage({ id: 'transport_dlq_fixture', body, attempts: 5 });
  await sink.handleBatch({ queue: 'normalize-record-dlq', messages: [first] });
  assert.equal(first.action.type, 'retry'); assert.equal(plane.inspect().deadLetters.size, 1);
  const second = createFakeQueueMessage({ id: 'transport_dlq_fixture', body, attempts: 6 });
  await sink.handleBatch({ queue: 'normalize-record-dlq', messages: [second] });
  assert.equal(second.action.type, 'ack'); assert.equal(plane.inspect().deadLetters.size, 1);

  const replay = createReplayService({ openDatabase: plane.openDatabase });
  const firstReplay = await replay.replay({ deadLetterId, auditEventId: 'audit_replay_fixture', requestedAt: '2026-08-30T01:00:00.000Z' });
  const duplicateReplay = await replay.replay({ deadLetterId, auditEventId: 'audit_replay_fixture', requestedAt: '2026-08-30T01:00:00.000Z' });
  assert.equal(firstReplay.created, true); assert.equal(duplicateReplay.created, false);
  const lineage = plane.inspect().replays.get(firstReplay.replayId);
  assert.notEqual(lineage.new_run_id, lineage.original_run_id); assert.notEqual(lineage.new_event_id, lineage.original_event_id);
  assert.equal(lineage.original_retry_policy_version, 'retry.v1');
  assert.equal(plane.inspect().deadLetters.get(deadLetterId).sink_transaction_committed, true);
  assert.equal(plane.inspect().deadLetters.get(deadLetterId).attempt_ids.length, 1);
  assert.ok(plane.inspect().audits.some(audit => audit.action === 'dead_letter_replay_requested'));
  assert.deepEqual(await validateIngestionRecord('event-ledger.schema.json', plane.inspect().deadLetters.get(deadLetterId)), { valid: true, issues: [] });
  assert.deepEqual(await validateIngestionRecord('event-ledger.schema.json', lineage), { valid: true, issues: [] });
});

test('audited DLQ transport-exhaustion ingress is zero-payload, commit-before-ACK, and terminally observable', async () => {
  const plane = createInMemoryControlPlane();
  const body = queueBody({ eventId: 'event_dlq_observation_001' });
  seedQueueWork(plane, body);
  plane.seedOutbox({
    event_id: body.event_id, event_type: body.event_type, state: 'published',
    published_at: SLOT, trace_id: body.trace_id, idempotency_key: body.idempotency_key,
    source_id: body.source_id, run_attempt: 1, job_lease_epoch: 1,
    references: body.references, created_at: SLOT
  });
  const events = [];
  const ingress = createDlqTransportExhaustionObservationIngress({
    openDatabase: plane.openDatabase,
    logger: { emit(event) { events.push(event); } },
    configuration: { clock: () => '2026-08-30T00:01:00.000Z' }
  });
  const observation = {
    contract_version: 'ingestion.control.v1.0.0',
    record_kind: 'dlq_transport_exhaustion_observation',
    original_event_id: body.event_id,
    queue_name: 'normalize-record-dlq',
    source_id: body.source_id,
    run_id: body.references.run_id,
    job_id: body.references.job_id,
    transport_delivery_attempts: 6,
    observed_at: SLOT,
    evidence_reference_id: 'evidence_dlq_final_page_001',
    audit_event_id: 'audit_dlq_final_page_001'
  };
  const first = createFakeQueueMessage({ id: 'dlq-observation-1', body: observation });
  const [committed] = await ingress.handleBatch({ queue: 'dlq-transport-exhaustion-observations', messages: [first] });
  assert.equal(first.action.type, 'ack');
  assert.equal(committed.duplicate, false);
  assert.equal(plane.inspect().deadLetterTransportExhaustions.size, 1);

  const duplicate = createFakeQueueMessage({ id: 'dlq-observation-2', body: observation, attempts: 2 });
  const [duplicateResult] = await ingress.handleBatch({ queue: 'dlq-transport-exhaustion-observations', messages: [duplicate] });
  assert.equal(duplicate.action.type, 'ack');
  assert.equal(duplicateResult.duplicate, true);

  const invalid = createFakeQueueMessage({
    id: 'dlq-observation-final-invalid', attempts: 6,
    body: { ...observation, raw_healthcare_row: { patient: 'forbidden' } }
  });
  const [terminal] = await ingress.handleBatch({ queue: 'dlq-transport-exhaustion-observations', messages: [invalid] });
  assert.equal(invalid.action.type, 'retry');
  assert.equal(terminal.finalConfiguredDelivery, true);
  assert.equal(terminal.recoverySource, 'independently_retained_audit_evidence_resubmission');
  assert.ok(events.some(event => event.event === 'dlq.exhaustion_observation_transport_exhausted'
    && event.outcome === 'page_audit_evidence_resubmission_required'));
});
