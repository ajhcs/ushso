import { describe, expect, it, vi } from 'vitest'
import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import {
  ApiDiscoveryProvider,
  assertDiscoveryResult,
  DiscoveryProviderError,
  FixtureDiscoveryProvider,
} from './discoveryProvider'

const acceptedResponse = await loadAcceptedDiscoveryFixture()
assertDiscoveryResult(acceptedResponse)
const acceptedQuery = { question: acceptedResponse.query.question }

describe('DiscoveryProvider contract', () => {
  it('loads the accepted serialized retrieval result without rewriting it', async () => {
    const provider = new FixtureDiscoveryProvider(loadAcceptedDiscoveryFixture, 'accepted')
    const result = await provider.discover(acceptedQuery)

    expect(provider.promotionState).toBe('accepted')
    expect(result).toEqual(acceptedResponse)
    expect(result).not.toBe(acceptedResponse)
  })

  it('fails closed when a fixture does not cover the requested question', async () => {
    const provider = new FixtureDiscoveryProvider(loadAcceptedDiscoveryFixture, 'accepted')
    await expect(provider.discover({ question: 'A different supported-length question' })).rejects.toMatchObject({
      code: 'fixture_query_unavailable',
    })
  })

  it('posts the canonical query and validates the API response boundary', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(acceptedResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const provider = new ApiDiscoveryProvider('/api/discover', fetchImpl)
    const result = await provider.discover(acceptedQuery)

    expect(result).toEqual(acceptedResponse)
    expect(fetchImpl).toHaveBeenCalledWith('/api/discover', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(acceptedQuery),
    }))
  })

  it('uses dedicated catalog and stable-record GET routes', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(acceptedResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const provider = new ApiDiscoveryProvider('/api/discover', fetchImpl)
    await provider.browse()
    await provider.dataset('obs:asset:example')

    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/catalog?limit=200&corpus=1.1.0', expect.objectContaining({ method: 'GET' }))
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/datasets/obs%3Aasset%3Aexample', expect.objectContaining({ method: 'GET' }))
  })

  it('rejects a response that does not preserve the canonical result contract', () => {
    expect(() => assertDiscoveryResult({ contract_version: 'invented-ui-contract' })).toThrowError(DiscoveryProviderError)
  })
})
