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
