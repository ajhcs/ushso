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

  it('applies canonical fixture filters with OR within a dimension and AND across dimensions', async () => {
    const provider = new FixtureDiscoveryProvider(loadAcceptedDiscoveryFixture, 'accepted')
    const pennsylvania = await provider.browse({ traversal: { filters: ['geography:US-PA'] } })
    expect(pennsylvania.results.length).toBeGreaterThan(0)
    expect(pennsylvania.results.every((result) => result.record.geography.jurisdictions.includes('US-PA'))).toBe(true)
    if (pennsylvania.pagination) expect(pennsylvania.pagination.total_matches).toBe(pennsylvania.results.length)
    expect(pennsylvania.facets?.sections.find((section) => section.id === 'geography')?.options.find((option) => option.value === 'unknown')).toBeUndefined()

    const mixed = await provider.browse({ traversal: { filters: ['geography:US-PA', 'geography:US'] } })
    expect(mixed.results.length).toBeGreaterThanOrEqual(pennsylvania.results.length)
    expect(mixed.results.every((result) => ['US-PA', 'US'].some((value) => result.record.geography.jurisdictions.includes(value)))).toBe(true)

    const crossDimension = await provider.browse({ traversal: { filters: ['geography:US-PA', 'access_status:public_direct'] } })
    expect(crossDimension.results.length).toBeLessThan(pennsylvania.results.length)
    expect(crossDimension.results.every((result) => result.record.geography.jurisdictions.includes('US-PA'))).toBe(true)
    expect(crossDimension.results.every((result) => result.record.access.status === 'public_direct')).toBe(true)
  })

  it('retains a selected filter through a fixture zero-result roundtrip', async () => {
    const provider = new FixtureDiscoveryProvider(loadAcceptedDiscoveryFixture, 'accepted')
    const response = await provider.browse({ traversal: { filters: ['geography:unknown'] } })
    expect(response.results).toHaveLength(0)
    expect(response.result_count).toBe(0)
    expect(response.total_matches).toBe(0)
    if (response.pagination) expect(response.pagination.total_matches).toBe(0)
    if (response.facets) expect(response.facets.sections.every((section) => section.options.length === 0)).toBe(true)
    expect(response.query.filters.facet_filters).toEqual({ geography: ['unknown'] })
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

  it('pins query traversal to cursor, generation, sort, filters, and page size', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(acceptedResponse), { status: 200 }))
    const provider = new ApiDiscoveryProvider('/api/discover', fetchImpl)
    await provider.discover(acceptedQuery, { traversal: {
      cursor: 'opaque-cursor', generation: 'generation-1', pageSize: 25, sort: 'title_asc', filters: ['source:cms'],
    } })
    const call = fetchImpl.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
    const body = JSON.parse(String(call[1]?.body))
    expect(body).toMatchObject({ cursor: 'opaque-cursor', generation: 'generation-1', page_size: 25, sort: 'title_asc', facet_filters: { source: ['cms'] } })
  })

  it('uses dedicated catalog and stable-record GET routes', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(acceptedResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const provider = new ApiDiscoveryProvider('/api/discover', fetchImpl)
    await provider.browse()
    await provider.dataset('obs:asset:example')

    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/catalog', expect.objectContaining({ method: 'GET' }))
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/datasets/obs%3Aasset%3Aexample', expect.objectContaining({ method: 'GET' }))
  })

  it('turns unavailable generation errors into a restartable provider state', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'generation_unavailable', message: 'old generation' } }), { status: 410 }))
    const provider = new ApiDiscoveryProvider('/api/discover', fetchImpl)
    await expect(provider.discover(acceptedQuery)).rejects.toMatchObject({ code: 'generation_unavailable' })
  })

  it('rejects a response that does not preserve the canonical result contract', () => {
    expect(() => assertDiscoveryResult({ contract_version: 'invented-ui-contract' })).toThrowError(DiscoveryProviderError)
  })

  it.each([
    ['retrieval route', (response: typeof acceptedResponse) => { response.results[0].record.retrieval.instructions[0].url = 'javascript:alert(1)' }],
    ['authoritative URL', (response: typeof acceptedResponse) => { response.results[0].record.authoritative_url = 'data:text/html,unsafe' }],
    ['provenance locator', (response: typeof acceptedResponse) => { response.results[0].record.provenance[0].locator = 'javascript:alert(1)' }],
    ['signed authoritative URL', (response: typeof acceptedResponse) => { response.results[0].record.authoritative_url = 'https://data.cms.gov/source?token=secret' }],
    ['private retrieval route', (response: typeof acceptedResponse) => { response.results[0].record.retrieval.instructions[0].url = 'https://2130706433/source' }],
  ])('rejects an unsafe external %s at the canonical response boundary', (_label, mutate) => {
    const unsafe = structuredClone(acceptedResponse)
    mutate(unsafe)
    expect(() => assertDiscoveryResult(unsafe)).toThrowError(DiscoveryProviderError)
  })

  it('accepts a safe HTTP source locator as preserved evidence without treating host agreement as navigation proof', () => {
    const preserved = structuredClone(acceptedResponse)
    const record = preserved.results[0].record
    record.authoritative_url = 'http://data.cms.gov/provider/example'
    record.retrieval.instructions[0].url = 'http://data.cms.gov/provider/example'
    record.provenance[0].locator = 'https://data.cms.gov/data.json'
    expect(() => assertDiscoveryResult(preserved)).not.toThrow()

    record.provenance[0].locator = 'https://example.gov/data.json'
    expect(() => assertDiscoveryResult(preserved)).not.toThrow()
  })

  it.each(['http://example.org/unverified', 'data:text/html,unsafe'])('rejects an unsafe derived navigation route: %s', (url) => {
    const unsafe = structuredClone(acceptedResponse)
    unsafe.results[0].metadata = {
      description_quality: { authoritative_url: null },
      retrieval_plan: {
        access_routes: [{ action: 'open', url }],
        unresolved_routes: [],
        stop_conditions: [],
      },
    } as never
    expect(() => assertDiscoveryResult(unsafe)).toThrowError(DiscoveryProviderError)
  })
})
