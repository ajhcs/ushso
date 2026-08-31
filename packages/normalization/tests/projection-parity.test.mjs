import assert from 'node:assert/strict';
import test from 'node:test';
import { createStaticPublicationReadContext } from '../../registry/publication-read-context.mjs';
import { StaticAssetCatalogRepository } from '../../registry/static-asset-catalog-repository.mjs';
import { loadLegacyCorpus } from '../src/legacy-loader.mjs';
import { normalizeLegacyCorpus } from '../src/normalize.mjs';
import { DatabaseBackedV1ProjectionRepository } from '../src/projection.mjs';
import { InMemoryCanonicalImportStore } from '../src/store.mjs';

const legacy = await loadLegacyCorpus();
const normalized = normalizeLegacyCorpus(legacy);
const store = new InMemoryCanonicalImportStore();
store.apply(normalized.importDocument);
const publication = createStaticPublicationReadContext(legacy.corpus);
const staticRepository = new StaticAssetCatalogRepository({ loadCatalog: async () => ({
  records: legacy.records, searchDocuments: legacy.searchDocuments, joinRoutes: legacy.joinRoutes, corpus: legacy.corpus
}) });
const databaseRepository = new DatabaseBackedV1ProjectionRepository({ readProjection: async () => store.projection(normalized.import_id) });

test('database projection preserves catalog summary, stable public IDs, access, evidence, and browse ordering', async () => {
  const options = { publication };
  assert.deepEqual(await databaseRepository.getCatalogSummary(options), await staticRepository.getCatalogSummary(options));
  assert.deepEqual(await databaseRepository.browseAssets({ ...options, limit: 157 }), await staticRepository.browseAssets({ ...options, limit: 157 }));
  for (const record of legacy.records) {
    const projected = await databaseRepository.getAsset({ ...options, publicId: record.record_id });
    assert.equal(projected.record_id, record.record_id);
    assert.deepEqual(projected.access, record.access);
    assert.deepEqual(projected.evidence, record.evidence);
  }
});

test('database projection preserves all 14 joins and record-filter semantics', async () => {
  const options = { publication };
  assert.deepEqual(await databaseRepository.getJoinRoutes(options), await staticRepository.getJoinRoutes(options));
  for (const record of legacy.records) {
    assert.deepEqual(
      await databaseRepository.getJoinRoutes({ ...options, recordId: record.record_id }),
      await staticRepository.getJoinRoutes({ ...options, recordId: record.record_id })
    );
  }
});

test('database projection preserves search documents, warnings, and zero-result non-absence semantics', async () => {
  assert.deepEqual(await databaseRepository.getSearchDocuments({ publication }), legacy.searchDocuments);
  assert.ok(legacy.searchDocuments.every(row => /denormalized retrieval view/iu.test(row.projection_warning)));
  assert.deepEqual(await databaseRepository.zeroResultSemantics({ publication }), {
    status: 200,
    result_count: 0,
    absence_claim_permitted: false,
    warnings: ['Zero results are not evidence that no source exists.']
  });
});

test('unknown public IDs remain null and rejected batches cannot be read', async () => {
  assert.equal(await databaseRepository.getAsset({ publication, publicId: 'does-not-exist' }), null);
  store.rejectBatch(normalized.import_id, { reason: 'projection rejection test', auditEventId: 'audit:test:projection-reject', recordedAt: '2026-08-30T19:00:00.000Z' });
  await assert.rejects(() => databaseRepository.getCatalogSummary({ publication }), /does not match publication context/u);
});
