import assert from 'node:assert/strict';
import test from 'node:test';
import { contentFingerprint } from '../src/canonical.mjs';
import { loadLegacyCorpus } from '../src/legacy-loader.mjs';
import { normalizeLegacyCorpus } from '../src/normalize.mjs';
import { InMemoryCanonicalImportStore } from '../src/store.mjs';

const normalized = normalizeLegacyCorpus(await loadLegacyCorpus());

test('exact replay creates zero logical rows', () => {
  const store = new InMemoryCanonicalImportStore();
  const first = store.apply(normalized.importDocument);
  const replay = store.apply(normalized.importDocument);
  assert.equal(first.status, 'applied');
  assert.ok(first.new_logical_rows > 0);
  assert.deepEqual(replay, { status: 'already_applied', import_id: normalized.import_id, new_logical_rows: 0, state: 'applied' });
});

test('same import ID with changed content fails closed', () => {
  const store = new InMemoryCanonicalImportStore();
  store.apply(normalized.importDocument);
  const changed = structuredClone(normalized.importDocument);
  changed.legacy_projection.records[0].title = 'tampered';
  changed.document_fingerprint = contentFingerprint({ ...changed, document_fingerprint: null });
  assert.throws(() => store.apply(changed), /IMPORT_ID_CONTENT_CONFLICT/u);
});

test('permanent alias collision rolls the entire transaction back', () => {
  const store = new InMemoryCanonicalImportStore();
  const changed = structuredClone(normalized.importDocument);
  changed.bundle.assets[1].legacy_aliases.push(changed.bundle.assets[0].legacy_aliases[0]);
  changed.document_fingerprint = contentFingerprint({ ...changed, document_fingerprint: null });
  assert.throws(() => store.apply(changed), /LEGACY_ALIAS_CONFLICT/u);
  const after = store.snapshot();
  assert.equal(after.batches.size, 0);
  assert.equal(after.entities.size, 0);
  assert.equal(after.revisions.size, 0);
  assert.equal(after.aliases.size, 0);
});

test('batch rejection is audited, non-destructive, and disables projection', () => {
  const store = new InMemoryCanonicalImportStore();
  store.apply(normalized.importDocument);
  const before = store.snapshot();
  const result = store.rejectBatch(normalized.import_id, {
    reason: 'rollback rehearsal', auditEventId: 'audit:test:rollback', recordedAt: '2026-08-30T19:00:00.000Z'
  });
  const after = store.snapshot();
  assert.equal(result.status, 'rejected');
  assert.equal(result.deleted_rows, 0);
  assert.equal(after.entities.size, before.entities.size);
  assert.equal(after.revisions.size, before.revisions.size);
  assert.equal(after.aliases.size, before.aliases.size);
  assert.equal(result.preserved_projection_for_audit, true);
  assert.equal(store.projection(normalized.import_id), null);
  assert.ok(after.batchEvents.some(event => event.to_state === 'rejected'));
  assert.throws(() => store.apply(normalized.importDocument), /REJECTED_IMPORT_CANNOT_BE_REAPPLIED/u);
});
