import { invariant } from '../../packages/ingestion/src/common.mjs';

export function createSchedulerWorker({ scheduler, workflowStartReconciler, queueRetentionReconciler, deadLetterRecoveryReconciler, outboxDispatcher, clock, logger = { emit() {} } }) {
  invariant(typeof scheduler?.dispatchScheduledSlot === 'function', 'SCHEDULER_SERVICE_MISSING');
  invariant(typeof workflowStartReconciler?.reconcile === 'function', 'WORKFLOW_RECONCILER_MISSING');
  invariant(typeof queueRetentionReconciler?.reconcile === 'function', 'QUEUE_RETENTION_RECONCILER_MISSING');
  invariant(typeof deadLetterRecoveryReconciler?.reconcile === 'function', 'DLQ_RECOVERY_RECONCILER_MISSING');
  invariant(typeof outboxDispatcher?.dispatch === 'function', 'OUTBOX_DISPATCHER_MISSING');
  invariant(typeof clock === 'function', 'OPERATIONAL_CLOCK_MISSING');
  return Object.freeze({
    async scheduled(controller) {
      invariant(Number.isFinite(controller?.scheduledTime), 'SCHEDULED_TIME_MISSING');
      const now = clock(controller.scheduledTime);
      invariant(typeof now === 'string', 'SCHEDULER_CLOCK_INVALID');
      const isolate = async (phase, operation) => {
        try { return await operation(); }
        catch (error) {
          logger.emit({ level: 'error', event: 'scheduler.phase_failed', timestamp: now, outcome: 'retry_on_next_cron', safe_detail_code: error.code ?? 'SCHEDULER_PHASE_FAILED', state: phase, count: 1 });
          return Object.freeze({ failed: true, phase, code: error.code ?? 'SCHEDULER_PHASE_FAILED' });
        }
      };
      const scheduled = await isolate('schedule', () => scheduler.dispatchScheduledSlot({ scheduledTime: controller.scheduledTime, now, cron: controller.cron, traceId: `trace_cron_${controller.scheduledTime}` }));
      const workflows = await isolate('workflow_reconcile', () => workflowStartReconciler.reconcile({ now, traceId: `trace_workflow_${controller.scheduledTime}` }));
      const deadLetterRecovery = await isolate('dead_letter_recovery', () => deadLetterRecoveryReconciler.reconcile());
      // Durable-incident reconstruction owns the exact retention boundary.
      // It must run before ordinary Queue re-ledgering so a platform-DLQ sink
      // exhaustion cannot be mistaken for an expired work delivery.
      const queueRetention = await isolate('queue_retention', () => queueRetentionReconciler.reconcile({ now }));
      const outbox = await isolate('outbox_dispatch', () => outboxDispatcher.dispatch({ now, ownerId: `dispatcher_${controller.scheduledTime}`, traceId: `trace_outbox_${controller.scheduledTime}` }));
      return Object.freeze({ scheduled, workflows, queueRetention, deadLetterRecovery, outbox, completedAt: now });
    }
  });
}
