import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadBenchmark } from '../../../harness/v2.0.0/tools/benchmark-loader.mjs';
import {
  ZERO_RESULT_STATEMENT,
  evaluateRun,
  loadMetricContract,
  metricContractSha256
} from '../../../harness/v2.0.0/tools/evaluator.mjs';
import {
  PROJECT_ROOT,
  canonicalJson,
  listFiles,
  prettyJson,
  readJson,
  readJsonl,
  sha256,
  writeAtomic
} from '../../../harness/v2.0.0/tools/integrity.mjs';
import { BRIDGE_ROOT, buildPresentSourceCohort } from './build-cohort.mjs';

const GENERATED_AT = '2026-08-30T00:00:00.000Z';
const K_VALUES = [1, 3, 5, 10, 20];
const RETRIEVAL_ROOT = path.join(PROJECT_ROOT, 'packages/retrieval');

const CORPORA = {
  c143: {
    lane_label: 'historical-evaluation-corpus-v1.0.1-143',
    root: RETRIEVAL_ROOT,
    corpus_path: 'corpus/corpus.json',
    records_path: 'corpus/records.jsonl',
    search_documents_path: 'corpus/search-documents.jsonl',
    join_routes_path: 'corpus/join-routes.jsonl',
    vocabulary_path: 'fixtures/controlled-vocabulary.json',
    manifest_path: 'manifests/corpus-manifest.json',
    input_manifest_path: 'manifests/input-manifest.json',
    validation_path: 'validation/validation-receipt.json',
    build_receipt_path: 'receipts/build-receipt.json'
  },
  c157: {
    lane_label: 'production-migration-seed-v1.1.0-157',
    root: path.join(RETRIEVAL_ROOT, 'versions/v1.1.0'),
    corpus_path: 'corpus/corpus.json',
    records_path: 'corpus/records.jsonl',
    search_documents_path: 'corpus/search-documents.jsonl',
    join_routes_path: 'corpus/join-routes.jsonl',
    vocabulary_path: 'fixtures/controlled-vocabulary.json',
    manifest_path: 'manifests/corpus-manifest.json',
    input_manifest_path: 'manifests/input-manifest.json',
    validation_path: 'validation/validation-report.json',
    build_receipt_path: null
  }
};

const ALGORITHMS = {
  legacy: {
    label: 'legacy-package-retrieval-runtime',
    status: 'historical_package_runtime',
    module_path: 'packages/retrieval/tools/retrieval-core.mjs',
    files: [
      'packages/retrieval/tools/retrieval-core.mjs',
      'packages/retrieval/tools/question-parser.mjs',
      'packages/retrieval/tools/intent-compiler.mjs',
      'packages/retrieval/tools/search-document.mjs',
      'packages/retrieval/tools/join-routes.mjs'
    ]
  },
  production_worker: {
    label: 'production-worker-pre-wp0-runtime',
    status: 'observed_production_runtime_not_consolidated_v2',
    module_path: 'worker/retrieval-v1.1.0.mjs',
    files: [
      'worker/retrieval-v1.1.0.mjs',
      'packages/retrieval/tools/question-parser.mjs',
      'packages/retrieval/tools/intent-compiler.mjs',
      'packages/retrieval/tools/search-document.mjs',
      'packages/retrieval/tools/join-routes.mjs'
    ]
  }
};

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

async function filePin(absolutePath, relativePath = path.relative(PROJECT_ROOT, absolutePath).replaceAll('\\', '/')) {
  const bytes = await fs.readFile(absolutePath);
  return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
}

async function loadCorpus(definition) {
  const resolve = relative => path.join(definition.root, relative);
  const [corpus, records, searchDocuments, joinRoutes, vocabulary, manifest, manifestBytes] = await Promise.all([
    readJson(resolve(definition.corpus_path)),
    readJsonl(resolve(definition.records_path)),
    readJsonl(resolve(definition.search_documents_path)),
    readJsonl(resolve(definition.join_routes_path)),
    readJson(resolve(definition.vocabulary_path)),
    readJson(resolve(definition.manifest_path)),
    fs.readFile(resolve(definition.manifest_path))
  ]);
  if (records.length !== corpus.record_count || searchDocuments.length !== corpus.search_document_count || joinRoutes.length !== corpus.join_route_count) {
    throw new Error(`CORPUS_COUNT_MISMATCH:${definition.lane_label}`);
  }
  const recordIds = new Set(records.map(record => record.record_id));
  if (recordIds.size !== records.length) throw new Error(`CORPUS_RECORD_DUPLICATE:${definition.lane_label}`);
  if (new Set(searchDocuments.map(document => document.resource_record_id)).size !== searchDocuments.length) throw new Error(`CORPUS_SEARCH_DOCUMENT_DUPLICATE:${definition.lane_label}`);
  for (const document of searchDocuments) if (!recordIds.has(document.resource_record_id)) throw new Error(`CORPUS_SEARCH_ORPHAN:${document.resource_record_id}`);
  for (const entry of manifest.files) {
    const absolute = resolve(entry.path);
    const actual = await filePin(absolute, entry.path);
    if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) throw new Error(`CORPUS_MANIFEST_FILE_MISMATCH:${definition.lane_label}:${entry.path}`);
  }
  return { definition, corpus, records, searchDocuments, joinRoutes, vocabulary, manifest, manifestBytes };
}

async function corpusPin(loaded) {
  const resolve = relative => path.join(loaded.definition.root, relative);
  const paths = {
    corpus: loaded.definition.corpus_path,
    records: loaded.definition.records_path,
    search_documents: loaded.definition.search_documents_path,
    join_routes: loaded.definition.join_routes_path,
    vocabulary: loaded.definition.vocabulary_path,
    input_manifest: loaded.definition.input_manifest_path,
    validation: loaded.definition.validation_path
  };
  if (loaded.definition.build_receipt_path) paths.build_receipt = loaded.definition.build_receipt_path;
  const files = {};
  for (const [key, relative] of Object.entries(paths)) files[key] = await filePin(resolve(relative));
  return {
    pin_version: 'ushso-retrieval-corpus-pin.v1',
    lane_label: loaded.definition.lane_label,
    corpus_id: loaded.corpus.corpus_id,
    corpus_version: loaded.corpus.corpus_version,
    record_count: loaded.records.length,
    search_document_count: loaded.searchDocuments.length,
    join_route_count: loaded.joinRoutes.length,
    corpus_manifest_sha256: sha256(loaded.manifestBytes),
    content_fingerprint_sha256: loaded.corpus.manifest_sha256,
    package_algorithm_fingerprint_sha256: loaded.corpus.algorithm_fingerprint_sha256,
    files
  };
}

async function algorithmPin(definition) {
  const files = [];
  for (const relative of definition.files) files.push(await filePin(path.join(PROJECT_ROOT, relative), relative));
  return {
    pin_version: 'ushso-retrieval-runtime-algorithm-pin.v1',
    label: definition.label,
    status: definition.status,
    module_path: definition.module_path,
    files,
    algorithm_fingerprint_sha256: sha256(canonicalJson(files)),
    consolidated_v2_algorithm: false,
    tuning_performed_by_bridge: false
  };
}

function topLevelDiff(left, right) {
  const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
  return [...keys].filter(key => canonicalJson(left?.[key]) !== canonicalJson(right?.[key])).sort();
}

function buildCorpusDelta(historical, current, pins) {
  const historicalRecords = new Map(historical.records.map(record => [record.record_id, record]));
  const currentRecords = new Map(current.records.map(record => [record.record_id, record]));
  const historicalDocuments = new Map(historical.searchDocuments.map(document => [document.resource_record_id, document]));
  const currentDocuments = new Map(current.searchDocuments.map(document => [document.resource_record_id, document]));
  const addedRecordIds = [...currentRecords.keys()].filter(id => !historicalRecords.has(id)).sort();
  const removedRecordIds = [...historicalRecords.keys()].filter(id => !currentRecords.has(id)).sort();
  const changedRecordIds = [...historicalRecords.keys()].filter(id => currentRecords.has(id) && canonicalJson(historicalRecords.get(id)) !== canonicalJson(currentRecords.get(id))).sort();
  const changedDocuments = [...historicalDocuments.keys()].filter(id => currentDocuments.has(id) && canonicalJson(historicalDocuments.get(id)) !== canonicalJson(currentDocuments.get(id))).map(id => ({
    record_id: id,
    changed_top_level_fields: topLevelDiff(historicalDocuments.get(id), currentDocuments.get(id))
  })).sort((a, b) => a.record_id.localeCompare(b.record_id));
  const oldSubjectIds = new Set((historical.vocabulary.subjects ?? []).map(subject => subject.id));
  const newSubjectIds = new Set((current.vocabulary.subjects ?? []).map(subject => subject.id));
  return {
    delta_version: 'ushso-retrieval-corpus-delta.v1',
    generated_at: GENERATED_AT,
    from: pins.c143.lane_label,
    to: pins.c157.lane_label,
    records: {
      historical: historical.records.length,
      current: current.records.length,
      unchanged_existing: historical.records.length - changedRecordIds.length - removedRecordIds.length,
      changed_existing: changedRecordIds.length,
      added: addedRecordIds.length,
      removed: removedRecordIds.length,
      added_record_ids: addedRecordIds,
      changed_record_ids: changedRecordIds,
      removed_record_ids: removedRecordIds
    },
    search_documents: {
      historical: historical.searchDocuments.length,
      current: current.searchDocuments.length,
      changed_existing: changedDocuments.length,
      changes: changedDocuments,
      note: 'A corpus-only attribution must include these regenerated projections; v1.1.0 is not a fourteen-row append.'
    },
    vocabulary: {
      historical_sha256: pins.c143.files.vocabulary.sha256,
      current_sha256: pins.c157.files.vocabulary.sha256,
      added_subject_ids: [...newSubjectIds].filter(id => !oldSubjectIds.has(id)).sort(),
      removed_subject_ids: [...oldSubjectIds].filter(id => !newSubjectIds.has(id)).sort()
    },
    join_routes: {
      historical_count: historical.joinRoutes.length,
      current_count: current.joinRoutes.length,
      bytes_identical: pins.c143.files.join_routes.sha256 === pins.c157.files.join_routes.sha256,
      historical_sha256: pins.c143.files.join_routes.sha256,
      current_sha256: pins.c157.files.join_routes.sha256
    }
  };
}

function identityResolutionState(record) {
  const value = record.identity?.family?.resolution_state ?? 'unresolved';
  if (value === 'unresolved') return 'unresolved';
  if (['candidate', 'ambiguous'].includes(value)) return 'candidate';
  return 'resolved';
}

function routeStatus(route) {
  if (route.compatibility_state === 'documented') return 'join_documented';
  if (route.compatibility_state === 'candidate') {
    return /crosswalk/i.test(route.match_strategy ?? '') ? 'join_requires_crosswalk' : 'join_candidate';
  }
  return 'unknown';
}

function adaptCase(question, result) {
  const results = result.results.map(item => ({
    rank: item.rank,
    record_id: item.record_id,
    source_id: item.record.identity?.match_fields?.source_id ?? null,
    family_id: item.record.identity?.family?.family_id ?? null,
    recommendation_state: 'recommended',
    access_status: item.record.access?.status ?? 'unknown',
    why_relevant: item.relevance?.why_relevant ?? '',
    identity_resolution_state: identityResolutionState(item.record),
    identity_presentation: 'record_native'
  }));
  const zero = results.length === 0;
  return {
    question_id: question.question_id,
    result_bundle: {
      result_state: zero ? 'zero_results' : 'results',
      results,
      join_routes: result.join_routes.map(route => ({
        route_id: route.route_id,
        record_ids: [route.from_record_id, route.to_record_id],
        status: routeStatus(route)
      })),
      zero_result: zero ? {
        reason_code: 'no_match_in_pinned_generation',
        corpus_absence_claimed: false,
        statement: ZERO_RESULT_STATEMENT
      } : null
    }
  };
}

async function buildLane({ laneId, corpusKey, algorithmKey, corpus, corpusPin: pin, algorithmPin: runtimePin, benchmark, cohort, cohortSha256, metricContract, metricSha256 }) {
  const definition = ALGORITHMS[algorithmKey];
  const module = await import(pathToFileURL(path.join(PROJECT_ROOT, definition.module_path)).href);
  const engine = module.createRetrievalEngine({
    records: corpus.records,
    searchDocuments: corpus.searchDocuments,
    joinRoutes: corpus.joinRoutes,
    vocabulary: corpus.vocabulary,
    corpus: corpus.corpus
  });
  const cases = benchmark.questions.map(question => adaptCase(question, engine.retrieve({
    question: question.natural_language_question,
    include_restricted: true,
    limit: 20
  })));
  const pins = {
    corpus_manifest_sha256: pin.corpus_manifest_sha256,
    content_fingerprint_sha256: pin.content_fingerprint_sha256,
    records_sha256: pin.files.records.sha256,
    search_documents_sha256: pin.files.search_documents.sha256,
    vocabulary_sha256: pin.files.vocabulary.sha256,
    algorithm_fingerprint_sha256: runtimePin.algorithm_fingerprint_sha256,
    benchmark_pin_sha256: benchmark.pin_sha256,
    cohort_manifest_sha256: cohortSha256,
    metric_contract_sha256: metricSha256
  };
  const input = {
    input_version: 'ushso-retrieval-evaluator-input.v2.0.0',
    run_id: `ushso-pre-tuning-bridge-${laneId}`,
    lane_id: laneId,
    pins,
    k_values: K_VALUES,
    cases
  };
  const report = await evaluateRun(input, {
    benchmark,
    cohort,
    metricContract,
    expectedPins: {
      benchmark_pin_sha256: benchmark.pin_sha256,
      cohort_manifest_sha256: cohortSha256,
      metric_contract_sha256: metricSha256
    }
  });
  return { laneId, corpusKey, algorithmKey, input, report };
}

function metricAt(report, k) {
  const full = report.metrics.full_benchmark.top_k.find(item => item.k === k);
  const present = report.metrics.present_source.top_k.find(item => item.k === k);
  return {
    full_essential_recall_macro: full.essential_recall.macro.score,
    full_essential_recall_micro: full.essential_recall.micro.score,
    full_legacy_acceptable_coverage_macro: full.legacy_acceptable_source_coverage.score,
    full_strict_exact_gold_precision: full.strict_exact_gold_precision.score,
    full_graded_acceptable_precision: full.graded_acceptable_precision.score,
    present_essential_recall_macro: present.essential_recall.macro.score,
    present_essential_recall_micro: present.essential_recall.micro.score,
    present_strict_exact_gold_precision: present.strict_exact_gold_precision.score,
    present_graded_acceptable_precision: present.graded_acceptable_precision.score,
    present_required_role_coverage: present.required_role_coverage.score
  };
}

function metricReceiptAt(report, k) {
  const full = report.metrics.full_benchmark.top_k.find(item => item.k === k);
  const present = report.metrics.present_source.top_k.find(item => item.k === k);
  return {
    full_benchmark: {
      essential_recall: full.essential_recall,
      legacy_acceptable_source_coverage: full.legacy_acceptable_source_coverage,
      strict_exact_gold_precision: full.strict_exact_gold_precision,
      graded_acceptable_precision: full.graded_acceptable_precision,
      required_role_coverage: full.required_role_coverage,
      short_list_count: full.short_list_count,
      duplicate_result_count: full.duplicate_result_count,
      unmatched_result_count: full.unmatched_result_count
    },
    present_source: {
      essential_recall: present.essential_recall,
      legacy_acceptable_source_coverage: present.legacy_acceptable_source_coverage,
      strict_exact_gold_precision: present.strict_exact_gold_precision,
      graded_acceptable_precision: present.graded_acceptable_precision,
      required_role_coverage: present.required_role_coverage,
      short_list_count: present.short_list_count,
      duplicate_result_count: present.duplicate_result_count,
      unmatched_result_count: present.unmatched_result_count
    }
  };
}

function metricDelta(left, right) {
  return Object.fromEntries(Object.keys(left).map(key => [key, round(right[key] - left[key])]));
}

function qualityGates(report, laneId) {
  const at3 = metricAt(report, 3);
  const at5 = metricAt(report, 5);
  const at10 = metricAt(report, 10);
  return {
    lane_id: laneId,
    historical_recall_at_10: { target: 0.5, actual: at10.full_essential_recall_macro, pass: at10.full_essential_recall_macro >= 0.5 },
    full_recall_at_3: { target: 0.45, actual: at3.full_essential_recall_macro, pass: at3.full_essential_recall_macro >= 0.45 },
    full_acceptable_coverage_at_3: { target: 0.4, actual: at3.full_legacy_acceptable_coverage_macro, pass: at3.full_legacy_acceptable_coverage_macro >= 0.4 },
    present_recall_at_3: { target: 0.7, actual: at3.present_essential_recall_macro, pass: at3.present_essential_recall_macro >= 0.7 },
    present_recall_at_5: { target: 0.8, actual: at5.present_essential_recall_macro, pass: at5.present_essential_recall_macro >= 0.8 },
    present_recall_at_10: { target: 0.9, actual: at10.present_essential_recall_macro, pass: at10.present_essential_recall_macro >= 0.9 },
    present_graded_precision_at_5: { target: 0.7, actual: at5.present_graded_acceptable_precision, pass: at5.present_graded_acceptable_precision >= 0.7 },
    present_role_coverage_at_10: { target: 0.9, actual: at10.present_required_role_coverage, pass: at10.present_required_role_coverage >= 0.9 },
    safety_zero_tolerance: { target: true, actual: report.safety.zero_tolerance_pass, pass: report.safety.zero_tolerance_pass }
  };
}

function buildAttributionMatrix(lanes, corpusPins, algorithmPins, corpusDelta) {
  const byId = new Map(lanes.map(lane => [lane.laneId, lane]));
  const rows = lanes.map(lane => ({
    lane_id: lane.laneId,
    corpus: corpusPins[lane.corpusKey].lane_label,
    corpus_manifest_sha256: corpusPins[lane.corpusKey].corpus_manifest_sha256,
    algorithm: algorithmPins[lane.algorithmKey].label,
    algorithm_fingerprint_sha256: algorithmPins[lane.algorithmKey].algorithm_fingerprint_sha256,
    metrics: Object.fromEntries(K_VALUES.map(k => [String(k), metricAt(lane.report, k)])),
    metric_receipts: Object.fromEntries(K_VALUES.map(k => [String(k), metricReceiptAt(lane.report, k)])),
    safety: lane.report.safety
  }));
  const c143Legacy = byId.get('c143_legacy').report;
  const c157Legacy = byId.get('c157_legacy').report;
  const c143Worker = byId.get('c143_production_worker').report;
  const c157Worker = byId.get('c157_production_worker').report;
  const deltas = {};
  for (const k of K_VALUES) {
    const a = metricAt(c143Legacy, k);
    const b = metricAt(c157Legacy, k);
    const c = metricAt(c143Worker, k);
    const d = metricAt(c157Worker, k);
    const corpusLegacy = metricDelta(a, b);
    const corpusWorker = metricDelta(c, d);
    deltas[String(k)] = {
      corpus_effect_under_legacy_algorithm: corpusLegacy,
      corpus_effect_under_production_worker: corpusWorker,
      algorithm_effect_on_143_corpus: metricDelta(a, c),
      algorithm_effect_on_157_corpus: metricDelta(b, d),
      corpus_algorithm_interaction: Object.fromEntries(Object.keys(corpusLegacy).map(key => [key, round(corpusWorker[key] - corpusLegacy[key])]))
    };
  }
  return {
    matrix_version: 'ushso-retrieval-attribution-matrix.v1',
    evaluator_version: 'ushso-retrieval-evaluator.v2.0.0',
    generated_at: GENERATED_AT,
    interpretation: {
      pre_tuning: true,
      consolidated_v2_algorithm_available: false,
      production_worker_lane: 'Observed current production runtime, retained as an alternate pre-WP0 algorithm lane; it is not called a tuned or accepted v2 algorithm.',
      same_algorithm_corpus_bridge: 'Compare c143_legacy with c157_legacy (or the two production-worker lanes) to attribute corpus/projection/vocabulary changes while holding algorithm bytes fixed.',
      algorithm_bridge: 'Compare algorithms within a fixed corpus; do not attribute this delta to the corpus.',
      held_out_status: 'The v0.1.0 held-out gold was already published and evaluated by the legacy baseline. These 20 questions remain audit-only and are not a sealed final-gate hold-out for tuning.'
    },
    release_gate_status: 'FAIL_PRE_TUNING',
    release_gate_pass: false,
    unavailable_lanes: [
      {
        lane_id: 'c143_consolidated_v2_algorithm',
        corpus: corpusPins.c143.lane_label,
        status: 'unavailable',
        reason: 'No consolidated retrieval-v2 runtime exists in the repository. The bridge seals this absence and does not invent or tune one.'
      },
      {
        lane_id: 'c157_consolidated_v2_algorithm',
        corpus: corpusPins.c157.lane_label,
        status: 'unavailable',
        reason: 'No consolidated retrieval-v2 runtime exists in the repository. The bridge seals this absence and does not invent or tune one.'
      }
    ],
    corpus_delta_summary: {
      added_records: corpusDelta.records.added,
      changed_existing_records: corpusDelta.records.changed_existing,
      changed_existing_search_documents: corpusDelta.search_documents.changed_existing,
      vocabulary_changed: corpusDelta.vocabulary.historical_sha256 !== corpusDelta.vocabulary.current_sha256,
      join_routes_identical: corpusDelta.join_routes.bytes_identical
    },
    lanes: rows,
    deltas,
    gate_receipts: {
      historical_bridge: qualityGates(c143Legacy, 'c143_legacy'),
      current_same_algorithm_bridge: qualityGates(c157Legacy, 'c157_legacy'),
      current_production_observation: qualityGates(c157Worker, 'c157_production_worker')
    }
  };
}

function matrixMarkdown(matrix) {
  const lines = [
    '# Evaluator-v2 retrieval attribution matrix',
    '',
    'All values below use the same frozen evaluator, benchmark, cohort, and metric contract. The production Worker is an observed alternate runtime, not an accepted post-WP0 algorithm.',
    '',
    '| Lane | Corpus | Algorithm | Full recall@3 | Full recall@10 | Present recall@5 | Present recall@10 | Graded precision@5 |',
    '|---|---|---|---:|---:|---:|---:|---:|'
  ];
  for (const lane of matrix.lanes) {
    lines.push(`| ${lane.lane_id} | ${lane.corpus} | ${lane.algorithm} | ${lane.metrics['3'].full_essential_recall_macro.toFixed(6)} | ${lane.metrics['10'].full_essential_recall_macro.toFixed(6)} | ${lane.metrics['5'].present_essential_recall_macro.toFixed(6)} | ${lane.metrics['10'].present_essential_recall_macro.toFixed(6)} | ${lane.metrics['5'].present_graded_acceptable_precision.toFixed(6)} |`);
  }
  lines.push('', 'Corpus v1.1.0 adds 14 records, changes the vocabulary, and regenerates 37 existing search documents while leaving all 143 existing record objects and all 14 join routes unchanged.', '', 'The machine-readable matrix contains macro/micro numerators and denominators, safety counts, all rank cutoffs, and difference-in-differences attribution.', '');
  return lines.join('\n');
}

async function writeOrVerify(relativePath, content) {
  const target = path.join(BRIDGE_ROOT, relativePath);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  try {
    const current = await fs.readFile(target);
    if (!current.equals(bytes)) throw new Error(`IMMUTABLE_BRIDGE_OUTPUT_CONFLICT:${relativePath}`);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeAtomic(target, bytes);
}

async function buildPackageManifest() {
  const excluded = new Set(['manifests/package-manifest.json']);
  const files = [];
  for (const relative of await listFiles(BRIDGE_ROOT, excluded)) files.push(await filePin(path.join(BRIDGE_ROOT, relative), relative));
  return {
    manifest_version: 'ushso-retrieval-bridge-package-manifest.v1',
    package_id: 'ushso-retrieval-evaluator-bridge-v1.0.0',
    generated_at: GENERATED_AT,
    immutable: true,
    file_count: files.length,
    payload_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
    external_requests: 0,
    ranking_optimization_performed: false,
    source_payloads_accessed: 0,
    analyses_executed: 0
  };
}

export async function runBridge({ write = false } = {}) {
  const [historical, current, benchmark, cohort, metricContract, metricSha256] = await Promise.all([
    loadCorpus(CORPORA.c143),
    loadCorpus(CORPORA.c157),
    loadBenchmark(),
    buildPresentSourceCohort(),
    loadMetricContract(),
    metricContractSha256()
  ]);
  const cohortBytes = Buffer.from(prettyJson(cohort));
  const cohortSha256 = sha256(cohortBytes);
  const corpusPins = { c143: await corpusPin(historical), c157: await corpusPin(current) };
  const algorithmPins = { legacy: await algorithmPin(ALGORITHMS.legacy), production_worker: await algorithmPin(ALGORITHMS.production_worker) };
  const corpusDelta = buildCorpusDelta(historical, current, corpusPins);
  const laneDefinitions = [
    ['c143_legacy', 'c143', 'legacy', historical],
    ['c157_legacy', 'c157', 'legacy', current],
    ['c143_production_worker', 'c143', 'production_worker', historical],
    ['c157_production_worker', 'c157', 'production_worker', current]
  ];
  const lanes = [];
  for (const [laneId, corpusKey, algorithmKey, corpus] of laneDefinitions) {
    lanes.push(await buildLane({ laneId, corpusKey, algorithmKey, corpus, corpusPin: corpusPins[corpusKey], algorithmPin: algorithmPins[algorithmKey], benchmark, cohort, cohortSha256, metricContract, metricSha256 }));
  }
  const matrix = buildAttributionMatrix(lanes, corpusPins, algorithmPins, corpusDelta);
  const generated = new Map([
    ['cohorts/present-source-v1.json', cohortBytes],
    ['manifests/corpus-pins.json', Buffer.from(prettyJson({ manifest_version: 'ushso-retrieval-corpus-pins.v1', generated_at: GENERATED_AT, corpora: corpusPins }))],
    ['manifests/algorithm-pins.json', Buffer.from(prettyJson({ manifest_version: 'ushso-retrieval-algorithm-pins.v1', generated_at: GENERATED_AT, algorithms: algorithmPins, consolidated_v2_algorithm_available: false }))],
    ['outputs/corpus-delta.json', Buffer.from(prettyJson(corpusDelta))],
    ['outputs/attribution-matrix.json', Buffer.from(prettyJson(matrix))],
    ['outputs/attribution-matrix.md', Buffer.from(matrixMarkdown(matrix))]
  ]);
  for (const lane of lanes) {
    generated.set(`outputs/inputs/${lane.laneId}.json`, Buffer.from(prettyJson(lane.input)));
    generated.set(`outputs/reports/${lane.laneId}.json`, Buffer.from(prettyJson(lane.report)));
  }
  const outputPins = [...generated.entries()].map(([relativePath, bytes]) => ({ path: relativePath, bytes: bytes.length, sha256: sha256(bytes) })).sort((a, b) => a.path.localeCompare(b.path));
  const receipt = {
    receipt_version: 'ushso-retrieval-evaluator-bridge-receipt.v1',
    generated_at: GENERATED_AT,
    status: 'PASS',
    status_scope: 'Artifact generation and digest verification only.',
    release_gate_status: matrix.release_gate_status,
    release_gate_pass: matrix.release_gate_pass,
    evaluator_version: 'ushso-retrieval-evaluator.v2.0.0',
    benchmark_pin_sha256: benchmark.pin_sha256,
    cohort_manifest_sha256: cohortSha256,
    metric_contract_sha256: metricSha256,
    corpus_pins: Object.fromEntries(Object.entries(corpusPins).map(([key, value]) => [key, value.corpus_manifest_sha256])),
    algorithm_pins: Object.fromEntries(Object.entries(algorithmPins).map(([key, value]) => [key, value.algorithm_fingerprint_sha256])),
    primary_same_algorithm_bridge: {
      from_lane: 'c143_legacy',
      to_lane: 'c157_legacy',
      algorithm_fingerprint_sha256: algorithmPins.legacy.algorithm_fingerprint_sha256
    },
    consolidated_v2_algorithm_available: false,
    unavailable_algorithm_lanes: matrix.unavailable_lanes,
    output_count: outputPins.length,
    outputs: outputPins,
    execution_boundary: {
      external_requests: 0,
      ranking_optimization_performed: false,
      llm_used: false,
      source_payloads_accessed: 0,
      analyses_executed: 0,
      identity_merges_performed: 0
    }
  };

  if (write) {
    for (const [relative, bytes] of generated) await writeOrVerify(relative, bytes);
    await writeOrVerify('receipts/bridge-receipt.json', prettyJson(receipt));
    const packageManifest = await buildPackageManifest();
    await writeOrVerify('manifests/package-manifest.json', prettyJson(packageManifest));
  }
  return { cohort, cohortBytes, corpusPins, algorithmPins, corpusDelta, lanes, matrix, receipt, generated };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runBridge({ write: process.argv.includes('--write') });
    const sameAlgorithmCurrent = result.matrix.lanes.find(lane => lane.lane_id === 'c157_legacy');
    const observedWorker = result.matrix.lanes.find(lane => lane.lane_id === 'c157_production_worker');
    const quality = current => ({
      full_recall_at_3: current.metrics['3'].full_essential_recall_macro,
      full_recall_at_10: current.metrics['10'].full_essential_recall_macro,
      present_recall_at_5: current.metrics['5'].present_essential_recall_macro,
      present_recall_at_10: current.metrics['10'].present_essential_recall_macro,
      present_graded_precision_at_5: current.metrics['5'].present_graded_acceptable_precision,
      prohibited_by_access_recommendations: current.safety.prohibited_by_access_recommendations
    });
    process.stdout.write(prettyJson({
      status: 'PASS',
      release_gate_status: result.matrix.release_gate_status,
      release_gate_pass: result.matrix.release_gate_pass,
      wrote_outputs: process.argv.includes('--write'),
      lanes: result.lanes.length,
      cohort: result.cohort.counts,
      corpus_delta: result.matrix.corpus_delta_summary,
      current_quality: {
        same_algorithm_bridge: quality(sameAlgorithmCurrent),
        observed_production_worker: quality(observedWorker)
      }
    }));
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
