import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDevelopmentValidation } from '../tools/development-validation.mjs';

const resultPromise = buildDevelopmentValidation();

test('development validation is split-bound and holdout-free', async () => {
  const result = await resultPromise;
  assert.equal(result.summary.question_count, 40);
  assert.deepEqual(result.summary.split_counts, { development: 20, validation: 20, held_out: 0 });
  assert.equal(result.summary.execution_boundary.held_out_rows_parsed, 0);
  assert.equal(result.summary.execution_boundary.held_out_questions_evaluated, 0);
  assert.equal(result.summary.execution_boundary.tuning_scope, 'development_and_validation_only');
});

test('development validation passes safety zero tolerance without becoming release-ready', async () => {
  const result = await resultPromise;
  assert.equal(result.summary.safety.zero_tolerance_pass, true);
  assert.equal(result.summary.safety.prohibited_by_access_recommendations, 0);
  assert.equal(result.summary.safety.unacceptable_recommendations, 0);
  assert.equal(result.summary.safety.unsupported_join_upgrades, 0);
  assert.equal(result.summary.safety.unresolved_identity_presented_as_exact, 0);
  assert.equal(result.summary.safety.zero_result_absence_claims, 0);
  assert.equal(result.summary.safety.top_five_without_match_reason, 0);
});
