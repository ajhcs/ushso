import { cloneJson, snapshotDigest } from './json.mjs';
import { validateInput } from './input-validation.mjs';
import { FALSE_TRUTH_BOUNDARY, assertOutputBound, validateCanonicalCore } from './safety.mjs';
import { PUBLIC_CAPABILITY_FLAGS, TOOL_BY_CAPABILITY, TOOL_DEFINITIONS } from './manifest.mjs';

const METHOD_NAMES = Object.freeze(TOOL_DEFINITIONS.map((tool) => tool.serviceMethod));
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._~:/-]{0,127}$/u;

function iso(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('MACHINE_TOOLKIT_CLOCK_INVALID');
  return date.toISOString();
}

function defaultRequestId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('MACHINE_TOOLKIT_RANDOM_UUID_REQUIRED');
  return `request.${globalThis.crypto.randomUUID()}`;
}

function safeGeneration(input, context) {
  return typeof input?.expected_generation === 'string' && STABLE_ID.test(input.expected_generation)
    ? input.expected_generation
    : context.index_generation;
}

function normalizeContext(context, now) {
  const value = typeof context === 'function' ? context() : context;
  const generatedAt = now;
  const defaults = {
    registry_revision: 'registry.unavailable',
    index_generation: 'generation.unavailable',
    publication_manifest_id: 'publication.unavailable',
    canonical_as_of: generatedAt,
    coverage_snapshot_id: null,
    generation_retention_expires_at: null,
    rate_limit: {
      policy_id: 'public-machine-read.v1',
      limit: 1,
      remaining: 1,
      reset_at: generatedAt,
      retry_after_seconds: null
    }
  };
  const result = { ...defaults, ...(value ?? {}), rate_limit: { ...defaults.rate_limit, ...(value?.rate_limit ?? {}) } };
  for (const key of ['registry_revision', 'index_generation', 'publication_manifest_id']) if (!STABLE_ID.test(result[key])) throw new TypeError(`MACHINE_TOOLKIT_CONTEXT_INVALID:${key}`);
  return cloneJson(result);
}

function errorMessages(code) {
  switch (code) {
    case 'invalid_input': return ['The request does not conform to the bounded machine-toolkit input contract.', 'Correct the public input fields and retry.'];
    case 'response_limit_exceeded': return ['The complete safety-atomic response exceeds this capability output limit.', 'Narrow the request or use a documented cursor; no partial safety section was returned.'];
    case 'planner_unavailable': return ['The research-plan compiler is not enabled in the public capability manifest.', 'Use the inspection capabilities while plan_research remains disabled.'];
    default: return ['The bounded metadata service could not safely return this result.', 'Retry later without changing a valid generation pin.'];
  }
}

export function createDomainErrorCore({ capability, code, input = {}, context, resultState, retryable = false, restartRequired = false, retryAfterSeconds = null }) {
  const generation = safeGeneration(input, context);
  const [safeMessage, guidance] = errorMessages(code);
  const recordId = typeof input.record_id === 'string' && STABLE_ID.test(input.record_id) ? input.record_id : null;
  return {
    tool_contract_version: 'observatory-machine-toolkit.v1.0.0',
    capability,
    ok: false,
    registry_revision: context.registry_revision,
    index_generation: generation,
    publication_manifest_id: context.publication_manifest_id,
    canonical_as_of: context.canonical_as_of,
    coverage_snapshot_id: context.coverage_snapshot_id,
    result_state: resultState ?? (code === 'planner_unavailable' ? 'disabled' : 'unavailable'),
    result: null,
    error: {
      code,
      safe_message: safeMessage,
      retryable,
      generation,
      scope: { capability, record_id: recordId, query_scope_id: null },
      corrective_guidance: guidance,
      retry_after_seconds: retryAfterSeconds
    },
    evidence_references: [],
    warnings: [],
    truncated: false,
    omitted_sections: [],
    next_cursor: null,
    continuation_expires_at: null,
    generation_retention_expires_at: context.generation_retention_expires_at,
    restart_required: restartRequired,
    rate_limit: { ...context.rate_limit, retry_after_seconds: retryAfterSeconds },
    truth_boundary: { ...FALSE_TRUTH_BOUNDARY }
  };
}

export function assertCanonicalService(service) {
  if (!service || typeof service !== 'object') throw new TypeError('MACHINE_TOOLKIT_SERVICE_REQUIRED');
  for (const method of METHOD_NAMES) if (typeof service[method] !== 'function') throw new TypeError(`MACHINE_TOOLKIT_SERVICE_METHOD_REQUIRED:${method}`);
  return service;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
  throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function validRequestId(value) {
  return typeof value === 'string' && STABLE_ID.test(value) ? value : defaultRequestId();
}

export function createMachineToolkit({
  service,
  responseContext,
  clock = () => new Date(),
  requestId = defaultRequestId,
  cryptoProvider = globalThis.crypto
}) {
  const canonicalService = assertCanonicalService(service);

  async function invoke(transportAdapter, capability, input, options = {}) {
    const tool = TOOL_BY_CAPABILITY.get(capability);
    if (!tool) throw new TypeError(`MACHINE_TOOLKIT_CAPABILITY_UNKNOWN:${capability}`);
    if (!['json_api', 'webmcp'].includes(transportAdapter)) throw new TypeError(`MACHINE_TOOLKIT_TRANSPORT_UNKNOWN:${transportAdapter}`);
    throwIfAborted(options.signal);
    const generatedAt = iso(clock);
    const context = normalizeContext(responseContext, generatedAt);
    const inputIssues = validateInput(capability, input);
    let core;
    if (inputIssues.length > 0) {
      core = createDomainErrorCore({ capability, code: 'invalid_input', input, context });
    } else if (capability === 'plan_research') {
      // This is deliberately code-enforced in addition to the all-false public
      // manifest so a caller cannot activate the planner by configuration alone.
      core = createDomainErrorCore({ capability, code: 'planner_unavailable', input, context, resultState: 'disabled' });
    } else {
      const returned = await canonicalService[tool.serviceMethod](cloneJson(input), { signal: options.signal });
      throwIfAborted(options.signal);
      core = cloneJson(returned);
      const outputIssues = validateCanonicalCore(core, capability, input, { responseGeneratedAt: generatedAt });
      if (outputIssues.length > 0) {
        options.onSafetyFailure?.({ capability, issue_codes: [...new Set(outputIssues.map((entry) => entry.code))] });
        core = createDomainErrorCore({ capability, code: 'service_unavailable', input, context, retryable: true });
      }
    }

    async function envelope(value) {
      const response = {
        ...cloneJson(value),
        transport_adapter: transportAdapter,
        request_id: validRequestId(requestId({ capability, transportAdapter })),
        response_generated_at: generatedAt,
        result_snapshot_id: null,
        candidate_snapshot_id: null
      };
      if (response.ok) {
        const digest = await snapshotDigest(response, cryptoProvider);
        if (capability === 'plan_research') response.candidate_snapshot_id = digest;
        else response.result_snapshot_id = digest;
      }
      return response;
    }

    let response = await envelope(core);
    const boundIssue = assertOutputBound(response, tool.outputMaxBytes);
    if (boundIssue) {
      options.onSafetyFailure?.({ capability, issue_codes: [boundIssue.code] });
      response = await envelope(createDomainErrorCore({ capability, code: 'response_limit_exceeded', input, context }));
      if (assertOutputBound(response, tool.outputMaxBytes)) throw new Error('MACHINE_TOOLKIT_ERROR_ENVELOPE_EXCEEDS_LIMIT');
    }
    throwIfAborted(options.signal);
    return response;
  }

  return Object.freeze({
    publicCapabilityFlags: PUBLIC_CAPABILITY_FLAGS,
    invokeJsonApi: (capability, input, options) => invoke('json_api', capability, input, options),
    invokeWebMcp: (capability, input, options) => invoke('webmcp', capability, input, options)
  });
}
