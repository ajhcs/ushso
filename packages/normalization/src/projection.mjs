import { CATALOG_REPOSITORY_VERSION } from '../../registry/catalog-repository.mjs';
import { assertPublicationReadContext, staticCorpusFingerprint } from '../../registry/publication-read-context.mjs';

function assertSignal(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function assertProjection(publication, projection) {
  assertPublicationReadContext(publication);
  const corpus = projection?.corpus;
  if (!corpus || corpus.corpus_id !== publication.corpus.corpus_id
    || corpus.corpus_version !== publication.corpus.corpus_version
    || staticCorpusFingerprint(corpus) !== publication.corpus.content_fingerprint_sha256) {
    throw new TypeError('database legacy projection does not match publication context');
  }
  return projection;
}

/**
 * Database-backed compatibility repository. `readProjection` must issue a
 * generation/import-pinned database query and return the exact legacy JSON
 * projection. No method reads the source JSONL files.
 */
export class DatabaseBackedV1ProjectionRepository {
  repository_version = CATALOG_REPOSITORY_VERSION;

  constructor({ readProjection }) {
    if (typeof readProjection !== 'function') throw new TypeError('readProjection must be a function');
    this.readProjection = readProjection;
  }

  async #projection({ publication, signal }) {
    assertSignal(signal);
    const projection = assertProjection(publication, await this.readProjection({ publication, signal }));
    assertSignal(signal);
    return projection;
  }

  async describePublication({ publication, signal }) {
    assertSignal(signal);
    const projection = await this.readProjection({ publication: publication ?? null, signal });
    assertSignal(signal);
    if (!projection?.corpus) throw new TypeError('database legacy projection is missing corpus metadata');
    if (publication) assertProjection(publication, projection);
    return structuredClone(projection.corpus);
  }

  async getCatalogSummary(options) {
    const projection = await this.#projection(options);
    return {
      ...projection.corpus,
      record_count: projection.records.length,
      search_document_count: projection.search_documents.length,
      join_route_count: projection.join_routes.length
    };
  }

  async browseAssets({ limit, ...options }) {
    const projection = await this.#projection(options);
    return [...projection.records]
      .sort((left, right) => Number(right.record_id.startsWith('us-federal:')) - Number(left.record_id.startsWith('us-federal:')) || left.record_id.localeCompare(right.record_id))
      .slice(0, limit).map(row => structuredClone(row));
  }

  async getAsset({ publicId, ...options }) {
    const projection = await this.#projection(options);
    const row = projection.records.find(candidate => candidate.record_id === publicId
      || candidate.record_id === `obs:asset:${publicId}`
      || candidate.record_id.replace(/^obs:asset:/u, '') === publicId);
    return row ? structuredClone(row) : null;
  }

  async getFamilySize({ familyId, ...options }) {
    const projection = await this.#projection(options);
    return projection.records.filter(candidate => candidate.identity?.family?.family_id === familyId).length;
  }

  async getJoinRoutes({ recordId = null, selectedRecordIds = null, ...options }) {
    const projection = await this.#projection(options);
    let rows = projection.join_routes;
    if (recordId !== null) rows = rows.filter(route => route.from_record_id === recordId || route.to_record_id === recordId);
    if (selectedRecordIds !== null) {
      const selected = new Set(selectedRecordIds);
      rows = rows.filter(route => selected.has(route.from_record_id) && selected.has(route.to_record_id))
        .sort((left, right) => left.route_id.localeCompare(right.route_id));
    }
    return structuredClone(rows);
  }

  async getSearchDocuments(options) {
    return structuredClone((await this.#projection(options)).search_documents);
  }

  async zeroResultSemantics(options) {
    const semantics = (await this.#projection(options)).semantics;
    return {
      status: semantics.zero_results_status,
      result_count: 0,
      absence_claim_permitted: semantics.zero_results_absence_claim_permitted,
      warnings: [semantics.zero_results_warning]
    };
  }
}
