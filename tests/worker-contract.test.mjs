import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../worker/index.mjs';

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
  interpret() { return { compiler: { mode: 'deterministic_controlled_vocabulary', llm_used: false, external_requests: 0 } }; },
  retrieve(input) {
    if (typeof input?.question !== 'string') throw new TypeError('question is required');
    return { ...result, query: { ...result.query, question: input.question } };
  }
};
const worker = createWorker({ loadEngine: async () => engine });
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
