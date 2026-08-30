import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ROOT = path.resolve(PACKAGE_ROOT, '../../..');
export const DEFAULT_BENCHMARK_ROOT = path.join(PROJECT_ROOT, 'evaluation/benchmark/v0.1.0');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseJsonl(text, label) {
  return text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${label}:${index + 1}:${error.message}`); }
  });
}

function uniqueMap(rows, key, label) {
  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row[key] !== 'string' || !row[key]) throw new Error(`${label}:missing ${key}`);
    if (map.has(row[key])) throw new Error(`${label}:duplicate ${row[key]}`);
    map.set(row[key], row);
  }
  return map;
}

export function assembleBenchmark(data, { mode = 'test_fixture', expectedCounts = null, source = 'tests-only fixture' } = {}) {
  const required = ['questions', 'positiveJudgments', 'negativeJudgments', 'answerPlans', 'bundles', 'sourceReferenceIndex'];
  for (const key of required) if (!Array.isArray(data[key]) && key !== 'sourceReferenceIndex') throw new Error(`BENCHMARK_COMPONENT_REQUIRED:${key}`);
  const questionById = uniqueMap(data.questions, 'question_id', 'questions');
  const planByQuestion = uniqueMap(data.answerPlans, 'question_id', 'answer_plans');
  const bundleByQuestion = uniqueMap(data.bundles, 'question_id', 'bundle_gold');
  const positiveByQuestion = new Map();
  const negativeByQuestion = new Map();
  for (const judgment of data.positiveJudgments) positiveByQuestion.set(judgment.question_id, [...(positiveByQuestion.get(judgment.question_id) ?? []), judgment]);
  for (const judgment of data.negativeJudgments) negativeByQuestion.set(judgment.question_id, [...(negativeByQuestion.get(judgment.question_id) ?? []), judgment]);
  for (const question of data.questions) if (!planByQuestion.has(question.question_id)) throw new Error(`ANSWER_PLAN_MISSING:${question.question_id}`);
  if (expectedCounts) {
    const observed = {
      questions: data.questions.length,
      positive_judgments: data.positiveJudgments.length,
      negative_judgments: data.negativeJudgments.length,
      answer_plans: data.answerPlans.length,
      bundle_gold: data.bundles.length
    };
    for (const [key, expected] of Object.entries(expectedCounts)) if (observed[key] !== expected) throw new Error(`BENCHMARK_COUNT_MISMATCH:${key}:${observed[key]}:${expected}`);
  }
  return Object.freeze({
    mode,
    source,
    questions: data.questions,
    positiveJudgments: data.positiveJudgments,
    negativeJudgments: data.negativeJudgments,
    answerPlans: data.answerPlans,
    bundles: data.bundles,
    sourceReferenceIndex: data.sourceReferenceIndex,
    questionById,
    planByQuestion,
    bundleByQuestion,
    positiveByQuestion,
    negativeByQuestion
  });
}

export async function loadPublishedBenchmark({ benchmarkRoot = DEFAULT_BENCHMARK_ROOT } = {}) {
  const pin = JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, 'benchmark-pin.json'), 'utf8'));
  const bytesByPath = new Map();
  for (const expected of pin.files) {
    const bytes = await fs.readFile(path.join(benchmarkRoot, expected.path));
    if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) throw new Error(`BENCHMARK_PIN_MISMATCH:${expected.path}`);
    bytesByPath.set(expected.path, bytes);
  }
  const manifest = JSON.parse(bytesByPath.get('package_manifest.json').toString('utf8'));
  const validation = JSON.parse(bytesByPath.get('validation_report.json').toString('utf8'));
  if (manifest.package_id !== pin.package_id || manifest.offline !== true || manifest.external_requests !== 0) throw new Error('BENCHMARK_MANIFEST_BOUNDARY_INVALID');
  if (validation.status !== 'PASS' || validation.external_requests !== 0) throw new Error('BENCHMARK_VALIDATION_NOT_PASSING');

  return assembleBenchmark({
    questions: parseJsonl(bytesByPath.get('questions.jsonl').toString('utf8'), 'questions.jsonl'),
    positiveJudgments: parseJsonl(bytesByPath.get('relevance_judgments.jsonl').toString('utf8'), 'relevance_judgments.jsonl'),
    negativeJudgments: parseJsonl(bytesByPath.get('negative_judgments.jsonl').toString('utf8'), 'negative_judgments.jsonl'),
    answerPlans: parseJsonl(bytesByPath.get('answer_plans.jsonl').toString('utf8'), 'answer_plans.jsonl'),
    bundles: parseJsonl(bytesByPath.get('bundle_gold.jsonl').toString('utf8'), 'bundle_gold.jsonl'),
    sourceReferenceIndex: JSON.parse(bytesByPath.get('source_reference_index.json').toString('utf8'))
  }, { mode: 'published', expectedCounts: pin.expected_counts, source: pin.package_path });
}
