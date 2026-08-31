import { createRetrievalEngine } from './retrieval-v1.1.0.mjs';
import { applyLiveVerificationReceipt } from './live-verification.mjs';
import { createStaticPublicQueryService } from './static-composition.mjs';

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
      const [recordsText, searchDocumentsText, routesText, vocabularyText, corpusText, verificationText] = await Promise.all([
        assetText(request, env, `${CORPUS_BASE}/records.jsonl`),
        assetText(request, env, `${CORPUS_BASE}/search-documents.jsonl`),
        assetText(request, env, `${CORPUS_BASE}/join-routes.jsonl`),
        assetText(request, env, `${CORPUS_BASE}/controlled-vocabulary.json`),
        assetText(request, env, `${CORPUS_BASE}/corpus.json`),
        assetText(request, env, LIVE_VERIFICATION_RECEIPT)
      ]);
      const records = applyLiveVerificationReceipt(parseJsonl(recordsText, 'records'), JSON.parse(verificationText));
      const searchDocuments = parseJsonl(searchDocumentsText, 'search-documents');
      const joinRoutes = parseJsonl(routesText, 'join-routes');
      const vocabulary = JSON.parse(vocabularyText);
      const corpus = JSON.parse(corpusText);
      return {
        records,
        searchDocuments,
        joinRoutes,
        vocabulary,
        corpus,
        engine: createRetrievalEngine({ records, searchDocuments, joinRoutes, vocabulary, corpus })
      };
    })());
  }
  return catalogByAssets.get(env.ASSETS);
}

export async function loadEngineFromAssets(request, env) {
  return (await loadCatalogFromAssets(request, env)).engine;
}

function parseLimit(url) {
  const requested = Number(url.searchParams.get('limit') ?? 200);
  if (!Number.isInteger(requested) || requested < 1) return 200;
  return Math.min(requested, 200);
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

export function createWorker({
  loadEngine = loadEngineFromAssets,
  loadCatalog = loadCatalogFromAssets,
  publicQueryService = createStaticPublicQueryService({ loadEngine, loadCatalog })
} = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const head = request.method === 'HEAD';

      if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') return corsPreflightResponse();

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
          const session = await publicQueryService.openRequest({ request, env });
          return jsonResponse(await publicQueryService.browse(session, parseLimit(url)), { cacheControl: 'public, max-age=300', head });
        } catch {
          return errorResponse(503, 'catalog_unavailable', 'The published discovery catalog could not be loaded.', { head });
        }
      }

      if (url.pathname.startsWith('/api/datasets/')) {
        if (request.method !== 'GET' && !head) return errorResponse(405, 'method_not_allowed', 'Use GET or HEAD for this endpoint.');
        const requestedId = decodeURIComponent(url.pathname.slice('/api/datasets/'.length));
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
          const session = await publicQueryService.openRequest({ request, env });
          return jsonResponse(await publicQueryService.discover(session, input));
        } catch (error) {
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

      if (url.pathname === '/favicon.ico') return Response.redirect(new URL('/observatory-lighthouse.png', request.url), 308);
      if (isSpaPath(url.pathname) || isStaticPath(url.pathname)) return env.ASSETS.fetch(request);

      return textResponse('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found | USHSO</title></head><body><main><h1>Page not found</h1><p>No page exists at this address.</p></main></body></html>\n', 'text/html; charset=utf-8', { status: 404 });
    }
  };
}

export default createWorker();
