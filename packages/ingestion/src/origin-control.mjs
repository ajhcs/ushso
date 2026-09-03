import { invariant, iso, parseTimestamp } from './common.mjs';
import { classifyFailure } from './failure-policy.mjs';
import { assertControlStore, withFreshDatabaseClient } from './ports.mjs';
import { createNullLogger } from './redaction.mjs';

export function createOriginController({ openDatabase, logger = createNullLogger(), configuration = {} }) {
  invariant(typeof openDatabase === 'function', 'OPEN_DATABASE_PORT_MISSING');
  const capacity = configuration.capacity ?? 2;
  const refillPerSecond = configuration.refillPerSecond ?? 1;
  const circuitThreshold = configuration.circuitThreshold ?? 3;
  const circuitCooldownMs = configuration.circuitCooldownMs ?? 60_000;

  return Object.freeze({
    async acquire({ originId, now, tokens = 1 }) {
      const timestamp = iso(parseTimestamp(now));
      const result = await withFreshDatabaseClient(openDatabase, async database => {
        assertControlStore(database);
        return database.transaction('origin-permit-acquire', transaction => transaction.acquireOriginPermit({
          originId, now: timestamp, requestedTokens: tokens, capacity, refillPerSecond
        }));
      });
      if (!result.allowed) logger.emit({
        level: 'warn', event: result.reason === 'token_bucket_empty' ? 'origin.rate_limited' : 'origin.circuit_blocked',
        timestamp, safe_detail_code: result.reason === 'token_bucket_empty' ? 'LOCAL_TOKEN_BUCKET_EMPTY' : 'ORIGIN_CIRCUIT_BLOCKED', count: tokens, state: result.circuit_state
      });
      return Object.freeze({ ...result, retryAt: result.retry_at ?? null });
    },

    async failure({ originId, failure, now }) {
      const timestamp = iso(parseTimestamp(now));
      const classified = classifyFailure(failure);
      const state = await withFreshDatabaseClient(openDatabase, database => database.transaction('origin-circuit-failure', transaction => transaction.recordCircuitFailure({
        originId, failure, observedAt: timestamp, threshold: classified.opensCircuit ? 1 : circuitThreshold,
        nextProbeAt: iso(parseTimestamp(timestamp) + circuitCooldownMs)
      })));
      return Object.freeze(state);
    },

    async success({ originId, now, auditEventId = null, remediationEvidenceRefId = null }) {
      const timestamp = iso(parseTimestamp(now));
      const state = await withFreshDatabaseClient(openDatabase, database => database.transaction('origin-circuit-success', async transaction => {
        const closed = await transaction.recordCircuitSuccess({ originId, observedAt: timestamp });
        if (closed.previous_state !== 'closed') {
          invariant(typeof auditEventId === 'string' && auditEventId.length > 0, 'CIRCUIT_CLOSE_AUDIT_REQUIRED', originId);
          await transaction.appendAudit({
            auditEventId, action: 'origin_circuit_closed', originId, remediationEvidenceRefId,
            reasonCode: closed.previous_state === 'half_open' ? 'HALF_OPEN_PROBE_SUCCEEDED' : 'AUDITED_REMEDIATION', recordedAt: timestamp
          });
        }
        return closed;
      }));
      return Object.freeze(state);
    }
  });
}
