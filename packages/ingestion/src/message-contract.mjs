import { invariant, parseTimestamp } from './common.mjs';

const TOP_LEVEL_FIELDS = new Set([
  'contract_version', 'event_id', 'event_type', 'idempotency_key', 'schema_version', 'trace_id',
  'attempt', 'retry_policy_version', 'source_id', 'origin_id', 'target_class', 'observed_at',
  'delivery_started_at', 'delivery_fence', 'references'
]);
const REFERENCE_FIELDS = new Set([
  'run_id', 'job_id', 'capture_ref_id', 'checkpoint_id', 'canonical_id',
  'canonical_revision_id', 'r2_key', 'cursor_ref_id'
]);
const TARGET_CLASSES = new Set(['catalog_root', 'collection', 'pagination_cursor', 'exact_item', 'exact_distribution', 'documentation']);
const EVENT_TYPES = new Set(['harvest_page_requested', 'normalize_requested', 'schema_enrichment_requested', 'access_check_requested', 'projection_requested']);
const FORBIDDEN_KEY = /(?:^|_)(?:payload|raw|body|row|rows|recordset|results?|query|answer|healthcare|financial|benchmark|market_share|cookie|authorization|password|secret|token)(?:_|$)/i;
const SECRET_VALUE = /^(?:secret|cloudflare-secret):\/\/|bearer\s|(?:api[_-]?key|password|authorization|cookie)\s*[:=]/i;

function assertSafeScalar(value, path) {
  invariant(value === null || ['string', 'number', 'boolean'].includes(typeof value), 'QUEUE_ENVELOPE_NONSCALAR_REJECTED', path);
  if (typeof value === 'string') invariant(!SECRET_VALUE.test(value), 'QUEUE_ENVELOPE_SECRET_REJECTED', path);
}

/**
 * Fail-closed Queue envelope boundary. Messages may carry identifiers, object
 * references and control metadata only; source response data is never a Queue
 * truth channel.
 */
export function assertQueueControlEnvelope(envelope) {
  invariant(envelope && typeof envelope === 'object' && !Array.isArray(envelope), 'QUEUE_ENVELOPE_INVALID');
  for (const key of Object.keys(envelope)) {
    invariant(TOP_LEVEL_FIELDS.has(key) && !FORBIDDEN_KEY.test(key), 'QUEUE_ENVELOPE_FIELD_REJECTED', key);
  }
  invariant(envelope.contract_version === 'ingestion.v1.0.0', 'QUEUE_ENVELOPE_CONTRACT_VERSION_INVALID');
  for (const key of ['event_id', 'event_type', 'idempotency_key', 'trace_id', 'retry_policy_version', 'source_id']) {
    invariant(typeof envelope[key] === 'string' && envelope[key].length > 0, 'QUEUE_ENVELOPE_REQUIRED_FIELD_INVALID', key);
    assertSafeScalar(envelope[key], key);
  }
  invariant(Number.isInteger(envelope.attempt) && envelope.attempt >= 1, 'QUEUE_ENVELOPE_ATTEMPT_INVALID');
  invariant(EVENT_TYPES.has(envelope.event_type), 'QUEUE_ENVELOPE_EVENT_TYPE_INVALID');
  if (envelope.target_class !== undefined) invariant(TARGET_CLASSES.has(envelope.target_class), 'QUEUE_ENVELOPE_TARGET_CLASS_INVALID');
  if (envelope.observed_at !== undefined) parseTimestamp(envelope.observed_at);
  if (envelope.delivery_started_at !== undefined) parseTimestamp(envelope.delivery_started_at);
  invariant(envelope.delivery_fence && Number.isInteger(envelope.delivery_fence.run_attempt) && envelope.delivery_fence.run_attempt >= 1, 'QUEUE_ENVELOPE_RUN_ATTEMPT_INVALID');
  invariant(Number.isInteger(envelope.delivery_fence.lease_epoch) && envelope.delivery_fence.lease_epoch >= 1, 'QUEUE_ENVELOPE_LEASE_EPOCH_INVALID');
  invariant(Object.keys(envelope.delivery_fence).every(key => ['run_attempt', 'lease_epoch'].includes(key)), 'QUEUE_ENVELOPE_DELIVERY_FENCE_FIELD_REJECTED');
  invariant(envelope.references && typeof envelope.references === 'object' && !Array.isArray(envelope.references), 'QUEUE_ENVELOPE_REFERENCES_INVALID');
  for (const [key, value] of Object.entries(envelope.references)) {
    invariant(REFERENCE_FIELDS.has(key) && !FORBIDDEN_KEY.test(key), 'QUEUE_ENVELOPE_REFERENCE_FIELD_REJECTED', key);
    assertSafeScalar(value, `references.${key}`);
  }
  invariant(typeof envelope.references.run_id === 'string' && typeof envelope.references.job_id === 'string', 'QUEUE_ENVELOPE_JOB_REFERENCES_REQUIRED');
  return true;
}

export function queueControlEnvelopeFields() {
  return Object.freeze({ topLevel: Object.freeze([...TOP_LEVEL_FIELDS].sort()), references: Object.freeze([...REFERENCE_FIELDS].sort()) });
}
