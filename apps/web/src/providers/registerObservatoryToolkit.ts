// Successor provider for the frozen machine-toolkit contract. It is deliberately
// not imported by main.tsx until the release gates promote the public manifest.
// @ts-expect-error The workspace package publishes browser-native ESM without a TypeScript declaration file.
import { registerObservatoryToolkitWebMcp } from '../../../../packages/machine-toolkit/src/index.mjs'

export interface ObservatoryToolkitAdapter {
  invokeWebMcp(capability: string, input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>
}

interface WebMcpModelContext {
  registerTool(tool: unknown, options: { signal: AbortSignal }): Promise<unknown> | unknown
}

interface WebMcpDocument extends Document {
  modelContext?: WebMcpModelContext
}

export async function registerObservatoryToolkit(
  toolkit: ObservatoryToolkitAdapter,
  modelContext: WebMcpModelContext | undefined = (globalThis.document as WebMcpDocument | undefined)?.modelContext,
  lifecycleSignal?: AbortSignal,
) {
  if (!modelContext || typeof modelContext.registerTool !== 'function') return null
  // No caller-provided activation override is accepted here. The frozen all-false
  // manifest is the only public registration authority for this candidate.
  return registerObservatoryToolkitWebMcp({
    modelContext,
    toolkit,
    lifecycleSignal,
  })
}

// Temporary source-compatible name for callers preparing the successor before
// activation. Neither export is wired into the current application entry point.
export const registerAvailableObservatoryToolkit = registerObservatoryToolkit
