import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  EXPANSION_FAMILY_COUNT,
  FROZEN_PAYER_IDS,
  HOSPITAL_DENOMINATOR,
  LAST_GOOD_GENERATION,
  PAYER_DENOMINATOR,
  classifyDisposition,
  expansionFamilyRoutes,
  hospitalWalkthrough,
  payerWalkthrough,
  qualifyMrf,
  reconcilePilot,
  refuseCohortReplacement,
  refuseSelfApproval,
  refuseUnknownCellAsSupported,
} from '../../scripts/research-program/qualify-mrf.mjs';
import { loadFrozenHospitalIds } from '../../packages/connectors/mrf/hospital-registry.mjs';

const cohorts = JSON.parse(readFileSync('evaluation/research-program/cohorts.json', 'utf8'));
const hospitalIds = loadFrozenHospitalIds(cohorts);

test('every example operation links to its exact sample/metadata receipt; real and fictional examples are explicitly labeled', () => {
  const hospital = hospitalWalkthrough();
  const payer = payerWalkthrough();
  assert.equal(hospital.generation, LAST_GOOD_GENERATION);
  assert.equal(hospital.access_steps[0].executed, true);
  assert.ok(hospital.access_steps[0].receipt);
  assert.equal(payer.access_steps[0].executed, true);
  assert.ok(payer.access_steps[0].receipt);
  const report = qualifyMrf(cohorts);
  assert.equal(report.examples.hospital.fictional, true);
  assert.equal(report.examples.hospital.synthetic, true);
  assert.equal(report.examples.hospital.real_hospital_file, false);
  assert.equal(report.examples.payer.fictional, true);
  assert.equal(report.examples.payer.real_payer_file, false);
  assert.ok(hospital.caveats.some((caveat) => caveat.includes('fictional')));
  assert.ok(payer.caveats.some((caveat) => caveat.includes('fictional')));
});

test('a failed target stays a blocker with a bounded follow-up task; do not replace difficult cohort members; unknown cells cannot count as supported', () => {
  assert.equal(hospitalIds.length, HOSPITAL_DENOMINATOR);
  assert.equal(FROZEN_PAYER_IDS.length, PAYER_DENOMINATOR);
  assert.throws(() => refuseUnknownCellAsSupported({ locator_materialized: false, supported: true }), { code: 'UNKNOWN_CELL_CANNOT_COUNT_AS_SUPPORTED' });
  assert.throws(() => refuseCohortReplacement(hospitalIds, hospitalIds.slice(1)), { code: 'DIFFICULT_COHORT_MEMBER_REPLACED_OR_DROPPED' });
  assert.throws(() => refuseCohortReplacement(hospitalIds, [...hospitalIds, '999999']), { code: 'COHORT_REPLACEMENT_FORBIDDEN' });
  const unknown = classifyDisposition({ candidate_id: '103301', locator_materialized: false });
  assert.equal(unknown.supported, false);
  assert.equal(unknown.unknown, true);
  assert.equal(unknown.blocker, true);
  assert.equal(unknown.follow_up.replacement_allowed, false);
  const hospitalDispositions = hospitalIds.map((id) => ({ candidate_id: id, locator_materialized: false }));
  const payerDispositions = [...FROZEN_PAYER_IDS].map((id) => ({ candidate_id: id, locator_materialized: false }));
  const pilot = reconcilePilot(cohorts, { hospitalDispositions, payerDispositions });
  assert.equal(pilot.hospital_denominator, 25);
  assert.equal(pilot.payer_denominator, 10);
  assert.equal(pilot.hospital_parsed_live, 0);
  assert.equal(pilot.payer_parsed_live, 0);
  assert.equal(pilot.live_parsed_sample_targets_met, false);
  assert.equal(pilot.scientific_acceptance, false);
  assert.equal(pilot.cohort_members_replaced, false);
  assert.ok(pilot.blockers.length >= 35);
});

test('a reviewer can reproduce the pricing task without mistaking a rate for observed payment or a legal-compliance judgment; implementer cannot self-approve', () => {
  assert.throws(() => refuseSelfApproval({ actor: 'implementer', role: 'implementer', approved: true }), { code: 'IMPLEMENTER_CANNOT_APPROVE_OWN_SCIENTIFIC_OUTPUT' });
  assert.throws(() => refuseSelfApproval({ actor: 'model', role: 'model', approved: true }), { code: 'IMPLEMENTER_CANNOT_APPROVE_OWN_SCIENTIFIC_OUTPUT' });
  assert.throws(() => qualifyMrf(cohorts, { selfApproved: true }), { code: 'IMPLEMENTER_CANNOT_APPROVE_OWN_SCIENTIFIC_OUTPUT' });
  const report = qualifyMrf(cohorts);
  assert.equal(report.scientific_acceptance, false);
  assert.equal(report.legal_compliance, false);
  assert.equal(report.observed_payment, false);
  assert.equal(report.discovery_research_layer, true);
  assert.equal(report.unbounded_national_rate_warehouse, false);
  assert.equal(report.expansion_families.family_count, EXPANSION_FAMILY_COUNT);
  assert.equal(report.expansion_families.all_have_documented_routes, true);
  assert.equal(expansionFamilyRoutes(cohorts).routes.every((route) => route.supported === false || route.route_documented), true);
  assert.ok(report.examples.hospital.caveats.some((caveat) => caveat.includes('not an observed paid claim') || caveat.includes('not an observed paid')));
  assert.ok(report.examples.payer.caveats.some((caveat) => caveat.includes('not observed payment')));
});
