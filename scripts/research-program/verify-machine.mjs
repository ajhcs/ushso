import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker, loadCatalogFromAssets } from '../../worker/index.mjs';
import { isCompletedResearchTask } from '../../packages/machine-toolkit/src/index.mjs';
import { createBrowserMachineToolkitClient } from '../../plugins/ushso-research/scripts/client.mjs';
import { makeServer } from '../../plugins/ushso-research/scripts/mcp.mjs';
import {
  CENSUS_ABSCB_2023_ID,
  HCUP_FIXTURE_ID,
  HCRIS_HOSPITAL_COST_REPORT_ID,
} from '../../packages/registry/qualified-access-routes.mjs';
import {
  HCRIS_DISTRIBUTION_ID,
  HCRIS_RELEASE_ID,
  HCRIS_SCHEMA_ID,
} from '../../packages/registry/qualified-variable-contexts.mjs';
import { PHC4_PUBLIC_FINANCIAL_REPORTS_ID } from '../../packages/registry/comparison-dimensions.mjs';

export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export const MACHINE_PARITY_FORMAT = 'ushso.machine-parity-receipt.v1';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scenarioPath = path.join(root, 'verification/research-program/machine/scenarios.json');

const ADVERTISED = Object.freeze([
  'observatory.search_assets',
  'observatory.get_asset',
  'observatory.get_access_plan',
  'observatory.get_retrieval_recipe',
  'observatory.get_variables',
  'observatory.get_join_routes',
  'observatory.compare_assets',
  'observatory.get_coverage_status',
]);

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function emptyFilters() {
  return {
    geography_ids: [], subject_ids: [], grain: [], access_classes: [], authority_levels: [],
    machine_readiness: [], time_period: null, negative_constraints: [], dimensions: [],
  };
}

function fixtureRecord({ record_id, title, source_id, source_name, evidence_id, url }) {
  return {
    record_id,
    title,
    identity: { source: { source_id, name: source_name } },
    evidence: [{ evidence_id }],
    authoritative_url: url,
    freshness_verification: { metadata_observed_at: '2026-09-03T22:22:33.908Z', verification_status: 'current_verified' },
  };
}

export const PARITY_FIXTURES = freeze([
  fixtureRecord({
    record_id: HCUP_FIXTURE_ID,
    title: 'HCUP National Inpatient Sample',
    source_id: 'ahrq-hcup',
    source_name: 'AHRQ HCUP',
    evidence_id: 'evidence.hcup.documentation',
    url: 'https://hcup-us.ahrq.gov/databases.jsp',
  }),
  fixtureRecord({
    record_id: PHC4_PUBLIC_FINANCIAL_REPORTS_ID,
    title: 'PHC4 Public Hospital Financial Reports',
    source_id: 'pa-phc4',
    source_name: 'Pennsylvania Health Care Cost Containment Council',
    evidence_id: 'evidence:pa-phc4:public-financial-reports',
    url: 'https://www.phc4.org/report-focus/financial/',
  }),
]);

export function loadScenarios() {
  return JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
}

export function scientificIdentity(envelope) {
  const result = envelope?.result ?? null;
  return freeze({
    ok: envelope?.ok === true,
    result_state: envelope?.result_state ?? null,
    error_code: envelope?.error?.code ?? null,
    generation: envelope?.index_generation ?? envelope?.generation ?? null,
    source_ids: freeze([
      result?.source?.source_id,
      result?.asset?.asset_id,
      result?.asset_id,
      result?.from_id,
      result?.to_id,
      ...(Array.isArray(result?.assets) ? result.assets.map((row) => row.asset_id) : []),
      ...(Array.isArray(result?.summaries) ? result.summaries.map((row) => row.asset_id) : []),
    ].filter(Boolean)),
    schema_id: result?.schema_id ?? null,
    fields: freeze((result?.fields ?? []).map((field) => field.schema_field_id ?? field.native_name ?? field.field).filter(Boolean)),
    evidence_ids: freeze((envelope?.evidence_references ?? []).map((row) => row.evidence_id).filter(Boolean)),
    access_class: result?.access_class ?? result?.route?.access_class ?? null,
    join_route_ids: freeze((result?.routes ?? []).map((row) => row.route_id).filter(Boolean)),
    two_hop_composed: (result?.routes ?? []).some((row) => row.hop_count > 1 && row.composed === true),
    truth_boundary: freeze({ ...(envelope?.truth_boundary ?? {}) }),
    protocol_success: envelope?.ok === true || (envelope?.ok === false && envelope?.error?.code != null),
    research_success: false,
    completed_research_task: isCompletedResearchTask(envelope),
  });
}

export function compareIdentities(left, right) {
  const keys = ['ok', 'result_state', 'error_code', 'generation', 'schema_id', 'access_class', 'two_hop_composed', 'completed_research_task'];
  const mismatches = [];
  for (const key of keys) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) mismatches.push(key);
  }
  for (const key of ['source_ids', 'fields', 'evidence_ids', 'join_route_ids']) {
    const a = [...(left[key] ?? [])].sort();
    const b = [...(right[key] ?? [])].sort();
    if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push(key);
  }
  const boundaryKeys = Object.keys({ ...(left.truth_boundary ?? {}), ...(right.truth_boundary ?? {}) });
  for (const key of boundaryKeys) {
    if (left.truth_boundary?.[key] !== right.truth_boundary?.[key]) mismatches.push(`truth_boundary.${key}`);
  }
  return freeze({ equal: mismatches.length === 0, mismatches: freeze(mismatches) });
}

export function scenarioInputs(generation = LAST_GOOD_GENERATION) {
  const hcris = HCRIS_HOSPITAL_COST_REPORT_ID;
  const census = CENSUS_ABSCB_2023_ID;
  return freeze({
    'search-positive-hcris': freeze({
      capability: 'search_assets',
      input: {
        contract_version: 'observatory.machine.search-assets.input.v1.0.0',
        mode: 'search',
        research_need: 'CMS HCRIS hospital cost reports',
        filters: emptyFilters(),
        grouping: 'none',
        limit: 5,
        cursor: null,
        expected_generation: generation,
      },
    }),
    'asset-positive-hcris': freeze({
      capability: 'get_asset',
      input: {
        contract_version: 'observatory.machine.get-asset.input.v1.0.0',
        record_id: hcris,
        expected_generation: generation,
        collection_limits: { releases: 20, distributions: 20, documentation: 20, schemas: 20 },
        collection_cursors: { releases: null, distributions: null, documentation: null, schemas: null },
      },
    }),
    'access-positive-hcris': freeze({
      capability: 'get_access_plan',
      input: {
        contract_version: 'observatory.machine.get-access-plan.input.v1.0.0',
        record_id: hcris,
        release_id: HCRIS_RELEASE_ID,
        distribution_id: HCRIS_DISTRIBUTION_ID,
        access_route_id: 'access.cms.hcris.public-docs',
        expected_generation: generation,
      },
    }),
    'recipe-positive-hcris': freeze({
      capability: 'get_retrieval_recipe',
      input: {
        contract_version: 'observatory.machine.get-retrieval-recipe.input.v1.0.0',
        record_id: hcris,
        release_id: HCRIS_RELEASE_ID,
        distribution_id: HCRIS_DISTRIBUTION_ID,
        access_route_id: 'access.cms.hcris.public-docs',
        expected_generation: generation,
      },
    }),
    'variables-positive-hcris': freeze({
      capability: 'get_variables',
      input: {
        contract_version: 'observatory.machine.get-variables.input.v1.0.0',
        record_id: hcris,
        release_id: HCRIS_RELEASE_ID,
        distribution_id: HCRIS_DISTRIBUTION_ID,
        schema_id: HCRIS_SCHEMA_ID,
        semantic_query: null,
        filters: [],
        limit: 25,
        cursor: null,
        expected_generation: generation,
      },
    }),
    'variables-unknown-invented-schema': freeze({
      capability: 'get_variables',
      input: {
        contract_version: 'observatory.machine.get-variables.input.v1.0.0',
        record_id: hcris,
        release_id: 'release.native-test',
        distribution_id: 'distribution.native-test',
        schema_id: 'schema.native-test',
        semantic_query: null,
        filters: [],
        limit: 25,
        cursor: null,
        expected_generation: generation,
      },
    }),
    'access-unknown-invented-route': freeze({
      capability: 'get_access_plan',
      input: {
        contract_version: 'observatory.machine.get-access-plan.input.v1.0.0',
        record_id: hcris,
        release_id: 'release.native-test',
        distribution_id: 'distribution.native-test',
        access_route_id: 'access.native-test',
        expected_generation: generation,
      },
    }),
    'access-restricted-hcup': freeze({
      capability: 'get_access_plan',
      input: {
        contract_version: 'observatory.machine.get-access-plan.input.v1.0.0',
        record_id: HCUP_FIXTURE_ID,
        release_id: 'release.hcup.nis.application',
        distribution_id: 'distribution.hcup.central-distributor',
        access_route_id: 'access.hcup.restricted-manual',
        expected_generation: generation,
      },
    }),
    'join-partial-hcris-phc4': freeze({
      capability: 'get_join_routes',
      input: {
        contract_version: 'observatory.machine.get-join-routes.input.v1.0.0',
        from_id: hcris,
        to_id: PHC4_PUBLIC_FINANCIAL_REPORTS_ID,
        from_release_id: null,
        to_release_id: null,
        research_purpose: null,
        include_indirect: true,
        max_hops: 2,
        limit: 20,
        expected_generation: generation,
      },
    }),
    'compare-hcris-phc4': freeze({
      capability: 'compare_assets',
      input: {
        contract_version: 'observatory.machine.compare-assets.input.v1.0.0',
        asset_ids: [hcris, PHC4_PUBLIC_FINANCIAL_REPORTS_ID],
        dimensions: ['access', 'time', 'grain', 'variables_schema', 'geography', 'freshness'],
        expected_generation: generation,
      },
    }),
    'coverage-positive': freeze({
      capability: 'get_coverage_status',
      input: {
        contract_version: 'observatory.machine.get-coverage-status.input.v1.0.0',
        geography_ids: ['geo.us'],
        subject_ids: [],
        source_classes: [],
        time_period: null,
        authority_levels: [],
        limit: 1,
        cursor: null,
        expected_generation: generation,
      },
    }),
    'missing-source-asset': freeze({
      capability: 'get_asset',
      input: {
        contract_version: 'observatory.machine.get-asset.input.v1.0.0',
        record_id: 'obs:asset:does-not-exist',
        expected_generation: generation,
        collection_limits: { releases: 1, distributions: 1, documentation: 1, schemas: 1 },
        collection_cursors: { releases: null, distributions: null, documentation: null, schemas: null },
      },
    }),
  });
}

function createAssetEnv(versionRoot) {
  return {
    ASSETS: {
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        if (!pathname.startsWith('/corpus-v1.2.0/')) return new Response('', { status: 404 });
        try {
          const bytes = await fs.promises.readFile(path.join(versionRoot, pathname.slice('/corpus-v1.2.0/'.length)));
          return new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } });
        } catch {
          return new Response('', { status: 404 });
        }
      },
    },
  };
}

async function loadParityCatalog(request, env) {
  const catalog = await loadCatalogFromAssets(request, env);
  const records = [...catalog.records];
  const seen = new Set(records.map((record) => record.record_id));
  for (const extra of PARITY_FIXTURES) {
    if (!seen.has(extra.record_id)) records.push(extra);
  }
  return { ...catalog, records };
}

async function startLocalOrigin(env) {
  const worker = createWorker({ loadCatalog: loadParityCatalog });
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
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function invokeHttp(origin, capability, input) {
  const client = createBrowserMachineToolkitClient(async (route, init) => {
    const response = await fetch(new URL(route, origin), { ...init, redirect: 'error' });
    return response;
  });
  const envelope = await client.invokeWebMcp(capability, input);
  return { http_status: 200, envelope };
}

async function invokeMcp(dispatch, capability, input) {
  const listed = await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = listed.result.tools.map((tool) => tool.name);
  const call = await dispatch({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: `observatory.${capability}`, arguments: input },
  });
  if (call.error) fail('MCP_TOOL_CALL_FAILED', JSON.stringify(call.error));
  if (call.result.isError) fail('MCP_IS_ERROR', call.result.content?.[0]?.text);
  return { names, envelope: call.result.structuredContent };
}

export async function probeNativeWebMcp({ timeoutMs = 1500 } = {}) {
  const debuggerOrigin = process.env.USHSO_CHROME_DEBUGGER_ORIGIN ?? 'http://127.0.0.1:8798';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${debuggerOrigin}/json/version`, { signal: controller.signal });
    if (!response.ok) return freeze({ status: 'untested', reason: `CHROME_DEBUGGER_HTTP_${response.status}` });
    return freeze({ status: 'available', reason: 'chrome_debugger_present' });
  } catch (error) {
    return freeze({ status: 'untested', reason: String(error?.cause?.code ?? error?.name ?? error) });
  } finally {
    clearTimeout(timer);
  }
}

function assertScenario(scenario, envelope, transport) {
  if (envelope.tool_contract_version !== 'observatory-machine-toolkit.v1.1.0') fail('ENVELOPE_VERSION');
  if (envelope.capability !== scenario.capability) fail('CAPABILITY_MISMATCH');
  if (envelope.ok !== scenario.expected_ok) fail(`OK_MISMATCH:${scenario.id}:${transport}:${envelope.ok}`);
  if (scenario.expected_result_state && envelope.result_state !== scenario.expected_result_state) {
    fail(`RESULT_STATE_MISMATCH:${scenario.id}:${transport}:${envelope.result_state}`);
  }
  if (scenario.expected_error && envelope.error?.code !== scenario.expected_error) {
    fail(`ERROR_MISMATCH:${scenario.id}:${transport}:${envelope.error?.code}`);
  }
  if (isCompletedResearchTask(envelope) !== false) fail('COMPLETED_RESEARCH_TASK_CLAIMED');
  const boundary = envelope.truth_boundary ?? {};
  for (const key of ['source_requests_made', 'retrieval_executed', 'payloads_acquired', 'analysis_executed', 'identity_merges_performed']) {
    if (boundary[key] === true) fail(`TRUTH_BOUNDARY:${key}`);
  }
  if (scenario.id === 'search-positive-hcris') {
    const ids = (envelope.result?.summaries ?? []).map((row) => row.asset_id);
    if (!ids.includes(HCRIS_HOSPITAL_COST_REPORT_ID) && envelope.result_state === 'empty') fail('SEARCH_EMPTY');
  }
  if (scenario.id === 'variables-positive-hcris') {
    if (envelope.result?.schema_id !== HCRIS_SCHEMA_ID) fail('MADE_UP_SCHEMA_ID');
    if (!envelope.result?.fields?.some((field) => field.native_name === 'PROVNUM')) fail('MISSING_PROVNUM');
  }
  if (scenario.id === 'join-partial-hcris-phc4') {
    if ((envelope.result?.routes ?? []).some((route) => route.hop_count > 1 && route.composed === true)) fail('TWO_HOP_COMPOSED');
  }
  if (scenario.id === 'access-restricted-hcup') {
    const text = JSON.stringify(envelope.result ?? {});
    if (!/restricted/i.test(text)) fail('HCUP_NOT_RESTRICTED');
  }
}

export async function verifyMachineParity({ retainDir = null } = {}) {
  const scenarios = loadScenarios();
  if (scenarios.ids.hcris_schema !== HCRIS_SCHEMA_ID) fail('SCENARIO_SCHEMA_ID_DRIFT');
  if (scenarios.ids.hcris !== HCRIS_HOSPITAL_COST_REPORT_ID) fail('SCENARIO_HCRIS_DRIFT');
  const versionRoot = path.join(root, 'packages/retrieval/versions/v1.2.0');
  const env = createAssetEnv(versionRoot);
  const origin = await startLocalOrigin(env);
  const native = await probeNativeWebMcp();
  const exchanges = [];
  const comparisons = [];
  try {
    const dispatch = makeServer({ base: origin.origin, fetchImpl: fetch });
    const initialized = await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    if (initialized.result.serverInfo.name !== 'ushso-research') fail('MCP_INIT');
    const listed = await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = listed.result.tools.map((tool) => tool.name);
    if (JSON.stringify(names) !== JSON.stringify(ADVERTISED)) fail('MCP_TOOL_LIST');
    if (names.includes('observatory.plan_research')) fail('PLANNER_ADVERTISED');
    const plannerHttp = await fetch(new URL('/api/machine/v1/plan-research', origin.origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        contract_version: 'observatory.machine.plan-research.input.v1.0.0',
        mode: 'initial',
        research_need: 'Hospital cost-report net patient revenue',
        constraints: { geography_ids: [], time_period: null, grain: null, access_classes: [], machine_access_required: false, intended_analyses: [] },
        expected_generation: LAST_GOOD_GENERATION,
      }),
    });
    if (plannerHttp.status !== 404) fail(`PLANNER_HTTP:${plannerHttp.status}`);
    const inputs = scenarioInputs();
    for (const scenario of scenarios.scenarios) {
      const spec = inputs[scenario.id];
      const httpResult = await invokeHttp(origin.origin, spec.capability, spec.input);
      assertScenario(scenario, httpResult.envelope, 'http');
      const mcpResult = await invokeMcp(dispatch, spec.capability, spec.input);
      assertScenario(scenario, mcpResult.envelope, 'mcp');
      const httpId = scientificIdentity(httpResult.envelope);
      const mcpId = scientificIdentity(mcpResult.envelope);
      const compared = compareIdentities(httpId, mcpId);
      if (!compared.equal) fail(`TRANSPORT_DISCREPANCY:${scenario.id}:${compared.mismatches.join(',')}`);
      exchanges.push(freeze({
        scenario_id: scenario.id,
        capability: scenario.capability,
        kind: scenario.kind,
        http: freeze({ ok: httpResult.envelope.ok, result_state: httpResult.envelope.result_state, error: httpResult.envelope.error?.code ?? null, identity: httpId }),
        mcp: freeze({ ok: mcpResult.envelope.ok, result_state: mcpResult.envelope.result_state, error: mcpResult.envelope.error?.code ?? null, identity: mcpId }),
        compared,
      }));
      comparisons.push(freeze({ scenario_id: scenario.id, equal: true, mismatches: [] }));
    }
    const receipt = freeze({
      format: MACHINE_PARITY_FORMAT,
      generation: LAST_GOOD_GENERATION,
      advertised_tools: ADVERTISED,
      plan_research_enabled: false,
      protocol_success_is_not_research_success: true,
      http_200_is_not_completed_research_task: true,
      made_up_schema_ids_used_on_positive_path: false,
      transports: freeze({
        http: freeze({ status: 'invoked', origin: origin.origin }),
        mcp_stdio: freeze({ status: 'invoked', advertised_tools: names }),
        native_webmcp: native,
      }),
      scenario_count: scenarios.scenarios.length,
      exchanges,
      comparisons,
      worker_index_imports_enrichment: false,
      last_good_generation_changed: false,
    });
    if (retainDir) {
      fs.mkdirSync(retainDir, { recursive: true });
      fs.writeFileSync(path.join(retainDir, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    }
    return receipt;
  } finally {
    await origin.close();
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const retain = process.env.USHSO_PR063_RETAIN_DIR ?? path.join(root, 'verification/research-program/machine/exchanges');
  const receipt = await verifyMachineParity({ retainDir: retain });
  process.stdout.write(`${JSON.stringify({ ok: true, native: receipt.transports.native_webmcp.status, scenarios: receipt.scenario_count }, null, 2)}\n`);
}
