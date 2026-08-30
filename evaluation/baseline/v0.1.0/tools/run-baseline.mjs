import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPublishedEngine, loadPublishedCorpus } from '../../../../packages/retrieval/tools/load-corpus.mjs';
import { runPublishedEvaluation } from '../../../harness/v1.0.0/tools/evaluator.mjs';
import { adaptCase, PACKAGE_ROOT, WORKSPACE_ROOT, readJson, readJsonl } from './baseline-adapter.mjs';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  return value;
}

function digest(value) {
  return createHash('sha256').update(`${JSON.stringify(canonicalize(value))}\n`, 'utf8').digest('hex');
}

async function writeJson(relativePath, value) {
  const target = path.join(PACKAGE_ROOT, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return digest(value);
}

const benchmarkRoot = path.join(WORKSPACE_ROOT, 'evaluation', 'benchmark', 'v0.1.0');
const questions = await readJsonl(path.join(benchmarkRoot, 'questions.jsonl'));
const sourceIndex = await readJson(path.join(benchmarkRoot, 'source_reference_index.json'));
const sourceIds = new Set(sourceIndex.sources.map(source => source.source_record_id));
const engine = await createPublishedEngine();
const publishedCorpus = await loadPublishedCorpus();
const corpusSourceIds = new Set(publishedCorpus.records.flatMap(record => [record.record_id, record.identity?.match_fields?.source_id]).filter(Boolean));
const cases = questions.map(question => adaptCase(question, engine.retrieve({
  question: question.natural_language_question,
  include_restricted: true,
  limit: 20
}), sourceIds));
const runnerInput = {
  input_version: 'o8-evaluation-runner-input.v1',
  run_id: 'ushso-retrieval-v1.0.1-offline-baseline',
  benchmark_package: 'ushso-question-to-data-v0.1.0',
  k_values: [1, 3, 5, 10, 20],
  cases
};
const evaluation = await runPublishedEvaluation(runnerInput);
const mainQuery = engine.retrieve({ question: 'I need hospital financial and utilization data for Pennsylvania', limit: 15 });
const nonsenseQuery = engine.retrieve({ question: 'Pennsylvania flibbertigibbet qzxwvu', limit: 15 });
const runnerInputSha256 = await writeJson('outputs/runner-input.json', runnerInput);
const evaluationReportSha256 = await writeJson('outputs/evaluation-report.json', evaluation);
const smokeResultsSha256 = await writeJson('outputs/smoke-results.json', { main_query: mainQuery, nonsense_query: nonsenseQuery });
const mainSourceIds = mainQuery.results.map(item => item.record.identity?.match_fields?.source_id ?? item.record.record_id);
const validation = {
  validation_version: 'ushso-retrieval-baseline-validation.v1',
  status: questions.length === 60 && evaluation.question_count === 60 && mainSourceIds.includes('cms_hcris_cost_reports') && mainSourceIds.includes('pa_phc4_financial_ownership') && nonsenseQuery.result_count === 0 ? 'PASS' : 'FAIL',
  checks: {
    frozen_question_count_60: questions.length === 60,
    evaluated_question_count_60: evaluation.question_count === 60,
    pa_finance_query_includes_hcris: mainSourceIds.includes('cms_hcris_cost_reports'),
    pa_finance_query_includes_phc4: mainSourceIds.includes('pa_phc4_financial_ownership'),
    nonsense_query_is_bounded_zero_result: nonsenseQuery.result_count === 0,
    evaluation_external_requests_zero: evaluation.external_requests === 0,
    ranking_optimized_false: evaluation.ranking_optimized === false,
    llm_used_false: evaluation.llm_used === false,
    identity_work_performed_false: evaluation.identity_work_performed === false,
    coverage_execution_performed_false: evaluation.coverage_execution_performed === false,
    heavy_analysis_lock_touched_false: evaluation.heavy_analysis_lock_touched === false
  },
  corpus_boundary: {
    indexed_record_count: mainQuery.corpus.record_count,
    benchmark_source_count: sourceIndex.source_reference_count,
    benchmark_sources_represented_by_source_id: sourceIndex.sources.filter(source => corpusSourceIds.has(source.source_record_id)).length,
    note: 'The benchmark is broader than the current MVP corpus. Scores are a baseline, not a corpus-absence claim.'
  },
  evaluation_macro_metrics: evaluation.macro_metrics,
  external_requests: 0,
  coverage_cells_executed: 0,
  heavy_analysis_lock_touched: false
};
const validationSha256 = await writeJson('validation/validation-report.json', validation);
const receipt = {
  receipt_version: 'ushso-retrieval-baseline-build.v1',
  package_version: '0.1.0',
  generated_at: '2026-08-30T00:00:00.000Z',
  inputs: {
    retrieval_package: 'observatory/retrieval/v1.0.1',
    evaluation_harness: 'observatory/evaluation-harness/v1.0.0',
    benchmark_package: 'observatory/benchmarks/question_to_data/v0.1.0'
  },
  outputs: { runnerInputSha256, evaluationReportSha256, smokeResultsSha256, validationSha256 },
  validation_status: validation.status,
  external_requests: 0,
  coverage_cells_executed: 0,
  identity_index_queries: 0,
  heavy_analysis_lock_touched: false
};
await writeJson('receipts/build-receipt.json', receipt);
process.stdout.write(`${JSON.stringify({ status: validation.status, question_count: evaluation.question_count, macro_metrics: evaluation.macro_metrics }, null, 2)}\n`);
if (validation.status !== 'PASS') process.exitCode = 1;
