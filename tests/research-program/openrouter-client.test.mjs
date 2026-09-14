import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MODEL,
  PAID_CALLS_ENABLED,
  blockedFetch,
  createProviderRequest,
  executeOpenRouterRequest,
  openrouterKeyFromSecretProvider,
  readWorkerSource,
  runResidualJob,
  workerImportsEnrichment,
} from '../../packages/enrichment/openrouter-client.mjs';
import { createResidualTasks, qualifyDeterministic } from '../../packages/coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function secretProvider(value) {
  return { getSecret: ({ name }) => (name === 'openrouter_api_key' ? value : null) };
}

function residual() {
  return {
    residual_id: 'residual:001',
    record_id: 'obs:asset:cms-data-catalog:example',
    source_id: 'cms-data-catalog',
    field: 'dictionary',
    cause: 'dictionary_locator_unresolved',
    llm_from_memory_forbidden: true,
    evidence: { kind: 'public_passage', locator: 'verification/research-program/pr-013/', quote: 'XLSX tables without the word dictionary stay unresolved' },
  };
}

function validPayload() {
  return {
    status: 'extracted',
    residual_id: 'residual:001',
    field: 'dictionary',
    value: 'unresolved',
    evidence_ids: ['verification/research-program/pr-013/'],
    insufficient_evidence: false,
  };
}

test('missing credentials, unsupported structured outputs and missing exact model fail closed', () => {
  assert.equal(openrouterKeyFromSecretProvider(null).present, false);
  assert.equal(openrouterKeyFromSecretProvider(secretProvider('')).reason, 'OPENROUTER_KEY_MISSING');
  assert.throws(() => createProviderRequest({ residual: residual(), structuredOutputsSupported: false }), { code: 'STRUCTURED_OUTPUTS_UNSUPPORTED' });
  assert.throws(() => createProviderRequest({ residual: residual(), model: 'openrouter/auto' }), { code: 'EXACT_MODEL_MISSING' });
  const request = createProviderRequest({ residual: residual() });
  assert.equal(request.model, DEFAULT_MODEL);
  assert.equal(request.paid_calls_enabled, false);
  assert.equal(request.claim_acceptance, false);
  assert.match(request.prompt_hash, /^[a-f0-9]{64}$/);
});

test('malformed JSON, truncated output, provider error and unsupported fields are rejected without publishing claims', async () => {
  const request = createProviderRequest({ residual: residual() });
  const opts = { secretProvider: secretProvider('present') };
  await assert.rejects(() => executeOpenRouterRequest(request, { ...opts, paidCallsEnabled: true, transport: async () => ({ choices: [{ message: { content: '{not json' } }] }) }), { code: 'MALFORMED_JSON' });
  await assert.rejects(() => executeOpenRouterRequest(request, { ...opts, paidCallsEnabled: true, transport: async () => ({ truncated: true, choices: [{ message: { content: '{}' } }] }) }), { code: 'TRUNCATED_OUTPUT' });
  await assert.rejects(() => executeOpenRouterRequest(request, { ...opts, paidCallsEnabled: true, transport: async () => ({ error: 'upstream 502' }) }), { code: 'PROVIDER_ERROR' });
  const extra = { ...validPayload(), extra_claim: 'nope' };
  await assert.rejects(() => executeOpenRouterRequest(request, { ...opts, paidCallsEnabled: true, transport: async () => ({ id: 'gen-1', model: DEFAULT_MODEL, choices: [{ message: { content: JSON.stringify(extra) } }] }) }), { code: 'UNSUPPORTED_RESPONSE_FIELD' });
  await assert.rejects(() => executeOpenRouterRequest(request, { ...opts, paidCallsEnabled: false, transport: async () => ({}) }), { code: 'PAID_CALLS_DISABLED' });
});

test('fake-provider residual job passes without a harness and Worker does not import the model client', async () => {
  assert.equal(PAID_CALLS_ENABLED, false);
  const result = await qualifyDeterministic({ repoRoot: root, maxResiduals: 3 });
  const job = result.residuals.tasks.find((task) => task.evidence.kind === 'public_passage');
  assert.ok(job);
  const request = createProviderRequest({ residual: job });
  const executed = await executeOpenRouterRequest(request, {
    secretProvider: secretProvider('present'),
    paidCallsEnabled: true,
    transport: async () => ({
      id: 'gen-fixture',
      model: DEFAULT_MODEL,
      usage: { prompt_tokens: 12, completion_tokens: 8 },
      choices: [{ message: { content: JSON.stringify({
        status: 'insufficient_evidence',
        residual_id: job.residual_id,
        field: job.field,
        value: null,
        evidence_ids: [job.evidence.locator],
        insufficient_evidence: true,
      }) } }],
    }),
  });
  assert.equal(executed.claim_accepted, false);
  assert.equal(executed.publication_authorized, false);
  assert.equal(executed.model, DEFAULT_MODEL);
  assert.equal(executed.response_id, 'gen-fixture');
  const e2e = await runResidualJob(job, {
    secretProvider: secretProvider('present'),
    paidCallsEnabled: true,
    launchDsh: false,
    transport: async () => ({
      id: 'gen-e2e',
      model: DEFAULT_MODEL,
      choices: [{ message: { content: JSON.stringify({
        status: 'insufficient_evidence',
        residual_id: job.residual_id,
        field: job.field,
        value: null,
        evidence_ids: [job.evidence.locator],
        insufficient_evidence: true,
      }) } }],
    }),
  });
  assert.equal(e2e.harness_required, false);
  assert.equal(e2e.claim_accepted, false);
  await assert.rejects(() => runResidualJob(job, { launchDsh: true }), { code: 'DSH_SHELL_FORBIDDEN' });
  const worker = await fs.readFile(path.join(root, 'worker/index.mjs'), 'utf8');
  assert.equal(workerImportsEnrichment(worker), false);
  assert.equal(workerImportsEnrichment(readWorkerSource(root)), false);
  await assert.rejects(() => blockedFetch('https://openrouter.ai/api/v1/chat/completions'), { code: 'OPENROUTER_LIVE_NETWORK_FORBIDDEN' });
});
