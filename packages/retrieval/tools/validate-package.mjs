import fs from 'node:fs/promises';
import path from 'node:path';
import { semanticErrors } from '../../../index/v1.0.0/tools/semantics.mjs';
import { createRetrievalEngine } from './retrieval-core.mjs';
import {
  PACKAGE_ROOT,
  jsonl,
  prettyJson,
  publishImmutable,
  readJson,
  readJsonl,
  sha256Bytes,
  sha256File,
  stableJson
} from './package-common.mjs';
import { loadRetrievalValidators, validationErrors } from './schema-validation.mjs';

const checks = [];
function check(id, passed, detail = '') {
  checks.push({ id, passed: Boolean(passed), detail: String(detail) });
}

const manifest = await readJson(path.join(PACKAGE_ROOT, 'manifests/corpus-manifest.json'));
const corpus = await readJson(path.join(PACKAGE_ROOT, 'corpus/corpus.json'));
const records = await readJsonl(path.join(PACKAGE_ROOT, 'corpus/records.jsonl'));
const searchDocuments = await readJsonl(path.join(PACKAGE_ROOT, 'corpus/search-documents.jsonl'));
const routes = await readJsonl(path.join(PACKAGE_ROOT, 'corpus/join-routes.jsonl'));
const vocabulary = await readJson(path.join(PACKAGE_ROOT, 'fixtures/controlled-vocabulary.json'));
const queries = await readJsonl(path.join(PACKAGE_ROOT, 'fixtures/published-queries.jsonl'));
const { validators } = await loadRetrievalValidators();

const algorithmPaths = [
  'tools/question-parser.mjs',
  'tools/intent-compiler.mjs',
  'tools/search-document.mjs',
  'tools/join-routes.mjs',
  'tools/retrieval-core.mjs',
  'tools/query-schema.mjs',
  'tools/webmcp.mjs'
].map(relativePath => path.join(PACKAGE_ROOT, relativePath));
const algorithmFiles = [];
for (const filePath of algorithmPaths) {
  const stats = await fs.stat(filePath);
  algorithmFiles.push({ path: path.relative(PACKAGE_ROOT, filePath).replaceAll('\\', '/'), bytes: stats.size, sha256: await sha256File(filePath) });
}
const algorithmFingerprintSha256 = sha256Bytes(stableJson(algorithmFiles));

check('manifest_version', manifest.manifest_version === 'observatory-retrieval-corpus-manifest.v1.0.1', manifest.manifest_version);
check('corpus_identity', manifest.corpus_id === corpus.corpus_id && manifest.corpus_version === corpus.corpus_version, corpus.corpus_id);
check('fixture_only_boundary', corpus.build_boundary?.fixture_only === true && corpus.build_boundary?.external_requests === 0, stableJson(corpus.build_boundary));
check('no_heavy_lock_or_coverage', corpus.build_boundary?.heavy_analysis_lock_touched === false && corpus.build_boundary?.coverage_cells_executed === 0, stableJson(corpus.build_boundary));
check('record_count', records.length === manifest.counts.records && records.length === corpus.record_count, records.length);
check('search_document_count', searchDocuments.length === records.length && searchDocuments.length === manifest.counts.search_documents && searchDocuments.length === corpus.search_document_count, searchDocuments.length);
check('join_route_count', routes.length === manifest.counts.join_routes && routes.length === corpus.join_route_count, routes.length);
check('published_query_count', queries.length === manifest.counts.published_queries, queries.length);
check('algorithm_files', stableJson(algorithmFiles) === stableJson(manifest.algorithm_files), algorithmFingerprintSha256);
check('algorithm_fingerprint', algorithmFingerprintSha256 === manifest.algorithm_fingerprint_sha256 && algorithmFingerprintSha256 === corpus.algorithm_fingerprint_sha256, algorithmFingerprintSha256);

for (const file of manifest.files) {
  const filePath = path.join(PACKAGE_ROOT, file.path);
  try {
    const stats = await fs.stat(filePath);
    const digest = await sha256File(filePath);
    check(`manifest_file:${file.path}`, stats.size === file.bytes && digest === file.sha256, `bytes=${stats.size};sha256=${digest}`);
  } catch (error) {
    check(`manifest_file:${file.path}`, false, error.message);
  }
}

const expectedFingerprint = sha256Bytes(Buffer.concat([
  Buffer.from(jsonl(records)),
  Buffer.from(jsonl(routes)),
  Buffer.from(jsonl(searchDocuments)),
  Buffer.from(stableJson(vocabulary)),
  Buffer.from(algorithmFingerprintSha256)
]));
check('content_fingerprint', expectedFingerprint === corpus.manifest_sha256 && expectedFingerprint === manifest.content_fingerprint_sha256, expectedFingerprint);

const recordIds = new Set();
for (const record of records) {
  const schemaPassed = validators.record(record);
  check(`record_schema:${record.record_id}`, schemaPassed, schemaPassed ? '' : validationErrors(validators.record));
  const semantics = semanticErrors(record);
  check(`record_semantics:${record.record_id}`, semantics.length === 0, semantics.join('; '));
  check(`record_unique:${record.record_id}`, !recordIds.has(record.record_id), '');
  recordIds.add(record.record_id);
}

const searchRecordIds = new Set();
for (const document of searchDocuments) {
  const schemaPassed = validators.searchDocument(document);
  check(`search_document_schema:${document.resource_record_id}`, schemaPassed, schemaPassed ? '' : validationErrors(validators.searchDocument));
  check(`search_document_record:${document.resource_record_id}`, recordIds.has(document.resource_record_id), document.resource_record_id);
  check(`search_document_unique:${document.resource_record_id}`, !searchRecordIds.has(document.resource_record_id), '');
  check(`search_document_non_authoritative:${document.resource_record_id}`, document.authoritative_record === false && document.projection_role === 'discovery_view', document.projection_warning);
  searchRecordIds.add(document.resource_record_id);
}

const routeIds = new Set();
for (const route of routes) {
  const schemaPassed = validators.route(route);
  check(`route_schema:${route.route_id}`, schemaPassed, schemaPassed ? '' : validationErrors(validators.route));
  check(`route_unique:${route.route_id}`, !routeIds.has(route.route_id), '');
  routeIds.add(route.route_id);
  check(`route_records:${route.route_id}`, recordIds.has(route.from_record_id) && recordIds.has(route.to_record_id), `${route.from_record_id}|${route.to_record_id}`);
}

const engine = createRetrievalEngine({ records, searchDocuments, joinRoutes: routes, vocabulary, corpus });
for (const item of queries) {
  const responsePath = path.join(PACKAGE_ROOT, `fixtures/responses/${item.query_id}.json`);
  const stored = await readJson(responsePath);
  const current = engine.retrieve(item.query);
  const intent = engine.interpret(item.query);
  const intentPassed = validators.intent(intent);
  check(`intent_schema:${item.query_id}`, intentPassed, intentPassed ? '' : validationErrors(validators.intent));
  check(`intent_offline:${item.query_id}`, intent.compiler.llm_used === false && intent.compiler.external_requests === 0, stableJson(intent.compiler));
  const schemaPassed = validators.result(current);
  check(`result_schema:${item.query_id}`, schemaPassed, schemaPassed ? '' : validationErrors(validators.result));
  check(`result_determinism:${item.query_id}`, stableJson(current) === stableJson(stored), current.retrieval_id);
  check(`result_corpus:${item.query_id}`, current.corpus.record_count === records.length && current.corpus.join_route_count === routes.length, stableJson(current.corpus));
}

const flagship = engine.retrieve({ question: 'I need hospital financial and utilization data for Pennsylvania', limit: 15 });
const flagshipIds = new Set(flagship.results.map(item => item.record_id));
check('flagship_hcris', flagshipIds.has('obs:asset:cms-hcris-hospital-cost-reports'), [...flagshipIds].join(','));
check('flagship_phc4_public', flagshipIds.has('obs:asset:pa-phc4-public-financial-reports'), [...flagshipIds].join(','));
check('phc4_access_split',
  records.find(record => record.record_id === 'obs:asset:pa-phc4-public-financial-reports')?.access.status === 'public_direct'
  && records.find(record => record.record_id === 'obs:asset:pa-phc4-custom-data')?.access.status === 'application_required',
  'public_direct|application_required');

const publicRural = engine.retrieve({ question: 'What public sources can I use to study rural hospital closures in Pennsylvania?', limit: 15 });
check('public_filter_excludes_restricted', !publicRural.results.some(item => ['registration_required','application_required','dua_required','licensed_paid','controlled'].includes(item.record.access.status)), publicRural.results.map(item => item.record.access.status).join(','));
const unknown = engine.retrieve({ question: 'Dental asteroid telemetry for Pennsylvania', limit: 10 });
check('zero_result_not_absence', unknown.result_count === 0 && unknown.warnings.some(value => value.includes('not evidence that no source exists')), stableJson(unknown.warnings));

const failures = checks.filter(item => !item.passed);
if (failures.length) {
  process.stderr.write(prettyJson({ status: 'FAIL', check_count: checks.length, failure_count: failures.length, failures }));
  process.exitCode = 1;
} else {
  const manifestSha256 = await sha256File(path.join(PACKAGE_ROOT, 'manifests/corpus-manifest.json'));
  const receipt = {
    validation_version: 'observatory-retrieval-validation.v1.0.1',
    validated_at: '2026-08-30T00:00:00Z',
    status: 'PASS',
    valid: true,
    fixture_only: true,
    offline: true,
    check_count: checks.length,
    failure_count: 0,
    record_count: records.length,
    search_document_count: searchDocuments.length,
    join_route_count: routes.length,
    query_count: queries.length,
    corpus_manifest_sha256: manifestSha256,
    content_fingerprint_sha256: expectedFingerprint,
    algorithm_fingerprint_sha256: algorithmFingerprintSha256,
    external_requests: 0,
    payload_downloads: 0,
    identity_index_queries: 0,
    heavy_analysis_lock_touched: false,
    coverage_cells_executed: 0,
    checks
  };
  await publishImmutable('validation/validation-receipt.json', prettyJson(receipt));
  process.stdout.write(prettyJson({ status: 'PASS', check_count: checks.length, record_count: records.length, join_route_count: routes.length, corpus_manifest_sha256: manifestSha256 }));
}
