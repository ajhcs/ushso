import { iso, invariant, parseTimestamp } from './common.mjs';
import { assertControlStore, assertWorkflowPlatform, withFreshDatabaseClient } from './ports.mjs';
import { createNullLogger } from './redaction.mjs';

const WORKFLOW_PLATFORM_STATE = Object.freeze({
  queued: 'requested', running: 'running', paused: 'waiting', waiting: 'waiting',
  waitingForPause: 'waiting', complete: 'complete', errored: 'errored',
  terminated: 'errored', unknown: 'unknown', requested: 'requested'
});

export function normalizeWorkflowPlatformState(value) {
  invariant(typeof value === 'string' && WORKFLOW_PLATFORM_STATE[value], 'WORKFLOW_PLATFORM_STATE_UNKNOWN', String(value));
  return WORKFLOW_PLATFORM_STATE[value];
}

export function createWorkflowStartReconciler({ openDatabase, workflowPlatform, logger = createNullLogger(), configuration = {} }) {
  invariant(typeof openDatabase === 'function', 'OPEN_DATABASE_PORT_MISSING');
  assertWorkflowPlatform(workflowPlatform);
  invariant(typeof configuration.clock === 'function', 'OPERATIONAL_CLOCK_MISSING');
  const limit = configuration.batchSize ?? 100;
  const retryDelayMs = configuration.retryDelayMs ?? 30_000;

  function operationTime() {
    return iso(parseTimestamp(configuration.clock()));
  }

  return Object.freeze({
    async reconcile({ now, traceId = 'trace_workflow_reconcile' }) {
      parseTimestamp(now);
      const scanNow = operationTime();
      const nowMs = parseTimestamp(scanNow);
      const results = [];
      const retentionRisks = await withFreshDatabaseClient(openDatabase, async database => {
        assertControlStore(database);
        return database.transaction('workflow-retention-scan', transaction => transaction.listWorkflowRetentionRisks({ now: iso(nowMs), limit }));
      });
      for (const run of retentionRisks) {
        await withFreshDatabaseClient(openDatabase, database => database.transaction('workflow-mapping-retention-expired', transaction => transaction.failRunForExpiredWorkflow({
          runId: run.run_id, attempt: run.active_attempt, reconciledAt: iso(nowMs), auditReason: 'WORKFLOW_HISTORY_RETENTION_EXPIRED'
        })));
        results.push({ runId: run.run_id, outcome: 'retention_expired' });
      }
      const activeMappings = await withFreshDatabaseClient(openDatabase, async database => {
        assertControlStore(database);
        return database.listActiveWorkflowMappings({ limit });
      });
      for (const mapping of activeMappings) {
        try {
          const instance = await workflowPlatform.get(mapping.workflow_instance_id);
          const rawPlatformState = instance.raw_status ?? instance.status ?? 'unknown';
          const platformState = normalizeWorkflowPlatformState(rawPlatformState);
          const observedAt = operationTime();
          if (['errored', 'terminated', 'complete'].includes(platformState)) {
            const reasonCode = platformState === 'complete'
              ? 'WORKFLOW_COMPLETED_WITH_NONTERMINAL_RUN'
              : `WORKFLOW_PLATFORM_${rawPlatformState.toUpperCase()}`;
            await withFreshDatabaseClient(openDatabase, database => database.transaction('workflow-platform-terminal', transaction => transaction.failRunForWorkflowControl({
              runId: mapping.run_id, attempt: mapping.attempt, failedAt: observedAt,
              reasonCode, auditAction: 'workflow_platform_terminal_reconciled', mappingPlatformState: platformState
            })));
            logger.emit({
              level: 'error', event: 'workflow.platform_terminal_reconciled', timestamp: observedAt,
              run_id: mapping.run_id, workflow_instance_id: mapping.workflow_instance_id,
              outcome: 'failed', safe_detail_code: reasonCode, count: 1
            });
            results.push({ runId: mapping.run_id, outcome: 'platform_terminal', platformState, rawPlatformState });
          } else {
            await withFreshDatabaseClient(openDatabase, database => database.transaction('workflow-platform-state', transaction => transaction.updateWorkflowMappingState({
              runId: mapping.run_id, attempt: mapping.attempt, workflowInstanceId: mapping.workflow_instance_id,
              platformState, observedAt
            })));
          }
        } catch (error) {
          logger.emit({
            level: 'warn', event: 'workflow.platform_status_unavailable', timestamp: operationTime(),
            run_id: mapping.run_id, workflow_instance_id: mapping.workflow_instance_id,
            outcome: 'retry_on_next_reconcile', safe_detail_code: error.code ?? 'WORKFLOW_STATUS_UNAVAILABLE', count: 1
          });
        }
      }
      const starts = await withFreshDatabaseClient(openDatabase, async database => {
        assertControlStore(database);
        return database.transaction('workflow-start-lease', transaction => transaction.getWorkflowStart({ now: iso(nowMs), limit }));
      });
      for (const start of starts) {
        try {
        let operationNow = operationTime();
        let run = await withFreshDatabaseClient(openDatabase, database => database.loadRunForWorkflow({ runId: start.run_id, attempt: start.attempt }));
        if (!run || run.terminal_at !== null) {
          await withFreshDatabaseClient(openDatabase, database => database.transaction('workflow-start-terminal', transaction => transaction.markWorkflowStartDead({
            eventId: start.event_id, workflowInstanceId: start.workflow_instance_id, leaseToken: start.lease_token,
            failedAt: operationNow, safeDetailCode: run ? 'RUN_ALREADY_TERMINAL' : 'RUN_NOT_FOUND'
          })));
          results.push({ runId: start.run_id, outcome: 'terminal_or_missing' });
          continue;
        }
        if (parseTimestamp(operationNow) >= parseTimestamp(run.deadline_at)) {
          await withFreshDatabaseClient(openDatabase, database => database.transaction('workflow-deadline-expired-before-start', transaction => transaction.failRunForWorkflowControl({
            runId: run.run_id, attempt: start.attempt, failedAt: operationNow,
            reasonCode: 'RUN_DEADLINE_EXPIRED_BEFORE_WORKFLOW_START', auditAction: 'workflow_start_deadline_rejected'
          })));
          logger.emit({ level: 'error', event: 'workflow.start_deadline_rejected', timestamp: operationNow, trace_id: run.trace_id ?? traceId, run_id: run.run_id, workflow_instance_id: start.workflow_instance_id, outcome: 'failed' });
          results.push({ runId: run.run_id, outcome: 'deadline_expired' });
          continue;
        }
        const retentionExpiry = parseTimestamp(run.workflow_retention_expires_at);
        if (parseTimestamp(operationNow) >= retentionExpiry) {
          await withFreshDatabaseClient(openDatabase, database => database.transaction('workflow-retention-expired', async transaction => {
            await transaction.failRunForExpiredWorkflow({ runId: run.run_id, attempt: start.attempt, reconciledAt: operationNow, auditReason: 'WORKFLOW_HISTORY_RETENTION_EXPIRED' });
          }));
          logger.emit({ level: 'error', event: 'workflow.retention_expired', timestamp: operationNow, trace_id: run.trace_id ?? traceId, run_id: run.run_id, workflow_instance_id: start.workflow_instance_id, outcome: 'failed' });
          results.push({ runId: run.run_id, outcome: 'retention_expired' });
          continue;
        }
        let instance;
        try {
          // Re-check authoritative DB state immediately before each platform
          // operation. The deterministic ID is never replaced by a new one.
          run = await withFreshDatabaseClient(openDatabase, database => database.loadRunForWorkflow({ runId: start.run_id, attempt: start.attempt }));
          operationNow = operationTime();
          invariant(run && run.terminal_at === null &&
            parseTimestamp(operationNow) < parseTimestamp(run.workflow_retention_expires_at) &&
            parseTimestamp(operationNow) < parseTimestamp(run.deadline_at), 'WORKFLOW_CREATE_DB_FENCE_REJECTED');
          instance = await workflowPlatform.create({
            id: start.workflow_instance_id,
            params: {
              runId: start.run_id, attempt: start.attempt, deadlineAt: run.deadline_at,
              workflowVersion: run.workflow_version,
              barrierPolicy: run.barrier_policy
            },
            retentionExpiresAt: run.workflow_retention_expires_at,
            requestedAt: operationNow
          });
        } catch (error) {
          // A rejected create can still be an unknown-after-create outcome at
          // the network/platform boundary. Always reconcile the deterministic
          // ID with get() before deciding to retry.
          try {
            run = await withFreshDatabaseClient(openDatabase, database => database.loadRunForWorkflow({ runId: start.run_id, attempt: start.attempt }));
            operationNow = operationTime();
            invariant(run && run.terminal_at === null &&
              parseTimestamp(operationNow) < parseTimestamp(run.workflow_retention_expires_at) &&
              parseTimestamp(operationNow) < parseTimestamp(run.deadline_at), 'WORKFLOW_GET_DB_FENCE_REJECTED');
            instance = await workflowPlatform.get(start.workflow_instance_id);
          }
          catch (getError) {
            if (run && parseTimestamp(operationNow) >= parseTimestamp(run.workflow_retention_expires_at)) {
              await withFreshDatabaseClient(openDatabase, database => database.transaction('workflow-create-get-retention-expired', async transaction => {
                await transaction.failRunForExpiredWorkflow({ runId: run.run_id, attempt: start.attempt, reconciledAt: operationNow, auditReason: 'WORKFLOW_HISTORY_RETENTION_EXPIRED' });
              }));
              logger.emit({ level: 'error', event: 'workflow.retention_expired', timestamp: operationNow, trace_id: run.trace_id ?? traceId, run_id: run.run_id, workflow_instance_id: start.workflow_instance_id, outcome: 'failed' });
              results.push({ runId: run.run_id, outcome: 'retention_expired' });
              continue;
            }
            if (run && parseTimestamp(operationNow) >= parseTimestamp(run.deadline_at)) {
              await withFreshDatabaseClient(openDatabase, database => database.transaction('workflow-create-get-deadline-expired', transaction => transaction.failRunForWorkflowControl({
                runId: run.run_id, attempt: start.attempt, failedAt: operationNow,
                reasonCode: 'RUN_DEADLINE_EXPIRED_DURING_WORKFLOW_START', auditAction: 'workflow_start_deadline_rejected'
              })));
              results.push({ runId: run.run_id, outcome: 'deadline_expired' });
              continue;
            }
            if (start.attempt_count >= start.maximum_delivery_attempts) {
              await withFreshDatabaseClient(openDatabase, database => database.transaction('workflow-start-budget-exhausted', transaction => transaction.failRunForWorkflowControl({
                runId: run.run_id, attempt: start.attempt, failedAt: operationNow,
                reasonCode: 'WORKFLOW_START_ATTEMPT_BUDGET_EXHAUSTED', auditAction: 'workflow_start_budget_exhausted'
              })));
              results.push({ runId: run.run_id, outcome: 'start_budget_exhausted', code: error.code ?? getError.code ?? 'WORKFLOW_CREATE_OR_GET_FAILED' });
            } else {
              await withFreshDatabaseClient(openDatabase, database => database.transaction('workflow-get-retry', transaction => transaction.markOutboxRetry({
                eventId: start.event_id, leaseToken: start.lease_token, nextEligibleAt: iso(parseTimestamp(operationNow) + retryDelayMs), safeDetailCode: error.code ?? getError.code ?? 'WORKFLOW_CREATE_OR_GET_FAILED'
              })));
              results.push({ runId: run.run_id, outcome: 'unknown_create_unresolved', code: error.code ?? getError.code ?? 'WORKFLOW_CREATE_OR_GET_FAILED' });
            }
            continue;
          }
        }
        operationNow = operationTime();
        await withFreshDatabaseClient(openDatabase, database => database.transaction('workflow-start-resolve', async transaction => {
          const finalRun = await transaction.loadRunForWorkflow({ runId: run.run_id, attempt: start.attempt });
          invariant(finalRun, 'WORKFLOW_RESOLVE_DB_FENCE_REJECTED');
          const normalizedInstanceState = normalizeWorkflowPlatformState(instance.raw_status ?? instance.status ?? 'unknown');
          if (finalRun.terminal_at === null) invariant(
            parseTimestamp(operationNow) < parseTimestamp(finalRun.workflow_retention_expires_at) &&
            parseTimestamp(operationNow) < parseTimestamp(finalRun.deadline_at), 'WORKFLOW_RESOLVE_DB_FENCE_REJECTED'
          );
          if (finalRun.terminal_at === null && ['complete', 'errored'].includes(normalizedInstanceState)) {
            await transaction.recordWorkflowMapping({
              runId: run.run_id, attempt: start.attempt, workflowInstanceId: start.workflow_instance_id,
              workflowVersion: run.workflow_version, platformState: 'running', recordedAt: operationNow,
              terminalAt: null
            });
            await transaction.failRunForWorkflowControl({
              runId: run.run_id, attempt: start.attempt, failedAt: operationNow,
              reasonCode: normalizedInstanceState === 'complete'
                ? 'WORKFLOW_COMPLETED_WITH_NONTERMINAL_RUN'
                : `WORKFLOW_PLATFORM_${(instance.raw_status ?? 'errored').toUpperCase()}`,
              auditAction: 'workflow_platform_terminal_on_create', mappingPlatformState: normalizedInstanceState,
              preserveWorkflowStartEvent: true
            });
          } else {
            const terminalPlatformState = finalRun.terminal_at === null ? normalizedInstanceState
              : ['failed', 'cancelled'].includes(finalRun.state) ? 'errored' : 'complete';
            await transaction.recordWorkflowMapping({
              runId: run.run_id, attempt: start.attempt, workflowInstanceId: start.workflow_instance_id,
              workflowVersion: run.workflow_version, platformState: terminalPlatformState, recordedAt: operationNow,
              terminalAt: finalRun.terminal_at
            });
          }
          await transaction.markWorkflowStartResolved({ eventId: start.event_id, workflowInstanceId: start.workflow_instance_id, leaseToken: start.lease_token, resolvedAt: operationNow });
        }));
        logger.emit({ level: 'info', event: 'workflow.start_reconciled', timestamp: operationNow, trace_id: run.trace_id ?? traceId, run_id: run.run_id, workflow_instance_id: start.workflow_instance_id, outcome: normalizeWorkflowPlatformState(instance.raw_status ?? instance.status ?? 'unknown') });
        results.push({ runId: run.run_id, outcome: 'resolved', workflowInstanceId: start.workflow_instance_id });
        } catch (error) {
          const recoveredAt = operationTime();
          let currentRun = null;
          try { currentRun = await withFreshDatabaseClient(openDatabase, database => database.loadRunForWorkflow({ runId: start.run_id, attempt: start.attempt })); }
          catch { /* the fenced recovery below will remain retryable */ }
          try {
            await withFreshDatabaseClient(openDatabase, database => database.transaction('workflow-start-fence-recovery', async transaction => {
              if (!currentRun || currentRun.terminal_at !== null) {
                await transaction.markWorkflowStartDead({
                  eventId: start.event_id, workflowInstanceId: start.workflow_instance_id, leaseToken: start.lease_token,
                  failedAt: recoveredAt, safeDetailCode: currentRun ? 'RUN_ALREADY_TERMINAL' : 'RUN_NOT_FOUND'
                });
              } else if (parseTimestamp(recoveredAt) >= parseTimestamp(currentRun.workflow_retention_expires_at)) {
                await transaction.failRunForExpiredWorkflow({ runId: currentRun.run_id, attempt: start.attempt, reconciledAt: recoveredAt, auditReason: 'WORKFLOW_HISTORY_RETENTION_EXPIRED' });
              } else if (parseTimestamp(recoveredAt) >= parseTimestamp(currentRun.deadline_at)) {
                await transaction.failRunForWorkflowControl({
                  runId: currentRun.run_id, attempt: start.attempt, failedAt: recoveredAt,
                  reasonCode: 'RUN_DEADLINE_EXPIRED_DURING_WORKFLOW_START', auditAction: 'workflow_start_deadline_rejected'
                });
              } else if (start.attempt_count >= start.maximum_delivery_attempts) {
                await transaction.failRunForWorkflowControl({
                  runId: currentRun.run_id, attempt: start.attempt, failedAt: recoveredAt,
                  reasonCode: 'WORKFLOW_START_ATTEMPT_BUDGET_EXHAUSTED', auditAction: 'workflow_start_budget_exhausted'
                });
              } else {
                await transaction.markOutboxRetry({
                  eventId: start.event_id, leaseToken: start.lease_token,
                  nextEligibleAt: iso(parseTimestamp(recoveredAt) + retryDelayMs), safeDetailCode: error.code ?? 'WORKFLOW_RECONCILIATION_FAILED'
                });
              }
            }));
          } catch { /* lease loss means another fenced reconciler owns recovery */ }
          results.push({ runId: start.run_id, outcome: 'fenced_recovery', code: error.code ?? 'WORKFLOW_RECONCILIATION_FAILED' });
        }
      }
      return Object.freeze(results.map(Object.freeze));
    }
  });
}
