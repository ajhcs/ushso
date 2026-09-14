import { classifyFailure, fullJitterDelaySeconds, retryBudget, STAGE_POLICIES } from './failure-policy.mjs';
import { invariant, iso, parseTimestamp } from './common.mjs';

export const GLOBAL_BUDGET_CAPS = Object.freeze({
  daily_request_limit: 100_000,
  daily_byte_limit: 10_000_000_000,
  host_concurrency: 16
});

export function utcDayPeriod(value) {
  const ms = parseTimestamp(value);
  const stamp = iso(ms);
  return stamp.slice(0, 10);
}

function exclusiveQueue() {
  let tail = Promise.resolve();
  return async function exclusive(work) {
    const predecessor = tail;
    let release;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      return await work();
    } finally {
      release();
    }
  };
}

export function resolveSourceLimits({ sourceId, overrides = {}, globals = GLOBAL_BUDGET_CAPS } = {}) {
  const override = overrides[sourceId] ?? {};
  const daily_request_limit = override.daily_request_limit ?? globals.daily_request_limit;
  const daily_byte_limit = override.daily_byte_limit ?? globals.daily_byte_limit;
  const host_concurrency = override.host_concurrency ?? 1;
  invariant(Number.isInteger(daily_request_limit) && daily_request_limit >= 0, 'SOURCE_DAILY_REQUEST_LIMIT_INVALID');
  invariant(Number.isInteger(daily_byte_limit) && daily_byte_limit >= 0, 'SOURCE_DAILY_BYTE_LIMIT_INVALID');
  invariant(Number.isInteger(host_concurrency) && host_concurrency >= 0, 'SOURCE_HOST_CONCURRENCY_INVALID');
  invariant(daily_request_limit <= globals.daily_request_limit, 'SOURCE_DAILY_REQUEST_LIMIT_EXCEEDS_GLOBAL');
  invariant(daily_byte_limit <= globals.daily_byte_limit, 'SOURCE_DAILY_BYTE_LIMIT_EXCEEDS_GLOBAL');
  invariant(host_concurrency <= globals.host_concurrency, 'SOURCE_HOST_CONCURRENCY_EXCEEDS_GLOBAL');
  return Object.freeze({ daily_request_limit, daily_byte_limit, host_concurrency });
}

export function classifyAndScheduleRetry(failure, { stage = 'harvest_page', attempt = 1, retryAfterSeconds = null, entropyKey = 'budget' } = {}) {
  const classified = classifyFailure(failure, { targetClass: failure?.target_class });
  const budget = retryBudget(stage, attempt);
  if (!classified.retryable) {
    return Object.freeze({
      retry: false,
      disposition: classified.disposition,
      retryClass: classified.retryClass,
      exhausted: false,
      delaySeconds: null,
      queue: classified.disposition === 'quarantine' ? 'quarantine' : classified.disposition === 'pause_source' ? 'pause_source' : 'typed_observation'
    });
  }
  if (budget.exhausted) {
    return Object.freeze({
      retry: false,
      disposition: 'exhausted',
      retryClass: classified.retryClass,
      exhausted: true,
      delaySeconds: null,
      queue: 'dead_letter',
      status: 'incomplete',
      reason: 'RETRY_BUDGET_EXHAUSTED'
    });
  }
  return Object.freeze({
    retry: true,
    disposition: classified.disposition,
    retryClass: classified.retryClass,
    exhausted: false,
    delaySeconds: null,
    queue: 'harvest-page',
    stage,
    attempt,
    retryAfterSeconds: retryAfterSeconds === null || retryAfterSeconds === undefined ? null : retryAfterSeconds,
    computeDelay: () => fullJitterDelaySeconds({
      stage,
      attempt,
      retryAfterSeconds,
      entropyKey
    })
  });
}

export function createSourceBudget({ clock = () => new Date().toISOString(), overrides = {}, globals = GLOBAL_BUDGET_CAPS } = {}) {
  const exclusive = exclusiveQueue();
  const daily = new Map();
  const hosts = new Map();
  const reservations = new Map();
  const runs = new Map();
  let sequence = 0;

  function dayKey(sourceId, period) {
    return `${sourceId}:${period}`;
  }

  function usedFor(sourceId, period) {
    const key = dayKey(sourceId, period);
    const used = daily.get(key) ?? { requests: 0, bytes: 0 };
    daily.set(key, used);
    return used;
  }

  return Object.freeze({
    utcDayPeriod,
    limitsFor(sourceId) {
      return resolveSourceLimits({ sourceId, overrides, globals });
    },
    async reserve({ sourceId, host, now = clock(), requests = 1, bytes = 0, concurrency = 1 }) {
      invariant(typeof sourceId === 'string' && sourceId.length > 0, 'SOURCE_ID_INVALID');
      invariant(typeof host === 'string' && host.length > 0, 'HOST_INVALID');
      invariant(Number.isInteger(requests) && requests >= 0, 'REQUEST_COUNT_INVALID');
      invariant(Number.isInteger(bytes) && bytes >= 0, 'BYTE_COUNT_INVALID');
      invariant(Number.isInteger(concurrency) && concurrency >= 0, 'CONCURRENCY_INVALID');
      return exclusive(() => {
        const period = utcDayPeriod(now);
        const limits = resolveSourceLimits({ sourceId, overrides, globals });
        const used = usedFor(sourceId, period);
        const hostUsed = hosts.get(host) ?? 0;
        if (concurrency > 0 && hostUsed + concurrency > limits.host_concurrency) {
          return Object.freeze({
            allowed: false,
            status: 'incomplete',
            reason: 'HOST_CONCURRENCY_EXCEEDED',
            remaining_concurrency: Math.max(0, limits.host_concurrency - hostUsed)
          });
        }
        if (requests > 0 && used.requests + requests > limits.daily_request_limit) {
          return Object.freeze({
            allowed: false,
            status: 'incomplete',
            reason: 'BUDGET_EXHAUSTED',
            remaining_requests: Math.max(0, limits.daily_request_limit - used.requests)
          });
        }
        if (bytes > 0 && used.bytes + bytes > limits.daily_byte_limit) {
          return Object.freeze({
            allowed: false,
            status: 'incomplete',
            reason: 'BUDGET_EXHAUSTED',
            remaining_bytes: Math.max(0, limits.daily_byte_limit - used.bytes)
          });
        }
        used.requests += requests;
        used.bytes += bytes;
        if (concurrency > 0) hosts.set(host, hostUsed + concurrency);
        sequence += 1;
        const reservationId = `reservation:${sourceId}:${period}:${sequence}`;
        reservations.set(reservationId, {
          reservationId,
          sourceId,
          host,
          period,
          reservedRequests: requests,
          reservedBytes: bytes,
          reservedConcurrency: concurrency,
          unusedRequests: requests,
          unusedBytes: bytes,
          unusedConcurrency: concurrency
        });
        return Object.freeze({
          allowed: true,
          reservationId,
          period,
          remaining_requests: limits.daily_request_limit - used.requests,
          remaining_bytes: limits.daily_byte_limit - used.bytes,
          remaining_concurrency: limits.host_concurrency - (hosts.get(host) ?? 0)
        });
      });
    },
    async releaseUnused({ reservationId, unusedRequests = null, unusedBytes = null, unusedConcurrency = null }) {
      invariant(typeof reservationId === 'string' && reservationId.length > 0, 'RESERVATION_ID_INVALID');
      return exclusive(() => {
        const reservation = reservations.get(reservationId);
        if (!reservation) return Object.freeze({ released: false, reason: 'RESERVATION_NOT_FOUND' });
        const giveRequests = Math.min(
          reservation.unusedRequests,
          unusedRequests === null ? reservation.unusedRequests : unusedRequests
        );
        const giveBytes = Math.min(
          reservation.unusedBytes,
          unusedBytes === null ? reservation.unusedBytes : unusedBytes
        );
        const giveConcurrency = Math.min(
          reservation.unusedConcurrency,
          unusedConcurrency === null ? reservation.unusedConcurrency : unusedConcurrency
        );
        invariant(giveRequests >= 0 && giveBytes >= 0 && giveConcurrency >= 0, 'RELEASE_UNUSED_INVALID');
        const used = usedFor(reservation.sourceId, reservation.period);
        used.requests -= giveRequests;
        used.bytes -= giveBytes;
        reservation.unusedRequests -= giveRequests;
        reservation.unusedBytes -= giveBytes;
        if (giveConcurrency > 0) {
          hosts.set(reservation.host, Math.max(0, (hosts.get(reservation.host) ?? 0) - giveConcurrency));
          reservation.unusedConcurrency -= giveConcurrency;
        }
        return Object.freeze({
          released: true,
          requests: giveRequests,
          bytes: giveBytes,
          concurrency: giveConcurrency
        });
      });
    },
    snapshot({ sourceId, host, now = clock() }) {
      const period = utcDayPeriod(now);
      const limits = resolveSourceLimits({ sourceId, overrides, globals });
      const used = daily.get(dayKey(sourceId, period)) ?? { requests: 0, bytes: 0 };
      return Object.freeze({
        period,
        used_requests: used.requests,
        used_bytes: used.bytes,
        host_concurrency: hosts.get(host) ?? 0,
        limits
      });
    },
    recordRunEvent({ runId, sourceGeneration, kind, recordId = null }) {
      invariant(typeof runId === 'string' && runId.length > 0, 'RUN_ID_INVALID');
      invariant(Number.isInteger(sourceGeneration) && sourceGeneration >= 1, 'SOURCE_GENERATION_INVALID');
      invariant(['completed', 'waiting', 'failed', 'skipped'].includes(kind), 'RUN_EVENT_KIND_INVALID');
      const run = runs.get(runId) ?? { generation: sourceGeneration, events: [] };
      if (sourceGeneration < run.generation) {
        return Object.freeze({ applied: false, reason: 'OLDER_GENERATION_REJECTED', generation: run.generation });
      }
      if (sourceGeneration > run.generation) {
        run.generation = sourceGeneration;
        run.events = [];
      }
      const key = `${kind}:${recordId ?? run.events.length}`;
      if (!run.events.some((event) => event.key === key && event.kind === kind)) {
        run.events.push({ key, kind, recordId, generation: sourceGeneration });
      }
      runs.set(runId, run);
      return Object.freeze({ applied: true, generation: run.generation });
    },
    resumeReport({ runId }) {
      const run = runs.get(runId);
      if (!run) {
        return Object.freeze({
          runId,
          generation: null,
          completed: 0,
          waiting: 0,
          failed: 0,
          skipped: 0,
          total: 0
        });
      }
      const counts = { completed: 0, waiting: 0, failed: 0, skipped: 0 };
      for (const event of run.events) counts[event.kind] += 1;
      return Object.freeze({
        runId,
        generation: run.generation,
        ...counts,
        total: run.events.length
      });
    }
  });
}
