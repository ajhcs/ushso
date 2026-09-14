import { createHash } from 'node:crypto';

export const CACHE_FORMAT = 'ushso.inference-job-cache.v1';

function freeze(value) {
  return Object.freeze(value);
}

export function taskIdentity({
  sourceBytes,
  parserVersion,
  prompt,
  schemaVersion,
  model,
  providerPolicyVersion,
  scope,
} = {}) {
  const payload = JSON.stringify({
    source_sha256: createHash('sha256').update(String(sourceBytes ?? '')).digest('hex'),
    parser_version: parserVersion,
    prompt,
    schema_version: schemaVersion,
    model,
    provider_policy_version: providerPolicyVersion,
    scope,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function createJobCache() {
  const rows = new Map();
  return {
    get(identity) {
      return rows.get(identity) ?? null;
    },
    put(identity, value) {
      const row = freeze({ ...value, identity, inference_performed: value.inference_performed === true });
      rows.set(identity, row);
      return row;
    },
    run(identity, produce) {
      const existing = rows.get(identity);
      if (existing) return freeze({ ...existing, cache_hit: true, inference_performed: false });
      const created = produce();
      const row = freeze({ ...created, identity, cache_hit: false, inference_performed: true });
      rows.set(identity, row);
      return row;
    },
  };
}
