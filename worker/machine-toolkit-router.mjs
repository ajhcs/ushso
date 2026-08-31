import { PUBLIC_CAPABILITY_FLAGS, TOOL_BY_CAPABILITY } from '../packages/machine-toolkit/src/index.mjs';

const MAX_INPUT_BYTES = 20480;
const encoder = new TextEncoder();

class HttpInputError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpInputError';
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

function httpError(error) {
  return jsonResponse({
    error: error.code ?? 'bad_request',
    message: error instanceof HttpInputError ? error.message : 'The request could not be decoded safely.'
  }, error.status ?? 400);
}

async function readBoundedJson(request) {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new HttpInputError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  const contentEncoding = request.headers.get('content-encoding');
  if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') throw new HttpInputError(415, 'content_encoding_not_supported', 'Compressed request bodies are not accepted.');
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_INPUT_BYTES)) throw new HttpInputError(413, 'input_limit_exceeded', 'Decoded input exceeds 20480 bytes.');
  if (!request.body) throw new HttpInputError(400, 'invalid_json', 'A JSON request body is required.');
  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_INPUT_BYTES) {
        await reader.cancel('input limit exceeded');
        throw new HttpInputError(413, 'input_limit_exceeded', 'Decoded input exceeds 20480 bytes.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(combined); }
  catch { throw new HttpInputError(400, 'invalid_utf8', 'The JSON body must be valid UTF-8.'); }
  try { return JSON.parse(text); }
  catch { throw new HttpInputError(400, 'invalid_json', 'The request body must be one JSON value.'); }
}

function scalar(parameters, name, fallback = null) {
  const values = parameters.getAll(name);
  if (values.length > 1) throw new HttpInputError(400, 'duplicate_parameter', `${name} may appear only once.`);
  return values.length === 1 ? values[0] : fallback;
}

function integerParameter(parameters, name, fallback) {
  const raw = scalar(parameters, name, null);
  if (raw === null) return fallback;
  if (!/^\d+$/u.test(raw)) throw new HttpInputError(400, 'invalid_parameter', `${name} must be an integer.`);
  return Number(raw);
}

function booleanParameter(parameters, name, fallback) {
  const raw = scalar(parameters, name, null);
  if (raw === null) return fallback;
  if (!['true', 'false'].includes(raw)) throw new HttpInputError(400, 'invalid_parameter', `${name} must be true or false.`);
  return raw === 'true';
}

function jsonParameter(parameters, name, fallback) {
  const raw = scalar(parameters, name, null);
  if (raw === null) return fallback;
  try { return JSON.parse(raw); }
  catch { throw new HttpInputError(400, 'invalid_parameter', `${name} must be JSON.`); }
}

function nullable(parameters, name) {
  const value = scalar(parameters, name, null);
  return value === '' ? null : value;
}

const GET_QUERY_PARAMETERS = Object.freeze({
  get_asset: new Set(['generation', 'releases_limit', 'distributions_limit', 'documentation_limit', 'schemas_limit', 'releases_cursor', 'distributions_cursor', 'documentation_cursor', 'schemas_cursor']),
  get_access_plan: new Set(['generation', 'release_id', 'distribution_id', 'access_route_id']),
  get_retrieval_recipe: new Set(['generation', 'release_id', 'distribution_id', 'access_route_id']),
  get_variables: new Set(['generation', 'release_id', 'distribution_id', 'schema_id', 'semantic_query', 'filters', 'limit', 'cursor']),
  get_join_routes: new Set(['generation', 'from_id', 'to_id', 'from_release_id', 'to_release_id', 'research_purpose', 'include_indirect', 'max_hops', 'limit']),
  get_coverage_status: new Set(['generation', 'geography_id', 'subject_id', 'source_class', 'time_period', 'authority_level', 'limit', 'cursor'])
});

function parseGetInput(capability, recordId, parameters) {
  const allowed = GET_QUERY_PARAMETERS[capability];
  for (const name of parameters.keys()) if (!allowed?.has(name)) throw new HttpInputError(400, 'unknown_parameter', 'The route contains an undeclared query parameter.');
  const expectedGeneration = nullable(parameters, 'generation');
  switch (capability) {
    case 'get_asset': return {
      contract_version: 'observatory.machine.get-asset.input.v1.0.0',
      record_id: recordId,
      expected_generation: expectedGeneration,
      collection_limits: Object.fromEntries(['releases', 'distributions', 'documentation', 'schemas'].map((name) => [name, integerParameter(parameters, `${name}_limit`, 20)])),
      collection_cursors: Object.fromEntries(['releases', 'distributions', 'documentation', 'schemas'].map((name) => [name, nullable(parameters, `${name}_cursor`)]))
    };
    case 'get_access_plan':
    case 'get_retrieval_recipe': return {
      contract_version: `observatory.machine.${capability === 'get_access_plan' ? 'get-access-plan' : 'get-retrieval-recipe'}.input.v1.0.0`,
      record_id: recordId,
      release_id: nullable(parameters, 'release_id'),
      distribution_id: nullable(parameters, 'distribution_id'),
      access_route_id: nullable(parameters, 'access_route_id'),
      expected_generation: expectedGeneration
    };
    case 'get_variables': return {
      contract_version: 'observatory.machine.get-variables.input.v1.0.0',
      record_id: recordId,
      release_id: nullable(parameters, 'release_id'),
      distribution_id: nullable(parameters, 'distribution_id'),
      schema_id: nullable(parameters, 'schema_id'),
      semantic_query: nullable(parameters, 'semantic_query'),
      filters: jsonParameter(parameters, 'filters', []),
      limit: integerParameter(parameters, 'limit', 25),
      cursor: nullable(parameters, 'cursor'),
      expected_generation: expectedGeneration
    };
    case 'get_join_routes': return {
      contract_version: 'observatory.machine.get-join-routes.input.v1.0.0',
      from_id: scalar(parameters, 'from_id', ''),
      to_id: nullable(parameters, 'to_id'),
      from_release_id: nullable(parameters, 'from_release_id'),
      to_release_id: nullable(parameters, 'to_release_id'),
      research_purpose: nullable(parameters, 'research_purpose'),
      include_indirect: booleanParameter(parameters, 'include_indirect', false),
      max_hops: integerParameter(parameters, 'max_hops', 1),
      limit: integerParameter(parameters, 'limit', 20),
      expected_generation: expectedGeneration
    };
    case 'get_coverage_status': return {
      contract_version: 'observatory.machine.get-coverage-status.input.v1.0.0',
      geography_ids: parameters.getAll('geography_id'),
      subject_ids: parameters.getAll('subject_id'),
      source_classes: parameters.getAll('source_class'),
      time_period: jsonParameter(parameters, 'time_period', null),
      authority_levels: parameters.getAll('authority_level'),
      limit: integerParameter(parameters, 'limit', 25),
      cursor: nullable(parameters, 'cursor'),
      expected_generation: expectedGeneration
    };
    default: throw new HttpInputError(404, 'route_not_found', 'No candidate route matches this request.');
  }
}

function matchRoute(pathname) {
  if (pathname === '/api/discover') return { capability: 'search_assets', recordId: null };
  if (pathname === '/api/compare-assets') return { capability: 'compare_assets', recordId: null };
  if (pathname === '/api/plan') return { capability: 'plan_research', recordId: null };
  if (pathname === '/api/join-routes') return { capability: 'get_join_routes', recordId: null };
  if (pathname === '/api/coverage/status') return { capability: 'get_coverage_status', recordId: null };
  const match = /^\/api\/datasets\/([^/]+)(?:\/(access-plan|retrieval-recipe|variables))?$/u.exec(pathname);
  if (!match) return null;
  let recordId;
  try { recordId = decodeURIComponent(match[1]); }
  catch { throw new HttpInputError(400, 'invalid_record_id', 'The record identifier encoding is invalid.'); }
  const capability = match[2] === 'access-plan' ? 'get_access_plan'
    : match[2] === 'retrieval-recipe' ? 'get_retrieval_recipe'
      : match[2] === 'variables' ? 'get_variables' : 'get_asset';
  return { capability, recordId };
}

function createRouter({ toolkit, expectedOrigin, flags }) {
  if (!toolkit || typeof toolkit.invokeJsonApi !== 'function') throw new TypeError('MACHINE_TOOLKIT_ADAPTER_REQUIRED');
  const origin = new URL(expectedOrigin).origin;
  return Object.freeze({
    async handle(request) {
      let url;
      try { url = new URL(request.url); }
      catch { return httpError(new HttpInputError(400, 'invalid_url', 'The request URL is invalid.')); }
      if (url.origin !== origin) return httpError(new HttpInputError(403, 'cross_origin_forbidden', 'Machine-toolkit routes are same-origin only.'));
      if (encoder.encode(url.href).byteLength > MAX_INPUT_BYTES) return httpError(new HttpInputError(413, 'input_limit_exceeded', 'The request URL exceeds 20480 bytes.'));
      let route;
      try { route = matchRoute(url.pathname); }
      catch (error) { return httpError(error); }
      if (!route) return null;
      const tool = TOOL_BY_CAPABILITY.get(route.capability);
      if (!flags[route.capability]) return jsonResponse({ error: 'capability_unavailable' }, 404);
      if (request.method !== tool.jsonApi.method) return jsonResponse({ error: 'method_not_allowed' }, 405, { Allow: tool.jsonApi.method });
      try {
        const input = request.method === 'POST' ? await readBoundedJson(request) : parseGetInput(route.capability, route.recordId, url.searchParams);
        const response = await toolkit.invokeJsonApi(route.capability, input, { signal: request.signal });
        return jsonResponse(response);
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        if (error instanceof HttpInputError) return httpError(error);
        throw error;
      }
    }
  });
}

export function createMachineToolkitRouter(options) {
  if (Object.hasOwn(options ?? {}, 'activationFlags') || Object.hasOwn(options ?? {}, 'candidateActivation')) {
    throw new TypeError('MACHINE_TOOLKIT_CALLER_ACTIVATION_FORBIDDEN');
  }
  return createRouter({ ...options, flags: PUBLIC_CAPABILITY_FLAGS });
}

export function createMachineToolkitLocalVerificationRouter(options) {
  if (Object.hasOwn(options ?? {}, 'activationFlags') || Object.hasOwn(options ?? {}, 'candidateActivation')) {
    throw new TypeError('MACHINE_TOOLKIT_CALLER_ACTIVATION_FORBIDDEN');
  }
  const flags = Object.freeze(Object.fromEntries(
    Object.keys(PUBLIC_CAPABILITY_FLAGS).map((capability) => [capability, capability !== 'plan_research'])
  ));
  return createRouter({ ...options, flags });
}
