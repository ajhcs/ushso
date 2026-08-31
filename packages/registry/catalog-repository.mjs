export const CATALOG_REPOSITORY_VERSION = 'ushso-catalog-repository.v1.0.0';

export function assertCatalogRepository(value) {
  if (!value || typeof value !== 'object') throw new TypeError('CatalogRepository is required');
  if (value.repository_version !== CATALOG_REPOSITORY_VERSION) throw new TypeError('CatalogRepository version is unsupported');
  for (const method of ['describePublication', 'getCatalogSummary', 'browseAssets', 'getAsset', 'getFamilySize', 'getJoinRoutes']) {
    if (typeof value[method] !== 'function') throw new TypeError(`CatalogRepository.${method}() is required`);
  }
  return value;
}
