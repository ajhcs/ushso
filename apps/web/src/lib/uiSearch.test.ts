import { describe, expect, it } from 'vitest'
import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import { adaptDiscoveryResponse } from './catalogAdapter'
import { DEMO_SUGGESTIONS, filterCatalog, getGroupingDescription, getSuggestions, orderCatalogViews } from './uiSearch'

const acceptedResponse = await loadAcceptedDiscoveryFixture()
assertDiscoveryResult(acceptedResponse)
const catalog = adaptDiscoveryResponse(acceptedResponse)

describe('local UI search helpers', () => {
  it('returns the deterministic demo suggestions in the approved order', () => {
    expect(getSuggestions('hospital financial Pennsylvania')).toEqual(DEMO_SUGGESTIONS)
  })

  it('describes the active grouping mode accurately', () => {
    expect(getGroupingDescription('family')).toContain('grouped by family')
    expect(getGroupingDescription('record')).toContain('individual records')
  })

  it('filters only over facet values present on returned records', () => {
    const record = catalog.records.find((item) => Object.values(item.facetValues).some((values) => values.length > 0))
    expect(record).toBeDefined()
    const facet = Object.entries(record!.facetValues).find(([, values]) => values.length > 0)!
    const filter = `${facet[0]}:${facet[1][0]}`
    const matches = filterCatalog(catalog.records, [filter])
    expect(matches).toContainEqual(record)
  })

  it('preserves canonical engine rank for best-match order', () => {
    const reversed = [...catalog.records].reverse()
    const expectedRanks = catalog.records.map((item) => item.canonicalResult.rank).sort((a, b) => a - b)
    expect(orderCatalogViews(reversed, 'best').map((item) => item.canonicalResult.rank)).toEqual(expectedRanks)
  })
})
