import { describe, expect, it, vi } from 'vitest'
import { registerAvailableObservatoryToolkit, registerObservatoryToolkit, resolveWebMcpModelContext, type ObservatoryToolkitAdapter } from './registerObservatoryToolkit'

describe('registerAvailableObservatoryToolkit', () => {
  it('exports the plan-required registerObservatoryToolkit entry point', () => {
    expect(registerAvailableObservatoryToolkit).toBe(registerObservatoryToolkit)
  })

  it('registers the eight public inspection tools and keeps the planner disabled', async () => {
    const registered: Array<Record<string, any>> = []
    const registerTool = vi.fn((tool: Record<string, any>) => registered.push(tool))
    const toolkit = { invokeWebMcp: vi.fn() } as unknown as ObservatoryToolkitAdapter
    const handle = await registerAvailableObservatoryToolkit(toolkit, { registerTool })

    expect(registerTool).toHaveBeenCalledTimes(8)
    expect(handle?.names).toEqual([
      'observatory.search_assets', 'observatory.get_asset', 'observatory.get_access_plan',
      'observatory.get_retrieval_recipe', 'observatory.get_variables', 'observatory.get_join_routes',
      'observatory.compare_assets', 'observatory.get_coverage_status',
    ])
    expect(registered.every(tool => tool.inputSchema.type === 'object' || Array.isArray(tool.inputSchema.oneOf))).toBe(true)
    expect(registered.every(tool => tool.inputSchema.$defs && !JSON.stringify(tool.inputSchema).includes('common.schema.json'))).toBe(true)
    await handle?.unregister()
    expect(handle?.signal.aborted).toBe(true)
  })

  it('feature-detects WebMCP and performs no fallback registration', async () => {
    const toolkit = { invokeWebMcp: vi.fn() } as unknown as ObservatoryToolkitAdapter
    expect(await registerAvailableObservatoryToolkit(toolkit, undefined)).toBeNull()
    expect(toolkit.invokeWebMcp).not.toHaveBeenCalled()
  })

  it('prefers the current document surface and supports transitional navigator implementations', () => {
    const current = { registerTool: vi.fn() }
    const transitional = { registerTool: vi.fn() }
    expect(resolveWebMcpModelContext({ modelContext: current } as any, { modelContext: transitional } as any)).toBe(current)
    expect(resolveWebMcpModelContext({} as any, { modelContext: transitional } as any)).toBe(transitional)
    expect(resolveWebMcpModelContext({} as any, {} as any)).toBeUndefined()
  })

  it('links an external lifecycle abort across all public tools', async () => {
    const lifecycle = new AbortController()
    const handle = await registerAvailableObservatoryToolkit(
      { invokeWebMcp: vi.fn() } as unknown as ObservatoryToolkitAdapter,
      { registerTool: vi.fn() },
      lifecycle.signal,
    )
    lifecycle.abort(new DOMException('page disposed', 'AbortError'))
    expect(handle?.signal.aborted).toBe(true)
  })
})
