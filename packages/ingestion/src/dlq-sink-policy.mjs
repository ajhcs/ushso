import { invariant } from './common.mjs';

export const DLQ_SINK_TRANSPORT_POLICY = Object.freeze({
  policyVersion: 'dlq-sink.v1',
  maximumDeliveryAttempts: 6,
  transportMaxRetries: 5,
  maximumBatchSize: 1,
  minimumDelaySeconds: 30,
  maximumDelaySeconds: 300,
  secondDeadLetterQueueAllowed: false
});

export function dlqSinkRetryDelaySeconds(deliveryAttempt) {
  invariant(Number.isInteger(deliveryAttempt) && deliveryAttempt >= 1, 'DLQ_SINK_DELIVERY_ATTEMPT_INVALID');
  return Math.min(
    DLQ_SINK_TRANSPORT_POLICY.maximumDelaySeconds,
    DLQ_SINK_TRANSPORT_POLICY.minimumDelaySeconds * (2 ** Math.max(0, deliveryAttempt - 1))
  );
}

export function assertDlqSinkTransportConfiguration(configuration) {
  invariant(configuration && typeof configuration === 'object', 'DLQ_SINK_TRANSPORT_CONFIGURATION_MISSING');
  invariant(configuration.maxRetries === DLQ_SINK_TRANSPORT_POLICY.transportMaxRetries, 'DLQ_SINK_MAX_RETRIES_MISMATCH');
  invariant(configuration.maxBatchSize === DLQ_SINK_TRANSPORT_POLICY.maximumBatchSize, 'DLQ_SINK_BATCH_SIZE_MISMATCH');
  invariant(configuration.deadLetterQueue === null || configuration.deadLetterQueue === undefined, 'DLQ_SINK_RECURSIVE_DLQ_REJECTED');
  return true;
}
