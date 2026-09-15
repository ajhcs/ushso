import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LAST_GOOD_GENERATION,
  SOURCE_REFRESH_SCHEDULES,
  schedulesFitBudgets,
  sourceFreshness,
} from '../schedules.mjs';
import { createSchedulerWorkerEntrypoint } from '../worker.mjs';
import schedulerDefault from '../worker.mjs';

test('refresh schedules fit selected source/spend budgets and keep stale sources visible without collector success', () => {
  assert.equal(schedulesFitBudgets(), true);
  assert.equal(LAST_GOOD_GENERATION, 'live-2026-09-03-85b50522b420');
  for (const schedule of SOURCE_REFRESH_SCHEDULES) {
    const freshness = sourceFreshness(schedule, { now: Date.parse('2026-09-15T00:00:00Z') });
    assert.equal(freshness.stale, true);
    assert.equal(freshness.collector_success, false);
    assert.equal(freshness.visible_without_collector_success, true);
    assert.equal(freshness.last_success_at, null);
  }
});

test('checked-in scheduler default export remains disabled and merging config does not enable a timer', async () => {
  await assert.rejects(() => schedulerDefault.scheduled({ scheduledTime: Date.parse('2026-09-15T00:00:00Z') }), /WP4_SCHEDULER_COMPOSITION_DISABLED/);
  const entry = createSchedulerWorkerEntrypoint({
    scheduler: { async dispatchScheduledSlot() { return { ok: true }; } },
    workflowStartReconciler: { async reconcile() { return { ok: true }; } },
    queueRetentionReconciler: { async reconcile() { return { ok: true }; } },
    deadLetterRecoveryReconciler: { async reconcile() { return { ok: true }; } },
    outboxDispatcher: { async dispatch() { return { ok: true }; } },
    clock: (scheduledTime) => new Date(scheduledTime).toISOString(),
  });
  const result = await entry.scheduled({ scheduledTime: Date.parse('2026-09-15T00:00:00Z'), cron: '*/5 * * * *' });
  assert.equal(result.scheduled.ok, true);
});
