import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBenchmark } from '../tools/benchmark-loader.mjs';
import { evaluateRun, loadMetricContract } from '../tools/evaluator.mjs';

const PINS = {
  corpus_manifest_sha256: '23f704ce3e421a6eb26c2b3677d616a1ae6b4f45226233257b9a1ff676caba2b',
  content_fingerprint_sha256: 'adcfb56babc981a4c7dfc787af86d56f5fb2a31e84de02f9db8c93f0548b5d03',
  records_sha256: '458c8e7ec15e059e60bc908fc98f6b94f8deafd9bd1862d1dc0b576ac830f046',
  search_documents_sha256: '8c7913596353d4ea2c6f5b763d3711aa77d97a457bb91b4cbce990bbf301e633',
  vocabulary_sha256: '2907709f3805744a57d395554f911981e5e3e3c7a25af40419ec2c2b26954151',
  algorithm_fingerprint_sha256: 'b30376f8819d5335dab0f914f18bdbb540b67af9475267db1a6f9230479184e1',
  benchmark_pin_sha256: '89804a56123cb19fff40468e5fcdc05a2753ff0b4b38541386bda239cd2de398',
  cohort_manifest_sha256: 'a'.repeat(64),
  metric_contract_sha256: '32c826571c7e9d44dc567664030eed67c49ae60a3574850d9bd0209fa6498cda'
};

function testCohort(benchmark, aliases = []) {
  const current = benchmark.currentGeneration;
  const direct = benchmark.sourceIndex.sources.flatMap(source => {
    const recordId = current.recordIdsBySource.get(source.source_record_id)?.[0];
    return recordId ? [{
      record_id: recordId,
      source_native_id: source.source_record_id,
      canonical_source_id: source.source_record_id,
      basis: 'record_id_exact',
      evidence: 'Test fixture exact identity.',
      search_eligible: true
    }] : [];
  });
  const bindings = [...direct, ...aliases];
  const statusBySource = new Map(benchmark.sourceIndex.sources.map(source => [
    source.source_record_id,
    bindings.some(binding => binding.canonical_source_id === source.source_record_id) ? 'present_search_eligible' : 'missing'
  ]));
  const sourceClassifications = benchmark.sourceIndex.sources.map(source => ({
    source_record_id: source.source_record_id,
    source_family_id: source.source_family_id,
    status: bindings.some(binding => binding.canonical_source_id === source.source_record_id) ? 'present_search_eligible' : 'missing',
    reason: bindings.some(binding => binding.canonical_source_id === source.source_record_id) ? 'Test fixture: a pinned current-generation binding exists.' : 'Test fixture: no pinned current-generation binding exists.',
    record_ids: bindings.filter(binding => binding.canonical_source_id === source.source_record_id).map(binding => binding.record_id)
  }));
  const requirements = benchmark.positives.map(judgment => ({
    judgment_id: judgment.judgment_id,
    question_id: judgment.question_id,
    source_record_id: judgment.source_record_id,
    analytical_role: judgment.analytical_role,
    label: judgment.label,
    status: statusBySource.get(judgment.source_record_id),
    reason: 'Test fixture: status is derived from the pinned binding set.'
  }));
  return {
    manifest_version: 'ushso-retrieval-present-source-cohort.v1',
    generated_at: '2026-08-30T00:00:00.000Z',
    current_generation: {
      corpus_id: current.corpus_id,
      corpus_version: current.corpus_version,
      record_count: current.record_count,
      corpus_manifest_sha256: current.corpus_manifest_sha256,
      content_fingerprint_sha256: current.content_fingerprint_sha256,
      benchmark_pin_sha256: current.benchmark_pin_sha256
    },
    status_vocabulary: ['present_search_eligible', 'present_but_excluded', 'missing'],
    source_classifications: sourceClassifications,
    requirements,
    asset_bindings: bindings,
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
    record_id: 'obs:asset:pa-phc4-public-financial-reports',
    source_native_id: null,
    canonical_source_id: canonical,
    basis: 'reviewed_fixture_equivalence',
    evidence: 'Synthetic adjudicated equivalence.',
    search_eligible: true
  };
  const cohort = testCohort(benchmark, [alias]);
  const run = input('QTD-O3-001', [rankedResult('obs:asset:pa-phc4-custom-data', 1), rankedResult(alias.record_id, 2)]);
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
  const run = input('QTD-O3-001', [rankedResult('obs:asset:pa-phc4-custom-data', 1)]);
  delete run.pins.records_sha256;
  await assert.rejects(() => evaluateRun(run, { benchmark, metricContract, cohort }), /EVALUATOR_PIN_INVALID:records_sha256/);

  const drifted = structuredClone(cohort);
  drifted.source_classifications.find(item => item.source_record_id === 'pa_phc4_financial_ownership').status = 'missing';
  const validRun = input('QTD-O3-001', [rankedResult('obs:asset:pa-phc4-custom-data', 1)]);
  await assert.rejects(() => evaluateRun(validRun, { benchmark, metricContract, cohort: drifted }), /COHORT_MISSING_SOURCE_HAS_RECORDS|COHORT_REQUIREMENT_SOURCE_STATUS_DRIFT/);
});

test('the canonical report is deterministic', async () => {
  const { benchmark, metricContract } = await fixture();
  const cohort = testCohort(benchmark);
  const run = input('QTD-O3-001', [rankedResult('obs:asset:pa-phc4-custom-data', 1)]);
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
