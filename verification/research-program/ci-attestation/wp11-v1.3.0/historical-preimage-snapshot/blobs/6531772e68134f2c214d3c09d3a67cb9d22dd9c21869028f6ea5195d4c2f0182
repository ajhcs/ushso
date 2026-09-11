import type { DiscoveryQuery } from '../types/discovery'
import { createDefaultDiscoveryProvider, type DiscoveryProvider } from './discoveryProvider'

// @ts-expect-error The workspace retrieval package publishes browser-native ESM without a TypeScript declaration file.
import { registerObservatoryWebMcp } from '../../../../packages/retrieval/tools/webmcp.mjs'

interface WebMcpModelContext {
  registerTool(tool: unknown, options: { signal: AbortSignal }): Promise<void> | void
}

interface WebMcpDocument extends Document {
  modelContext?: WebMcpModelContext
}

export async function registerAvailableWebMcp(
  provider: DiscoveryProvider = createDefaultDiscoveryProvider(),
  modelContext: WebMcpModelContext | undefined = (globalThis.document as WebMcpDocument | undefined)?.modelContext,
) {
  if (!modelContext || typeof modelContext.registerTool !== 'function') return null
  return registerObservatoryWebMcp({
    modelContext,
    engine: {
      retrieve(input: DiscoveryQuery, options: { signal?: AbortSignal } = {}) {
        return provider.discover(input, { signal: options.signal })
      },
    },
  })
}
