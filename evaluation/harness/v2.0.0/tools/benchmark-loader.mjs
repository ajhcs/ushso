import fs from 'node:fs/promises';
import path from 'node:path';
import { PACKAGE_ROOT, PROJECT_ROOT, readJson, sha256 } from './integrity.mjs';

export const DEFAULT_BENCHMARK_ROOT = path.join(PROJECT_ROOT, 'evaluation/benchmark/v0.1.0');
export const CURRENT_GENERATION_ROOT = path.join(PROJECT_ROOT, 'packages/retrieval/versions/v1.1.0');
export const HISTORICAL_GENERATION_ROOT = path.join(PROJECT_ROOT, 'packages/retrieval');

const KNOWN_UNMANIFESTED_FILE_PINS = Object.freeze({
  '1.0.1:fixtures/controlled-vocabulary.json': Object.freeze({ bytes: 11268, sha256: 'e3cf00dc343b74428948276c0206a05f35ea06c0ea61788019ce727bb4720642' }),
});

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

async function loadGeneration(generationRoot, benchmarkPinSha256) {
  const manifestPath = path.join(generationRoot, 'manifests/corpus-manifest.json');
  const manifestBytes = await fs.readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const expectedPaths = [
    'corpus/corpus.json',
    'corpus/records.jsonl',
    'corpus/search-documents.jsonl',
    'fixtures/controlled-vocabulary.json',
  ];
  const bytesByPath = new Map();
  for (const relative of expectedPaths) {
    const expected = manifest.files.find((entry) => entry.path === relative)
      ?? KNOWN_UNMANIFESTED_FILE_PINS[`${manifest.corpus_version}:${relative}`];
    const bytes = await fs.readFile(path.join(generationRoot, relative));
    if (!expected || bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
      throw new Error(`CURRENT_GENERATION_ARTIFACT_MISMATCH:${relative}`);
    }
    bytesByPath.set(relative, bytes);
  }
  const corpus = JSON.parse(bytesByPath.get('corpus/corpus.json').toString('utf8'));
  const records = parseJsonl(bytesByPath.get('corpus/records.jsonl'), `${manifest.corpus_version} records.jsonl`);
  const searchDocuments = parseJsonl(bytesByPath.get('corpus/search-documents.jsonl'), `${manifest.corpus_version} search-documents.jsonl`);
  const recordIds = new Set();
  const searchDocumentIds = new Set();
  const recordIdsBySource = new Map();
  for (const record of records) {
    if (typeof record.record_id !== 'string' || recordIds.has(record.record_id)) throw new Error(`CORPUS_GENERATION_RECORD_ID_INVALID:${record.record_id}`);
    recordIds.add(record.record_id);
    const sourceIds = [record.record_id, record.identity?.match_fields?.source_id, record.identity?.source_id].filter((value) => typeof value === 'string' && value);
    for (const sourceId of sourceIds) {
      const values = recordIdsBySource.get(sourceId) ?? [];
      values.push(record.record_id);
      recordIdsBySource.set(sourceId, values);
    }
  }
  for (const document of searchDocuments) {
    if (typeof document.resource_record_id !== 'string' || searchDocumentIds.has(document.resource_record_id)) throw new Error(`CORPUS_GENERATION_SEARCH_DOCUMENT_ID_INVALID:${document.resource_record_id}`);
    searchDocumentIds.add(document.resource_record_id);
  }
  if (corpus.record_count !== records.length || corpus.search_document_count !== searchDocuments.length || recordIds.size !== searchDocumentIds.size) throw new Error('CORPUS_GENERATION_CARDINALITY_INVALID');
  if (corpus.manifest_sha256 !== manifest.content_fingerprint_sha256 || corpus.algorithm_fingerprint_sha256 !== manifest.algorithm_fingerprint_sha256) throw new Error('CORPUS_GENERATION_FINGERPRINT_INVALID');
  const manifestEntry = (relative) => manifest.files.find((entry) => entry.path === relative)?.sha256
    ?? KNOWN_UNMANIFESTED_FILE_PINS[`${manifest.corpus_version}:${relative}`]?.sha256;
  return Object.freeze({
    corpus_id: corpus.corpus_id,
    corpus_version: corpus.corpus_version,
    record_count: records.length,
    corpus_manifest_sha256: sha256(manifestBytes),
    content_fingerprint_sha256: manifest.content_fingerprint_sha256,
    algorithm_fingerprint_sha256: manifest.algorithm_fingerprint_sha256,
    records_sha256: manifestEntry('corpus/records.jsonl'),
    search_documents_sha256: manifestEntry('corpus/search-documents.jsonl'),
    vocabulary_sha256: manifestEntry('fixtures/controlled-vocabulary.json'),
    benchmark_pin_sha256: benchmarkPinSha256,
    recordIds,
    searchDocumentIds,
    recordIdsBySource,
  });
}

export async function loadBenchmark({ benchmarkRoot = DEFAULT_BENCHMARK_ROOT } = {}) {
  const pin = await readJson(path.join(PACKAGE_ROOT, 'benchmark-pin.json'));
  const benchmarkPinSha256 = sha256(await fs.readFile(path.join(PACKAGE_ROOT, 'benchmark-pin.json')));
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
  const [currentGeneration, historicalGeneration] = await Promise.all([
    loadGeneration(CURRENT_GENERATION_ROOT, benchmarkPinSha256),
    loadGeneration(HISTORICAL_GENERATION_ROOT, benchmarkPinSha256),
  ]);

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
    pin_sha256: benchmarkPinSha256,
    currentGeneration,
    generations: new Map([
      [currentGeneration.corpus_manifest_sha256, currentGeneration],
      [historicalGeneration.corpus_manifest_sha256, historicalGeneration],
    ]),
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
