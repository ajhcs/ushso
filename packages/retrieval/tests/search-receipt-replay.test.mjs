import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { createRetrievalEngine } from '../tools/retrieval-core-v1.2.mjs';
import { queryFromSearchReceipt, compareSearchReceiptReplay } from '../tools/search-receipt-replay.mjs';
const json = async relative => JSON.parse(await fs.readFile(new URL(relative, import.meta.url), 'utf8'));
const records = (await fs.readFile(new URL('../corpus/records.jsonl', import.meta.url), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
const vocabulary = await json('../fixtures/controlled-vocabulary.json');
const corpus = await json('../corpus/corpus.json');
const a = createRetrievalEngine({ records, vocabulary, corpus: { ...corpus, manifest_sha256: 'generation-a' } });
const b = createRetrievalEngine({ records, vocabulary, corpus: { ...corpus, manifest_sha256: 'generation-b' } });
test('receipt roundtrip preserves generation, order, filters and later-page cursor', () => {
  for (const sort of ['canonical_relevance', 'title_asc', 'release_newest', 'observation_latest']) {
    const first = a.retrieve({ question: 'hospital', page_size: 2, sort });
    assert.ok(first.pagination.next_cursor);
    const second = a.retrieve({ question: 'hospital', page_size: 2, sort, cursor: first.pagination.next_cursor });
    for (const response of [first, second]) {
      const receipt = JSON.parse(JSON.stringify(response.receipt));
      const query = queryFromSearchReceipt(receipt);
      const replay = a.retrieve(query);
      assert.equal(compareSearchReceiptReplay(receipt, replay).status, 'reproduced');
      assert.equal(query.generation, 'generation-a');
      assert.throws(() => b.retrieve(query), error => error.code === 'generation_unavailable');
    }
    const other = b.retrieve({ question: 'hospital', page_size: 2, sort });
    assert.equal(compareSearchReceiptReplay(first.receipt, other).code, 'generation_mismatch');
    assert.equal(compareSearchReceiptReplay(first.receipt, { ...first, ranking: { ...first.ranking, version: 'new-ranker' } }).code, 'ranking_version_mismatch');
    assert.equal(compareSearchReceiptReplay(first.receipt, { ...first, results: [...first.results].reverse() }).code, 'displayed_order_mismatch');
  }
});
test('malformed receipts cannot silently become new unpinned searches', () => {
  assert.throws(() => queryFromSearchReceipt({}), /invalid_search_receipt/);
  const receipt = a.retrieve({ question: 'hospital', page_size: 2 }).receipt;
  assert.throws(() => queryFromSearchReceipt({ ...receipt, catalog_generation: '' }), /invalid_search_receipt/);
  const missingPage = structuredClone(receipt); delete missingPage.filters.page_size; delete missingPage.filters.limit;
  assert.throws(() => queryFromSearchReceipt(missingPage), /receipt_page_size_missing/);
});
