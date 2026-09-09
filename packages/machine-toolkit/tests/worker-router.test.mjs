import assert from 'node:assert/strict';
import test from 'node:test';
import { createMachineToolkit } from '../src/index.mjs';
import { createMachineToolkitLocalVerificationRouter, createMachineToolkitRouter } from '../../../worker/machine-toolkit-router.mjs';
import { contextFrom, fixtureBundle, responseCore, serviceReturning } from './helpers.mjs';

let bundle;

test.before(async () => { bundle = await fixtureBundle(); });

function setup(caseId, capabilities) {
  const row = bundle.conformance_cases.find((entry) => entry.case_id === caseId);
  const calls = [];
  const toolkit = createMachineToolkit({
    service: serviceReturning(() => responseCore(row.json_api.response), calls),
    responseContext: contextFrom(row.json_api.response),
    clock: () => new Date('2026-08-30T00:00:00Z'),
    requestId: () => 'request.worker-router-test'
  });
  const router = capabilities
    ? createMachineToolkitLocalVerificationRouter({ toolkit, expectedOrigin: 'https://ushso.test' })
    : createMachineToolkitRouter({ toolkit, expectedOrigin: 'https://ushso.test' });
  return { row, calls, router };
}

test('public inspection routes are active by default', async () => {
  const { row, calls, router } = setup('search.search.success');
  const response = await router.handle(new Request('https://ushso.test/api/machine/v1/search-assets', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row.input)
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).capability, 'search_assets');
  assert.equal(calls.length, 1);
});

test('protected local candidate POST routes use the injected canonical service', async () => {
  const { row, calls, router } = setup('search.search.success', ['search_assets']);
  const response = await router.handle(new Request('https://ushso.test/api/machine/v1/search-assets', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row.input)
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json/u);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const value = await response.json();
  assert.equal(value.transport_adapter, 'json_api');
  assert.equal(value.capability, 'search_assets');
  assert.equal(value.index_generation, row.input.expected_generation);
  assert.equal(calls.length, 1);
});

test('GET route parsing supplies exact bounded nested defaults', async () => {
  const { row, calls, router } = setup('asset.partial.success', ['get_asset']);
  const response = await router.handle(new Request(`https://ushso.test/api/machine/v1/assets/${encodeURIComponent(row.input.record_id)}?generation=${row.input.expected_generation}`));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).capability, 'get_asset');
  assert.deepEqual(calls[0].input, row.input);
});

test('router denies cross-origin requests before service invocation', async () => {
  const { row, calls, router } = setup('search.search.success', ['search_assets']);
  const response = await router.handle(new Request('https://attacker.test/api/machine/v1/search-assets', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row.input)
  }));
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test('GET routes reject undeclared query parameters rather than ignoring them', async () => {
  const { calls, router } = setup('asset.partial.success', ['get_asset']);
  const response = await router.handle(new Request('https://ushso.test/api/machine/v1/assets/asset.a?generation=gen-2026-08-30&admin=true'));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'unknown_parameter');
  assert.equal(calls.length, 0);
});

test('bounded streaming decode rejects oversized, compressed, and misleading bodies', async (t) => {
  const { router } = setup('search.search.success', ['search_assets']);
  await t.test('streaming overflow', async () => {
    const response = await router.handle(new Request('https://ushso.test/api/machine/v1/search-assets', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(21_000) })
    }));
    assert.equal(response.status, 413);
  });
  await t.test('compressed body', async () => {
    const response = await router.handle(new Request('https://ushso.test/api/machine/v1/search-assets', {
      method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' }, body: '{}'
    }));
    assert.equal(response.status, 415);
  });
  await t.test('misleading content type', async () => {
    const response = await router.handle(new Request('https://ushso.test/api/machine/v1/search-assets', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}'
    }));
    assert.equal(response.status, 415);
  });
});

test('planner route remains unavailable even in protected candidate mode', async () => {
  const { row, calls, router } = setup('planner.disabled', ['plan_research']);
  const response = await router.handle(new Request('https://ushso.test/api/machine/v1/plan-research', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row.input)
  }));
  assert.equal(response.status, 404);
  assert.equal(calls.length, 0);
});

test('caller-provided activation flags cannot enable a public route', () => {
  const { row } = setup('search.search.success');
  const toolkit = createMachineToolkit({
    service: serviceReturning(() => responseCore(row.json_api.response)),
    responseContext: contextFrom(row.json_api.response)
  });
  assert.throws(() => createMachineToolkitRouter({
    toolkit,
    expectedOrigin: 'https://ushso.test',
    activationFlags: { search_assets: true }
  }), /CALLER_ACTIVATION_FORBIDDEN/u);
});
