import { createHash } from 'node:crypto';
import { LIMITS } from '../../scripts/stage-research-assets.mjs';
import { createStaticPublicationReadContext } from './publication-read-context.mjs';

export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export const LAST_GOOD_CORPUS_VERSION = '1.2.0';
export const LAST_GOOD_MANIFEST_SHA256 = '85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e';
export const HISTORICAL_READINESS_CORPUS_VERSION = '1.1.0';
export const HISTORICAL_PA_PUBLISHED_RECORD_COUNT = 24;

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function sha(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

export function archiveHistoricalReadiness(readiness, currentCorpusVersion = LAST_GOOD_CORPUS_VERSION) {
  if (!readiness) fail('READINESS_REQUIRED');
  const historical = readiness.corpus_version !== currentCorpusVersion;
  const states = (readiness.states ?? []).map((state) => {
    const historicalPublished = historical && state.published_state_record_count > 0;
    return freeze({
      ...state,
      historical_view: historical,
      published_state_record_count_is_current: historicalPublished ? false : state.published_state_record_count > 0,
      current_published_state_record_count: historical ? 0 : state.published_state_record_count,
      archived_published_state_record_count: historical ? state.published_state_record_count : null,
    });
  });
  const pa = states.find((state) => state.postal === 'PA');
  if (historical && pa && pa.archived_published_state_record_count === HISTORICAL_PA_PUBLISHED_RECORD_COUNT && pa.current_published_state_record_count !== 0) {
    fail('HISTORICAL_PA_COUNT_PRESENTED_AS_CURRENT');
  }
  return freeze({
    ...readiness,
    historical_view: historical,
    current_coverage: historical ? false : true,
    archived_reason: historical ? 'v1.1.0 national-readiness table is a historical view, not current generation coverage' : null,
    current_corpus_version: currentCorpusVersion,
    current_generation: LAST_GOOD_GENERATION,
    summary: freeze({
      ...readiness.summary,
      published_records_are_current: historical ? false : true,
    }),
    states: freeze(states),
  });
}

export function pennsylvaniaCurrentPublishedCount(readiness, currentCorpusVersion = LAST_GOOD_CORPUS_VERSION) {
  const archived = archiveHistoricalReadiness(readiness, currentCorpusVersion);
  const pa = archived.states.find((state) => state.postal === 'PA');
  return pa?.current_published_state_record_count ?? 0;
}

export function assembleAcceptedPublicationManifest({
  generation = LAST_GOOD_GENERATION,
  corpusVersion = LAST_GOOD_CORPUS_VERSION,
  manifestSha256 = LAST_GOOD_MANIFEST_SHA256,
  assets = [],
  dictionaryBindings = [],
  examples = [],
  sourceCards = [],
  coverage = {},
  searchProjection = {},
  contractVersions = {},
  partialFragments = [],
  sourceContext = null,
  expectedSourceContext = null,
} = {}) {
  if (partialFragments.length) fail('UNDECLARED_PARTIAL_FRAGMENT');
  if (expectedSourceContext && sourceContext !== expectedSourceContext) fail('SOURCE_CONTEXT_MISMATCH');
  const required = ['canonical_revision', 'dictionary', 'example', 'source_card', 'coverage', 'search_projection'];
  const kinds = new Set(assets.map((asset) => asset.kind));
  for (const kind of required) {
    if (!kinds.has(kind) && kind !== 'canonical_revision') {
      const present = {
        dictionary: dictionaryBindings.length > 0,
        example: examples.length > 0,
        source_card: sourceCards.length > 0,
        coverage: coverage && Object.keys(coverage).length > 0,
        search_projection: searchProjection && Object.keys(searchProjection).length > 0,
      };
      if (!present[kind]) fail('MISSING_ASSET', kind);
    }
  }
  for (const asset of assets) {
    if (!asset?.id || !asset?.sha256) fail('MISSING_ASSET', asset?.kind ?? 'unknown');
  }
  return freeze({
    format: 'ushso.accepted-publication-manifest.v1',
    generation,
    corpus_version: corpusVersion,
    manifest_sha256: manifestSha256,
    last_good_generation: LAST_GOOD_GENERATION,
    assets: freeze([...assets]),
    dictionary_bindings: freeze([...dictionaryBindings]),
    examples: freeze([...examples]),
    source_cards: freeze([...sourceCards]),
    coverage: freeze({ ...coverage, historical_pennsylvania_published_record_count: HISTORICAL_PA_PUBLISHED_RECORD_COUNT, historical_pennsylvania_is_current: false }),
    search_projection: freeze({ ...searchProjection }),
    contract_versions: freeze({ ...contractVersions }),
    checksum: sha({ generation, corpusVersion, manifestSha256, assets }),
    closed: true,
    historical_view_archived: true,
  });
}

export function pageDictionary(entries = [], { pageSize = 50, maxPageBytes = LIMITS.maxPageBytes } = {}) {
  if (!Array.isArray(entries)) fail('DICTIONARY_ENTRIES_REQUIRED');
  const pages = [];
  let current = [];
  let bytes = 0;
  for (const entry of entries) {
    const encoded = JSON.stringify(entry);
    const size = Buffer.byteLength(encoded);
    if (size > maxPageBytes) fail('DICTIONARY_ENTRY_TOO_LARGE');
    if (current.length >= pageSize || bytes + size > maxPageBytes) {
      if (current.length) pages.push(freeze(current));
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += size;
  }
  if (current.length) pages.push(freeze(current));
  return freeze({
    page_count: pages.length,
    page_size: pageSize,
    max_page_bytes: maxPageBytes,
    pages: freeze(pages),
    predictable: pages.every((page) => page.length <= pageSize),
  });
}

export function serveBoundedAssets(assets = []) {
  const served = [];
  const failed = [];
  for (const asset of assets) {
    if (asset?.ok === false || asset?.error) {
      failed.push(freeze({ id: asset.id, error: asset.error ?? 'ASSET_FAILED' }));
      continue;
    }
    served.push(freeze({ id: asset.id, kind: asset.kind, body: asset.body ?? null }));
  }
  if (failed.length && served.length === 0 && assets.length > failed.length) fail('CATALOG_BLANKED');
  return freeze({
    served: freeze(served),
    failed: freeze(failed),
    catalog_blanked: false,
    remaining_available: served.length > 0 || assets.length === failed.length,
  });
}

export function assertProjectionParity({ catalogGeneration, dictionaryGeneration, searchGeneration, uiGeneration }) {
  const generations = [catalogGeneration, dictionaryGeneration, searchGeneration, uiGeneration];
  if (generations.some((value) => value !== generations[0])) fail('MIXED_GENERATION');
  return freeze({ generation: generations[0], mixed: false });
}

export function publishOrKeepLastGood({ candidate, lastGood = LAST_GOOD_GENERATION, failClosed = false } = {}) {
  if (failClosed === true || candidate?.closed !== true) {
    return freeze({
      published: false,
      live_generation: lastGood,
      last_good_left_live: true,
      candidate_generation: candidate?.generation ?? null,
    });
  }
  if (candidate.generation !== lastGood && candidate.replaces_last_good !== true) {
    return freeze({
      published: false,
      live_generation: lastGood,
      last_good_left_live: true,
      candidate_generation: candidate.generation,
    });
  }
  return freeze({
    published: true,
    live_generation: candidate.generation,
    last_good_left_live: candidate.generation === lastGood,
    candidate_generation: candidate.generation,
  });
}

export function expiredGenerationBehavior(requested, live = LAST_GOOD_GENERATION) {
  if (requested !== live) {
    return freeze({ status: 'expired_generation', live_generation: live, mixed: false });
  }
  return freeze({ status: 'current', live_generation: live, mixed: false });
}

export function staticFallbackContext(corpus) {
  return createStaticPublicationReadContext(corpus);
}

export { LIMITS };
