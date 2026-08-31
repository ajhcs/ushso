import { invariant, iso, parseTimestamp } from './common.mjs';
import { assertControlStore, withFreshDatabaseClient } from './ports.mjs';
import { createNullLogger } from './redaction.mjs';

export function createSourceControlService({ openDatabase, logger = createNullLogger() }) {
  invariant(typeof openDatabase === 'function', 'OPEN_DATABASE_PORT_MISSING');
  return Object.freeze({
    async requestPause({ sourceId, auditEventId, requestedAt, reasonCode }) {
      const timestamp = iso(parseTimestamp(requestedAt));
      const result = await withFreshDatabaseClient(openDatabase, async database => {
        assertControlStore(database);
        return database.transaction('source-pause-request', async transaction => {
          await transaction.appendAudit({ auditEventId, action: 'source_pause_requested', sourceId, reasonCode, recordedAt: timestamp });
          return transaction.requestSourcePause({ sourceId, auditEventId, requestedAt: timestamp, reasonCode });
        });
      });
      logger.emit({ level: 'warn', event: 'source.pause_requested', timestamp, source_id: sourceId, state: result.state, safe_detail_code: reasonCode });
      return Object.freeze(result);
    },

    async drain({ sourceId, auditEventId, now, reledger = true, leaseAbandonmentGraceMs = 5 * 60 * 1000 }) {
      const timestamp = iso(parseTimestamp(now));
      const result = await withFreshDatabaseClient(openDatabase, async database => database.transaction('source-drain', async transaction => {
        const drained = await transaction.drainSource({ sourceId, reledger, now: timestamp, leaseAbandonmentGraceMs });
        await transaction.appendAudit({
          auditEventId, action: drained.state === 'paused' ? 'source_pause_effective' : 'source_drain_progress',
          sourceId, reasonCode: drained.state.toUpperCase(), recordedAt: timestamp,
          inFlightWorkCount: drained.in_flight_work_count, durablyReledgeredWorkCount: drained.durably_reledgered_work_count
        });
        return drained;
      }));
      logger.emit({ level: 'info', event: 'source.drain_reconciled', timestamp, source_id: sourceId, state: result.state, count: result.in_flight_work_count });
      return Object.freeze(result);
    },

    async resume({ sourceId, auditEventId, resumedAt, configurationRevision, remediationEvidenceRefId = null, connectorVersion = null }) {
      const timestamp = iso(parseTimestamp(resumedAt));
      invariant(Number.isInteger(configurationRevision) && configurationRevision >= 1, 'SOURCE_CONFIGURATION_REVISION_INVALID');
      const result = await withFreshDatabaseClient(openDatabase, async database => database.transaction('source-resume', async transaction => {
        const resumed = await transaction.resumeSource({
          sourceId, auditEventId, resumedAt: timestamp, configurationRevision, remediationEvidenceRefId, connectorVersion
        });
        await transaction.appendAudit({
          auditEventId, action: 'source_resumed', sourceId, configurationRevision, remediationEvidenceRefId, connectorVersion,
          reasonCode: 'DRAIN_RECONCILED_AND_CONFIGURATION_ADVANCED', recordedAt: timestamp
        });
        return resumed;
      }));
      logger.emit({ level: 'warn', event: 'source.resumed', timestamp, source_id: sourceId, state: result.state, safe_detail_code: 'AUDITED_RESUME' });
      return Object.freeze(result);
    },

    async assertFetchAllowed({ sourceId }) {
      const allowed = await withFreshDatabaseClient(openDatabase, database => database.canSourceFetch({ sourceId }));
      invariant(allowed === true, 'SOURCE_FETCH_BLOCKED', sourceId);
      return true;
    }
  });
}
