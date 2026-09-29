import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWorker } from '../worker/index.mjs';
import { createRetrievalEngine } from '../packages/retrieval/tools/retrieval-core.mjs';

const firstRecord = JSON.parse((await fs.readFile(new URL('../packages/retrieval/versions/v1.1.0/corpus/records.jsonl', import.meta.url), 'utf8')).split(/\r?\n/)[0]);

const result = {
  contract_version: 'observatory-discovery-result.v1.0.0',
  retrieval_id: 'retrieval-0123456789abcdef',
  evidence_mode: 'published_offline_evidence',
  corpus: { corpus_id: 'fixture', corpus_version: '1.0.0', record_count: 1, join_route_count: 0 },
  query: { question: 'hospital data', normalized_question: 'hospital data', interpretation: {}, filters: {} },
  result_count: 0,
  results: [],
  join_routes: [],
  warnings: []
};

const engine = {
  interpret(input = {}) {
    return {
      original_question: input.question ?? 'Browse published health systems data',
      normalized_question: (input.question ?? 'Browse published health systems data').toLowerCase(),
      interpretation: { geographies: [], subjects: [], units_of_analysis: [], time_window: null, access_intent: { include_restricted: true, public_only: false, accepts_restricted: true, match_basis: 'default' } },
      compiler: { mode: 'deterministic_controlled_vocabulary', llm_used: false, external_requests: 0 }
    };
  },
  retrieve(input) {
    if (typeof input?.question !== 'string') throw new TypeError('question is required');
    return { ...result, query: { ...result.query, question: input.question } };
  }
};
const catalog = { records: [firstRecord], searchDocuments: [{}], joinRoutes: [], corpus: { corpus_id: 'fixture', corpus_version: '1.1.0' }, engine };
const worker = createWorker({ loadEngine: async () => engine, loadCatalog: async () => catalog });
const env = { ASSETS: { fetch: async () => new Response('{}', { status: 200 }) } };

test('health exposes the deterministic compiler boundary', async () => {
  const response = await worker.fetch(new Request('https://ushso.org/api/health'), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).compiler.llm_used, false);
});
test('discover accepts bounded JSON and returns the canonical result contract', async () => {
  const response = await worker.fetch(new Request('https://ushso.org/api/discover', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'hospital financial data' })
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).contract_version, 'observatory-discovery-result.v1.0.0');
});

test('discover rejects wrong methods, media types, invalid JSON, and invalid queries', async () => {
  assert.equal((await worker.fetch(new Request('https://ushso.org/api/discover'), env)).status, 405);
  assert.equal((await worker.fetch(new Request('https://ushso.org/api/discover', { method: 'POST', body: '{}' }), env)).status, 415);
  assert.equal((await worker.fetch(new Request('https://ushso.org/api/discover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }), env)).status, 400);
  assert.equal((await worker.fetch(new Request('https://ushso.org/api/discover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), env)).status, 400);
});

test('unknown API routes fail closed', async () => {
  const response = await worker.fetch(new Request('https://ushso.org/api/unknown'), env);
  assert.equal(response.status, 404);
});

test('supports health HEAD and cross-origin API preflight', async () => {
  const health = await worker.fetch(new Request('https://ushso.org/api/health', { method: 'HEAD' }), env);
  const preflight = await worker.fetch(new Request('https://ushso.org/api/discover', { method: 'OPTIONS' }), env);
  assert.equal(health.status, 200);
  assert.equal(await health.text(), '');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
});

test('catalog browsing and dataset dereferencing do not depend on a question', async () => {
  const browse = await worker.fetch(new Request('https://ushso.org/api/catalog'), env);
  const browseResult = await browse.json();
  const direct = await worker.fetch(new Request(`https://ushso.org/api/datasets/${encodeURIComponent(firstRecord.record_id)}`), env);
  assert.equal(browse.status, 200);
  assert.equal(browseResult.result_count, 1);
  assert.equal(browseResult.returned_count, 1);
  assert.equal(browseResult.total_matches, 1);
  assert.equal(browseResult.has_more, false);
  assert.equal(direct.status, 200);
  assert.equal((await direct.json()).results[0].record_id, firstRecord.record_id);
  assert.equal((await worker.fetch(new Request('https://ushso.org/api/datasets/not-present'), env)).status, 404);
});

test('catalog cursors traverse more than 200 records without duplicates and pin sort, filters, and generation', async () => {
  const records = Array.from({ length: 235 }, (_, index) => ({
    ...structuredClone(firstRecord),
    record_id: `fixture-${String(index).padStart(3, '0')}`,
    title: `Fixture record ${String(234 - index).padStart(3, '0')}`,
    identity: {
      ...structuredClone(firstRecord.identity),
      source: { source_id: index % 3 === 0 ? 'cms' : index % 3 === 1 ? 'cdc' : 'census', name: index % 3 === 0 ? 'CMS' : index % 3 === 1 ? 'CDC' : 'Census' },
      asset: { ...structuredClone(firstRecord.identity.asset), asset_id: `fixture-${index}`, name: `Fixture ${index}` },
      family: { ...structuredClone(firstRecord.identity.family), family_id: `family-${index}`, name: `Family ${index}` }
    }
  }));
  const largeCatalog = { ...catalog, records, corpus: { ...catalog.corpus, manifest_sha256: 'large-catalog-hash' } };
  const largeWorker = createWorker({ loadEngine: async () => engine, loadCatalog: async () => largeCatalog });
  const ids = [];
  let cursor;
  let generation;
  let facetSnapshot;
  do {
    const url = new URL('https://ushso.org/api/catalog');
    url.searchParams.set('page_size', '37');
    url.searchParams.set('sort', 'title_asc');
    if (cursor) url.searchParams.set('cursor', cursor);
    if (generation) url.searchParams.set('generation', generation);
    const response = await largeWorker.fetch(new Request(url), env);
    assert.equal(response.status, 200);
    const page = await response.json();
    ids.push(...page.results.map(item => item.record_id));
    assert.deepEqual(page.ranking.ordered_ids, page.results.map(item => item.record_id));
    facetSnapshot ??= page.facets;
    assert.deepEqual(page.facets, facetSnapshot);
    generation = page.pagination.generation;
    cursor = page.pagination.next_cursor;
  } while (cursor);
  assert.equal(ids.length, 235);
  assert.equal(new Set(ids).size, 235);

  const firstPage = await largeWorker.fetch(new Request('https://ushso.org/api/catalog?page_size=10'), env);
  const firstBody = await firstPage.json();
  const wrongSort = await largeWorker.fetch(new Request(`https://ushso.org/api/catalog?page_size=10&sort=title_asc&cursor=${encodeURIComponent(firstBody.pagination.next_cursor)}`), env);
  const staleGeneration = await largeWorker.fetch(new Request(`https://ushso.org/api/catalog?generation=${encodeURIComponent('retired-generation')}`), env);
  assert.equal(wrongSort.status, 400);
  assert.equal((await wrongSort.json()).error.code, 'invalid_cursor');
  assert.equal(staleGeneration.status, 410);
});

test('catalog filtering and facets operate on the complete matching collection before pagination', async () => {
  const records = Array.from({ length: 240 }, (_, index) => ({
    ...structuredClone(firstRecord),
    record_id: `source-fixture-${index}`,
    identity: {
      ...structuredClone(firstRecord.identity),
      source: { source_id: index < 80 ? 'cms' : index < 160 ? 'cdc' : 'census', name: index < 80 ? 'CMS' : index < 160 ? 'CDC' : 'Census' },
      asset: { ...structuredClone(firstRecord.identity.asset), asset_id: `source-fixture-${index}` },
      family: { ...structuredClone(firstRecord.identity.family), family_id: `source-family-${index}` }
    }
  }));
  const largeCatalog = { ...catalog, records, corpus: { ...catalog.corpus, manifest_sha256: 'facet-catalog-hash' } };
  const largeWorker = createWorker({ loadEngine: async () => engine, loadCatalog: async () => largeCatalog });
  const response = await largeWorker.fetch(new Request('https://ushso.org/api/catalog?page_size=7&filter=source%3Acms'), env);
  const body = await response.json();
  assert.equal(body.results.length, 7);
  assert.equal(body.total_matches, 80);
  assert.ok(body.results.every(item => item.record.identity.source.source_id === 'cms'));
  const sourceFacet = body.facets.sections.find(section => section.id === 'source');
  assert.deepEqual(sourceFacet.options, [{ value: 'cms', label: 'CMS', count: 80 }]);
  assert.equal(body.facets.count_basis, 'records');
  assert.equal(body.facets.approximate, false);
});

test('catalog browse isolates an incompatible record and keeps valid partial results usable', async () => {
  const malformed = { ...structuredClone(firstRecord), record_id: 'malformed-record', title: '' };
  const partialCatalog = {
    ...catalog,
    catalogIssues: [{ index: 1, record_id: 'malformed-record', code: 'invalid_catalog_record', errors: ['title must be a non-empty string'] }]
  };
  const partialWorker = createWorker({ loadEngine: async () => engine, loadCatalog: async () => partialCatalog });
  const response = await partialWorker.fetch(new Request('https://ushso.org/api/catalog'), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.results.length, 1);
  assert.equal(body.partial_results.is_partial, true);
  assert.equal(body.partial_results.invalid_item_count, 1);
  assert.ok(!body.results.some(item => item.record_id === malformed.record_id));
});

test('discovery API traverses a complete synthetic match set with stable server order', async () => {
  const records = Array.from({ length: 225 }, (_, index) => ({
    ...structuredClone(firstRecord),
    record_id: `search-fixture-${String(index).padStart(3, '0')}`,
    title: `Hospital fixture ${String(index).padStart(3, '0')}`,
    identity: {
      ...structuredClone(firstRecord.identity),
      asset: { ...structuredClone(firstRecord.identity.asset), asset_id: `search-fixture-${String(index).padStart(3, '0')}`, name: `Hospital fixture ${index}` },
      family: { ...structuredClone(firstRecord.identity.family), family_id: `search-family-${index}`, name: `Search family ${index}` }
    }
  }));
  const syntheticEngine = createRetrievalEngine({
    records,
    searchDocuments: null,
    joinRoutes: [],
    vocabulary: { subjects: [], geographies: [], units: [] },
    corpus: { corpus_id: 'search-pagination-fixture', corpus_version: '1.0.0', manifest_sha256: 'search-pagination-generation', published_at: '2026-09-06T00:00:00Z' }
  });
  const searchWorker = createWorker({ loadEngine: async () => syntheticEngine, loadCatalog: async () => catalog });
  const ids = [];
  const pageSizes = [];
  let cursor = null;
  let generation = null;
  do {
    const response = await searchWorker.fetch(new Request('https://ushso.org/api/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'hospital fixture', page_size: 75, sort: 'title_asc', ...(cursor ? { cursor, generation } : {}) })
    }), env);
    assert.equal(response.status, 200);
    const page = await response.json();
    pageSizes.push([page.results.length, page.pagination.total_matches, page.pagination.has_more]);
    ids.push(...page.ranking.ordered_ids);
    cursor = page.pagination.next_cursor;
    generation = page.pagination.generation;
  } while (cursor);
  assert.equal(ids.length, 225, JSON.stringify(pageSizes));
  assert.equal(new Set(ids).size, 225);
  assert.deepEqual(ids, [...ids].sort());
});

test('serves machine files with their real types and gives unknown pages HTTP 404', async () => {
  const llms = await worker.fetch(new Request('https://ushso.org/llms.txt'), env);
  const robots = await worker.fetch(new Request('https://ushso.org/robots.txt'), env);
  const sitemap = await worker.fetch(new Request('https://ushso.org/sitemap.xml'), env);
  const unknown = await worker.fetch(new Request('https://ushso.org/unknown-page'), env);
  assert.match(llms.headers.get('content-type'), /^text\/plain/);
  assert.match(await llms.text(), /POST https:\/\/ushso.org\/api\/discover/);
  assert.match(await robots.text(), /User-agent: \*/);
  assert.match(sitemap.headers.get('content-type'), /^application\/xml/);
  assert.equal(unknown.status, 404);
});
