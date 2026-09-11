import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { semanticErrors } from './record-semantics.mjs';
import { adaptNationalBackbone } from './national-backbone-adapter.mjs';
import {
  PACKAGE_ROOT,
  assertFixtureOnly,
  assertUnique,
  jsonl,
  prettyJson,
  readJson,
  readJsonl,
  sha256Bytes,
  sha256File,
  stableJson
} from './package-common.mjs';
import { projectSearchDocuments } from './search-document.mjs';

assertFixtureOnly(process.argv.slice(2));

const VERSION = '1.1.0';
const outputRoot = path.join(PACKAGE_ROOT, 'versions', `v${VERSION}`);
const fixtureRoot = path.join(PACKAGE_ROOT, 'fixtures/national-federal-v0.1.0');
const paths = {
  currentRecords: path.join(PACKAGE_ROOT, 'corpus/records.jsonl'),
  currentRoutes: path.join(PACKAGE_ROOT, 'corpus/join-routes.jsonl'),
  currentCorpus: path.join(PACKAGE_ROOT, 'corpus/corpus.json'),
  vocabulary: path.join(PACKAGE_ROOT, 'fixtures/controlled-vocabulary.json'),
  nationalRecords: path.join(fixtureRoot, 'records.jsonl'),
  observations: path.join(fixtureRoot, 'access-observations.jsonl'),
  backboneManifest: path.join(fixtureRoot, 'backbone-manifest.json'),
  validationReport: path.join(fixtureRoot, 'validation-report.json'),
  validationManifest: path.join(fixtureRoot, 'validation-manifest.json'),
  importReceipt: path.join(fixtureRoot, 'import-receipt.json')
};

async function publishImmutable(relativePath, content) {
  const target = path.join(outputRoot, relativePath);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  try {
    const existing = await fs.readFile(target);
    if (existing.equals(bytes)) return { path: relativePath.replaceAll('\\', '/'), bytes: bytes.length, sha256: sha256Bytes(bytes), reused: true };
    throw new Error(`IMMUTABLE_OUTPUT_CONFLICT:${relativePath}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.partial-${process.pid}`;
  await fs.writeFile(temporary, bytes, { flag: 'wx' });
  await fs.rename(temporary, target);
  return { path: relativePath.replaceAll('\\', '/'), bytes: bytes.length, sha256: sha256Bytes(bytes), reused: false };
}

const [currentRecords, currentRoutes, currentCorpus, baseVocabulary, nationalRecords, observations, backboneManifest, validationReport, validationManifest] = await Promise.all([
  readJsonl(paths.currentRecords),
  readJsonl(paths.currentRoutes),
  readJson(paths.currentCorpus),
  readJson(paths.vocabulary),
  readJsonl(paths.nationalRecords),
  readJsonl(paths.observations),
  readJson(paths.backboneManifest),
  readJson(paths.validationReport),
  readJson(paths.validationManifest)
]);

if (currentCorpus.corpus_version !== '1.0.1' || currentRecords.length !== 143) throw new Error('CURRENT_CORPUS_PIN_MISMATCH');
if (validationReport.status !== 'pass_with_scoped_unknowns' || validationReport.counts.promotion_eligible < 1) throw new Error('NATIONAL_VALIDATION_NOT_ACCEPTED');
if (validationManifest.safety?.underlying_datasets_downloaded !== 0 || validationManifest.safety?.heavy_analysis_lock_touched !== false) throw new Error('NATIONAL_VALIDATION_SAFETY_FAILURE');
if (backboneManifest.package_content_sha256 !== validationReport.source_package_content_sha256) throw new Error('NATIONAL_BACKBONE_FINGERPRINT_MISMATCH');

const vocabulary = structuredClone(baseVocabulary);
if (!vocabulary.subjects.some((subject) => subject.id === 'geography_access')) {
  vocabulary.subjects.push({
    id: 'geography_access',
    label: 'Geography, rurality, and access context',
    aliases: ['geography', 'geographic access', 'access to care', 'rurality', 'service area'],
    phrases: ['geographic access', 'access to care', 'rural classification', 'rurality classification'],
    implied_units: ['state', 'county', 'facility'],
    record_terms: ['geography', 'rurality', 'fips', 'boundary', 'shortage area', 'service delivery site', 'access context']
  });
}
vocabulary.subjects.sort((a, b) => a.id.localeCompare(b.id));

const importReceiptSha256 = await sha256File(paths.importReceipt);
const federalRecords = adaptNationalBackbone({ records: nationalRecords, observations, vocabulary, importReceiptSha256 });
const records = [...currentRecords, ...federalRecords].sort((a, b) => a.record_id.localeCompare(b.record_id));
assertUnique(records.map((record) => record.record_id), 'record id');
for (const record of records) {
  const errors = semanticErrors(record);
  if (errors.length) throw new Error(`RECORD_SEMANTIC_FAILURE:${record.record_id}:${errors.join('; ')}`);
  if (record.record_id !== record.identity.asset.asset_id) throw new Error(`ASSET_ID_DRIFT:${record.record_id}`);
}

const routes = [...currentRoutes].sort((a, b) => a.route_id.localeCompare(b.route_id));
const searchDocuments = projectSearchDocuments(records, routes);
const recordsText = jsonl(records);
const routesText = jsonl(routes);
const searchDocumentsText = jsonl(searchDocuments);
const vocabularyText = prettyJson(vocabulary);
const algorithmFiles = ['tools/question-parser.mjs', 'tools/intent-compiler.mjs', 'tools/search-document.mjs', 'tools/join-routes.mjs', 'tools/retrieval-core.mjs', 'tools/national-backbone-adapter.mjs'];
const algorithmPins = [];
for (const relativePath of algorithmFiles) {
  const filePath = path.join(PACKAGE_ROOT, relativePath);
  const stats = await fs.stat(filePath);
  algorithmPins.push({ path: relativePath, bytes: stats.size, sha256: await sha256File(filePath) });
}
const algorithmFingerprintSha256 = sha256Bytes(stableJson(algorithmPins));
const contentFingerprintSha256 = sha256Bytes(Buffer.concat([
  Buffer.from(recordsText),
  Buffer.from(routesText),
  Buffer.from(searchDocumentsText),
  Buffer.from(stableJson(vocabulary)),
  Buffer.from(algorithmFingerprintSha256)
]));
const corpus = {
  corpus_id: 'ushso-observatory-national-federal',
  corpus_version: VERSION,
  evidence_mode: 'published_offline_evidence',
  manifest_sha256: contentFingerprintSha256,
  algorithm_fingerprint_sha256: algorithmFingerprintSha256,
  record_count: records.length,
  search_document_count: searchDocuments.length,
  join_route_count: routes.length,
  source_slices: {
    ...currentCorpus.source_slices,
    national_federal_backbone_live_validated: federalRecords.length
  },
  build_boundary: {
    fixture_only: true,
    external_requests: 0,
    payload_downloads: 0,
    identity_index_queries: 0,
    heavy_analysis_lock_touched: false,
    coverage_cells_executed: 0,
    accepted_upstream_metadata_requests: observations.length
  }
};

const inputPins = [];
for (const [inputId, filePath] of Object.entries(paths)) {
  const stats = await fs.stat(filePath);
  inputPins.push({ input_id: inputId, path: path.relative(PACKAGE_ROOT, filePath).replaceAll('\\', '/'), bytes: stats.size, sha256: await sha256File(filePath) });
}
const inputManifest = {
  manifest_version: 'observatory-retrieval-input-manifest.v1.1.0',
  corpus_id: corpus.corpus_id,
  offline_build: true,
  inputs: inputPins.sort((a, b) => a.path.localeCompare(b.path)),
  accepted_upstream_receipts: {
    national_backbone_package_content_sha256: backboneManifest.package_content_sha256,
    national_validation_manifest_sha256: await sha256File(paths.validationManifest),
    national_import_receipt_sha256: importReceiptSha256
  }
};
const validation = {
  schema_version: 'observatory-retrieval-validation.v1.1.0',
  status: 'PASS',
  counts: { prior_records: currentRecords.length, promoted_federal_records: federalRecords.length, records: records.length, search_documents: searchDocuments.length, join_routes: routes.length },
  checks: {
    record_semantics: true,
    unique_record_ids: true,
    all_promoted_records_have_live_metadata_observation: federalRecords.length === observations.filter((row) => row.promotion_eligibility === 'eligible').length,
    underlying_datasets_downloaded: 0,
    identity_merge_performed: false,
    full_data_jobs_run: 0,
    heavy_analysis_lock_touched: false
  },
  explicit_unknowns: validationReport.explicit_unknowns
};

const payloads = new Map([
  ['corpus/records.jsonl', recordsText],
  ['corpus/search-documents.jsonl', searchDocumentsText],
  ['corpus/join-routes.jsonl', routesText],
  ['corpus/corpus.json', prettyJson(corpus)],
  ['fixtures/controlled-vocabulary.json', vocabularyText],
  ['manifests/input-manifest.json', prettyJson(inputManifest)],
  ['validation/validation-report.json', prettyJson(validation)]
]);
const published = [];
for (const [relativePath, content] of payloads) published.push(await publishImmutable(relativePath, content));
const manifest = {
  manifest_version: 'observatory-retrieval-corpus-manifest.v1.1.0',
  corpus_id: corpus.corpus_id,
  corpus_version: VERSION,
  content_fingerprint_sha256: contentFingerprintSha256,
  algorithm_fingerprint_sha256: algorithmFingerprintSha256,
  files: published.map(({ reused, ...file }) => file).sort((a, b) => a.path.localeCompare(b.path)),
  safety: validation.checks
};
await publishImmutable('manifests/corpus-manifest.json', prettyJson(manifest));
process.stdout.write(`${prettyJson({ status: 'PASS', corpus_version: VERSION, records: records.length, promoted_federal_records: federalRecords.length, package_content_sha256: contentFingerprintSha256 })}`);
