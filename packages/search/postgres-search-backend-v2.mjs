import { PUBLICATION_READ_CONTEXT_VERSION } from '../registry/publication-read-context.mjs';
import { SEARCH_BACKEND_VERSION } from './search-backend.mjs';
import { decodeGenerationCursor, encodeGenerationCursor } from './generation-cursor-v2.mjs';
import { PUBLICATION_COMPONENT_TYPES, SEARCH_PROJECTION_TYPES } from './projection-v2.mjs';

export const POSTGRES_SEARCH_ADAPTER_VERSION = 'ushso-postgres-search-backend.v2.0.0-untuned';
export const PRE_TUNING_QUALITY_STATUS = 'FAIL_PRE_TUNING';
export const MAX_SEARCH_CANDIDATES = 50;
export const MAX_HYDRATION_IDS = 50;
const MAX_QUERY_CHARS = 500;
const MAX_FILTER_VALUES = 20;
const MAX_SERIALIZED_RESULT_BYTES = 512 * 1024;
const UTC_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/u;
const ALLOWED_FILTERS = Object.freeze([
  'access_classes',
  'authority_tiers',
  'exact_native_ids',
  'family_ids',
  'geographies',
  'identifier_namespaces',
]);

export const SEARCH_CANDIDATES_SQL = `
select *
from ushso_search.search_candidates(
  $1::text,
  $2::text,
  $3::text,
  $4::jsonb,
  $5::integer,
  $6::bigint,
  $7::text,
  $8::text
)
`;

export const BROWSE_CANDIDATES_SQL = `
select *
from ushso_search.browse_candidates(
  $1::text,
  $2::text,
  $3::jsonb,
  $4::integer,
  $5::text,
  $6::text
)
`;

export const HYDRATE_REVISIONS_SQL = `
select *
from ushso_search.hydrate_exact_revisions(
  $1::text,
  $2::text,
  $3::jsonb
)
`;

export const RESOLVE_ACTIVE_PUBLICATION_SQL = `
select * from ushso_search.resolve_active_publication()
`;

export class PostgresSearchError extends Error {
  constructor(code, detail, { retryable = false, restartRequired = false } = {}) {
    super(`${code}${detail ? `:${detail}` : ''}`);
    this.name = 'PostgresSearchError';
    this.code = code;
    this.detail = detail ?? null;
    this.retryable = retryable;
    this.restart_required = restartRequired;
  }
}

function fail(code, detail, options) {
  throw new PostgresSearchError(code, detail, options);
}

function assertSignal(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function assertObservedAt(observedAt) {
  if (typeof observedAt !== 'string' || !UTC_TIMESTAMP.test(observedAt) || Number.isNaN(Date.parse(observedAt))) {
    fail('SEARCH_OBSERVED_AT_INVALID');
  }
  return observedAt;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function jsonObject(value, label) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    fail('PUBLICATION_POINTER_FIELD_INVALID', label);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('PUBLICATION_POINTER_FIELD_INVALID', label);
  return parsed;
}

function exactComponentMap(value, label, validator) {
  const object = jsonObject(value, label);
  const actual = Object.keys(object).sort();
  const expected = [...PUBLICATION_COMPONENT_TYPES].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('PUBLICATION_COMPONENT_SET_INVALID', label);
  }
  for (const [kind, item] of Object.entries(object)) validator(item, `${label}:${kind}`);
  return object;
}

function utcValue(value, label) {
  const normalized = value instanceof Date ? value.toISOString() : value;
  if (typeof normalized !== 'string' || !UTC_TIMESTAMP.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    fail('PUBLICATION_POINTER_TIMESTAMP_INVALID', label);
  }
  return normalized;
}

function assertPublication(publication, projectionType) {
  if (!publication || typeof publication !== 'object') fail('PUBLICATION_CONTEXT_REQUIRED');
  if (publication.contract_version !== PUBLICATION_READ_CONTEXT_VERSION) fail('PUBLICATION_CONTEXT_VERSION_UNSUPPORTED');
  for (const field of ['publication_manifest_id', 'canonical_revision_manifest_id', 'coverage_snapshot_id']) {
    if (typeof publication[field] !== 'string' || publication[field].length === 0) fail('PUBLICATION_CONTEXT_PIN_MISSING', field);
  }
  const generationId = publication.component_generations?.[projectionType];
  if (typeof generationId !== 'string' || generationId.length === 0) fail('PUBLICATION_COMPONENT_UNAVAILABLE', projectionType);
  if (publication.absence_claim_permitted !== false) fail('PUBLICATION_ABSENCE_BOUNDARY_INVALID');
  if (!Object.isFrozen(publication) || !Object.isFrozen(publication.component_generations)) fail('PUBLICATION_CONTEXT_NOT_FROZEN');
  return generationId;
}

function normalizeFilterValues(value, name) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILTER_VALUES) fail('SEARCH_FILTER_INVALID', name);
  const normalized = value.map(item => {
    if (typeof item !== 'string' || item.length < 1 || item.length > 192) fail('SEARCH_FILTER_VALUE_INVALID', name);
    return item;
  }).sort();
  if (new Set(normalized).size !== normalized.length) fail('SEARCH_FILTER_DUPLICATE', name);
  return normalized;
}

function normalizeFilters(filters = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) fail('SEARCH_FILTERS_INVALID');
  const unknown = Object.keys(filters).filter(name => !ALLOWED_FILTERS.includes(name));
  if (unknown.length) fail('SEARCH_FILTER_UNKNOWN', unknown.sort().join(','));
  const normalized = {};
  for (const name of ALLOWED_FILTERS) if (filters[name] !== undefined) normalized[name] = normalizeFilterValues(filters[name], name);
  return normalized;
}

function normalizeLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SEARCH_CANDIDATES) fail('SEARCH_LIMIT_INVALID');
  return limit;
}

function rowsFrom(result) {
  if (!result || !Array.isArray(result.rows)) fail('POSTGRES_RESULT_INVALID');
  return result.rows;
}

function rankMicros(row) {
  const value = typeof row.rank_micros === 'string' ? Number(row.rank_micros) : row.rank_micros;
  if (!Number.isSafeInteger(value) || value < 0) fail('POSTGRES_RANK_INVALID', row.document_id);
  return value;
}

function candidateFromRow(row, expectedGeneration, expectedType) {
  if (row.generation_id !== expectedGeneration || row.document_type !== expectedType) fail('POSTGRES_GENERATION_LEAK', row.document_id);
  if (row.visibility_state !== 'public') fail('POSTGRES_VISIBILITY_LEAK', row.document_id);
  return {
    document_id: row.document_id,
    document_type: row.document_type,
    canonical_id: row.canonical_id,
    revision_id: row.revision_id,
    document_checksum: row.document_checksum,
    rank_inputs: {
      lexical_rank_micros: rankMicros(row),
      untuned: true,
    },
    match_reasons: [{
      reason_code: row.match_reason_code ?? 'untuned_lexical_metadata_match',
      explanation: row.match_reason ?? 'Matched indexed public metadata in the pinned generation.',
      evidence_state: 'projection_only',
    }],
    near_miss: row.near_miss === true,
    summary: {
      title: row.title,
      description: row.description ?? null,
      authority_tier: row.authority_tier ?? null,
    },
  };
}

export function createDatabasePublicationReadContext({ publicationManifest, componentRetainedUntil = {}, componentChecksums = {}, pointerResolution = null }) {
  const components = Object.fromEntries(publicationManifest.component_generation_refs.map(reference => [reference.component_kind, reference.generation_id]));
  return deepFreeze({
    contract_version: PUBLICATION_READ_CONTEXT_VERSION,
    publication_manifest_id: publicationManifest.publication_id,
    canonical_revision_manifest_id: publicationManifest.canonical_manifest_ref.manifest_id,
    canonical_as_of: publicationManifest.canonical_as_of,
    index_generation: components.asset_search,
    coverage_snapshot_id: publicationManifest.coverage_snapshot_id,
    component_generations: components,
    component_retained_until: { ...componentRetainedUntil },
    component_checksums: { ...componentChecksums },
    corpus: {
      corpus_id: publicationManifest.canonical_manifest_ref.manifest_id,
      corpus_version: publicationManifest.contract_version,
      content_fingerprint_sha256: publicationManifest.canonical_manifest_ref.digest.value,
      algorithm_fingerprint_sha256: null,
    },
    storage_mode: 'postgresql_immutable_generation',
    absence_claim_permitted: false,
    pointer_resolution: pointerResolution ? { ...pointerResolution } : null,
  });
}

export async function resolveDatabasePublicationReadContext({ query, signal }) {
  if (typeof query !== 'function' && typeof query?.query !== 'function') fail('POSTGRES_QUERY_EXECUTOR_REQUIRED');
  assertSignal(signal);
  const execute = typeof query === 'function' ? query : query.query.bind(query);
  let result;
  try {
    result = await execute({
      name: 'ushso_resolve_active_publication_v2',
      text: RESOLVE_ACTIVE_PUBLICATION_SQL,
      values: [],
      signal,
    });
  } catch (error) {
    if (signal?.aborted) assertSignal(signal);
    throw new PostgresSearchError('PUBLICATION_POINTER_UNAVAILABLE', error?.code ?? error?.message, { retryable: true });
  }
  assertSignal(signal);
  const rows = rowsFrom(result);
  if (rows.length !== 1) fail('PUBLICATION_POINTER_ROW_COUNT_INVALID', rows.length);
  const row = rows[0];
  if (row.pointer_lookup_cache_disabled !== true) fail('PUBLICATION_POINTER_CACHE_POLICY_INVALID');
  const sequence = typeof row.pointer_sequence === 'string' ? Number(row.pointer_sequence) : row.pointer_sequence;
  if (!Number.isSafeInteger(sequence) || sequence < 1) fail('PUBLICATION_POINTER_SEQUENCE_INVALID');
  for (const field of ['publication_id', 'canonical_manifest_id', 'coverage_snapshot_id']) {
    if (typeof row[field] !== 'string' || row[field].length < 3 || row[field].length > 192) fail('PUBLICATION_POINTER_PIN_INVALID', field);
  }
  for (const field of ['publication_sha256', 'canonical_membership_sha256']) {
    if (typeof row[field] !== 'string' || !/^[a-f0-9]{64}$/u.test(row[field])) fail('PUBLICATION_POINTER_DIGEST_INVALID', field);
  }
  const components = exactComponentMap(row.component_generations, 'component_generations', (value, label) => {
    if (typeof value !== 'string' || value.length < 3 || value.length > 192) fail('PUBLICATION_POINTER_PIN_INVALID', label);
  });
  const checksums = exactComponentMap(row.component_checksums, 'component_checksums', (value, label) => {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail('PUBLICATION_POINTER_DIGEST_INVALID', label);
  });
  const retainedUntil = exactComponentMap(row.component_retained_until, 'component_retained_until', (value, label) => utcValue(value, label));
  const canonicalAsOf = utcValue(row.canonical_as_of, 'canonical_as_of');
  const resolvedAt = utcValue(row.resolved_at, 'resolved_at');
  return createDatabasePublicationReadContext({
    publicationManifest: {
      contract_version: '1.0.0',
      publication_id: row.publication_id,
      canonical_manifest_ref: {
        manifest_id: row.canonical_manifest_id,
        digest: { value: row.canonical_membership_sha256 },
      },
      canonical_as_of: canonicalAsOf,
      coverage_snapshot_id: row.coverage_snapshot_id,
      component_generation_refs: PUBLICATION_COMPONENT_TYPES.map(componentKind => ({
        component_kind: componentKind,
        generation_id: components[componentKind],
      })),
    },
    componentRetainedUntil: retainedUntil,
    componentChecksums: checksums,
    pointerResolution: {
      sequence,
      publication_sha256: row.publication_sha256,
      resolved_at: resolvedAt,
      pointer_lookup_cache_disabled: true,
      resolved_once_per_request: true,
    },
  });
}

export function compileUntunedIntent(query) {
  if (typeof query !== 'string' || query.length < 1 || query.length > MAX_QUERY_CHARS) fail('SEARCH_QUERY_INVALID');
  const normalized = query.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!normalized) fail('SEARCH_QUERY_EMPTY');
  return deepFreeze({
    intent_version: 'ushso-search-intent.v1.0.0-untuned',
    original_question: query,
    normalized_question: normalized,
    tokens: normalized.toLocaleLowerCase('en-US').split(' ').slice(0, 64),
    ranking_tuned: false,
    held_out_accessed: false,
  });
}

export class PostgresSearchBackendV2 {
  backend_version = SEARCH_BACKEND_VERSION;
  adapter_version = POSTGRES_SEARCH_ADAPTER_VERSION;

  constructor({ query, cursorSecret, compileIntent = compileUntunedIntent }) {
    if (typeof query !== 'function' && typeof query?.query !== 'function') fail('POSTGRES_QUERY_EXECUTOR_REQUIRED');
    if (typeof compileIntent !== 'function') fail('SEARCH_INTENT_COMPILER_REQUIRED');
    this.query = typeof query === 'function' ? query : query.query.bind(query);
    this.cursorSecret = cursorSecret;
    this.compileIntent = compileIntent;
  }

  async #execute({ name, text, values, signal }) {
    assertSignal(signal);
    let result;
    try {
      result = await this.query({ name, text, values, signal });
    } catch (error) {
      if (signal?.aborted) assertSignal(signal);
      throw new PostgresSearchError('POSTGRES_SEARCH_UNAVAILABLE', error?.code ?? error?.message, { retryable: true });
    }
    assertSignal(signal);
    return rowsFrom(result);
  }

  async interpret({ query, signal }) {
    assertSignal(signal);
    const intent = await this.compileIntent(query);
    assertSignal(signal);
    if (intent?.ranking_tuned !== false || intent?.held_out_accessed !== false) fail('UNTUNED_INTENT_BOUNDARY_VIOLATED');
    return intent;
  }

  async searchAssets({ query, publication, signal, filters = {}, limit = 20, cursor = null, observedAt }) {
    return this.search({ query, publication, signal, filters, limit, cursor, observedAt, projectionType: 'asset_search' });
  }

  async search({ query, publication, signal, filters = {}, limit = 20, cursor = null, observedAt, projectionType = 'asset_search' }) {
    assertObservedAt(observedAt);
    if (!SEARCH_PROJECTION_TYPES.includes(projectionType)) fail('SEARCH_PROJECTION_TYPE_INVALID', projectionType);
    const generationId = assertPublication(publication, projectionType);
    const boundedLimit = normalizeLimit(limit);
    const normalizedFilters = normalizeFilters(filters);
    const intent = typeof query === 'string' && query.trim() ? await this.interpret({ query, signal }) : null;
    let cursorPayload = null;
    if (cursor) {
      cursorPayload = decodeGenerationCursor(cursor, {
        secret: this.cursorSecret,
        observedAt,
        expectedPublicationManifestId: publication.publication_manifest_id,
        expectedGenerationId: generationId,
        expectedProjectionType: projectionType,
      });
    }
    const values = intent
      ? [
          publication.publication_manifest_id,
          generationId,
          intent.normalized_question,
          JSON.stringify(normalizedFilters),
          boundedLimit + 1,
          cursorPayload?.sort.rank_micros ?? null,
          cursorPayload?.sort.canonical_id ?? null,
          cursorPayload?.sort.document_id ?? null,
        ]
      : [
          publication.publication_manifest_id,
          generationId,
          JSON.stringify(normalizedFilters),
          boundedLimit + 1,
          cursorPayload?.sort.canonical_id ?? null,
          cursorPayload?.sort.document_id ?? null,
        ];
    const rows = await this.#execute({
      name: intent ? 'ushso_search_candidates_v2' : 'ushso_browse_candidates_v2',
      text: intent ? SEARCH_CANDIDATES_SQL : BROWSE_CANDIDATES_SQL,
      values,
      signal,
    });
    if (rows.length > boundedLimit + 1) fail('POSTGRES_RESULT_BOUND_EXCEEDED');
    const hasMore = rows.length > boundedLimit;
    const selected = rows.slice(0, boundedLimit).map(row => candidateFromRow(row, generationId, projectionType));
    let nextCursor = null;
    if (hasMore && selected.length) {
      const last = selected.at(-1);
      const retainedUntil = publication.component_retained_until?.[projectionType];
      if (typeof retainedUntil !== 'string') fail('GENERATION_RETENTION_PIN_MISSING', projectionType);
      const issuedMs = Date.parse(observedAt);
      const maximumExpiryMs = Math.min(issuedMs + 15 * 60 * 1000, Date.parse(retainedUntil));
      if (maximumExpiryMs <= issuedMs) fail('GENERATION_RESTART_REQUIRED', generationId, { restartRequired: true });
      nextCursor = encodeGenerationCursor({
        publicationManifestId: publication.publication_manifest_id,
        generationId,
        projectionType,
        sort: {
          rank_micros: intent ? last.rank_inputs.lexical_rank_micros : 0,
          canonical_id: last.canonical_id,
          document_id: last.document_id,
        },
        issuedAt: observedAt,
        expiresAt: new Date(maximumExpiryMs).toISOString(),
        generationRetainedUntil: retainedUntil,
        secret: this.cursorSecret,
      });
    }
    const response = {
      result_version: 'ushso-search-candidates.v2.0.0',
      backend_contract_version: SEARCH_BACKEND_VERSION,
      quality_status: PRE_TUNING_QUALITY_STATUS,
      release_ready: false,
      ranking_tuned: false,
      publication_manifest_id: publication.publication_manifest_id,
      canonical_revision_manifest_id: publication.canonical_revision_manifest_id,
      canonical_as_of: publication.canonical_as_of,
      generation_id: generationId,
      coverage_snapshot_id: publication.coverage_snapshot_id,
      projection_type: projectionType,
      result_count: selected.length,
      results: selected,
      truncation: { truncated: hasMore, limit: boundedLimit, next_cursor: nextCursor },
      zero_result: {
        scoped_zero: selected.length === 0,
        absence_claim_permitted: false,
        reason_code: selected.length === 0 ? 'no_indexed_candidates_in_pinned_scope' : null,
      },
      truth_boundary: {
        source_of_truth: false,
        source_requests_made: 0,
        source_payloads_accessed: 0,
        analyses_executed: 0,
        identity_merges_performed: 0,
        raw_queries_persisted: 0,
      },
    };
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > MAX_SERIALIZED_RESULT_BYTES) fail('SEARCH_RESPONSE_BYTES_EXCEEDED');
    return deepFreeze(response);
  }

  async hydrateExactRevisions({ publication, projectionType, candidates, signal }) {
    const generationId = assertPublication(publication, projectionType);
    if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > MAX_HYDRATION_IDS) fail('HYDRATION_CANDIDATES_INVALID');
    const pins = candidates.map(candidate => ({ canonical_id: candidate.canonical_id, revision_id: candidate.revision_id }));
    const rows = await this.#execute({
      name: 'ushso_hydrate_exact_revisions_v2',
      text: HYDRATE_REVISIONS_SQL,
      values: [publication.publication_manifest_id, generationId, JSON.stringify(pins)],
      signal,
    });
    if (rows.length !== pins.length) fail('HYDRATION_REVISION_COUNT_MISMATCH');
    const expected = new Set(pins.map(pin => `${pin.canonical_id}\0${pin.revision_id}`));
    for (const row of rows) {
      if (row.generation_id !== generationId || !expected.delete(`${row.canonical_id}\0${row.revision_id}`)) fail('HYDRATION_REVISION_PIN_MISMATCH');
    }
    if (expected.size) fail('HYDRATION_REVISION_MISSING');
    const response = {
      publication_manifest_id: publication.publication_manifest_id,
      generation_id: generationId,
      canonical_revision_manifest_id: publication.canonical_revision_manifest_id,
      rows: rows.map(row => ({ ...row })),
      source_of_truth: false,
    };
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > MAX_SERIALIZED_RESULT_BYTES) fail('HYDRATION_RESPONSE_BYTES_EXCEEDED');
    return deepFreeze(response);
  }
}
