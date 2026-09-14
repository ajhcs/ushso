import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_SECRET_NAME = 'openrouter_api_key';
export const DEFAULT_MODEL = 'openai/gpt-4.1-mini';
export const DEFAULT_TIMEOUT_MS = 15000;
export const DEFAULT_MAX_TOKENS = 256;
export const PAID_CALLS_ENABLED = false;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'provider-schema.json'), 'utf8'));

export async function blockedFetch() {
  const error = new Error('OPENROUTER_LIVE_NETWORK_FORBIDDEN');
  error.code = 'OPENROUTER_LIVE_NETWORK_FORBIDDEN';
  throw error;
}

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

export function openrouterKeyFromSecretProvider(secretProvider, { sourceId = 'openrouter' } = {}) {
  if (!secretProvider || typeof secretProvider.getSecret !== 'function') {
    return freeze({ present: false, reason: 'SECRET_PROVIDER_MISSING', access_step: 'configure_openrouter_secret_provider' });
  }
  const value = secretProvider.getSecret({ sourceId, name: OPENROUTER_SECRET_NAME });
  if (typeof value !== 'string' || value.length === 0) {
    return freeze({ present: false, reason: 'OPENROUTER_KEY_MISSING', access_step: 'obtain_openrouter_api_key_from_secret_provider' });
  }
  return freeze({ present: true, handle: 'secret://openrouter_api_key', value: null });
}

export function hashPrompt(prompt) {
  return createHash('sha256').update(String(prompt ?? '')).digest('hex');
}

export function createProviderRequest({
  residual,
  model = DEFAULT_MODEL,
  endpoint = OPENROUTER_ENDPOINT,
  prompt,
  schema = SCHEMA,
  maxTokens = DEFAULT_MAX_TOKENS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  supportedModels = [DEFAULT_MODEL],
  structuredOutputsSupported = true,
} = {}) {
  if (!residual?.residual_id) fail('RESIDUAL_REQUIRED');
  if (!Array.isArray(residual.evidence?.quote !== undefined ? [residual.evidence] : residual.evidence_ids ? residual.evidence_ids : null) && !residual.evidence) {
    fail('EVIDENCE_REQUIRED');
  }
  if (residual.llm_from_memory_forbidden === false) fail('LLM_MEMORY_FORBIDDEN');
  if (residual.evidence?.kind === 'insufficient_evidence') fail('INSUFFICIENT_EVIDENCE_RESIDUAL');
  if (!supportedModels.includes(model)) fail('EXACT_MODEL_MISSING');
  if (structuredOutputsSupported !== true) fail('STRUCTURED_OUTPUTS_UNSUPPORTED');
  const text = prompt ?? [
    'Extract only the documented field from the public passage.',
    `residual_id=${residual.residual_id}`,
    `field=${residual.field}`,
    `passage=${residual.evidence?.quote ?? ''}`,
    'Do not invent facts from memory.',
  ].join('\n');
  return freeze({
    format: 'ushso.openrouter-request.v1',
    model,
    endpoint,
    prompt_hash: hashPrompt(text),
    evidence_ids: freeze(residual.evidence?.locator ? [residual.evidence.locator] : (residual.evidence_ids ?? [])),
    residual_id: residual.residual_id,
    json_schema: schema,
    max_tokens: maxTokens,
    timeout_ms: timeoutMs,
    structured_outputs: true,
    paid_calls_enabled: PAID_CALLS_ENABLED,
    claim_acceptance: false,
  });
}

function validateAgainstSchema(payload, schema = SCHEMA) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('RESPONSE_SCHEMA_INVALID');
  const required = schema.required ?? [];
  for (const key of required) {
    if (!Object.hasOwn(payload, key)) fail('RESPONSE_SCHEMA_INVALID');
  }
  const allowed = new Set(Object.keys(schema.properties ?? {}));
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) fail('UNSUPPORTED_RESPONSE_FIELD');
  }
  if (typeof payload.status !== 'string' || !['extracted', 'insufficient_evidence'].includes(payload.status)) fail('RESPONSE_SCHEMA_INVALID');
  if (typeof payload.residual_id !== 'string' || payload.residual_id.length < 3) fail('RESPONSE_SCHEMA_INVALID');
  if (typeof payload.field !== 'string' || payload.field.length < 1) fail('RESPONSE_SCHEMA_INVALID');
  if (!(typeof payload.value === 'string' || payload.value === null)) fail('RESPONSE_SCHEMA_INVALID');
  if (!Array.isArray(payload.evidence_ids) || payload.evidence_ids.length < 1) fail('RESPONSE_SCHEMA_INVALID');
  if (typeof payload.insufficient_evidence !== 'boolean') fail('RESPONSE_SCHEMA_INVALID');
  return true;
}

export async function executeOpenRouterRequest(request, {
  secretProvider,
  transport,
  paidCallsEnabled = PAID_CALLS_ENABLED,
  now = '2026-09-14T00:00:00.000Z',
} = {}) {
  const key = openrouterKeyFromSecretProvider(secretProvider);
  if (!key.present) fail(key.reason, key.access_step);
  if (paidCallsEnabled !== true) fail('PAID_CALLS_DISABLED');
  if (typeof transport !== 'function') fail('TRANSPORT_REQUIRED');
  let raw;
  try {
    raw = await transport({
      endpoint: request.endpoint,
      model: request.model,
      prompt_hash: request.prompt_hash,
      max_tokens: request.max_tokens,
      timeout_ms: request.timeout_ms,
    });
  } catch (error) {
    fail('PROVIDER_ERROR', error?.message ?? 'provider transport failed');
  }
  if (raw?.error) fail('PROVIDER_ERROR', raw.error);
  if (raw?.truncated === true) fail('TRUNCATED_OUTPUT');
  const content = raw?.choices?.[0]?.message?.content ?? raw?.content ?? null;
  if (typeof content !== 'string') fail('MALFORMED_JSON');
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    fail('MALFORMED_JSON');
  }
  validateAgainstSchema(parsed, request.json_schema);
  return freeze({
    format: 'ushso.openrouter-response.v1',
    request,
    model: raw.model ?? request.model,
    response_id: raw.id ?? null,
    usage: freeze(raw.usage ?? {}),
    payload: freeze(parsed),
    observed_at: now,
    claim_accepted: false,
    publication_authorized: false,
  });
}

export async function runResidualJob(residual, options = {}) {
  if (options.launchDsh === true) fail('DSH_SHELL_FORBIDDEN');
  const request = createProviderRequest({ residual, ...options.request });
  const response = await executeOpenRouterRequest(request, options);
  return freeze({
    residual_id: residual.residual_id,
    request,
    response,
    harness_required: false,
    worker_imported: false,
    claim_accepted: false,
  });
}

export function workerImportsEnrichment(workerSource) {
  return /packages\/enrichment|openrouter-client/.test(String(workerSource ?? ''));
}

export function readWorkerSource(repoRoot = ROOT) {
  return readFileSync(path.join(repoRoot, 'worker/index.mjs'), 'utf8');
}
