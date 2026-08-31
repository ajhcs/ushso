import assert from 'node:assert/strict';
import test from 'node:test';

import { digest } from '../../../../contracts/publication/v1.0.0/tools/common.mjs';
import {
  buildPromotionEvidenceReceipt,
  InMemoryPublicationLedger,
  REQUIRED_PROMOTION_GATES,
  buildPublicationManifest,
} from '../../../../packages/search/publication-lifecycle-v2.mjs';
import {
  buildSearchComponents,
  externalValidatedComponent,
  fixtureBuildReceiptDigest,
  fixtureTimes,
} from '../tools/fixture.mjs';

const AUTHORIZATION = Object.freeze({ scope: 'offline_rehearsal', external_cutover_authorized: false });

function gates(publication) {
  return REQUIRED_PROMOTION_GATES.map(gate => ({
    gate,
    status: 'passed',
    evidence_refs: [buildPromotionEvidenceReceipt({
      evidenceId: `fixture:evidence:${gate}:${publication.publication_id}`,
      gate,
      publication,
      issuedAt: '2026-08-30T22:00:00.000Z',
      expiresAt: '2026-10-01T00:00:00.000Z',
    })],
  }));
}

function registerComponents(ledger, suffix) {
  const fixture = buildSearchComponents({ suffix });
  const components = [
    ...Object.values(fixture.components).map(item => item.component),
    externalValidatedComponent({ kind: 'seo', suffix, canonicalManifestRef: fixture.canonicalManifestRef }),
    externalValidatedComponent({ kind: 'coverage', suffix, canonicalManifestRef: fixture.canonicalManifestRef }),
  ];
  for (const component of components) {
    ledger.beginGeneration({
      generationId: component.generation_id,
      componentKind: component.component_kind,
      canonicalManifestId: fixture.canonicalManifest.manifest_id,
      retainedUntil: fixtureTimes.RETAINED_UNTIL,
      occurredAt: '2026-08-30T21:57:00.000Z',
      transactionId: `transaction:begin:${component.generation_id}`,
    });
    ledger.validateGeneration({
      component,
      occurredAt: fixtureTimes.PROJECTED_AT,
      transactionId: `transaction:validate:${component.generation_id}`,
    });
  }
  return { fixture, components };
}

function createPublication({ fixture, components, suffix, previous = null }) {
  return buildPublicationManifest({
    publicationId: `publication:wp8-fixture:${suffix}`,
    canonicalManifestRef: fixture.canonicalManifestRef,
    canonicalAsOf: fixture.canonicalManifest.canonical_as_of,
    componentGenerationRefs: components.map(component => ({
      component_kind: component.component_kind,
      generation_id: component.generation_id,
      manifest_digest: component.component_checksum,
    })),
    coverageSnapshotId: `coverage-snapshot:wp8-fixture:${suffix}`,
    buildReceiptRef: `build-receipt:wp8-fixture:${suffix}`,
    buildReceiptDigest: fixtureBuildReceiptDigest(suffix),
    previousPublicationRef: previous,
    nMinusOneWorker: previous ? {
      worker_version: '1.0.0',
      artifact_sha256: 'a'.repeat(64),
      supported_publication_contract: '1.0.0',
    } : null,
    staticCompatibilityRef: {
      manifest_id: 'legacy-static:wp1-fixture',
      manifest_digest: digest('legacy_static_compatibility', { fixture: 'wp1-static' }),
    },
    sealedAt: '2026-08-30T22:01:00.000Z',
    rollbackEligibleUntil: fixtureTimes.RETAINED_UNTIL,
  });
}

function publicationRef(publication) {
  return { publication_id: publication.publication_id, manifest_digest: publication.publication_digest };
}

test('atomic promotion writes history, generation states, and singleton pointer coherently', () => {
  const ledger = new InMemoryPublicationLedger();
  const { fixture, components } = registerComponents(ledger, 'a');
  const publication = createPublication({ fixture, components, suffix: 'a' });
  ledger.registerPublication(publication);
  const pointer = ledger.promote({
    publicationId: publication.publication_id,
    gates: gates(publication),
    authorization: AUTHORIZATION,
    occurredAt: '2026-08-30T22:02:00.000Z',
    transactionId: 'transaction:promote:a',
  });
  assert.equal(pointer.sequence, 1);
  assert.equal(pointer.active_publication_ref.publication_id, publication.publication_id);
  assert.equal(pointer.previous_publication_ref, null);
  assert.equal(pointer.atomic_commit, true);
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.publication_history.length, 1);
  assert.ok([...snapshot.generations.values()].every(generation => generation.state === 'published'));
  assert.ok([...snapshot.generations.values()].every(generation => generation.lifecycle.at(-1).transaction_id === pointer.transaction_id));
});

test('promotion rejects opaque or cross-publication gate evidence', () => {
  const ledger = new InMemoryPublicationLedger();
  const { fixture, components } = registerComponents(ledger, 'evidence');
  const publication = createPublication({ fixture, components, suffix: 'evidence' });
  ledger.registerPublication(publication);

  const opaque = gates(publication);
  opaque[0].evidence_refs = ['legacy:opaque-evidence'];
  assert.throws(() => ledger.promote({
    publicationId: publication.publication_id,
    gates: opaque,
    authorization: AUTHORIZATION,
    occurredAt: '2026-08-30T22:02:00.000Z',
    transactionId: 'transaction:promote:opaque',
  }), error => error.code === 'PROMOTION_EVIDENCE_RECEIPT_INVALID');

  const crossPublication = gates(publication);
  crossPublication[0].evidence_refs = [{
    ...crossPublication[0].evidence_refs[0],
    publication_id: 'publication:other-candidate',
  }];
  assert.throws(() => ledger.promote({
    publicationId: publication.publication_id,
    gates: crossPublication,
    authorization: AUTHORIZATION,
    occurredAt: '2026-08-30T22:02:00.000Z',
    transactionId: 'transaction:promote:cross-publication',
  }), error => error.code === 'PROMOTION_EVIDENCE_BINDING_MISMATCH');
});

test('injected failures roll back history, state transitions, and pointer together', () => {
  const ledger = new InMemoryPublicationLedger();
  const first = registerComponents(ledger, 'a');
  const publicationA = createPublication({ ...first, suffix: 'a' });
  ledger.registerPublication(publicationA);
  ledger.promote({
    publicationId: publicationA.publication_id,
    gates: gates(publicationA),
    authorization: AUTHORIZATION,
    occurredAt: '2026-08-30T22:02:00.000Z',
    transactionId: 'transaction:promote:a',
  });
  const second = registerComponents(ledger, 'b');
  const publicationB = createPublication({ ...second, suffix: 'b', previous: publicationRef(publicationA) });
  ledger.registerPublication(publicationB);
  const before = ledger.snapshot();
  assert.throws(() => ledger.promote({
    publicationId: publicationB.publication_id,
    gates: gates(publicationB),
    authorization: AUTHORIZATION,
    occurredAt: '2026-08-30T22:03:00.000Z',
    transactionId: 'transaction:promote:b:fault',
    injectFaultAt: 'before_pointer',
  }), error => error.code === 'INJECTED_PROMOTION_FAILURE');
  const after = ledger.snapshot();
  assert.deepEqual(after.pointer, before.pointer);
  assert.deepEqual(after.publication_history, before.publication_history);
  assert.deepEqual([...after.generations.entries()], [...before.generations.entries()]);
});

test('rejected builds cannot become publication candidates and preserve the live generation', () => {
  const ledger = new InMemoryPublicationLedger();
  const first = registerComponents(ledger, 'a');
  const publicationA = createPublication({ ...first, suffix: 'a' });
  ledger.registerPublication(publicationA);
  ledger.promote({
    publicationId: publicationA.publication_id,
    gates: gates(publicationA),
    authorization: AUTHORIZATION,
    occurredAt: '2026-08-30T22:02:00.000Z',
    transactionId: 'transaction:promote:a',
  });
  ledger.beginGeneration({
    generationId: 'generation:asset_search:failed',
    componentKind: 'asset_search',
    canonicalManifestId: first.fixture.canonicalManifest.manifest_id,
    retainedUntil: fixtureTimes.RETAINED_UNTIL,
    occurredAt: '2026-08-30T22:03:00.000Z',
    transactionId: 'transaction:begin:failed',
  });
  ledger.rejectGeneration({
    generationId: 'generation:asset_search:failed',
    occurredAt: '2026-08-30T22:04:00.000Z',
    transactionId: 'transaction:reject:failed',
  });
  assert.equal(ledger.resolveActivePointer().active_publication_ref.publication_id, publicationA.publication_id);
  assert.equal(ledger.snapshot().generations.get('generation:asset_search:failed').state, 'rejected');
});

test('N-1 pointer rollback restores retained generations without changing canonical history', () => {
  const ledger = new InMemoryPublicationLedger();
  const first = registerComponents(ledger, 'a');
  const publicationA = createPublication({ ...first, suffix: 'a' });
  ledger.registerPublication(publicationA);
  ledger.promote({ publicationId: publicationA.publication_id, gates: gates(publicationA), authorization: AUTHORIZATION, occurredAt: '2026-08-30T22:02:00.000Z', transactionId: 'transaction:promote:a' });
  const second = registerComponents(ledger, 'b');
  const publicationB = createPublication({ ...second, suffix: 'b', previous: publicationRef(publicationA) });
  ledger.registerPublication(publicationB);
  ledger.promote({ publicationId: publicationB.publication_id, gates: gates(publicationB), authorization: AUTHORIZATION, occurredAt: '2026-08-30T22:03:00.000Z', transactionId: 'transaction:promote:b' });
  const third = registerComponents(ledger, 'c');
  const publicationC = createPublication({ ...third, suffix: 'c', previous: publicationRef(publicationB) });
  ledger.registerPublication(publicationC);
  ledger.promote({ publicationId: publicationC.publication_id, gates: gates(publicationC), authorization: AUTHORIZATION, occurredAt: '2026-08-30T22:04:00.000Z', transactionId: 'transaction:promote:c' });
  assert.equal(ledger.resolveActivePointer().active_publication_ref.publication_id, publicationC.publication_id);
  assert.throws(() => ledger.rollback({
    targetPublicationId: publicationA.publication_id,
    authorization: AUTHORIZATION,
    occurredAt: '2026-08-30T22:05:00.000Z',
    transactionId: 'transaction:rollback:not-n-minus-one',
  }), error => error.code === 'ROLLBACK_TARGET_NOT_N_MINUS_ONE');
  const rolledBack = ledger.rollback({
    targetPublicationId: publicationB.publication_id,
    authorization: AUTHORIZATION,
    occurredAt: '2026-08-30T22:05:00.000Z',
    transactionId: 'transaction:rollback:b',
  });
  assert.equal(rolledBack.active_publication_ref.publication_id, publicationB.publication_id);
  assert.equal(rolledBack.previous_publication_ref.publication_id, publicationC.publication_id);
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.publication_history.at(-1).action, 'rollback');
  assert.ok(first.components.every(component => snapshot.generations.get(component.generation_id).state === 'retired'));
  assert.ok(second.components.every(component => snapshot.generations.get(component.generation_id).state === 'published'));
  assert.ok(third.components.every(component => snapshot.generations.get(component.generation_id).state === 'retired'));
});

test('generation pins are served only while retained and non-revoked', () => {
  const ledger = new InMemoryPublicationLedger();
  const first = registerComponents(ledger, 'a');
  const publication = createPublication({ ...first, suffix: 'a' });
  ledger.registerPublication(publication);
  ledger.promote({ publicationId: publication.publication_id, gates: gates(publication), authorization: AUTHORIZATION, occurredAt: '2026-08-30T22:02:00.000Z', transactionId: 'transaction:promote:a' });
  const generationId = first.components[0].generation_id;
  assert.equal(ledger.resolveGenerationPin({ generationId, observedAt: '2026-09-01T00:00:00.000Z' }).pin_behavior, 'serve_pinned');
  ledger.revokeGeneration({ generationId, auditRef: 'audit:generation-safety-revocation' });
  assert.throws(() => ledger.resolveGenerationPin({ generationId, observedAt: '2026-09-01T00:00:00.000Z' }), error => error.code === 'GENERATION_REVOKED');
});

test('production mode refuses offline rehearsal authorization', () => {
  const ledger = new InMemoryPublicationLedger({ mode: 'production' });
  assert.throws(() => ledger.promote({
    publicationId: 'publication:not-registered',
    gates: [],
    authorization: AUTHORIZATION,
    occurredAt: '2026-08-30T22:02:00.000Z',
    transactionId: 'transaction:unauthorized',
  }), error => error.code === 'PRODUCTION_CUTOVER_NOT_AUTHORIZED');
});
