import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { queryFromSearchReceipt, compareSearchReceiptReplay } from '../packages/retrieval/tools/search-receipt-replay.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:8794';
const output = process.argv[3];
assert.ok(output, 'output receipt path required');
const post = async query => {
  const response = await fetch(`${base}/api/discover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(query) });
  return { status: response.status, body: await response.json() };
};
const checks = [];
for (const sort of ['canonical_relevance', 'title_asc', 'release_newest', 'observation_latest']) {
  const first = await post({ question: 'hospital', page_size: 2, sort });
  assert.equal(first.status, 200); assert.equal(first.body.corpus.record_count, 3434);
  const next = await post({ question: 'hospital', page_size: 2, sort, cursor: first.body.pagination.next_cursor });
  assert.equal(next.status, 200);
  for (const [page, response] of [[1, first.body], [2, next.body]]) {
    // Mirror the browser export's traversal field, then cross a JSON file boundary.
    const receipt = JSON.parse(JSON.stringify({ ...response.receipt, filters: { ...response.receipt.filters, traversal: { cursor: response.pagination.cursor, page_size: response.pagination.page_size } } }));
    const request = queryFromSearchReceipt(receipt);
    const replay = await post(request);
    assert.equal(replay.status, 200);
    assert.equal(compareSearchReceiptReplay(receipt, replay.body).status, 'reproduced');
    const unavailableReceipt = { ...receipt, catalog_generation: `unavailable-${receipt.catalog_generation}` };
    const unavailable = await post(queryFromSearchReceipt(unavailableReceipt));
    assert.notEqual(unavailable.status, 200);
    assert.ok(JSON.stringify(unavailable.body).includes('generation_unavailable'));
    checks.push({ sort, page, original_receipt: receipt, reproduced: true, unavailable_generation_response: unavailable, no_unpinned_retry: true });
  }
}
await fs.writeFile(output, JSON.stringify({ generated_at: new Date().toISOString(), base, status: 'PASS', production_record_count: 3434, checks, limitations: ['Tests explicit machine replay and fail-closed generation rejection; no file-picker UI is implemented.', 'Changed-generation engine behavior is additionally covered by unit fixtures.'] }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: 'PASS', page_sort_cases: checks.length, checks: checks.length * 2 }));
