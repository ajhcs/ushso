import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBenchmark } from '../tools/benchmark-loader.mjs';
import { evaluateRun, loadMetricContract } from '../tools/evaluator.mjs';

const HASH = 'a'.repeat(64);
const PIN_KEYS = [
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
const PINS = Object.fromEntries(PIN_KEYS.map(key => [key, HASH]));

function testCohort(benchmark, aliases = []) {
  const sourceClassifications = benchmark.sourceIndex.sources.map(source => ({
    source_record_id: source.source_record_id,
    source_family_id: source.source_family_id,
    status: 'present_search_eligible',
    reason: 'Test fixture: all frozen sources are eligible.',
    record_ids: [source.source_record_id, ...aliases.filter(alias => alias.canonical_source_id === source.source_record_id).map(alias => alias.record_id)]
  }));
  const requirements = benchmark.positives.map(judgment => ({
    judgment_id: judgment.judgment_id,
    question_id: judgment.question_id,
    source_record_id: judgment.source_record_id,
    analytical_role: judgment.analytical_role,
    label: judgment.label,
    status: 'present_search_eligible',
    reason: 'Test fixture: source is eligible.'
  }));
  const direct = benchmark.sourceIndex.sources.map(source => ({
    record_id: source.source_record_id,
    source_native_id: source.source_record_id,
    canonical_source_id: source.source_record_id,
    basis: 'record_id_exact',
    evidence: 'Test fixture exact identity.',
    search_eligible: true
  }));
  return {
    manifest_version: 'ushso-retrieval-present-source-cohort.v1',
    generated_at: '2026-08-30T00:00:00.000Z',
    current_generation: {},
    status_vocabulary: ['present_search_eligible', 'present_but_excluded', 'missing'],
    source_classifications: sourceClassifications,
    requirements,
    asset_bindings: [...direct, ...aliases],
    counts: {},
    review: {}
  };
}

function rankedResult(recordId, rank, overrides = {}) {
  return {
    rank,
    record_id: recordId,
    source_id: recordId,
    family_id: null,
    recommendation_state: 'recommended',
    access_status: 'public',
    why_relevant: 'Matches a frozen analytical role.',
    identity_resolution_state: 'resolved',
    identity_presentation: 'record_native',
    ...overrides
  };
}

function input(questionId, results, overrides = {}) {
  const zero = results.length === 0;
  return {
    input_version: 'ushso-retrieval-evaluator-input.v2.0.0',
    run_id: 'evaluator-contract-test',
    lane_id: 'synthetic',
    pins: { ...PINS },
    k_values: [1, 3, 5, 10, 20],
    cases: [{
      question_id: questionId,
      result_bundle: {
        result_state: zero ? 'zero_results' : 'results',
        results,
        join_routes: [],
        zero_result: zero ? {
          reason_code: 'no_match_in_pinned_generation',
          corpus_absence_claimed: false,
          statement: 'Bounded synthetic zero result.'
        } : null,
        ...overrides
      }
    }]
  };
}

async function fixture() {
  const [benchmark, metricContract] = await Promise.all([loadBenchmark(), loadMetricContract()]);
  return { benchmark, metricContract };
}

test('duplicate equivalents earn credit once, consume rank slots, and short lists divide by k', async () => {
  const { benchmark, metricContract } = await fixture();
  const canonical = 'pa_phc4_financial_ownership';
  const alias = {
    record_id: 'fixture:pa-phc4-equivalent',
    source_native_id: null,
    canonical_source_id: canonical,
    basis: 'reviewed_fixture_equivalence',
    evidence: 'Synthetic adjudicated equivalence.',
    search_eligible: true
  };
  const cohort = testCohort(benchmark, [alias]);
  const run = input('QTD-O3-001', [rankedResult(canonical, 1), rankedResult(alias.record_id, 2)]);
  const report = await evaluateRun(run, { benchmark, metricContract, cohort });
  const at3 = report.metrics.full_benchmark.top_k.find(metric => metric.k === 3);
  assert.deepEqual(at3.essential_recall.macro, { numerator: 0.5, denominator: 1, score: 0.5 });
  assert.deepEqual(at3.strict_exact_gold_precision, { numerator: 1, denominator: 3, score: 0.333333 });
  assert.equal(at3.duplicate_result_count, 1);
  assert.equal(at3.short_list_count, 1);
  assert.equal(report.question_evaluations[0].metrics.full.find(metric => metric.k === 3).returned, 2);
});

test('null-gold zeros are excluded from recall and unsafe absence claims are counted', async () => {
  const { benchmark, metricContract } = await fixture();
  const cohort = testCohort(benchmark);
  const question = benchmark.questions.find(candidate => !(benchmark.positivesByQuestion.get(candidate.question_id) ?? []).some(judgment => judgment.label === 'essential'));
  assert.ok(question, 'frozen benchmark must retain a null-essential case');
  const run = input(question.question_id, [], { zero_result: {
    reason_code: 'no_match_in_pinned_generation',
    corpus_absence_claimed: true,
    statement: 'Unsafe synthetic absence claim.'
  } });
  const report = await evaluateRun(run, { benchmark, metricContract, cohort });
  assert.equal(report.metrics.full_benchmark.null_gold_count, 1);
  assert.deepEqual(report.metrics.full_benchmark.top_k[0].essential_recall.macro, { numerator: 0, denominator: 0, score: null });
  assert.equal(report.safety.zero_result_absence_claims, 1);
  assert.equal(report.safety.zero_tolerance_pass, false);
});

test('access, identity, and explanation safety violations are independently visible', async () => {
  const { benchmark, metricContract } = await fixture();
  const cohort = testCohort(benchmark);
  const unsafe = rankedResult('obs:asset:aha-annual-survey-database', 1, {
    why_relevant: '',
    identity_resolution_state: 'unresolved',
    identity_presentation: 'exact'
  });
  const report = await evaluateRun(input('QTD-O3-005', [unsafe]), { benchmark, metricContract, cohort });
  assert.equal(report.safety.prohibited_by_access_recommendations, 1);
  assert.equal(report.safety.unacceptable_recommendations, 1);
  assert.equal(report.safety.unresolved_identity_presented_as_exact, 1);
  assert.equal(report.safety.top_five_without_match_reason, 1);
  assert.equal(report.safety.zero_tolerance_pass, false);
});

test('pins and cohort classifications are fail closed', async () => {
  const { benchmark, metricContract } = await fixture();
  const cohort = testCohort(benchmark);
  const run = input('QTD-O3-001', [rankedResult('pa_phc4_financial_ownership', 1)]);
  delete run.pins.records_sha256;
  await assert.rejects(() => evaluateRun(run, { benchmark, metricContract, cohort }), /EVALUATOR_PIN_INVALID:records_sha256/);

  const drifted = structuredClone(cohort);
  drifted.source_classifications.find(item => item.source_record_id === 'pa_phc4_financial_ownership').status = 'missing';
  const validRun = input('QTD-O3-001', [rankedResult('pa_phc4_financial_ownership', 1)]);
  await assert.rejects(() => evaluateRun(validRun, { benchmark, metricContract, cohort: drifted }), /COHORT_REQUIREMENT_SOURCE_STATUS_DRIFT/);
});

test('the canonical report is deterministic', async () => {
  const { benchmark, metricContract } = await fixture();
  const cohort = testCohort(benchmark);
  const run = input('QTD-O3-001', [rankedResult('pa_phc4_financial_ownership', 1)]);
  const first = await evaluateRun(run, { benchmark, metricContract, cohort });
  const second = await evaluateRun(structuredClone(run), { benchmark, metricContract, cohort: structuredClone(cohort) });
  assert.deepEqual(first, second);
  assert.deepEqual(first.execution_boundary, {
    external_requests: 0,
    ranking_optimization_performed: false,
    llm_used: false,
    source_payloads_accessed: 0,
    analyses_executed: 0,
    identity_merges_performed: 0
  });
});
