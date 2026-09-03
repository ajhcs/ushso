import { assertPublicationReadContext } from '../registry/publication-read-context.mjs';
import { COVERAGE_REPOSITORY_VERSION } from './coverage-repository.mjs';

export class StaticCoverageRepository {
  repository_version = COVERAGE_REPOSITORY_VERSION;

  async getCoverageStatus({ publication, signal } = {}) {
    assertPublicationReadContext(publication);
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    return Object.freeze({
      status: 'unknown',
      reason_code: 'legacy_static_component_unavailable',
      publication_manifest_id: publication.publication_manifest_id,
      index_generation: publication.index_generation,
      coverage_snapshot_id: publication.coverage_snapshot_id,
      absence_claim_permitted: false,
      interpretation: 'The legacy static bundle has no complete coverage denominator. No absence claim is permitted.'
    });
  }
}
