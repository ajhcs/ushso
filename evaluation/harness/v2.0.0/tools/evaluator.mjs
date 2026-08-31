import fs from 'node:fs/promises';
import path from 'node:path';
import { PACKAGE_ROOT, canonicalJson, readJson, sha256 } from './integrity.mjs';
import { loadBenchmark } from './benchmark-loader.mjs';

export const EVALUATOR_VERSION = 'ushso-retrieval-evaluator.v2.0.0';
export const REPORT_VERSION = 'ushso-retrieval-evaluation-report.v2.0.0';
export const ZERO_RESULT_STATEMENT = 'Zero retrieved results are bounded to the pinned evaluated generation and do not establish source absence.';
const GENERATED_AT = '2026-08-30T00:00:00.000Z';
const VALID_COHORT_STATUSES = new Set(['present_search_eligible', 'present_but_excluded', 'missing']);
const REQUIRED_PIN_KEYS = [
  'corpus_manifest_sha256',
  'content_fingerprint_sha256',
  'records_sha256',
  'search_documents_sha256',
  'vocabulary_sha256',
  'algorithm_fingerprint_sha256',
  'benchmark_pin_sha256',
  'cohort_manifest_sha256',
  'metric_contract_sha256'
];

function round(value) {
  return value === null ? null : Math.round(value * 1_000_000) / 1_000_000;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function unique(values) {
  return [...new Set(values)];
}

function sortedUnique(values) {
  return unique(values).sort((left, right) => left.localeCompare(right));
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`EVALUATOR_INPUT_INVALID:${label}`);
}

function validateCohort(cohort, benchmark) {
  if (cohort?.manifest_version !== 'ushso-retrieval-present-source-cohort.v1') throw new Error('COHORT_VERSION_INVALID');
  const benchmarkSources = new Set(benchmark.sourceIndex.sources.map(source => source.source_record_id));
  const classifications = new Map();
  for (const item of cohort.source_classifications ?? []) {
    requireString(item.source_record_id, 'cohort.source_record_id');
    if (!benchmarkSources.has(item.source_record_id)) throw new Error(`COHORT_UNKNOWN_SOURCE:${item.source_record_id}`);
    if (!VALID_COHORT_STATUSES.has(item.status)) throw new Error(`COHORT_STATUS_INVALID:${item.source_record_id}`);
    if (classifications.has(item.source_record_id)) throw new Error(`COHORT_SOURCE_DUPLICATE:${item.source_record_id}`);
    classifications.set(item.source_record_id, item);
  }
  if (classifications.size !== benchmarkSources.size) throw new Error(`COHORT_SOURCE_COVERAGE_INVALID:${classifications.size}:${benchmarkSources.size}`);

  const positiveIds = new Set(benchmark.positives.map(judgment => judgment.judgment_id));
  const requirements = new Map();
  for (const item of cohort.requirements ?? []) {
    if (!positiveIds.has(item.judgment_id)) throw new Error(`COHORT_UNKNOWN_REQUIREMENT:${item.judgment_id}`);
    if (!VALID_COHORT_STATUSES.has(item.status)) throw new Error(`COHORT_REQUIREMENT_STATUS_INVALID:${item.judgment_id}`);
    if (requirements.has(item.judgment_id)) throw new Error(`COHORT_REQUIREMENT_DUPLICATE:${item.judgment_id}`);
    const sourceStatus = classifications.get(item.source_record_id)?.status;
    if (sourceStatus !== item.status) throw new Error(`COHORT_REQUIREMENT_SOURCE_STATUS_DRIFT:${item.judgment_id}`);
    requirements.set(item.judgment_id, item);
  }
  if (requirements.size !== positiveIds.size) throw new Error(`COHORT_REQUIREMENT_COVERAGE_INVALID:${requirements.size}:${positiveIds.size}`);

  const bindings = new Map();
  for (const item of cohort.asset_bindings ?? []) {
    requireString(item.record_id, 'cohort.asset_binding.record_id');
    if (!benchmarkSources.has(item.canonical_source_id)) throw new Error(`COHORT_BINDING_UNKNOWN_SOURCE:${item.record_id}`);
    if (classifications.get(item.canonical_source_id)?.status !== 'present_search_eligible') throw new Error(`COHORT_BINDING_TO_INELIGIBLE_SOURCE:${item.record_id}`);
    if (bindings.has(item.record_id)) throw new Error(`COHORT_BINDING_DUPLICATE:${item.record_id}`);
    bindings.set(item.record_id, item);
  }
  return { classifications, requirements, bindings };
}

function validateInput(input, metricContract, expectedPins) {
  if (input?.input_version !== 'ushso-retrieval-evaluator-input.v2.0.0') throw new Error('EVALUATOR_INPUT_VERSION_INVALID');
  requireString(input.run_id, 'run_id');
  requireString(input.lane_id, 'lane_id');
  if (JSON.stringify(input.k_values) !== JSON.stringify(metricContract.k_values)) throw new Error('EVALUATOR_K_VALUES_NOT_FROZEN');
  if (!Array.isArray(input.cases) || input.cases.length < 1 || input.cases.length > 60) throw new Error('EVALUATOR_CASE_COUNT_INVALID');
  if (new Set(input.cases.map(item => item.question_id)).size !== input.cases.length) throw new Error('EVALUATOR_CASE_DUPLICATE');
  for (const key of REQUIRED_PIN_KEYS) {
    if (!/^[a-f0-9]{64}$/.test(input.pins?.[key] ?? '')) throw new Error(`EVALUATOR_PIN_INVALID:${key}`);
  }
  for (const [key, expected] of Object.entries(expectedPins)) {
    if (input.pins?.[key] !== expected) throw new Error(`EVALUATOR_PIN_MISMATCH:${key}`);
  }
  for (const item of input.cases) {
    requireString(item.question_id, 'case.question_id');
    const bundle = item.result_bundle;
    if (!bundle || !['results', 'zero_results'].includes(bundle.result_state)) throw new Error(`EVALUATOR_RESULT_STATE_INVALID:${item.question_id}`);
    if (!Array.isArray(bundle.results) || bundle.results.length > 50) throw new Error(`EVALUATOR_RESULTS_INVALID:${item.question_id}`);
    if (new Set(bundle.results.map(result => result.record_id)).size !== bundle.results.length) throw new Error(`EVALUATOR_RESULT_RECORD_DUPLICATE:${item.question_id}`);
    if (bundle.results.some((result, index) => result.rank !== index + 1)) throw new Error(`EVALUATOR_RANKS_NOT_CONTIGUOUS:${item.question_id}`);
    if (bundle.result_state === 'zero_results') {
      if (bundle.results.length !== 0 || !bundle.zero_result) throw new Error(`EVALUATOR_ZERO_RESULT_INVALID:${item.question_id}`);
    } else if (bundle.results.length === 0 || bundle.zero_result !== null) {
      throw new Error(`EVALUATOR_NONZERO_RESULT_INVALID:${item.question_id}`);
    }
  }
}

function canonicalResult(result, bindings) {
  return bindings.get(result.record_id)?.canonical_source_id ?? null;
}

function rankedAtK(results, k, bindings) {
  const seen = new Set();
  return results.filter(result => result.rank <= k && result.recommendation_state === 'recommended').map(result => {
    const canonical_source_id = canonicalResult(result, bindings);
    const duplicate = canonical_source_id !== null && seen.has(canonical_source_id);
    if (canonical_source_id !== null) seen.add(canonical_source_id);
    return { result, canonical_source_id, duplicate };
  });
}

function goldSets(positives, requirementStatus, statusFilter = null) {
  const selected = statusFilter === null ? positives : positives.filter(judgment => requirementStatus.get(judgment.judgment_id)?.status === statusFilter);
  const essential = sortedUnique(selected.filter(judgment => judgment.label === 'essential').map(judgment => judgment.source_record_id));
  const acceptable = sortedUnique(selected.filter(judgment => judgment.recommendation_allowed === true).map(judgment => judgment.source_record_id));
  const gainBySource = new Map();
  return { selected, essential, acceptable, gainBySource };
}

function gainMap(selected, gains) {
  const output = new Map();
  for (const judgment of selected) output.set(judgment.source_record_id, Math.max(output.get(judgment.source_record_id) ?? 0, gains[judgment.label] ?? 0));
  return output;
}

function questionMetric(results, k, bindings, gold, gains) {
  const ranked = rankedAtK(results, k, bindings);
  const uniqueCanonical = new Set(ranked.filter(item => item.canonical_source_id !== null && !item.duplicate).map(item => item.canonical_source_id));
  const essentialHits = gold.essential.filter(id => uniqueCanonical.has(id)).length;
  const acceptableHits = gold.acceptable.filter(id => uniqueCanonical.has(id)).length;
  const gainBySource = gainMap(gold.selected, gains);
  let strictHits = 0;
  let gradedGain = 0;
  for (const item of ranked) {
    if (item.canonical_source_id === null || item.duplicate) continue;
    if (gainBySource.has(item.canonical_source_id)) strictHits += 1;
    gradedGain += gainBySource.get(item.canonical_source_id) ?? 0;
  }
  return {
    k,
    essential: { hits: essentialHits, total: gold.essential.length, score: round(ratio(essentialHits, gold.essential.length)) },
    acceptable_coverage: { hits: acceptableHits, total: gold.acceptable.length, score: round(ratio(acceptableHits, gold.acceptable.length)) },
    strict_precision: { hits: strictHits, slots: k, score: round(strictHits / k) },
    graded_precision: { gain: round(gradedGain), slots: k, score: round(gradedGain / k) },
    returned: ranked.length,
    duplicates: ranked.filter(item => item.duplicate).length,
    unmatched: ranked.filter(item => item.canonical_source_id === null).length
  };
}

function roleMetric(bundle, results, k, bindings, classifications, cohort) {
  if (!bundle) return { hits: 0, total: 0, score: null };
  const sources = new Set(rankedAtK(results, k, bindings).filter(item => !item.duplicate && item.canonical_source_id !== null).map(item => item.canonical_source_id));
  const roles = (bundle.required_analytical_roles ?? []).filter(role => role.required === true).filter(role => {
    if (cohort === 'full') return true;
    return (role.source_record_ids ?? []).some(id => classifications.get(id)?.status === 'present_search_eligible');
  });
  const hits = roles.filter(role => (role.source_record_ids ?? []).some(id => sources.has(id))).length;
  return { hits, total: roles.length, score: round(ratio(hits, roles.length)) };
}

function routeKey(sourceIds) {
  return sortedUnique(sourceIds).join('|');
}

function safetyMetrics(item, benchmark, bindings) {
  const negatives = benchmark.negativesByQuestion.get(item.question_id) ?? [];
  const negativeBySource = new Map(negatives.map(judgment => [judgment.source_record_id, judgment]));
  let prohibitedByAccess = 0;
  let unacceptable = 0;
  let unresolvedExact = 0;
  let missingReasons = 0;
  for (const result of item.result_bundle.results.filter(result => result.recommendation_state === 'recommended')) {
    const canonical = canonicalResult(result, bindings);
    const negative = canonical === null ? null : negativeBySource.get(canonical);
    if (negative) unacceptable += 1;
    if (negative?.label === 'prohibited_by_access_constraint') prohibitedByAccess += 1;
    if (result.identity_presentation === 'exact' && ['unresolved', 'candidate', 'ambiguous'].includes(result.identity_resolution_state)) unresolvedExact += 1;
    if (result.rank <= 5 && !result.why_relevant && result.recommendation_state !== 'mentioned_as_limitation') missingReasons += 1;
  }

  const bundle = benchmark.bundleByQuestion.get(item.question_id);
  const goldRoutes = new Map((bundle?.join_assessments ?? []).map(route => [routeKey(route.source_record_ids), route.status]));
  let unsupportedJoinUpgrades = 0;
  for (const route of item.result_bundle.join_routes ?? []) {
    const canonical = route.record_ids.map(id => bindings.get(id)?.canonical_source_id).filter(Boolean);
    if (route.status === 'join_proven' && goldRoutes.get(routeKey(canonical)) !== 'join_proven') unsupportedJoinUpgrades += 1;
  }
  const zeroAbsence = item.result_bundle.zero_result?.corpus_absence_claimed === true ? 1 : 0;
  return {
    prohibited_by_access_recommendations: prohibitedByAccess,
    unacceptable_recommendations: unacceptable,
    unsupported_join_upgrades: unsupportedJoinUpgrades,
    unresolved_identity_presented_as_exact: unresolvedExact,
    zero_result_absence_claims: zeroAbsence,
    top_five_without_match_reason: missingReasons
  };
}

function aggregateRecall(questionMetrics, field) {
  const eligible = questionMetrics.map(item => item[field]).filter(metric => metric.total > 0);
  const scoreSum = eligible.reduce((sum, metric) => sum + metric.hits / metric.total, 0);
  const hits = eligible.reduce((sum, metric) => sum + metric.hits, 0);
  const total = eligible.reduce((sum, metric) => sum + metric.total, 0);
  return {
    macro: { numerator: round(scoreSum), denominator: eligible.length, score: round(ratio(scoreSum, eligible.length)) },
    micro: { numerator: hits, denominator: total, score: round(ratio(hits, total)) }
  };
}

function aggregatePrecision(questionMetrics, field, numeratorField) {
  const numerator = questionMetrics.reduce((sum, metric) => sum + metric[field][numeratorField], 0);
  const denominator = questionMetrics.reduce((sum, metric) => sum + metric[field].slots, 0);
  return { numerator: round(numerator), denominator, score: round(ratio(numerator, denominator)) };
}

function aggregateRoles(questionRoles) {
  const eligible = questionRoles.filter(metric => metric.total > 0);
  const hits = eligible.reduce((sum, metric) => sum + metric.hits, 0);
  const total = eligible.reduce((sum, metric) => sum + metric.total, 0);
  return { numerator: hits, denominator: total, score: round(ratio(hits, total)), eligible_questions: eligible.length };
}

function cohortBreakdown(cohort) {
  const count = (rows, status) => rows.filter(item => item.status === status).length;
  return {
    sources: {
      present_search_eligible: count(cohort.source_classifications, 'present_search_eligible'),
      present_but_excluded: count(cohort.source_classifications, 'present_but_excluded'),
      missing: count(cohort.source_classifications, 'missing')
    },
    requirements: {
      present_search_eligible: count(cohort.requirements, 'present_search_eligible'),
      present_but_excluded: count(cohort.requirements, 'present_but_excluded'),
      missing: count(cohort.requirements, 'missing')
    },
    essential_requirements: {
      present_search_eligible: cohort.requirements.filter(item => item.label === 'essential' && item.status === 'present_search_eligible').length,
      present_but_excluded: cohort.requirements.filter(item => item.label === 'essential' && item.status === 'present_but_excluded').length,
      missing: cohort.requirements.filter(item => item.label === 'essential' && item.status === 'missing').length
    }
  };
}

function aggregateCohort(questionEvaluations, kValues, cohortName) {
  const key = cohortName === 'full_benchmark' ? 'full' : 'present';
  return {
    top_k: kValues.map(k => {
      const metrics = questionEvaluations.map(item => item.metrics[key].find(metric => metric.k === k));
      const roles = questionEvaluations.map(item => item.roles[key].find(metric => metric.k === k));
      return {
        k,
        essential_recall: aggregateRecall(metrics, 'essential'),
        legacy_acceptable_source_coverage: aggregateRecall(metrics, 'acceptable_coverage').macro,
        strict_exact_gold_precision: aggregatePrecision(metrics, 'strict_precision', 'hits'),
        graded_acceptable_precision: aggregatePrecision(metrics, 'graded_precision', 'gain'),
        required_role_coverage: aggregateRoles(roles),
        short_list_count: metrics.filter(metric => metric.returned < k).length,
        duplicate_result_count: metrics.reduce((sum, metric) => sum + metric.duplicates, 0),
        unmatched_result_count: metrics.reduce((sum, metric) => sum + metric.unmatched, 0)
      };
    }),
    null_gold_count: questionEvaluations.filter(item => item.metrics[key][0].essential.total === 0).length
  };
}

export async function evaluateRun(input, { benchmark, cohort, metricContract, expectedPins } = {}) {
  const resolvedBenchmark = benchmark ?? await loadBenchmark();
  const resolvedMetricContract = metricContract ?? await readJson(path.join(PACKAGE_ROOT, 'metric-contract.json'));
  if (!cohort) throw new Error('COHORT_REQUIRED');
  const cohortState = validateCohort(cohort, resolvedBenchmark);
  validateInput(input, resolvedMetricContract, expectedPins ?? {});

  const gains = resolvedMetricContract.graded_acceptable_precision.normalized_gains;
  const questionEvaluations = [...input.cases].sort((a, b) => a.question_id.localeCompare(b.question_id)).map(item => {
    if (!resolvedBenchmark.questionById.has(item.question_id)) throw new Error(`QUESTION_NOT_IN_BENCHMARK:${item.question_id}`);
    const positives = resolvedBenchmark.positivesByQuestion.get(item.question_id) ?? [];
    const bundle = resolvedBenchmark.bundleByQuestion.get(item.question_id) ?? null;
    const fullGold = goldSets(positives, cohortState.requirements, null);
    const presentGold = goldSets(positives, cohortState.requirements, 'present_search_eligible');
    return {
      question_id: item.question_id,
      split: resolvedBenchmark.splitByQuestion.get(item.question_id),
      result_count: item.result_bundle.results.length,
      result_digest_sha256: sha256(canonicalJson(item.result_bundle)),
      metrics: {
        full: input.k_values.map(k => questionMetric(item.result_bundle.results, k, cohortState.bindings, fullGold, gains)),
        present: input.k_values.map(k => questionMetric(item.result_bundle.results, k, cohortState.bindings, presentGold, gains))
      },
      roles: {
        full: input.k_values.map(k => ({ k, ...roleMetric(bundle, item.result_bundle.results, k, cohortState.bindings, cohortState.classifications, 'full') })),
        present: input.k_values.map(k => ({ k, ...roleMetric(bundle, item.result_bundle.results, k, cohortState.bindings, cohortState.classifications, 'present') }))
      },
      safety: safetyMetrics(item, resolvedBenchmark, cohortState.bindings)
    };
  });

  const safety = {};
  for (const name of ['prohibited_by_access_recommendations', 'unacceptable_recommendations', 'unsupported_join_upgrades', 'unresolved_identity_presented_as_exact', 'zero_result_absence_claims', 'top_five_without_match_reason']) {
    safety[name] = questionEvaluations.reduce((sum, item) => sum + item.safety[name], 0);
  }
  safety.zero_tolerance_pass = resolvedMetricContract.safety_zero_tolerance.every(name => safety[name] === 0);

  return {
    report_version: REPORT_VERSION,
    evaluator_version: EVALUATOR_VERSION,
    run_id: input.run_id,
    lane_id: input.lane_id,
    generated_at: GENERATED_AT,
    pins: structuredClone(input.pins),
    k_values: [...input.k_values],
    question_count: questionEvaluations.length,
    split_counts: Object.fromEntries(['development', 'validation', 'held_out'].map(split => [split, questionEvaluations.filter(item => item.split === split).length])),
    cohort_breakdown: cohortBreakdown(cohort),
    metrics: {
      full_benchmark: aggregateCohort(questionEvaluations, input.k_values, 'full_benchmark'),
      present_source: aggregateCohort(questionEvaluations, input.k_values, 'present_source')
    },
    safety,
    question_evaluations: questionEvaluations,
    execution_boundary: {
      external_requests: 0,
      ranking_optimization_performed: false,
      llm_used: false,
      source_payloads_accessed: 0,
      analyses_executed: 0,
      identity_merges_performed: 0
    }
  };
}

export async function loadMetricContract() {
  return readJson(path.join(PACKAGE_ROOT, 'metric-contract.json'));
}

export async function metricContractSha256() {
  return sha256(await fs.readFile(path.join(PACKAGE_ROOT, 'metric-contract.json')));
}
