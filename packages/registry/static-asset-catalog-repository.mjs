import { CATALOG_REPOSITORY_VERSION } from './catalog-repository.mjs';
import { assertPublicationReadContext, staticCorpusFingerprint } from './publication-read-context.mjs';

function assertSignal(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function assertBundleMatches(publication, bundle) {
  assertPublicationReadContext(publication);
  const corpus = bundle?.corpus;
  if (!corpus || corpus.corpus_id !== publication.corpus.corpus_id
    || corpus.corpus_version !== publication.corpus.corpus_version
    || staticCorpusFingerprint(corpus) !== publication.corpus.content_fingerprint_sha256) {
    throw new TypeError('static catalog bundle does not match the publication context');
  }
  return bundle;
}

/** Read-only compatibility adapter over the immutable staged v1.1.0 assets. */
export class StaticAssetCatalogRepository {
  repository_version = CATALOG_REPOSITORY_VERSION;

  constructor({ loadCatalog }) {
    if (typeof loadCatalog !== 'function') throw new TypeError('loadCatalog must be a function');
    this.loadCatalog = loadCatalog;
  }

  async #bundle({ publication, request, env, signal }) {
    assertSignal(signal);
    const bundle = assertBundleMatches(publication, await this.loadCatalog(request, env));
    assertSignal(signal);
    return bundle;
  }

  async describePublication({ request, env, signal }) {
    assertSignal(signal);
    const bundle = await this.loadCatalog(request, env);
    assertSignal(signal);
    return structuredClone(bundle.corpus);
  }

  async getCatalogSummary(options) {
    const bundle = await this.#bundle(options);
    return {
      ...bundle.corpus,
      record_count: bundle.records.length,
      search_document_count: bundle.searchDocuments.length,
      join_route_count: bundle.joinRoutes.length
    };
  }

  async browseAssets({ limit, ...options }) {
    const bundle = await this.#bundle(options);
    return [...bundle.records]
      .sort((left, right) => Number(right.record_id.startsWith('us-federal:')) - Number(left.record_id.startsWith('us-federal:')) || left.record_id.localeCompare(right.record_id))
      .slice(0, limit);
  }

  async getAsset({ publicId, ...options }) {
    const bundle = await this.#bundle(options);
    return bundle.records.find(candidate => candidate.record_id === publicId
      || candidate.record_id === `obs:asset:${publicId}`
      || candidate.record_id.replace(/^obs:asset:/, '') === publicId) ?? null;
  }

  async getFamilySize({ familyId, ...options }) {
    const bundle = await this.#bundle(options);
    return bundle.records.filter(candidate => candidate.identity?.family?.family_id && candidate.identity.family.family_id === familyId).length;
  }

  async getJoinRoutes({ recordId = null, selectedRecordIds = null, ...options }) {
    const bundle = await this.#bundle(options);
    if (recordId !== null) {
      return bundle.joinRoutes
        .filter(route => route.from_record_id === recordId || route.to_record_id === recordId)
        .map(route => structuredClone(route));
    }
    if (selectedRecordIds !== null) {
      const selected = new Set(selectedRecordIds);
      return bundle.joinRoutes
        .filter(route => selected.has(route.from_record_id) && selected.has(route.to_record_id))
        .map(route => structuredClone(route))
        .sort((left, right) => left.route_id.localeCompare(right.route_id));
    }
    return structuredClone(bundle.joinRoutes);
  }
}
