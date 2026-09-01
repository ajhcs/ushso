import { deterministicOpaqueId, iso, invariant, parseTimestamp } from './common.mjs';
import { classifyFailure, fullJitterDelaySeconds, retryBudget, STAGE_POLICIES } from './failure-policy.mjs';
import { assertControlStore, withFreshDatabaseClient } from './ports.mjs';
import { createNullLogger } from './redaction.mjs';
import { assertQueueControlEnvelope } from './message-contract.mjs';

const EVENT_BY_STAGE = Object.freeze({
  harvest_page: 'harvest_page_requested', normalize_record: 'normalize_requested',
  enrich_schema: 'schema_enrichment_requested', access_check: 'access_check_requested',
  project_index: 'projection_requested'
});
const QUEUE_BY_STAGE = Object.freeze({
  harvest_page: 'harvest-page', normalize_record: 'normalize-record', enrich_schema: 'enrich-schema',
  access_check: 'access-check', project_index: 'project-index'
});

function contractFailure(failure) {
  const clean = {
    failure_type: failure.failure_type, retry_class: failure.retry_class,
    target_class: failure.target_class, safe_detail_code: failure.safe_detail_code,
    observed_at: failure.observed_at
  };
  if (failure.http_status !== undefined) clean.http_status = failure.http_status;
  return Object.freeze(clean);
}

function normalizeRetryAfterSeconds(value) {
  if (value === null || value === undefined) return null;
  invariant(Number.isFinite(value) && value >= 0, 'RETRY_AFTER_SECONDS_INVALID');
  return Math.min(86_400, Math.floor(value));
}

export function typedFailureError(failure, { retryAfterSeconds = failure?.retry_after_seconds ?? null } = {}) {
  invariant(typeof failure?.retry_class === 'string', 'FAILURE_RETRY_CLASS_MISSING');
  classifyFailure(failure, { targetClass: failure?.target_class });
  const error = new Error(failure.safe_detail_code ?? failure.failure_type);
  error.code = failure.safe_detail_code ?? failure.failure_type;
  error.failure = contractFailure(failure);
  error.retryAfterSeconds = normalizeRetryAfterSeconds(retryAfterSeconds);
  return error;
}

function messageAttempt(message) {
  const attempt = message.attempts ?? message.body?.attempt ?? 1;
  invariant(Number.isInteger(attempt) && attempt >= 1, 'QUEUE_ATTEMPT_INVALID');
  return attempt;
}

export function createQueueConsumer({ openDatabase, stage, processor, originForMessage = message => message.body?.origin_id ?? 'origin_unknown', faults = { hit() {} }, logger = createNullLogger(), configuration = {} }) {
  invariant(typeof openDatabase === 'function', 'OPEN_DATABASE_PORT_MISSING');
  invariant(typeof processor === 'function', 'QUEUE_PROCESSOR_MISSING');
  invariant(typeof configuration.clock === 'function', 'OPERATIONAL_CLOCK_MISSING');
  const policyVersion = configuration.retryPolicyVersion ?? 'retry.v1';
  invariant(EVENT_BY_STAGE[stage], 'STAGE_POLICY_UNKNOWN', stage);
  const consumerName = configuration.consumerName ?? `${stage}_consumer`;
  const processingLeaseMs = configuration.processingLeaseMs ?? 5 * 60 * 1000;

  async function processOne(message) {
    const body = message.body;
    assertQueueControlEnvelope(body);
    invariant(body.event_type === EVENT_BY_STAGE[stage], 'QUEUE_EVENT_STAGE_MISMATCH', body.event_type);
    const transportAttempt = messageAttempt(message);
    const eventId = body.event_id;
    const originId = originForMessage(message);
    const sourceId = body.source_id;
    const runId = body.references?.run_id;
    const jobId = body.references?.job_id;
    const runAttempt = body.delivery_fence?.run_attempt;
    const leaseEpoch = body.delivery_fence?.lease_epoch;
    invariant(typeof eventId === 'string' && typeof sourceId === 'string' && typeof runId === 'string' && typeof jobId === 'string', 'QUEUE_ENVELOPE_REFERENCES_INVALID');
    invariant(Number.isInteger(runAttempt) && runAttempt >= 1 && Number.isInteger(leaseEpoch) && leaseEpoch >= 1, 'QUEUE_DELIVERY_FENCE_INVALID');
    const deliveryNowMs = parseTimestamp(configuration.clock());
    const deliveryNow = iso(deliveryNowMs);
    const prepared = await withFreshDatabaseClient(openDatabase, async database => {
      assertControlStore(database);
      return database.transaction('queue-delivery-prepare', transaction => transaction.prepareEventDelivery({
        consumerName, eventId, eventType: body.event_type, messageIdempotencyKey: body.idempotency_key,
        stage, sourceId, runId, jobId, runAttempt, leaseEpoch, transportAttempt,
        now: deliveryNow, leaseExpiresAt: iso(deliveryNowMs + processingLeaseMs), originId,
        originCapacity: configuration.originCapacity ?? 2, originRefillPerSecond: configuration.originRefillPerSecond ?? 1,
        targetClass: body.target_class ?? 'exact_item', retryPolicyVersion: policyVersion,
        deadLetterQueueName: configuration.deadLetterQueueName ?? `${stage.replaceAll('_', '-')}-dlq`
      }));
    });
    if (prepared.decision === 'duplicate' || prepared.decision === 'suppressed') {
      message.ack();
      return Object.freeze({ eventId, action: 'ack', duplicate: prepared.decision === 'duplicate', suppressedReason: prepared.reason ?? null });
    }
    if (prepared.decision === 'defer') {
      const delaySeconds = Math.max(1, Math.ceil((parseTimestamp(prepared.retry_at) - deliveryNowMs) / 1000));
      message.retry({ delaySeconds });
      return Object.freeze({ eventId, action: 'retry', reason: prepared.reason, delaySeconds });
    }
    if (prepared.decision === 'ack_reledgered') {
      message.ack();
      return Object.freeze({
        eventId, action: 'ack_reledgered', reason: prepared.reason,
        delaySeconds: Math.max(0, Math.ceil((parseTimestamp(prepared.retry_at) - deliveryNowMs) / 1000))
      });
    }
    if (prepared.decision === 'ack_exhausted') {
      message.ack();
      return Object.freeze({ eventId, action: 'ack_exhausted', reason: prepared.reason, exhausted: true });
    }
    invariant(prepared.decision === 'process' && typeof prepared.lease_token === 'string', 'QUEUE_DELIVERY_PREPARE_INVALID');
    const attempt = prepared.logical_attempt;
    let lastObservedNowMs = deliveryNowMs;
    try {
      // External I/O or pure transformation happens outside the database
      // transaction. The returned database effect is committed with the unique
      // processed-event guard and downstream outbox in one fenced transaction.
      const processorResult = await processor({ message: body, deliveryAttempt: attempt, lease: Object.freeze({ token: prepared.lease_token, epoch: prepared.lease_epoch }) });
      // The processing lease is a commit fence, not merely an admission
      // check. External work may outlive the lease; sample the operational
      // clock again immediately before the effect transaction and reject an
      // exact-boundary or stale commit.
      const commitNowMs = parseTimestamp(configuration.clock());
      const commitNow = iso(commitNowMs);
      lastObservedNowMs = commitNowMs;
      const outcome = await withFreshDatabaseClient(openDatabase, async database => {
        assertControlStore(database);
        return database.transaction('queue-consumer-effect', async transaction => {
          const committed = await transaction.processEventOnce({
            consumerName, eventId, effectIdempotencyKey: `effect:${consumerName}:${eventId}`,
            sourceId, runId, jobId, eventType: body.event_type, messageIdempotencyKey: body.idempotency_key,
            runAttempt, leaseEpoch, originId, targetClass: body.target_class,
            leaseToken: prepared.lease_token, logicalAttempt: attempt,
            retryPolicyVersion: policyVersion, startedAt: deliveryNow, committedAt: commitNow,
            apply: () => processorResult
          });
          const circuit = await transaction.recordCircuitSuccess({ originId, observedAt: commitNow });
          if (circuit.previous_state !== 'closed') {
            await transaction.appendAudit({
              auditEventId: `audit_circuit_probe_${eventId}_${attempt}`, action: 'origin_circuit_closed', originId,
              reasonCode: 'HALF_OPEN_PROBE_SUCCEEDED', recordedAt: commitNow
            });
          }
          return committed;
        });
      });
      faults.hit('consumer.after_commit_before_ack');
      message.ack();
      logger.emit({ level: 'info', event: 'queue.message_committed', timestamp: commitNow, trace_id: body.trace_id, event_id: eventId, job_id: jobId, outcome: outcome.duplicate ? 'duplicate_acknowledged' : 'committed', duplicate: outcome.duplicate, attempt });
      return Object.freeze({ eventId, action: 'ack', duplicate: outcome.duplicate });
    } catch (error) {
      if (error.code === 'INJECTED_FAULT' && error.point === 'consumer.after_commit_before_ack') {
        message.retry({ delaySeconds: 0 });
        return Object.freeze({ eventId, action: 'retry', reason: 'crash_after_commit' });
      }
      const retryAfterSeconds = normalizeRetryAfterSeconds(error.retryAfterSeconds ?? null);
      const failure = contractFailure(error.failure ?? {
        failure_type: 'internal_failure', retry_class: 'transient', target_class: body.target_class ?? 'exact_item',
        safe_detail_code: error.code ?? 'CONSUMER_INTERNAL_FAILURE', http_status: null,
        observed_at: iso(lastObservedNowMs)
      });
      const classification = classifyFailure(failure, { targetClass: failure.target_class });
      const budget = retryBudget(stage, attempt);
      const nowMs = lastObservedNowMs;
      if (classification.retryable && !budget.exhausted) {
        const circuit = await withFreshDatabaseClient(openDatabase, database => database.loadCircuit({ originId }));
        const delaySeconds = await fullJitterDelaySeconds({
          stage, attempt, retryAfterSeconds,
          policyBounds: configuration.retryBounds ?? null, entropyKey: eventId
        });
        if (circuit?.state === 'open') {
          await withFreshDatabaseClient(openDatabase, database => database.transaction('queue-reledger-open-circuit', transaction => transaction.reledgerRetry({
            eventId, jobId, runId, attempt, leaseToken: prepared.lease_token,
            nextEligibleAt: iso(nowMs + delaySeconds * 1000), retryPolicyVersion: policyVersion,
            failure, retryAfterSeconds, computedDelaySeconds: delaySeconds,
            startedAt: deliveryNow, finishedAt: iso(nowMs),
            delayedOutboxIdempotencyKey: `event:${body.event_type}:${eventId}:${attempt}`
          })));
          message.ack();
          return Object.freeze({ eventId, action: 'ack_reledgered', delaySeconds });
        }
        await withFreshDatabaseClient(openDatabase, database => database.transaction('queue-record-retry', async transaction => {
          await transaction.recordAttemptFailure({
            eventId, jobId, runId, leaseToken: prepared.lease_token, attempt,
            retryPolicyVersion: policyVersion, failure, retryAfterSeconds,
            computedDelaySeconds: delaySeconds, startedAt: deliveryNow, finishedAt: iso(nowMs),
            transportAction: 'retry_after_rollback', nextEligibleAt: iso(nowMs + delaySeconds * 1000)
          });
          await transaction.recordCircuitFailure({ originId, failure, observedAt: failure.observed_at, threshold: configuration.circuitThreshold ?? 3 });
        }));
        message.retry({ delaySeconds });
        return Object.freeze({ eventId, action: 'retry', delaySeconds });
      }
      if (classification.retryable && budget.exhausted) {
        const deadLetterQueueName = configuration.deadLetterQueueName ?? `${stage.replaceAll('_', '-')}-dlq`;
        const deadLetterId = await deterministicOpaqueId('deadletter', { queueName: deadLetterQueueName, originalEventId: eventId });
        await withFreshDatabaseClient(openDatabase, database => database.transaction('queue-exhausted-durable-dlq', async transaction => {
          const disposition = {
            harvest_page: 'fail_enumeration', normalize_record: 'quarantine', enrich_schema: 'quarantine',
            access_check: 'typed_observation', project_index: 'projection_rejected'
          }[stage];
          await transaction.recordTerminalOutcome({
            eventId, jobId, runId, leaseToken: prepared.lease_token, attempt, disposition, failure,
            retryPolicyVersion: policyVersion, exhaustedOutcome: STAGE_POLICIES[stage].exhaustedOutcome,
            startedAt: deliveryNow, finishedAt: iso(nowMs), durableDeadLetterId: deadLetterId
          });
          await transaction.persistDurableDeadLetter({
            deadLetterId,
            queueName: deadLetterQueueName,
            originalEventId: eventId, sourceId,
            runId, jobId, failure,
            transportDeliveryAttempts: transportAttempt, databaseAttempts: attempt,
            retryPolicyVersion: policyVersion, messageReferences: body.references,
            replayState: 'not_requested', persistedAt: deliveryNow, sinkTransactionCommitted: true
          });
        }));
        // The terminal DB incident and stage outcome committed above, so a
        // direct Queue retry would violate the retry-after-rollback contract.
        // Platform DLQs remain the fallback for deliveries that never reach a
        // durable terminal transaction; this path acknowledges its DB DLQ.
        message.ack();
        return Object.freeze({ eventId, action: 'ack_durable_dlq', exhausted: true });
      }
      const terminalDeadLetterQueueName = configuration.deadLetterQueueName ?? `${stage.replaceAll('_', '-')}-dlq`;
      const terminalDeadLetterId = await deterministicOpaqueId('deadletter', { queueName: terminalDeadLetterQueueName, originalEventId: eventId });
      const terminalRequiresDeadLetter = ['quarantine', 'pause_source', 'fail_enumeration'].includes(classification.disposition);
      await withFreshDatabaseClient(openDatabase, database => database.transaction('queue-terminal-outcome', async transaction => {
        await transaction.recordTerminalOutcome({
          eventId, jobId, runId, attempt,
          leaseToken: prepared.lease_token, disposition: classification.disposition, failure, retryPolicyVersion: policyVersion,
          startedAt: deliveryNow, finishedAt: iso(nowMs), durableDeadLetterId: terminalRequiresDeadLetter ? terminalDeadLetterId : null
        });
        if (classification.opensCircuit) {
          await transaction.recordCircuitFailure({ originId, failure, observedAt: failure.observed_at, threshold: 1 });
          await transaction.appendAudit({
            auditEventId: `audit_auto_pause_${eventId}`, action: 'source_pause_requested', sourceId,
            reasonCode: failure.safe_detail_code, recordedAt: failure.observed_at
          });
          await transaction.requestSourcePause({
            sourceId, auditEventId: `audit_auto_pause_${eventId}`, requestedAt: failure.observed_at,
            reasonCode: failure.safe_detail_code
          });
        }
        if (terminalRequiresDeadLetter) {
          await transaction.persistDurableDeadLetter({
            deadLetterId: terminalDeadLetterId,
            queueName: terminalDeadLetterQueueName,
            originalEventId: eventId, sourceId,
            runId, jobId, failure,
            transportDeliveryAttempts: transportAttempt, databaseAttempts: attempt,
            retryPolicyVersion: policyVersion, messageReferences: body.references,
            replayState: 'not_requested', persistedAt: deliveryNow, sinkTransactionCommitted: true
          });
        }
      }));
      message.ack();
      return Object.freeze({ eventId, action: 'ack_terminal', disposition: classification.disposition });
    }
  }

  return Object.freeze({
    async handleBatch(batch) {
      invariant(batch.queue === (configuration.physicalQueueName ?? QUEUE_BY_STAGE[stage]), 'QUEUE_PHYSICAL_STAGE_MISMATCH', batch.queue);
      const results = [];
      for (const message of batch.messages) {
        try { results.push(await processOne(message)); }
        catch (error) {
          message.retry({ delaySeconds: configuration.unclassifiedRetryDelaySeconds ?? 30 });
          results.push(Object.freeze({ eventId: message.body?.event_id, action: 'retry', reason: error.code ?? 'UNCLASSIFIED' }));
        }
      }
      return Object.freeze(results);
    },
    processOne
  });
}
