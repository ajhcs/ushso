import { invariant, parseTimestamp, sha256Hex } from './common.mjs';

export const STAGE_POLICIES = Object.freeze({
  harvest_page: Object.freeze({ maximumDeliveryAttempts: 6, minimumDelaySeconds: 5, maximumDelaySeconds: 900, exhaustedOutcome: 'durable_dlq_and_partial_unpublished' }),
  normalize_record: Object.freeze({ maximumDeliveryAttempts: 5, minimumDelaySeconds: 2, maximumDelaySeconds: 300, exhaustedOutcome: 'quarantine_and_durable_dlq' }),
  enrich_schema: Object.freeze({ maximumDeliveryAttempts: 4, minimumDelaySeconds: 10, maximumDelaySeconds: 1800, exhaustedOutcome: 'quarantine_and_durable_dlq' }),
  access_check: Object.freeze({ maximumDeliveryAttempts: 4, minimumDelaySeconds: 30, maximumDelaySeconds: 1800, exhaustedOutcome: 'typed_stale_or_failed_observation_and_durable_dlq' }),
  project_index: Object.freeze({ maximumDeliveryAttempts: 5, minimumDelaySeconds: 2, maximumDelaySeconds: 300, exhaustedOutcome: 'reject_generation_and_durable_dlq' })
});

const TRANSIENT = new Set(['rate_limited', 'upstream_5xx', 'timeout', 'dns_failure', 'tls_failure', 'internal_failure']);
const TYPED_OBSERVATION = new Set(['expected_access_restriction', 'not_found', 'gone']);
const QUARANTINE = new Set(['redirect_unapproved', 'schema_drift', 'parse_failure', 'unexpected_content_type', 'response_too_large', 'canonical_invariant_failure']);
const PAUSE = new Set(['catalog_auth_misconfigured', 'policy_blocked']);
const ENUMERATION_TARGETS = new Set(['catalog_root', 'collection', 'pagination_cursor']);
const TARGET_CLASSES = new Set([...ENUMERATION_TARGETS, 'exact_item', 'exact_distribution', 'documentation']);

const RETRY_CLASS_BY_DISPOSITION = Object.freeze({
  retry: 'transient',
  typed_observation: 'terminal_observation',
  quarantine: 'quarantine',
  pause_source: 'pause_source',
  fail_enumeration: 'enumeration_terminal'
});

export function classifyFailure(failure, { targetClass = failure?.target_class } = {}) {
  invariant(failure && typeof failure.failure_type === 'string', 'FAILURE_TYPE_MISSING');
  invariant(TARGET_CLASSES.has(targetClass), 'FAILURE_TARGET_CLASS_UNKNOWN', String(targetClass));
  const type = failure.failure_type;
  let disposition;
  let circuitEffect = 'none';
  if (type === 'cursor_expired') disposition = ENUMERATION_TARGETS.has(targetClass) ? 'fail_enumeration' : 'quarantine';
  else if (TRANSIENT.has(type)) { disposition = 'retry'; circuitEffect = 'consume_shared_budget'; }
  if (TYPED_OBSERVATION.has(type)) {
    disposition = ENUMERATION_TARGETS.has(targetClass) ? 'fail_enumeration' : 'typed_observation';
  }
  if (QUARANTINE.has(type)) { disposition = 'quarantine'; circuitEffect = type === 'schema_drift' ? 'open_source_circuit' : 'none'; }
  if (PAUSE.has(type)) { disposition = 'pause_source'; circuitEffect = 'open_source_circuit'; }
  invariant(disposition, 'FAILURE_TYPE_UNKNOWN', type);
  const expectedRetryClass = RETRY_CLASS_BY_DISPOSITION[disposition];
  if (failure.retry_class !== undefined) invariant(failure.retry_class === expectedRetryClass, 'FAILURE_RETRY_CLASS_MISMATCH', `${failure.retry_class}:${expectedRetryClass}`);
  invariant(typeof failure.safe_detail_code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(failure.safe_detail_code), 'FAILURE_SAFE_DETAIL_CODE_INVALID');
  parseTimestamp(failure.observed_at);
  if (failure.http_status !== undefined && failure.http_status !== null) invariant(Number.isInteger(failure.http_status) && failure.http_status >= 100 && failure.http_status <= 599, 'FAILURE_HTTP_STATUS_INVALID');
  return Object.freeze({
    failureType: type,
    disposition,
    retryClass: expectedRetryClass,
    retryable: disposition === 'retry',
    circuitEffect,
    opensCircuit: circuitEffect === 'open_source_circuit',
    transportRetryAllowed: disposition === 'retry'
  });
}

export async function fullJitterDelaySeconds({ stage, attempt, retryAfterSeconds = null, policyBounds = null, entropyKey }) {
  const policy = STAGE_POLICIES[stage];
  invariant(policy, 'STAGE_POLICY_UNKNOWN', stage);
  invariant(Number.isInteger(attempt) && attempt >= 1, 'ATTEMPT_INVALID', String(attempt));
  const minimum = policyBounds?.minimumDelaySeconds ?? policy.minimumDelaySeconds;
  const maximum = policyBounds?.maximumDelaySeconds ?? policy.maximumDelaySeconds;
  invariant(minimum >= 0 && maximum >= minimum, 'RETRY_DELAY_BOUNDS_INVALID');
  if (retryAfterSeconds !== null) return Math.max(minimum, Math.min(maximum, Math.floor(retryAfterSeconds)));
  const cap = Math.min(maximum, minimum * (2 ** Math.max(0, attempt - 1)));
  const digest = await sha256Hex(`${entropyKey}:${stage}:${attempt}`);
  const fraction = Number.parseInt(digest.slice(0, 8), 16) / 0xffffffff;
  return Math.max(minimum, Math.floor(fraction * (cap + 1)));
}

export function retryBudget(stage, transportAttempts) {
  const policy = STAGE_POLICIES[stage];
  invariant(policy, 'STAGE_POLICY_UNKNOWN', stage);
  return Object.freeze({
    maximumDeliveryAttempts: policy.maximumDeliveryAttempts,
    transportMaxRetries: policy.maximumDeliveryAttempts - 1,
    exhausted: transportAttempts >= policy.maximumDeliveryAttempts
  });
}
