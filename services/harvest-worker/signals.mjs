import { classifyResourceRole } from '../../packages/connectors/src/content-classifier.mjs';

export const EPA_WIDGETS_FIXTURE = Object.freeze({
  requested_url: 'https://www.epa.gov/developers/data-data-products#apis',
  final_url: 'https://www.epa.gov/developers/widgets',
  observed_title: 'Widgets | US EPA',
  media_type: 'text/html',
  http_status: 200,
  redirect_count: 1,
  expected_role: 'developer_api_data_products_documentation',
});

export function changedDestinationSignal(observation) {
  const role = classifyResourceRole({
    requestedUrl: observation.requested_url,
    finalUrl: observation.final_url,
    expectedRole: observation.expected_role,
    observedTitle: observation.observed_title,
    mediaType: observation.media_type,
    status: observation.http_status,
    redirectCount: observation.redirect_count,
    purpose: 'documentation',
  });
  const mismatch = role.reason_code === 'DESTINATION_RESOURCE_ROLE_MISMATCH';
  return Object.freeze({
    signal: mismatch ? 'changed_destination' : 'destination_match',
    http_status: role.http_status,
    reachable: role.http_status === 200,
    actionable_api_success_badge: false,
    reason_code: role.reason_code,
    observed_role: role.observed_role,
    expected_role: role.expected_role,
    next_action: mismatch
      ? 'Retain the dated destination/resource-role mismatch. Do not refresh an actionable API success badge from HTTP 200 HTML.'
      : 'Destination role matches the requested role; this is still not payload access.',
  });
}

export function notifyMeaningfulChange({ previous = null, current, now = new Date().toISOString() }) {
  if (!current) {
    return Object.freeze({ notify: false, reason: 'no_current_signal' });
  }
  const fingerprint = JSON.stringify({
    signal: current.signal,
    reason_code: current.reason_code,
    observed_role: current.observed_role,
    source_id: current.source_id ?? null,
  });
  const previousFingerprint = previous
    ? JSON.stringify({
      signal: previous.signal,
      reason_code: previous.reason_code,
      observed_role: previous.observed_role,
      source_id: previous.source_id ?? null,
    })
    : null;
  if (previousFingerprint === fingerprint) {
    return Object.freeze({
      notify: false,
      reason: 'repeated_unchanged_failure',
      spam: false,
      recorded_at: now,
    });
  }
  return Object.freeze({
    notify: true,
    reason: previous ? 'state_changed' : 'first_observation',
    spam: false,
    recorded_at: now,
    affected_source: current.source_id ?? current.requested_url ?? null,
    next_action: current.next_action,
  });
}

export function operationalSnapshot({
  queue_age_seconds = 0,
  failed_checks = 0,
  schema_drift = false,
  coverage_loss = false,
  budget_exhaustion = false,
  review_backlog = 0,
  aggregate_http_success_ratio = 1,
  critical_new_loss = false,
} = {}) {
  return Object.freeze({
    queue_age_seconds,
    failed_checks,
    schema_drift,
    coverage_loss,
    budget_exhaustion,
    review_backlog,
    aggregate_http_success_ratio,
    critical_new_loss,
    aggregate_success_hides_critical_loss: critical_new_loss === true && aggregate_http_success_ratio >= 0.99,
  });
}
