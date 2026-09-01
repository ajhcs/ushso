export const COVERAGE_REPOSITORY_VERSION = 'ushso-coverage-repository.v1.0.0';

export function assertCoverageRepository(value) {
  if (!value || typeof value !== 'object') throw new TypeError('CoverageRepository is required');
  if (value.repository_version !== COVERAGE_REPOSITORY_VERSION) throw new TypeError('CoverageRepository version is unsupported');
  if (typeof value.getCoverageStatus !== 'function') throw new TypeError('CoverageRepository.getCoverageStatus() is required');
  return value;
}
