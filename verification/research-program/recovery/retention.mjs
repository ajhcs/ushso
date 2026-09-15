import { createHash } from 'node:crypto';

export const RETENTION_CLASSES = Object.freeze({
  metadata: Object.freeze({ class: 'metadata', online_days_min: 90, sample_store: false }),
  sample: Object.freeze({ class: 'sample', online_days_min: null, separate_gated_store: true, not_created_by_this_pr: true }),
});

export function quotaBehavior({ used_bytes, quota_bytes }) {
  const exceeded = used_bytes > quota_bytes;
  return Object.freeze({
    used_bytes,
    quota_bytes,
    exceeded,
    next_action: exceeded ? 'stop_new_sample_writes_preserve_metadata' : 'within_quota',
    historical_approved_evidence_erased: false,
  });
}

export function replayJob({ attempts, replay_of }) {
  return Object.freeze({
    attempts: attempts + 1,
    replay_of,
    history_reset: false,
    pending_scientific_claims_published: false,
  });
}

export function rotateCredential({ previous_secret, next_secret, logs = [] }) {
  const leaked = logs.some((line) => typeof line === 'string' && (line.includes(previous_secret) || line.includes(next_secret)));
  return Object.freeze({
    rotated: true,
    previous_secret_hash: createHash('sha256').update(previous_secret).digest('hex'),
    next_secret_hash: createHash('sha256').update(next_secret).digest('hex'),
    secrets_in_logs: leaked,
    historical_approved_evidence_erased: false,
  });
}

export function cursorInvalidAfterRotation({ signerA, signerB, cursorFromA, capability, input, generation, manifest, items, section }) {
  return signerB.page({ capability, input: { ...input, cursor: cursorFromA }, generation, manifest, items, section });
}
