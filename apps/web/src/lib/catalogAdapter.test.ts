import { describe, expect, it } from 'vitest'
import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import { adaptDiscoveryResponse, findDatasetInResponse } from './catalogAdapter'
import { buildResearcherGuidance } from './researcherGuidance'

const acceptedResponse = await loadAcceptedDiscoveryFixture()
assertDiscoveryResult(acceptedResponse)

describe('canonical discovery response adapter', () => {
  it('resolves full canonical and shortened UI record IDs to the same exact record', () => {
    const record = adaptDiscoveryResponse(acceptedResponse).records[0]
    expect(findDatasetInResponse(acceptedResponse, record.id)?.canonicalResult.record_id).toBe(record.canonicalResult.record_id)
    expect(findDatasetInResponse(acceptedResponse, record.canonicalResult.record_id)?.canonicalResult.record_id).toBe(record.canonicalResult.record_id)
    expect(findDatasetInResponse(acceptedResponse, `${record.canonicalResult.record_id}-wrong`)).toBeUndefined()
  })
  it('preserves every ranked canonical result and its evidence-bearing fields', () => {
    const adapted = adaptDiscoveryResponse(acceptedResponse)

    expect(adapted.records).toHaveLength(acceptedResponse.results.length)
    acceptedResponse.results.forEach((source) => {
      const view = adapted.records.find((item) => item.canonicalResult.record_id === source.record_id)
      expect(view?.rank).toBe(source.rank)
      expect(view?.canonicalResult).toEqual(source)
      expect(view?.sourceUrl).toBe(source.record.authoritative_url)
      expect(view?.canonicalResult.record.access).toEqual(source.record.access)
      expect(view?.canonicalResult.record.provenance).toEqual(source.record.provenance)
      expect(view?.canonicalResult.record.evidence).toEqual(source.record.evidence)
      expect(view?.canonicalResult.record.retrieval).toEqual(source.record.retrieval)
    })
  })

  it('does not upgrade candidate or incompatible join routes during presentation', () => {
    const adapted = adaptDiscoveryResponse(acceptedResponse)
    expect(adapted.canonicalResponse.join_routes).toEqual(acceptedResponse.join_routes)

    adapted.records.forEach((view) => {
      const expected = acceptedResponse.join_routes.filter((route) => route.from_record_id === view.canonicalResult.record_id || route.to_record_id === view.canonicalResult.record_id)
      expect(view.joinRoutes).toEqual(expected)
    })
  })

  it('derives totals from the returned response rather than release-specific constants', () => {
    const adapted = adaptDiscoveryResponse(acceptedResponse)
    const familyIds = new Set(acceptedResponse.results.map((item) => item.record.identity.family.family_id))
    const sourceIds = new Set(acceptedResponse.results.map((item) => item.record.identity.source.source_id))

    expect(adapted.totals).toEqual({
      families: familyIds.size,
      records: acceptedResponse.results.length,
      sources: sourceIds.size,
    })
  })

  it('exposes scan-card grain and access status without inventing coverage', () => {
    const adapted = adaptDiscoveryResponse(acceptedResponse)
    const first = adapted.records[0]
    expect(first.grain).toBe('Observation grain unresolved')
    expect(first.reportingUnit).toBe('Observation grain unresolved')
    expect(first.canonicalResult.metadata?.dimensions.observation_grain.state ?? 'unresolved').toBe('unresolved')
    expect(first.accessStatusLabel).toBeTruthy()
    expect(first.categories.length).toBeGreaterThan(0)
  })

  it('uses an explicit observation-grain claim and never promotes inferred unit tags', () => {
    const claimed = structuredClone(acceptedResponse)
    const item = claimed.results[0]
    item.metadata = {
      ...item.metadata,
      dimensions: {
        observation_grain: { values: ['hospital_cost_report'], state: 'source_asserted' },
        sampled_entity: { values: [], state: 'unresolved' },
        reporting_organization: { values: [], state: 'unresolved' },
        population_universe: { values: [], state: 'unresolved' },
        geographic_dimensions: { values: [], state: 'unresolved' },
        inferred_search_tags: item.record.unit_of_analysis.map((value) => `unit_of_analysis:${value}`),
      },
    } as typeof item.metadata
    const view = adaptDiscoveryResponse(claimed).records[0]
    expect(view.grain).toBe('Hospital Cost Report')
    expect(view.reportingUnit).toBe('Hospital Cost Report')
    expect(view.canonicalResult.record.unit_of_analysis).not.toEqual(['hospital_cost_report'])
    expect(buildResearcherGuidance(view).useCard.fields.find((field) => field.label === 'Typical unit')).toEqual(expect.objectContaining({
      values: ['Hospital Cost Report'],
      evidenceState: 'source_asserted',
    }))
  })

  it('does not reinterpret public catalog visibility as public payload access', () => {
    const catalogOnly = structuredClone(acceptedResponse)
    catalogOnly.results[0].record.access.status = 'public_catalog'
    catalogOnly.results[0].record.access.mechanisms = ['unknown']
    const first = adaptDiscoveryResponse(catalogOnly).records[0]
    expect(first.accessStatus).toBe('Public catalog metadata; payload access unresolved')
    expect(first.facetValues.access).toEqual(['catalog-metadata-only'])
    expect(buildResearcherGuidance(first).accessPlan.accessClass).toBe('unknown')
  })

  it('builds stable details routes that do not depend on the discovery question', () => {
    const adapted = adaptDiscoveryResponse(acceptedResponse)
    expect(adapted.records.every((record) => !record.detailsUrl.includes('?q='))).toBe(true)
  })

  it('does not silently label national records as Pennsylvania records', () => {
    const adapted = adaptDiscoveryResponse(acceptedResponse)
    const national = adapted.records.find((record) => record.canonicalResult.record.geography.jurisdictions.includes('US'))
    expect(national).toBeDefined()
    expect(national?.facetValues.geography).toContain('national')
    expect(national?.facetValues.geography).not.toContain('pennsylvania')
  })
})
