import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error The native retrieval helper is intentionally JavaScript-only; this test compares its emitted contract.
import { createRetrievalEngine } from '../../../../packages/retrieval/tools/retrieval-core-v1.2.mjs'
import controlledVocabulary from '../../../../packages/retrieval/fixtures/controlled-vocabulary.json'
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

  it('keeps canonical facet IDs exact when filtering an engine response locally', async () => {
    const record = structuredClone(acceptedResponse.results[0].record)
    record.record_id = 'fixture:canonical:exact'
    record.identity.asset.asset_id = record.record_id
    record.identity.asset.name = record.title = 'Canonical exact filter record'
    record.description = 'Synthetic canonical filter record for provider parity.'
    record.identity.source = { source_id: 'fixture:canonical-source', name: 'Canonical source' }
    record.geography.coverage_level = 'state'
    record.geography.jurisdictions = ['US-PA']
    record.access.status = 'public_catalog'
    record.unit_of_analysis = ['facility_period']
    record.capabilities.topics = [{ ...record.capabilities.topics[0], id: 'topic:claims', label: 'Claims' }]
    record.capabilities.use_cases = []
    const engine = createRetrievalEngine({
      records: [record],
      searchDocuments: null,
      vocabulary: controlledVocabulary,
      joinRoutes: [],
      namedSourceRegistry: { sources: [] },
      corpus: { corpus_id: 'pr006-provider-filter-parity', corpus_version: '1.0.0', record_count: 1, join_route_count: 0, generation: 'pr006-provider-filter-generation' },
      catalogValidation: { valid: [record], invalid: [] },
    })
    const unfiltered = engine.browse({ page_size: 10 })
    const provider = new FixtureDiscoveryProvider(() => unfiltered)

    const exactSource = await provider.browse({ traversal: { filters: ['source:fixture:canonical-source'] } })
    const engineSource = engine.browse({ page_size: 10, facet_filters: { source: ['fixture:canonical-source'] } })
    expect(exactSource.results.map((result: { record_id: string }) => result.record_id)).toEqual(engineSource.results.map((result: { record_id: string }) => result.record_id))
    expect(exactSource.total_matches).toBe(engineSource.total_matches)
    expect(exactSource.facets?.sections.find((section) => section.id === 'source')?.options.find((option) => option.value === 'fixture:canonical-source')?.count).toBe(1)
    const nearSource = await provider.browse({ traversal: { filters: ['source:fixture:canonical-source-near'] } })
    const engineNearSource = engine.browse({ page_size: 10, facet_filters: { source: ['fixture:canonical-source-near'] } })
    expect(nearSource.results.map((result: { record_id: string }) => result.record_id)).toEqual(engineNearSource.results.map((result: { record_id: string }) => result.record_id))
    expect(nearSource.results).toHaveLength(0)

    const exactGeography = await provider.browse({ traversal: { filters: ['geography:US-PA'] } })
    const engineGeography = engine.browse({ page_size: 10, facet_filters: { geography: ['US-PA'] } })
    expect(exactGeography.results.map((result: { record_id: string }) => result.record_id)).toEqual(engineGeography.results.map((result: { record_id: string }) => result.record_id))
    expect(exactGeography.total_matches).toBe(engineGeography.total_matches)
    expect(exactGeography.facets?.sections.find((section) => section.id === 'geography')?.options.find((option) => option.value === 'US-PA')?.count).toBe(1)
    const legacyGeography = await provider.browse({ traversal: { filters: ['geography:pennsylvania'] } })
    expect(legacyGeography.results.map((result: { record_id: string }) => result.record_id)).toEqual(exactGeography.results.map((result: { record_id: string }) => result.record_id))
    const nearGeography = await provider.browse({ traversal: { filters: ['geography:US-PA-near'] } })
    const engineNearGeography = engine.browse({ page_size: 10, facet_filters: { geography: ['US-PA-near'] } })
    expect(nearGeography.results.map((result: { record_id: string }) => result.record_id)).toEqual(engineNearGeography.results.map((result: { record_id: string }) => result.record_id))
    expect(nearGeography.results).toHaveLength(0)

    const exactAccess = await provider.browse({ traversal: { filters: ['access_status:public_catalog'] } })
    const engineAccess = engine.browse({ page_size: 10, facet_filters: { access_status: ['public_catalog'] } })
    expect(exactAccess.results.map((result: { record_id: string }) => result.record_id)).toEqual(engineAccess.results.map((result: { record_id: string }) => result.record_id))
    expect(exactAccess.total_matches).toBe(engineAccess.total_matches)
    expect(exactAccess.facets?.sections.find((section) => section.id === 'access_status')?.options.find((option) => option.value === 'public_catalog')?.count).toBe(1)
    const legacyAccess = await provider.browse({ traversal: { filters: ['access:catalog-metadata-only'] } })
    expect(legacyAccess.results.map((result: { record_id: string }) => result.record_id)).toEqual(exactAccess.results.map((result: { record_id: string }) => result.record_id))
    const nearAccess = await provider.browse({ traversal: { filters: ['access_status:public_catalog-near'] } })
    const engineNearAccess = engine.browse({ page_size: 10, facet_filters: { access_status: ['public_catalog-near'] } })
    expect(nearAccess.results.map((result: { record_id: string }) => result.record_id)).toEqual(engineNearAccess.results.map((result: { record_id: string }) => result.record_id))
    expect(nearAccess.results).toHaveLength(0)

    const exactCapability = await provider.browse({ traversal: { filters: ['capability:topic:claims'] } })
    const engineCapability = engine.browse({ page_size: 10, facet_filters: { capability: ['topic:claims'] } })
    expect(exactCapability.results.map((result: { record_id: string }) => result.record_id)).toEqual(engineCapability.results.map((result: { record_id: string }) => result.record_id))
    expect(exactCapability.total_matches).toBe(engineCapability.total_matches)
    expect(exactCapability.facets?.sections.find((section) => section.id === 'capability')?.options.find((option) => option.value === 'topic:claims')?.count).toBe(1)

    const nearCapability = await provider.browse({ traversal: { filters: ['capability:topic-claims'] } })
    const engineNearCapability = engine.browse({ page_size: 10, facet_filters: { capability: ['topic-claims'] } })
    expect(nearCapability.results.map((result: { record_id: string }) => result.record_id)).toEqual(engineNearCapability.results.map((result: { record_id: string }) => result.record_id))
    expect(nearCapability.results).toHaveLength(0)
    expect(nearCapability.facets?.sections.find((section) => section.id === 'capability')).toBeUndefined()

    const exactUnit = await provider.browse({ traversal: { filters: ['unit_of_analysis:facility_period'] } })
    const engineUnit = engine.browse({ page_size: 10, facet_filters: { unit_of_analysis: ['facility_period'] } })
    expect(exactUnit.results.map((result: { record_id: string }) => result.record_id)).toEqual(engineUnit.results.map((result: { record_id: string }) => result.record_id))
    expect(exactUnit.total_matches).toBe(1)
    expect(exactUnit.facets?.sections.find((section) => section.id === 'unit_of_analysis')?.options.find((option) => option.value === 'facility_period')?.count).toBe(1)

    const nearUnit = await provider.browse({ traversal: { filters: ['unit_of_analysis:facility-period'] } })
    const engineNearUnit = engine.browse({ page_size: 10, facet_filters: { unit_of_analysis: ['facility-period'] } })
    expect(nearUnit.results.map((result: { record_id: string }) => result.record_id)).toEqual(engineNearUnit.results.map((result: { record_id: string }) => result.record_id))
    expect(nearUnit.results).toHaveLength(0)
    expect(nearUnit.facets?.sections.find((section) => section.id === 'unit_of_analysis')).toBeUndefined()
  })


  it('preserves legacy browser section aliases through fixture matching', async () => {
    const record = structuredClone(acceptedResponse.results[0].record)
    const makeRecords = () => ['US-PA', 'US-CA'].map((geography, index) => {
      const next = structuredClone(record)
      next.record_id = 'fixture:legacy-alias:' + index
      next.identity.asset.asset_id = next.record_id
      next.identity.asset.name = next.title = 'Legacy alias record ' + index
      next.description = 'Synthetic legacy alias record for provider parity.'
      next.geography.coverage_level = 'state'
      next.geography.jurisdictions = [geography]
      next.access.status = 'public_catalog'
      next.unit_of_analysis = ['facility_period']
      next.capabilities.topics = [{ ...record.capabilities.topics[0], id: 'topic:claims', label: 'Claims' }]
      next.capabilities.use_cases = []
      return next
    })
    const records = makeRecords()
    const engine = createRetrievalEngine({
      records,
      searchDocuments: null,
      vocabulary: controlledVocabulary,
      joinRoutes: [],
      namedSourceRegistry: { sources: [] },
      corpus: { corpus_id: 'pr006-legacy-alias', corpus_version: '1.0.0', record_count: 2, join_route_count: 0, generation: 'pr006-legacy-alias' },
      catalogValidation: { valid: records, invalid: [] },
    })
    const unfiltered = engine.browse({ page_size: 10 })
    const provider = new FixtureDiscoveryProvider(() => unfiltered)
    for (const filter of ['data-category:topic-claims', 'reporting-unit:facility-period']) {
      const result = await provider.browse({ traversal: { filters: [filter] } })
      expect(result.results.map((item: { record_id: string }) => item.record_id).sort()).toEqual(records.map((item) => item.record_id).sort())
    }
  })

  it('records effective canonical values that replay against the engine', async () => {
    const record = structuredClone(acceptedResponse.results[0].record)
    const records = ['US-PA', 'US-CA'].map((geography, index) => {
      const next = structuredClone(record)
      next.record_id = 'fixture:canonical-replay:' + index
      next.identity.asset.asset_id = next.record_id
      next.identity.asset.name = next.title = 'Canonical replay record ' + index
      next.description = 'Synthetic canonical replay record for provider parity.'
      next.geography.coverage_level = 'state'
      next.geography.jurisdictions = [geography]
      next.access.status = 'public_catalog'
      next.unit_of_analysis = ['facility_period']
      next.capabilities.topics = [{ ...record.capabilities.topics[0], id: 'topic:claims', label: 'Claims' }]
      next.capabilities.use_cases = []
      return next
    })
    const engine = createRetrievalEngine({
      records,
      searchDocuments: null,
      vocabulary: controlledVocabulary,
      joinRoutes: [],
      namedSourceRegistry: { sources: [] },
      corpus: { corpus_id: 'pr006-canonical-replay', corpus_version: '1.0.0', record_count: 2, join_route_count: 0, generation: 'pr006-canonical-replay' },
      catalogValidation: { valid: records, invalid: [] },
    })
    const unfiltered = engine.browse({ page_size: 10 })
    const provider = new FixtureDiscoveryProvider(() => unfiltered)
    const pennsylvania = await provider.browse({ traversal: { filters: ['geography:pennsylvania'] } })
    expect(pennsylvania.results.map((item: { record_id: string }) => item.record_id)).toEqual(['fixture:canonical-replay:0'])
    expect(pennsylvania.query.filters.facet_filters).toEqual({ geography: ['US-PA'] })
    expect(pennsylvania.receipt?.filters).toMatchObject({ facet_filters: { geography: ['US-PA'] } })
    const replayPennsylvania = engine.browse({ page_size: 10, facet_filters: pennsylvania.receipt?.filters.facet_filters as Record<string, string[]> })
    expect(replayPennsylvania.results.map((item: { record_id: string }) => item.record_id)).toEqual(pennsylvania.results.map((item: { record_id: string }) => item.record_id))
    const catalogOnly = await provider.browse({ traversal: { filters: ['access:catalog-metadata-only'] } })
    expect(catalogOnly.results).toHaveLength(2)
    expect(catalogOnly.query.filters.facet_filters).toEqual({ access_status: ['public_catalog'] })
    expect(catalogOnly.receipt?.filters).toMatchObject({ facet_filters: { access_status: ['public_catalog'] } })
    const replayCatalog = engine.browse({ page_size: 10, facet_filters: catalogOnly.receipt?.filters.facet_filters as Record<string, string[]> })
    expect(replayCatalog.results.map((item: { record_id: string }) => item.record_id).sort()).toEqual(catalogOnly.results.map((item: { record_id: string }) => item.record_id).sort())
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
