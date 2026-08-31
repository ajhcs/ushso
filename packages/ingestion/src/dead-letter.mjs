import { deterministicOpaqueId, invariant, iso, parseTimestamp } from './common.mjs';
import { assertControlStore, withFreshDatabaseClient } from './ports.mjs';
import { createNullLogger } from './redaction.mjs';
import { assertDlqSinkTransportConfiguration, dlqSinkRetryDelaySeconds, DLQ_SINK_TRANSPORT_POLICY } from './dlq-sink-policy.mjs';

export function createDeadLetterSink({ openDatabase, faults = { hit() {} }, logger = createNullLogger(), configuration = {} }) {
  invariant(typeof openDatabase === 'function', 'OPEN_DATABASE_PORT_MISSING');
  invariant(typeof configuration.clock === 'function', 'OPERATIONAL_CLOCK_MISSING');
  assertDlqSinkTransportConfiguration(configuration.transport);
  const logicalQueueName = configuration.logicalQueueName;
  invariant(['harvest-page-dlq', 'normalize-record-dlq', 'enrich-schema-dlq', 'access-check-dlq', 'project-index-dlq'].includes(logicalQueueName), 'DLQ_LOGICAL_QUEUE_NAME_INVALID');
  return Object.freeze({
    async handleBatch(batch) {
      if (configuration.physicalQueueName !== undefined) invariant(batch.queue === configuration.physicalQueueName, 'DLQ_PHYSICAL_QUEUE_NAME_MISMATCH');
      const results = [];
      for (const message of batch.messages) {
        const observedAt = iso(parseTimestamp(configuration.clock()));
        try {
          const body = message.body;
          const persistedAt = observedAt;
          await withFreshDatabaseClient(openDatabase, async database => {
            assertControlStore(database);
            return database.transaction('dlq-sink-persist', async transaction => {
              const deadLetterId = body.dead_letter_id ?? await deterministicOpaqueId('deadletter', { queueName: logicalQueueName, originalEventId: body.event_id });
              const existing = await transaction.getDeadLetterByOriginalEvent({ originalEventId: body.event_id, queueName: logicalQueueName });
              if (!existing) {
                let evidence = await transaction.loadDeadLetterEvidence({ originalEventId: body.event_id });
                // A platform delivery is not authority to invent database
                // attempt history. If the exact PostgreSQL attempt/failure
                // ledger is unavailable, leave the delivery unacknowledged so
                // bounded transport retry and the terminal page path apply.
                invariant(evidence?.failure, 'DLQ_DATABASE_EVIDENCE_MISSING', body.event_id);
                await transaction.persistDurableDeadLetter({
                  deadLetterId, queueName: logicalQueueName, originalEventId: body.event_id,
                  sourceId: evidence.source_id, runId: evidence.run_id, jobId: evidence.job_id,
                  failure: evidence.failure, transportDeliveryAttempts: message.attempts ?? body.attempt ?? 1,
                  databaseAttempts: evidence.database_attempts, retryPolicyVersion: evidence.retry_policy_version,
                  messageReferences: evidence.message_references, attemptIds: evidence.attempt_ids,
                  // This insert and the commit receipt are part of the same
                  // database transaction.  The public durable-dead-letter
                  // contract only admits committed records, so never persist
                  // an intermediate false value that could not satisfy the
                  // frozen contract/SQL CHECK.
                  replayState: 'not_requested', persistedAt, sinkTransactionCommitted: true
                });
              }
              await transaction.markDeadLetterSinkCommitted({ deadLetterId: existing?.dead_letter_id ?? deadLetterId, persistedAt });
            });
          });
          faults.hit('dlq.after_commit_before_ack');
          message.ack();
          logger.emit({ level: 'error', event: 'dlq.persisted', timestamp: persistedAt, trace_id: body.trace_id, event_id: body.event_id, queue: logicalQueueName, outcome: 'persisted', attempt: message.attempts ?? 1 });
          results.push({ eventId: body.event_id, action: 'ack' });
        } catch (error) {
          const deliveryAttempt = message.attempts ?? message.body?.attempt ?? 1;
          const delaySeconds = dlqSinkRetryDelaySeconds(deliveryAttempt);
          const finalConfiguredDelivery = deliveryAttempt >= DLQ_SINK_TRANSPORT_POLICY.maximumDeliveryAttempts;
          logger.emit({
            level: finalConfiguredDelivery ? 'error' : 'warn',
            event: finalConfiguredDelivery ? 'dlq.persistence_transport_exhausted' : 'dlq.persistence_retry_scheduled',
            timestamp: observedAt,
            trace_id: message.body?.trace_id,
            event_id: message.body?.event_id,
            queue: logicalQueueName,
            outcome: finalConfiguredDelivery ? 'page_postgresql_reconstruction_required' : 'retry_scheduled',
            failure_type: 'internal_failure',
            safe_detail_code: finalConfiguredDelivery ? 'DLQ_SINK_FINAL_PERSISTENCE_FAILURE' : 'DLQ_SINK_PERSISTENCE_FAILURE',
            attempt: deliveryAttempt,
            count: 1
          });
          // At max_retries Cloudflare treats this retry as the exhausted final
          // delivery. With the required no-recursive-DLQ configuration the
          // Queue message is then deleted, so recovery cannot depend on Queue
          // retention and must reconcile durable PostgreSQL evidence.
          message.retry({ delaySeconds });
          results.push({
            eventId: message.body?.event_id, action: 'retry', delaySeconds,
            finalConfiguredDelivery,
            recoverySource: finalConfiguredDelivery ? 'postgresql_run_job_outbox_failure_evidence' : null,
            reason: error.code ?? 'DLQ_PERSIST_FAILED'
          });
        }
      }
      return Object.freeze(results.map(Object.freeze));
    }
  });
}

export function createDeadLetterRecoveryReconciler({ openDatabase, logger = createNullLogger(), configuration = {} }) {
  invariant(typeof openDatabase === 'function', 'OPEN_DATABASE_PORT_MISSING');
  invariant(typeof configuration.clock === 'function', 'OPERATIONAL_CLOCK_MISSING');
  const limit = configuration.limit ?? 100;
  invariant(Number.isInteger(limit) && limit > 0 && limit <= 1_000, 'DLQ_RECOVERY_LIMIT_INVALID');

  return Object.freeze({
    async reconcile({ transportExhaustionObservations = [] } = {}) {
      const recoveredAt = iso(parseTimestamp(configuration.clock()));
      invariant(Array.isArray(transportExhaustionObservations) && transportExhaustionObservations.length <= limit, 'DLQ_TRANSPORT_EXHAUSTION_OBSERVATIONS_INVALID');
      for (const observation of transportExhaustionObservations) {
        await withFreshDatabaseClient(openDatabase, async database => {
          assertControlStore(database);
          return database.transaction('dlq-transport-exhaustion-observation', transaction => transaction.recordDeadLetterTransportExhaustionObservation(observation));
        });
      }
      const candidates = await withFreshDatabaseClient(openDatabase, async database => {
        assertControlStore(database);
        return database.listDeadLetterRecoveryCandidates({ now: recoveredAt, limit });
      });
      const results = [];
      for (const candidate of candidates) {
        const result = await withFreshDatabaseClient(openDatabase, async database => database.transaction('dlq-postgresql-reconstruct', async transaction => {
          const existing = await transaction.getDeadLetterByOriginalEvent({ originalEventId: candidate.original_event_id, queueName: candidate.queue_name });
          if (existing) return { created: false, deadLetterId: existing.dead_letter_id };
          const deadLetterId = await deterministicOpaqueId('deadletter', { queueName: candidate.queue_name, originalEventId: candidate.original_event_id });
          invariant(candidate.requires_synthetic_attempt !== true, 'DLQ_SYNTHETIC_ATTEMPT_FORBIDDEN', candidate.original_event_id);
          const evidence = await transaction.loadDeadLetterEvidence({ originalEventId: candidate.original_event_id });
          invariant(evidence?.failure, 'DLQ_DATABASE_EVIDENCE_MISSING', candidate.original_event_id);
          invariant(evidence.job_id === candidate.job_id && evidence.run_id === candidate.run_id, 'DLQ_DATABASE_EVIDENCE_FENCE_REJECTED', candidate.original_event_id);
          await transaction.persistDurableDeadLetter({
            deadLetterId, queueName: candidate.queue_name, originalEventId: candidate.original_event_id,
            sourceId: evidence.source_id, runId: evidence.run_id, jobId: evidence.job_id,
            failure: evidence.failure, transportDeliveryAttempts: candidate.transport_delivery_attempts,
            databaseAttempts: evidence.database_attempts, retryPolicyVersion: evidence.retry_policy_version,
            messageReferences: evidence.message_references, attemptIds: evidence.attempt_ids,
            replayState: 'not_requested', persistedAt: recoveredAt, sinkTransactionCommitted: true
          });
          await transaction.appendAudit({
            auditEventId: `audit_dlq_reconstruct_${deadLetterId}`,
            action: 'dead_letter_reconstructed_after_transport_loss',
            deadLetterId,
            runId: evidence.run_id,
            jobId: evidence.job_id,
            reasonCode: 'CLOUDFLARE_DLQ_TRANSPORT_EXHAUSTED',
            recordedAt: recoveredAt
          });
          return { created: true, deadLetterId };
        }));
        logger.emit({
          level: 'error', event: 'dlq.postgresql_evidence_reconstructed', timestamp: recoveredAt,
          event_id: candidate.original_event_id, run_id: candidate.run_id, job_id: candidate.job_id,
          queue: candidate.queue_name, outcome: result.created ? 'reconstructed' : 'already_reconstructed',
          safe_detail_code: 'DLQ_QUEUE_MESSAGE_PERMANENTLY_UNAVAILABLE', count: result.created ? 1 : 0
        });
        results.push(Object.freeze({ originalEventId: candidate.original_event_id, ...result }));
      }
      return Object.freeze(results);
    }
  });
}

export function createReplayService({ openDatabase, logger = createNullLogger() }) {
  invariant(typeof openDatabase === 'function', 'OPEN_DATABASE_PORT_MISSING');
  return Object.freeze({
    async replay({ deadLetterId, auditEventId, requestedAt }) {
      const when = iso(parseTimestamp(requestedAt));
      const deadLetter = await withFreshDatabaseClient(openDatabase, database => database.getDeadLetter({ deadLetterId }));
      invariant(deadLetter, 'DEAD_LETTER_NOT_FOUND', deadLetterId);
      const replayId = await deterministicOpaqueId('replay', { deadLetterId, auditEventId });
      const newRunId = await deterministicOpaqueId('run', { replayId, originalRunId: deadLetter.run_id });
      const newEventId = await deterministicOpaqueId('event', { replayId, originalEventId: deadLetter.original_event_id });
      const created = await withFreshDatabaseClient(openDatabase, database => database.transaction('dlq-replay-create', transaction => transaction.createReplay({
        replayId, originalDeadLetterId: deadLetterId, originalEventId: deadLetter.original_event_id,
        originalRunId: deadLetter.run_id, newRunId, newEventId,
        originalRetryPolicyVersion: deadLetter.retry_policy_version, replayPolicyVersion: 'replay.v1',
        requestedByAuditEventId: auditEventId, requestedAt: when
      })));
      logger.emit({ level: 'info', event: 'dlq.replay_created', timestamp: when, event_id: newEventId, run_id: newRunId, outcome: created.created ? 'created' : 'duplicate', duplicate: !created.created });
      return Object.freeze({ replayId, newRunId, newEventId, created: created.created });
    }
  });
}
