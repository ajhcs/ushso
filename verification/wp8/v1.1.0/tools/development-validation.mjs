import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, '../../..');
const BENCHMARK_ROOT = path.join(REPOSITORY_ROOT, 'evaluation/benchmark/v0.1.0');
const GENERATION_ROOT = path.join(REPOSITORY_ROOT, 'packages/retrieval/versions/v1.1.0');
const GENERATED_AT = '2026-09-02T00:00:00.000Z';
const HOLDOUT_SPLIT = 'held_out';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const readBytes = relative => fs.readFile(path.join(REPOSITORY_ROOT, relative));
const readJson = async relative => JSON.parse((await readBytes(relative)).toString('utf8'));

async function readSelectedJsonl(relative, selectedQuestionIds, label) {
  const text = (await fs.readFile(path.join(BENCHMARK_ROOT, relative), 'utf8')).trim();
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const questionId = line.match(/"question_id"\s*:\s*"([^"]+)"/)?.[1];
    if (!questionId) throw new Error(`MISSING_QUESTION_ID:${label}:${index + 1}`);
    // The question id is inspected as a routing key; JSON.parse is deliberately
    // called only for development/validation rows.
    if (selectedQuestionIds.has(questionId)) rows.push(JSON.parse(line));
  }
  return rows;
}

function parseJsonl(text, label) {
  return text.trim().split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`JSONL_INVALID:${label}:${index + 1}:${error.message}`);
    }
  });
}

async function loadCurrentGeneration(benchmarkPinSha256) {
  const manifestBytes = await readBytes('packages/retrieval/versions/v1.1.0/manifests/corpus-manifest.json');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const recordsBytes = await readBytes('packages/retrieval/versions/v1.1.0/corpus/records.jsonl');
  const searchDocumentsBytes = await readBytes('packages/retrieval/versions/v1.1.0/corpus/search-documents.jsonl');
  const records = parseJsonl(recordsBytes.toString('utf8'), 'records');
  const searchDocuments = parseJsonl(searchDocumentsBytes.toString('utf8'), 'search-documents');
  const recordIds = new Set(records.map(record => record.record_id));
  const searchDocumentIds = new Set(searchDocuments.map(document => document.resource_record_id));
  if (recordIds.size !== records.length || searchDocumentIds.size !== searchDocuments.length || recordIds.size !== searchDocumentIds.size) {
    throw new Error('CURRENT_GENERATION_CARDINALITY_INVALID');
  }
  const recordIdsBySource = new Map();
  for (const record of records) {
    const sourceIds = [record.record_id, record.identity?.match_fields?.source_id, record.identity?.source_id]
      .filter(value => typeof value === 'string' && value);
    for (const sourceId of sourceIds) recordIdsBySource.set(sourceId, [...(recordIdsBySource.get(sourceId) ?? []), record.record_id]);
  }
  const manifestEntry = relative => manifest.files.find(entry => entry.path === relative);
  for (const relative of ['corpus/records.jsonl', 'corpus/search-documents.jsonl', 'fixtures/controlled-vocabulary.json']) {
    const entry = manifestEntry(relative);
    const bytes = await readBytes(`packages/retrieval/versions/v1.1.0/${relative}`);
    if (!entry || entry.bytes !== bytes.length || entry.sha256 !== sha256(bytes)) throw new Error(`CURRENT_GENERATION_ARTIFACT_MISMATCH:${relative}`);
  }
  return {
    corpus_id: 'ushso-observatory-national-federal',
    corpus_version: '1.1.0',
    record_count: records.length,
    corpus_manifest_sha256: sha256(manifestBytes),
    content_fingerprint_sha256: manifest.content_fingerprint_sha256,
    algorithm_fingerprint_sha256: manifest.algorithm_fingerprint_sha256,
    records_sha256: manifestEntry('corpus/records.jsonl').sha256,
    search_documents_sha256: manifestEntry('corpus/search-documents.jsonl').sha256,
    vocabulary_sha256: manifestEntry('fixtures/controlled-vocabulary.json').sha256,
    benchmark_pin_sha256: benchmarkPinSha256,
    recordIds,
    searchDocumentIds,
    recordIdsBySource,
    records,
    searchDocuments,
  };
}

function identityResolutionState(record) {
  return record.identity?.family?.resolution_state ?? record.identity?.resolution_state ?? 'unresolved';
}

function adaptCase(question, engine) {
  const retrieved = engine.retrieve({ question: question.natural_language_question, limit: 20 });
  const results = retrieved.results.map(item => ({
    rank: item.rank,
    record_id: item.record_id,
    recommendation_state: 'recommended',
    identity_resolution_state: identityResolutionState(item.record),
    identity_presentation: 'record_native',
    why_relevant: item.relevance?.why_relevant ?? 'Returned by the development-only v2 ranker.'
  }));
  return {
    question_id: question.question_id,
    result_bundle: {
      result_state: results.length ? 'results' : 'zero_results',
      results,
      join_routes: (retrieved.join_routes ?? []).map(route => ({
        route_id: route.route_id,
        record_ids: [route.from_record_id, route.to_record_id],
        status: route.compatibility_state
      })),
      zero_result: results.length ? null : {
        reason_code: 'no_match_in_pinned_generation',
        corpus_absence_claimed: false,
        statement: 'Zero retrieved results are bounded to the pinned evaluated generation and do not establish source absence.'
      }
    }
  };
}

function summary(report) {
  return {
    run_id: report.run_id,
    lane_id: report.lane_id,
    generated_at: GENERATED_AT,
    split_counts: report.split_counts,
    question_count: report.question_count,
    quality: Object.fromEntries([3, 5, 10].map(k => {
      const full = report.metrics.full_benchmark.top_k.find(item => item.k === k);
      const present = report.metrics.present_source.top_k.find(item => item.k === k);
      return [String(k), {
        full_recall_macro: full.essential_recall.macro.score,
        full_acceptable_coverage_macro: full.legacy_acceptable_source_coverage.score,
        present_recall_macro: present.essential_recall.macro.score,
        present_graded_precision: present.graded_acceptable_precision.score,
        present_role_coverage: present.required_role_coverage.score
      }];
    })),
    safety: report.safety,
    execution_boundary: {
      ...report.execution_boundary,
      held_out_rows_parsed: 0,
      held_out_questions_evaluated: 0,
      tuning_scope: 'development_and_validation_only'
    }
  };
}

export async function buildDevelopmentValidation() {
  const splits = await readJson('evaluation/benchmark/v0.1.0/benchmark_splits.json');
  const heldOutIds = new Set(splits.splits[HOLDOUT_SPLIT]);
  const selectedQuestionIds = new Set([...splits.splits.development, ...splits.splits.validation]);
  if (selectedQuestionIds.size !== 40 || [...selectedQuestionIds].some(id => heldOutIds.has(id))) throw new Error('SPLIT_BOUNDARY_INVALID');

  const [questions, features, positives, negatives, bundles] = await Promise.all([
    readSelectedJsonl('questions.jsonl', selectedQuestionIds, 'questions'),
    readSelectedJsonl('question_features.jsonl', selectedQuestionIds, 'question_features'),
    readSelectedJsonl('relevance_judgments.jsonl', selectedQuestionIds, 'relevance_judgments'),
    readSelectedJsonl('negative_judgments.jsonl', selectedQuestionIds, 'negative_judgments'),
    readSelectedJsonl('bundle_gold.jsonl', selectedQuestionIds, 'bundle_gold')
  ]);
  if (questions.length !== selectedQuestionIds.size) throw new Error(`QUESTION_SET_INVALID:${questions.length}`);

  const benchmarkPinBytes = await readBytes('evaluation/harness/v2.0.0/benchmark-pin.json');
  const benchmarkPinSha256 = sha256(benchmarkPinBytes);
  const [sourceIndex, cohort, manifest, joinRoutesText, vocabulary, corpus] = await Promise.all([
    readJson('evaluation/benchmark/v0.1.0/source_reference_index.json'),
    readJson('evaluation/bridge/v1.0.0/cohorts/present-source-v1.json'),
    readJson('packages/retrieval/versions/v1.1.0/manifests/corpus-manifest.json'),
    fs.readFile(path.join(GENERATION_ROOT, 'corpus/join-routes.jsonl'), 'utf8'),
    readJson('packages/retrieval/versions/v1.1.0/fixtures/controlled-vocabulary.json'),
    readJson('packages/retrieval/versions/v1.1.0/corpus/corpus.json')
  ]);
  const currentGeneration = await loadCurrentGeneration(benchmarkPinSha256);
  const joinRoutes = parseJsonl(joinRoutesText, 'join-routes');
  const selectedPositiveIds = new Set(positives.map(judgment => judgment.judgment_id));
  const splitCohort = { ...cohort, requirements: cohort.requirements.filter(requirement => selectedPositiveIds.has(requirement.judgment_id)) };

  const positivesByQuestion = new Map(questions.map(question => [question.question_id, []]));
  const negativesByQuestion = new Map(questions.map(question => [question.question_id, []]));
  for (const judgment of positives) positivesByQuestion.get(judgment.question_id)?.push(judgment);
  for (const judgment of negatives) negativesByQuestion.get(judgment.question_id)?.push(judgment);
  const benchmark = {
    currentGeneration,
    generations: new Map([[currentGeneration.corpus_manifest_sha256, currentGeneration]]),
    questions,
    features,
    positives,
    negatives,
    bundles,
    plans: [],
    sourceIndex,
    splits: { ...splits, splits: { development: splits.splits.development, validation: splits.splits.validation, held_out: [] } },
    statistics: {},
    questionById: new Map(questions.map(question => [question.question_id, question])),
    featureByQuestion: new Map(features.map(feature => [feature.question_id, feature])),
    bundleByQuestion: new Map(bundles.map(bundle => [bundle.question_id, bundle])),
    positivesByQuestion,
    negativesByQuestion,
    splitByQuestion: new Map([...splits.splits.development.map(id => [id, 'development']), ...splits.splits.validation.map(id => [id, 'validation'])])
  };

  const retrievalModule = await import(path.join(REPOSITORY_ROOT, 'packages/retrieval/tools/retrieval-v2.mjs'));
  const evaluatorModule = await import(path.join(REPOSITORY_ROOT, 'evaluation/harness/v2.0.0/tools/evaluator.mjs'));
  const engine = retrievalModule.createRetrievalV2Engine({
    records: currentGeneration.records,
    searchDocuments: currentGeneration.searchDocuments,
    joinRoutes,
    vocabulary,
    corpus
  });
  const metricContract = await evaluatorModule.loadMetricContract();
  const algorithmFingerprint = sha256(Buffer.concat([
    await readBytes('packages/retrieval/tools/retrieval-v2.mjs'),
    Buffer.from(JSON.stringify(retrievalModule.DEFAULT_RETRIEVAL_V2_CONFIG))
  ]));
  const cohortBytes = await readBytes('evaluation/bridge/v1.0.0/cohorts/present-source-v1.json');
  const pins = {
    corpus_manifest_sha256: currentGeneration.corpus_manifest_sha256,
    content_fingerprint_sha256: currentGeneration.content_fingerprint_sha256,
    records_sha256: currentGeneration.records_sha256,
    search_documents_sha256: currentGeneration.search_documents_sha256,
    vocabulary_sha256: currentGeneration.vocabulary_sha256,
    algorithm_fingerprint_sha256: algorithmFingerprint,
    benchmark_pin_sha256: benchmarkPinSha256,
    cohort_manifest_sha256: sha256(cohortBytes),
    metric_contract_sha256: await evaluatorModule.metricContractSha256()
  };
  const input = {
    input_version: 'ushso-retrieval-evaluator-input.v2.0.0',
    run_id: 'ushso-wp8-v2-development-validation-20260902',
    lane_id: 'retrieval_v2_development_validation',
    k_values: metricContract.k_values,
    pins,
    cases: questions.map(question => adaptCase(question, engine))
  };
  const report = await evaluatorModule.evaluateRun(input, {
    benchmark,
    cohort: splitCohort,
    metricContract,
    expectedPins: {
      corpus_manifest_sha256: currentGeneration.corpus_manifest_sha256,
      content_fingerprint_sha256: currentGeneration.content_fingerprint_sha256,
      benchmark_pin_sha256: benchmarkPinSha256,
      algorithm_fingerprint_sha256: algorithmFingerprint
    },
    requireCompleteBenchmark: false
  });
  return {
    report,
    summary: summary(report),
    pins,
    algorithm_version: retrievalModule.RETRIEVAL_V2_VERSION,
    evaluation_cases: input.cases
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildDevelopmentValidation();
    process.stdout.write(`${JSON.stringify({ ...result.summary, pins: result.pins, algorithm_version: result.algorithm_version }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
