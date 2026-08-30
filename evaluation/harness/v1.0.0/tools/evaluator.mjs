import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPublishedBenchmark } from './benchmark-loader.mjs';
import { validateRecord } from './schema-validator.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ZERO_RESULT_STATEMENT = 'Zero retrieved results are a bounded evaluation outcome and do not establish source or corpus absence.';
const OUTPUT_TIME = '2026-08-30T00:00:00.000Z';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value)), 'utf8').digest('hex');
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : round(numerator / denominator);
}

function referenceKey(reference) {
  return `${reference?.artifact_path ?? ''}|${reference?.locator ?? ''}|${reference?.evidence_id ?? ''}`;
}

function routeKey(sourceIds) {
  return [...sourceIds].sort().join('|');
}

export function compileGoldIntent(question) {
  return {
    question_id: question.question_id,
    research_intent: question.research_intent,
    required_measures: question.required_measures,
    excluded_measures: question.excluded_measures,
    geography: question.geography,
    geographic_granularity: question.geographic_granularity,
    time_period: question.time_period,
    unit_of_analysis: question.unit_of_analysis,
    required_access: question.required_access,
    authoritative_source_requirement: question.authoritative_source_requirement,
    expected_response_type: question.expected_response_type,
    clarification_needed: question.clarification_needed
  };
}

async function validateInput(input) {
  const schema = JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, 'schemas/runner-input.schema.json'), 'utf8'));
  const errors = validateRecord(input, schema);
  if (errors.length) throw new Error(`RUNNER_INPUT_SCHEMA_INVALID:${errors.join(';')}`);
  if ([...input.k_values].sort((a, b) => a - b).some((value, index) => value !== input.k_values[index])) throw new Error('K_VALUES_MUST_BE_ASCENDING');
  if (new Set(input.cases.map(item => item.question_id)).size !== input.cases.length) throw new Error('DUPLICATE_QUESTION_CASE');
  for (const item of input.cases) {
    const results = item.result_bundle.results;
    if (new Set(results.map(result => result.source_record_id)).size !== results.length) throw new Error(`DUPLICATE_RESULT_SOURCE:${item.question_id}`);
    if (results.some((result, index) => result.rank !== index + 1)) throw new Error(`RESULT_RANKS_NOT_CONTIGUOUS:${item.question_id}`);
    if (item.result_bundle.result_state === 'zero_results') {
      if (results.length !== 0 || item.result_bundle.zero_result === null) throw new Error(`ZERO_RESULT_SHAPE_INVALID:${item.question_id}`);
      if (item.result_bundle.zero_result.corpus_absence_claimed !== false || item.result_bundle.zero_result.statement !== ZERO_RESULT_STATEMENT) throw new Error(`ZERO_RESULT_ABSENCE_CLAIM_REJECTED:${item.question_id}`);
    } else if (results.length === 0 || item.result_bundle.zero_result !== null) throw new Error(`NONZERO_RESULT_SHAPE_INVALID:${item.question_id}`);
  }
}

function evaluateCase(item, benchmark, kValues) {
  const question = benchmark.questionById.get(item.question_id);
  if (!question) throw new Error(`QUESTION_NOT_IN_BENCHMARK:${item.question_id}`);
  const positives = benchmark.positiveByQuestion.get(item.question_id) ?? [];
  const negatives = benchmark.negativeByQuestion.get(item.question_id) ?? [];
  const plan = benchmark.planByQuestion.get(item.question_id);
  const bundle = benchmark.bundleByQuestion.get(item.question_id) ?? null;
  const acceptable = [...new Set(positives.filter(judgment => judgment.recommendation_allowed === true).map(judgment => judgment.source_record_id))].sort();
  const mustNotMiss = [...new Set(positives.filter(judgment => judgment.label === 'essential').map(judgment => judgment.source_record_id))].sort();
  const restrictions = [...new Set(plan.important_limitations)].sort();
  const ranked = [...item.result_bundle.results].sort((left, right) => left.rank - right.rank);

  const topK = kValues.map(k => {
    const ids = new Set(ranked.filter(result => result.rank <= k && result.recommendation_state === 'recommended').map(result => result.source_record_id));
    const mustHits = mustNotMiss.filter(id => ids.has(id)).length;
    const acceptableHits = acceptable.filter(id => ids.has(id)).length;
    return {
      k,
      must_not_miss_hits: mustHits,
      must_not_miss_total: mustNotMiss.length,
      must_not_miss_recall: ratio(mustHits, mustNotMiss.length),
      acceptable_source_hits: acceptableHits,
      acceptable_source_total: acceptable.length,
      acceptable_source_coverage: ratio(acceptableHits, acceptable.length)
    };
  });

  const actualIntentDigest = digest(item.intent_compilation);
  const expectedIntentDigest = digest(compileGoldIntent(question));
  const judgmentBySource = new Map([...positives, ...negatives].map(judgment => [judgment.source_record_id, judgment]));
  let accessCorrect = 0;
  let provenanceMatched = 0;
  let provenanceExpected = 0;
  for (const result of ranked) {
    const judgment = judgmentBySource.get(result.source_record_id);
    if (judgment && result.access_implications === judgment.access_implications) accessCorrect += 1;
    if (judgment) {
      const supplied = new Set(result.provenance_references.map(referenceKey));
      const expected = [...new Set(judgment.evidence_references.map(referenceKey))];
      provenanceExpected += expected.length;
      provenanceMatched += expected.filter(key => supplied.has(key)).length;
    }
  }

  const surfacedRestrictions = new Set(item.result_bundle.important_restrictions);
  const restrictionHits = restrictions.filter(restriction => surfacedRestrictions.has(restriction)).length;
  const goldRoutes = bundle?.join_assessments ?? [];
  const goldRouteByKey = new Map(goldRoutes.map(route => [routeKey(route.source_record_ids), route]));
  let correctRouteProposals = 0;
  const coveredGoldRoutes = new Set();
  for (const route of item.result_bundle.join_routes) {
    const key = routeKey(route.source_record_ids);
    const gold = goldRouteByKey.get(key);
    if (gold && route.status === gold.status) {
      correctRouteProposals += 1;
      coveredGoldRoutes.add(key);
    }
  }
  const requiredCrosswalkIds = [...new Set((bundle?.required_crosswalks ?? []).filter(item => item.required).map(item => item.crosswalk_id))];
  const suppliedCrosswalkIds = new Set(item.result_bundle.join_routes.flatMap(route => route.crosswalk_ids));
  const crosswalkHits = requiredCrosswalkIds.filter(id => suppliedCrosswalkIds.has(id)).length;
  const unacceptableRecommended = ranked.filter(result => result.recommendation_state === 'recommended' && !acceptable.includes(result.source_record_id)).map(result => result.source_record_id);
  const zeroApplicable = item.result_bundle.result_state === 'zero_results';

  const accessScore = ratio(accessCorrect, ranked.length);
  const provenanceScore = ratio(provenanceMatched, provenanceExpected);
  const routeProposalScore = item.result_bundle.join_routes.length === 0 ? (goldRoutes.length === 0 ? 1 : null) : ratio(correctRouteProposals, item.result_bundle.join_routes.length);
  const routeCoverage = ratio(coveredGoldRoutes.size, goldRoutes.length);
  const crosswalkCoverage = ratio(crosswalkHits, requiredCrosswalkIds.length);
  const zeroValid = !zeroApplicable || (item.result_bundle.zero_result.corpus_absence_claimed === false && item.result_bundle.zero_result.statement === ZERO_RESULT_STATEMENT);

  return {
    evaluation_version: 'o8-question-evaluation.v1',
    question_id: item.question_id,
    gold_contract: {
      acceptable_sources: acceptable,
      must_not_miss_sources: mustNotMiss,
      important_restrictions: restrictions
    },
    intent_compilation: {
      correct: actualIntentDigest === expectedIntentDigest,
      expected_digest: expectedIntentDigest,
      actual_digest: actualIntentDigest
    },
    result_bundle: {
      result_state: item.result_bundle.result_state,
      result_count: ranked.length,
      digest: digest(item.result_bundle),
      unacceptable_recommended_sources: unacceptableRecommended
    },
    top_k: topK,
    important_restriction_coverage: {
      matched: restrictionHits,
      expected: restrictions.length,
      score: ratio(restrictionHits, restrictions.length)
    },
    access_state_correctness: {
      correct: accessCorrect,
      evaluated: ranked.length,
      score: accessScore
    },
    provenance_completeness: {
      matched_references: provenanceMatched,
      expected_references: provenanceExpected,
      score: provenanceScore
    },
    join_route_correctness: {
      correct_proposals: correctRouteProposals,
      proposed_routes: item.result_bundle.join_routes.length,
      proposal_score: routeProposalScore,
      covered_gold_routes: coveredGoldRoutes.size,
      gold_routes: goldRoutes.length,
      route_coverage: routeCoverage,
      required_crosswalks_matched: crosswalkHits,
      required_crosswalks: requiredCrosswalkIds.length,
      crosswalk_coverage: crosswalkCoverage
    },
    zero_result_not_absence: {
      applicable: zeroApplicable,
      valid: zeroValid,
      corpus_absence_claimed: zeroApplicable ? item.result_bundle.zero_result.corpus_absence_claimed : false,
      statement: ZERO_RESULT_STATEMENT
    },
    gates: {
      intent_correct: actualIntentDigest === expectedIntentDigest,
      no_unacceptable_recommendations: unacceptableRecommended.length === 0,
      access_state_correct: accessScore === null || accessScore === 1,
      provenance_complete: provenanceScore === null || provenanceScore === 1,
      restrictions_complete: ratio(restrictionHits, restrictions.length) === 1,
      joins_not_overstated: routeProposalScore === null || routeProposalScore === 1,
      required_join_routes_covered: routeCoverage === null || routeCoverage === 1,
      required_crosswalks_covered: crosswalkCoverage === null || crosswalkCoverage === 1,
      zero_result_scoped: zeroValid
    }
  };
}

function macro(values) {
  const eligible = values.filter(value => value !== null);
  return eligible.length === 0 ? null : round(eligible.reduce((sum, value) => sum + value, 0) / eligible.length);
}

export async function evaluateRun(input, { benchmark } = {}) {
  await validateInput(input);
  if (!benchmark) throw new Error('BENCHMARK_REQUIRED');
  const evaluations = [...input.cases].sort((left, right) => left.question_id.localeCompare(right.question_id)).map(item => evaluateCase(item, benchmark, input.k_values));
  const macroTopK = input.k_values.map(k => ({
    k,
    must_not_miss_recall: macro(evaluations.map(item => item.top_k.find(metric => metric.k === k).must_not_miss_recall)),
    acceptable_source_coverage: macro(evaluations.map(item => item.top_k.find(metric => metric.k === k).acceptable_source_coverage))
  }));
  return {
    report_version: 'o8-evaluation-run-report.v1',
    run_id: input.run_id,
    generated_at: OUTPUT_TIME,
    benchmark: { mode: benchmark.mode, source: benchmark.source },
    k_values: input.k_values,
    question_count: evaluations.length,
    question_evaluations: evaluations,
    macro_metrics: {
      top_k: macroTopK,
      intent_compilation_accuracy: macro(evaluations.map(item => item.intent_compilation.correct ? 1 : 0)),
      important_restriction_coverage: macro(evaluations.map(item => item.important_restriction_coverage.score)),
      access_state_correctness: macro(evaluations.map(item => item.access_state_correctness.score)),
      provenance_completeness: macro(evaluations.map(item => item.provenance_completeness.score)),
      join_route_proposal_correctness: macro(evaluations.map(item => item.join_route_correctness.proposal_score)),
      join_route_coverage: macro(evaluations.map(item => item.join_route_correctness.route_coverage)),
      zero_result_cases: evaluations.filter(item => item.zero_result_not_absence.applicable).length,
      zero_result_scoped_correctly: evaluations.filter(item => item.zero_result_not_absence.applicable && item.zero_result_not_absence.valid).length
    },
    external_requests: 0,
    ranking_optimized: false,
    llm_used: false,
    identity_work_performed: false,
    coverage_execution_performed: false,
    heavy_analysis_lock_touched: false
  };
}

export async function runPublishedEvaluation(input, options = {}) {
  return evaluateRun(input, { benchmark: await loadPublishedBenchmark(options) });
}
