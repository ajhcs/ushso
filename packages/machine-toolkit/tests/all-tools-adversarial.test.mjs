import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_BY_CAPABILITY, assertCanonicalService, createMachineToolkit, serializedBytes } from '../src/index.mjs';
import { contextFrom, fixtureBundle, responseCore, serviceReturning } from './helpers.mjs';

const successCases = Object.freeze({
  search_assets: 'search.search.success',
  get_asset: 'asset.partial.success',
  get_access_plan: 'access.success',
  get_retrieval_recipe: 'retrieval.success',
  get_variables: 'variables.partial.success',
  get_join_routes: 'joins.success',
  compare_assets: 'compare.success',
  get_coverage_status: 'coverage.unknown.success'
});

function adapter(row, mutate = (core) => core) {
  const calls = [];
  const core = mutate(responseCore(row.json_api.response));
  return {
    calls,
    toolkit: createMachineToolkit({
      service: serviceReturning(() => core, calls),
      responseContext: contextFrom(row.json_api.response),
      clock: () => new Date('2026-08-30T00:00:00Z'),
      requestId: () => 'request.all-tool-adversarial'
    })
  };
}

function growPermittedString(core) {
  const message = 'x'.repeat(4000);
  core.warnings = Array.from({ length: 50 }, (_, index) => ({
    code: `warning:oversized:${index}`,
    message,
    evidence_ids: [],
    copy_policy_version: 'policy:v1'
  }));
}

function exceedCardinality(capability, input, result) {
  const expand = (name, count) => { result[name] = Array.from({ length: count }, () => structuredClone(result[name][0])); };
  switch (capability) {
    case 'search_assets': expand('summaries', input.limit + 1); break;
    case 'get_asset': expand('releases', input.collection_limits.releases + 1); break;
    case 'get_access_plan': expand('requirements', 51); break;
    case 'get_retrieval_recipe': expand('parameters', 101); break;
    case 'get_variables': expand('fields', input.limit + 1); break;
    case 'get_join_routes': expand('routes', input.limit + 1); break;
    case 'compare_assets': expand('pairwise_operations', 11); break;
    case 'get_coverage_status': expand('cells', input.limit + 1); break;
  }
}

test('the injected canonical interface requires all nine service methods', () => {
  assert.throws(() => assertCanonicalService({ searchAssets() {} }), /SERVICE_METHOD_REQUIRED/u);
});

for (const [capability, caseId] of Object.entries(successCases)) {
  test(`${capability} enforces input bytes, output bytes, cardinality, redaction, and zero-action truth`, async () => {
    const bundle = await fixtureBundle();
    const row = bundle.conformance_cases.find((entry) => entry.case_id === caseId);

    const invalid = structuredClone(row.input);
    invalid.contract_version = 'x'.repeat(21_000);
    const first = adapter(row);
    const invalidResponse = await first.toolkit.invokeJsonApi(capability, invalid);
    assert.equal(invalidResponse.error.code, 'invalid_input');
    assert.equal(first.calls.length, 0);

    const secret = adapter(row, (core) => { core.result.authorization = 'Bearer never-return-this-secret'; return core; });
    const redacted = await secret.toolkit.invokeWebMcp(capability, row.input);
    assert.equal(redacted.error.code, 'service_unavailable');
    assert.doesNotMatch(JSON.stringify(redacted), /never-return-this-secret/u);

    const action = adapter(row, (core) => { core.truth_boundary.payloads_acquired = true; return core; });
    const actionResponse = await action.toolkit.invokeJsonApi(capability, row.input);
    assert.equal(actionResponse.error.code, 'service_unavailable');
    assert.deepEqual(Object.values(actionResponse.truth_boundary), Array(6).fill(false));

    const cardinality = adapter(row, (core) => { exceedCardinality(capability, row.input, core.result); return core; });
    assert.equal((await cardinality.toolkit.invokeJsonApi(capability, row.input)).error.code, 'service_unavailable');

    const oversized = adapter(row, (core) => { growPermittedString(core); return core; });
    const bounded = await oversized.toolkit.invokeWebMcp(capability, row.input);
    assert.equal(bounded.error.code, 'response_limit_exceeded');
    assert.equal(bounded.result, null);
    assert.ok(serializedBytes(bounded) <= TOOL_BY_CAPABILITY.get(capability).outputMaxBytes);
  });
}

test('plan_research enforces its input cap and remains unavailable below its output cap', async () => {
  const bundle = await fixtureBundle();
  const row = bundle.conformance_cases.find((entry) => entry.case_id === 'planner.disabled');
  const { toolkit, calls } = adapter(row);
  const input = structuredClone(row.input);
  input.research_need = 'x'.repeat(21_000);
  assert.equal((await toolkit.invokeJsonApi('plan_research', input)).error.code, 'invalid_input');
  const response = await toolkit.invokeWebMcp('plan_research', row.input);
  assert.equal(response.error.code, 'planner_unavailable');
  assert.ok(serializedBytes(response) <= TOOL_BY_CAPABILITY.get('plan_research').outputMaxBytes);
  assert.equal(calls.length, 0);
});
