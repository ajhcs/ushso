#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueCoreQualificationReceipt, loadCohort } from './qualify-core.mjs';
import { qualifyDeterministic } from './qualify-deterministic.mjs';
import { reconcilePilot, expansionFamilyRoutes } from './qualify-mrf.mjs';
import { REVIEWED_JOIN_ROUTES, inspectJoinRoutes } from '../../packages/registry/qualified-join-routes.mjs';
import { loadScenarios } from './verify-machine.mjs';
import { evaluateCoreReadiness } from './core-readiness.mjs';

export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export const BASELINE_DENOMINATOR = 3434;
export const PRODUCT_COUNT = 100;
export const HOSPITAL_COUNT = 25;
export const PAYER_COUNT = 10;
export const EXPANSION_FAMILY_COUNT = 12;
export const REVIEWED_JOIN_ROUTE_COUNT = 15;
export const INDEPENDENTLY_QUALIFIED_JOIN_ROUTES = 0;
export const VERIFY_DATA_PROGRAM_FORMAT = 'ushso.pr079-data-program-acceptance.v1';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function sha256File(relative) {
  return createHash('sha256').update(readFileSync(path.join(ROOT, relative))).digest('hex');
}

function defaultCohortPath() {
  return path.join(ROOT, 'evaluation/research-program/cohorts.json');
}

export function recomputeDenominators(cohorts = JSON.parse(readFileSync(defaultCohortPath(), 'utf8'))) {
  const baseline = cohorts.baseline_records ?? [];
  const ids = baseline.map((row) => row.record_id);
  const unique = new Set(ids);
  if (ids.length !== BASELINE_DENOMINATOR) fail('BASELINE_DENOMINATOR_NOT_3434', String(ids.length));
  if (unique.size !== BASELINE_DENOMINATOR) fail('BASELINE_IDS_NOT_UNIQUE');
  if (cohorts.corpus?.record_count !== BASELINE_DENOMINATOR) fail('CORPUS_RECORD_COUNT_MISMATCH');
  if (cohorts.corpus?.generation !== LAST_GOOD_GENERATION) fail('LAST_GOOD_GENERATION_CHANGED');
  const isolatedListed = cohorts.corpus.isolated_record_ids ?? [];
  const isolatedMarked = baseline.filter((row) => row.isolated === true).map((row) => row.record_id);
  if (isolatedListed.length !== 4 || isolatedMarked.length !== 4) fail('ISOLATED_COUNT_NOT_4');
  if (isolatedListed.some((id) => !unique.has(id))) fail('ISOLATED_ID_NOT_IN_BASELINE');
  const dispositions = {};
  for (const row of baseline) {
    const d = row.source_run_disposition ?? 'missing';
    dispositions[d] = (dispositions[d] ?? 0) + 1;
  }
  const notAttempted = dispositions.not_attempted ?? 0;
  const succeeded = dispositions.succeeded ?? dispositions.accepted ?? 0;
  if (succeeded > 0 && notAttempted > 0) {
    // counting success while unattempted remain is forbidden
  }
  if (notAttempted === BASELINE_DENOMINATOR && succeeded !== 0) fail('SUCCESS_TOTAL_COUNTS_UNATTEMPTED_WORK');
  const products = cohorts.products ?? [];
  if (products.length !== PRODUCT_COUNT) fail('PRODUCT_DENOMINATOR_NOT_100', String(products.length));
  if (new Set(products.map((p) => p.product_key)).size !== PRODUCT_COUNT) fail('DUPLICATE_PRODUCT_KEYS');
  const hospitalIds = cohorts.mrf_selection?.hospital_candidate_ids ?? [];
  const payerIds = cohorts.mrf_selection?.payer_reporting_entity_candidate_ids ?? [];
  if (hospitalIds.length !== HOSPITAL_COUNT) fail('HOSPITAL_DENOMINATOR_NOT_25');
  if (payerIds.length !== PAYER_COUNT) fail('PAYER_DENOMINATOR_NOT_10');
  if (new Set(hospitalIds).size !== HOSPITAL_COUNT) fail('HOSPITAL_IDS_NOT_UNIQUE');
  if (new Set(payerIds).size !== PAYER_COUNT) fail('PAYER_IDS_NOT_UNIQUE');
  const families = cohorts.expansion_families?.families ?? [];
  if (families.length !== EXPANSION_FAMILY_COUNT) fail('EXPANSION_FAMILY_COUNT_NOT_12');
  const rRows = cohorts.acceptance ?? {};
  for (const id of ['R01','R02','R03','R04','R05','R06','R07','R08','R09','R10','R11','R12','R13','R14','R15','R16']) {
    if (rRows[id] !== 'unaccepted') fail('COHORT_ACCEPTANCE_ROW_NOT_UNACCEPTED', id);
  }
  return freeze({
    generation: LAST_GOOD_GENERATION,
    catalog_manifest_sha256: cohorts.corpus?.manifest_sha256 ?? null,
    baseline_ids: BASELINE_DENOMINATOR,
    unique_baseline_ids: unique.size,
    isolated_record_ids: isolatedListed.length,
    source_run_dispositions: freeze(dispositions),
    not_attempted_is_not_success: true,
    success_total_counts_unattempted_work: false,
    products: PRODUCT_COUNT,
    hospital_candidates: HOSPITAL_COUNT,
    payer_candidates: PAYER_COUNT,
    expansion_families: EXPANSION_FAMILY_COUNT,
    full_catalog_review: freeze({
      kind: 'identity_accounting',
      denominator: BASELINE_DENOMINATOR,
      note: 'Every frozen baseline ID is present and unique. This is not sampled upstream payload validation.',
    }),
    sampled_upstream_validation: freeze({
      kind: 'distinct_from_full_catalog',
      note: 'Bounded samples and fixture receipts remain sampled. They cannot stand in for 3,434 payload validations.',
    }),
  });
}

export function replayJoins() {
  if (REVIEWED_JOIN_ROUTES.length !== REVIEWED_JOIN_ROUTE_COUNT) fail('REVIEWED_JOIN_ROUTE_COUNT_NOT_15');
  const inspection = inspectJoinRoutes({ from_id: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17' });
  if (inspection.ccn_equals_npi !== false) fail('CCN_EQUALS_NPI_CLAIMED');
  if (inspection.r08_complete !== false) fail('R08_MARKED_COMPLETE');
  return freeze({
    reviewed_documented_routes: REVIEWED_JOIN_ROUTE_COUNT,
    independently_qualified_routes: INDEPENDENTLY_QUALIFIED_JOIN_ROUTES,
    r08_complete: false,
    ccn_equals_npi: false,
    name_only_equality: false,
    note: 'Fifteen documented priority routes exist. R08 remains incomplete until fifteen independently qualified routes actually hold.',
  });
}

function requirement({ id, result, evidence, remaining }) {
  return freeze({
    id,
    result,
    accepted: false,
    evidence,
    remaining_scope: remaining,
  });
}

export async function verifyDataProgram({ fetchImpl } = {}) {
  if (typeof fetchImpl === 'function') {
    await fetchImpl().catch(() => {
      throw new Error('VERIFY_DATA_PROGRAM_MUST_NOT_USE_LIVE_FETCH');
    });
  }
  const cohorts = loadCohort();
  const denominators = recomputeDenominators(cohorts);
  const core = issueCoreQualificationReceipt(cohorts);
  const readiness = evaluateCoreReadiness(cohorts);
  const deterministic = await qualifyDeterministic();
  const hospitalIds = cohorts.mrf_selection.hospital_candidate_ids;
  const payerIds = cohorts.mrf_selection.payer_reporting_entity_candidate_ids;
  const mrf = reconcilePilot(cohorts, {
    hospitalDispositions: hospitalIds.map((id) => ({ candidate_id: id, locator_materialized: false })),
    payerDispositions: payerIds.map((id) => ({ candidate_id: id, locator_materialized: false })),
  });
  const families = expansionFamilyRoutes(cohorts);
  const joins = replayJoins();
  const scenarios = loadScenarios();
  if (scenarios.generation !== LAST_GOOD_GENERATION) fail('MACHINE_SCENARIO_GENERATION_CHANGED');
  if (scenarios.http_200_is_not_completed_research_task !== true) fail('HTTP_200_BOUND_MISSING');
  if (scenarios.protocol_success_is_not_research_success !== true) fail('PROTOCOL_SUCCESS_BOUND_MISSING');
  const machineKinds = new Set(scenarios.scenarios.map((row) => row.kind));
  for (const kind of ['positive', 'partial', 'unknown', 'restricted', 'missing-source']) {
    if (!machineKinds.has(kind)) fail('MACHINE_SCENARIO_KIND_MISSING', kind);
  }
  if (scenarios.scenarios.some((row) => row.research_success === true)) fail('MACHINE_SCENARIO_CLAIMS_RESEARCH_SUCCESS');

  const plannedPrsMergedIsNotCompletion = true;
  const requirements = freeze([
    requirement({
      id: 'R01',
      result: 'unverified',
      evidence: '3434 unique baseline IDs exist and each has typed source_run_disposition=not_attempted. Identity accounting is not a completed source-run ledger.',
      remaining: 'PR-020 source-run dispositions remain unmaterialized. not_attempted is not success.',
    }),
    requirement({
      id: 'R02',
      result: 'unverified',
      evidence: 'Field-evidence contract exists. Freshness clock and 100% public factual-field evidence were not re-measured as a full-catalog pass.',
      remaining: 'Conditional field-evidence frame remains unaccepted.',
    }),
    requirement({
      id: 'R03',
      result: 'fail',
      evidence: `All ${BASELINE_DENOMINATOR} records remain source_run_disposition=not_attempted on four axes. not_attempted is not success.`,
      remaining: 'Attempt ledger must be frozen before R03 measurement.',
    }),
    requirement({
      id: 'R04',
      result: 'fail',
      evidence: `Core qualification retains a failed matrix. Engineering public-sample complete=${readiness.public_sample_complete}/80 is not R04 acceptance. Unknown cells are not counted as supported.`,
      remaining: 'Publisher access, schema qualification, join routes, and unit/grain/date/denominator remain unknown for the 100-product cohort.',
    }),
    requirement({
      id: 'R05',
      result: 'fail',
      evidence: 'Restricted/manual routes are not verified. r05_restricted_routes_verified=false.',
      remaining: 'Verified restricted/manual access routes remain required.',
    }),
    requirement({
      id: 'R06',
      result: 'fail',
      evidence: 'Deterministic qualification keeps unresolved dictionary, unit and key gaps failed. Unknown essential fields cannot count as supported.',
      remaining: 'Dictionary/unit/key residuals remain.',
    }),
    requirement({
      id: 'R07',
      result: 'fail',
      evidence: 'Failing retrieval domains still need bounded remediation. Scientific completeness pass=false.',
      remaining: 'R07 remains incomplete until failing retrieval domains have bounded remediation.',
    }),
    requirement({
      id: 'R08',
      result: 'fail',
      evidence: `${REVIEWED_JOIN_ROUTE_COUNT} documented priority join routes exist. Independently qualified routes=${INDEPENDENTLY_QUALIFIED_JOIN_ROUTES}. CCN=NPI remains forbidden.`,
      remaining: 'R08 remains incomplete below 15 independently qualified routes.',
    }),
    requirement({
      id: 'R09',
      result: 'unverified',
      evidence: 'Family pointers are frozen. Family usability is not accepted.',
      remaining: 'Twelve named families remain identity-frozen, not scientifically accepted.',
    }),
    requirement({
      id: 'R10',
      result: 'unverified',
      evidence: '25 hospital and 10 payer directory candidate IDs are frozen. Locators are not materialized.',
      remaining: 'Directory identity is not payload, parse, or TiC reporting-entity proof.',
    }),
    requirement({
      id: 'R11',
      result: 'unverified',
      evidence: 'Comparison/join caveats exist. Tiny samples cannot report universal match rates.',
      remaining: 'Independent comparison quality remains unaccepted.',
    }),
    requirement({
      id: 'R14',
      result: 'unverified',
      evidence: 'R14 protocol is published. Residual scientific-claim sample, labels, spend ledger, and 0.98 precision measurement are not materialized. No model is in public request handling in this candidate, but that is not the full conjunctive pass.',
      remaining: 'Held-out claim precision, zero critical scientific errors, and actual sample-size/CI design remain unrun.',
    }),
    requirement({
      id: 'R15',
      result: 'fail',
      evidence: 'Two complete scheduled cycles remain unrun until authorized. A 14-day observation window has not elapsed. Generated dates do not count.',
      remaining: 'PR-076/PR-084 actual cycles and elapsed days.',
    }),
  ]);

  if (requirements.some((row) => row.accepted === true)) fail('REQUIREMENT_ACCEPTED_WITHOUT_EVIDENCE');
  if (core.r04_accepted || core.r05_accepted || core.r07_accepted || core.r08_accepted) fail('CORE_REQUIREMENTS_ACCEPTED');
  if (core.scientific_completeness_pass !== false) fail('SCIENTIFIC_COMPLETENESS_PASS_TRUE');
  if (mrf.scientific_acceptance !== false) fail('MRF_SCIENTIFIC_ACCEPTANCE_TRUE');
  if (mrf.live_parsed_sample_targets_met !== false) fail('MRF_LIVE_TARGETS_MET');

  return freeze({
    format: VERIFY_DATA_PROGRAM_FORMAT,
    generation: LAST_GOOD_GENERATION,
    catalog_manifest_sha256: sha256File('evaluation/research-program/cohorts.json') && cohorts.corpus.manifest_sha256,
    cohorts_sha256: sha256File('evaluation/research-program/cohorts.json'),
    denominators,
    core: freeze({
      product_count: core.product_count,
      r04_accepted: core.r04_accepted,
      r05_accepted: core.r05_accepted,
      r07_accepted: core.r07_accepted,
      r08_accepted: core.r08_accepted,
      scientific_completeness_pass: core.scientific_completeness_pass,
      failed_matrix_retained: core.failed_matrix_retained,
      unknown_cells_counted_as_supported: core.unknown_cells_counted_as_supported,
      public_sample_complete: core.engineering_readiness.public_sample_complete,
      r04_engineering_target_met: core.engineering_readiness.r04_engineering_target_met,
    }),
    deterministic: freeze({
      last_good_generation: deterministic.last_good_generation ?? LAST_GOOD_GENERATION,
      r01_r16_accepted: false,
    }),
    mrf: freeze({
      hospital_denominator: mrf.hospital_denominator,
      payer_denominator: mrf.payer_denominator,
      hospital_parsed_live: mrf.hospital_parsed_live,
      payer_parsed_live: mrf.payer_parsed_live,
      live_parsed_sample_targets_met: mrf.live_parsed_sample_targets_met,
      scientific_acceptance: mrf.scientific_acceptance,
      unknown_cells_counted_as_supported: mrf.unknown_cells_counted_as_supported,
    }),
    expansion_families: freeze({
      family_count: families.family_count,
      all_have_documented_routes: families.all_have_documented_routes,
    }),
    joins,
    machine: freeze({
      advertised_tools: scenarios.advertised_tools.length,
      disabled_plan_research: scenarios.disabled_tools.includes('observatory.plan_research'),
      protocol_success_is_not_research_success: true,
      http_200_is_not_completed_research_task: true,
      native_webmcp: 'untested',
    }),
    requirements,
    planned_prs_merged_is_not_program_completion: plannedPrsMergedIsNotCompletion,
    release_qualification_blocked: true,
    c0091: 'unresolved',
    http_200_is_completed_research_task: false,
    passing_schema_is_scientific_approval: false,
    last_good_generation_changed: false,
    production_changed: false,
  });
}

export function blockedFetch() {
  throw new Error('VERIFY_DATA_PROGRAM_FETCH_FORBIDDEN');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const previous = globalThis.fetch;
  globalThis.fetch = blockedFetch;
  verifyDataProgram()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.code ?? error.name}: ${error.message}\n`);
      process.exitCode = 1;
    })
    .finally(() => {
      globalThis.fetch = previous;
    });
}
