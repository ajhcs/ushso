import { createRetrievalEngine } from './retrieval-v1.1.0.mjs';
import { applyLiveVerificationReceipt } from './live-verification.mjs';
import { validateCatalogRecords } from '../packages/retrieval/tools/catalog-contract.mjs';

const MAX_REQUEST_BYTES = 20 * 1024;
const CORPUS_BASE = '/corpus-v1.1.0';
const LIVE_VERIFICATION_RECEIPT = '/verification-v0.1.0/live-verification-2026-08-30.json';
const catalogByAssets = new WeakMap();
const SPA_ROUTES = new Set(['/', '/search', '/agents', '/sources', '/about', '/privacy', '/terms', '/contact']);
const STATIC_PATHS = new Set(['/favicon.svg', '/observatory-lighthouse.png', '/state-readiness-v0.1.0.json', '/_headers']);

function responseHeaders(init = {}) {
  const headers = new Headers(init.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('cache-control', init.cacheControl ?? 'no-store');
  return headers;
}

function jsonResponse(value, init = {}) {
  const headers = responseHeaders(init);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('access-control-allow-origin', '*');
  return new Response(init.head ? null : `${JSON.stringify(value)}\n`, { ...init, headers });
}

function errorResponse(status, code, message, init = {}) {
  return jsonResponse({ error: { code, message } }, { ...init, status });
}

function textResponse(value, contentType, init = {}) {
  const headers = responseHeaders(init);
  headers.set('content-type', contentType);
  return new Response(init.head ? null : value, { ...init, headers });
}

function corsPreflightResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff'
    }
  });
}

async function assetText(request, env, pathname) {
  const url = new URL(pathname, request.url);
  const response = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
  if (!response.ok) throw new Error(`CORPUS_ASSET_UNAVAILABLE:${pathname}:${response.status}`);
  return response.text();
}

function parseJsonl(value, label) {
  return value.trim().split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`INVALID_CORPUS_JSONL:${label}:${index + 1}`);
    }
  });
}

export async function loadCatalogFromAssets(request, env) {
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== 'function') throw new Error('STATIC_ASSET_BINDING_REQUIRED');
  if (!catalogByAssets.has(env.ASSETS)) {
    catalogByAssets.set(env.ASSETS, (async () => {
      const [recordsText, searchDocumentsText, routesText, vocabularyText, corpusText, verificationText, sourceRegistryText] = await Promise.all([
        assetText(request, env, `${CORPUS_BASE}/records.jsonl`),
        assetText(request, env, `${CORPUS_BASE}/search-documents.jsonl`),
        assetText(request, env, `${CORPUS_BASE}/join-routes.jsonl`),
        assetText(request, env, `${CORPUS_BASE}/controlled-vocabulary.json`),
        assetText(request, env, `${CORPUS_BASE}/corpus.json`),
        assetText(request, env, LIVE_VERIFICATION_RECEIPT),
        assetText(request, env, `${CORPUS_BASE}/named-source-registry.json`)
      ]);
      const rawRecords = applyLiveVerificationReceipt(parseJsonl(recordsText, 'records'), JSON.parse(verificationText));
      const catalogValidation = validateCatalogRecords(rawRecords);
      const records = catalogValidation.valid;
      const searchDocuments = parseJsonl(searchDocumentsText, 'search-documents');
      const joinRoutes = parseJsonl(routesText, 'join-routes');
      const vocabulary = JSON.parse(vocabularyText);
      const corpus = JSON.parse(corpusText);
      const namedSourceRegistry = JSON.parse(sourceRegistryText);
      return {
        records,
        searchDocuments,
        joinRoutes,
        vocabulary,
        corpus,
        catalogIssues: catalogValidation.invalid,
        namedSourceRegistry,
        engine: createRetrievalEngine({ records: rawRecords, searchDocuments, joinRoutes, vocabulary, corpus, namedSourceRegistry })
      };
    })());
  }
  return catalogByAssets.get(env.ASSETS);
}

export async function loadEngineFromAssets(request, env) {
  return (await loadCatalogFromAssets(request, env)).engine;
}

function retrievalId(value) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  const hex = number => (number >>> 0).toString(16).padStart(8, '0');
  return `retrieval-${hex(first)}${hex(second)}`;
}

function queryFromIntent(intent, filters = {}) {
  return {
    question: intent.original_question,
    normalized_question: intent.normalized_question,
    interpretation: intent.interpretation,
    filters
  };
}

function corpusSummary(bundle) {
  return {
    ...bundle.corpus,
    record_count: bundle.records.length,
    search_document_count: bundle.searchDocuments.length,
    join_route_count: bundle.joinRoutes.length
  };
}

function routesForRecord(bundle, recordId) {
  return bundle.joinRoutes.filter(route => route.from_record_id === recordId || route.to_record_id === recordId);
}

function directResult(record, whyRelevant) {
  return {
    rank: 1,
    score: 1,
    record_id: record.record_id,
    relevance: {
      matched_subjects: [],
      matched_geographies: [],
      matched_units: [],
      matched_terms: [],
      score_components: [{
        kind: 'direct_record_lookup',
        value: 1,
        reason: whyRelevant,
        evidence_state: 'verified_first_party'
      }],
      why_relevant: [whyRelevant]
    },
    record: structuredClone(record)
  };
}

function resultBounds(totalMatches, returnedCount) {
  return {
    result_count: returnedCount,
    returned_count: returnedCount,
    total_matches: totalMatches,
    has_more: totalMatches > returnedCount
  };
}

function stableGeneration(bundle) {
  return bundle.corpus.manifest_sha256 ?? `${bundle.corpus.corpus_id}@${bundle.corpus.corpus_version}`;
}

function stableScopeHash(value) {
  return retrievalId(JSON.stringify(value)).slice('retrieval-'.length);
}

function encodeCursor(value) {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(value) {
  try {
    if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 2048) throw new Error('invalid');
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    if (!parsed || parsed.version !== 1 || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0 || typeof parsed.scope !== 'string' || typeof parsed.generation !== 'string') throw new Error('invalid');
    return parsed;
  } catch {
    const error = new TypeError('The pagination cursor is invalid. Restart traversal from the first page.');
    error.code = 'invalid_cursor';
    throw error;
  }
}

function recordFacetValues(record) {
  return {
    source: [record.identity?.source?.source_id].filter(Boolean),
    geography: [record.geography?.coverage_level, ...(record.geography?.jurisdictions ?? [])].filter(Boolean),
    access_status: [record.access?.status].filter(Boolean),
    unit_of_analysis: [...new Set(record.unit_of_analysis ?? [])],
    capability: [...new Set([...(record.capabilities?.topics ?? []), ...(record.capabilities?.use_cases ?? [])].map(item => item.id).filter(Boolean))]
  };
}

function parseFacetFilters(filters) {
  const grouped = new Map();
  for (const filter of filters) {
    const separator = filter.indexOf(':');
    if (separator <= 0 || separator === filter.length - 1) {
      const error = new TypeError(`Invalid facet filter: ${filter}`);
      error.code = 'invalid_filter';
      throw error;
    }
    const section = filter.slice(0, separator);
    const value = filter.slice(separator + 1);
    grouped.set(section, [...(grouped.get(section) ?? []), value]);
  }
  return grouped;
}

function applyFacetFilters(records, filters) {
  const grouped = parseFacetFilters(filters);
  return records.filter(record => {
    const facets = recordFacetValues(record);
    return [...grouped].every(([section, selected]) => selected.some(value => (facets[section] ?? []).includes(value)));
  });
}

const FACET_LABELS = {
  source: 'Source', geography: 'Geography', access_status: 'Access status',
  unit_of_analysis: 'Observation grain', capability: 'Research concept'
};

function completeFacets(records) {
  const counts = new Map();
  const sourceLabels = new Map(records.map(record => [record.identity?.source?.source_id, record.identity?.source?.name]));
  for (const record of records) {
    for (const [section, values] of Object.entries(recordFacetValues(record))) {
      const sectionCounts = counts.get(section) ?? new Map();
      for (const value of new Set(values)) sectionCounts.set(value, (sectionCounts.get(value) ?? 0) + 1);
      counts.set(section, sectionCounts);
    }
  }
  return {
    count_basis: 'records',
    collection_scope: 'all_matching_records_before_pagination',
    approximate: false,
    sections: [...counts].map(([id, options]) => ({
      id,
      label: FACET_LABELS[id] ?? id,
      options: [...options].sort(([left], [right]) => left.localeCompare(right)).map(([value, count]) => ({ value, label: id === 'source' ? sourceLabels.get(value) ?? value : value, count }))
    }))
  };
}

function dateSortValue(record, field) {
  const values = field === 'observation'
    ? [record.time_coverage?.end, record.time_coverage?.start]
    : [record.release_date, record.dates?.release_date, record.publication_date, record.identity?.asset?.release_date];
  for (const value of values) {
    const timestamp = Date.parse(String(value ?? ''));
    if (Number.isFinite(timestamp)) return timestamp;
    const year = Number(String(value ?? '').match(/^\d{4}/)?.[0]);
    if (Number.isInteger(year)) return Date.UTC(year, 0, 1);
  }
  return null;
}

function sortBrowseRecords(records, sort) {
  return [...records].sort((left, right) => {
    if (sort === 'title_asc') return left.title.localeCompare(right.title) || left.record_id.localeCompare(right.record_id);
    if (sort === 'release_newest' || sort === 'observation_latest') {
      const field = sort === 'release_newest' ? 'release' : 'observation';
      const leftDate = dateSortValue(left, field);
      const rightDate = dateSortValue(right, field);
      if (leftDate !== rightDate) {
        if (leftDate === null) return 1;
        if (rightDate === null) return -1;
        return rightDate - leftDate;
      }
    }
    return Number(right.record_id.startsWith('us-federal:')) - Number(left.record_id.startsWith('us-federal:')) || left.record_id.localeCompare(right.record_id);
  });
}

export function browseResponse(bundle, options = {}) {
  const pageSize = options.pageSize ?? 20;
  const sort = options.sort ?? 'canonical_relevance';
  const facetFilters = options.filters ?? [];
  const question = 'Browse published health systems data';
  const intent = bundle.engine.interpret({ question, limit: Math.min(pageSize, 50) });
  const generation = stableGeneration(bundle);
  if (options.generation && options.generation !== generation) {
    const error = new TypeError('The requested catalog generation is unavailable. Restart traversal with the current generation.');
    error.code = 'generation_unavailable';
    throw error;
  }
  const filtered = applyFacetFilters(bundle.records, facetFilters);
  const sorted = sortBrowseRecords(filtered, sort);
  const scope = stableScopeHash({ generation, question, facetFilters: [...facetFilters].sort(), sort });
  const decoded = options.cursor ? decodeCursor(options.cursor) : null;
  if (decoded && (decoded.generation !== generation || decoded.scope !== scope)) {
    const error = new TypeError('The pagination cursor does not match this catalog generation, query, filters, and sort. Restart traversal from the first page.');
    error.code = decoded.generation !== generation ? 'generation_unavailable' : 'invalid_cursor';
    throw error;
  }
  const offset = decoded?.offset ?? 0;
  if (offset > sorted.length) {
    const error = new TypeError('The pagination cursor is beyond the result set. Restart traversal from the first page.');
    error.code = 'invalid_cursor';
    throw error;
  }
  const records = sorted.slice(offset, offset + pageSize);
  const hasMore = offset + records.length < sorted.length;
  const nextCursor = hasMore ? encodeCursor({ version: 1, generation, scope, offset: offset + records.length }) : null;
  return {
    contract_version: 'observatory-discovery-result.v1.0.0',
    retrieval_id: retrievalId(`browse:${generation}:${scope}:${offset}:${pageSize}`),
    evidence_mode: 'published_offline_evidence',
    corpus: { ...corpusSummary(bundle), generation },
    query: queryFromIntent(intent, { mode: 'catalog_browse', facet_filters: facetFilters, sort, page_size: pageSize }),
    ...resultBounds(sorted.length, records.length),
    has_more: hasMore,
    results: records.map((record, index) => ({
      ...directResult(record, 'Included in the published catalog browse view.'),
      rank: offset + index + 1
    })),
    ranking: { version: 'observatory-canonical-ranking.v1.1.0', sort, ordered_ids: records.map(record => record.record_id) },
    pagination: { generation, cursor: options.cursor ?? null, next_cursor: nextCursor, has_more: hasMore, page_size: pageSize, total_matches: sorted.length },
    facets: completeFacets(filtered),
    sections: { supported: records.map(record => record.record_id), uncertain: [], contextual: [], incompatible: [] },
    partial_results: {
      is_partial: (bundle.catalogIssues?.length ?? 0) > 0,
      invalid_item_count: bundle.catalogIssues?.length ?? 0,
      issues: structuredClone(bundle.catalogIssues ?? [])
    },
    receipt: {
      manifest_version: 'observatory-search-manifest.v1.0.0',
      scope: 'current_page',
      question,
      interpreted_constraints: structuredClone(intent.interpretation),
      filters: { mode: 'catalog_browse', facet_filters: facetFilters, sort, page_size: pageSize },
      sort,
      displayed_ordered_ids: records.map(record => record.record_id),
      ranking_version: 'observatory-canonical-ranking.v1.1.0',
      catalog_generation: generation,
      generated_at: new Date(bundle.corpus.published_at ?? bundle.corpus.built_at ?? '1970-01-01T00:00:00.000Z').toISOString(),
      citations: records.map(record => ({ record_id: record.record_id, title: record.title, source_url: record.authoritative_url ?? null, evidence_ids: (record.evidence ?? []).map(row => row.evidence_id) })),
      limitations: ['Receipt covers the current page, not every match.', 'Source availability and authorization must be checked at use time.']
    },
    join_routes: bundle.joinRoutes.filter(route => records.some(record => route.from_record_id === record.record_id || route.to_record_id === record.record_id)),
    warnings: [
      'Browse mode shows the validated federal baseline first, then other published metadata; order does not imply question relevance or quality.',
      'Records describe indexed metadata and retrieval routes; they do not prove current endpoint availability or authorize access.'
    ]
  };
}

function datasetResponse(bundle, record) {
  const question = `Open dataset ${record.record_id}`;
  const intent = bundle.engine.interpret({ question });
  const siblingCount = bundle.records.filter(candidate => candidate.identity?.family?.family_id && candidate.identity.family.family_id === record.identity?.family?.family_id).length;
  return {
    contract_version: 'observatory-discovery-result.v1.0.0',
    retrieval_id: retrievalId(`dataset:${bundle.corpus.corpus_id}:${record.record_id}`),
    evidence_mode: 'published_offline_evidence',
    corpus: corpusSummary(bundle),
    query: queryFromIntent(intent, {
      mode: 'stable_dataset_dereference',
      record_id: record.record_id,
      family_sibling_count: Math.max(0, siblingCount - 1)
    }),
    ...resultBounds(1, 1),
    results: [directResult(record, 'Opened by its stable published record identifier.')],
    join_routes: routesForRecord(bundle, record.record_id),
    warnings: ['This page describes indexed metadata and retrieval routes; it does not prove current endpoint availability or authorize access.']
  };
}

function parsePageSize(value, fallback = 20) {
  const requested = Number(value ?? fallback);
  if (!Number.isInteger(requested) || requested < 1) return fallback;
  return Math.min(requested, 100);
}

function catalogOptions(url) {
  const sorts = new Set(['canonical_relevance', 'title_asc', 'release_newest', 'observation_latest']);
  const requestedSort = url.searchParams.get('sort') ?? 'canonical_relevance';
  if (!sorts.has(requestedSort)) {
    const error = new TypeError(`Unsupported sort: ${requestedSort}`);
    error.code = 'invalid_sort';
    throw error;
  }
  return {
    pageSize: parsePageSize(url.searchParams.get('page_size') ?? url.searchParams.get('limit')),
    sort: requestedSort,
    filters: url.searchParams.getAll('filter'),
    cursor: url.searchParams.get('cursor') ?? undefined,
    generation: url.searchParams.get('generation') ?? undefined
  };
}

function isSpaPath(pathname) {
  return SPA_ROUTES.has(pathname) || pathname.startsWith('/datasets/');
}

function isStaticPath(pathname) {
  return STATIC_PATHS.has(pathname) || pathname.startsWith('/assets/') || pathname.startsWith('/corpus/') || pathname.startsWith('/corpus-v1.1.0/') || pathname.startsWith('/verification-v0.1.0/');
}

function machineText(request, pathname) {
  const origin = new URL(request.url).origin;
  if (pathname === '/llms.txt') {
    return `# United States Health Systems Observatory (USHSO)\n\nUSHSO routes people and machines to authoritative health-systems data sources. It does not host the underlying datasets.\n\nAPI contract: ${origin}/api/contract\nDiscovery: POST ${origin}/api/discover with application/json (maximum request size: 20 KiB)\nCatalog browse: GET ${origin}/api/catalog\nStable record: GET ${origin}/api/datasets/{record_id}\nHuman and agent guide: ${origin}/agents\n\nA zero-result response is not evidence that no source exists. Results describe indexed metadata and access routes; users must follow each source's requirements.\n`;
  }
  if (pathname === '/robots.txt') return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
  if (pathname === '/sitemap.xml') {
    const pages = ['/', '/search', '/agents', '/sources', '/about', '/privacy', '/terms', '/contact'];
    const urls = pages.map(page => `  <url><loc>${origin}${page}</loc></url>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  }
  return null;
}

export function createWorker({ loadEngine = loadEngineFromAssets, loadCatalog = loadCatalogFromAssets } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const head = request.method === 'HEAD';

      if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') return corsPreflightResponse();

      if (url.pathname === '/api/health') {
        if (request.method !== 'GET' && !head) return errorResponse(405, 'method_not_allowed', 'Use GET or HEAD for this endpoint.');
        try {
          const engine = await loadEngine(request, env);
          const intent = engine.interpret({ question: 'health check' });
          return jsonResponse({ status: 'ok', service: 'ushso-discovery', contract_version: 'observatory-discovery-result.v1.0.0', compiler: intent.compiler }, { cacheControl: 'public, max-age=60', head });
        } catch {
          return errorResponse(503, 'corpus_unavailable', 'The published discovery corpus could not be loaded.', { head });
        }
      }

      if (url.pathname === '/api/contract') {
        if (request.method !== 'GET' && !head) return errorResponse(405, 'method_not_allowed', 'Use GET or HEAD for this endpoint.');
        try {
          const response = await env.ASSETS.fetch(new Request(new URL(`${CORPUS_BASE}/webmcp-tool.json`, request.url)));
          if (!response.ok) throw new Error('contract unavailable');
          return jsonResponse(await response.json(), { cacheControl: 'public, max-age=300', head });
        } catch {
          return errorResponse(503, 'contract_unavailable', 'The discovery contract could not be loaded.', { head });
        }
      }

      if (url.pathname === '/api/catalog') {
        if (request.method !== 'GET' && !head) return errorResponse(405, 'method_not_allowed', 'Use GET or HEAD for this endpoint.');
        try {
          return jsonResponse(browseResponse(await loadCatalog(request, env), catalogOptions(url)), { cacheControl: 'public, max-age=300', head });
        } catch (error) {
          if (error?.code === 'generation_unavailable') return errorResponse(410, 'generation_unavailable', error.message, { head });
          if (error instanceof TypeError) return errorResponse(400, error.code ?? 'invalid_catalog_query', error.message, { head });
          return errorResponse(503, 'catalog_unavailable', 'The published discovery catalog could not be loaded.', { head });
        }
      }

      if (url.pathname.startsWith('/api/datasets/')) {
        if (request.method !== 'GET' && !head) return errorResponse(405, 'method_not_allowed', 'Use GET or HEAD for this endpoint.');
        const requestedId = decodeURIComponent(url.pathname.slice('/api/datasets/'.length));
        try {
          const bundle = await loadCatalog(request, env);
          const record = bundle.records.find(candidate => candidate.record_id === requestedId || candidate.record_id === `obs:asset:${requestedId}` || candidate.record_id.replace(/^obs:asset:/, '') === requestedId);
          if (!record) return errorResponse(404, 'dataset_not_found', 'No published record has this identifier.', { head });
          return jsonResponse(datasetResponse(bundle, record), { cacheControl: 'public, max-age=300', head });
        } catch {
          return errorResponse(503, 'dataset_unavailable', 'The published record could not be loaded.', { head });
        }
      }

      if (url.pathname === '/api/discover') {
        if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST for discovery queries.');
        const contentType = request.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().startsWith('application/json')) return errorResponse(415, 'unsupported_media_type', 'Use application/json.');
        const declaredLength = Number(request.headers.get('content-length') ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) return errorResponse(413, 'request_too_large', 'The discovery request exceeds 20 KiB.');
        const bodyText = await request.text();
        if (new TextEncoder().encode(bodyText).byteLength > MAX_REQUEST_BYTES) return errorResponse(413, 'request_too_large', 'The discovery request exceeds 20 KiB.');
        let input;
        try {
          input = JSON.parse(bodyText);
        } catch {
          return errorResponse(400, 'invalid_json', 'The request body is not valid JSON.');
        }
        try {
          const engine = await loadEngine(request, env);
          return jsonResponse(engine.retrieve(input, { signal: request.signal }));
        } catch (error) {
          if (error?.code === 'generation_unavailable') return errorResponse(410, 'generation_unavailable', error.message);
          if (error instanceof TypeError) return errorResponse(400, error.code ?? 'invalid_query', error.message);
          return errorResponse(503, 'retrieval_unavailable', 'The published discovery corpus could not be queried.');
        }
      }

      if (url.pathname.startsWith('/api/')) return errorResponse(404, 'api_not_found', 'No API route exists at this path.', { head });

      const machineBody = machineText(request, url.pathname);
      if (machineBody !== null) {
        if (request.method !== 'GET' && !head) return textResponse('Method not allowed.\n', 'text/plain; charset=utf-8', { status: 405 });
        const contentType = url.pathname === '/sitemap.xml' ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8';
        return textResponse(machineBody, contentType, { cacheControl: 'public, max-age=300', head });
      }

      if (url.pathname === '/favicon.ico') return Response.redirect(new URL('/observatory-lighthouse.png', request.url), 308);
      if (isSpaPath(url.pathname) || isStaticPath(url.pathname)) return env.ASSETS.fetch(request);

      return textResponse('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found | USHSO</title></head><body><main><h1>Page not found</h1><p>No page exists at this address.</p></main></body></html>\n', 'text/html; charset=utf-8', { status: 404 });
    }
  };
}

export default createWorker();
