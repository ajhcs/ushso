import assert from 'node:assert/strict';
import test from 'node:test';
import { auditBrowserMatrix } from './browser-matrix.mjs';

test('browser matrix records untested engines and does not claim physical devices', async () => {
  const result = await auditBrowserMatrix();
  assert.equal(result.ok, true);
  assert.equal(result.physical_device_tests, false);
  assert.equal(result.emulator_claimed_as_physical_device, false);
  assert.equal(result.native_webmcp_unsupported_browsers, 'untested');
  assert.equal(result.six_result_card_regions, 6);
  assert.equal(result.blank_detail_page, false);
  assert.ok(result.sitemap_guide_pages.includes('/learn'));
  assert.ok(result.sitemap_guide_pages.includes('/methods'));
  assert.ok(result.live_engine_sessions.every((row) => row.status === 'untested'));
  assert.equal(result.zoom_checks, 'untested');
});
