import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRetrievalEngine } from '../tools/retrieval-core.mjs';
import { projectSearchDocuments } from '../tools/search-document.mjs';
import { loadRetrievalValidators, validationErrors } from '../tools/schema-validation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const readJsonl = relative => fs.readFileSync(path.join(root, relative), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const vocabulary = readJson('fixtures/controlled-vocabulary.json');
const namedSourceRegistry = readJson('fixtures/named-source-registry.v1.0.0.json');
const corpusRecords = readJsonl('corpus/records.jsonl');
const template = corpusRecords.find(record => record.record_id === 'obs:asset:unc-sheps-rural-hospital-closures');

function cloneRecord(index, overrides = {}) {
  const record = structuredClone(template);
  record.record_id = `fixture:record:${String(index).padStart(3, '0')}`;
  record.identity.asset.asset_id = record.record_id;
  record.identity.asset.name = `Hospital closure fixture ${index}`;
  record.title = `Hospital closure fixture ${String(index).padStart(3, '0')}`;
  Object.assign(record, overrides);
  return record;
}

function engine(records, options = {}) {
  return createRetrievalEngine({
    records,
    searchDocuments: options.searchDocuments,
    joinRoutes: [],
    vocabulary,
    namedSourceRegistry,
    corpus: { corpus_id: 'synthetic-release-contract', corpus_version: options.version ?? 'test', manifest_sha256: options.generation ?? 'a'.repeat(64) }
  });
}

test('one malformed record is isolated while valid results remain usable', () => {
  const malformed = cloneRecord(2);
  delete malformed.freshness_verification;
  const result = engine([cloneRecord(1), malformed]).retrieve({ question: 'hospital closures', page_size: 10 });
  assert.deepEqual(result.results.map(item => item.record_id), ['fixture:record:001']);
  assert.equal(result.partial_results.is_partial, true);
  assert.equal(result.partial_results.invalid_item_count, 1);
  assert.match(result.warnings.join(' '), /isolated/);
});

test('state compatibility separates documented matches from national unknowns and excludes incompatibility', () => {
  const pa = cloneRecord(1);
  pa.geography = { ...pa.geography, coverage_level: 'state', jurisdictions: ['US-PA'] };
  const national = cloneRecord(2);
  national.geography = { ...national.geography, coverage_level: 'national', jurisdictions: ['US'] };
  const ca = cloneRecord(3);
  ca.geography = { ...ca.geography, coverage_level: 'state', jurisdictions: ['US-CA'] };
  const result = engine([pa, national, ca]).retrieve({ question: 'hospital closures in Pennsylvania', page_size: 10 });
  assert.equal(result.results.find(item => item.record_id === pa.record_id).match_state, 'supported');
  assert.equal(result.results.find(item => item.record_id === national.record_id).metadata.geographic_compatibility, 'unknown');
  assert.ok(!result.results.some(item => item.record_id === ca.record_id));
});

test('cursor pagination traverses a generation without duplicates and facets cover every match', () => {
  const records = Array.from({ length: 235 }, (_, index) => cloneRecord(index));
  const retrieval = engine(records);
  const ids = [];
  let cursor = null;
  let firstFacets;
  do {
    const result = retrieval.retrieve({ question: 'hospital closures', page_size: 37, cursor });
    firstFacets ??= result.facets;
    assert.deepEqual(result.ranking.ordered_ids, result.results.map(item => item.record_id));
    assert.deepEqual(result.facets, firstFacets);
    ids.push(...result.results.map(item => item.record_id));
    cursor = result.pagination.next_cursor;
  } while (cursor);
  assert.equal(ids.length, 235);
  assert.equal(new Set(ids).size, 235);
  assert.equal(firstFacets.sections.find(section => section.id === 'source').options.reduce((sum, option) => sum + option.count, 0), 235);
});

test('cursor is pinned to generation, filters, sort, and page size', () => {
  const retrieval = engine(Array.from({ length: 5 }, (_, index) => cloneRecord(index)));
  const cursor = retrieval.retrieve({ question: 'hospital closures', page_size: 2 }).pagination.next_cursor;
  assert.throws(() => retrieval.retrieve({ question: 'hospital closures', page_size: 3, cursor }), error => error.code === 'cursor_query_mismatch');
  assert.throws(() => retrieval.retrieve({ question: 'hospital closures', page_size: 2, cursor, generation: 'wrong' }), error => error.code === 'generation_unavailable');
});

test('named sources are direct records or explicit coverage gaps, never replaced by mentions', () => {
  const hcris = corpusRecords.find(record => record.record_id === 'obs:asset:cms-hcris-hospital-cost-reports');
  const direct = engine([hcris]).retrieve({ question: 'HCRIS hospital cost reports', page_size: 10 });
  assert.equal(direct.results[0].metadata.named_source_role, 'direct_source');
  assert.equal(direct.named_source_resolution[0].state, 'indexed');
  const gap = engine([cloneRecord(1)]).retrieve({ question: 'Find HCUP', page_size: 10 });
  assert.equal(gap.result_count, 0);
  assert.equal(gap.named_source_resolution[0].state, 'coverage_gap');
  assert.match(gap.named_source_resolution[0].message, /not indexed/);
});

test('public payload, exclusions, time uncertainty, and separate chronology remain explicit', () => {
  const catalogOnly = cloneRecord(1);
  catalogOnly.access = { ...catalogOnly.access, status: 'public_catalog' };
  catalogOnly.time_coverage = { ...catalogOnly.time_coverage, start: null, end: null, state: 'unknown' };
  const result = engine([catalogOnly]).retrieve({ question: 'free data about hospital closures in 2024 excluding nursing homes', page_size: 10 });
  assert.equal(result.results[0].match_state, 'uncertain');
  assert.equal(result.results[0].metadata.access.payload_access, 'unknown');
  assert.equal(result.results[0].metadata.dates.publisher_release_date, null);
  assert.deepEqual(result.query.interpretation.exclusions.map(item => item.normalized_phrase), ['nursing homes']);
  assert.ok(result.results[0].uncertainty_reasons.includes('observation_period_unknown'));
});

test('release and observation sorts use separate evidenced fields and unknowns sort last', () => {
  const historicalNewRelease = cloneRecord(1, { release_date: '2026-01-15' });
  historicalNewRelease.time_coverage = { ...historicalNewRelease.time_coverage, start: '1990', end: '1999' };
  const olderCurrentCoverage = cloneRecord(2, { release_date: '2020-06-01' });
  olderCurrentCoverage.time_coverage = { ...olderCurrentCoverage.time_coverage, start: '2023', end: '2024' };
  const unknown = cloneRecord(3);
  unknown.time_coverage = { ...unknown.time_coverage, start: null, end: null };
  const retrieval = engine([historicalNewRelease, olderCurrentCoverage, unknown]);
  assert.deepEqual(retrieval.retrieve({ question: 'hospital closures', sort: 'release_newest', page_size: 10 }).results.map(item => item.record_id), [historicalNewRelease.record_id, olderCurrentCoverage.record_id, unknown.record_id]);
  assert.deepEqual(retrieval.retrieve({ question: 'hospital closures', sort: 'observation_latest', page_size: 10 }).results.map(item => item.record_id), [olderCurrentCoverage.record_id, historicalNewRelease.record_id, unknown.record_id]);
});

test('freshness clock and corrupted-text notice do not rewrite preserved evidence', () => {
  const record = cloneRecord(1);
  record.description += ' damaged \uFFFD symbol';
  record.freshness_verification.next_review_due = '2026-01-01T00:00:00Z';
  const retrieval = engine([record]);
  const before = retrieval.retrieve({ question: 'hospital closures' }, { now: '2025-12-31T23:59:59Z' }).results[0].metadata;
  const after = retrieval.retrieve({ question: 'hospital closures' }, { now: '2026-01-01T00:00:01Z' }).results[0].metadata;
  assert.equal(before.freshness.freshness_state, 'within_review_window');
  assert.equal(after.freshness.freshness_state, 'overdue');
  assert.equal(after.freshness.verification_status, record.freshness_verification.verification_status);
  assert.equal(after.description_quality.state, 'suspected_encoding_corruption');
  assert.equal(after.description_quality.display_description, record.description);
  assert.equal(after.description_quality.repair_state, 'unresolved_no_verified_repair');
});

test('metadata dimensions never copy observation grain into population or reporting organization', () => {
  const metadata = engine([cloneRecord(1)]).retrieve({ question: 'hospital closures' }).results[0].metadata;
  assert.ok(metadata.dimensions.observation_grain.values.length > 0);
  assert.deepEqual(metadata.dimensions.sampled_entity, { values: [], state: 'unresolved' });
  assert.deepEqual(metadata.dimensions.reporting_organization, { values: [], state: 'unresolved' });
  assert.deepEqual(metadata.dimensions.population_universe, { values: [], state: 'unresolved' });
  assert.ok(metadata.claim_evidence.every(claim => claim.references.every(reference => 'source_locator' in reference && 'captured_at' in reference && 'content_sha256' in reference)));
  assert.ok(metadata.retrieval_plan.access_routes.every(step => step.url && step.action !== 'stop_and_report'));
  assert.ok(metadata.retrieval_plan.stop_conditions.every(step => step.action === 'stop_and_report' && step.url === null));
});

test('fixed reviewer-labeled relevance cases preserve essential concepts and named sources', () => {
  const review = readJson('fixtures/relevance-review.v1.0.0.json');
  const retrieval = createRetrievalEngine({
    records: corpusRecords,
    searchDocuments: readJsonl('corpus/search-documents.jsonl'),
    joinRoutes: readJsonl('corpus/join-routes.jsonl'),
    vocabulary,
    namedSourceRegistry,
    corpus: readJson('corpus/corpus.json')
  });
  for (const fixture of review.cases) {
    const result = retrieval.retrieve({ question: fixture.question, page_size: 10 });
    assert.deepEqual(result.query.interpretation.subjects.map(item => item.id), fixture.essential_subjects, fixture.case_id);
    if (fixture.expected_state === 'coverage_gap') assert.equal(result.total_matches, 0, fixture.case_id);
    else if (fixture.expected_state === 'contextual_only') assert.ok(result.results.length > 0 && result.results.every(item => item.match_state === 'contextual'), fixture.case_id);
    else assert.equal(result.results[0]?.record_id, fixture.expected_first_record_id, fixture.case_id);
  }
});

test('additive intent, search projection, and discovery response validate against published schemas', async () => {
  const { validators } = await loadRetrievalValidators();
  const record = cloneRecord(1);
  const retrieval = engine([record]);
  const query = { question: 'hospital closures in Pennsylvania', page_size: 1, sort: 'canonical_relevance' };
  const intent = retrieval.interpret(query);
  const result = retrieval.retrieve(query);
  const projection = projectSearchDocuments([record])[0];
  assert.equal(validators.intent(intent), true, validationErrors(validators.intent));
  assert.equal(validators.result(result), true, validationErrors(validators.result));
  assert.equal(validators.searchDocument(projection), true, validationErrors(validators.searchDocument));
});
