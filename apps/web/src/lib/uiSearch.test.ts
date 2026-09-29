import { describe, expect, it } from 'vitest'
import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import { adaptDiscoveryResponse } from './catalogAdapter'
import { DEMO_SUGGESTIONS, EXAMPLE_QUERY_SET_VERSION, EXAMPLE_RESEARCH_QUESTIONS, filterCatalog, getGroupingDescription, getSuggestions, orderCatalogViews } from './uiSearch'

const acceptedResponse = await loadAcceptedDiscoveryFixture()
assertDiscoveryResult(acceptedResponse)
const catalog = adaptDiscoveryResponse(acceptedResponse)

describe('local UI search helpers', () => {
  it('returns the five strongest suggestions in a stable relevance order', () => {
    const suggestions = getSuggestions('hospital financial Pennsylvania')
    expect(suggestions[0]).toBe('What CMS sources describe hospital ownership in Pennsylvania?')
    expect(suggestions).toHaveLength(5)
    expect(suggestions.every((suggestion) => DEMO_SUGGESTIONS.includes(suggestion))).toBe(true)
    expect(getSuggestions('hospital financial Pennsylvania')).toEqual(suggestions)
  })

  it('publishes a versioned usefulness review pin for every example', () => {
    expect(EXAMPLE_QUERY_SET_VERSION).toBe('example-research-questions.v1.1.0')
    expect(EXAMPLE_RESEARCH_QUESTIONS).toHaveLength(5)
    expect(EXAMPLE_RESEARCH_QUESTIONS.every((example) => example.usefulResultIds.length > 0 && example.rationale.length > 20)).toBe(true)
  })

  it('ranks suggestions by the active concept and tolerates a bounded typo', () => {
    expect(getSuggestions('maternal mortality')[0]).toBe('CDC maternal mortality data')
    expect(getSuggestions('utilzation')[0]).toBe('Public-use hospital utilization data')
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
    expect(orderCatalogViews(reversed, 'canonical_relevance').map((item) => item.canonicalResult.rank)).toEqual(expectedRanks)
  })

  it('never reranks canonical best-match results in the browser', () => {
    const base = catalog.records[0]
    const canonicalFirst = { ...base, id: 'canonical-first', title: 'General annual resource', description: 'Hospital records', variablesCodebook: 'Documentation', categories: [], canonicalResult: { ...base.canonicalResult, rank: 1 } }
    const queryMatch = { ...base, id: 'query-match', title: 'Hospital Utilization Files', description: 'Patient volume data', variablesCodebook: 'Admissions and discharge variables', categories: ['Utilization'], canonicalResult: { ...base.canonicalResult, rank: 2 } }
    expect(orderCatalogViews([queryMatch, canonicalFirst], 'canonical_relevance', 'hopsital utilization')).toEqual([canonicalFirst, queryMatch])
  })
})
