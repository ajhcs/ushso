import { deterministicOpaqueId, iso, invariant, parseTimestamp } from './common.mjs';
import { assertControlStore, withFreshDatabaseClient } from './ports.mjs';
import { createNullLogger } from './redaction.mjs';

export function runIdempotencyKey({ endpointId, scheduledSlot, mode, configurationRevision }) {
  return `run:${endpointId}:${scheduledSlot}:${mode}:r${configurationRevision}`;
}

export function workflowInstanceId(runId, attempt) {
  invariant(Number.isInteger(attempt) && attempt >= 1, 'WORKFLOW_ATTEMPT_INVALID');
  const id = `harvest-${runId}-${attempt}`;
  invariant(id.length <= 100 && /^[A-Za-z0-9_][A-Za-z0-9-_]*$/.test(id), 'WORKFLOW_INSTANCE_ID_PLATFORM_UNSAFE', id);
  return id;
}

export async function deterministicRunId(input) {
  return deterministicOpaqueId('run', input);
}

export function createScheduler({ openDatabase, logger = createNullLogger(), configuration = {} }) {
  invariant(typeof openDatabase === 'function', 'OPEN_DATABASE_PORT_MISSING');
  const leaseDurationMs = configuration.leaseDurationMs ?? 60_000;
  const sourceLimit = configuration.sourceLimit ?? 100;
  const mode = configuration.mode ?? 'incremental';
  const workflowRetentionMs = configuration.workflowRetentionMs ?? 30 * 24 * 60 * 60 * 1000;
  const runDeadlineMs = configuration.runDeadlineMs ?? 24 * 60 * 60 * 1000;
  const barrierPolicy = Object.freeze({
    policyVersion: configuration.barrierPolicyVersion ?? 'barrier.v1',
    pollDelayMs: configuration.barrierPollDelayMs ?? 60_000,
    maximumChecks: configuration.maximumBarrierChecks ?? 1600,
    workflowStepBudget: configuration.workflowStepBudget ?? 10_000
  });
  invariant(runDeadlineMs > 0 && barrierPolicy.pollDelayMs >= 1_000 && barrierPolicy.maximumChecks >= 1 && barrierPolicy.maximumChecks * 6 + 8 <= barrierPolicy.workflowStepBudget, 'SCHEDULER_RUN_POLICY_INVALID');
  const killSwitch = configuration.killSwitch ?? (() => false);

  return Object.freeze({
    async dispatchScheduledSlot({ scheduledTime, now = scheduledTime, cron = 'dispatcher', traceId = 'trace_scheduler' }) {
      const slotMs = parseTimestamp(scheduledTime);
      const operationNowMs = parseTimestamp(now);
      const scheduledSlot = iso(slotMs);
      if (await killSwitch()) {
        logger.emit({ level: 'warn', event: 'scheduler.kill_switch', timestamp: scheduledSlot, trace_id: traceId, scheduled_slot: scheduledSlot, count: 0 });
        return Object.freeze({ scheduledSlot, leased: 0, created: 0, duplicates: 0, killed: true, runs: [] });
      }
      const leaseOwner = await deterministicOpaqueId('scheduler', { cron, scheduledSlot });
      const due = await withFreshDatabaseClient(openDatabase, async database => {
        assertControlStore(database);
        return database.transaction('scheduler-lease-due', transaction => transaction.leaseDueSources({
          scheduledSlot, leaseAcquiredAt: iso(operationNowMs), leaseOwner, leaseExpiresAt: iso(operationNowMs + leaseDurationMs), limit: sourceLimit
        }));
      });
      const runs = [];
      for (const source of due) {
        try {
          invariant(source.schedule_error_code === null, source.schedule_error_code ?? 'SOURCE_SCHEDULE_INVALID', source.source_id);
          const run = await withFreshDatabaseClient(openDatabase, async database => {
            assertControlStore(database);
            return database.transaction('scheduler-source', async transaction => {
              const keyInput = {
                endpointId: source.endpoint_id,
                scheduledSlot,
                mode: source.mode ?? mode,
                configurationRevision: source.configuration_revision
              };
              const idempotencyKey = runIdempotencyKey(keyInput);
              const runId = await deterministicRunId(keyInput);
              const attempt = 1;
              const instanceId = workflowInstanceId(runId, attempt);
              const ensured = await transaction.ensureRunAndWorkflowOutbox({
                sourceId: source.source_id,
                sourceLeaseToken: source.source_lease_token,
                scopeIds: source.scope_ids,
                endpointId: source.endpoint_id,
                configurationRevision: source.configuration_revision,
                scheduledSlot,
                mode: keyInput.mode,
                runId,
                runIdempotencyKey: idempotencyKey,
                activeAttempt: attempt,
                workflowInstanceId: instanceId,
                workflowVersion: configuration.workflowVersion ?? '1.0.0',
                workflowRetentionExpiresAt: iso(slotMs + workflowRetentionMs),
                deadlineAt: iso(slotMs + runDeadlineMs),
                barrierPolicy,
                optionalDegradationPolicy: source.optional_degradation_policy ?? [],
                traceId
              });
              return Object.freeze({ runId, workflowInstanceId: instanceId, created: ensured.created, sourceId: source.source_id });
            });
          });
          runs.push(run);
        } catch (error) {
          const reasonCode = error.code ?? 'SOURCE_SCHEDULE_DISPATCH_FAILED';
          const quarantine = ['SOURCE_SCOPE_POLICY_REVISION_MISMATCH', 'SOURCE_CONFIGURATION_REVISION_MISMATCH'].includes(reasonCode);
          await withFreshDatabaseClient(openDatabase, async database => {
            assertControlStore(database);
            return database.transaction('scheduler-source-failure', transaction => transaction.recordScheduleDispatchFailure({
              sourceId: source.source_id, sourceLeaseToken: source.source_lease_token, scopeIds: source.scope_ids,
              scheduledSlot, reasonCode, quarantine
            }));
          });
          logger.emit({ level: 'error', event: 'scheduler.source_failed', timestamp: scheduledSlot, trace_id: traceId, source_id: source.source_id, outcome: quarantine ? 'quarantined' : 'retry_next_cron', safe_detail_code: reasonCode, count: 1 });
          runs.push(Object.freeze({ runId: null, workflowInstanceId: null, created: false, sourceId: source.source_id, failed: true, quarantined: quarantine, reasonCode }));
        }
      }
      const successful = runs.filter(run => !run.failed);
      const created = successful.filter(run => run.created).length;
      logger.emit({ level: 'info', event: 'scheduler.slot_complete', timestamp: scheduledSlot, trace_id: traceId, scheduled_slot: scheduledSlot, count: runs.length, duplicate: created !== successful.length });
      return Object.freeze({ scheduledSlot, leased: runs.length, created, duplicates: successful.length - created, failed: runs.length - successful.length, killed: false, runs });
    }
  });
}
