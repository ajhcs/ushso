import fs from 'node:fs/promises';
import path from 'node:path';
import { PACKAGE_ROOT, PROJECT_ROOT, readJson, sha256 } from './integrity.mjs';

export const DEFAULT_BENCHMARK_ROOT = path.join(PROJECT_ROOT, 'evaluation/benchmark/v0.1.0');

function parseJsonl(bytes, label) {
  return bytes.toString('utf8').split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`BENCHMARK_JSONL_INVALID:${label}:${index + 1}:${error.message}`);
    }
  });
}

function uniqueMap(rows, key, label) {
  const output = new Map();
  for (const row of rows) {
    if (!row || typeof row[key] !== 'string' || !row[key]) throw new Error(`BENCHMARK_KEY_MISSING:${label}:${key}`);
    if (output.has(row[key])) throw new Error(`BENCHMARK_KEY_DUPLICATE:${label}:${row[key]}`);
    output.set(row[key], row);
  }
  return output;
}

export async function loadBenchmark({ benchmarkRoot = DEFAULT_BENCHMARK_ROOT } = {}) {
  const pin = await readJson(path.join(PACKAGE_ROOT, 'benchmark-pin.json'));
  const bytesByPath = new Map();
  for (const expected of pin.files) {
    const bytes = await fs.readFile(path.join(benchmarkRoot, expected.path));
    if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
      throw new Error(`BENCHMARK_PIN_MISMATCH:${expected.path}`);
    }
    bytesByPath.set(expected.path, bytes);
  }

  const questions = parseJsonl(bytesByPath.get('questions.jsonl'), 'questions.jsonl');
  const features = parseJsonl(bytesByPath.get('question_features.jsonl'), 'question_features.jsonl');
  const positives = parseJsonl(bytesByPath.get('relevance_judgments.jsonl'), 'relevance_judgments.jsonl');
  const negatives = parseJsonl(bytesByPath.get('negative_judgments.jsonl'), 'negative_judgments.jsonl');
  const bundles = parseJsonl(bytesByPath.get('bundle_gold.jsonl'), 'bundle_gold.jsonl');
  const plans = parseJsonl(bytesByPath.get('answer_plans.jsonl'), 'answer_plans.jsonl');
  const sourceIndex = JSON.parse(bytesByPath.get('source_reference_index.json').toString('utf8'));
  const splits = JSON.parse(bytesByPath.get('benchmark_splits.json').toString('utf8'));
  const statistics = JSON.parse(bytesByPath.get('benchmark_statistics.json').toString('utf8'));

  const observed = {
    questions: questions.length,
    question_features: features.length,
    positive_judgments: positives.length,
    negative_judgments: negatives.length,
    answer_plans: plans.length,
    bundle_gold: bundles.length,
    source_references: sourceIndex.sources.length,
    development_questions: splits.splits.development.length,
    validation_questions: splits.splits.validation.length,
    held_out_questions: splits.splits.held_out.length
  };
  for (const [key, expected] of Object.entries(pin.expected_counts)) {
    if (observed[key] !== expected) throw new Error(`BENCHMARK_COUNT_MISMATCH:${key}:${observed[key]}:${expected}`);
  }
  const positivesByQuestion = new Map(questions.map(question => [question.question_id, []]));
  const negativesByQuestion = new Map(questions.map(question => [question.question_id, []]));
  for (const judgment of positives) positivesByQuestion.get(judgment.question_id)?.push(judgment);
  for (const judgment of negatives) negativesByQuestion.get(judgment.question_id)?.push(judgment);
  const splitByQuestion = new Map();
  for (const [split, ids] of Object.entries(splits.splits)) for (const id of ids) splitByQuestion.set(id, split);

  return Object.freeze({
    pin,
    pin_sha256: sha256(await fs.readFile(path.join(PACKAGE_ROOT, 'benchmark-pin.json'))),
    benchmark_root: benchmarkRoot,
    questions,
    features,
    positives,
    negatives,
    bundles,
    plans,
    sourceIndex,
    splits,
    statistics,
    questionById: uniqueMap(questions, 'question_id', 'questions'),
    featureByQuestion: uniqueMap(features, 'question_id', 'question_features'),
    bundleByQuestion: uniqueMap(bundles, 'question_id', 'bundle_gold'),
    positivesByQuestion,
    negativesByQuestion,
    splitByQuestion
  });
}
