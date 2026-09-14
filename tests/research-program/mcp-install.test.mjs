import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker } from '../../worker/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pluginRoot = path.join(root, 'plugins/ushso-research');
const setupDoc = await fs.readFile(path.join(root, 'docs/research-program/mcp-setup.md'), 'utf8');
const pluginReadme = await fs.readFile(path.join(pluginRoot, 'README.md'), 'utf8');
const pluginPackage = JSON.parse(await fs.readFile(path.join(pluginRoot, 'package.json'), 'utf8'));
const tools = JSON.parse(await fs.readFile(path.join(pluginRoot, 'assets/tools.json'), 'utf8'));
const discovery = JSON.parse(await fs.readFile(path.join(pluginRoot, 'assets/discovery.json'), 'utf8'));
const webmcp = JSON.parse(await fs.readFile(path.join(root, 'packages/machine-toolkit/public-webmcp-tool.json'), 'utf8'));
const workerSource = await fs.readFile(path.join(root, 'worker/index.mjs'), 'utf8');
const advertised = [
  'observatory.search_assets',
  'observatory.get_asset',
  'observatory.get_access_plan',
  'observatory.get_retrieval_recipe',
  'observatory.get_variables',
  'observatory.get_join_routes',
  'observatory.compare_assets',
  'observatory.get_coverage_status',
];

function emptyFilters() {
  return {
    geography_ids: [], subject_ids: [], grain: [], access_classes: [], authority_levels: [],
    machine_readiness: [], time_period: null, negative_constraints: [], dimensions: [],
  };
}

async function copyCleanInstall() {
  const dest = await fs.mkdtemp(path.join(os.tmpdir(), 'ushso-pr060-mcp-'));
  await fs.cp(pluginRoot, dest, { recursive: true });
  return dest;
}

async function loadCorpusCatalog() {
  const versionRoot = path.join(root, 'packages/retrieval/versions/v1.2.0');
  const corpus = JSON.parse(await fs.readFile(path.join(versionRoot, 'corpus/corpus.json'), 'utf8'));
  return { versionRoot, corpus };
}

function createAssetEnv(versionRoot) {
  return {
    ASSETS: {
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        if (!pathname.startsWith('/corpus-v1.2.0/')) return new Response('', { status: 404 });
        try {
          const bytes = await fs.readFile(path.join(versionRoot, pathname.slice('/corpus-v1.2.0/'.length)));
          return new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } });
        } catch {
          return new Response('', { status: 404 });
        }
      },
    },
  };
}

async function startLocalOrigin(env) {
  const worker = createWorker();
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const url = `http://127.0.0.1:${server.address().port}${req.url}`;
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const method = req.method ?? 'GET';
      const body = method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks);
      const response = await worker.fetch(new Request(url, { method, headers, body }), env);
      res.statusCode = response.status;
      for (const [name, value] of response.headers) res.setHeader(name, value);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.statusCode = 500;
      res.end(String(error?.message ?? error));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function rpc(id, method, params) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

async function withStdioServer(installRoot, origin, fn) {
  const child = spawn(process.execPath, [path.join(installRoot, 'scripts/mcp.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, USHSO_API_ORIGIN: origin },
  });
  let stdout = '';
  let stderr = '';
  const pending = new Map();
  const handleLine = (line) => {
    if (!line) return;
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    }
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    const parts = stdout.split('\n');
    stdout = parts.pop() ?? '';
    for (const line of parts) handleLine(line);
  });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const send = (message) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP_TIMEOUT:${message.method}`)), 15000);
    pending.set(message.id, (value) => { clearTimeout(timer); resolve(value); });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
  try {
    return await fn({ send, child });
  } finally {
    child.stdin.end();
    await new Promise((resolve) => child.once('close', resolve));
    assert.equal(stderr, '');
  }
}

test('packaged plugin files, manifests and Node-only startup exist without development-checkout imports', async () => {
  const required = [
    'package.json',
    'scripts/mcp.mjs',
    'scripts/client.mjs',
    'assets/tools.json',
    'assets/discovery.json',
    'assets/source-identity.json',
    '.mcp.json',
    'README.md',
  ];
  for (const rel of required) {
    const st = await fs.stat(path.join(pluginRoot, rel));
    assert.equal(st.isFile(), true, rel);
  }
  const mcpSource = await fs.readFile(path.join(pluginRoot, 'scripts/mcp.mjs'), 'utf8');
  const clientSource = await fs.readFile(path.join(pluginRoot, 'scripts/client.mjs'), 'utf8');
  assert.doesNotMatch(mcpSource, /\.\.\/\.\.\/packages\/|node_modules/);
  assert.doesNotMatch(clientSource, /\.\.\/\.\.\/packages\/|node_modules/);
  assert.equal(pluginPackage.engines.node, '>=22.15.0');
  assert.equal(pluginPackage.dependencies, undefined);
  assert.equal(discovery.enabled_tool_count, 8);
  assert.equal(discovery.planner_enabled, false);
  assert.deepEqual(tools.map((tool) => tool.name), advertised);
  assert.equal(tools.some((tool) => tool.name === 'observatory.plan_research' || tool.capability === 'plan_research'), false);
  assert.deepEqual(discovery.disabled_tools.map((tool) => tool.capability), ['plan_research']);
  assert.deepEqual(discovery.tools.map((tool) => tool.capability), webmcp.tools.map((tool) => tool.capability));
  assert.equal(discovery.protocol_success_is_not_completed_research_task, true);
  assert.equal(workerSource.includes('packages/enrichment'), false);
});

test('a clean temporary installation initializes, lists eight tools and exits without the development checkout', async () => {
  const installRoot = await copyCleanInstall();
  try {
    assert.equal(installRoot.startsWith(root), false);
    const listed = await withStdioServer(installRoot, 'https://ushso.org', async ({ send }) => {
      const initialized = await send(rpc(1, 'initialize'));
      assert.equal(initialized.result.serverInfo.name, 'ushso-research');
      assert.equal(initialized.result.serverInfo.version, '0.1.0');
      const listedTools = await send(rpc(2, 'tools/list'));
      return listedTools.result.tools.map((tool) => tool.name);
    });
    assert.deepEqual(listed, advertised);
    assert.equal(listed.includes('observatory.plan_research'), false);
  } finally {
    await fs.rm(installRoot, { recursive: true, force: true });
  }
});

test('setup instructions avoid unsupported native WebMCP promises and keep HTTP as the tested fallback', () => {
  for (const text of [setupDoc, pluginReadme]) {
    assert.match(text, /stdio/i);
    assert.match(text, /\/api\/machine\/v1/);
    assert.match(text, /unsupported browsers/i);
    assert.match(text, /tested fallback/i);
    assert.match(text, /Marketplace UI installation is not claimed/i);
    assert.doesNotMatch(text, /works in every browser|available in all browsers/i);
    assert.match(text, /successful tool envelope is not a completed research task/i);
    for (const name of advertised) assert.match(text, new RegExp(name.replace('.', '\\.')));
    assert.match(text, /plan_research/i);
    assert.match(text, /disabled/i);
  }
});

test('actual packaged stdio JSON-RPC performs source inspection, typed negatives and generation restart', async () => {
  const { versionRoot, corpus } = await loadCorpusCatalog();
  const env = createAssetEnv(versionRoot);
  const origin = await startLocalOrigin(env);
  const installRoot = await copyCleanInstall();
  const transcript = [];
  try {
    await withStdioServer(installRoot, origin.origin, async ({ send }) => {
      const record = async (message) => {
        transcript.push({ request: message });
        const response = await send(message);
        transcript.at(-1).response = response;
        return response;
      };
      const initialized = await record(rpc(1, 'initialize'));
      assert.equal(initialized.result.serverInfo.version, pluginPackage.version);
      const listed = await record(rpc(2, 'tools/list'));
      assert.deepEqual(listed.result.tools.map((tool) => tool.name), advertised);
      const missingPlanner = await record(rpc(3, 'tools/call', { name: 'observatory.plan_research', arguments: {} }));
      assert.equal(missingPlanner.error.code, -32602);
      const searchInput = {
        contract_version: 'observatory.machine.search-assets.input.v1.0.0',
        mode: 'search',
        research_need: 'CMS HCRIS hospital cost reports',
        filters: emptyFilters(),
        grouping: 'none',
        limit: 5,
        cursor: null,
        expected_generation: corpus.publication.generation,
      };
      const search = await record(rpc(4, 'tools/call', { name: 'observatory.search_assets', arguments: searchInput }));
      assert.equal(search.result.isError, false);
      assert.equal(search.result.structuredContent.ok, true);
      assert.equal(search.result.structuredContent.truth_boundary.payloads_acquired, false);
      const recordId = search.result.structuredContent.result.summaries[0].asset_id;
      const generation = search.result.structuredContent.index_generation;
      const asset = await record(rpc(5, 'tools/call', {
        name: 'observatory.get_asset',
        arguments: {
          contract_version: 'observatory.machine.get-asset.input.v1.0.0',
          record_id: recordId,
          expected_generation: generation,
          collection_limits: { releases: 20, distributions: 20, documentation: 20, schemas: 20 },
          collection_cursors: { releases: null, distributions: null, documentation: null, schemas: null },
        },
      }));
      assert.equal(asset.result.structuredContent.ok, true);
      const variables = await record(rpc(6, 'tools/call', {
        name: 'observatory.get_variables',
        arguments: {
          contract_version: 'observatory.machine.get-variables.input.v1.0.0',
          record_id: recordId,
          release_id: 'release.test',
          distribution_id: 'distribution.test',
          schema_id: 'schema.test',
          semantic_query: null,
          filters: [],
          limit: 25,
          cursor: null,
          expected_generation: generation,
        },
      }));
      assert.equal(variables.result.isError, false);
      assert.equal(variables.result.structuredContent.ok, false);
      assert.equal(variables.result.structuredContent.result_state, 'unknown');
      assert.equal(variables.result.structuredContent.result, null);
      assert.equal(variables.result.structuredContent.error.code, 'schema_context_required');
      const stale = await record(rpc(7, 'tools/call', {
        name: 'observatory.search_assets',
        arguments: { ...searchInput, expected_generation: 'generation.stale', cursor: search.result.structuredContent.next_cursor },
      }));
      assert.equal(stale.result.structuredContent.ok, false);
      assert.equal(stale.result.structuredContent.error.code, 'generation_unavailable');
      assert.equal(stale.result.structuredContent.result, null);
      assert.match(stale.result.structuredContent.error.corrective_guidance, /pin to the newly returned generation|without a cursor/i);
    });
  } finally {
    await origin.close();
    const evidenceDir = path.join(root, 'verification/research-program/pr-060/producer-20260914');
    await fs.mkdir(evidenceDir, { recursive: true });
    await fs.writeFile(path.join(evidenceDir, 'stdio-journey.json'), `${JSON.stringify({ plugin_version: pluginPackage.version, origin: origin.origin, transcript }, null, 2)}\n`);
    await fs.rm(installRoot, { recursive: true, force: true });
  }
});
