import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, projectionDocumentMaterial } from '../../../../contracts/publication/v1.0.0/tools/common.mjs';
import {
  SEARCH_PROJECTION_TYPES,
  buildProjectionGeneration,
  buildProjectionDocument,
  mergeIncrementalProjectionChunks,
  reconcileProjectionGeneration,
  sealProjectionGeneration,
} from '../../../../packages/search/projection-v2.mjs';
import {
  buildSearchComponents,
  createCanonicalManifest,
  createProjectionRecords,
  createReferenceInventory,
  fixtureTimes,
} from '../tools/fixture.mjs';

test('all five search projection types use the complete non-authoritative envelope', () => {
  const fixture = buildSearchComponents();
  assert.deepEqual(Object.keys(fixture.components).sort(), [...SEARCH_PROJECTION_TYPES].sort());
  for (const kind of SEARCH_PROJECTION_TYPES) {
    const sealed = fixture.components[kind];
    assert.equal(sealed.reconciliation.status, 'PASS');
    assert.equal(sealed.component.sealed_state, 'validated');
    assert.equal(sealed.component.build_strategy, 'complete_as_of_exact_revision_manifest');
    assert.equal(sealed.component.acknowledgement_count, sealed.reconciliation.expected_obligations);
    for (const document of sealed.documents) {
      assert.equal(document.document_type, kind);
      assert.equal(document.source_of_truth, false);
      assert.equal(document.immutable, true);
      assert.equal(document.visibility_state, 'public');
      assert.ok(document.projection_input_refs.length > 0);
      assert.ok(Object.values(document.truth_refs).flat().length > 0);
      assert.equal(document.document_checksum.value, digest('projection_document', projectionDocumentMaterial(document)).value);
    }
  }
});

test('quarantined membership is acknowledged as excluded and never becomes a document', () => {
  const asset = buildSearchComponents().components.asset_search;
  const acknowledgement = asset.acknowledgements.find(item => item.canonical_id === 'asset:quarantined-fixture');
  assert.equal(acknowledgement.result, 'excluded');
  assert.equal(acknowledgement.exclusion.reason_code, 'quarantined');
  assert.equal(acknowledgement.exclusion.absence_claim_permitted, false);
  assert.deepEqual(acknowledgement.document_refs, []);
  assert.equal(asset.documents.some(item => item.canonical_revisions.some(ref => ref.canonical_id === acknowledgement.canonical_id)), false);
});

test('unresolved identity candidates remain separate searchable documents', () => {
  const documents = buildSearchComponents().components.asset_search.documents;
  const accepted = documents.find(item => item.content.asset_id === 'asset:pa-hospital-finance');
  const candidate = documents.find(item => item.content.asset_id === 'asset:pa-hospital-finance-candidate');
  assert.ok(accepted);
  assert.ok(candidate);
  assert.notEqual(accepted.document_id, candidate.document_id);
  assert.equal(candidate.content.identity_resolution_state, 'open_candidate');
  assert.equal(candidate.content.family_state, 'candidate_unresolved');
});

test('same W1 and projector produce identical document and component checksums', () => {
  const first = buildSearchComponents({ suffix: 'first' });
  const reorderedRecords = createProjectionRecords().reverse().map(record => {
    const copy = structuredClone(record);
    if (Array.isArray(copy.content?.subjects)) copy.content.subjects.reverse();
    if (Array.isArray(copy.content?.geographies)) copy.content.geographies.reverse();
    return copy;
  });
  const second = buildSearchComponents({ suffix: 'second', records: reorderedRecords });
  for (const kind of SEARCH_PROJECTION_TYPES) {
    assert.deepEqual(
      first.components[kind].documents.map(item => item.document_checksum.value),
      second.components[kind].documents.map(item => item.document_checksum.value),
    );
    assert.equal(first.components[kind].component.component_checksum.value, second.components[kind].component.component_checksum.value);
  }
});

test('incremental chunks converge byte-for-byte to the complete full projection', () => {
  const canonicalManifest = createCanonicalManifest();
  const records = createProjectionRecords();
  const full = buildProjectionGeneration({
    generationId: 'generation:asset_search:convergence',
    componentKind: 'asset_search',
    canonicalManifest,
    records,
    projectedAt: fixtureTimes.PROJECTED_AT,
  });
  const chunks = [
    { ...full, documents: full.documents.slice(0, 1), acknowledgements: full.acknowledgements.slice(0, 2) },
    { ...full, documents: full.documents.slice(1), acknowledgements: full.acknowledgements.slice(2) },
  ];
  const merged = mergeIncrementalProjectionChunks(chunks);
  assert.deepEqual(merged.documents, full.documents);
  assert.deepEqual(merged.acknowledgements, full.acknowledgements);
  const fixture = buildSearchComponents({ suffix: 'convergence' });
  const sealed = sealProjectionGeneration({
    build: merged,
    canonicalManifestRef: fixture.canonicalManifestRef,
    referenceInventory: createReferenceInventory(records),
    canonicalManifest,
    projectorFingerprint: fixture.projectorFingerprint,
    sealedAt: fixtureTimes.PROJECTED_AT,
    retainedUntil: fixtureTimes.RETAINED_UNTIL,
  });
  assert.equal(sealed.component.component_checksum.value, fixture.components.asset_search.component.component_checksum.value);
});

test('missing acknowledgements, unresolved truth references, and forbidden analytics fail closed', () => {
  const canonicalManifest = createCanonicalManifest();
  const records = createProjectionRecords();
  const missing = buildProjectionGeneration({
    generationId: 'generation:asset_search:missing',
    componentKind: 'asset_search',
    canonicalManifest,
    records: records.filter(record => record.canonical_id !== 'asset:pa-hospital-finance'),
    projectedAt: fixtureTimes.PROJECTED_AT,
  });
  const missingResult = reconcileProjectionGeneration({
    build: missing,
    canonicalManifest,
    referenceInventory: createReferenceInventory(records),
  });
  assert.equal(missingResult.status, 'FAIL');
  assert.ok(missingResult.findings.some(item => item.code === 'PROJECTION_OBLIGATION_ACK_COUNT_INVALID'));

  const complete = buildProjectionGeneration({
    generationId: 'generation:asset_search:bad-reference',
    componentKind: 'asset_search',
    canonicalManifest,
    records,
    projectedAt: fixtureTimes.PROJECTED_AT,
  });
  const unresolved = reconcileProjectionGeneration({
    build: complete,
    canonicalManifest,
    referenceInventory: { evidence: [], assertions: [], access_observations: [], documentation: [], relationships: [] },
  });
  assert.ok(unresolved.findings.some(item => item.code === 'TRUTH_REFERENCE_UNRESOLVED'));

  const asset = records.find(record => record.document_type === 'asset_search');
  const forbidden = structuredClone(asset);
  forbidden.content.access_summary.market_share = 0.5;
  assert.throws(() => buildProjectionDocument({
    generationId: 'generation:asset_search:forbidden',
    documentId: forbidden.document_id,
    documentType: forbidden.document_type,
    projectedAt: fixtureTimes.PROJECTED_AT,
    canonicalRevisions: [{
      canonical_id: forbidden.canonical_id,
      revision_id: forbidden.revision_id,
      revision_sha256: canonicalManifest.members.find(member => member.canonical_id === forbidden.canonical_id).revision_sha256,
    }],
    projectionInputRefs: forbidden.projection_input_refs,
    truthRefs: forbidden.truth_refs,
    content: forbidden.content,
  }), error => error.code === 'PROJECTION_PRODUCT_BOUNDARY_VIOLATION');

  const tamperedManifest = structuredClone(canonicalManifest);
  tamperedManifest.members[0].revision_sha256 = 'f'.repeat(64);
  assert.throws(() => buildProjectionGeneration({
    generationId: 'generation:asset_search:tampered-w1',
    componentKind: 'asset_search',
    canonicalManifest: tamperedManifest,
    records,
    projectedAt: fixtureTimes.PROJECTED_AT,
  }), error => error.code === 'CANONICAL_MANIFEST_DIGEST_MISMATCH');

  const outsideW1 = [...records, {
    canonical_id: 'asset:not-in-w1',
    revision_id: 'revision:asset:not-in-w1:v1',
    document_id: 'document:asset:not-in-w1',
    document_type: 'asset_search',
  }];
  assert.throws(() => buildProjectionGeneration({
    generationId: 'generation:asset_search:outside-w1',
    componentKind: 'asset_search',
    canonicalManifest,
    records: outsideW1,
    projectedAt: fixtureTimes.PROJECTED_AT,
  }), error => error.code === 'PROJECTION_RECORD_OUTSIDE_W1');
});
