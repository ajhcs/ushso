import { describe, expect, it, vi } from 'vitest'
import { registerAvailableObservatoryToolkit, registerObservatoryToolkit, type ObservatoryToolkitAdapter } from './registerObservatoryToolkit'

describe('registerAvailableObservatoryToolkit', () => {
  it('exports the plan-required registerObservatoryToolkit entry point', () => {
    expect(registerAvailableObservatoryToolkit).toBe(registerObservatoryToolkit)
  })

  it('keeps every successor tool unregistered while public gates are pending', async () => {
    const registerTool = vi.fn()
    const toolkit = { invokeWebMcp: vi.fn() } as unknown as ObservatoryToolkitAdapter
    const handle = await registerAvailableObservatoryToolkit(toolkit, { registerTool })

    expect(registerTool).not.toHaveBeenCalled()
    expect(handle?.names).toEqual([])
    await handle?.unregister()
    expect(handle?.signal.aborted).toBe(true)
  })

  it('feature-detects WebMCP and performs no fallback registration', async () => {
    const toolkit = { invokeWebMcp: vi.fn() } as unknown as ObservatoryToolkitAdapter
    expect(await registerAvailableObservatoryToolkit(toolkit, undefined)).toBeNull()
    expect(toolkit.invokeWebMcp).not.toHaveBeenCalled()
  })

  it('links an external lifecycle abort even with zero publicly active tools', async () => {
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
