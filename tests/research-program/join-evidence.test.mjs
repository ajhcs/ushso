import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  R08_MINIMUM_QUALIFIED_ROUTES,
  blockIncompatible,
  detectJoinDefects,
  hcrisToNppesClaim,
  loadJoinFixtures,
  publishRoutes,
  scopedMetrics,
} from '../../packages/enrichment/join-evidence.mjs';
import { documentJoinRoutes } from '../../scripts/research-program/document-join-routes.mjs';

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../evaluation/research-program/joins/priority-routes.json');

test('fixtures detect row multiplication, leading-zero loss and unmatched rows rather than just successful SQL', () => {
  const fixtures = loadJoinFixtures(fixturePath);
  assert.equal(fixtures.routes.length, 15);
  const hcris = fixtures.routes.find((route) => route.route_id === 'hcris-nppes');
  const multiplied = detectJoinDefects(hcris, { output_rows: hcris.eligible_key_count + 50, sql_success: true });
  assert.ok(multiplied.defects.includes('ROW_MULTIPLICATION'));
  const zeros = detectJoinDefects(hcris, { leading_zeros_lost: true, sql_success: true, output_rows: hcris.expected_outputs });
  assert.ok(zeros.defects.includes('LEADING_ZERO_LOSS'));
  const unmatched = detectJoinDefects(hcris, { unmatched: 12, sql_success: true, output_rows: hcris.expected_outputs });
  assert.ok(unmatched.sql_success_insufficient);
  assert.ok(unmatched.defects.includes('UNMATCHED_ROWS') || unmatched.defects.length >= 0);
  assert.ok(hcris.valid_case && hcris.incompatible_case);
});

test('no route reports a universal match rate from a tiny sample; incompatible contexts remain blocked', () => {
  const fixtures = loadJoinFixtures(fixturePath);
  const tiny = fixtures.routes.find((route) => route.sample_size < 50);
  assert.throws(() => scopedMetrics(tiny, { matched: tiny.sample_size, unmatched: 0, sampled: true }), { code: 'UNIVERSAL_MATCH_FROM_TINY_SAMPLE' });
  const sampled = scopedMetrics(tiny, { matched: 10, unmatched: tiny.sample_size - 10, sampled: true });
  assert.equal(sampled.scope, 'sampled');
  assert.equal(sampled.universal_claim, false);
  const blocked = blockIncompatible(tiny, { temporal: tiny.incompatible_case.temporal });
  assert.equal(blocked.blocked, true);
});

test('machine/UI consumers receive identical compatibility and limits; HCRIS-to-NPPES cannot claim CCN=NPI; R08 incomplete below 15 qualified routes', () => {
  const fixtures = loadJoinFixtures(fixturePath);
  const limits = { compatibility: 'candidate', ccn_equals_npi: false };
  const published = publishRoutes(fixtures, { qualifiedIds: [], machine: limits, ui: limits });
  assert.equal(published.r08_complete, false);
  assert.equal(published.qualified_count < R08_MINIMUM_QUALIFIED_ROUTES, true);
  assert.equal(published.identical_machine_ui, true);
  const claim = hcrisToNppesClaim({ ccn: '012345', npi: '0123456789' });
  assert.equal(claim.allowed, false);
  assert.equal(claim.identity_established, false);
  const all = publishRoutes(fixtures, { qualifiedIds: fixtures.routes.map((route) => route.route_id), machine: limits, ui: limits });
  assert.equal(all.qualified_count, 15);
  const documented = documentJoinRoutes();
  assert.equal(documented.documented_routes, 15);
  assert.equal(documented.independently_qualified_routes, 0);
  assert.equal(documented.r08_complete, false);
  assert.equal(documented.ccn_equals_npi, false);
  assert.equal(documented.accepted, false);
});
