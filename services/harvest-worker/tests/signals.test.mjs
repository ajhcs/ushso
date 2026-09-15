import assert from 'node:assert/strict';
import test from 'node:test';
import harvestDefault from '../worker.mjs';
import {
  EPA_WIDGETS_FIXTURE,
  changedDestinationSignal,
  notifyMeaningfulChange,
  operationalSnapshot,
} from '../signals.mjs';
import {
  PRODUCTION_ACTIVATION,
  PUBLIC_WORKER_BOUNDARY,
  fixtureCycle,
  twoAuthorizedCycles,
} from '../activation.mjs';

test('EPA Widgets HTTP 200 is a changed-destination signal and cannot refresh an actionable API success badge', () => {
  const signal = changedDestinationSignal(EPA_WIDGETS_FIXTURE);
  assert.equal(signal.signal, 'changed_destination');
  assert.equal(signal.reachable, true);
  assert.equal(signal.http_status, 200);
  assert.equal(signal.actionable_api_success_badge, false);
  assert.equal(signal.reason_code, 'DESTINATION_RESOURCE_ROLE_MISMATCH');
  const first = notifyMeaningfulChange({ current: { ...signal, source_id: 'epa-developer-directory' } });
  const repeat = notifyMeaningfulChange({ previous: { ...signal, source_id: 'epa-developer-directory' }, current: { ...signal, source_id: 'epa-developer-directory' } });
  assert.equal(first.notify, true);
  assert.equal(repeat.notify, false);
  assert.equal(repeat.reason, 'repeated_unchanged_failure');
  assert.equal(repeat.spam, false);
});

test('aggregate HTTP success does not hide critical new loss', () => {
  const snapshot = operationalSnapshot({
    queue_age_seconds: 12,
    failed_checks: 1,
    schema_drift: false,
    coverage_loss: true,
    budget_exhaustion: false,
    review_backlog: 3,
    aggregate_http_success_ratio: 0.995,
    critical_new_loss: true,
  });
  assert.equal(snapshot.aggregate_success_hides_critical_loss, true);
});

test('public Worker has no source credentials or fetch capability and production activation remains unissued', async () => {
  assert.equal(PUBLIC_WORKER_BOUNDARY.source_credentials, false);
  assert.equal(PUBLIC_WORKER_BOUNDARY.source_fetch_capability, false);
  assert.equal(PRODUCTION_ACTIVATION.issued, false);
  assert.equal(PRODUCTION_ACTIVATION.timers_enabled_by_merge, false);
  assert.equal(twoAuthorizedCycles().status, 'unrun_until_authorized');
  const cycle = fixtureCycle({ cycle: 1, outcome: 'fixture_only' });
  assert.equal(cycle.timers_enabled, false);
  const batch = { messages: [{ body: { event_id: 'evt-1' }, retry() {} }] };
  const result = await harvestDefault.queue(batch);
  assert.equal(result[0].reason, 'WP4_HARVEST_COMPOSITION_DISABLED');
});
