import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateNormalizedDcg } from '../tools/normalized-dcg.mjs';

const gains = { essential: 1, highly_relevant: 2 / 3, conditionally_relevant: 1 / 3, contextual: 1 / 6 };
const cohort = {
  asset_bindings: [
    { record_id: 'asset:a', canonical_source_id: 'source:a' },
    { record_id: 'asset:a-copy', canonical_source_id: 'source:a' },
    { record_id: 'asset:b', canonical_source_id: 'source:b' }
  ],
  requirements: [
    { question_id: 'q1', source_record_id: 'source:a', label: 'essential', status: 'present_search_eligible' },
    { question_id: 'q1', source_record_id: 'source:b', label: 'highly_relevant', status: 'present_search_eligible' },
    { question_id: 'q2', source_record_id: 'source:a', label: 'essential', status: 'present_search_eligible' }
  ]
};

function question(questionId, records) {
  return {
    question_id: questionId,
    result_bundle: { results: records.map((record_id, index) => ({ record_id, rank: index + 1, recommendation_state: 'recommended' })) }
  };
}

test('normalized DCG compares each sparse answer with its attainable ideal', () => {
  const report = evaluateNormalizedDcg({
    cases: [question('q1', ['asset:a', 'asset:b']), question('q2', ['asset:a'])],
    cohort,
    splitByQuestion: new Map([['q1', 'development'], ['q2', 'validation']]),
    gains,
    k: 5
  });
  assert.equal(report.cohorts.combined.macro_score, 1);
  assert.equal(report.historical_fixed_slot_geometry.mathematical_ceiling, 0.266667);
});

test('duplicates retain rank slots and earn no second gain', () => {
  const report = evaluateNormalizedDcg({
    cases: [question('q1', ['asset:a', 'asset:a-copy', 'asset:b'])],
    cohort,
    splitByQuestion: new Map([['q1', 'development']]),
    gains,
    k: 5
  });
  assert.ok(report.cohorts.combined.macro_score < 1);
  assert.equal(report.questions[0].earned_undiscounted_gain, 1.666667);
});

test('held-out and unknown cases fail closed', () => {
  assert.throws(() => evaluateNormalizedDcg({
    cases: [question('q1', ['asset:a'])],
    cohort,
    splitByQuestion: new Map([['q1', 'held_out']]),
    gains,
    k: 5
  }), /NDCG_SPLIT_FORBIDDEN/u);
});
