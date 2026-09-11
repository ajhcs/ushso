import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRetrievalEngine } from '../../packages/retrieval/tools/retrieval-core-v1.2.mjs';
import { StaticCoverageRepository } from '../../packages/coverage/static-coverage-repository.mjs';
import { StaticPlannerRepository } from '../../packages/planner/static-planner-repository.mjs';
import { StaticAssetCatalogRepository } from '../../packages/registry/static-asset-catalog-repository.mjs';
import { createStaticPublicationReadContext } from '../../packages/registry/publication-read-context.mjs';
import { StaticSearchBackend } from '../../packages/search/static-search-backend.mjs';
import { PublicQueryService } from '../../worker/public-query-service.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const readJsonl = relative => fs.readFileSync(path.join(root, relative), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const vocabulary = readJson('packages/retrieval/fixtures/controlled-vocabulary.json');
const namedSourceRegistry = readJson('packages/retrieval/fixtures/named-source-registry.v1.0.0.json');
const template = readJsonl('packages/retrieval/corpus/records.jsonl')
  .find(record => record.record_id === 'obs:asset:unc-sheps-rural-hospital-closures');

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function clockRecord(overrides = {}) {
  const { freshness_verification: freshnessOverrides, ...rest } = overrides;
  const record = structuredClone(template);
  record.record_id = 'fixture:pr005:clock';
  record.identity.asset.asset_id = record.record_id;
  record.title = 'Hospital financial clock fixture';
  record.unit_of_analysis = ['hospital', 'facility', 'provider', 'state'];
  record.freshness_verification = {
    ...record.freshness_verification,
    next_review_due: '2026-09-05T00:00:00.000Z',
    metadata_observed_at: '2026-09-03T22:22:33.908Z',
    ...freshnessOverrides
  };
  Object.assign(record, rest);
  return record;
}

function engineFor(records, corpus = { corpus_id: 'pr005-clock', corpus_version: 'test', manifest_sha256: 'a'.repeat(64) }) {
  return createRetrievalEngine({
    records,
    searchDocuments: null,
    joinRoutes: [],
    vocabulary,
    namedSourceRegistry,
    corpus
  });
}

function publicService(engine, records, corpus) {
  return new PublicQueryService({
    publicationResolver: { resolve: async () => createStaticPublicationReadContext(corpus) },
    catalogRepository: new StaticAssetCatalogRepository({
      loadCatalog: async () => ({ records, searchDocuments: [], joinRoutes: [], vocabulary, corpus, engine })
    }),
    searchBackend: new StaticSearchBackend({ loadEngine: async () => engine }),
    coverageRepository: new StaticCoverageRepository(),
    plannerRepository: new StaticPlannerRepository()
  });
}

test('C-005-1: September 10 evaluation of a September 5 deadline is overdue', () => {
  const record = clockRecord();
  const beforeHash = sha256(record);
  const retrieval = engineFor([record]);
  const overdue = retrieval.retrieve({ question: 'hospital financials', page_size: 10 }, { now: '2026-09-10T12:00:00.000Z' }).results[0].metadata.freshness;
  assert.equal(overdue.freshness_state, 'overdue');
  assert.match(overdue.note, /overdue/);
  assert.equal(overdue.evaluated_at, '2026-09-10T12:00:00.000Z');
  assert.equal(overdue.last_checked, record.freshness_verification.metadata_observed_at);
  assert.equal(sha256(retrieval.retrieve({ question: 'hospital financials', page_size: 10 }, { now: '2026-09-10T12:00:00.000Z' }).results[0].record), beforeHash);
});

test('C-005-1: before-deadline, missing, and invalid due dates remain distinct', () => {
  const retrieval = engineFor([clockRecord()]);
  const before = retrieval.retrieve({ question: 'hospital financials', page_size: 10 }, { now: '2026-09-04T23:59:59.000Z' }).results[0].metadata.freshness;
  assert.equal(before.freshness_state, 'within_review_window');
  assert.equal(before.note, 'Review deadline has not passed.');

  const missing = engineFor([clockRecord({ freshness_verification: { next_review_due: null } })]);
  const missingFreshness = missing.retrieve({ question: 'hospital financials', page_size: 10 }, { now: '2026-09-10T12:00:00.000Z' }).results[0].metadata.freshness;
  assert.equal(missingFreshness.freshness_state, 'deadline_unknown');
  assert.notEqual(missingFreshness.freshness_state, 'overdue');

  const invalid = engineFor([clockRecord({ freshness_verification: { next_review_due: 'not-a-date' } })]);
  const invalidFreshness = invalid.retrieve({ question: 'hospital financials', page_size: 10 }, { now: '2026-09-10T12:00:00.000Z' }).results[0].metadata.freshness;
  assert.equal(invalidFreshness.freshness_state, 'deadline_unknown');
  assert.notEqual(invalidFreshness.freshness_state, before.freshness_state);
  assert.notEqual(invalidFreshness.freshness_state, 'overdue');
});

test('C-005-1: frozen default clock stays deterministic and does not rewrite source observations', () => {
  const record = clockRecord();
  const retrieval = engineFor([record]);
  const first = retrieval.retrieve({ question: 'hospital financials', page_size: 10 });
  const second = retrieval.retrieve({ question: 'hospital financials', page_size: 10 });
  assert.equal(first.receipt.generated_at, '1970-01-01T00:00:00.000Z');
  assert.equal(second.receipt.generated_at, first.receipt.generated_at);
  assert.equal(first.results[0].metadata.freshness.freshness_state, 'within_review_window');
  assert.equal(first.results[0].metadata.freshness.evaluated_at, '1970-01-01T00:00:00.000Z');
  assert.equal(JSON.stringify(first.ranking.ordered_ids), JSON.stringify(second.ranking.ordered_ids));
  assert.equal(sha256(first.results[0].record), sha256(record));
  assert.equal(sha256(first.results[0].record.evidence), sha256(record.evidence));
  assert.throws(
    () => retrieval.retrieve({ question: 'hospital financials', page_size: 10 }, { now: 'not-a-clock' }),
    { message: /observation clock is invalid/ }
  );
});

test('C-005-1: public request evaluation time reaches freshness projection', async () => {
  const record = clockRecord();
  const corpus = { corpus_id: 'pr005-clock', corpus_version: 'test', manifest_sha256: 'a'.repeat(64) };
  const engine = engineFor([record], corpus);
  const service = publicService(engine, [record], corpus);
  const session = await service.openRequest({
    request: new Request('https://ushso.org/api/discover'),
    env: {},
    now: '2026-09-10T12:00:00.000Z'
  });
  assert.equal(session.evaluatedAt, '2026-09-10T12:00:00.000Z');
  const result = await service.discover(session, { question: 'hospital financials', page_size: 10 });
  assert.equal(result.results[0].metadata.freshness.freshness_state, 'overdue');
  assert.equal(result.results[0].metadata.freshness.evaluated_at, '2026-09-10T12:00:00.000Z');
  assert.equal(result.receipt.generated_at, '2026-09-10T12:00:00.000Z');
  assert.equal(sha256(result.results[0].record), sha256(record));

  const headerSession = await service.openRequest({
    request: new Request('https://ushso.org/api/discover', { headers: { Date: 'Fri, 04 Sep 2026 12:00:00 GMT' } }),
    env: {}
  });
  const before = await service.discover(headerSession, { question: 'hospital financials', page_size: 10 });
  assert.equal(before.results[0].metadata.freshness.freshness_state, 'within_review_window');
  assert.equal(before.receipt.generated_at, headerSession.evaluatedAt);
});

test('C-005-2: HCRIS-style inferred unit tags do not become observation grain', () => {
  const record = clockRecord();
  const result = engineFor([record]).retrieve({ question: 'hospital financials', page_size: 10 }).results[0];
  assert.deepEqual(result.metadata.dimensions.observation_grain, { values: [], state: 'unresolved' });
  assert.ok(record.unit_of_analysis.every(value => result.metadata.dimensions.inferred_search_tags.includes(`unit_of_analysis:${value}`)));
  assert.equal(sha256(result.record.unit_of_analysis), sha256(record.unit_of_analysis));
  assert.notEqual(result.metadata.dimensions.observation_grain.state, 'source_asserted');
});
