import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateNormalizedDcg } from '../../../../evaluation/harness/v2.1.0/tools/normalized-dcg.mjs';
import { buildDevelopmentValidation as buildPredecessorValidation } from '../../v1.1.0/tools/development-validation.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../../..');
const receiptPath = path.join(packageRoot, 'validation/validation-receipt.json');
const generatedAt = '2026-09-03T00:00:00.000Z';

const pretty = value => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const readBytes = relative => fs.readFile(path.join(repositoryRoot, relative));
const readJson = async relative => JSON.parse((await readBytes(relative)).toString('utf8'));

export async function buildMetricSuccessorValidation() {
  const [predecessor, contract, contractBytes, cohort, cohortBytes, splits, splitsBytes, predecessorReceiptBytes] = await Promise.all([
    buildPredecessorValidation(),
    readJson('evaluation/harness/v2.1.0/metric-contract.json'),
    readBytes('evaluation/harness/v2.1.0/metric-contract.json'),
    readJson('evaluation/bridge/v1.0.0/cohorts/present-source-v1.json'),
    readBytes('evaluation/bridge/v1.0.0/cohorts/present-source-v1.json'),
    readJson('evaluation/benchmark/v0.1.0/benchmark_splits.json'),
    readBytes('evaluation/benchmark/v0.1.0/benchmark_splits.json'),
    readBytes('verification/wp8/v1.1.0/validation/validation-receipt.json')
  ]);
  const splitByQuestion = new Map([
    ...splits.splits.development.map(questionId => [questionId, 'development']),
    ...splits.splits.validation.map(questionId => [questionId, 'validation']),
    ...splits.splits.held_out.map(questionId => [questionId, 'held_out'])
  ]);
  const metric = evaluateNormalizedDcg({
    cases: predecessor.evaluation_cases,
    cohort,
    splitByQuestion,
    gains: contract.metric.gains,
    k: contract.metric.k
  });
  const historicalObserved = predecessor.summary.quality['5'].present_graded_precision;
  if (metric.historical_fixed_slot_geometry.observed_score !== historicalObserved) {
    throw new Error(`WP8_HISTORICAL_METRIC_REPRODUCTION_FAILED:${metric.historical_fixed_slot_geometry.observed_score}:${historicalObserved}`);
  }
  const threshold = contract.metric.target.value;
  const requiredCohorts = contract.metric.target.required_cohorts;
  const targetPass = requiredCohorts.every(name => metric.cohorts[name].macro_score >= threshold);
  const safetyPass = predecessor.summary.safety.zero_tolerance_pass === true;
  const questionDigest = sha256(Buffer.from(pretty(metric.questions)));
  return {
    receipt_version: 'ushso-wp8-metric-successor-development-validation.v1.2.0',
    package_id: '@ushso/verification-wp8-metric-successor@1.2.0',
    generated_at: generatedAt,
    approval: {
      status: 'approved_scoped',
      recorded_at: '2026-09-03T00:00:00.000Z',
      basis: 'Explicit APPROVED response from the requesting repository operator in the 2026-09-03 Codex task.',
      scope: 'Develop and verify a versioned WP8 sparse-ranking metric correction, preserving historical receipts.',
      does_not_authorize: ['held_out_evaluation', 'production_deployment', 'managed_infrastructure', 'live_connector_traffic', 'external_provider_repository_exposure']
    },
    status: targetPass && safetyPass ? 'PASS_DEVELOPMENT_VALIDATION_METRIC_SUCCESSOR' : 'FAIL_DEVELOPMENT_VALIDATION_METRIC_SUCCESSOR',
    quality_gate_pass: targetPass,
    safety_gate_pass: safetyPass,
    release_gate_pass: false,
    release_ready: false,
    production_eligibility: false,
    metric_contract: {
      id: contract.metric.id,
      path: 'evaluation/harness/v2.1.0/metric-contract.json',
      sha256: sha256(contractBytes),
      target: contract.metric.target
    },
    feasibility: {
      conclusion: targetPass ? 'FEASIBLE_AND_PASSES_DEVELOPMENT_VALIDATION' : 'DOES_NOT_PASS_DEVELOPMENT_VALIDATION',
      successor_metric: metric.cohorts,
      historical_fixed_slot_metric: {
        ...metric.historical_fixed_slot_geometry,
        frozen_target: 0.7,
        target_mathematically_reachable: metric.historical_fixed_slot_geometry.mathematical_ceiling >= 0.7
      },
      question_evaluations_sha256: questionDigest,
      question_count: metric.questions.length
    },
    preserved_history: {
      predecessor_receipt_path: 'verification/wp8/v1.1.0/validation/validation-receipt.json',
      predecessor_receipt_sha256: sha256(predecessorReceiptBytes),
      predecessor_quality_status: 'FAIL_TARGET_PRECISION',
      predecessor_overwritten: false,
      evaluator_v2_0_overwritten: false
    },
    safety: predecessor.summary.safety,
    pins: {
      ...predecessor.pins,
      metric_successor_contract_sha256: sha256(contractBytes),
      cohort_manifest_sha256: sha256(cohortBytes),
      benchmark_splits_sha256: sha256(splitsBytes),
      predecessor_receipt_sha256: sha256(predecessorReceiptBytes)
    },
    execution_boundary: {
      ...predecessor.summary.execution_boundary,
      held_out_question_payload_rows_parsed: 0,
      held_out_questions_evaluated: 0,
      external_requests: 0,
      production_actions: 0,
      ranking_optimization_performed: false
    },
    open_gates: [
      {
        gate_id: 'AUTH-13',
        status: 'not_authorized',
        reason: 'A fresh independently owned holdout and its one-time aggregate-only final-gate evaluation remain outside this approval.'
      }
    ]
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const receipt = await buildMetricSuccessorValidation();
    if (process.argv.includes('--write-receipt')) await fs.writeFile(receiptPath, pretty(receipt), 'utf8');
    process.stdout.write(pretty(receipt));
    if (!receipt.quality_gate_pass || !receipt.safety_gate_pass) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
