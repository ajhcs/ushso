import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyAndScheduleRetry,
  createSourceBudget,
  GLOBAL_BUDGET_CAPS,
  resolveSourceLimits,
  utcDayPeriod,
} from '../../packages/ingestion/src/source-budget.mjs';
import { STAGE_POLICIES } from '../../packages/ingestion/src/failure-policy.mjs';
import disabledScheduler, { createSchedulerWorkerEntrypoint } from '../../services/scheduler-worker/worker.mjs';

function clockAt(iso) {
  return () => iso;
}

test('UTC day period ignores local timezone offset', () => {
  assert.equal(utcDayPeriod('2026-09-14T00:00:00.000Z'), '2026-09-14');
  assert.equal(utcDayPeriod('2026-09-14T23:59:59.000Z'), '2026-09-14');
  assert.equal(utcDayPeriod('2026-09-15T00:00:00.000Z'), '2026-09-15');
});

test('source overrides cannot exceed global caps', () => {
  assert.throws(
    () => resolveSourceLimits({
      sourceId: 'source_a',
      overrides: { source_a: { daily_request_limit: GLOBAL_BUDGET_CAPS.daily_request_limit + 1 } },
    }),
    { code: 'SOURCE_DAILY_REQUEST_LIMIT_EXCEEDS_GLOBAL' }
  );
  const limits = resolveSourceLimits({
    sourceId: 'source_a',
    overrides: { source_a: { daily_request_limit: 3, host_concurrency: 1 } },
  });
  assert.equal(limits.daily_request_limit, 3);
  assert.equal(limits.host_concurrency, 1);
});

test('two concurrent workers cannot both spend the last daily request', async () => {
  const budget = createSourceBudget({
    clock: clockAt('2026-09-14T12:00:00.000Z'),
    overrides: { source_a: { daily_request_limit: 1, daily_byte_limit: 1000, host_concurrency: 2 } },
  });
  const [first, second] = await Promise.all([
    budget.reserve({ sourceId: 'source_a', host: 'catalog.example.gov', requests: 1 }),
    budget.reserve({ sourceId: 'source_a', host: 'catalog.example.gov', requests: 1 }),
  ]);
  const allowed = [first, second].filter((result) => result.allowed);
  const denied = [first, second].filter((result) => !result.allowed);
  assert.equal(allowed.length, 1);
  assert.equal(denied.length, 1);
  assert.equal(denied[0].reason, 'BUDGET_EXHAUSTED');
  assert.equal(denied[0].status, 'incomplete');
  assert.equal(denied[0].remaining_requests, 0);
});

test('two concurrent workers cannot both spend the last daily bytes', async () => {
  const budget = createSourceBudget({
    clock: clockAt('2026-09-14T12:00:00.000Z'),
    overrides: { source_a: { daily_request_limit: 10, daily_byte_limit: 100, host_concurrency: 2 } },
  });
  const [first, second] = await Promise.all([
    budget.reserve({ sourceId: 'source_a', host: 'catalog.example.gov', bytes: 100 }),
    budget.reserve({ sourceId: 'source_a', host: 'catalog.example.gov', bytes: 100 }),
  ]);
  const allowed = [first, second].filter((result) => result.allowed);
  assert.equal(allowed.length, 1);
  assert.equal([first, second].find((result) => !result.allowed).reason, 'BUDGET_EXHAUSTED');
});

test('cancellation releases only unused reservations', async () => {
  const budget = createSourceBudget({
    clock: clockAt('2026-09-14T12:00:00.000Z'),
    overrides: { source_a: { daily_request_limit: 5, daily_byte_limit: 500, host_concurrency: 2 } },
  });
  const reserved = await budget.reserve({ sourceId: 'source_a', host: 'catalog.example.gov', requests: 3, bytes: 300 });
  assert.equal(reserved.allowed, true);
  const released = await budget.releaseUnused({
    reservationId: reserved.reservationId,
    unusedRequests: 1,
    unusedBytes: 100,
  });
  assert.equal(released.requests, 1);
  assert.equal(released.bytes, 100);
  const snapshot = budget.snapshot({ sourceId: 'source_a', host: 'catalog.example.gov' });
  assert.equal(snapshot.used_requests, 2);
  assert.equal(snapshot.used_bytes, 200);
  const again = await budget.reserve({ sourceId: 'source_a', host: 'catalog.example.gov', requests: 3 });
  assert.equal(again.allowed, true);
  assert.equal(again.remaining_requests, 0);
});

test('UTC day boundary starts a new reservation period', async () => {
  let now = '2026-09-14T23:59:59.000Z';
  const budget = createSourceBudget({
    clock: () => now,
    overrides: { source_a: { daily_request_limit: 1, host_concurrency: 1 } },
  });
  const first = await budget.reserve({ sourceId: 'source_a', host: 'catalog.example.gov', requests: 1, concurrency: 0, now });
  assert.equal(first.allowed, true);
  assert.equal(first.period, '2026-09-14');
  now = '2026-09-15T00:00:00.000Z';
  const nextDay = await budget.reserve({ sourceId: 'source_a', host: 'catalog.example.gov', requests: 1, concurrency: 0, now });
  assert.equal(nextDay.allowed, true);
  assert.equal(nextDay.period, '2026-09-15');
});

test('per-host concurrency cap is exclusive', async () => {
  const budget = createSourceBudget({
    clock: clockAt('2026-09-14T12:00:00.000Z'),
    overrides: { source_a: { daily_request_limit: 10, host_concurrency: 1 } },
  });
  const [first, second] = await Promise.all([
    budget.reserve({ sourceId: 'source_a', host: 'catalog.example.gov', concurrency: 1 }),
    budget.reserve({ sourceId: 'source_a', host: 'catalog.example.gov', concurrency: 1 }),
  ]);
  const allowed = [first, second].filter((result) => result.allowed);
  const denied = [first, second].filter((result) => !result.allowed);
  assert.equal(allowed.length, 1);
  assert.equal(denied[0].reason, 'HOST_CONCURRENCY_EXCEEDED');
  await budget.releaseUnused({ reservationId: allowed[0].reservationId });
  const after = await budget.reserve({ sourceId: 'source_a', host: 'catalog.example.gov', concurrency: 1 });
  assert.equal(after.allowed, true);
});

test('429 Retry-After uses the exact delay and exhausted retries are incomplete', async () => {
  const failure = {
    failure_type: 'rate_limited',
    retry_class: 'transient',
    target_class: 'collection',
    safe_detail_code: 'ORIGIN_RATE_LIMITED',
    http_status: 429,
    observed_at: '2026-09-14T12:00:00.000Z',
  };
  const scheduled = classifyAndScheduleRetry(failure, { stage: 'harvest_page', attempt: 1, retryAfterSeconds: 17, entropyKey: 'fixture' });
  assert.equal(scheduled.retry, true);
  assert.equal(await scheduled.computeDelay(), 17);
  const last = classifyAndScheduleRetry(failure, {
    stage: 'harvest_page',
    attempt: STAGE_POLICIES.harvest_page.maximumDeliveryAttempts,
    retryAfterSeconds: 17,
  });
  assert.equal(last.retry, false);
  assert.equal(last.exhausted, true);
  assert.equal(last.status, 'incomplete');
  assert.equal(last.reason, 'RETRY_BUDGET_EXHAUSTED');
});

test('timeout and 5xx follow harvest_page retry bounds', () => {
  for (const type of ['timeout', 'upstream_5xx']) {
    const failure = {
      failure_type: type,
      retry_class: 'transient',
      target_class: 'collection',
      safe_detail_code: type === 'timeout' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_5XX',
      http_status: type === 'timeout' ? null : 503,
      observed_at: '2026-09-14T12:00:00.000Z',
    };
    const first = classifyAndScheduleRetry(failure, { stage: 'harvest_page', attempt: 1 });
    assert.equal(first.retry, true);
    const exhausted = classifyAndScheduleRetry(failure, {
      stage: 'harvest_page',
      attempt: STAGE_POLICIES.harvest_page.maximumDeliveryAttempts,
    });
    assert.equal(exhausted.exhausted, true);
    assert.equal(exhausted.status, 'incomplete');
  }
});

test('credential, parser, schema and scientific ambiguity are not blindly retried', () => {
  const cases = [
    { failure_type: 'catalog_auth_misconfigured', retry_class: 'pause_source', safe_detail_code: 'CATALOG_AUTH_MISCONFIGURED', queue: 'pause_source' },
    { failure_type: 'parse_failure', retry_class: 'quarantine', safe_detail_code: 'PARSE_FAILURE', queue: 'quarantine' },
    { failure_type: 'schema_drift', retry_class: 'quarantine', safe_detail_code: 'SCHEMA_DRIFT', queue: 'quarantine' },
    { failure_type: 'canonical_invariant_failure', retry_class: 'quarantine', safe_detail_code: 'CANONICAL_INVARIANT_FAILURE', queue: 'quarantine' },
  ];
  for (const item of cases) {
    const scheduled = classifyAndScheduleRetry({
      ...item,
      target_class: 'collection',
      observed_at: '2026-09-14T12:00:00.000Z',
    });
    assert.equal(scheduled.retry, false, item.failure_type);
    assert.equal(scheduled.queue, item.queue);
  }
});

test('resume report is idempotent and older generations cannot overwrite newer captures', () => {
  const budget = createSourceBudget({ clock: clockAt('2026-09-14T12:00:00.000Z') });
  assert.equal(budget.recordRunEvent({ runId: 'run_a', sourceGeneration: 2, kind: 'completed', recordId: 'rec-1' }).applied, true);
  assert.equal(budget.recordRunEvent({ runId: 'run_a', sourceGeneration: 2, kind: 'completed', recordId: 'rec-1' }).applied, true);
  assert.equal(budget.recordRunEvent({ runId: 'run_a', sourceGeneration: 2, kind: 'failed', recordId: 'rec-2' }).applied, true);
  assert.equal(budget.recordRunEvent({ runId: 'run_a', sourceGeneration: 2, kind: 'waiting', recordId: 'rec-3' }).applied, true);
  assert.equal(budget.recordRunEvent({ runId: 'run_a', sourceGeneration: 2, kind: 'skipped', recordId: 'rec-4' }).applied, true);
  const report = budget.resumeReport({ runId: 'run_a' });
  assert.deepEqual(report, {
    runId: 'run_a',
    generation: 2,
    completed: 1,
    waiting: 1,
    failed: 1,
    skipped: 1,
    total: 4,
  });
  const older = budget.recordRunEvent({ runId: 'run_a', sourceGeneration: 1, kind: 'completed', recordId: 'rec-old' });
  assert.equal(older.applied, false);
  assert.equal(older.reason, 'OLDER_GENERATION_REJECTED');
  assert.equal(budget.resumeReport({ runId: 'run_a' }).completed, 1);
  const newer = budget.recordRunEvent({ runId: 'run_a', sourceGeneration: 3, kind: 'completed', recordId: 'rec-new' });
  assert.equal(newer.applied, true);
  const next = budget.resumeReport({ runId: 'run_a' });
  assert.equal(next.generation, 3);
  assert.equal(next.completed, 1);
  assert.equal(next.total, 1);
});

test('budget exhaustion produces an explicit incomplete run', async () => {
  const budget = createSourceBudget({
    clock: clockAt('2026-09-14T12:00:00.000Z'),
    overrides: { source_a: { daily_request_limit: 0, host_concurrency: 1 } },
  });
  const result = await budget.reserve({ sourceId: 'source_a', host: 'catalog.example.gov', requests: 1 });
  assert.equal(result.allowed, false);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.reason, 'BUDGET_EXHAUSTED');
});

test('scheduler worker default export remains composition-disabled', async () => {
  await assert.rejects(() => disabledScheduler.scheduled(), { message: 'WP4_SCHEDULER_COMPOSITION_DISABLED' });
  assert.equal(typeof createSchedulerWorkerEntrypoint, 'function');
});
