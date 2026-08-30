import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPublishedBenchmark } from '../tools/benchmark-loader.mjs';
import { ZERO_RESULT_STATEMENT, compileGoldIntent, evaluateRun } from '../tools/evaluator.mjs';
import { validateRecord } from '../tools/schema-validator.mjs';
import { loadFixtureBenchmarkForTests } from './fixture-benchmark.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function json(relativePath) {
  return JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, relativePath), 'utf8'));
}

function simpleReference(reference) {
  return Object.fromEntries(Object.entries({ artifact_path: reference.artifact_path, locator: reference.locator, evidence_id: reference.evidence_id }).filter(([, value]) => value !== undefined));
}

test('published benchmark is consumed in place with pinned populations', async () => {
  const benchmark = await loadPublishedBenchmark();
  assert.equal(benchmark.mode, 'published');
  assert.equal(benchmark.questions.length, 60);
  assert.equal(benchmark.positiveJudgments.length, 115);
  assert.equal(benchmark.negativeJudgments.length, 82);
  assert.equal(benchmark.answerPlans.length, 60);
  assert.equal(benchmark.bundles.length, 24);
});

test('fixture-perfect evaluation exposes gold contracts and deterministic top-k metrics', async () => {
  const benchmark = await loadFixtureBenchmarkForTests();
  const input = await json('fixtures/runner-input.valid.json');
  const first = await evaluateRun(input, { benchmark });
  const second = await evaluateRun(input, { benchmark });
  assert.deepEqual(first, second);
  const evaluation = first.question_evaluations[0];
  assert.deepEqual(evaluation.gold_contract.acceptable_sources, ['fixture:closure-events', 'fixture:facility-context']);
  assert.deepEqual(evaluation.gold_contract.must_not_miss_sources, ['fixture:closure-events', 'fixture:facility-context']);
  assert.equal(evaluation.top_k[0].must_not_miss_recall, 0.5);
  assert.equal(evaluation.top_k[1].must_not_miss_recall, 1);
  assert.equal(evaluation.important_restriction_coverage.score, 1);
  assert.equal(evaluation.access_state_correctness.score, 1);
  assert.equal(evaluation.provenance_completeness.score, 1);
  assert.equal(evaluation.join_route_correctness.proposal_score, 1);
  assert.equal(evaluation.join_route_correctness.route_coverage, 1);
  assert.equal(evaluation.join_route_correctness.crosswalk_coverage, 1);
});

test('published question can be evaluated without retrieval or benchmark mutation', async () => {
  const benchmark = await loadPublishedBenchmark();
  const question = benchmark.questionById.get('QTD-O3-001');
  const positives = benchmark.positiveByQuestion.get(question.question_id);
  const plan = benchmark.planByQuestion.get(question.question_id);
  const bundle = benchmark.bundleByQuestion.get(question.question_id);
  const input = {
    input_version: 'o8-evaluation-runner-input.v1',
    run_id: 'published-qtd-o3-001',
    benchmark_package: 'ushso-question-to-data-v0.1.0',
    k_values: [1, 3, 5],
    cases: [{
      question_id: question.question_id,
      intent_compilation: compileGoldIntent(question),
      result_bundle: {
        result_state: 'results',
        results: positives.map((judgment, index) => ({
          rank: index + 1,
          source_record_id: judgment.source_record_id,
          recommendation_state: 'recommended',
          access_implications: judgment.access_implications,
          provenance_references: judgment.evidence_references.map(simpleReference)
        })),
        important_restrictions: plan.important_limitations,
        join_routes: bundle.join_assessments.map(route => ({
          source_record_ids: route.source_record_ids,
          status: route.status,
          crosswalk_ids: bundle.required_crosswalks.filter(item => item.required).map(item => item.crosswalk_id),
          provenance_references: route.evidence_references.map(simpleReference)
        })),
        zero_result: null
      }
    }]
  };
  const report = await evaluateRun(input, { benchmark });
  assert.equal(report.benchmark.mode, 'published');
  assert.equal(report.external_requests, 0);
  assert.equal(report.ranking_optimized, false);
  assert.equal(report.question_evaluations[0].intent_compilation.correct, true);
  assert.equal(report.question_evaluations[0].gates.provenance_complete, true);
});

test('access, provenance, restrictions, and join upgrades fail their independent gates', async () => {
  const benchmark = await loadFixtureBenchmarkForTests();
  const input = await json('fixtures/runner-input.valid.json');
  input.cases[0].result_bundle.results[0].access_implications = 'Free and complete';
  input.cases[0].result_bundle.results[0].provenance_references = [];
  input.cases[0].result_bundle.important_restrictions = [];
  input.cases[0].result_bundle.join_routes[0].status = 'join_proven';
  const evaluation = (await evaluateRun(input, { benchmark })).question_evaluations[0];
  assert.equal(evaluation.access_state_correctness.score, 0.5);
  assert.equal(evaluation.provenance_completeness.score, 0.5);
  assert.equal(evaluation.important_restriction_coverage.score, 0);
  assert.equal(evaluation.join_route_correctness.proposal_score, 0);
  assert.equal(evaluation.gates.joins_not_overstated, false);
});

test('zero results are scored as misses but never converted into corpus absence', async () => {
  const benchmark = await loadFixtureBenchmarkForTests();
  const input = await json('fixtures/runner-input.zero-result.json');
  const evaluation = (await evaluateRun(input, { benchmark })).question_evaluations[0];
  assert.equal(evaluation.top_k[0].must_not_miss_recall, 0);
  assert.equal(evaluation.zero_result_not_absence.applicable, true);
  assert.equal(evaluation.zero_result_not_absence.valid, true);
  assert.equal(evaluation.zero_result_not_absence.statement, ZERO_RESULT_STATEMENT);
  input.cases[0].result_bundle.zero_result.corpus_absence_claimed = true;
  await assert.rejects(() => evaluateRun(input, { benchmark }), /ZERO_RESULT_ABSENCE_CLAIM_REJECTED/);
});

test('strict input and output schemas reject unknown properties', async () => {
  const inputSchema = await json('schemas/runner-input.schema.json');
  const evaluationSchema = await json('schemas/question-evaluation.schema.json');
  const reportSchema = await json('schemas/run-report.schema.json');
  const invalid = await json('fixtures/runner-input.invalid-extra-property.json');
  assert.ok(validateRecord(invalid, inputSchema).some(error => error.includes('unexpected ranking_weights')));
  const benchmark = await loadFixtureBenchmarkForTests();
  const report = await evaluateRun(await json('fixtures/runner-input.valid.json'), { benchmark });
  assert.deepEqual(validateRecord(report, reportSchema), []);
  assert.deepEqual(validateRecord(report.question_evaluations[0], evaluationSchema), []);
  assert.ok(validateRecord({ ...report.question_evaluations[0], optimized_rank: 1 }, evaluationSchema).some(error => error.includes('unexpected optimized_rank')));
});
