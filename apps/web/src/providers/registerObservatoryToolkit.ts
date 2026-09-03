// Browser registration for the public, read-only machine toolkit.
// @ts-expect-error The workspace package publishes browser-native ESM without a TypeScript declaration file.
import { registerObservatoryToolkitWebMcp } from '../../../../packages/machine-toolkit/src/index.mjs'
import { publicWebMcpInputSchemas } from './webMcpInputSchemas'

export interface ObservatoryToolkitAdapter {
  invokeWebMcp(capability: string, input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>
}

interface WebMcpModelContext {
  registerTool(tool: unknown, options: { signal: AbortSignal }): Promise<unknown> | unknown
}

interface WebMcpDocument extends Document {
  modelContext?: WebMcpModelContext
}

interface WebMcpNavigator extends Navigator {
  modelContext?: WebMcpModelContext
}

export function resolveWebMcpModelContext(
  documentLike: WebMcpDocument | undefined = globalThis.document as WebMcpDocument | undefined,
  navigatorLike: WebMcpNavigator | undefined = globalThis.navigator as WebMcpNavigator | undefined,
) {
  if (documentLike?.modelContext && typeof documentLike.modelContext.registerTool === 'function') return documentLike.modelContext
  if (navigatorLike?.modelContext && typeof navigatorLike.modelContext.registerTool === 'function') return navigatorLike.modelContext
  return undefined
}

export async function registerObservatoryToolkit(
  toolkit: ObservatoryToolkitAdapter,
  modelContext: WebMcpModelContext | undefined = resolveWebMcpModelContext(),
  lifecycleSignal?: AbortSignal,
) {
  if (!modelContext || typeof modelContext.registerTool !== 'function') return null
  // No caller-provided activation override is accepted here. The reviewed
  // capability manifest is the only public registration authority.
  return registerObservatoryToolkitWebMcp({
    modelContext,
    toolkit,
    lifecycleSignal,
    inputSchemas: publicWebMcpInputSchemas,
  })
}

export const registerAvailableObservatoryToolkit = registerObservatoryToolkit
