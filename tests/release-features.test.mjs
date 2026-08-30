import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyLiveVerificationReceipt } from '../worker/live-verification.mjs';
import { createRetrievalEngine } from '../worker/retrieval-v1.1.0.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const readJsonl = path => readFileSync(join(root, path), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);

test('production verification receipt enriches exactly its 15 matched corpus records', () => {
  const records = readJsonl('packages/retrieval/corpus/records.jsonl');
  const receipt = readJson('verification/v0.1.0/receipts/live-verification-2026-08-30.json');
  const enriched = applyLiveVerificationReceipt(records, receipt);
  const receiptIds = new Set(receipt.records.map(record => record.record_id));
  const verified = enriched.filter(record => record.freshness_verification.verification_method === 'first_party_live');

  assert.equal(enriched.length, 143);
  assert.equal(receiptIds.size, 15);
  assert.equal(verified.length, 15);
  assert.ok(verified.every(record => receiptIds.has(record.record_id) && record.variable_documentation?.evidence_state === 'verified_first_party'));
  assert.ok(records.every(record => record.variable_documentation === undefined));
});

test('production runtime retrieval recovers a bounded hospital title typo', () => {
  const engine = createRetrievalEngine({
    records: readJsonl('packages/retrieval/corpus/records.jsonl'),
    searchDocuments: readJsonl('packages/retrieval/corpus/search-documents.jsonl'),
    joinRoutes: readJsonl('packages/retrieval/corpus/join-routes.jsonl'),
    vocabulary: readJson('packages/retrieval/fixtures/controlled-vocabulary.json'),
    corpus: readJson('packages/retrieval/corpus/corpus.json')
  });
  const result = engine.retrieve({ question: 'hopsital closures', limit: 10 });

  assert.equal(result.results[0].record_id, 'obs:asset:unc-sheps-rural-hospital-closures');
  assert.ok(result.results[0].relevance.score_components.some(component => component.reason.includes('hopsital~hospital')));
});
