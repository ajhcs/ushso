import { createRetrievalEngine } from './retrieval-core.mjs';
import { DISCOVERY_QUERY_SCHEMA } from './query-schema.mjs';

export const TOOL_NAME = 'observatory.discover_sources';

export async function registerObservatoryWebMcp({
  modelContext = globalThis.document?.modelContext,
  engine,
  records,
  joinRoutes,
  vocabulary,
  corpus,
  registrationSignal
} = {}) {
  if (!modelContext || typeof modelContext.registerTool !== 'function') throw new TypeError('a WebMCP ModelContext with registerTool() is required');
  const retrievalEngine = engine ?? createRetrievalEngine({ records, joinRoutes, vocabulary, corpus });
  const controller = registrationSignal ? null : new AbortController();
  const signal = registrationSignal ?? controller.signal;
  await modelContext.registerTool({
    name: TOOL_NAME,
    title: 'Discover US health-systems data',
    description: 'Deterministically interpret a research question and retrieve evidence-bound Observatory asset records, access requirements, provenance, retrieval instructions, restrictions, and explicit join routes from the published offline corpus. This tool does not search the web or generate source claims.',
    inputSchema: DISCOVERY_QUERY_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, options = {}) {
      return retrievalEngine.retrieve(input, { signal: options.signal });
    }
  }, { signal });
  return Object.freeze({ name: TOOL_NAME, signal, unregister: controller ? () => controller.abort() : null });
}
