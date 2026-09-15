import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWorker } from '../worker/index.mjs';

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
const catalog = {
  records: [firstRecord], searchDocuments: [{}], joinRoutes: [], engine,
  corpus: {
    corpus_id: 'fixture', corpus_version: '1.2.0', record_count: 1, search_document_count: 1,
    join_route_count: 0, source_slices: { [firstRecord.identity.source.source_id]: 1 },
    manifest_sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    publication: { generation: 'generation.worker-test', observed_at: '2026-09-03T12:00:00Z' },
  },
};
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

test('versioned machine routes return strict toolkit envelopes without touching legacy routes', async () => {
  const response = await worker.fetch(new Request(
    `https://ushso.org/api/machine/v1/assets/${encodeURIComponent(firstRecord.record_id)}?generation=generation.worker-test`,
  ), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.tool_contract_version, 'observatory-machine-toolkit.v1.1.0');
  assert.deepEqual(body.rate_limit, { state: 'unknown', policy_id: null, limit: null, remaining: null, reset_at: null, retry_after_seconds: null });
  assert.equal(body.capability, 'get_asset');
  assert.equal(body.transport_adapter, 'json_api');
  assert.equal(body.ok, true);
  assert.deepEqual(Object.values(body.truth_boundary), Array(6).fill(false));
});

test('serves machine files with their real types and gives unknown pages HTTP 404', async () => {
  const llms = await worker.fetch(new Request('https://ushso.org/llms.txt'), env);
  const robots = await worker.fetch(new Request('https://ushso.org/robots.txt'), env);
  const sitemap = await worker.fetch(new Request('https://ushso.org/sitemap.xml'), env);
  const unknown = await worker.fetch(new Request('https://ushso.org/unknown-page'), env);
  assert.match(llms.headers.get('content-type'), /^text\/plain/);
  assert.match(await llms.text(), /POST https:\/\/ushso.org\/api\/discover/);
  assert.match(await robots.text(), /User-agent: \*/);
  const sitemapBody = await sitemap.text();
  assert.match(sitemap.headers.get('content-type'), /^application\/xml/);
  assert.match(sitemapBody, /<loc>https:\/\/ushso.org\/learn<\/loc>/);
  assert.match(sitemapBody, /<loc>https:\/\/ushso.org\/methods<\/loc>/);
  assert.match(sitemapBody, new RegExp(`<loc>https://ushso.org/datasets/${encodeURIComponent(firstRecord.record_id)}</loc>`));
  assert.equal(unknown.status, 404);
});

test('no-JS search fallback lists catalog titles without claiming ranked discovery', async () => {
  const page = await worker.fetch(new Request('https://ushso.org/search?q=hospital', { headers: { accept: 'text/html' } }), env);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /data-crawler-content="search-fallback"/);
  assert.match(html, /JavaScript is required for ranked search|ranked discovery/i);
  assert.match(html, /Catalog membership is not payload access/);
});

test('no-JS title fallback matches hospital cost report tokens, not only a contiguous phrase', async () => {
  const hcris = { ...firstRecord, record_id: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17', title: 'Hospital Provider Cost Report' };
  const local = createWorker({ loadEngine: async () => engine, loadCatalog: async () => ({ ...catalog, records: [hcris] }) });
  const spaEnv = { ASSETS: { fetch: async () => new Response('<!doctype html><html><head><title>SPA</title></head><body><div id="root"></div></body></html>', { status: 200, headers: { 'content-type': 'text/html' } }) } };
  const page = await local.fetch(new Request('https://ushso.org/search?q=hospital+cost+report', { headers: { accept: 'text/html' } }), spaEnv);
  const html = await page.text();
  assert.match(html, /Hospital Provider Cost Report/);
  assert.match(html, /data-crawler-content="search-fallback"/);
  assert.match(html, /datasets\/obs%3Aasset%3Acms-data-catalog%3Adata.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17/);
});

test('HTML-only crawlers see catalog source facts on dataset URLs without a blank page', async () => {
  const found = await worker.fetch(new Request(`https://ushso.org/datasets/${encodeURIComponent(firstRecord.record_id)}`, { headers: { accept: 'text/html' } }), env);
  const html = await found.text();
  assert.equal(found.status, 200);
  assert.match(found.headers.get('content-type'), /text\/html/);
  assert.match(html, /data-crawler-content="dataset"/);
  assert.match(html, /Clear source action/);
  assert.match(html, new RegExp(firstRecord.title.slice(0, 24).replace(/[.*+?^$()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /doi.org\/10\./);
  const missing = await worker.fetch(new Request('https://ushso.org/datasets/not-a-real-record'), env);
  const missingHtml = await missing.text();
  assert.equal(missing.status, 404);
  assert.match(missingHtml, /Dataset record not found/);
  assert.doesNotMatch(missingHtml, /<div id="root"><\/div>/);
});

test('HTTP catalog page limits remain bounded while preserving traversal options', async () => {
  const observed = [];
  const bounded = createWorker({publicQueryService:{
    async openRequest(){return {};},
    async browse(_session, options){observed.push(options);return {ok:true};},
  }});
  for (const query of ['limit=200','page_size=200&cursor=resume&generation=current','page_size=50','']) {
    const response = await bounded.fetch(new Request('https://ushso.org/api/catalog?'+query),env);
    assert.equal(response.status,200);
  }
  assert.deepEqual(observed.map(row=>row.page_size),[100,100,50,20]);
  assert.equal(observed[1].cursor,'resume');
  assert.equal(observed[1].generation,'current');
});
