import { PUBLIC_CAPABILITY_FLAGS, TOOL_DEFINITIONS } from './manifest.mjs';

function linkSignals(signals) {
  const active = signals.filter(Boolean);
  if (active.length === 0) return { signal: undefined, cleanup() {} };
  if (active.length === 1) return { signal: active[0], cleanup() {} };
  const controller = new AbortController();
  const listeners = [];
  const abort = (signal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  for (const signal of active) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    const listener = () => abort(signal);
    signal.addEventListener('abort', listener, { once: true });
    listeners.push([signal, listener]);
  }
  return {
    signal: controller.signal,
    cleanup() {
      for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener);
    }
  };
}

function inputSchemaFor(definition, inputSchemas) {
  const schema = inputSchemas?.[definition.capability] ?? definition.inputSchema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new TypeError(`MACHINE_TOOLKIT_INPUT_SCHEMA_REQUIRED:${definition.capability}`);
  }
  return schema;
}

export function createWebMcpToolset(toolkit, { lifecycleSignal, inputSchemas } = {}) {
  if (!toolkit || typeof toolkit.invokeWebMcp !== 'function') throw new TypeError('MACHINE_TOOLKIT_ADAPTER_REQUIRED');
  return Object.freeze(TOOL_DEFINITIONS.map((definition) => Object.freeze({
    name: definition.toolName,
    title: definition.title,
    description: definition.description,
    inputSchema: inputSchemaFor(definition, inputSchemas),
    annotations: definition.annotations,
    async execute(input, options = {}) {
      const linked = linkSignals([lifecycleSignal, options.signal]);
      try {
        return await toolkit.invokeWebMcp(definition.capability, input, { signal: linked.signal });
      } finally {
        linked.cleanup();
      }
    }
  })));
}

function assertedActivationFlags(flags) {
  const result = {};
  for (const definition of TOOL_DEFINITIONS) result[definition.capability] = flags?.[definition.capability] === true;
  if (result.plan_research) throw new Error('MACHINE_TOOLKIT_PLANNER_ACTIVATION_FORBIDDEN');
  return result;
}

function throwIfAborted(signal) {
  if (!signal.aborted) return;
  if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
  throw signal.reason ?? new DOMException('Machine toolkit registration aborted.', 'AbortError');
}

async function unregisterAll(registrations) {
  const failures = [];
  for (const registration of [...registrations].reverse()) {
    try { await registration?.unregister?.(); }
    catch (error) { failures.push(error); }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'MACHINE_TOOLKIT_UNREGISTER_INCOMPLETE');
}

async function registerToolset({
  modelContext,
  toolkit,
  activationFlags,
  lifecycleSignal,
  inputSchemas
}) {
  if (!modelContext || typeof modelContext.registerTool !== 'function') return null;
  const flags = assertedActivationFlags(activationFlags);
  const lifecycle = new AbortController();
  const externalAbort = () => lifecycle.abort(lifecycleSignal.reason);
  if (lifecycleSignal?.aborted) externalAbort();
  else lifecycleSignal?.addEventListener('abort', externalAbort, { once: true });
  const tools = createWebMcpToolset(toolkit, { lifecycleSignal: lifecycle.signal, inputSchemas });
  const registrations = [];
  try {
    for (const tool of tools) {
      const definition = TOOL_DEFINITIONS.find((entry) => entry.toolName === tool.name);
      if (!flags[definition.capability]) continue;
      throwIfAborted(lifecycle.signal);
      const registration = await modelContext.registerTool(tool, { signal: lifecycle.signal });
      registrations.push(registration);
    }
  } catch (error) {
    lifecycle.abort(error);
    try { await unregisterAll(registrations); } catch { /* Preserve the registration/cancellation cause. */ }
    lifecycleSignal?.removeEventListener('abort', externalAbort);
    throw error;
  }
  let closed = false;
  return Object.freeze({
    names: Object.freeze(tools.filter((tool) => flags[TOOL_DEFINITIONS.find((entry) => entry.toolName === tool.name).capability]).map((tool) => tool.name)),
    signal: lifecycle.signal,
    async unregister() {
      if (closed) return;
      closed = true;
      lifecycle.abort(new DOMException('Machine toolkit registration closed.', 'AbortError'));
      lifecycleSignal?.removeEventListener('abort', externalAbort);
      await unregisterAll(registrations);
    }
  });
}

export function registerObservatoryToolkitWebMcp(options) {
  if (Object.hasOwn(options ?? {}, 'activationFlags') || Object.hasOwn(options ?? {}, 'candidateActivation')) {
    throw new TypeError('MACHINE_TOOLKIT_CALLER_ACTIVATION_FORBIDDEN');
  }
  const { modelContext, toolkit, lifecycleSignal, inputSchemas } = options ?? {};
  // The public registration entry point has no activation parameter. Promotion
  // therefore requires a reviewed code/manifest change, not caller input.
  return registerToolset({ modelContext, toolkit, activationFlags: PUBLIC_CAPABILITY_FLAGS, lifecycleSignal, inputSchemas });
}

export function registerObservatoryToolkitWebMcpCandidateForLocalVerification(options) {
  if (Object.hasOwn(options ?? {}, 'activationFlags') || Object.hasOwn(options ?? {}, 'candidateActivation')) {
    throw new TypeError('MACHINE_TOOLKIT_CALLER_ACTIVATION_FORBIDDEN');
  }
  const { modelContext, toolkit, lifecycleSignal, inputSchemas } = options ?? {};
  const activationFlags = Object.fromEntries(
    Object.keys(PUBLIC_CAPABILITY_FLAGS).map((capability) => [capability, capability !== 'plan_research'])
  );
  return registerToolset({ modelContext, toolkit, activationFlags, lifecycleSignal, inputSchemas });
}
