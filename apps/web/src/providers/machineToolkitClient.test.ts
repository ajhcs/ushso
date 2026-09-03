import { describe, expect, it, vi } from 'vitest'
import { createBrowserMachineToolkitClient } from './machineToolkitClient'

describe('browser machine toolkit client', () => {
  it('posts search input to the isolated machine API', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const client = createBrowserMachineToolkitClient(fetchImpl)
    const input = { contract_version: 'observatory.machine.search-assets.input.v1.0.0', mode: 'browse' }
    await client.invokeWebMcp('search_assets', input)
    expect(fetchImpl).toHaveBeenCalledWith('/api/machine/v1/search-assets', expect.objectContaining({
      method: 'POST', body: JSON.stringify(input),
    }))
  })

  it('serializes the complete get-asset context without changing identifiers', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const client = createBrowserMachineToolkitClient(fetchImpl)
    await client.invokeWebMcp('get_asset', {
      record_id: 'obs:asset:test/a', expected_generation: 'generation.test',
      collection_limits: { releases: 3, distributions: 4, documentation: 5, schemas: 6 },
      collection_cursors: { releases: null, distributions: null, documentation: null, schemas: null },
    })
    const url = String(fetchImpl.mock.calls[0][0])
    expect(url).toContain('/api/machine/v1/assets/obs%3Aasset%3Atest%2Fa?')
    expect(url).toContain('generation=generation.test')
    expect(url).toContain('schemas_limit=6')
  })

  it('forwards one abort signal and rejects HTTP failures', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 503 }))
    const client = createBrowserMachineToolkitClient(fetchImpl)
    const controller = new AbortController()
    await expect(client.invokeWebMcp('compare_assets', {}, { signal: controller.signal })).rejects.toThrow('HTTP 503')
    expect(fetchImpl.mock.calls[0][1]?.signal).toBe(controller.signal)
  })
})
