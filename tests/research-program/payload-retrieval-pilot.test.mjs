import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePayloadRetrievalPilot } from '../../scripts/research-program/validate-payload-retrieval-pilot.mjs';

test('payload-retrieval pilot is prepared, unauthorized, bound to frozen identities, and does not substitute PLACES 7cmc-7y5g', () => {
  const report = validatePayloadRetrievalPilot();
  assert.equal(report.status, 'prepared_not_authorized');
  assert.equal(report.authorized, false);
  assert.equal(report.live_http, false);
  assert.equal(report.accepted, false);
  assert.deepEqual(report.products, ['cms-hcris-hospital-provider-cost-report', 'cdc-places-local-data-for-better-health']);
  assert.equal(report.frozen_cohorts_unmodified, true);
  assert.equal(report.captures_gitignored, true);
  assert.equal(report.redirects_consume_budget, true);
  assert.equal(report.branch, 'codex/ushso-evidence-ingestion-20260915');
  assert.match(report.git_head, /^[a-f0-9]{40}$/);
});
