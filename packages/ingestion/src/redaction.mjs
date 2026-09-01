import { invariant } from './common.mjs';

const ALLOWED_FIELDS = new Set([
  'level', 'event', 'timestamp', 'trace_id', 'source_id', 'run_id', 'job_id', 'event_id', 'workflow_instance_id',
  'queue', 'outcome', 'failure_type', 'safe_detail_code', 'attempt', 'count', 'duration_ms', 'state', 'duplicate',
  'lease_epoch', 'scheduled_slot', 'partition_id', 'proof_digest'
]);
const SECRET_PATTERN = /(bearer\s+[a-z0-9._~+/=-]+|(?:api[_-]?key|password|secret|token|authorization|cookie)\s*[:=]\s*[^\s,;]+)/i;

function sanitizeString(value) {
  if (SECRET_PATTERN.test(value) || value.startsWith('secret://') || value.startsWith('cloudflare-secret://')) return '[REDACTED]';
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      url.username = ''; url.password = ''; url.search = ''; url.hash = '';
      return url.toString();
    } catch { return '[REDACTED_INVALID_URL]'; }
  }
  return value.length <= 500 ? value : `${value.slice(0, 497)}...`;
}

export function redactStructuredEvent(input) {
  invariant(input && typeof input === 'object' && !Array.isArray(input), 'LOG_EVENT_INVALID');
  const output = {};
  for (const key of Object.keys(input).sort()) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    const value = input[key];
    if (value === null || typeof value === 'boolean' || typeof value === 'number') output[key] = value;
    else if (typeof value === 'string') output[key] = sanitizeString(value);
  }
  invariant(typeof output.level === 'string' && typeof output.event === 'string', 'LOG_EVENT_REQUIRED_FIELDS_MISSING');
  return Object.freeze(output);
}

export function createStructuredLogger(sink) {
  invariant(typeof sink === 'function', 'LOG_SINK_INVALID');
  return Object.freeze({
    emit(event) { sink(redactStructuredEvent(event)); }
  });
}

export function createNullLogger() {
  return Object.freeze({ emit() {} });
}
