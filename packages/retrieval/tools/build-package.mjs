import fs from 'node:fs/promises';
import path from 'node:path';
import { semanticErrors } from './record-semantics.mjs';
import { adaptCuratedAssets } from './curated-adapter.mjs';
import { validateJoinRoute } from './join-routes.mjs';
import {
  PACKAGE_ROOT,
  PROJECT_ROOT,
  assertFixtureOnly,
  assertUnique,
  jsonl,
  prettyJson,
  projectRelative,
  publishImmutable,
  readJson,
  readJsonl,
  sha256Bytes,
  sha256File,
  stableJson
} from './package-common.mjs';
import { createRetrievalEngine } from './retrieval-core.mjs';
import { projectSearchDocuments } from './search-document.mjs';

assertFixtureOnly(process.argv.slice(2));

const paths = {
  baseRecords: path.join(PROJECT_ROOT, 'observatory/index/v1.0.0/index/records.jsonl'),
  paRecords: path.join(PROJECT_ROOT, 'observatory/canaries/pennsylvania.v1/fixture.v1.3/index/observatory-records.jsonl'),
  paValidation: path.join(PROJECT_ROOT, 'observatory/canaries/pennsylvania.v1/fixture.v1.3/validation/validation-receipt.json'),
  harvardRecords: path.join(PROJECT_ROOT, 'observatory/index-population/v1.0.1/records/harvard_dataverse.jsonl'),
  dataciteRecords: path.join(PROJECT_ROOT, 'observatory/index-population/v1.0.1/records/datacite.jsonl'),
  populationValidation: path.join(PROJECT_ROOT, 'observatory/index-population/v1.0.1/reports/validation_receipt.json'),
  sourceRegistry: path.join(PROJECT_ROOT, 'discovery_financial_org/source_registry.json'),
  curatedAssets: path.join(PACKAGE_ROOT, 'fixtures/curated-assets.json'),
  vocabulary: path.join(PACKAGE_ROOT, 'fixtures/controlled-vocabulary.json'),
  baseRoutes: path.join(PACKAGE_ROOT, 'fixtures/base-join-routes.jsonl'),
  extendedRoutes: path.join(PACKAGE_ROOT, 'fixtures/extended-join-routes.jsonl'),
  recordSchema: path.join(PROJECT_ROOT, 'observatory/index/v1.0.0/schemas/observatory-record.schema.json'),
  joinSchema: path.join(PACKAGE_ROOT, 'schemas/join-route.schema.json'),
  querySchema: path.join(PACKAGE_ROOT, 'schemas/discovery-query.schema.json'),
  intentSchema: path.join(PACKAGE_ROOT, 'schemas/discovery-intent.schema.json'),
  resultSchema: path.join(PACKAGE_ROOT, 'schemas/discovery-result.schema.json')
  ,searchDocumentSchema: path.join(PACKAGE_ROOT, 'schemas/search-document.schema.json')
};

const algorithmPaths = [
  'tools/question-parser.mjs',
  'tools/intent-compiler.mjs',
  'tools/search-document.mjs',
  'tools/join-routes.mjs',
  'tools/retrieval-core.mjs',
  'tools/query-schema.mjs',
  'tools/webmcp.mjs'
].map(relativePath => path.join(PACKAGE_ROOT, relativePath));

const [
  baseRecords,
  paRecords,
  paValidation,
  harvardRecords,
  dataciteRecords,
  populationValidation,
  sourceRegistry,
  curatedFixture,
  vocabulary,
  baseRoutes,
  extendedRoutes
] = await Promise.all([
  readJsonl(paths.baseRecords),
  readJsonl(paths.paRecords),
  readJson(paths.paValidation),
  readJsonl(paths.harvardRecords),
  readJsonl(paths.dataciteRecords),
  readJson(paths.populationValidation),
  readJson(paths.sourceRegistry),
  readJson(paths.curatedAssets),
  readJson(paths.vocabulary),
  readJsonl(paths.baseRoutes),
  readJsonl(paths.extendedRoutes)
]);

const sourceRegistrySha256 = await sha256File(paths.sourceRegistry);
if (sourceRegistrySha256 !== curatedFixture.source_registry.sha256) {
  throw new Error(`SOURCE_REGISTRY_PIN_MISMATCH: expected ${curatedFixture.source_registry.sha256}, got ${sourceRegistrySha256}`);
}
if (sourceRegistry.schema_version !== curatedFixture.source_registry.schema_version || sourceRegistry.as_of !== curatedFixture.source_registry.as_of) {
  throw new Error('SOURCE_REGISTRY_METADATA_PIN_MISMATCH');
}
if (!paValidation.ok || paValidation.issue_count !== 0 || paValidation.checks?.external_requests !== 0) {
  throw new Error('PA_FIXTURE_NOT_ACCEPTED');
}
if (!populationValidation.valid || populationValidation.failure_count !== 0 || populationValidation.external_requests !== 0 || populationValidation.identity_index_queries !== 0) {
  throw new Error('INDEX_POPULATION_NOT_ACCEPTED');
}
if (paRecords.length !== 22) throw new Error(`PA_RECORD_COUNT_MISMATCH: ${paRecords.length}`);
if (harvardRecords.length !== 52 || dataciteRecords.length !== 50) {
  throw new Error(`INDEX_POPULATION_RECORD_COUNT_MISMATCH: harvard=${harvardRecords.length}, datacite=${dataciteRecords.length}`);
}

const curatedRecords = adaptCuratedAssets({ fixture: curatedFixture, sourceRegistry, vocabulary });
const slices = {
  canonical_base: baseRecords.length,
  pennsylvania_catalog: paRecords.length,
  lane_c_harvard_dataverse: harvardRecords.length,
  lane_c_datacite: dataciteRecords.length,
  curated_authoritative_registry: curatedRecords.length
};
const records = [...baseRecords, ...paRecords, ...harvardRecords, ...dataciteRecords, ...curatedRecords]
  .sort((a, b) => a.record_id.localeCompare(b.record_id));
assertUnique(records.map(record => record.record_id), 'record id');

for (const record of records) {
  const errors = semanticErrors(record);
  if (errors.length) throw new Error(`RECORD_SEMANTIC_FAILURE: ${record.record_id}: ${errors.join('; ')}`);
  if (record.record_id !== record.identity.asset.asset_id) throw new Error(`ASSET_ID_DRIFT: ${record.record_id}`);
}

const routes = [...baseRoutes, ...extendedRoutes].sort((a, b) => a.route_id.localeCompare(b.route_id));
assertUnique(routes.map(route => route.route_id), 'route id');
const byRecordId = new Map(records.map(record => [record.record_id, record]));
for (const route of routes) {
  validateJoinRoute(route);
  for (const recordId of [route.from_record_id, route.to_record_id]) {
    if (!byRecordId.has(recordId)) throw new Error(`JOIN_ROUTE_RECORD_MISSING: ${route.route_id}: ${recordId}`);
  }
  for (const reference of route.evidence_refs) {
    const record = byRecordId.get(reference.record_id);
    if (!record) throw new Error(`JOIN_EVIDENCE_RECORD_MISSING: ${route.route_id}: ${reference.record_id}`);
    const evidenceIds = new Set(record.evidence.map(item => item.evidence_id));
    const provenanceIds = new Set(record.provenance.map(item => item.provenance_id));
    for (const id of reference.evidence_ids) if (!evidenceIds.has(id)) throw new Error(`JOIN_EVIDENCE_ID_MISSING: ${route.route_id}: ${id}`);
    for (const id of reference.provenance_ids) if (!provenanceIds.has(id)) throw new Error(`JOIN_PROVENANCE_ID_MISSING: ${route.route_id}: ${id}`);
  }
}

const recordsText = jsonl(records);
const routesText = jsonl(routes);
const searchDocuments = projectSearchDocuments(records, routes);
const searchDocumentsText = jsonl(searchDocuments);
const vocabularyText = await fs.readFile(paths.vocabulary, 'utf8');
const algorithmFiles = [];
for (const filePath of algorithmPaths) {
  const stats = await fs.stat(filePath);
  algorithmFiles.push({ path: path.relative(PACKAGE_ROOT, filePath).replaceAll('\\', '/'), bytes: stats.size, sha256: await sha256File(filePath) });
}
const algorithmFingerprintSha256 = sha256Bytes(stableJson(algorithmFiles));
const contentFingerprintSha256 = sha256Bytes(Buffer.concat([
  Buffer.from(recordsText),
  Buffer.from(routesText),
  Buffer.from(searchDocumentsText),
  Buffer.from(stableJson(JSON.parse(vocabularyText))),
  Buffer.from(algorithmFingerprintSha256)
]));
const corpus = {
  corpus_id: 'ushso-observatory-offline-mvp',
  corpus_version: '1.0.1',
  evidence_mode: 'published_offline_evidence',
  manifest_sha256: contentFingerprintSha256,
  algorithm_fingerprint_sha256: algorithmFingerprintSha256,
  record_count: records.length,
  search_document_count: searchDocuments.length,
  join_route_count: routes.length,
  source_slices: slices,
  build_boundary: {
    fixture_only: true,
    external_requests: 0,
    payload_downloads: 0,
    identity_index_queries: 0,
    heavy_analysis_lock_touched: false,
    coverage_cells_executed: 0
  }
};

const engine = createRetrievalEngine({ records, searchDocuments, joinRoutes: routes, vocabulary, corpus });
const publishedQueries = [
  { query_id: 'q-pa-hospital-finance-utilization', query: { question: 'I need hospital financial and utilization data for Pennsylvania', limit: 15 } },
  { query_id: 'q-public-rural-closures-pa', query: { question: 'What public sources can I use to study rural hospital closures in Pennsylvania?', limit: 15 } },
  { query_id: 'q-hospital-ownership', query: { question: 'What sources describe hospital ownership and change of ownership in Pennsylvania?', limit: 15 } },
  { query_id: 'q-healthcare-workforce', query: { question: 'What public data can I use to study healthcare workforce and staffing?', limit: 15 } },
  { query_id: 'q-medicaid-payer', query: { question: 'What public sources describe Medicaid enrollment, managed care, and payer data?', limit: 15 } },
  { query_id: 'q-pa-public-health', query: { question: 'What public health surveillance sources cover Pennsylvania counties?', limit: 15 } }
];
const responses = publishedQueries.map(item => ({ ...item, result: engine.retrieve(item.query) }));

const inputPaths = Object.entries(paths)
  .filter(([key]) => !['recordSchema', 'joinSchema', 'querySchema', 'intentSchema', 'resultSchema', 'searchDocumentSchema'].includes(key));
const inputFiles = [];
for (const [inputId, filePath] of inputPaths) {
  const stats = await fs.stat(filePath);
  inputFiles.push({ input_id: inputId, path: projectRelative(filePath), bytes: stats.size, sha256: await sha256File(filePath) });
}
const inputManifest = {
  manifest_version: 'observatory-retrieval-input-manifest.v1.0.0',
  corpus_id: corpus.corpus_id,
  offline: true,
  inputs: inputFiles.sort((a, b) => a.path.localeCompare(b.path)),
  accepted_upstream_receipts: {
    pennsylvania_package_manifest_sha256: paValidation.package_manifest_sha256,
    index_population_package_manifest_sha256: populationValidation.package_manifest_sha256
  }
};

const payloads = new Map([
  ['corpus/records.jsonl', recordsText],
  ['corpus/search-documents.jsonl', searchDocumentsText],
  ['corpus/join-routes.jsonl', routesText],
  ['corpus/corpus.json', prettyJson(corpus)],
  ['fixtures/published-queries.jsonl', jsonl(publishedQueries)],
  ['manifests/input-manifest.json', prettyJson(inputManifest)],
  ...responses.map(item => [`fixtures/responses/${item.query_id}.json`, prettyJson(item.result)])
]);
const payloadFiles = [...payloads].map(([relativePath, content]) => ({
  path: relativePath,
  bytes: Buffer.byteLength(content),
  sha256: sha256Bytes(content)
})).sort((a, b) => a.path.localeCompare(b.path));
const schemaPins = {};
for (const [name, filePath] of Object.entries({ observatory_record: paths.recordSchema, discovery_query: paths.querySchema, discovery_intent: paths.intentSchema, discovery_result: paths.resultSchema, search_document: paths.searchDocumentSchema, join_route: paths.joinSchema })) {
  schemaPins[name] = { path: projectRelative(filePath), sha256: await sha256File(filePath) };
}
const corpusManifest = {
  manifest_version: 'observatory-retrieval-corpus-manifest.v1.0.1',
  corpus_id: corpus.corpus_id,
  corpus_version: corpus.corpus_version,
  content_fingerprint_sha256: contentFingerprintSha256,
  algorithm_fingerprint_sha256: algorithmFingerprintSha256,
  algorithm_files: algorithmFiles,
  immutable: true,
  files: payloadFiles,
  schema_pins: schemaPins,
  counts: { records: records.length, search_documents: searchDocuments.length, join_routes: routes.length, published_queries: publishedQueries.length, source_slices: slices },
  prohibitions: {
    network_requests: 0,
    payload_downloads: 0,
    identity_index_queries: 0,
    coverage_cells_executed: 0,
    heavy_analysis_lock_touched: false
  }
};
const manifestText = prettyJson(corpusManifest);
const buildReceipt = {
  receipt_version: 'observatory-retrieval-build-receipt.v1.0.1',
  corpus_id: corpus.corpus_id,
  corpus_version: corpus.corpus_version,
  status: 'PASS',
  fixture_only: true,
  offline: true,
  content_fingerprint_sha256: contentFingerprintSha256,
  algorithm_fingerprint_sha256: algorithmFingerprintSha256,
  corpus_manifest_sha256: sha256Bytes(manifestText),
  record_count: records.length,
  search_document_count: searchDocuments.length,
  join_route_count: routes.length,
  published_query_count: publishedQueries.length,
  source_slices: slices,
  external_requests: 0,
  payload_downloads: 0,
  identity_index_queries: 0,
  heavy_analysis_lock_touched: false,
  coverage_cells_executed: 0
};

const publications = [];
for (const [relativePath, content] of payloads) publications.push(await publishImmutable(relativePath, content));
publications.push(await publishImmutable('manifests/corpus-manifest.json', manifestText));
publications.push(await publishImmutable('receipts/build-receipt.json', prettyJson(buildReceipt)));

process.stdout.write(prettyJson({
  status: 'PASS',
  corpus_id: corpus.corpus_id,
  record_count: records.length,
  search_document_count: searchDocuments.length,
  join_route_count: routes.length,
  content_fingerprint_sha256: contentFingerprintSha256,
  publications
}));
