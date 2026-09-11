import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { validateCatalogRecords } from '../../packages/retrieval/tools/catalog-contract.mjs';
import { createRetrievalEngine } from '../../packages/retrieval/tools/retrieval-core-v1.2.mjs';

const root = new URL('../../', import.meta.url);
const expectedIsolated = [
  {
    record_id: 'obs:asset:cdc-socrata:2g2d-yfx9-060a56b0e1f5e82b',
    sha256: '073c287c854e0af71ea3a8726f91cbd46141aff1bcad2f6d3aae9c53eec5508e',
  },
  {
    record_id: 'obs:asset:cdc-socrata:38b4-r9iv-82269ee71b664250',
    sha256: '6003e6e4e1cba5f4a5b2c6345d620724187e1ce05f1e66cdff8d722b5d2d5f55',
  },
  {
    record_id: 'obs:asset:cdc-socrata:4ckf-c7xz-8a5026e46b58641e',
    sha256: 'd2ada7f1012264a537f073c6d92e53a507b48b7e641890ce111338b147db2f6f',
  },
  {
    record_id: 'obs:asset:cdc-socrata:va9e-d8re-c845d9bfb921e339',
    sha256: '53289cfe2572e82d67c205f0a49c91fbc47a0512ba428b43a2052ff967b261de',
  },
];
const isolationReason = 'description must be a non-empty string';

async function loadV12Corpus() {
  const corpus = JSON.parse(await fs.readFile(new URL('packages/retrieval/versions/v1.2.0/corpus/corpus.json', root)));
  const records = [];
  for (const filename of corpus.record_files) {
    const lines = (await fs.readFile(new URL(`packages/retrieval/versions/v1.2.0/corpus/${filename}`, root), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
    records.push(...lines.map((line) => JSON.parse(line)));
  }
  return { corpus, records };
}

test('C0061 retains the frozen 3434 baseline and isolates exactly four CDC records', async () => {
  const [{ corpus, records }, cohorts, evidence] = await Promise.all([
    loadV12Corpus(),
    fs.readFile(new URL('evaluation/research-program/cohorts.json', root), 'utf8').then(JSON.parse),
    fs.readFile(new URL('verification/research-program/pr-004/evidence.json', root), 'utf8').then(JSON.parse),
  ]);
  const baselineIds = cohorts.baseline_records.map((row) => row.record_id);
  const evidenceIds = evidence.source_identities.corpus.isolated_records.map((row) => row.record_id);
  const expectedIds = expectedIsolated.map((row) => row.record_id);

  assert.equal(corpus.record_count, 3434);
  assert.equal(records.length, 3434);
  assert.equal(new Set(records.map((row) => row.record_id)).size, 3434);
  assert.deepEqual(new Set(records.map((row) => row.record_id)), new Set(baselineIds));
  assert.deepEqual(evidenceIds, expectedIds);
  assert.deepEqual(cohorts.corpus.isolated_record_ids, expectedIds);
  assert.equal(cohorts.baseline_records.filter((row) => row.isolated).length, 4);

  const byId = new Map(records.map((row) => [row.record_id, row]));
  for (const expected of expectedIsolated) {
    const record = byId.get(expected.record_id);
    assert.ok(record, expected.record_id);
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex'), expected.sha256);
    assert.equal(record.description, '');
  }

  const validation = validateCatalogRecords(records);
  assert.equal(validation.valid.length, 3430);
  assert.equal(validation.invalid.length, 4);
  assert.deepEqual(validation.invalid.map((row) => ({
    record_id: row.record_id,
    errors: row.errors,
  })), expectedIsolated.map(({ record_id }) => ({ record_id, errors: [isolationReason] })));

  const vocabulary = JSON.parse(await fs.readFile(new URL('packages/retrieval/fixtures/controlled-vocabulary.json', root)));
  const engine = createRetrievalEngine({
    records,
    searchDocuments: null,
    vocabulary,
    joinRoutes: [],
    corpus,
    catalogValidation: validation,
  });
  const response = engine.browse({ page_size: 1 });
  assert.equal(response.corpus.record_count, 3434);
  assert.equal(response.pagination.total_matches, 3430);
  assert.equal(response.partial_results.invalid_item_count, 4);
  assert.equal(response.partial_results.is_partial, true);
  assert.deepEqual(response.partial_results.issues.map((row) => row.record_id), expectedIds);
  assert.equal(response.results.some((row) => expectedIds.includes(row.record_id)), false);
});
