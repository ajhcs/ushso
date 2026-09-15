import { loadLexicalArtifact } from '../packages/retrieval/tools/lexical-artifact.mjs';
import { createRetrievalEngine } from './retrieval-v1.2.0.mjs';
import { createWorkerMachineToolkit } from './machine-toolkit-adapter.mjs';
import { createMachineToolkitRouter } from './machine-toolkit-router.mjs';
import { createStaticPublicQueryService } from './static-composition.mjs';
import { createStaticMachineToolkitRuntime } from './static-machine-toolkit-service.mjs';
import { createMachineCursorSigner } from './machine-cursor.mjs';
import { routeDictionaryReview } from './dictionary-review-router.mjs';
import { routeScientificReview } from './scientific-review-router.mjs';
import { routeScientificConflicts } from './scientific-conflicts-router.mjs';
import { validateCatalogRecords } from '../packages/retrieval/tools/catalog-contract.mjs';
import {
  discardRequestBody,
  readBoundedText,
  RequestBodyTooLargeError,
} from './bounded-request-body.mjs';
import {
  CATALOG_HTML_GENERATION,
  renderCatalogSourceHtml,
  renderPublicSitemap,
} from '../packages/web-discoverability/src/catalog-html.mjs';

const MAX_REQUEST_BYTES = 20 * 1024;
const CORPUS_RESOURCE_BASE = '/corpus-v1.2.0';
const CORPUS_BASE = `${CORPUS_RESOURCE_BASE}/corpus`;
const catalogByAssets = new WeakMap();
const lexicalPinByAssets = new WeakMap();
const LEXICAL_BUILD_PIN = typeof USHSO_LEXICAL_BUILD_PIN === "undefined" ? null : USHSO_LEXICAL_BUILD_PIN;
const SPA_ROUTES = new Set(['/', '/search', '/learn', '/agents', '/sources', '/about', '/methods', '/plan', '/privacy', '/terms', '/contact', '/workspace', '/compare']);
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

export async function loadCatalogFromAssets(request, env, { diagnostic = null, lexicalExpected = LEXICAL_BUILD_PIN } = {}) {
  if (catalogByAssets.has(env?.ASSETS) && lexicalPinByAssets.get(env.ASSETS) !== JSON.stringify(lexicalExpected)) throw new Error('LEXICAL_OPTIONS_REQUIRE_FRESH_BINDING');
  const mark = (stage, asset_path = null) => { if (typeof diagnostic === 'function') diagnostic({ stage, asset_path, wall_ms: performance.now() }); };
  const measuredAssetText = async (...args) => { mark('asset_read_start', args[2]); const value = await assetText(...args); mark('asset_read_complete', args[2]); return value; };
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== 'function') throw new Error('STATIC_ASSET_BINDING_REQUIRED');
  if (!catalogByAssets.has(env.ASSETS)) {
    lexicalPinByAssets.set(env.ASSETS, JSON.stringify(lexicalExpected));
    catalogByAssets.set(env.ASSETS, (async () => {
      const [routesText, vocabularyText, corpusText, namedSourceRegistryText] = await Promise.all([
        measuredAssetText(request, env, `${CORPUS_BASE}/join-routes.jsonl`),
        measuredAssetText(request, env, `${CORPUS_RESOURCE_BASE}/fixtures/controlled-vocabulary.json`),
        measuredAssetText(request, env, `${CORPUS_BASE}/corpus.json`),
        measuredAssetText(request, env, `${CORPUS_RESOURCE_BASE}/fixtures/named-source-registry.json`).catch(() => null),
      ]);
      const corpus = JSON.parse(corpusText);
      if (!Array.isArray(corpus.record_files) || !Array.isArray(corpus.search_document_files)) throw new Error('CORPUS_SHARD_MANIFEST_REQUIRED');
      const [recordShards, searchDocumentShards] = await Promise.all([
        Promise.all(corpus.record_files.map(file => measuredAssetText(request, env, `${CORPUS_BASE}/${file}`))),
        Promise.all(corpus.search_document_files.map(file => measuredAssetText(request, env, `${CORPUS_BASE}/${file}`))),
      ]);
      mark('jsonl_parse_start');
      const rawRecords = recordShards.flatMap((text, index) => parseJsonl(text, `records:${corpus.record_files[index]}`));
      mark('jsonl_parse_complete');
      mark('catalog_validation_start');
      const catalogValidation = validateCatalogRecords(rawRecords);
      mark('catalog_validation_complete');
      const records = catalogValidation.valid;
      // Search-document projections duplicate most catalog strings and push the
      // isolate over its memory ceiling during repeated broad queries. The
      // runtime validates their published line count, then builds a compact,
      // bounded text index from the canonical records instead.
      const searchDocumentCount = searchDocumentShards.reduce((total, text) =>
        total + text.split(/\r?\n/).filter(Boolean).length, 0);
      const joinRoutes = parseJsonl(routesText, 'join-routes');
      const vocabulary = JSON.parse(vocabularyText);
      const namedSourceRegistry = namedSourceRegistryText ? JSON.parse(namedSourceRegistryText) : null;
      if (rawRecords.length !== corpus.record_count || searchDocumentCount !== corpus.search_document_count) throw new Error('CORPUS_SHARD_COUNT_MISMATCH');
      let lexicalArtifact = null;
      if (lexicalExpected) {
        // This option is injected by a local harness/build-pinned configuration,
        // never populated from a request or an index's self-claimed metadata.
        const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
        const observedGeneration = corpus.publication?.generation;
        if (observedGeneration !== lexicalExpected.generation
          || await digest(corpusText) !== lexicalExpected.corpus_sha256
          || await digest(recordShards.join('')) !== lexicalExpected.source_sha256
          || await digest(vocabularyText) !== lexicalExpected.vocabulary_sha256) throw new Error('LEXICAL_LOADER_SOURCE_MISMATCH');
        mark('lexical_asset_read_start');
        const response = await env.ASSETS.fetch(new Request(new URL(`${CORPUS_BASE}/lexical-index.json`, request.url)));
        if (!response.ok || !response.body) throw new Error('LEXICAL_ASSET_UNAVAILABLE');
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try { for (;;) { const {done, value} = await reader.read(); if(done) break; size += value.byteLength; if(size > 8*1024*1024) throw new Error('LEXICAL_SIZE_INVALID'); chunks.push(value); } }
        finally { await reader.cancel(); reader.releaseLock(); }
        const bytes = new Uint8Array(size); let offset = 0; for(const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        mark('lexical_asset_read_complete');
        lexicalArtifact = await loadLexicalArtifact(bytes, lexicalExpected, records.map(record => record.record_id));
        mark('lexical_asset_verified');
      }
      return {
        records,
        catalogIssues: catalogValidation.invalid,
        // Preserve the repository bundle contract. This generation publishes
        // no projection shards; the engine uses its compact canonical index.
        searchDocuments: [],
        joinRoutes,
        vocabulary,
        corpus,
        namedSourceRegistry,
        engine: createRetrievalEngine({ diagnostic, lexicalArtifact, records, searchDocuments: null, joinRoutes, vocabulary, corpus, namedSourceRegistry, catalogValidation })
      };
    })());
  }
  return catalogByAssets.get(env.ASSETS);
}

export async function loadEngineFromAssets(request, env) {
  return (await loadCatalogFromAssets(request, env)).engine;
}

function parsePageSize(value, fallback = 20) {
  const requested = Number(value ?? fallback);
  if (!Number.isInteger(requested) || requested < 1) return fallback;
  return Math.min(requested, 200);
}

function catalogOptions(url) {
  const sort = url.searchParams.get('sort') ?? 'canonical_relevance';
  if (!new Set(['canonical_relevance', 'title_asc', 'release_newest', 'observation_latest']).has(sort)) {
    const error = new TypeError(`Unsupported sort: ${sort}`);
    error.code = 'unsupported_sort';
    throw error;
  }
  const facetFilters = {};
  for (const filter of url.searchParams.getAll('filter')) {
    const separator = filter.indexOf(':');
    if (separator < 1 || separator === filter.length - 1) {
      const error = new TypeError(`Invalid facet filter: ${filter}`);
      error.code = 'invalid_filter';
      throw error;
    }
    const key = filter.slice(0, separator);
    facetFilters[key] = [...(facetFilters[key] ?? []), filter.slice(separator + 1)];
  }
  return {
    page_size: parsePageSize(url.searchParams.get('page_size') ?? url.searchParams.get('limit')),
    sort,
    facet_filters: facetFilters,
    cursor: url.searchParams.get('cursor') ?? null,
    generation: url.searchParams.get('generation') ?? null,
  };
}

function isSpaPath(pathname) {
  return SPA_ROUTES.has(pathname) || pathname.startsWith('/datasets/');
}

function isStaticPath(pathname) {
  return STATIC_PATHS.has(pathname) || pathname.startsWith('/assets/') || pathname.startsWith('/corpus/') || pathname.startsWith('/corpus-v1.1.0/') || pathname.startsWith('/corpus-v1.2.0/') || pathname.startsWith('/contracts/') || pathname.startsWith('/verification-v0.1.0/');
}

function machineText(request, pathname) {
  const origin = new URL(request.url).origin;
  if (pathname === '/llms.txt') {
    return `# United States Health Systems Observatory (USHSO)\n\nUSHSO routes people and machines to authoritative health-systems data sources. It does not host the underlying datasets.\n\nAPI contract: ${origin}/api/contract\nHuman discovery: POST ${origin}/api/discover with application/json (maximum request size: 20 KiB)\nCatalog browse: GET ${origin}/api/catalog\nStable human-facing record: GET ${origin}/api/datasets/{record_id}\nMachine toolkit: eight read-only inspection routes under ${origin}/api/machine/v1/\nHuman and agent guide: ${origin}/agents\n\nVerification means the first-party catalog metadata entry was observed live for the published snapshot. It does not assert dataset-payload availability, schema completeness, authorization, geographic coverage, or analytic fitness. A zero-result response is not evidence that no source exists. A successful tool envelope is not a completed research task.\n`;
  }
  if (pathname === '/robots.txt') return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
  return null;
}

function matchCatalogRecord(records, requestedId) {
  const needle = requestedId.replace(/^obs:asset:/, '');
  return records.find((record) => record.record_id === requestedId || record.record_id.replace(/^obs:asset:/, '') === needle) ?? null;
}

function mergeCrawlerIntoSpa(spaText, crawlerHtml) {
  const body = crawlerHtml.match(/<body>([\s\S]*)<\/body>/i)?.[1] ?? '';
  const title = crawlerHtml.match(/<title>[\s\S]*?<\/title>/i)?.[0] ?? '';
  const canonical = crawlerHtml.match(/<link rel="canonical"[^>]*>/i)?.[0] ?? '';
  const jsonLd = crawlerHtml.match(/<script type="application\/ld\+json"[\s\S]*?<\/script>/i)?.[0] ?? '';
  if (!spaText.includes('<div id="root"></div>')) return crawlerHtml;
  let page = spaText.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  if (title) page = page.replace(/<title>[\s\S]*?<\/title>/i, title);
  if (canonical || jsonLd) page = page.replace('</head>', `${canonical}${jsonLd}</head>`);
  return page;
}

export function createWorker({
  loadEngine = loadEngineFromAssets,
  loadCatalog = loadCatalogFromAssets,
  publicQueryService = createStaticPublicQueryService({ loadEngine, loadCatalog })
} = {}) {
  const localCursorSigner = createMachineCursorSigner();
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const head = request.method === 'HEAD';

      if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') return corsPreflightResponse();

      if (url.pathname === '/api/research/v1/scientific-review') {
        return routeScientificReview(request, env, { loadCatalog });
      }
      if (url.pathname === '/api/research/v1/scientific-conflicts') {
        return routeScientificConflicts(request, env, { loadCatalog });
      }
      if (url.pathname === '/api/research/v1/dictionary-review') {
        // Scientific notes use a separate, disabled-by-default review endpoint.
        const cursorSigner = env.USHSO_CURSOR_SIGNING_KEY === undefined ? localCursorSigner
          : createMachineCursorSigner({ signingKey: env.USHSO_CURSOR_SIGNING_KEY });
        return routeDictionaryReview(request, env, { loadCatalog, cursorSigner });
      }

      if (url.pathname.startsWith('/api/machine/v1/')) {
        // The public eight-tool contract never includes pending scientific notes.
        try {
          const catalog = await loadCatalog(request, env);
          const cursorSigner = env.USHSO_CURSOR_SIGNING_KEY === undefined ? localCursorSigner
            : createMachineCursorSigner({ signingKey: env.USHSO_CURSOR_SIGNING_KEY });
          const runtime = createStaticMachineToolkitRuntime(catalog, { cursorSigner });
          const toolkit = createWorkerMachineToolkit({ operations: runtime.operations, responseContext: runtime.context });
          const router = createMachineToolkitRouter({ toolkit, expectedOrigin: url.origin });
          return await router.handle(request)
            ?? errorResponse(404, 'api_not_found', 'No machine-toolkit route exists at this path.');
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          return errorResponse(503, 'machine_toolkit_unavailable', 'The published machine toolkit could not safely serve this request.');
        }
      }

      if (url.pathname === '/api/health') {
        if (request.method !== 'GET' && !head) return errorResponse(405, 'method_not_allowed', 'Use GET or HEAD for this endpoint.');
        try {
          const session = await publicQueryService.openRequest({ request, env });
          return jsonResponse(await publicQueryService.health(session), { cacheControl: 'public, max-age=60', head });
        } catch {
          return errorResponse(503, 'corpus_unavailable', 'The published discovery corpus could not be loaded.', { head });
        }
      }

      if (url.pathname === '/api/contract') {
        if (request.method !== 'GET' && !head) return errorResponse(405, 'method_not_allowed', 'Use GET or HEAD for this endpoint.');
        try {
          const response = await env.ASSETS.fetch(new Request(new URL(`${CORPUS_RESOURCE_BASE}/webmcp-tool.json`, request.url)));
          if (!response.ok) throw new Error('contract unavailable');
          return jsonResponse(await response.json(), { cacheControl: 'public, max-age=300', head });
        } catch {
          return errorResponse(503, 'contract_unavailable', 'The discovery contract could not be loaded.', { head });
        }
      }

      if (url.pathname === '/api/catalog') {
        if (request.method !== 'GET' && !head) return errorResponse(405, 'method_not_allowed', 'Use GET or HEAD for this endpoint.');
        try {
          const session = await publicQueryService.openRequest({ request, env });
          return jsonResponse(await publicQueryService.browse(session, catalogOptions(url)), { cacheControl: 'public, max-age=300', head });
        } catch (error) {
          if (error?.code === 'generation_unavailable') return errorResponse(410, 'generation_unavailable', error.message, { head });
          if (error instanceof TypeError) return errorResponse(400, error.code ?? 'invalid_catalog_query', error.message, { head });
          return errorResponse(503, 'catalog_unavailable', 'The published discovery catalog could not be loaded.', { head });
        }
      }

      if (url.pathname.startsWith('/api/datasets/')) {
        if (request.method !== 'GET' && !head) return errorResponse(405, 'method_not_allowed', 'Use GET or HEAD for this endpoint.');
        let requestedId;
        try {
          requestedId = decodeURIComponent(url.pathname.slice('/api/datasets/'.length));
        } catch {
          return errorResponse(400, 'invalid_record_id', 'The record identifier encoding is invalid.', { head });
        }
        try {
          const session = await publicQueryService.openRequest({ request, env });
          const result = await publicQueryService.dataset(session, requestedId);
          if (!result) return errorResponse(404, 'dataset_not_found', 'No published record has this identifier.', { head });
          return jsonResponse(result, { cacheControl: 'public, max-age=300', head });
        } catch {
          return errorResponse(503, 'dataset_unavailable', 'The published record could not be loaded.', { head });
        }
      }

      if (url.pathname === '/api/discover') {
        if (request.method !== 'POST') {
          await discardRequestBody(request, MAX_REQUEST_BYTES);
          return errorResponse(405, 'method_not_allowed', 'Use POST for discovery queries.');
        }
        const contentType = request.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().startsWith('application/json')) {
          await discardRequestBody(request, MAX_REQUEST_BYTES);
          return errorResponse(415, 'unsupported_media_type', 'Use application/json.');
        }
        const declaredLength = Number(request.headers.get('content-length') ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
          await discardRequestBody(request, MAX_REQUEST_BYTES);
          return errorResponse(413, 'request_too_large', 'The discovery request exceeds 20 KiB.');
        }
        let bodyText;
        try {
          bodyText = await readBoundedText(request, MAX_REQUEST_BYTES);
        } catch (error) {
          if (error instanceof RequestBodyTooLargeError) return errorResponse(413, 'request_too_large', 'The discovery request exceeds 20 KiB.');
          return errorResponse(400, 'invalid_json', 'The request body could not be decoded safely.');
        }
        let input;
        try {
          input = JSON.parse(bodyText);
        } catch {
          return errorResponse(400, 'invalid_json', 'The request body is not valid JSON.');
        }
        try {
          const session = await publicQueryService.openRequest({ request, env });
          return jsonResponse(await publicQueryService.discover(session, input));
        } catch (error) {
          if (error?.code === 'generation_unavailable') return errorResponse(410, 'generation_unavailable', error.message);
          if (error instanceof TypeError) return errorResponse(400, 'invalid_query', error.message);
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

      if (url.pathname.startsWith('/contracts/')) {
        if (request.method !== 'GET' && !head) return errorResponse(405, 'method_not_allowed', 'Use GET or HEAD for this endpoint.');
        const asset = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
        const contentType = asset.headers.get('content-type') ?? '';
        if (!asset.ok) return errorResponse(404, 'schema_not_found', 'No contract schema exists at this path.', { head });
        const body = await asset.text();
        const looksHtml = /^\s*</.test(body) || /text\/html/i.test(contentType);
        if (looksHtml || !/^application\/json(?:;|$)/i.test(contentType)) {
          return errorResponse(415, 'schema_not_json', 'HTML fallback cannot satisfy a contract schema URL.', { head });
        }
        try {
          return jsonResponse(JSON.parse(body), { cacheControl: 'public, max-age=300', head });
        } catch {
          return errorResponse(415, 'schema_not_json', 'HTML fallback cannot satisfy a contract schema URL.', { head });
        }
      }

      if (url.pathname === '/favicon.ico') return Response.redirect(new URL('/observatory-lighthouse.png', request.url), 308);

      if (url.pathname === '/sitemap.xml') {
        if (request.method !== 'GET' && !head) return textResponse('Method not allowed.\n', 'text/plain; charset=utf-8', { status: 405 });
        let ids = [];
        try {
          const catalog = await loadCatalog(request, env);
          ids = (catalog.records ?? []).slice(0, 50).map((record) => record.record_id);
        } catch {
          ids = [];
        }
        return textResponse(renderPublicSitemap(url.origin, { recordIds: ids }), 'application/xml; charset=utf-8', { cacheControl: 'public, max-age=300', head });
      }

      if (url.pathname.startsWith('/datasets/')) {
        if (request.method !== 'GET' && !head) return textResponse('Method not allowed.\n', 'text/plain; charset=utf-8', { status: 405 });
        let requestedId;
        try {
          requestedId = decodeURIComponent(url.pathname.slice('/datasets/'.length));
        } catch {
          return textResponse('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Invalid record identifier | USHSO</title></head><body><main><h1>Invalid record identifier</h1><p>The record identifier encoding is invalid.</p></main></body></html>\n', 'text/html; charset=utf-8', { status: 400, head });
        }
        if (requestedId && !requestedId.includes('/')) {
          try {
            const catalog = await loadCatalog(request, env);
            const record = matchCatalogRecord(catalog.records ?? [], requestedId);
            if (!record) {
              return textResponse('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dataset record not found | USHSO</title></head><body><main><h1>Dataset record not found</h1><p>No published record has this identifier in the current catalog generation. A missing record is not replaced with a silent stale-context page.</p></main></body></html>\n', 'text/html; charset=utf-8', { status: 404, head });
            }
            const generation = catalog.corpus?.publication?.generation ?? catalog.corpus?.generation ?? CATALOG_HTML_GENERATION;
            const crawlerHtml = renderCatalogSourceHtml(record, { origin: url.origin, generation });
            const spa = await env.ASSETS.fetch(new Request(new URL('/', request.url), { method: 'GET' }));
            const spaText = spa.ok ? await spa.text() : '';
            const page = mergeCrawlerIntoSpa(spaText, crawlerHtml);
            return textResponse(page, 'text/html; charset=utf-8', { cacheControl: 'public, max-age=300', head });
          } catch {
            return textResponse('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Source details are unavailable | USHSO</title></head><body><main><h1>Source details are unavailable</h1><p>The published record could not be loaded.</p></main></body></html>\n', 'text/html; charset=utf-8', { status: 503, head });
          }
        }
      }

      if (isSpaPath(url.pathname) || isStaticPath(url.pathname)) return env.ASSETS.fetch(request);

      return textResponse('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found | USHSO</title></head><body><main><h1>Page not found</h1><p>No page exists at this address.</p></main></body></html>\n', 'text/html; charset=utf-8', { status: 404 });
    }
  };
}

export default createWorker();
