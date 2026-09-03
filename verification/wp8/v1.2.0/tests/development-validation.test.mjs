import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { buildMetricSuccessorValidation } from '../tools/development-validation.mjs';

const resultPromise = buildMetricSuccessorValidation();
const storedPromise = fs.readFile(new URL('../validation/validation-receipt.json', import.meta.url), 'utf8').then(JSON.parse);

test('the successor is exact, versioned, and preserves historical evidence', async () => {
  const [actual, stored] = await Promise.all([resultPromise, storedPromise]);
  assert.deepEqual(stored, actual);
  assert.equal(actual.preserved_history.predecessor_overwritten, false);
  assert.equal(actual.preserved_history.evaluator_v2_0_overwritten, false);
});

test('normalized DCG clears the approved development and validation threshold', async () => {
  const result = await resultPromise;
  assert.equal(result.quality_gate_pass, true);
  for (const cohort of ['development', 'validation', 'combined']) {
    assert.ok(result.feasibility.successor_metric[cohort].macro_score >= 0.7, cohort);
  }
});

test('the historical fixed-slot target remains reported as infeasible', async () => {
  const result = await resultPromise;
  const historical = result.feasibility.historical_fixed_slot_metric;
  assert.equal(historical.observed_score, 0.223333);
  assert.ok(historical.mathematical_ceiling < historical.frozen_target);
  assert.equal(historical.target_mathematically_reachable, false);
});

test('safety, holdout, release, and production gates remain closed', async () => {
  const result = await resultPromise;
  assert.equal(result.safety.zero_tolerance_pass, true);
  assert.equal(result.execution_boundary.held_out_question_payload_rows_parsed, 0);
  assert.equal(result.execution_boundary.held_out_questions_evaluated, 0);
  assert.equal(result.release_gate_pass, false);
  assert.equal(result.production_eligibility, false);
});
