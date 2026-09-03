export const PLANNER_REPOSITORY_VERSION = 'ushso-planner-repository.v1.0.0';

export class PlannerRepositoryError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'PlannerRepositoryError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function assertPlannerRepository(value) {
  if (!value || typeof value !== 'object') throw new TypeError('PlannerRepository is required');
  if (value.repository_version !== PLANNER_REPOSITORY_VERSION) throw new TypeError('PlannerRepository version is unsupported');
  if (typeof value.planResearch !== 'function') throw new TypeError('PlannerRepository.planResearch() is required');
  return value;
}
