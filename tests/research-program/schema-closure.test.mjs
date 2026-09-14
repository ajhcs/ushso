import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { createWorker } from '../../worker/index.mjs';
import { createMachineToolkit } from '../../packages/machine-toolkit/src/index.mjs';
import { createStaticMachineToolkitRuntime } from '../../worker/static-machine-toolkit-service.mjs';
import { createMachineCursorSigner } from '../../worker/machine-cursor.mjs';
import { verifyAdvertisedSchemas } from '../../scripts/verify-advertised-schemas.mjs';
import { LAST_GOOD_GENERATION } from '../../packages/coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const discovery = JSON.parse(await fs.readFile(path.join(root, 'packages/machine-toolkit/public-webmcp-tool.json'), 'utf8'));
const example = JSON.parse(await fs.readFile(path.join(root, 'apps/web/src/data/generatedAgentsResponseExample.json'), 'utf8'));
const workerSource = await fs.readFile(path.join(root, 'worker/index.mjs'), 'utf8');
const { createBrowserMachineToolkitClient } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(await fs.readFile(path.join(root, 'apps/web/src/providers/machineToolkitClient.ts'), 'utf8'))).toString('base64'));

async function loadCatalog() {
  const versionRoot = path.join(root, 'packages/retrieval/versions/v1.2.0');
  const corpus = JSON.parse(await fs.readFile(path.join(versionRoot, 'corpus/corpus.json'), 'utf8'));
  const records = [];
  for (const file of corpus.record_files) {
    const text = await fs.readFile(path.join(versionRoot, 'corpus', file), 'utf8');
    records.push(...text.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)));
  }
  return { corpus, records: records.slice(0, 8) };
}

function diskFetch(url) {
  const pathname = new URL(url, 'https://ushso.org').pathname;
  const mapped = pathname === '/corpus-v1.2.0/webmcp-tool.json'
    ? path.join(root, 'packages/machine-toolkit/public-webmcp-tool.json')
    : path.join(root, pathname.slice(1));
  return fs.readFile(mapped).then((bytes) => new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }), () => new Response('<!doctype html><html><body>SPA</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  }));
}

const worker = createWorker({
  loadEngine: async () => ({ interpret() { return {}; }, retrieve() { return {}; } }),
  loadCatalog: async () => ({ records: [], searchDocuments: [], joinRoutes: [], corpus: { publication: { generation: LAST_GOOD_GENERATION } } }),
});
const env = { ASSETS: { fetch: async (request) => diskFetch(request.url ?? request) } };

test('old clients receive supported compatibility or a typed version error, not a silently different response shape', async () => {
  assert.equal(discovery.input_contract_version, 'observatory-machine-toolkit.v1.0.0');
  assert.equal(discovery.response_contract_version, 'observatory-machine-toolkit.v1.1.0');
  assert.equal(discovery.strict_v1_0_consumers, 'typed_version_error');
  assert.equal(discovery.silent_shape_change, false);
  assert.deepEqual(discovery.incompatible_response_versions, ['observatory-machine-toolkit.v1.0.0']);
  const catalog = await loadCatalog();
  const runtime = createStaticMachineToolkitRuntime(catalog, {
    cursorSigner: createMachineCursorSigner({ clock: () => Date.parse('2026-09-03T12:00:00Z') }),
  });
  const toolkit = createMachineToolkit({ service: runtime.operations, responseContext: runtime.context });
  const value = await toolkit.invokeJsonApi('get_asset', {
    contract_version: 'observatory.machine.get-asset.input.v1.0.0',
    record_id: catalog.records[0].record_id,
    expected_generation: catalog.corpus.publication.generation,
    collection_limits: { releases: 20, distributions: 20, documentation: 20, schemas: 20 },
    collection_cursors: { releases: null, distributions: null, documentation: null, schemas: null },
  });
  assert.equal(value.ok, true);
  assert.equal(value.tool_contract_version, 'observatory-machine-toolkit.v1.1.0');
  await assert.rejects(
    createBrowserMachineToolkitClient(async () => Response.json({ ...value, tool_contract_version: 'observatory-machine-toolkit.v1.0.0' })).invokeWebMcp('get_asset', { record_id: catalog.records[0].record_id }),
    /UNSUPPORTED_RESPONSE_VERSION/,
  );
});

test('fetch/compile the actual served schema closure; HTML fallback for a schema URL fails', async () => {
  const served = await worker.fetch(new Request('https://ushso.org' + discovery.tools[0].response_schema), env);
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-type') ?? '', /^application\/json/);
  const schema = await served.json();
  assert.equal(schema.$id, 'https://ushso.org' + discovery.tools[0].response_schema);
  const missing = await worker.fetch(new Request('https://ushso.org/contracts/machine-toolkit/v1.1.0/schemas/does-not-exist.schema.json'), env);
  assert.equal(missing.status, 415);
  const body = await missing.json();
  assert.equal(body.error.code, 'schema_not_json');
  assert.doesNotMatch(JSON.stringify(body), /<!doctype html>/i);
  const check = await verifyAdvertisedSchemas('https://ushso.org', discovery, (url) => worker.fetch(new Request(url), env));
  assert.ok(check.schema_ids.length >= 16);
  await assert.rejects(
    verifyAdvertisedSchemas('https://ushso.org', discovery, async (url) => {
      if (new URL(url).pathname === discovery.tools[0].response_schema) {
        return new Response('<html>SPA</html>', { headers: { 'content-type': 'text/html' } });
      }
      return worker.fetch(new Request(url), env);
    }),
    /SCHEMA_NOT_JSON/,
  );
});

test('exactly the advertised tools and versions exist; the agent guide does not publish stale generation labels', async () => {
  assert.equal(discovery.enabled_tool_count, 8);
  assert.equal(discovery.tools.length, 8);
  assert.equal(discovery.planner_enabled, false);
  assert.equal(discovery.tools.some((tool) => tool.capability === 'plan_research'), false);
  assert.deepEqual(discovery.disabled_tools.map((tool) => tool.capability), ['plan_research']);
  const contract = await worker.fetch(new Request('https://ushso.org/api/contract'), env);
  assert.equal(contract.status, 200);
  const advertised = await contract.json();
  assert.equal(advertised.enabled_tool_count, 8);
  assert.equal(advertised.planner_enabled, false);
  assert.equal(example.corpus.generation, LAST_GOOD_GENERATION);
  assert.notEqual(example.corpus.generation, 'live-2026-09-02');
  const guide = await worker.fetch(new Request('https://ushso.org/llms.txt'), env);
  const text = await guide.text();
  assert.doesNotMatch(text, /live-2026-09-02/);
  assert.match(text, /successful tool envelope is not a completed research task/i);
  assert.equal(workerSource.includes('packages/enrichment'), false);
});

test('all eight actual response envelopes validate against the served schemas; protocol success is not scientific completion', async () => {
  assert.equal(discovery.protocol_success_is_not_completed_research_task, true);
  assert.equal(discovery.scientific_approval, false);
  const catalog = await loadCatalog();
  const runtime = createStaticMachineToolkitRuntime(catalog, {
    now: new Date('2026-09-03T12:00:00Z'),
    cursorSigner: createMachineCursorSigner({ clock: () => Date.parse('2026-09-03T12:00:00Z') }),
  });
  const toolkit = createMachineToolkit({ service: runtime.operations, responseContext: runtime.context });
  const check = await verifyAdvertisedSchemas('https://ushso.org', discovery, (url) => worker.fetch(new Request(url), env));
  const first = catalog.records[0];
  const second = catalog.records[1];
  const generation = catalog.corpus.publication.generation;
  const filters = {
    geography_ids: [], subject_ids: [], grain: [], access_classes: [], authority_levels: [],
    machine_readiness: [], time_period: null, negative_constraints: [], dimensions: [],
  };
  const cases = [
    ['search_assets', { contract_version: 'observatory.machine.search-assets.input.v1.0.0', mode: 'search', research_need: first.title, filters, grouping: 'none', limit: 5, cursor: null, expected_generation: generation }],
    ['get_asset', { contract_version: 'observatory.machine.get-asset.input.v1.0.0', record_id: first.record_id, expected_generation: generation, collection_limits: { releases: 20, distributions: 20, documentation: 20, schemas: 20 }, collection_cursors: { releases: null, distributions: null, documentation: null, schemas: null } }],
    ['get_access_plan', { contract_version: 'observatory.machine.get-access-plan.input.v1.0.0', record_id: first.record_id, release_id: 'release.test', distribution_id: 'distribution.test', access_route_id: 'access.test', expected_generation: generation }],
    ['get_retrieval_recipe', { contract_version: 'observatory.machine.get-retrieval-recipe.input.v1.0.0', record_id: first.record_id, release_id: 'release.test', distribution_id: 'distribution.test', access_route_id: 'access.test', expected_generation: generation }],
    ['get_variables', { contract_version: 'observatory.machine.get-variables.input.v1.0.0', record_id: first.record_id, release_id: 'release.test', distribution_id: 'distribution.test', schema_id: 'schema.test', semantic_query: null, filters: [], limit: 25, cursor: null, expected_generation: generation }],
    ['get_join_routes', { contract_version: 'observatory.machine.get-join-routes.input.v1.0.0', from_id: first.record_id, to_id: second.record_id, from_release_id: null, to_release_id: null, research_purpose: null, include_indirect: false, max_hops: 1, limit: 20, expected_generation: generation }],
    ['compare_assets', { contract_version: 'observatory.machine.compare-assets.input.v1.0.0', asset_ids: [first.record_id, second.record_id], dimensions: ['access', 'freshness', 'geography'], expected_generation: generation }],
    ['get_coverage_status', { contract_version: 'observatory.machine.get-coverage-status.input.v1.0.0', geography_ids: ['geo.us'], subject_ids: [], source_classes: [], time_period: null, authority_levels: ['authoritative'], limit: 25, cursor: null, expected_generation: generation }],
  ];
  for (const [capability, input] of cases) {
    const response = await toolkit.invokeJsonApi(capability, input);
    check.validate(capability, response);
    assert.deepEqual(Object.values(response.truth_boundary), Array(6).fill(false));
    assert.equal(response.truth_boundary.analysis_executed, false);
    assert.equal(response.truth_boundary.retrieval_executed, false);
  }
});
