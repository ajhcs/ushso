import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleBenchmark } from '../tools/benchmark-loader.mjs';

const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/benchmark');

async function jsonl(name) {
  return (await fs.readFile(path.join(FIXTURE_ROOT, name), 'utf8')).split(/\r?\n/).filter(line => line.trim()).map(JSON.parse);
}

export async function loadFixtureBenchmarkForTests() {
  return assembleBenchmark({
    questions: await jsonl('questions.jsonl'),
    positiveJudgments: await jsonl('relevance_judgments.jsonl'),
    negativeJudgments: await jsonl('negative_judgments.jsonl'),
    answerPlans: await jsonl('answer_plans.jsonl'),
    bundles: await jsonl('bundle_gold.jsonl'),
    sourceReferenceIndex: JSON.parse(await fs.readFile(path.join(FIXTURE_ROOT, 'source_reference_index.json'), 'utf8'))
  }, { mode: 'test_fixture', source: 'fixtures/benchmark (tests only)' });
}
