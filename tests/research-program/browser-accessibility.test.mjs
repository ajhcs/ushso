import assert from 'node:assert/strict';
import test from 'node:test';
import { auditBrowserAccessibility } from './browser-accessibility.mjs';

test('automated accessibility checks do not certify WCAG and keep AT untested', async () => {
  const result = await auditBrowserAccessibility();
  assert.equal(result.ok, true);
  assert.equal(result.wcag_target, 'WCAG 2.2 AA');
  assert.equal(result.automated_certification, false);
  assert.equal(result.conformance_claimed, false);
  assert.equal(result.live_browser_session, false);
  assert.equal(result.six_result_card_regions.length, 6);
  assert.deepEqual(result.six_result_card_regions, ['title', 'description', 'why-match', 'geo-grain-time', 'access-evidence', 'details-action']);
  assert.equal(result.assistive_technology.frontend_acceptance, 'not_issued');
  assert.ok(result.assistive_technology.combinations.every((row) => row.status === 'untested'));
  assert.ok(result.contrast_pairs.every((pair) => pair.ratio >= 4.5));
  assert.equal(result.findings.find((row) => row.id === 'assistive-technology')?.status, 'untested');
});
