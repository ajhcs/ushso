import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSchemas } from '../../../contracts/machine-toolkit/v1.0.0/tools/schema.mjs';
import { validateResponse } from '../../../contracts/machine-toolkit/v1.0.0/tools/semantic-validator.mjs';
import {
  PUBLIC_CAPABILITY_FLAGS,
  TOOL_DEFINITIONS,
  WEBMCP_SPECIFICATION,
  createMachineToolkit,
  snapshotBody,
  validateInput
} from '../src/index.mjs';
import { contextFrom, fixtureBundle, frozenManifest, responseCore, serviceReturning } from './helpers.mjs';

const schemaId = (capability) => `https://ushso.org/contracts/machine-toolkit/v1.0.0/schemas/${capability.replaceAll('_', '-')}-response.schema.json`;

test('runtime descriptors remain pinned to the frozen manifest and exact WebMCP draft', async () => {
  const manifest = await frozenManifest();
  assert.equal(WEBMCP_SPECIFICATION.commit, manifest.webmcp_specification.commit);
  assert.equal(WEBMCP_SPECIFICATION.snapshot_date, manifest.webmcp_specification.snapshot_date);
  assert.equal(TOOL_DEFINITIONS.length, manifest.tools.length);
  for (const tool of TOOL_DEFINITIONS) {
    const frozen = manifest.tools.find((entry) => entry.capability === tool.capability);
    assert.deepEqual({
      tool_name: tool.toolName,
      title: tool.title,
      description: tool.description,
      canonical_service_method: `machine.${tool.serviceMethod}`,
      input_schema_id: tool.inputSchemaId,
      json_api: tool.jsonApi,
      input_max_bytes: tool.inputMaxBytes,
      output_max_bytes: tool.outputMaxBytes,
      annotations: tool.annotations,
      registration_state: tool.registrationState
    }, {
      tool_name: frozen.tool_name,
      title: frozen.title,
      description: frozen.description,
      canonical_service_method: frozen.canonical_service_method,
      input_schema_id: frozen.input_schema_id,
      json_api: frozen.json_api,
      input_max_bytes: frozen.input_max_bytes,
      output_max_bytes: frozen.output_max_bytes,
      annotations: frozen.annotations,
      registration_state: frozen.registration_state
    });
  }
  assert.deepEqual(Object.values(PUBLIC_CAPABILITY_FLAGS), [...Array(8).fill(true), false]);
});

test('every frozen request passes the dependency-free strict runtime validator', async () => {
  const bundle = await fixtureBundle();
  for (const row of bundle.conformance_cases) assert.deepEqual(validateInput(row.capability, row.input), [], row.case_id);
});

test('JSON API and WebMCP adapters preserve schema, critical facts, and semantic snapshots', async () => {
  const bundle = await fixtureBundle();
  const manifest = await frozenManifest();
  const schemas = await loadSchemas();
  for (const row of bundle.conformance_cases) {
    let core = responseCore(row.json_api.response);
    const calls = [];
    const toolkit = createMachineToolkit({
      service: serviceReturning(() => core, calls),
      responseContext: contextFrom(row.json_api.response),
      clock: () => new Date('2026-08-30T00:00:00Z'),
      requestId: ({ transportAdapter }) => `${row.case_id}.${transportAdapter}`
    });
    const json = await toolkit.invokeJsonApi(row.capability, row.input);
    const webmcp = await toolkit.invokeWebMcp(row.capability, row.input);
    const tool = manifest.tools.find((entry) => entry.capability === row.capability);
    const validate = schemas.ajv.getSchema(schemaId(row.capability));
    assert.equal(validate(json), true, `${row.case_id} json: ${JSON.stringify(validate.errors)}`);
    assert.equal(validate(webmcp), true, `${row.case_id} webmcp: ${JSON.stringify(validate.errors)}`);
    assert.deepEqual(validateResponse(json, row.input, tool, validate), [], `${row.case_id} json semantic`);
    assert.deepEqual(validateResponse(webmcp, row.input, tool, validate), [], `${row.case_id} webmcp semantic`);
    assert.deepEqual(snapshotBody(json), snapshotBody(webmcp), row.case_id);
    assert.equal(json.result_snapshot_id, webmcp.result_snapshot_id, row.case_id);
    assert.equal(json.index_generation, row.input.expected_generation, row.case_id);
    assert.deepEqual(Object.values(json.truth_boundary), Array(6).fill(false), row.case_id);
    if (row.capability === 'plan_research') {
      assert.equal(json.error.code, 'planner_unavailable');
      assert.equal(calls.length, 0, 'planner must not reach the injected compiler');
    } else {
      assert.equal(calls.length, 2, row.case_id);
      if (json.ok) assert.equal(json.result_snapshot_id, row.json_api.response.result_snapshot_id, row.case_id);
    }
  }
});
