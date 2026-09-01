import assert from 'node:assert/strict';
import test from 'node:test';
import schedulerDefault, { createSchedulerWorkerEntrypoint } from '../../../../services/scheduler-worker/worker.mjs';
import harvestDefault, {
  createHarvestWorkerEntrypoint,
  createHarvestWorkflowClass,
} from '../../../../services/harvest-worker/worker.mjs';

test('WP4 scheduler entrypoint adapts the Cloudflare event without resolving bindings', async () => {
  const calls = [];
  const entrypoint = createSchedulerWorkerEntrypoint({
    clock: () => '2026-08-30T00:00:05.000Z',
    scheduler: { async dispatchScheduledSlot(input) { calls.push(['schedule', input]); return { ok: true }; } },
    workflowStartReconciler: { async reconcile(input) { calls.push(['workflow', input]); return []; } },
    queueRetentionReconciler: { async reconcile(input) { calls.push(['retention', input]); return []; } },
    deadLetterRecoveryReconciler: { async reconcile(input) { calls.push(['dlq', input]); return []; } },
    outboxDispatcher: { async dispatch(input) { calls.push(['outbox', input]); return []; } },
  });

  const result = await entrypoint.scheduled({ scheduled: Date.parse('2026-08-30T00:00:00.000Z'), cron: '*/5 * * * *' });
  assert.equal(result.completedAt, '2026-08-30T00:00:05.000Z');
  assert.equal(calls[0][1].scheduledTime, Date.parse('2026-08-30T00:00:00.000Z'));
  assert.equal(calls[0][1].cron, '*/5 * * * *');
  assert.throws(() => createSchedulerWorkerEntrypoint({
    clock: () => '2026-08-30T00:00:00.000Z',
    scheduler: {},
    workflowStartReconciler: {},
    queueRetentionReconciler: {},
    deadLetterRecoveryReconciler: {},
    outboxDispatcher: {},
  }), /SCHEDULER_SERVICE_MISSING/);
});

test('WP4 harvest entrypoint routes a Queue batch through injected consumers', async () => {
  const message = { body: { event_id: 'event_fixture' }, retry() { this.action = 'retry'; }, ack() { this.action = 'ack'; } };
  const entrypoint = createHarvestWorkerEntrypoint({
    queueConsumers: {
      'normalize-record': { async handleBatch(batch) { batch.messages[0].ack(); return ['handled']; } },
    },
  });
  assert.deepEqual(await entrypoint.queue({ queue: 'normalize-record', messages: [message] }), ['handled']);
  assert.equal(message.action, 'ack');
});

test('disabled foundation defaults fail closed and expose only the authorized Workflow factory', async () => {
  await assert.rejects(schedulerDefault.scheduled({}), /WP4_SCHEDULER_COMPOSITION_DISABLED/);

  const message = { body: { event_id: 'event_disabled' }, retry(options) { this.options = options; } };
  assert.deepEqual(await harvestDefault.queue({ messages: [message] }), [{
    eventId: 'event_disabled', action: 'retry', reason: 'WP4_HARVEST_COMPOSITION_DISABLED',
  }]);
  assert.deepEqual(message.options, { delaySeconds: 60 });

  class WorkflowBase {}
  const Workflow = createHarvestWorkflowClass({
    WorkflowEntrypointBase: WorkflowBase,
    workflow: { async run() { return { status: 'fixture' }; } },
  });
  assert.equal(typeof Workflow, 'function');
  assert.ok(Workflow.prototype instanceof WorkflowBase);
});
