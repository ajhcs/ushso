import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FacetSidebar } from '../components/FacetSidebar'
import { loadAcceptedDiscoveryFixture } from './acceptedDiscoveryFixture'
import { adaptDiscoveryResponse } from '../lib/catalogAdapter'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import { buildFacetSections, normalizeFacetValue } from './facets'

const acceptedResponse = await loadAcceptedDiscoveryFixture()
assertDiscoveryResult(acceptedResponse)

describe('backend-derived facets', () => {
  it('surfaces every capability topic supplied by the discovery records', () => {
    const catalog = adaptDiscoveryResponse(acceptedResponse)
    const facets = buildFacetSections(catalog.records)
    const category = facets.find((section) => section.id === 'data-category')
    const expectedTopics = new Map(acceptedResponse.results.flatMap((result) => (
      result.record.capabilities.topics.map((topic) => [normalizeFacetValue(topic.id), topic.label] as const)
    )))

    expect(category?.options).toHaveLength(expectedTopics.size)
    expectedTopics.forEach((label, value) => {
      expect(category?.options).toContainEqual(expect.objectContaining({ value, label }))
    })
    expect(category?.options).toContainEqual(expect.objectContaining({ value: 'claims', label: 'Claims and encounters' }))
    expect(category?.options).toContainEqual(expect.objectContaining({ value: 'opioid-related', label: 'Opioid Related' }))
  })

  it('accepts a new backend facet key and value without a frontend definition', () => {
    const catalog = adaptDiscoveryResponse(acceptedResponse)
    const record = structuredClone(catalog.records[0])
    record.facetValues['curation-state'] = ['editor-approved']

    const section = buildFacetSections([record]).find((candidate) => candidate.id === 'curation-state')

    expect(section).toEqual(expect.objectContaining({
      id: 'curation-state',
      label: 'Curation state',
      options: [{ value: 'editor-approved', label: 'Editor approved', count: 1 }],
    }))
  })

  it('renders real options inside collapsed metadata sections', () => {
    const catalog = adaptDiscoveryResponse(acceptedResponse)
    const sections = buildFacetSections(catalog.records)
    const markup = renderToStaticMarkup(createElement(FacetSidebar, {
      sections,
      selected: [],
      onToggle: () => undefined,
      onClear: () => undefined,
    }))

    expect(markup).toContain('Variables/codebook')
    expect(markup).toContain('Record type')
    expect(markup).toContain('Verification status')
    expect(markup).not.toContain('connected to catalog metadata in a later phase')
  })
})
