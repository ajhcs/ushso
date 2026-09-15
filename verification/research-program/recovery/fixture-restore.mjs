import { performance } from 'node:perf_hooks';
import { digest } from '../../../contracts/publication/v1.0.0/tools/common.mjs';
import {
  buildPromotionEvidenceReceipt,
  InMemoryPublicationLedger,
  REQUIRED_PROMOTION_GATES,
  buildPublicationManifest,
} from '../../../packages/search/publication-lifecycle-v2.mjs';
import {
  buildSearchComponents,
  externalValidatedComponent,
  fixtureBuildReceiptDigest,
  fixtureTimes,
} from '../../wp8/v1.0.0/tools/fixture.mjs';

export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export const AUTH_05 = 'pending_external_authorization';

const AUTHORIZATION = Object.freeze({ scope: 'offline_rehearsal', external_cutover_authorized: false });

function gates(publication) {
  return REQUIRED_PROMOTION_GATES.map((gate) => ({
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
    ...Object.values(fixture.components).map((item) => item.component),
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

function publicationRef(publication) {
  return { publication_id: publication.publication_id, manifest_digest: publication.publication_digest };
}

function createPublication({ fixture, components, suffix, previous = null }) {
  return buildPublicationManifest({
    publicationId: `publication:pr078-fixture:${suffix}`,
    canonicalManifestRef: fixture.canonicalManifestRef,
    canonicalAsOf: fixture.canonicalManifest.canonical_as_of,
    componentGenerationRefs: components.map((component) => ({
      component_kind: component.component_kind,
      generation_id: component.generation_id,
      manifest_digest: component.component_checksum,
    })),
    coverageSnapshotId: `coverage-snapshot:pr078-fixture:${suffix}`,
    buildReceiptRef: `build-receipt:pr078-fixture:${suffix}`,
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

export function restoreNMinusOnePublication() {
  const started = performance.now();
  const ledger = new InMemoryPublicationLedger();
  const first = registerComponents(ledger, 'nminus1');
  const publicationA = createPublication({ ...first, suffix: 'nminus1' });
  ledger.registerPublication(publicationA);
  ledger.promote({
    publicationId: publicationA.publication_id,
    gates: gates(publicationA),
    authorization: AUTHORIZATION,
    occurredAt: '2026-08-30T22:02:00.000Z',
    transactionId: 'transaction:promote:nminus1',
  });
  const second = registerComponents(ledger, 'current');
  const publicationB = createPublication({ ...second, suffix: 'current', previous: publicationRef(publicationA) });
  ledger.registerPublication(publicationB);
  ledger.promote({
    publicationId: publicationB.publication_id,
    gates: gates(publicationB),
    authorization: AUTHORIZATION,
    occurredAt: '2026-08-30T22:03:00.000Z',
    transactionId: 'transaction:promote:current',
  });
  const historyBefore = ledger.snapshot().publication_history.length;
  const rolledBack = ledger.rollback({
    targetPublicationId: publicationA.publication_id,
    authorization: AUTHORIZATION,
    occurredAt: '2026-08-30T22:04:00.000Z',
    transactionId: 'transaction:rollback:nminus1',
  });
  const elapsed_ms = performance.now() - started;
  const snapshot = ledger.snapshot();
  return Object.freeze({
    kind: 'fixture_in_memory_publication_rollback',
    managed_restore_or_failover: false,
    configuration_file_alone: false,
    backup_listing_alone: false,
    planned_drill_alone: false,
    earlier_static_worker_rollback_target: false,
    auth_05: AUTH_05,
    elapsed_ms,
    active_publication_id: rolledBack.active_publication_ref.publication_id,
    n_minus_one_restored: rolledBack.active_publication_ref.publication_id === publicationA.publication_id,
    attempts_preserved: snapshot.publication_history.length === historyBefore + 1,
    review_histories_preserved: snapshot.publication_history.some((event) => event.action === 'promote')
      && snapshot.publication_history.at(-1).action === 'rollback',
    pending_scientific_claims_published: false,
    last_good_generation: LAST_GOOD_GENERATION,
  });
}
