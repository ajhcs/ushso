import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  BASELINE_DENOMINATOR,
  HOSPITAL_COUNT,
  INDEPENDENTLY_QUALIFIED_JOIN_ROUTES,
  LAST_GOOD_GENERATION,
  PAYER_COUNT,
  PRODUCT_COUNT,
  REVIEWED_JOIN_ROUTE_COUNT,
  blockedFetch,
  recomputeDenominators,
  replayJoins,
  verifyDataProgram,
} from '../../../scripts/research-program/verify-data-program.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('catalog and field denominators reconcile without counting not_attempted as success', () => {
  const denominators = recomputeDenominators();
  assert.equal(denominators.baseline_ids, BASELINE_DENOMINATOR);
  assert.equal(denominators.unique_baseline_ids, BASELINE_DENOMINATOR);
  assert.equal(denominators.source_run_dispositions.not_attempted, BASELINE_DENOMINATOR);
  assert.equal(denominators.not_attempted_is_not_success, true);
  assert.equal(denominators.success_total_counts_unattempted_work, false);
  assert.equal(denominators.products, PRODUCT_COUNT);
  assert.equal(denominators.hospital_candidates, HOSPITAL_COUNT);
  assert.equal(denominators.payer_candidates, PAYER_COUNT);
  assert.equal(denominators.isolated_record_ids, 4);
  assert.equal(denominators.generation, LAST_GOOD_GENERATION);
  assert.equal(denominators.full_catalog_review.kind, 'identity_accounting');
  assert.equal(denominators.sampled_upstream_validation.kind, 'distinct_from_full_catalog');
});

test('fifteen documented joins are not independently qualified and CCN is never NPI', () => {
  const joins = replayJoins();
  assert.equal(joins.reviewed_documented_routes, REVIEWED_JOIN_ROUTE_COUNT);
  assert.equal(joins.independently_qualified_routes, INDEPENDENTLY_QUALIFIED_JOIN_ROUTES);
  assert.equal(joins.r08_complete, false);
  assert.equal(joins.ccn_equals_npi, false);
});

test('requirement-by-requirement result does not accept R01-R16 or declare the program complete', async () => {
  const report = await verifyDataProgram();
  assert.equal(report.generation, LAST_GOOD_GENERATION);
  assert.equal(report.core.scientific_completeness_pass, false);
  assert.equal(report.core.r04_accepted, false);
  assert.equal(report.core.unknown_cells_counted_as_supported, false);
  assert.equal(report.mrf.live_parsed_sample_targets_met, false);
  assert.equal(report.mrf.scientific_acceptance, false);
  assert.equal(report.joins.r08_complete, false);
  assert.equal(report.machine.http_200_is_not_completed_research_task, true);
  assert.equal(report.machine.native_webmcp, 'untested');
  assert.equal(report.planned_prs_merged_is_not_program_completion, true);
  assert.equal(report.release_qualification_blocked, true);
  assert.equal(report.c0091, 'unresolved');
  const ids = report.requirements.map((row) => row.id);
  assert.deepEqual(ids, ['R01','R02','R03','R04','R05','R06','R07','R08','R09','R10','R11','R14','R15']);
  assert.ok(report.requirements.every((row) => row.accepted === false));
  assert.equal(report.requirements.find((row) => row.id === 'R03').result, 'fail');
  assert.equal(report.requirements.find((row) => row.id === 'R04').result, 'fail');
  assert.equal(report.requirements.find((row) => row.id === 'R08').result, 'fail');
  assert.equal(report.requirements.find((row) => row.id === 'R15').result, 'fail');
  assert.equal(report.last_good_generation_changed, false);
  const cohorts = JSON.parse(fs.readFileSync(path.join(ROOT, 'evaluation/research-program/cohorts.json'), 'utf8'));
  assert.ok(Object.values(cohorts.acceptance).every((value) => value === 'unaccepted'));
  assert.throws(() => blockedFetch(), /VERIFY_DATA_PROGRAM_FETCH_FORBIDDEN/);
});
