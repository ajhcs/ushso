import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRetrievalEngine } from '../packages/retrieval/tools/retrieval-core-v1.2.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/direct-base-input.json', import.meta.url)));
const { corpus, record, vocabulary } = fixture;

function accessRecord(recordId, title, status, requirements) {
  return {
    ...structuredClone(record),
    record_id: recordId,
    title,
    access: {
      ...structuredClone(record.access),
      status,
      requirements
    }
  };
}

const rows = [
  accessRecord('fixture:access-public-direct', 'Pulmonary public dataset', 'public_direct', ['none']),
  accessRecord('fixture:access-public-catalog', 'Pulmonary catalog dataset', 'public_catalog', ['Verify current publisher terms before retrieving any dataset payload.']),
  accessRecord('fixture:access-licensed-paid', 'Pulmonary licensed dataset', 'licensed_paid', ['payment'])
];

function createFixtureEngine() {
  const engineRows = structuredClone(rows);
  return createRetrievalEngine({
    records: engineRows,
    searchDocuments: null,
    vocabulary: structuredClone(vocabulary),
    corpus: structuredClone(corpus),
    joinRoutes: [],
    catalogValidation: { valid: engineRows, invalid: [] }
  });
}

const queries = [
  { question: 'pulmonary', sort: 'title_asc', page_size: 10, include_restricted: false },
  { question: 'pulmonary public data', sort: 'title_asc', page_size: 10, include_restricted: false },
  { question: 'pulmonary free data', sort: 'title_asc', page_size: 10, include_restricted: false },
  { question: 'pulmonary', sort: 'title_asc', page_size: 10, include_restricted: true, access_statuses: ['licensed_paid'] },
  { question: 'pulmonary', sort: 'title_asc', page_size: 10, include_restricted: false, access_statuses: ['licensed_paid'] }
];

test('access cache preserves ordinary, public, free, and restricted response semantics', () => {
  const engine = createFixtureEngine();
  // Start with an ordinary request so the later public/free/restricted paths
  // exercise both request scoring and already-populated response metadata.
  const results = queries.map(query => engine.retrieve(query));

  assert.equal(results[0].results.length, 2, 'explicit restricted exclusion omits the licensed record');
  assert.equal(results[1].results.length, 2, 'public intent retains unknown public-catalog evidence');
  assert.equal(results[2].results.length, 2, 'documented-free intent retains unknown cost evidence');
  assert.deepEqual(results[3].ranking.ordered_ids, ['fixture:access-licensed-paid']);
  assert.equal(results[4].results.length, 0, 'restricted status remains excluded without include_restricted');

  const publicAccess = results[1].results.find(item => item.record_id === 'fixture:access-public-direct').metadata.access;
  const freeAccess = results[2].results.find(item => item.record_id === 'fixture:access-public-direct').metadata.access;
  const paidAccess = results[3].results[0].metadata.access;
  assert.equal(publicAccess.payload_access, 'documented_public');
  assert.equal(publicAccess.cost_state, 'documented_free');
  assert.equal(freeAccess.cost_state, 'documented_free');
  assert.equal(paidAccess.payload_access, 'documented_restricted');
  assert.equal(paidAccess.cost_state, 'payment_required');
});

test('access metadata stays isolated from response, engine, and input mutation', () => {
  const engineA = createFixtureEngine();
  const engineB = createFixtureEngine();
  const query = { question: 'pulmonary public data', sort: 'title_asc', page_size: 10 };
  const sourceBefore = JSON.stringify(rows);
  const first = engineA.retrieve(query);
  const expectedAccess = JSON.stringify(first.results[0].metadata.access);
  assert.equal(JSON.stringify(engineB.retrieve(query).results[0].metadata.access), expectedAccess);

  first.results[0].metadata.access.payload_access = 'test-only-mutation';
  first.results[0].metadata.access.cost_state = 'test-only-mutation';
  first.results[0].record.title = 'test-only-record-mutation';

  assert.equal(JSON.stringify(engineA.retrieve(query).results[0].metadata.access), expectedAccess);
  assert.equal(JSON.stringify(engineB.retrieve(query).results[0].metadata.access), expectedAccess);
  assert.equal(JSON.stringify(rows), sourceBefore);
});

test('access metadata remains byte-stable across cursor continuation and browse output', () => {
  const engineA = createFixtureEngine();
  const engineB = createFixtureEngine();
  const query = { question: 'pulmonary', sort: 'title_asc', page_size: 1, include_restricted: true };
  const firstA = engineA.retrieve(query);
  const firstB = engineB.retrieve(query);
  assert.equal(JSON.stringify(firstA), JSON.stringify(firstB));
  assert.ok(firstA.pagination.next_cursor, 'fixture must produce a continuation cursor');
  const nextQuery = { ...query, cursor: firstA.pagination.next_cursor };
  assert.equal(JSON.stringify(engineA.retrieve(nextQuery)), JSON.stringify(engineB.retrieve({ ...query, cursor: firstB.pagination.next_cursor })));

  const browseA = engineA.browse({ sort: 'title_asc', page_size: 3 });
  const browseB = engineB.browse({ sort: 'title_asc', page_size: 3 });
  assert.equal(JSON.stringify(browseA), JSON.stringify(browseB));
  assert.equal(browseA.results.length, 3);
});
