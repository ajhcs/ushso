import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRetrievalEngine } from '../tools/retrieval-core-v1.2.mjs';
import { projectSearchDocuments } from '../tools/search-document-v1.2.mjs';
import { accessDimensions, documentedPublicPayload, reviewedTopics } from '../tools/catalog-contract.mjs';
import { loadRetrievalValidators, validationErrors } from '../tools/schema-validation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const readJsonl = relative => fs.readFileSync(path.join(root, relative), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const vocabulary = readJson('fixtures/controlled-vocabulary.json');
const namedSourceRegistry = readJson('fixtures/named-source-registry.v1.0.0.json');
const corpusRecords = readJsonl('corpus/records.jsonl');
const productionRegressionRecords = readJsonl('versions/v1.2.0/corpus/records-0001.jsonl');
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

test('malformed nested collections are typed and isolated without interrupting a valid peer', async (t) => {
  const cases = [
    ['provenance', record => { record.provenance = {}; }, /provenance must be an array/],
    ['evidence', record => { record.evidence = {}; }, /evidence must be an array/],
    ['retrieval.instructions', record => { record.retrieval.instructions = {}; }, /retrieval contract is incomplete or invalid/]
  ];
  for (const [name, mutate, expectedError] of cases) await t.test(name, () => {
    const valid = cloneRecord(1);
    const malformed = cloneRecord(2);
    mutate(malformed);
    const result = engine([valid, malformed]).retrieve({ question: 'hospital closures', page_size: 10 });
    assert.deepEqual(result.results.map(item => item.record_id), [valid.record_id]);
    assert.equal(result.partial_results.is_partial, true);
    assert.equal(result.partial_results.invalid_item_count, 1);
    assert.equal(result.partial_results.issues[0].code, 'invalid_catalog_record');
    assert.match(result.partial_results.issues[0].errors.join(' '), expectedError);
  });
});

test('asset restrictions override references to separate public-use products', () => {
  const restrictedTitles = [
    'National Health and Nutrition Examination Survey (NHANES) Restricted Data: 1999 to Present',
    'COVID-19 Case Surveillance Restricted Access Detailed Data'
  ];
  for (const title of restrictedTitles) {
    const record = productionRegressionRecords.find(item => item.title === title);
    assert.ok(record, `missing production regression record: ${title}`);
    assert.equal(documentedPublicPayload(record), false, title);
    assert.equal(accessDimensions(record).payload_access, 'documented_restricted', title);
  }

  const publicUse = productionRegressionRecords.find(item => item.title === 'Lyme disease public use aggregated data with geography, 1992-2007');
  assert.ok(publicUse, 'missing public-use control record');
  assert.equal(documentedPublicPayload(publicUse), true);
  assert.equal(accessDimensions(publicUse).payload_access, 'documented_public');
});

test('structured asset restrictions override contradictory public-direct and public prose assertions', () => {
  const controls = [
    ['requirements', { requirements: ['A data use agreement is required.'], restriction_note: '' }],
    ['mechanisms', { mechanisms: ['registration'], requirements: ['none'], restriction_note: '' }],
    ['license requirement', { requirements: ['License required.'], restriction_note: '' }],
    ['restriction note', { requirements: ['none'], restriction_note: 'Access to this dataset is restricted and requires owner approval.' }]
  ];
  for (const [name, accessOverride] of controls) {
    const record = cloneRecord(20);
    record.title = 'Public use hospital dataset';
    record.description = 'This public use dataset is publicly available.';
    record.access = { ...record.access, status: 'public_direct', evidence_state: 'verified_first_party', ...accessOverride };
    assert.equal(documentedPublicPayload(record), false, name);
    const dimensions = accessDimensions(record);
    assert.equal(dimensions.payload_access, 'documented_restricted', name);
    assert.equal(dimensions.source_status, 'public_direct', name);
  }

  const genericCaptureNote = cloneRecord(21);
  genericCaptureNote.title = 'Public use hospital dataset';
  genericCaptureNote.access = {
    ...genericCaptureNote.access,
    status: 'public_direct',
    requirements: ['none'],
    restriction_note: 'No dataset rows, authentication workflow, or restricted payload were requested.'
  };
  assert.equal(documentedPublicPayload(genericCaptureNote), true);
});

test('malformed authoritative and retrieval URLs are isolated through the complete response contract', () => {
  const malformedAuthority = cloneRecord(2);
  malformedAuthority.authoritative_url = 'data:text/html,invalid';
  const malformedRetrieval = cloneRecord(3);
  malformedRetrieval.retrieval.instructions[0].url = 'javascript:alert(1)';
  const result = engine([cloneRecord(1), malformedAuthority, malformedRetrieval]).retrieve({ question: 'hospital closures', page_size: 10 });
  assert.deepEqual(result.results.map(item => item.record_id), ['fixture:record:001']);
  assert.equal(result.partial_results.invalid_item_count, 2);
  assert.ok(result.partial_results.issues.every(issue => issue.errors.some(error => /url|authoritative/i.test(error))));
});

test('HTTP source evidence remains searchable but never creates an inferred HTTPS navigation route', () => {
  const preserved = cloneRecord(1);
  preserved.authoritative_url = 'http://example.org/unverified-path';
  preserved.retrieval.instructions[0].url = 'http://example.org/unverified-path';
  preserved.provenance[0].locator = 'https://example.org/unrelated-catalog';
  const result = engine([preserved]).retrieve({ question: 'hospital closures', page_size: 10 });
  const metadata = result.results[0].metadata;
  assert.equal(metadata.description_quality.authoritative_url, null);
  assert.ok(metadata.retrieval_plan.access_routes.every(step => step.original_url !== preserved.authoritative_url));
  const unresolved = metadata.retrieval_plan.unresolved_routes.find(step => step.original_url === preserved.authoritative_url);
  assert.equal(unresolved.url, null);
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
  assert.equal(firstFacets.sections.find(section => section.id === 'unit_of_analysis').label, 'Inferred unit tag');
  assert.ok(!firstFacets.sections.some(section => section.label === 'Observation grain'));
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

  const nursingHome = cloneRecord(2);
  nursingHome.title = 'Nursing Home Hospital Context';
  nursingHome.description = 'Nursing home records with hospital context.';
  const exclusionEngine = engine([catalogOnly, nursingHome], { searchDocuments: null });
  for (const question of ['hospital excluding nursing homes', 'hospital NOT nursing home']) {
    const excluded = exclusionEngine.retrieve({ question, page_size: 10 });
    assert.ok(excluded.query.interpretation.exclusions.some(item => item.support === 'supported'), question);
    assert.ok(!excluded.results.some(item => item.record_id === nursingHome.record_id), question);
  }
  for (const question of ['hospital public only', 'hospital public use data only']) {
    const publicOnly = engine([catalogOnly]).retrieve({ question, page_size: 10 });
    assert.equal(publicOnly.query.interpretation.access_intent.public_only, true, question);
    assert.equal(publicOnly.results[0].match_state, 'uncertain', question);
    assert.equal(publicOnly.results[0].metadata.access_compatibility, 'unknown', question);
  }
});

test('free-data intent requires documented no-fee evidence independently of public payload access', () => {
  const documentedFree = cloneRecord(1);
  documentedFree.access = { ...documentedFree.access, status: 'public_direct', requirements: ['none'] };
  const unknownCost = cloneRecord(2);
  unknownCost.access = { ...unknownCost.access, status: 'public_direct', requirements: [] };
  const result = engine([documentedFree, unknownCost]).retrieve({ question: 'hospital closure free data', page_size: 10 });

  assert.equal(result.query.interpretation.access_intent.payload_requirement, 'documented_public_payload');
  assert.equal(result.query.interpretation.access_intent.cost_requirement, 'documented_no_fee');
  assert.equal(result.query.interpretation.positive_terms.includes('free'), false);
  assert.equal(result.results.find(item => item.record_id === documentedFree.record_id).match_state, 'supported');
  const uncertain = result.results.find(item => item.record_id === unknownCost.record_id);
  assert.equal(uncertain.match_state, 'uncertain');
  assert.equal(uncertain.metadata.access.payload_access, 'documented_public');
  assert.equal(uncertain.metadata.access.cost_state, 'unknown');
  assert.ok(uncertain.uncertainty_reasons.includes('cost_evidence_unknown'));
  assert.ok(result.results.filter(item => item.match_state === 'supported')
    .every(item => item.metadata.access.cost_state === 'documented_free'));
});

test('reviewed classification negatives suppress known context collisions', () => {
  const fixture = readJson('fixtures/classification-negative-fixtures.v1.0.0.json');
  for (const [index, item] of fixture.cases.entries()) {
    const record = cloneRecord(index, { title: item.title, description: item.description });
    record.capabilities.topics = item.must_not_infer.map(id => ({
      id,
      label: id,
      rationale: 'Synthetic broad keyword collision.',
      evidence_ids: [record.evidence[0].evidence_id],
      evidence_state: 'inferred',
      fitness: 'context_only'
    }));
    assert.deepEqual(reviewedTopics(record).map(topic => topic.id), [], item.fixture_id);
    const result = engine([record], { searchDocuments: null }).retrieve({ question: item.title, page_size: 10 });
    assert.ok(result.results.every(row => row.record.capabilities.topics.every(topic => !item.must_not_infer.includes(topic.id))), item.fixture_id);
  }
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
  const record = cloneRecord(1);
  const metadata = engine([record]).retrieve({ question: 'hospital closures' }).results[0].metadata;
  assert.deepEqual(metadata.dimensions.observation_grain, { values: [], state: 'unresolved' });
  assert.ok(record.unit_of_analysis.filter(value => value !== 'unknown').every(value => metadata.dimensions.inferred_search_tags.includes(`unit_of_analysis:${value}`)));
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
