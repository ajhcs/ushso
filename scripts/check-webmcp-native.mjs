import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pageUrl = process.env.USHSO_WEBMCP_PAGE_URL ?? 'http://127.0.0.1:8799/';
const debuggerOrigin = process.env.USHSO_CHROME_DEBUGGER_ORIGIN ?? 'http://127.0.0.1:8798';
const receiptPath = process.argv.includes('--receipt')
  ? path.join(root, 'verification/catalog/v1.2.0/native-webmcp-receipt.json')
  : null;

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function pageSocketUrl() {
  const response = await fetch(`${debuggerOrigin}/json/list`);
  if (!response.ok) throw new Error(`CHROME_DEBUGGER_UNAVAILABLE:${response.status}`);
  const targets = await response.json();
  const target = targets.find(candidate => candidate.type === 'page');
  if (!target?.webSocketDebuggerUrl) throw new Error('CHROME_PAGE_TARGET_UNAVAILABLE');
  return target.webSocketDebuggerUrl;
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(`CDP_ERROR:${message.error.message}`));
    else resolve(message.result);
  });
  return {
    socket,
    call(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
  };
}

async function evaluate(client, expression) {
  const response = await client.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description
      ?? response.exceptionDetails.text
      ?? 'unknown evaluation error';
    throw new Error(`CHROME_EVALUATION_FAILED:${description}`);
  }
  return response.result?.value;
}

async function waitFor(client, expression, label, timeoutMilliseconds = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMilliseconds) {
    const value = await evaluate(client, expression);
    if (value) return value;
    await delay(100);
  }
  throw new Error(`CHROME_WAIT_TIMEOUT:${label}`);
}

const browserResponse = await fetch(`${debuggerOrigin}/json/version`);
if (!browserResponse.ok) throw new Error(`CHROME_VERSION_UNAVAILABLE:${browserResponse.status}`);
const browser = await browserResponse.json();
const client = await connect(await pageSocketUrl());

try {
  await client.call('Page.enable');
  await client.call('Runtime.enable');
  await client.call('Page.navigate', { url: pageUrl });
  await waitFor(client, 'document.readyState === "complete"', 'page-load');
  const surfaces = await evaluate(client, `({
    secure_context: globalThis.isSecureContext,
    document_model_context: typeof document.modelContext,
    navigator_model_context: typeof navigator.modelContext,
  })`);
  if (surfaces.document_model_context !== 'object' && surfaces.navigator_model_context !== 'object') {
    throw new Error(`WEBMCP_SURFACE_UNAVAILABLE:${JSON.stringify(surfaces)}`);
  }
  const surface = surfaces.document_model_context === 'object' ? 'document.modelContext' : 'navigator.modelContext';
  await waitFor(client, `typeof ${surface}.getTools === "function"`, `${surface}.getTools`);
  const discovered = await waitFor(client, `(async () => {
    const tools = await ${surface}.getTools();
    if (tools.length !== 8) return null;
    return tools.map(tool => ({
      name: tool.name,
      schema_self_contained: Boolean(tool.inputSchema && !JSON.stringify(tool.inputSchema).includes('common.schema.json')),
    }));
  })()`, 'eight-tools');

  const catalogResponse = await fetch(new URL('/api/catalog?limit=2', pageUrl));
  if (!catalogResponse.ok) throw new Error(`CATALOG_PREVIEW_UNAVAILABLE:${catalogResponse.status}`);
  const catalog = await catalogResponse.json();
  const [first, second] = catalog.results.map(result => result.record_id);
  if (!first || !second) throw new Error('CATALOG_PREVIEW_REQUIRES_TWO_RECORDS');
  const generation = catalog.corpus.publication.generation;
  const filters = {
    geography_ids: [], subject_ids: [], grain: [], access_classes: [], authority_levels: [],
    machine_readiness: [], time_period: null, negative_constraints: [], dimensions: [],
  };
  const inputs = {
    'observatory.search_assets': { contract_version: 'observatory.machine.search-assets.input.v1.0.0', mode: 'browse', filters, sort: 'title_asc', grouping: 'none', limit: 2, cursor: null, expected_generation: generation },
    'observatory.get_asset': { contract_version: 'observatory.machine.get-asset.input.v1.0.0', record_id: first, expected_generation: generation, collection_limits: { releases: 20, distributions: 20, documentation: 20, schemas: 20 }, collection_cursors: { releases: null, distributions: null, documentation: null, schemas: null } },
    'observatory.get_access_plan': { contract_version: 'observatory.machine.get-access-plan.input.v1.0.0', record_id: first, release_id: 'release.native-test', distribution_id: 'distribution.native-test', access_route_id: 'access.native-test', expected_generation: generation },
    'observatory.get_retrieval_recipe': { contract_version: 'observatory.machine.get-retrieval-recipe.input.v1.0.0', record_id: first, release_id: 'release.native-test', distribution_id: 'distribution.native-test', access_route_id: 'access.native-test', expected_generation: generation },
    'observatory.get_variables': { contract_version: 'observatory.machine.get-variables.input.v1.0.0', record_id: first, release_id: 'release.native-test', distribution_id: 'distribution.native-test', schema_id: 'schema.native-test', semantic_query: null, filters: [], limit: 25, cursor: null, expected_generation: generation },
    'observatory.get_join_routes': { contract_version: 'observatory.machine.get-join-routes.input.v1.0.0', from_id: first, to_id: second, from_release_id: null, to_release_id: null, research_purpose: null, include_indirect: false, max_hops: 1, limit: 20, expected_generation: generation },
    'observatory.compare_assets': { contract_version: 'observatory.machine.compare-assets.input.v1.0.0', asset_ids: [first, second], dimensions: ['access', 'freshness'], expected_generation: generation },
    'observatory.get_coverage_status': { contract_version: 'observatory.machine.get-coverage-status.input.v1.0.0', geography_ids: ['geo.us'], subject_ids: [], source_classes: [], time_period: null, authority_levels: ['authoritative'], limit: 25, cursor: null, expected_generation: generation },
  };

  const invocations = [];
  for (const [name, input] of Object.entries(inputs)) {
    const value = await evaluate(client, `(async () => {
      const tools = await ${surface}.getTools();
      const tool = tools.find(candidate => candidate.name === ${JSON.stringify(name)});
      if (!tool) throw new Error('TOOL_NOT_DISCOVERED');
      const serialized = await ${surface}.executeTool(tool, ${JSON.stringify(JSON.stringify(input))});
      const response = JSON.parse(serialized);
      return { name: tool.name, capability: response.capability, ok: response.ok, result_state: response.result_state, truth_boundary: response.truth_boundary };
    })()`);
    if (!value?.ok || Object.values(value.truth_boundary ?? {}).some(Boolean)) {
      throw new Error(`NATIVE_TOOL_INVOCATION_FAILED:${name}:${JSON.stringify(value)}`);
    }
    invocations.push(value);
  }

  const names = discovered.map(tool => tool.name).sort();
  const receipt = {
    schema_version: 'observatory-native-webmcp-receipt.v1.0.0',
    status: 'PASS',
    observed_at: new Date().toISOString(),
    browser: { product: browser.Browser, protocol_version: browser['Protocol-Version'], user_agent: browser['User-Agent'] },
    page_url: pageUrl,
    secure_context: await evaluate(client, 'globalThis.isSecureContext'),
    surface,
    primary_surface: 'document.modelContext',
    generation,
    discovered_tool_count: discovered.length,
    discovered_tools: discovered,
    planner_absent: !names.includes('observatory.plan_research'),
    all_schemas_self_contained: discovered.every(tool => tool.schema_self_contained),
    successful_invocation_count: invocations.length,
    invocations,
  };
  if (receipt.discovered_tool_count !== 8 || !receipt.planner_absent || !receipt.all_schemas_self_contained || receipt.successful_invocation_count !== 8) {
    throw new Error(`NATIVE_WEBMCP_GATE_FAILED:${JSON.stringify(receipt)}`);
  }
  if (receiptPath) {
    await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} finally {
  client.socket.close();
}
