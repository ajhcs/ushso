export const PRODUCTION_ACTIVATION = Object.freeze({
  issued: false,
  receipt: null,
  timers_enabled_by_merge: false,
  two_complete_scheduled_cycles: 'unrun',
});

export const PUBLIC_WORKER_BOUNDARY = Object.freeze({
  role: 'public',
  source_credentials: false,
  source_fetch_capability: false,
  foundation_inert: true,
  wrangler_main: 'infra/cloudflare/templates/foundation-placeholder.mjs',
});

export function fixtureCycle({ cycle, outcome }) {
  return Object.freeze({
    cycle,
    outcome,
    production_activation: PRODUCTION_ACTIVATION.issued,
    timers_enabled: false,
  });
}

export function twoAuthorizedCycles(results = []) {
  return Object.freeze({
    required: 2,
    observed: results.length,
    complete: false,
    status: 'unrun_until_authorized',
    results,
  });
}
