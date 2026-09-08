import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../worker/index.mjs';

const knownId = 'obs:asset:luna/known-record';
let openRequestCount = 0;
const publicQueryService = {
  async openRequest() {
    openRequestCount += 1;
    return { fixture: true };
  },
  async dataset(_session, recordId) {
    return recordId === knownId ? { record_id: recordId, title: 'fixture record' } : null;
  },
};
const worker = createWorker({
  loadCatalog: async () => ({}),
  publicQueryService,
});
const env = { ASSETS: { fetch: async () => new Response('{}') } };

async function call(path, method = 'GET') {
  const response = await worker.fetch(new Request(`https://ushso.test${path}`, { method }), env);
  const text = await response.text();
  return { response, body: JSON.parse(text) };
}

test('malformed dataset identifier is a typed 400 and does not open the catalog', async () => {
  openRequestCount = 0;
  const { response, body } = await call('/api/datasets/%E0%A4%A');
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'invalid_record_id');
  assert.equal(openRequestCount, 0);
});

test('valid encoded dataset identifier remains a 200 result', async () => {
  const { response, body } = await call(`/api/datasets/${encodeURIComponent(knownId)}`);
  assert.equal(response.status, 200);
  assert.deepEqual(body, { record_id: knownId, title: 'fixture record' });
});

test('well-formed unknown dataset identifier remains a typed 404', async () => {
  const { response, body } = await call('/api/datasets/obs%3Aasset%3Aluna%3Aunknown-record');
  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'dataset_not_found');
});

test('malformed dataset HEAD is a typed status without a response body or catalog lookup', async () => {
  openRequestCount = 0;
  const response = await worker.fetch(new Request('https://ushso.test/api/datasets/%E0%A4%A', { method: 'HEAD' }), env);
  assert.equal(response.status, 400);
  assert.equal(await response.text(), '');
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(openRequestCount, 0);
});
