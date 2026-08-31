import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(TOOL_DIR, '../../../..');
export const DEFAULT_RECEIPT_PATH = path.join(
  REPOSITORY_ROOT,
  'verification/wp0/v1.0.0/receipts/production-baseline.json',
);

const RECEIPT_VERSION = 'ushso.wp0.production-evaluation-baseline.v1.0.0';
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function fail(code, detail = '') {
  throw new Error(detail ? `${code}: ${detail}` : code);
}

function requireCondition(condition, code, detail = '') {
  if (!condition) fail(code, detail);
}

function assertExactKeys(value, keys, label) {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), 'BASELINE_EXPECTED_OBJECT', label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  try {
    assert.deepEqual(actual, expected);
  } catch {
    fail('BASELINE_UNEXPECTED_FIELDS', `${label}; expected ${expected.join(', ')}, received ${actual.join(', ')}`);
  }
}

function assertRelativeArtifactPath(relativePath, label) {
  requireCondition(typeof relativePath === 'string' && relativePath.length > 0, 'BASELINE_INVALID_PATH', label);
  requireCondition(!path.isAbsolute(relativePath), 'BASELINE_ABSOLUTE_PATH', label);
  const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/'));
  requireCondition(normalized !== '..' && !normalized.startsWith('../'), 'BASELINE_PATH_TRAVERSAL', label);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function readPinnedArtifact(repositoryRoot, specification, label) {
  assertExactKeys(specification, ['path', 'bytes', 'file_sha256'], label);
  assertRelativeArtifactPath(specification.path, `${label}.path`);
  requireCondition(Number.isSafeInteger(specification.bytes) && specification.bytes >= 0, 'BASELINE_INVALID_BYTE_COUNT', label);
  requireCondition(SHA256_PATTERN.test(specification.file_sha256), 'BASELINE_INVALID_SHA256', label);

  const absolutePath = path.resolve(repositoryRoot, specification.path);
  const relativeToRoot = path.relative(repositoryRoot, absolutePath);
  requireCondition(relativeToRoot !== '..' && !relativeToRoot.startsWith(`..${path.sep}`), 'BASELINE_PATH_ESCAPES_ROOT', label);

  let bytes;
  try {
    bytes = await fs.readFile(absolutePath);
  } catch (error) {
    fail('BASELINE_ARTIFACT_UNREADABLE', `${label}: ${error.code ?? error.message}`);
  }
  requireCondition(bytes.byteLength === specification.bytes, 'BASELINE_BYTE_COUNT_MISMATCH', label);
  requireCondition(sha256(bytes) === specification.file_sha256, 'BASELINE_FILE_HASH_MISMATCH', label);
  return bytes;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail('BASELINE_INVALID_JSON', `${label}: ${error.message}`);
  }
}

function parseJsonLines(bytes, label) {
  const lines = bytes.toString('utf8').split(/\r?\n/u).filter(line => line.trim().length > 0);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      fail('BASELINE_INVALID_JSONL', `${label} line ${index + 1}: ${error.message}`);
    }
  });
}

function assertDeepEqual(actual, expected, code, label) {
  try {
    assert.deepEqual(actual, expected);
  } catch {
    fail(code, label);
  }
}

function assertUnique(values, code, label) {
  requireCondition(values.every(value => typeof value === 'string' && value.length > 0), code, `${label} contains a missing identifier`);
  requireCondition(new Set(values).size === values.length, code, `${label} contains duplicate identifiers`);
}

async function validateManifestEntries(repositoryRoot, manifest, packageRoot, laneLabel) {
  for (const collectionName of ['algorithm_files', 'files']) {
    const entries = manifest[collectionName];
    if (entries === undefined) continue;
    requireCondition(Array.isArray(entries) && entries.length > 0, 'BASELINE_EMPTY_MANIFEST_COLLECTION', `${laneLabel}.${collectionName}`);
    for (const [index, entry] of entries.entries()) {
      assertExactKeys(entry, ['path', 'bytes', 'sha256'], `${laneLabel}.${collectionName}[${index}]`);
      assertRelativeArtifactPath(entry.path, `${laneLabel}.${collectionName}[${index}].path`);
      requireCondition(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0, 'BASELINE_INVALID_MANIFEST_BYTE_COUNT', entry.path);
      requireCondition(SHA256_PATTERN.test(entry.sha256), 'BASELINE_INVALID_MANIFEST_SHA256', entry.path);
      const specification = {
        path: path.posix.join(packageRoot, entry.path),
        bytes: entry.bytes,
        file_sha256: entry.sha256,
      };
      await readPinnedArtifact(repositoryRoot, specification, `${laneLabel}.${collectionName}[${index}]`);
    }
  }
}

function validateCountsShape(counts, expectedSliceNames, laneLabel) {
  assertExactKeys(counts, ['records', 'search_documents', 'join_routes', 'source_slices'], `${laneLabel}.counts`);
  assertExactKeys(counts.source_slices, expectedSliceNames, `${laneLabel}.counts.source_slices`);
  for (const key of ['records', 'search_documents', 'join_routes']) {
    requireCondition(Number.isSafeInteger(counts[key]) && counts[key] >= 0, 'BASELINE_INVALID_COUNT', `${laneLabel}.${key}`);
  }
  for (const [slice, count] of Object.entries(counts.source_slices)) {
    requireCondition(Number.isSafeInteger(count) && count >= 0, 'BASELINE_INVALID_SLICE_COUNT', `${laneLabel}.${slice}`);
  }
  const sliceTotal = Object.values(counts.source_slices).reduce((sum, count) => sum + count, 0);
  requireCondition(sliceTotal === counts.records, 'BASELINE_SLICE_TOTAL_MISMATCH', laneLabel);
}

async function validateCorpusLane(repositoryRoot, lane, configuration) {
  assertExactKeys(
    lane,
    configuration.includeEvaluation
      ? ['role', 'corpus_id', 'corpus_version', 'manifest', 'content_fingerprint_sha256', 'algorithm_fingerprint_sha256', 'counts', 'artifacts', 'evaluation']
      : ['role', 'corpus_id', 'corpus_version', 'manifest', 'content_fingerprint_sha256', 'algorithm_fingerprint_sha256', 'counts', 'artifacts'],
    configuration.label,
  );
  requireCondition(lane.role === configuration.role, 'BASELINE_ROLE_MISMATCH', configuration.label);
  requireCondition(lane.corpus_version === configuration.version, 'BASELINE_VERSION_MISMATCH', configuration.label);
  requireCondition(SHA256_PATTERN.test(lane.content_fingerprint_sha256), 'BASELINE_INVALID_CONTENT_FINGERPRINT', configuration.label);
  requireCondition(SHA256_PATTERN.test(lane.algorithm_fingerprint_sha256), 'BASELINE_INVALID_ALGORITHM_FINGERPRINT', configuration.label);
  validateCountsShape(lane.counts, configuration.sliceNames, configuration.label);

  const manifestBytes = await readPinnedArtifact(repositoryRoot, lane.manifest, `${configuration.label}.manifest`);
  const manifest = parseJson(manifestBytes, `${configuration.label}.manifest`);
  requireCondition(manifest.corpus_id === lane.corpus_id, 'BASELINE_MANIFEST_CORPUS_ID_MISMATCH', configuration.label);
  requireCondition(manifest.corpus_version === lane.corpus_version, 'BASELINE_MANIFEST_VERSION_MISMATCH', configuration.label);
  requireCondition(manifest.content_fingerprint_sha256 === lane.content_fingerprint_sha256, 'BASELINE_CONTENT_FINGERPRINT_MISMATCH', configuration.label);
  requireCondition(manifest.algorithm_fingerprint_sha256 === lane.algorithm_fingerprint_sha256, 'BASELINE_ALGORITHM_FINGERPRINT_MISMATCH', configuration.label);
  await validateManifestEntries(repositoryRoot, manifest, configuration.packageRoot, configuration.label);

  assertExactKeys(lane.artifacts, configuration.artifactNames, `${configuration.label}.artifacts`);
  const artifactBytes = {};
  for (const artifactName of configuration.artifactNames) {
    artifactBytes[artifactName] = await readPinnedArtifact(
      repositoryRoot,
      lane.artifacts[artifactName],
      `${configuration.label}.artifacts.${artifactName}`,
    );
  }

  const corpus = parseJson(artifactBytes.corpus_metadata, `${configuration.label}.corpus_metadata`);
  requireCondition(corpus.corpus_id === lane.corpus_id, 'BASELINE_CORPUS_ID_MISMATCH', configuration.label);
  requireCondition(corpus.corpus_version === lane.corpus_version, 'BASELINE_CORPUS_VERSION_MISMATCH', configuration.label);
  requireCondition(corpus.manifest_sha256 === lane.content_fingerprint_sha256, 'BASELINE_CORPUS_CONTENT_FINGERPRINT_MISMATCH', configuration.label);
  requireCondition(corpus.algorithm_fingerprint_sha256 === lane.algorithm_fingerprint_sha256, 'BASELINE_CORPUS_ALGORITHM_FINGERPRINT_MISMATCH', configuration.label);
  requireCondition(corpus.record_count === lane.counts.records, 'BASELINE_CORPUS_RECORD_COUNT_MISMATCH', configuration.label);
  requireCondition(corpus.search_document_count === lane.counts.search_documents, 'BASELINE_CORPUS_SEARCH_COUNT_MISMATCH', configuration.label);
  requireCondition(corpus.join_route_count === lane.counts.join_routes, 'BASELINE_CORPUS_ROUTE_COUNT_MISMATCH', configuration.label);
  assertDeepEqual(corpus.source_slices, lane.counts.source_slices, 'BASELINE_CORPUS_SLICES_MISMATCH', configuration.label);

  const records = parseJsonLines(artifactBytes.records, `${configuration.label}.records`);
  const searchDocuments = parseJsonLines(artifactBytes.search_documents, `${configuration.label}.search_documents`);
  const joinRoutes = parseJsonLines(artifactBytes.join_routes, `${configuration.label}.join_routes`);
  requireCondition(records.length === lane.counts.records, 'BASELINE_RECORD_LINE_COUNT_MISMATCH', configuration.label);
  requireCondition(searchDocuments.length === lane.counts.search_documents, 'BASELINE_SEARCH_LINE_COUNT_MISMATCH', configuration.label);
  requireCondition(joinRoutes.length === lane.counts.join_routes, 'BASELINE_ROUTE_LINE_COUNT_MISMATCH', configuration.label);
  assertUnique(records.map(record => record.record_id), 'BASELINE_RECORD_IDENTITY_INVALID', configuration.label);
  assertUnique(searchDocuments.map(document => document.search_document_id), 'BASELINE_SEARCH_IDENTITY_INVALID', configuration.label);
  assertUnique(joinRoutes.map(route => route.route_id), 'BASELINE_ROUTE_IDENTITY_INVALID', configuration.label);

  return { artifactBytes, manifest, corpus, records, searchDocuments, joinRoutes };
}

function validateTesterReconciliation(receipt) {
  const reconciliation = receipt.tester_slice_reconciliation;
  assertExactKeys(
    reconciliation,
    ['tester_listed_slices', 'tester_listed_sum', 'omitted_from_tester_arithmetic', 'corrected_production_total', 'disposition'],
    'tester_slice_reconciliation',
  );
  assertExactKeys(
    reconciliation.tester_listed_slices,
    ['lane_c_harvard_dataverse', 'lane_c_datacite', 'pennsylvania_catalog', 'curated_authoritative_registry', 'national_federal_backbone_live_validated'],
    'tester_slice_reconciliation.tester_listed_slices',
  );
  assertExactKeys(reconciliation.omitted_from_tester_arithmetic, ['slice', 'records'], 'tester_slice_reconciliation.omitted_from_tester_arithmetic');
  const listedSum = Object.values(reconciliation.tester_listed_slices).reduce((sum, count) => sum + count, 0);
  requireCondition(listedSum === 153, 'BASELINE_TESTER_LISTED_SUM_CHANGED');
  requireCondition(reconciliation.tester_listed_sum === listedSum, 'BASELINE_TESTER_LISTED_SUM_MISMATCH');
  requireCondition(reconciliation.omitted_from_tester_arithmetic.slice === 'canonical_base', 'BASELINE_TESTER_OMITTED_SLICE_MISMATCH');
  requireCondition(reconciliation.omitted_from_tester_arithmetic.records === 4, 'BASELINE_TESTER_OMITTED_COUNT_MISMATCH');
  requireCondition(listedSum + reconciliation.omitted_from_tester_arithmetic.records === reconciliation.corrected_production_total, 'BASELINE_TESTER_CORRECTED_TOTAL_MISMATCH');
  requireCondition(reconciliation.corrected_production_total === receipt.production_migration_seed.counts.records, 'BASELINE_TESTER_PRODUCTION_TOTAL_MISMATCH');
  assertDeepEqual(
    { ...reconciliation.tester_listed_slices, canonical_base: reconciliation.omitted_from_tester_arithmetic.records },
    {
      lane_c_harvard_dataverse: receipt.production_migration_seed.counts.source_slices.lane_c_harvard_dataverse,
      lane_c_datacite: receipt.production_migration_seed.counts.source_slices.lane_c_datacite,
      pennsylvania_catalog: receipt.production_migration_seed.counts.source_slices.pennsylvania_catalog,
      curated_authoritative_registry: receipt.production_migration_seed.counts.source_slices.curated_authoritative_registry,
      national_federal_backbone_live_validated: receipt.production_migration_seed.counts.source_slices.national_federal_backbone_live_validated,
      canonical_base: receipt.production_migration_seed.counts.source_slices.canonical_base,
    },
    'BASELINE_TESTER_SLICE_RECONCILIATION_MISMATCH',
    'tester_slice_reconciliation',
  );
}

function validateEvaluationShape(evaluation) {
  assertExactKeys(
    evaluation,
    ['harness_version', 'benchmark_version', 'question_count', 'report', 'validation', 'macro_top_k', 'execution_boundary'],
    'historical_evaluation_baseline.evaluation',
  );
  assertExactKeys(
    evaluation.execution_boundary,
    ['external_requests', 'ranking_optimized', 'llm_used', 'identity_work_performed', 'coverage_execution_performed', 'heavy_analysis_lock_touched'],
    'historical_evaluation_baseline.evaluation.execution_boundary',
  );
  requireCondition(evaluation.harness_version === '1.0.0', 'BASELINE_EVALUATOR_VERSION_MISMATCH');
  requireCondition(evaluation.benchmark_version === '0.1.0', 'BASELINE_BENCHMARK_VERSION_MISMATCH');
  requireCondition(evaluation.question_count === 60, 'BASELINE_QUESTION_COUNT_MISMATCH');
  requireCondition(Array.isArray(evaluation.macro_top_k) && evaluation.macro_top_k.length === 5, 'BASELINE_METRIC_VECTOR_INVALID');
  for (const [index, metric] of evaluation.macro_top_k.entries()) {
    assertExactKeys(metric, ['k', 'must_not_miss_recall', 'acceptable_source_coverage'], `historical_evaluation_baseline.evaluation.macro_top_k[${index}]`);
  }
}

export async function validateProductionBaseline(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? REPOSITORY_ROOT);
  const receiptPath = path.resolve(options.receiptPath ?? DEFAULT_RECEIPT_PATH);
  const receipt = options.receipt ?? parseJson(await fs.readFile(receiptPath), 'production-baseline receipt');

  assertExactKeys(
    receipt,
    ['receipt_version', 'status', 'recorded_at', 'naming_invariant', 'production_migration_seed', 'historical_evaluation_baseline', 'tester_slice_reconciliation', 'comparison_policy'],
    'receipt',
  );
  requireCondition(receipt.receipt_version === RECEIPT_VERSION, 'BASELINE_RECEIPT_VERSION_MISMATCH');
  requireCondition(receipt.status === 'PASS', 'BASELINE_RECEIPT_NOT_PASS');
  requireCondition(typeof receipt.recorded_at === 'string' && !Number.isNaN(Date.parse(receipt.recorded_at)), 'BASELINE_RECORDED_AT_INVALID');
  requireCondition(typeof receipt.naming_invariant === 'string' && receipt.naming_invariant.includes('v1.1.0') && receipt.naming_invariant.includes('v1.0.1'), 'BASELINE_NAMING_INVARIANT_INVALID');
  assertExactKeys(receipt.comparison_policy, ['direct_comparison_requires', 'note'], 'comparison_policy');
  assertDeepEqual(
    receipt.comparison_policy.direct_comparison_requires,
    ['corpus_manifest_file_sha256', 'content_fingerprint_sha256', 'algorithm_fingerprint_sha256', 'evaluator_version', 'cohort_manifest'],
    'BASELINE_COMPARISON_PINS_MISMATCH',
    'comparison_policy.direct_comparison_requires',
  );

  const production = await validateCorpusLane(repositoryRoot, receipt.production_migration_seed, {
    label: 'production_migration_seed',
    role: 'production_migration_seed',
    version: '1.1.0',
    packageRoot: 'packages/retrieval/versions/v1.1.0',
    sliceNames: ['canonical_base', 'pennsylvania_catalog', 'lane_c_harvard_dataverse', 'lane_c_datacite', 'curated_authoritative_registry', 'national_federal_backbone_live_validated'],
    artifactNames: ['corpus_metadata', 'records', 'search_documents', 'join_routes'],
    includeEvaluation: false,
  });
  requireCondition(production.records.length === 157 && production.joinRoutes.length === 14, 'BASELINE_PRODUCTION_IDENTITY_MISMATCH');

  validateEvaluationShape(receipt.historical_evaluation_baseline.evaluation);
  const historical = await validateCorpusLane(repositoryRoot, receipt.historical_evaluation_baseline, {
    label: 'historical_evaluation_baseline',
    role: 'historical_evaluator_corpus',
    version: '1.0.1',
    packageRoot: 'packages/retrieval',
    sliceNames: ['canonical_base', 'pennsylvania_catalog', 'lane_c_harvard_dataverse', 'lane_c_datacite', 'curated_authoritative_registry'],
    artifactNames: ['corpus_metadata', 'records', 'search_documents', 'join_routes', 'build_receipt'],
    includeEvaluation: true,
  });
  requireCondition(historical.records.length === 143 && historical.joinRoutes.length === 14, 'BASELINE_HISTORICAL_IDENTITY_MISMATCH');

  const buildReceipt = parseJson(historical.artifactBytes.build_receipt, 'historical_evaluation_baseline.build_receipt');
  requireCondition(buildReceipt.status === 'PASS', 'BASELINE_HISTORICAL_BUILD_NOT_PASS');
  requireCondition(buildReceipt.corpus_manifest_sha256 === receipt.historical_evaluation_baseline.manifest.file_sha256, 'BASELINE_BUILD_MANIFEST_HASH_MISMATCH');
  requireCondition(buildReceipt.content_fingerprint_sha256 === receipt.historical_evaluation_baseline.content_fingerprint_sha256, 'BASELINE_BUILD_CONTENT_FINGERPRINT_MISMATCH');
  requireCondition(buildReceipt.algorithm_fingerprint_sha256 === receipt.historical_evaluation_baseline.algorithm_fingerprint_sha256, 'BASELINE_BUILD_ALGORITHM_FINGERPRINT_MISMATCH');
  requireCondition(buildReceipt.record_count === 143 && buildReceipt.join_route_count === 14, 'BASELINE_BUILD_COUNT_MISMATCH');

  const evaluation = receipt.historical_evaluation_baseline.evaluation;
  const reportBytes = await readPinnedArtifact(repositoryRoot, evaluation.report, 'historical_evaluation_baseline.evaluation.report');
  const validationBytes = await readPinnedArtifact(repositoryRoot, evaluation.validation, 'historical_evaluation_baseline.evaluation.validation');
  const report = parseJson(reportBytes, 'historical evaluation report');
  const validation = parseJson(validationBytes, 'historical evaluation validation');
  requireCondition(report.question_count === evaluation.question_count, 'BASELINE_REPORT_QUESTION_COUNT_MISMATCH');
  requireCondition(Array.isArray(report.question_evaluations) && report.question_evaluations.length === evaluation.question_count, 'BASELINE_REPORT_EVALUATION_COUNT_MISMATCH');
  assertDeepEqual(report.macro_metrics.top_k, evaluation.macro_top_k, 'BASELINE_REPORT_METRICS_MISMATCH', 'historical evaluation report');
  requireCondition(validation.status === 'PASS', 'BASELINE_EVALUATION_VALIDATION_NOT_PASS');
  requireCondition(Object.values(validation.checks).every(value => value === true), 'BASELINE_EVALUATION_CHECK_FAILED');
  assertDeepEqual(report.macro_metrics.top_k, validation.evaluation_macro_metrics.top_k, 'BASELINE_VALIDATION_METRICS_MISMATCH', 'historical evaluation validation');
  for (const [key, expected] of Object.entries(evaluation.execution_boundary)) {
    requireCondition(report[key] === expected, 'BASELINE_EXECUTION_BOUNDARY_MISMATCH', key);
  }

  validateTesterReconciliation(receipt);
  requireCondition(
    receipt.production_migration_seed.counts.records - receipt.historical_evaluation_baseline.counts.records === 14,
    'BASELINE_LANE_RECORD_DELTA_MISMATCH',
  );
  requireCondition(
    receipt.production_migration_seed.counts.source_slices.national_federal_backbone_live_validated === 14,
    'BASELINE_FEDERAL_SUCCESSOR_SLICE_MISMATCH',
  );

  return {
    status: 'PASS',
    receipt_version: receipt.receipt_version,
    production: {
      corpus_version: '1.1.0',
      records: production.records.length,
      search_documents: production.searchDocuments.length,
      join_routes: production.joinRoutes.length,
      manifest_file_sha256: receipt.production_migration_seed.manifest.file_sha256,
    },
    historical_evaluation: {
      corpus_version: '1.0.1',
      records: historical.records.length,
      search_documents: historical.searchDocuments.length,
      join_routes: historical.joinRoutes.length,
      questions: report.question_count,
      manifest_file_sha256: receipt.historical_evaluation_baseline.manifest.file_sha256,
    },
  };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const result = await validateProductionBaseline();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
