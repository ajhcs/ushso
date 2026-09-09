import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { PUBLIC_CAPABILITY_FLAGS, REGISTRATION_POLICY, TOOL_DEFINITIONS } from '../../../../packages/machine-toolkit/src/index.mjs';

const root = new URL('../../../../', import.meta.url);

test('successor activates exactly eight read-only inspection tools', async () => {
  assert.equal(TOOL_DEFINITIONS.length, 9);
  assert.deepEqual(Object.values(PUBLIC_CAPABILITY_FLAGS), [...Array(8).fill(true), false]);
  assert.equal(REGISTRATION_POLICY.enabledToolCount, 8);
  assert.equal(REGISTRATION_POLICY.authoritativeSourceEgressAllowed, false);
  assert.equal(REGISTRATION_POLICY.sourceAcquisitionAllowed, false);

  const contract = JSON.parse(await fs.readFile(new URL('packages/machine-toolkit/public-webmcp-tool.json', root), 'utf8'));
  assert.equal(contract.enabled_tool_count, 8);
  assert.deepEqual(contract.tools.map(tool => tool.capability), TOOL_DEFINITIONS.slice(0, 8).map(tool => tool.capability));
  assert.deepEqual(contract.disabled_tools.map(tool => tool.capability), ['plan_research']);
  assert.ok(contract.tools.every(tool => tool.registration_state === 'active'));
  assert.equal(contract.read_only, true);
  assert.equal(contract.source_network_allowed_at_invocation, false);
  assert.equal(contract.payload_retrieval_allowed, false);
});

test('browser and Worker entry points wire the successor without caller activation overrides', async () => {
  const [browser, worker, router] = await Promise.all([
    fs.readFile(new URL('apps/web/src/main.tsx', root), 'utf8'),
    fs.readFile(new URL('worker/index.mjs', root), 'utf8'),
    fs.readFile(new URL('worker/machine-toolkit-router.mjs', root), 'utf8'),
  ]);
  assert.match(browser, /registerAvailableObservatoryToolkit\(createBrowserMachineToolkitClient\(\)\)/u);
  assert.match(worker, /createMachineToolkitRouter/u);
  assert.match(worker, /\/api\/machine\/v1\//u);
  assert.doesNotMatch(router, /flags\s*=\s*request/u);
});
