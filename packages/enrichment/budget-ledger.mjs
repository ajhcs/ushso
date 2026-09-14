import { createHash } from 'node:crypto';

export const LEDGER_FORMAT = 'ushso.inference-budget-ledger.v1';
export const SUGGESTED_PILOT_USD = 10;
export const SUGGESTED_MONTHLY_USD = 50;

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function periodKey(now, period = 'monthly') {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) fail('INVALID_PERIOD');
  const iso = date.toISOString();
  if (period === 'daily') return iso.slice(0, 10);
  if (period === 'pilot') return `pilot:${iso.slice(0, 10)}`;
  return iso.slice(0, 7);
}

export function createBudgetConfig({
  capUsd,
  period = 'monthly',
  suggestedPilotUsd = SUGGESTED_PILOT_USD,
  suggestedMonthlyUsd = SUGGESTED_MONTHLY_USD,
  maxRetries = 1,
} = {}) {
  if (typeof capUsd !== 'number' || !(capUsd >= 0)) fail('BUDGET_CAP_REQUIRED');
  return freeze({
    cap_usd: capUsd,
    period,
    suggested_pilot_usd: suggestedPilotUsd,
    suggested_monthly_usd: suggestedMonthlyUsd,
    hidden_default: false,
    max_retries: maxRetries,
  });
}

export function worstCaseUsd({
  inputTokens,
  maxOutputTokens,
  maxReasoningTokens = 0,
  pricePromptPerMillion,
  priceCompletionPerMillion,
  retries = 0,
} = {}) {
  if (![pricePromptPerMillion, priceCompletionPerMillion].every((value) => typeof value === 'number' && value >= 0)) {
    fail('MISSING_PRICE_DATA');
  }
  const attempts = 1 + (retries ?? 0);
  const prompt = (inputTokens / 1_000_000) * pricePromptPerMillion;
  const completion = ((maxOutputTokens + maxReasoningTokens) / 1_000_000) * priceCompletionPerMillion;
  return Number(((prompt + completion) * attempts).toFixed(8));
}

export function createBudgetLedger(config, { now = '2026-09-14T00:00:00.000Z' } = {}) {
  const cfg = createBudgetConfig(config);
  const state = {
    revision: 0,
    period: periodKey(now, cfg.period),
    reserved_usd: 0,
    settled_usd: 0,
    uncertain_usd: 0,
    reservations: new Map(),
    charges: [],
  };
  const mutex = [];
  async function exclusive(fn) {
    const prior = mutex[mutex.length - 1] ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    mutex.push(current);
    await prior;
    try {
      return await fn();
    } finally {
      release();
      mutex.shift();
    }
  }

  return {
    config: cfg,
    async reserve(request, { now: stamp = now } = {}) {
      return exclusive(() => {
        const period = periodKey(stamp, cfg.period);
        if (period !== state.period) {
          state.period = period;
          state.reserved_usd = 0;
          state.settled_usd = 0;
          state.uncertain_usd = 0;
          state.reservations.clear();
        }
        const amount = worstCaseUsd(request);
        const committed = state.settled_usd + state.uncertain_usd + state.reserved_usd;
        if (committed + amount > cfg.cap_usd) fail('BUDGET_EXHAUSTED');
        const id = request.reservation_id ?? `res:${state.revision + 1}`;
        if (state.reservations.has(id)) fail('DUPLICATE_RESERVATION');
        state.revision += 1;
        state.reserved_usd = Number((state.reserved_usd + amount).toFixed(8));
        const row = freeze({
          reservation_id: id,
          amount_usd: amount,
          revision: state.revision,
          task_id: request.task_id ?? null,
          retries_allowed: cfg.max_retries,
        });
        state.reservations.set(id, { ...row, remaining_retries: cfg.max_retries });
        return row;
      });
    },
    async settle(reservationId, { usage, status, retryAfterMs = null, providerId = null, now: stamp = now } = {}) {
      return exclusive(() => {
        const current = state.reservations.get(reservationId);
        if (!current) fail('RESERVATION_MISSING');
        state.reserved_usd = Number((state.reserved_usd - current.amount_usd).toFixed(8));
        let charge;
        if (status === 'success') {
          if (!usage || typeof usage.cost_usd !== 'number') fail('MALFORMED_USAGE');
          charge = freeze({ reservation_id: reservationId, state: 'settled', cost_usd: usage.cost_usd, provider_id: providerId, usage, observed_at: stamp });
          state.settled_usd = Number((state.settled_usd + usage.cost_usd).toFixed(8));
          state.reservations.delete(reservationId);
        } else if (status === 'timeout_after_send' || status === 'malformed_usage' || status === 'interrupted' || status === 'process_restart') {
          charge = freeze({ reservation_id: reservationId, state: 'uncertain', cost_usd: current.amount_usd, assumed_free: false, provider_id: providerId, observed_at: stamp, reason: status });
          state.uncertain_usd = Number((state.uncertain_usd + current.amount_usd).toFixed(8));
          state.reservations.delete(reservationId);
        } else if (status === '429') {
          if (current.remaining_retries <= 0) fail('RETRY_CAP_EXCEEDED');
          current.remaining_retries -= 1;
          state.reserved_usd = Number((state.reserved_usd + current.amount_usd).toFixed(8));
          charge = freeze({ reservation_id: reservationId, state: 'retry_wait', retry_after_ms: retryAfterMs, remaining_retries: current.remaining_retries, assumed_free: false });
        } else if (status === '402') {
          charge = freeze({ reservation_id: reservationId, state: 'payment_required', cost_usd: 0, assumed_free: false, provider_id: providerId });
          state.reservations.delete(reservationId);
        } else if (status === 'rejected') {
          charge = freeze({ reservation_id: reservationId, state: 'rejected', cost_usd: 0, assumed_free: false });
          state.reservations.delete(reservationId);
        } else {
          fail('UNKNOWN_SETTLEMENT_STATUS');
        }
        state.charges.push(charge);
        return charge;
      });
    },
    snapshot() {
      return freeze({
        format: LEDGER_FORMAT,
        period: state.period,
        cap_usd: cfg.cap_usd,
        reserved_usd: state.reserved_usd,
        settled_usd: state.settled_usd,
        uncertain_usd: state.uncertain_usd,
        available_usd: Number((cfg.cap_usd - state.reserved_usd - state.settled_usd - state.uncertain_usd).toFixed(8)),
        suggested_pilot_usd: cfg.suggested_pilot_usd,
        suggested_monthly_usd: cfg.suggested_monthly_usd,
        hidden_default: false,
        charges: freeze([...state.charges]),
      });
    },
    costReport() {
      const failures = state.charges.filter((row) => ['uncertain', 'payment_required', 'retry_wait', 'rejected'].includes(row.state));
      return freeze({
        settled_usd: state.settled_usd,
        uncertain_usd: state.uncertain_usd,
        failures: freeze(failures),
        retries: freeze(state.charges.filter((row) => row.state === 'retry_wait')),
        rejected_proposals: freeze(state.charges.filter((row) => row.state === 'rejected')),
        includes_failures_retries_and_rejected: true,
      });
    },
  };
}

export function restoreLedger(snapshot, config) {
  const ledger = createBudgetLedger(config);
  for (const charge of snapshot.charges ?? []) ledger._restored = true;
  return ledger;
}

export { createHash };
