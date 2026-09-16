// Builds the versioned Correction-3 candidate (v1.3.0-candidate) deterministically.
//
// Boundary: frozen baseline files are READ ONLY here. The script asserts the
// baseline shards and vocabulary still match the frozen v1.2.0 manifest SHAs
// and exits non-zero on any drift. Additive candidate files (records-0004,
// candidate registry patch, corpus descriptor, manifest, validation report)
// are written by this script so they stay reproducible.
//
// Usage: node packages/retrieval/versions/v1.3.0/build-candidate.mjs
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalogRecords } from '../../tools/catalog-contract.mjs';

const versionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const retrievalRoot = path.resolve(versionRoot, '../..');
const repoRoot = path.resolve(versionRoot, '../../../..');
const baselineRoot = path.join(retrievalRoot, 'versions/v1.2.0');

const CANDIDATE_VERSION = '1.3.0-candidate';
const CANDIDATE_GENERATION = 'candidate-2026-09-17-corr3-v1.3.0';
const PARENT_GENERATION = 'live-2026-09-03-85b50522b420';
const ASSEMBLED_AT = '2026-09-17T12:00:00Z';
const BASELINE_SHARDS = ['records-0001.jsonl', 'records-0002.jsonl', 'records-0003.jsonl'];
const ADDITIVE_SHARD = 'records-0004.jsonl';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const parseJsonl = (text) => text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

// 1. Frozen baseline manifest pins (never rewritten by this script).
const baselineManifest = await readJson(path.join(baselineRoot, 'manifests/corpus-manifest.json'));
const frozenSha = new Map(baselineManifest.files.map((entry) => [entry.path, entry.sha256]));
const frozenCohorts = await readJson(path.join(repoRoot, 'evaluation/research-program/cohorts.json'));
const expectedIsolated = new Set(frozenCohorts.corpus.isolated_record_ids ?? []);
if (frozenCohorts.corpus.record_count !== 3434) throw new Error(`frozen cohort baseline drift: ${frozenCohorts.corpus.record_count}`);

// 2. Candidate shard bytes must equal the frozen baseline bytes.
const shardBytes = {};
for (const shard of BASELINE_SHARDS) {
  const bytes = await fs.readFile(path.join(versionRoot, `corpus/${shard}`));
  const expected = frozenSha.get(`corpus/${shard}`);
  if (!expected || sha256(bytes) !== expected) throw new Error(`baseline shard drift: ${shard}`);
  shardBytes[shard] = bytes;
}
const baselineVocabBytes = await fs.readFile(path.join(baselineRoot, 'fixtures/controlled-vocabulary.json'));
const candidateVocabBytes = await fs.readFile(path.join(versionRoot, 'fixtures/controlled-vocabulary.json'));
if (sha256(candidateVocabBytes) !== (frozenSha.get('fixtures/controlled-vocabulary.json') ?? sha256(baselineVocabBytes))) {
  throw new Error('candidate vocabulary drift: controlled-vocabulary.json must stay byte-identical to baseline');
}
if (!candidateVocabBytes.equals(baselineVocabBytes)) throw new Error('candidate vocabulary drift: bytes differ from baseline');
const baselineJoinBytes = await fs.readFile(path.join(baselineRoot, 'corpus/join-routes.jsonl'));
const candidateJoinBytes = await fs.readFile(path.join(versionRoot, 'corpus/join-routes.jsonl'));
if (!candidateJoinBytes.equals(baselineJoinBytes)) throw new Error('candidate join-routes drift: must stay byte-identical to baseline (0 routes)');

// 3. Additive shard: exactly 2 valid documentation-first records, 0 invalid.
const additiveBytes = await fs.readFile(path.join(versionRoot, `corpus/${ADDITIVE_SHARD}`));
const additiveRecords = parseJsonl(additiveBytes.toString('utf8'));
const additiveValidation = validateCatalogRecords(additiveRecords);
if (additiveRecords.length !== 2 || additiveValidation.valid.length !== 2 || additiveValidation.invalid.length !== 0) {
  throw new Error(`additive shard must hold exactly 2 valid records: ${JSON.stringify(additiveValidation.invalid)}`);
}
for (const record of additiveValidation.valid) {
  if (!record.record_id.startsWith('obs:asset:candidate-')) throw new Error(`candidate record id must use the candidate- prefix: ${record.record_id}`);
  if (record.freshness_verification.verification_status !== 'not_live_verified') throw new Error(`candidate record must stay not_live_verified: ${record.record_id}`);
  if (record.access.status !== 'unknown') throw new Error(`candidate record must keep access unknown: ${record.record_id}`);
}

// 4. Full candidate corpus: 3436 raw rows; invalid set must equal the frozen
// isolated ids (the same 4 baseline rows), never a candidate row.
const rawRecords = [...BASELINE_SHARDS.map((shard) => shardBytes[shard].toString('utf8')), additiveBytes.toString('utf8')]
  .flatMap((text) => parseJsonl(text));
if (rawRecords.length !== 3436) throw new Error(`candidate raw row count drift: ${rawRecords.length}`);
const fullValidation = validateCatalogRecords(rawRecords);
const invalidIds = fullValidation.invalid.map((issue) => issue.record_id);
if (fullValidation.valid.length !== 3432 || invalidIds.length !== 4 || !invalidIds.every((id) => expectedIsolated.has(id))) {
  throw new Error(`candidate invalid set drift: ${JSON.stringify(invalidIds)}`);
}

// 5. Candidate named-source registry: frozen fixture + two additive bindings.
const frozenRegistry = await readJson(path.join(retrievalRoot, 'fixtures/named-source-registry.v1.0.0.json'));
const additiveBindings = new Map(additiveValidation.valid.map((record) => [record.identity.source.source_id, record.record_id]));
if (additiveBindings.size !== 2 || !additiveBindings.has('hrsa-ahrf') || !additiveBindings.has('rural-hospital-closure-tracking')) {
  throw new Error(`additive records must bind hrsa-ahrf and rural-hospital-closure-tracking, found: ${[...additiveBindings.keys()]}`);
}
const candidateRegistry = structuredClone(frozenRegistry);
for (const source of candidateRegistry.sources) {
  const bound = additiveBindings.get(source.source_id);
  if (!bound) continue;
  source.indexed_record_ids = [bound];
  source.coverage_state = 'indexed_candidate';
  source.catalog_membership = true;
  delete source.not_yet_indexed;
  source.candidate_corpus_version = CANDIDATE_VERSION;
}
const patched = candidateRegistry.sources.filter((source) => (source.indexed_record_ids ?? []).length > 0 && source.candidate_corpus_version === CANDIDATE_VERSION);
if (patched.length !== 2) throw new Error('candidate registry must bind exactly 2 sources');

// 6. Derived descriptors.
const files = [
  ...BASELINE_SHARDS.map((shard) => ({
    path: `corpus/${shard}`,
    bytes: shardBytes[shard].length,
    sha256: sha256(shardBytes[shard]),
    baseline: true,
    baseline_sha256: frozenSha.get(`corpus/${shard}`),
  })),
  { path: `corpus/${ADDITIVE_SHARD}`, bytes: additiveBytes.length, sha256: sha256(additiveBytes), baseline: false },
  { path: 'corpus/join-routes.jsonl', bytes: candidateJoinBytes.length, sha256: sha256(candidateJoinBytes), baseline: true },
  { path: 'fixtures/controlled-vocabulary.json', bytes: candidateVocabBytes.length, sha256: sha256(candidateVocabBytes), baseline: true },
];
const manifestSha256 = sha256(JSON.stringify({ corpus_version: CANDIDATE_VERSION, record_count: 3436, files }));
const corpusJson = {
  corpus_id: 'ushso-live-catalog-2026-09-03',
  corpus_version: CANDIDATE_VERSION,
  candidate_kind: 'documentation_first_additive_candidate',
  evidence_mode: 'live_first_party_metadata_plus_documentation_first_candidate',
  manifest_sha256: manifestSha256,
  algorithm_fingerprint_sha256: 'df3891067d6c1d50bf45c7efc7a73c30167486289f8c3039781266f583e0f714',
  record_count: 3436,
  search_document_count: 0,
  join_route_count: 0,
  record_files: [...BASELINE_SHARDS, ADDITIVE_SHARD],
  search_document_files: [],
  runtime_search_projection: 'on_demand',
  source_slices: {
    'cms-data-catalog': 159,
    'cdc-socrata': 1472,
    'census-api': 1803,
    'candidate-documentation-first': 2,
  },
  baseline: {
    corpus_version: '1.2.0',
    generation: PARENT_GENERATION,
    record_count: 3434,
    manifest_sha256: '85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e',
    shards_byte_identical: true,
  },
  publication: {
    generation: CANDIDATE_GENERATION,
    parent_generation: PARENT_GENERATION,
    observed_at: ASSEMBLED_AT,
    all_public_records_live_verified: false,
    candidate_additive_records: 2,
    candidate_access_states: ['unknown'],
    candidate_verification_states: ['not_live_verified'],
  },
  build_boundary: {
    fixture_only: false,
    external_requests: 0,
    payload_downloads: 0,
    identity_index_queries: 0,
    heavy_analysis_lock_touched: false,
    coverage_cells_executed: 0,
    accepted_upstream_metadata_requests: 0,
    candidate_note: 'Candidate assembly made zero external requests and downloaded zero payloads; the 17 bounded baseline enumeration requests are inherited unchanged from the parent generation.',
  },
};
const candidateManifest = {
  manifest_version: 'observatory-retrieval-candidate-manifest.v1.3.0',
  corpus_id: corpusJson.corpus_id,
  corpus_version: CANDIDATE_VERSION,
  generation: CANDIDATE_GENERATION,
  parent_generation: PARENT_GENERATION,
  manifest_sha256: manifestSha256,
  assembled_at: ASSEMBLED_AT,
  files,
  registry_patch: {
    base: 'fixtures/named-source-registry.v1.0.0.json (frozen; read-only)',
    bindings: [...additiveBindings.entries()].map(([source_id, record_id]) => ({ source_id, record_id })),
  },
  safety: {
    minimum_1000_records: true,
    all_public_records_current_verified: false,
    baseline_shards_byte_identical: true,
    unique_record_ids: true,
    additive_records_documentation_first: true,
    additive_access_unknown: true,
    additive_verification_not_live_verified: true,
    metadata_only_zero_payloads: true,
    zero_identity_merges: true,
  },
};
const validationReport = {
  schema_version: 'observatory-candidate-validation.v1.3.0',
  status: fullValidation.invalid.length === 4 ? 'PASS_WITH_ISOLATED_BASELINE_ROWS' : 'FAIL',
  observed_at: ASSEMBLED_AT,
  generation: CANDIDATE_GENERATION,
  parent_generation: PARENT_GENERATION,
  counts: {
    raw_rows: rawRecords.length,
    valid: fullValidation.valid.length,
    invalid_isolated: fullValidation.invalid.length,
    additive_valid: additiveValidation.valid.length,
    additive_invalid: additiveValidation.invalid.length,
  },
  isolated_record_ids: invalidIds,
  isolated_match_frozen_cohort: invalidIds.every((id) => expectedIsolated.has(id)),
  gates: candidateManifest.safety,
};

await fs.writeFile(path.join(versionRoot, 'corpus/corpus.json'), `${JSON.stringify(corpusJson, null, 2)}\n`);
await fs.writeFile(path.join(versionRoot, 'fixtures/named-source-registry.json'), `${JSON.stringify(candidateRegistry, null, 2)}\n`);
await fs.writeFile(path.join(versionRoot, 'manifests/candidate-manifest.json'), `${JSON.stringify(candidateManifest, null, 2)}\n`);
await fs.writeFile(path.join(versionRoot, 'validation/candidate-validation-report.json'), `${JSON.stringify(validationReport, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: 'PASS', candidate: CANDIDATE_VERSION, raw: rawRecords.length, valid: fullValidation.valid.length, isolated: invalidIds.length, manifest_sha256: manifestSha256 })}\n`);
