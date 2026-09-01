import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PUBLIC_CAPABILITY_FLAGS,
  createMachineToolkit,
  createWebMcpToolset,
  registerObservatoryToolkitWebMcp,
  registerObservatoryToolkitWebMcpCandidateForLocalVerification,
  translateLegacyDiscoverSources
} from '../src/index.mjs';
import { contextFrom, fixtureBundle, responseCore, serviceReturning } from './helpers.mjs';

let search;
let toolkit;
let calls;

test.before(async () => {
  const bundle = await fixtureBundle();
  search = bundle.conformance_cases.find((row) => row.case_id === 'search.search.success');
  calls = [];
  toolkit = createMachineToolkit({
    service: serviceReturning(() => responseCore(search.json_api.response), calls),
    responseContext: contextFrom(search.json_api.response),
    clock: () => new Date('2026-08-30T00:00:00Z'),
    requestId: () => 'request.webmcp-test'
  });
});

test('tool objects use frozen read-only/untrusted descriptors', () => {
  const tools = createWebMcpToolset(toolkit);
  assert.equal(tools.length, 9);
  assert.deepEqual(tools.map((tool) => tool.name), [
    'observatory.search_assets', 'observatory.get_asset', 'observatory.get_access_plan',
    'observatory.get_retrieval_recipe', 'observatory.get_variables', 'observatory.get_join_routes',
    'observatory.compare_assets', 'observatory.get_coverage_status', 'observatory.plan_research'
  ]);
  assert.ok(tools.every((tool) => tool.annotations.readOnlyHint && tool.annotations.untrustedContentHint));
  assert.ok(tools.every((tool) => tool.inputSchema.$ref.startsWith('https://ushso.org/contracts/machine-toolkit/v1.0.0/')));
});

test('all-false public activation registers no tools', async () => {
  const registered = [];
  const handle = await registerObservatoryToolkitWebMcp({
    modelContext: { registerTool(tool) { registered.push(tool); } },
    toolkit
  });
  assert.deepEqual(registered, []);
  assert.deepEqual(handle.names, []);
  await handle.unregister();
  assert.equal(handle.signal.aborted, true);
});

test('local conformance registration shares one signal and unregisters every candidate handle', async () => {
  const registrations = [];
  const unregistered = [];
  const handle = await registerObservatoryToolkitWebMcpCandidateForLocalVerification({
    modelContext: {
      registerTool(tool, options) {
        registrations.push({ tool, signal: options.signal });
        return { unregister: async () => unregistered.push(tool.name) };
      }
    },
    toolkit
  });
  assert.deepEqual(handle.names, [
    'observatory.search_assets', 'observatory.get_asset', 'observatory.get_access_plan',
    'observatory.get_retrieval_recipe', 'observatory.get_variables', 'observatory.get_join_routes',
    'observatory.compare_assets', 'observatory.get_coverage_status'
  ]);
  assert.equal(registrations[0].signal, registrations[1].signal);
  assert.ok(registrations.every((entry) => entry.signal === registrations[0].signal));
  assert.equal(registrations[0].signal, handle.signal);
  await handle.unregister();
  assert.equal(handle.signal.aborted, true);
  assert.deepEqual(unregistered, [...handle.names].reverse());
  await handle.unregister();
  assert.equal(unregistered.length, 8, 'unregister is idempotent');
});

test('lifecycle and per-call aborts reach tool execution without source actions', async () => {
  const lifecycle = new AbortController();
  const tool = createWebMcpToolset(toolkit, { lifecycleSignal: lifecycle.signal })[0];
  lifecycle.abort(new DOMException('page closed', 'AbortError'));
  await assert.rejects(tool.execute(search.input), { name: 'AbortError' });
});

test('an already-aborted registration lifecycle registers nothing', async () => {
  const lifecycle = new AbortController();
  lifecycle.abort(new DOMException('page closed', 'AbortError'));
  let registrations = 0;
  await assert.rejects(registerObservatoryToolkitWebMcpCandidateForLocalVerification({
    modelContext: { registerTool() { registrations += 1; } },
    toolkit,
    lifecycleSignal: lifecycle.signal
  }), { name: 'AbortError' });
  assert.equal(registrations, 0);
});

test('unregister attempts every registration even when one cleanup fails', async () => {
  const attempts = [];
  const handle = await registerObservatoryToolkitWebMcpCandidateForLocalVerification({
    modelContext: {
      registerTool(tool) {
        return {
          async unregister() {
            attempts.push(tool.name);
            if (tool.name === 'observatory.get_variables') throw new Error('simulated cleanup failure');
          }
        };
      }
    },
    toolkit
  });
  await assert.rejects(handle.unregister(), AggregateError);
  assert.equal(attempts.length, 8);
  assert.equal(handle.signal.aborted, true);
});

test('prompt-like source metadata cannot mutate static tool descriptors', async () => {
  const tool = createWebMcpToolset(toolkit)[0];
  const before = { name: tool.name, title: tool.title, description: tool.description, annotations: tool.annotations, inputSchema: tool.inputSchema };
  await tool.execute(search.input);
  assert.deepEqual({ name: tool.name, title: tool.title, description: tool.description, annotations: tool.annotations, inputSchema: tool.inputSchema }, before);
});

test('caller-supplied activation is rejected and local verification never includes plan_research', async () => {
  assert.throws(() => registerObservatoryToolkitWebMcp({
    modelContext: { registerTool() {} },
    toolkit,
    activationFlags: { search_assets: true }
  }), /CALLER_ACTIVATION_FORBIDDEN/u);
  assert.throws(() => registerObservatoryToolkitWebMcpCandidateForLocalVerification({
    modelContext: { registerTool() {} },
    toolkit,
    candidateActivation: { capabilities: ['plan_research'] }
  }), /CALLER_ACTIVATION_FORBIDDEN/u);
});

test('legacy alias translates only the audited unambiguous subset and never clips', () => {
  const translated = translateLegacyDiscoverSources({ question: 'Find public facility metadata.', limit: 5 });
  assert.equal(translated.ok, true);
  assert.equal(translated.input.mode, 'search');
  assert.equal(translated.input.research_need, 'Find public facility metadata.');
  assert.equal(translated.input.limit, 5);
  assert.equal(translateLegacyDiscoverSources({ question: 'Find public facility metadata.', limit: 21 }).code, 'invalid_input');
  assert.equal(translateLegacyDiscoverSources({ question: 'Find public facility metadata.', subjects: ['hospitals'] }).code, 'invalid_input');
});
