import { describe, expect, it, vi } from 'vitest'
import type { DiscoveryProvider } from './discoveryProvider'
import { registerAvailableWebMcp } from './registerWebMcp'

describe('registerAvailableWebMcp', () => {
  it('registers the read-only tool over the same DiscoveryProvider contract', async () => {
    let registered: { execute(input: unknown): Promise<unknown>; annotations: Record<string, boolean> } | undefined
    const registerTool = vi.fn((tool: unknown) => { registered = tool as typeof registered })
    const discover = vi.fn(async (query) => ({ contract_version: 'observatory-discovery-result.v1.0.0', query }))
    const provider = { kind: 'api', promotionState: 'remote', discover } as unknown as DiscoveryProvider
    const handle = await registerAvailableWebMcp(provider, { registerTool })
    expect(handle?.name).toBe('observatory.discover_sources')
    expect(registerTool).toHaveBeenCalledOnce()
    expect(registered?.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true })
    await registered?.execute({ question: 'hospital financial data' })
    expect(discover).toHaveBeenCalledWith({ question: 'hospital financial data' }, { signal: undefined })
    handle?.unregister?.()
  })

  it('is a no-op when the browser does not expose WebMCP', async () => {
    expect(await registerAvailableWebMcp({} as DiscoveryProvider, undefined)).toBeNull()
  })
})
