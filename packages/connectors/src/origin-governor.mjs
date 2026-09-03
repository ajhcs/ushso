import { ConnectorFailure } from './errors.mjs';

export class MemoryOriginGovernor {
  #states = new Map();
  #clock;
  #failureThreshold;
  #openMilliseconds;

  constructor({ clock = () => Date.now(), failureThreshold = 3, openMilliseconds = 60_000 } = {}) {
    this.#clock = clock;
    this.#failureThreshold = failureThreshold;
    this.#openMilliseconds = openMilliseconds;
  }

  #state(origin, policy) {
    if (!this.#states.has(origin)) {
      this.#states.set(origin, {
        tokens: policy.burst,
        lastRefill: this.#clock(),
        inFlight: 0,
        failures: 0,
        circuit: 'closed',
        openedAt: null,
        halfOpenInFlight: false,
      });
    }
    return this.#states.get(origin);
  }

  async acquire(origin, policy, targetClass) {
    const now = this.#clock();
    const state = this.#state(origin, policy);
    const elapsedSeconds = Math.max(0, now - state.lastRefill) / 1000;
    state.tokens = Math.min(policy.burst, state.tokens + elapsedSeconds * policy.requests_per_second);
    state.lastRefill = now;
    if (state.circuit === 'open') {
      if (now - state.openedAt < this.#openMilliseconds) {
        throw new ConnectorFailure('Origin circuit is open.', {
          failureType: 'rate_limited', safeDetailCode: 'ORIGIN_CIRCUIT_OPEN', targetClass,
          retryClass: 'transient', beforeEgress: true,
        });
      }
      state.circuit = 'half_open';
    }
    if (state.circuit === 'half_open' && state.halfOpenInFlight) {
      throw new ConnectorFailure('Origin half-open probe is already in flight.', {
        failureType: 'rate_limited', safeDetailCode: 'ORIGIN_HALF_OPEN_BUSY', targetClass,
        retryClass: 'transient', beforeEgress: true,
      });
    }
    if (state.inFlight >= policy.maximum_concurrency || state.tokens < 1) {
      throw new ConnectorFailure('Origin pacing budget is exhausted.', {
        failureType: 'rate_limited', safeDetailCode: 'ORIGIN_RATE_BUDGET_EXHAUSTED', targetClass,
        retryClass: 'transient', beforeEgress: true,
      });
    }
    state.tokens -= 1;
    state.inFlight += 1;
    if (state.circuit === 'half_open') state.halfOpenInFlight = true;
    let released = false;
    return {
      release: ({ success, consumeFailureBudget = false }) => {
        if (released) return;
        released = true;
        state.inFlight = Math.max(0, state.inFlight - 1);
        state.halfOpenInFlight = false;
        if (success) {
          state.failures = 0;
          state.circuit = 'closed';
          state.openedAt = null;
        } else if (consumeFailureBudget) {
          state.failures += 1;
          if (state.failures >= this.#failureThreshold) {
            state.circuit = 'open';
            state.openedAt = this.#clock();
          }
        }
      },
    };
  }

  snapshot(origin, policy) {
    return structuredClone(this.#state(origin, policy));
  }
}
