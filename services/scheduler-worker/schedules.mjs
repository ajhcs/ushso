export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export const SCHEDULER_DEFAULT_EXPORT = 'disabled';

const UNKNOWN = 'not captured';

function captured(value, fallback = UNKNOWN) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : fallback;
}

export const SOURCE_REFRESH_SCHEDULES = Object.freeze([
  {
    source_id: 'cms-hcris',
    axis: 'federal_cost_report',
    priority: 1,
    cadence_seconds: 86_400,
    spend_budget_class: 'low_public_catalog',
    last_success_at: null,
    last_attempt_at: null,
    last_content_hash: null,
    stale_visible_without_collector_success: true,
  },
  {
    source_id: 'cdc-places',
    axis: 'county_estimate',
    priority: 2,
    cadence_seconds: 604_800,
    spend_budget_class: 'low_public_catalog',
    last_success_at: null,
    last_attempt_at: null,
    last_content_hash: null,
    stale_visible_without_collector_success: true,
  },
  {
    source_id: 'ahrq-hcup',
    axis: 'restricted_application',
    priority: 3,
    cadence_seconds: 2_592_000,
    spend_budget_class: 'documentation_only',
    last_success_at: null,
    last_attempt_at: null,
    last_content_hash: null,
    stale_visible_without_collector_success: true,
  },
]);

export function sourceFreshness(schedule, { now = Date.now() } = {}) {
  const lastSuccess = schedule.last_success_at ? Date.parse(schedule.last_success_at) : null;
  const lastAttempt = schedule.last_attempt_at ? Date.parse(schedule.last_attempt_at) : null;
  const stale = lastSuccess === null || (!Number.isFinite(lastSuccess) ? true : now - lastSuccess > schedule.cadence_seconds * 1000);
  return Object.freeze({
    source_id: schedule.source_id,
    last_success_at: schedule.last_success_at ?? null,
    last_attempt_at: schedule.last_attempt_at ?? null,
    last_content_hash: schedule.last_content_hash ?? null,
    stale,
    collector_success: lastSuccess !== null && Number.isFinite(lastSuccess),
    visible_without_collector_success: schedule.stale_visible_without_collector_success === true,
    generation: LAST_GOOD_GENERATION,
    last_attempt_relative_to_success: lastAttempt !== null && lastSuccess !== null ? lastAttempt - lastSuccess : null,
  });
}

export function schedulesFitBudgets(schedules = SOURCE_REFRESH_SCHEDULES) {
  const allowed = new Set(['low_public_catalog', 'documentation_only']);
  return schedules.every((row) => allowed.has(row.spend_budget_class) && Number.isInteger(row.cadence_seconds) && row.cadence_seconds >= 86_400);
}
