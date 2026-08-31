import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEGACY_COMPATIBILITY,
  PUBLIC_CAPABILITY_FLAGS,
  TOOL_DEFINITIONS,
  WEBMCP_SPECIFICATION,
  registerObservatoryToolkitWebMcp,
  translateLegacyDiscoverSources
} from '../../../../packages/machine-toolkit/src/index.mjs';
import { createMachineToolkitRouter } from '../../../../worker/machine-toolkit-router.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (relative) => fs.readFile(path.join(root, relative), 'utf8');
const readJson = async (relative) => JSON.parse(await read(relative));
const RECEIPT_PATH = 'verification/wp12/v1.0.0/receipts/candidate-validation.json';

async function walk(relative) {
  const absolute = path.join(root, relative);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`WP12_SEAL_SYMLINK_FORBIDDEN:${child}`);
    if (entry.isDirectory()) files.push(...await walk(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function artifactSeal() {
  const paths = [
    ...await walk('packages/machine-toolkit'),
    ...await walk('verification/wp12/v1.0.0'),
    'apps/web/src/providers/registerObservatoryToolkit.ts',
    'apps/web/src/providers/registerObservatoryToolkit.test.ts',
    'worker/machine-toolkit-adapter.mjs',
    'worker/machine-toolkit-router.mjs'
  ].filter((file) => file !== RECEIPT_PATH).sort();
  const files = [];
  for (const file of paths) {
    const bytes = await fs.readFile(path.join(root, file));
    files.push({ path: file, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  return {
    algorithm: 'sha256_of_ordered_path_and_file_sha256_rows',
    excluded: [RECEIPT_PATH],
    file_count: files.length,
    digest: `sha256:${crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex')}`
  };
}

const manifest = await readJson('contracts/machine-toolkit/v1.0.0/contracts/toolkit-manifest.json');
assert.equal(WEBMCP_SPECIFICATION.commit, manifest.webmcp_specification.commit);
assert.equal(WEBMCP_SPECIFICATION.snapshot_date, manifest.webmcp_specification.snapshot_date);
assert.equal(TOOL_DEFINITIONS.length, 9);
assert.deepEqual(Object.values(PUBLIC_CAPABILITY_FLAGS), Array(9).fill(false));
assert.equal(LEGACY_COMPATIBILITY.defaultRegistered, false);
assert.equal(LEGACY_COMPATIBILITY.registrationState, 'disabled_pending_legacy_audit');

for (const tool of TOOL_DEFINITIONS) {
  const frozen = manifest.tools.find((entry) => entry.capability === tool.capability);
  assert.ok(frozen, tool.capability);
  assert.equal(tool.toolName, frozen.tool_name);
  assert.equal(tool.serviceMethod, frozen.canonical_service_method.replace(/^machine\./u, ''));
  assert.deepEqual(tool.jsonApi, frozen.json_api);
  assert.equal(tool.inputMaxBytes, frozen.input_max_bytes);
  assert.equal(tool.outputMaxBytes, frozen.output_max_bytes);
  assert.deepEqual(tool.annotations, { readOnlyHint: true, untrustedContentHint: true });
}

const runtimeFiles = [
  'packages/machine-toolkit/src/index.mjs',
  'packages/machine-toolkit/src/input-validation.mjs',
  'packages/machine-toolkit/src/json.mjs',
  'packages/machine-toolkit/src/legacy.mjs',
  'packages/machine-toolkit/src/manifest.mjs',
  'packages/machine-toolkit/src/safety.mjs',
  'packages/machine-toolkit/src/service.mjs',
  'packages/machine-toolkit/src/webmcp.mjs',
  'apps/web/src/providers/registerObservatoryToolkit.ts',
  'worker/machine-toolkit-adapter.mjs',
  'worker/machine-toolkit-router.mjs'
];

const hashes = {};
for (const file of runtimeFiles) {
  const content = await read(file);
  hashes[file] = crypto.createHash('sha256').update(content).digest('hex');
  assert.doesNotMatch(content, /(?:from|import\s*)\s*['"]node:/u, `${file} must remain browser/Worker portable`);
  assert.doesNotMatch(content, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/u, `${file} must contain no network client`);
}

const browserEntry = await read('apps/web/src/main.tsx');
const browserSuccessor = await read('apps/web/src/providers/registerObservatoryToolkit.ts');
const workerEntry = await read('worker/index.mjs');
assert.match(browserSuccessor, /export async function registerObservatoryToolkit\s*\(/u);
assert.doesNotMatch(browserEntry, /registerObservatoryToolkit/u, 'candidate browser provider must remain unwired');
assert.doesNotMatch(workerEntry, /machine-toolkit/u, 'candidate Worker router must remain unwired');
assert.throws(() => registerObservatoryToolkitWebMcp({ activationFlags: { search_assets: true } }), /CALLER_ACTIVATION_FORBIDDEN/u);
assert.throws(() => createMachineToolkitRouter({ activationFlags: { search_assets: true } }), /CALLER_ACTIVATION_FORBIDDEN/u);

const safeLegacy = translateLegacyDiscoverSources({ question: 'Find public facility metadata.', limit: 20 });
assert.equal(safeLegacy.ok, true);
assert.equal(safeLegacy.input.limit, 20);
assert.equal(translateLegacyDiscoverSources({ question: 'Find public facility metadata.', limit: 21 }).code, 'invalid_input');
assert.equal(translateLegacyDiscoverSources({ question: 'Find public facility metadata.', subjects: ['hospital'] }).code, 'invalid_input');

const ledger = await readJson('verification/wp12/v1.0.0/evidence-ledger.json');
const authorizationRegister = await readJson('verification/external-authorization/v1.0.0/register.json');
const authorizationById = new Map(authorizationRegister.entries.map((entry) => [entry.id, entry]));
assert.equal(ledger.scope, 'protected_candidate_foundation');
assert.deepEqual(ledger.external_authorizations.map((entry) => entry.id).sort(), ['AUTH-06', 'AUTH-07', 'AUTH-12', 'AUTH-13', 'AUTH-14', 'AUTH-15']);
assert.ok(ledger.external_authorizations.every((entry) => entry.status === 'not_requested' && entry.authorized === false));
for (const reference of ledger.external_authorizations) {
  const registered = authorizationById.get(reference.id);
  assert.ok(registered, `authorization ${reference.id} is absent from the external register`);
  assert.equal(reference.status, registered.status);
  assert.equal(reference.authorized, registered.authorized);
  assert.equal(reference.environment, registered.environment);
}
for (const id of ['TST-MCP-01', 'TST-MCP-02', 'TST-MCP-03', 'TST-MCP-04', 'TST-MCP-05', 'AUTH-12-PLANNER-GOVERNANCE', 'WP12-PUBLIC-ACTIVATION']) {
  assert.ok(ledger.requirements.some((entry) => entry.id === id), `missing ledger requirement ${id}`);
}
assert.equal(ledger.requirements.find((entry) => entry.id === 'AUTH-12-PLANNER-GOVERNANCE').status, 'not_authorized_blocks_planner_implementation_and_activation');
assert.equal(ledger.requirements.find((entry) => entry.id === 'WP12-PUBLIC-ACTIVATION').status, 'pending_prerequisite_gates_AUTH-06_candidate_and_AUTH-07_cutover');

const receipt = await readJson(RECEIPT_PATH);
assert.equal(receipt.scope, 'protected_candidate_foundation');
assert.equal(receipt.work_package_acceptance, 'NOT_ACCEPTED_PUBLIC_GATES_AND_ACTIVATION_PENDING');
assert.equal(receipt.public_activation.enabled_tool_count, 0);
assert.equal(receipt.public_activation.plan_research, 'disabled');
assert.equal(receipt.public_activation.live_canary, 'pending_external_authorization_and_release_gates');
assert.deepEqual(receipt.public_activation.authorization_dependencies.map((entry) => entry.id).sort(), ['AUTH-06', 'AUTH-07', 'AUTH-12', 'AUTH-13', 'AUTH-14', 'AUTH-15']);
assert.ok(receipt.public_activation.authorization_dependencies.every((entry) => entry.status === 'not_requested' && entry.authorized === false));
for (const reference of receipt.public_activation.authorization_dependencies) {
  const registered = authorizationById.get(reference.id);
  assert.equal(reference.status, registered.status);
  assert.equal(reference.authorized, registered.authorized);
  assert.equal(reference.environment, registered.environment);
}
assert.ok(receipt.verification.every((entry) => entry.status === 'PASS'));
assert.deepEqual(receipt.artifact_seal, await artifactSeal());

process.stdout.write(`${JSON.stringify({
  ok: true,
  scope: 'protected_candidate_foundation',
  contract: manifest.contract_version,
  tools: TOOL_DEFINITIONS.length,
  public_enabled_tools: 0,
  live_canary: 'pending',
  runtime_file_sha256: hashes
}, null, 2)}\n`);
