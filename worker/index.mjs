import { createRetrievalEngine } from '../packages/retrieval/tools/retrieval-core.mjs';

const MAX_REQUEST_BYTES = 20 * 1024;
const engineByAssets = new WeakMap();

function jsonResponse(value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('cache-control', init.cacheControl ?? 'no-store');
  return new Response(`${JSON.stringify(value)}\n`, { ...init, headers });
}

function errorResponse(status, code, message) {
  return jsonResponse({ error: { code, message } }, { status });
}

async function assetText(request, env, pathname) {
  const url = new URL(pathname, request.url);
  const response = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
  if (!response.ok) throw new Error(`CORPUS_ASSET_UNAVAILABLE:${pathname}:${response.status}`);
  return response.text();
}

function parseJsonl(text, label) {
  return text.trim().split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`INVALID_CORPUS_JSONL:${label}:${index + 1}`);
    }
  });
}

export async function loadEngineFromAssets(request, env) {
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== 'function') throw new Error('STATIC_ASSET_BINDING_REQUIRED');
  if (!engineByAssets.has(env.ASSETS)) {
    engineByAssets.set(env.ASSETS, (async () => {
      const [recordsText, searchDocumentsText, routesText, vocabularyText, corpusText] = await Promise.all([
        assetText(request, env, '/corpus/records.jsonl'),
        assetText(request, env, '/corpus/search-documents.jsonl'),
        assetText(request, env, '/corpus/join-routes.jsonl'),
        assetText(request, env, '/corpus/controlled-vocabulary.json'),
        assetText(request, env, '/corpus/corpus.json')
      ]);
      return createRetrievalEngine({
        records: parseJsonl(recordsText, 'records'),
        searchDocuments: parseJsonl(searchDocumentsText, 'search-documents'),
        joinRoutes: parseJsonl(routesText, 'join-routes'),
        vocabulary: JSON.parse(vocabularyText),
        corpus: JSON.parse(corpusText)
      });
    })());
  }
  return engineByAssets.get(env.ASSETS);
}

export function createWorker({ loadEngine = loadEngineFromAssets } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === '/api/health') {
        if (request.method !== 'GET') return errorResponse(405, 'method_not_allowed', 'Use GET for this endpoint.');
        try {
          const engine = await loadEngine(request, env);
          const intent = engine.interpret({ question: 'health check' });
          return jsonResponse({ status: 'ok', service: 'ushso-discovery', contract_version: 'observatory-discovery-result.v1.0.0', compiler: intent.compiler }, { cacheControl: 'public, max-age=60' });
        } catch {
          return errorResponse(503, 'corpus_unavailable', 'The published discovery corpus could not be loaded.');
        }
      }

      if (url.pathname === '/api/contract') {
        if (request.method !== 'GET') return errorResponse(405, 'method_not_allowed', 'Use GET for this endpoint.');
        try {
          const response = await env.ASSETS.fetch(new Request(new URL('/corpus/webmcp-tool.json', request.url)));
          if (!response.ok) throw new Error('contract unavailable');
          return jsonResponse(await response.json(), { cacheControl: 'public, max-age=300' });
        } catch {
          return errorResponse(503, 'contract_unavailable', 'The discovery contract could not be loaded.');
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
          if (error instanceof TypeError) return errorResponse(400, 'invalid_query', error.message);
          return errorResponse(503, 'retrieval_unavailable', 'The published discovery corpus could not be queried.');
        }
      }

      if (url.pathname.startsWith('/api/')) return errorResponse(404, 'api_not_found', 'No API route exists at this path.');
      return env.ASSETS.fetch(request);
    }
  };
}

export default createWorker();
