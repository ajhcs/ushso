import { describe, expect, it } from 'vitest'
import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import { adaptDiscoveryResponse } from './catalogAdapter'

const acceptedResponse = await loadAcceptedDiscoveryFixture()
assertDiscoveryResult(acceptedResponse)

describe('canonical discovery response adapter', () => {
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
})
