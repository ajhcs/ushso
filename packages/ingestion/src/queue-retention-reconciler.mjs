import { deterministicOpaqueId, invariant, iso, parseTimestamp } from './common.mjs';
import { assertControlStore, withFreshDatabaseClient } from './ports.mjs';
import { createNullLogger } from './redaction.mjs';

/**
 * PostgreSQL is the source of recovery when a Queue delivery disappears or
 * exceeds its configured retention horizon. Recovery creates a new fenced
 * outbox delivery; it never mutates the prior event or resets attempt history.
 */
export function createQueueRetentionReconciler({ openDatabase, logger = createNullLogger(), configuration = {} }) {
  invariant(typeof openDatabase === 'function', 'OPEN_DATABASE_PORT_MISSING');
  const batchSize = configuration.batchSize ?? 100;
  const queueRetentionMs = configuration.queueRetentionMs ?? 4 * 24 * 60 * 60 * 1000;

  return Object.freeze({
    async reconcile({ now }) {
      const nowMs = parseTimestamp(now);
      const expired = await withFreshDatabaseClient(openDatabase, async database => {
        assertControlStore(database);
        return database.transaction('queue-retention-scan', transaction => transaction.listExpiredQueueDeliveries({ now: iso(nowMs), limit: batchSize }));
      });
      const results = [];
      for (const job of expired) {
        const priorLeaseEpoch = job.delivery_fence.lease_epoch;
        const recoveryEventId = await deterministicOpaqueId('event', {
          purpose: 'queue_retention_recovery', jobId: job.job_id, runId: job.run_id,
          transportGeneration: job.transport_generation + 1, priorLeaseEpoch
        });
        try {
          const recovered = await withFreshDatabaseClient(openDatabase, database => database.transaction('queue-retention-reledger', transaction => transaction.reledgerExpiredQueueDelivery({
            jobId: job.job_id, runId: job.run_id, priorLeaseEpoch, recoveredAt: iso(nowMs),
            newTransportExpiresAt: iso(nowMs + queueRetentionMs), recoveryEventId
          })));
          logger.emit({
            level: 'warn', event: 'queue.retention_recovered', timestamp: iso(nowMs), source_id: job.source_id,
            run_id: job.run_id, job_id: job.job_id, event_id: recoveryEventId,
            lease_epoch: recovered.lease_epoch ?? priorLeaseEpoch, outcome: recovered.created ? 'reledgered' : 'duplicate'
          });
          results.push(Object.freeze({ jobId: job.job_id, eventId: recoveryEventId, outcome: recovered.created ? 'reledgered' : 'duplicate' }));
        } catch (error) {
          results.push(Object.freeze({ jobId: job.job_id, eventId: recoveryEventId, outcome: 'stale_or_retry', code: error.code ?? 'QUEUE_RETENTION_RECOVERY_FAILED' }));
        }
      }
      return Object.freeze(results);
    }
  });
}
