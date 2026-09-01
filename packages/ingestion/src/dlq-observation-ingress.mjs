import { invariant, iso, parseTimestamp } from './common.mjs';
import { assertControlStore, withFreshDatabaseClient } from './ports.mjs';
import { createNullLogger } from './redaction.mjs';
import { DLQ_SINK_TRANSPORT_POLICY, dlqSinkRetryDelaySeconds } from './dlq-sink-policy.mjs';

const OBSERVATION_FIELDS = new Set([
  'contract_version', 'record_kind', 'original_event_id', 'queue_name',
  'source_id', 'run_id', 'job_id', 'transport_delivery_attempts',
  'observed_at', 'evidence_reference_id', 'audit_event_id'
]);
const DLQ_NAMES = new Set([
  'harvest-page-dlq', 'normalize-record-dlq', 'enrich-schema-dlq',
  'access-check-dlq', 'project-index-dlq'
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const FORBIDDEN_TEXT = /(?:secret|password|authorization|cookie|bearer|response[_-]?body|question[_-]?text|healthcare|financial|market[_-]?share)/i;

/**
 * Validates the audited, zero-payload observation used after Cloudflare has
 * permanently deleted a DLQ delivery at its configured retry limit.  This is
 * not a copy of the lost Queue message: it contains only exact PostgreSQL
 * ledger identifiers plus an independently retained evidence reference.
 */
export function assertDlqTransportExhaustionObservation(value) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'DLQ_EXHAUSTION_OBSERVATION_INVALID');
  invariant(Object.keys(value).every(key => OBSERVATION_FIELDS.has(key)), 'DLQ_EXHAUSTION_OBSERVATION_FIELD_REJECTED');
  invariant(value.contract_version === 'ingestion.control.v1.0.0', 'DLQ_EXHAUSTION_OBSERVATION_VERSION_INVALID');
  invariant(value.record_kind === 'dlq_transport_exhaustion_observation', 'DLQ_EXHAUSTION_OBSERVATION_KIND_INVALID');
  for (const field of ['original_event_id', 'source_id', 'run_id', 'job_id', 'evidence_reference_id', 'audit_event_id']) {
    invariant(typeof value[field] === 'string' && SAFE_ID.test(value[field]) && !FORBIDDEN_TEXT.test(value[field]), 'DLQ_EXHAUSTION_OBSERVATION_IDENTIFIER_INVALID', field);
  }
  invariant(DLQ_NAMES.has(value.queue_name), 'DLQ_EXHAUSTION_OBSERVATION_QUEUE_INVALID');
  invariant(value.transport_delivery_attempts === DLQ_SINK_TRANSPORT_POLICY.maximumDeliveryAttempts, 'DLQ_EXHAUSTION_OBSERVATION_ATTEMPTS_INVALID');
  parseTimestamp(value.observed_at);
  return true;
}

/**
 * Bounded operational ingress for an independently retained page/audit
 * observation. ACK happens only after PostgreSQL commits. On the sixth failed
 * delivery Cloudflare may delete this ingress message too; the terminal page
 * explicitly directs recovery to the external audit evidence for resubmission.
 */
export function createDlqTransportExhaustionObservationIngress({ openDatabase, logger = createNullLogger(), configuration = {} }) {
  invariant(typeof openDatabase === 'function', 'OPEN_DATABASE_PORT_MISSING');
  invariant(typeof configuration.clock === 'function', 'OPERATIONAL_CLOCK_MISSING');
  const physicalQueueName = configuration.physicalQueueName ?? 'dlq-transport-exhaustion-observations';
  return Object.freeze({
    async handleBatch(batch) {
      invariant(batch?.queue === physicalQueueName, 'DLQ_EXHAUSTION_OBSERVATION_QUEUE_MISMATCH');
      const results = [];
      for (const message of batch.messages ?? []) {
        const admittedAt = iso(parseTimestamp(configuration.clock()));
        const deliveryAttempt = message.attempts ?? 1;
        try {
          assertDlqTransportExhaustionObservation(message.body);
          const observation = message.body;
          const outcome = await withFreshDatabaseClient(openDatabase, async database => {
            assertControlStore(database);
            return database.transaction('dlq-transport-exhaustion-observation-ingress', transaction => transaction.recordDeadLetterTransportExhaustionObservation({
              originalEventId: observation.original_event_id,
              queueName: observation.queue_name,
              sourceId: observation.source_id,
              runId: observation.run_id,
              jobId: observation.job_id,
              transportDeliveryAttempts: observation.transport_delivery_attempts,
              observedAt: observation.observed_at,
              evidenceRefId: observation.evidence_reference_id,
              auditEventId: observation.audit_event_id,
              admittedAt
            }));
          });
          message.ack();
          logger.emit({
            level: 'error', event: 'dlq.exhaustion_observation_committed', timestamp: admittedAt,
            event_id: observation.original_event_id, run_id: observation.run_id,
            job_id: observation.job_id, queue: observation.queue_name,
            outcome: outcome?.created === false ? 'duplicate' : 'committed', duplicate: outcome?.created === false,
            attempt: deliveryAttempt, count: outcome?.created === false ? 0 : 1
          });
          results.push(Object.freeze({ eventId: observation.original_event_id, action: 'ack', duplicate: outcome?.created === false }));
        } catch (error) {
          const finalConfiguredDelivery = deliveryAttempt >= DLQ_SINK_TRANSPORT_POLICY.maximumDeliveryAttempts;
          const delaySeconds = dlqSinkRetryDelaySeconds(deliveryAttempt);
          message.retry({ delaySeconds });
          logger.emit({
            level: finalConfiguredDelivery ? 'error' : 'warn',
            event: finalConfiguredDelivery ? 'dlq.exhaustion_observation_transport_exhausted' : 'dlq.exhaustion_observation_retry_scheduled',
            timestamp: admittedAt, event_id: message.body?.original_event_id,
            run_id: message.body?.run_id, job_id: message.body?.job_id,
            queue: message.body?.queue_name ?? physicalQueueName,
            outcome: finalConfiguredDelivery ? 'page_audit_evidence_resubmission_required' : 'retry_scheduled',
            safe_detail_code: finalConfiguredDelivery ? 'DLQ_EXHAUSTION_OBSERVATION_FINAL_PERSISTENCE_FAILURE' : (error.code ?? 'DLQ_EXHAUSTION_OBSERVATION_PERSISTENCE_FAILURE'),
            attempt: deliveryAttempt, count: 1
          });
          results.push(Object.freeze({
            eventId: message.body?.original_event_id, action: 'retry', delaySeconds,
            finalConfiguredDelivery,
            recoverySource: finalConfiguredDelivery ? 'independently_retained_audit_evidence_resubmission' : null,
            reason: error.code ?? 'DLQ_EXHAUSTION_OBSERVATION_PERSISTENCE_FAILED'
          }));
        }
      }
      return Object.freeze(results);
    }
  });
}

