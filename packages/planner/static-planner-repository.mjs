import { assertPublicationReadContext } from '../registry/publication-read-context.mjs';
import { PLANNER_REPOSITORY_VERSION, PlannerRepositoryError } from './planner-repository.mjs';

export class StaticPlannerRepository {
  repository_version = PLANNER_REPOSITORY_VERSION;

  async planResearch({ publication, signal } = {}) {
    assertPublicationReadContext(publication);
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    throw new PlannerRepositoryError(
      'planner_unavailable',
      'Research planning is not available in the legacy static rollback bundle.',
      { retryable: false }
    );
  }
}
