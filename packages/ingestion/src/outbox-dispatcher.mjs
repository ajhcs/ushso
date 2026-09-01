import { iso, invariant, parseTimestamp } from './common.mjs';
import { assertControlStore, assertQueueProducer, withFreshDatabaseClient } from './ports.mjs';
import { createNullLogger } from './redaction.mjs';
import { assertQueueControlEnvelope } from './message-contract.mjs';

export function queueMessageFromOutbox(event, routing) {
  invariant(routing && typeof routing.origin_id === 'string' && typeof routing.target_class === 'string', 'QUEUE_ROUTING_MISSING', event.event_id);
  const message = {
    contract_version: 'ingestion.v1.0.0',
    event_id: event.event_id,
    event_type: event.event_type,
    idempotency_key: event.idempotency_key,
    schema_version: event.schema_version ?? '1.0.0',
    trace_id: event.trace_id,
    attempt: event.attempt_count,
    retry_policy_version: event.retry_policy_version,
    source_id: event.source_id,
    origin_id: routing.origin_id,
    target_class: routing.target_class,
    delivery_fence: Object.freeze({ run_attempt: event.run_attempt, lease_epoch: event.job_lease_epoch }),
    references: structuredClone(event.references)
  };
  assertQueueControlEnvelope(message);
  return Object.freeze(message);
}

export function createOutboxDispatcher({ openDatabase, queueForEvent, faults = { hit() {} }, logger = createNullLogger(), configuration = {} }) {
  invariant(typeof openDatabase === 'function', 'OPEN_DATABASE_PORT_MISSING');
  invariant(typeof queueForEvent === 'function', 'QUEUE_RESOLVER_MISSING');
  const leaseDurationMs = configuration.leaseDurationMs ?? 60_000;
  const limit = configuration.batchSize ?? 100;
  const queueRetentionMs = configuration.queueRetentionMs ?? 4 * 24 * 60 * 60 * 1000;

  return Object.freeze({
    async dispatch({ now, ownerId = 'dispatcher_outbox', traceId = 'trace_outbox' }) {
      const nowMs = parseTimestamp(now);
      const leased = await withFreshDatabaseClient(openDatabase, async database => {
        assertControlStore(database);
        return database.transaction('outbox-lease', transaction => transaction.leaseOutbox({
          now: iso(nowMs), ownerId, leaseExpiresAt: iso(nowMs + leaseDurationMs), limit,
          transportRetentionExpiresAt: iso(nowMs + queueRetentionMs),
          excludeEventTypes: ['workflow_start_requested']
        }));
      });
      const results = [];
      for (const event of leased) {
        let sent = false;
        try {
          const queue = queueForEvent(event.event_type);
          assertQueueProducer(queue);
          const routing = await withFreshDatabaseClient(openDatabase, async database => {
            assertControlStore(database);
            return database.loadQueueRouting({
              eventId: event.event_id, eventType: event.event_type, sourceId: event.source_id,
              jobId: event.references?.job_id
            });
          });
          const message = queueMessageFromOutbox(event, routing);
          faults.hit('outbox.before_send');
          await queue.send(message, event.delay_seconds ? { delaySeconds: event.delay_seconds } : undefined);
          sent = true;
          faults.hit('outbox.after_send_before_mark');
          await withFreshDatabaseClient(openDatabase, async database => database.transaction('outbox-mark-published', transaction => transaction.markOutboxPublished({
            eventId: event.event_id, leaseToken: event.lease_token, publishedAt: iso(nowMs),
            transportRetentionExpiresAt: iso(nowMs + queueRetentionMs)
          })));
          faults.hit('outbox.after_mark');
          logger.emit({ level: 'info', event: 'outbox.published', timestamp: iso(nowMs), trace_id: event.trace_id ?? traceId, event_id: event.event_id, outcome: 'published', attempt: event.attempt_count });
          results.push({ eventId: event.event_id, outcome: 'published' });
        } catch (error) {
          if (!sent) {
            const currentAttempt = event.attempt_count;
            await withFreshDatabaseClient(openDatabase, async database => database.transaction(
              currentAttempt >= event.maximum_delivery_attempts ? 'outbox-mark-dead' : 'outbox-mark-retry',
              transaction => currentAttempt >= event.maximum_delivery_attempts
                ? transaction.markOutboxDead({ eventId: event.event_id, leaseToken: event.lease_token, failedAt: iso(nowMs), safeDetailCode: error.code ?? 'QUEUE_SEND_FAILED' })
                : transaction.markOutboxRetry({ eventId: event.event_id, leaseToken: event.lease_token, nextEligibleAt: iso(nowMs + (configuration.retryDelayMs ?? 30_000)), safeDetailCode: error.code ?? 'QUEUE_SEND_FAILED' })
            )).catch(() => {});
          }
          results.push({ eventId: event.event_id, outcome: sent ? 'uncertain' : (event.attempt_count >= event.maximum_delivery_attempts ? 'dead' : 'retry'), code: error.code ?? 'QUEUE_SEND_FAILED' });
        }
      }
      return Object.freeze(results.map(Object.freeze));
    }
  });
}
