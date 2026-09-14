import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HCRIS_SCHEMA_ID } from '../../packages/registry/qualified-variable-contexts.mjs';
import { HCRIS_HOSPITAL_COST_REPORT_ID } from '../../packages/registry/qualified-access-routes.mjs';
import {
  LAST_GOOD_GENERATION,
  compareIdentities,
  loadScenarios,
  scientificIdentity,
  verifyMachineParity,
} from '../../scripts/research-program/verify-machine.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workerIndex = fs.readFileSync(path.join(root, 'worker/index.mjs'), 'utf8');
const scenarios = loadScenarios();

test('do not use made-up schema IDs for the positive path; fixtures explicitly distinguish protocol and research success', () => {
  const positiveVariables = scenarios.scenarios.find((row) => row.id === 'variables-positive-hcris');
  assert.equal(positiveVariables.kind, 'positive');
  assert.equal(scenarios.ids.hcris_schema, HCRIS_SCHEMA_ID);
  assert.equal(scenarios.ids.hcris, HCRIS_HOSPITAL_COST_REPORT_ID);
  assert.notEqual(scenarios.ids.hcris_schema, scenarios.ids.invented_schema);
  assert.equal(scenarios.protocol_success_is_not_research_success, true);
  assert.equal(scenarios.http_200_is_not_completed_research_task, true);
  for (const row of scenarios.scenarios) {
    assert.equal(row.research_success, false);
    assert.equal(row.protocol_success, true);
  }
  const kinds = new Set(scenarios.scenarios.map((row) => row.kind));
  for (const kind of ['positive', 'partial', 'unknown', 'restricted', 'missing-source']) {
    assert.equal(kinds.has(kind), true, kind);
  }
  const envelope = {
    ok: true,
    result_state: 'complete',
    tool_contract_version: 'observatory-machine-toolkit.v1.1.0',
    capability: 'get_variables',
    result: { schema_id: HCRIS_SCHEMA_ID, fields: [{ native_name: 'PROVNUM' }] },
    evidence_references: [{ evidence_id: 'evidence:cms-data-catalog:bf696c5e94f4146abe7ad61b' }],
    truth_boundary: { payloads_acquired: false, analysis_executed: false },
    index_generation: LAST_GOOD_GENERATION,
  };
  const identity = scientificIdentity(envelope);
  assert.equal(identity.protocol_success, true);
  assert.equal(identity.research_success, false);
  assert.equal(identity.completed_research_task, false);
  const other = scientificIdentity({ ...envelope, result: { ...envelope.result, schema_id: 'schema.other' } });
  assert.equal(compareIdentities(identity, other).equal, false);
});

test('all advertised tools are discovered and callable; browser unavailability is recorded as untested rather than passed', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ushso-pr063-'));
  const receipt = await verifyMachineParity({ retainDir: tmp });
  assert.deepEqual(receipt.advertised_tools, scenarios.advertised_tools);
  assert.equal(receipt.plan_research_enabled, false);
  assert.equal(receipt.transports.http.status, 'invoked');
  assert.equal(receipt.transports.mcp_stdio.status, 'invoked');
  assert.notEqual(receipt.transports.native_webmcp.status, 'passed');
  assert.ok(['untested', 'available'].includes(receipt.transports.native_webmcp.status));
  if (receipt.transports.native_webmcp.status === 'untested') {
    assert.ok(receipt.transports.native_webmcp.reason);
  }
  assert.equal(receipt.scenario_count, 12);
  assert.equal(workerIndex.includes('packages/enrichment'), false);
});

test('a discrepancy blocks qualification even if each transport passed its own producer tests', async () => {
  const receipt = await verifyMachineParity();
  assert.equal(receipt.comparisons.every((row) => row.equal === true), true);
  assert.equal(receipt.made_up_schema_ids_used_on_positive_path, false);
  const variables = receipt.exchanges.find((row) => row.scenario_id === 'variables-positive-hcris');
  assert.equal(variables.http.identity.schema_id, HCRIS_SCHEMA_ID);
  assert.equal(variables.mcp.identity.schema_id, HCRIS_SCHEMA_ID);
  const invented = receipt.exchanges.find((row) => row.scenario_id === 'variables-unknown-invented-schema');
  assert.equal(invented.http.ok, false);
  assert.equal(invented.http.error, 'schema_context_required');
  const missing = receipt.exchanges.find((row) => row.scenario_id === 'missing-source-asset');
  assert.equal(missing.http.ok, false);
  const restricted = receipt.exchanges.find((row) => row.scenario_id === 'access-restricted-hcup');
  assert.equal(restricted.http.ok, true);
  assert.equal(restricted.http.identity.completed_research_task, false);
  const join = receipt.exchanges.find((row) => row.scenario_id === 'join-partial-hcris-phc4');
  assert.equal(join.http.identity.two_hop_composed, false);
});
