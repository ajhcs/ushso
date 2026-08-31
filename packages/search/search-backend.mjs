export const SEARCH_BACKEND_VERSION = 'ushso-search-backend.v1.0.0';

export function assertSearchBackend(value) {
  if (!value || typeof value !== 'object') throw new TypeError('SearchBackend is required');
  if (value.backend_version !== SEARCH_BACKEND_VERSION) throw new TypeError('SearchBackend version is unsupported');
  for (const method of ['interpret', 'searchAssets']) {
    if (typeof value[method] !== 'function') throw new TypeError(`SearchBackend.${method}() is required`);
  }
  return value;
}
