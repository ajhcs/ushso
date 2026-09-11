import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FacetSidebar } from '../components/FacetSidebar'
import { loadAcceptedDiscoveryFixture } from './acceptedDiscoveryFixture'
import { adaptDiscoveryResponse } from '../lib/catalogAdapter'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import {
  buildCanonicalFacetSections,
  buildFacetSections,
  facetOptionLabel,
  normalizeFacetValue,
  normalizeDiscoveryFacetSections,
  matchesFacetFilter,
  matchesLegacyFacetFilter,
} from './facets'

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

  it('keeps canonical mixed known and unknown values truthful and removable', () => {
    const catalog = adaptDiscoveryResponse(acceptedResponse)
    const records = catalog.records.slice(0, 3).map((record, index) => {
      const clone = structuredClone(record)
      clone.canonicalResult.record.geography = index === 2
        ? { ...clone.canonicalResult.record.geography, coverage_level: 'unknown', jurisdictions: [] }
        : { ...clone.canonicalResult.record.geography, coverage_level: 'state', jurisdictions: [index === 0 ? 'US-PA' : 'US-CA'] }
      clone.canonicalResult.record.access.status = index === 0 ? 'public_catalog' : index === 1 ? 'public_direct' : 'unknown'
      return clone
    })

    const sections = buildCanonicalFacetSections(records, records.length)
    const geography = sections.find((section) => section.id === 'geography')
    const access = sections.find((section) => section.id === 'access_status')

    expect(geography?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'unknown', label: 'Include records with unresolved geography (if present)', count: 1 }),
      expect.objectContaining({ value: 'state', count: 2 }),
      expect.objectContaining({ value: 'US-PA', label: 'Pennsylvania', count: 1 }),
    ]))
    expect(geography?.availability).toBe('available')
    expect(access?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'public_catalog', count: 1 }),
      expect.objectContaining({ value: 'unknown', label: 'Include records with unresolved access status (if present)', count: 1 }),
    ]))
    expect(access?.availability).toBe('available')

    const narrowed = buildCanonicalFacetSections([records[0]], 1, ['geography:US-CA', 'geography:unknown'])
    const narrowedGeography = narrowed.find((section) => section.id === 'geography')
    expect(narrowedGeography?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'US-CA', label: 'California' }),
      expect.objectContaining({ value: 'unknown', label: 'Include records with unresolved geography (if present)' }),
    ]))
    expect(narrowedGeography?.options.find((option) => option.value === 'US-CA')?.count).toBeUndefined()
    expect(narrowedGeography?.options.find((option) => option.value === 'unknown')?.count).toBeUndefined()
  })

  it('normalizes API facets without adding a schema field or fabricating an unknown count', () => {
    const records = adaptDiscoveryResponse(acceptedResponse).records.slice(0, 1)
    const sections = normalizeDiscoveryFacetSections([
      { id: 'geography', label: 'Geography', options: [{ value: 'US-PA', label: 'US-PA', count: 1 }] },
      { id: 'access_status', label: 'Access status', options: [{ value: 'public_catalog', label: 'public_catalog', count: 1 }] },
    ], records, 1, ['geography:unknown'])
    const geography = sections.find((section) => section.id === 'geography')
    const unknown = geography?.options.find((option) => option.value === 'unknown')

    expect(unknown?.label).toBe('Include records with unresolved geography (if present)')
    expect(unknown?.count).toBeUndefined()
    expect(geography?.options.find((option) => option.value === 'US-PA')?.label).toBe('Pennsylvania')
    expect(geography?.availability).toBe('unavailable')
    expect(geography?.availabilityReason).toContain('do not narrow')
  })

  it('abstains from a conflicting current-page label when the response supplies a raw ID', () => {
    const catalog = adaptDiscoveryResponse(acceptedResponse)
    const record = structuredClone(catalog.records[0])
    record.canonicalResult.record.identity.source.name = 'Conflicting current-page source label'
    record.canonicalResult.record.capabilities.topics = record.canonicalResult.record.capabilities.topics.map((topic) => (
      topic.id === 'topic:hospital-financials' ? { ...topic, label: 'Conflicting current-page capability label' } : topic
    ))

    expect(facetOptionLabel('source', 'cms-data-catalog', [record], 'cms-data-catalog'))
      .toBe('Centers for Medicare & Medicaid Services Data Catalog')
    expect(facetOptionLabel('capability', 'topic:hospital-financials', [record], 'topic:hospital-financials'))
      .toBe('Hospital financials')
  })

  it('keeps search fallback controls on the five canonical dimensions', () => {
    const records = adaptDiscoveryResponse(acceptedResponse).records
    const sections = buildCanonicalFacetSections(records, records.length)

    expect(sections.map((section) => section.id)).toEqual([
      'source', 'geography', 'access_status', 'unit_of_analysis', 'capability',
    ])
    expect(sections.some((section) => ['years', 'variables-codebook', 'record-type', 'verification'].includes(section.id))).toBe(false)
  })

  it('matches canonical wire IDs exactly while retaining explicit legacy aliases', () => {
    const catalog = adaptDiscoveryResponse(acceptedResponse)
    const record = structuredClone(catalog.records[0].canonicalResult.record)
    record.capabilities.topics = [{ ...record.capabilities.topics[0], id: 'topic:claims', label: 'Claims' }]
    record.capabilities.use_cases = []
    record.unit_of_analysis = ['facility_period']
    record.geography.jurisdictions = ['US-PA']
    record.access.status = 'public_catalog'

    expect(matchesFacetFilter(record, 'capability', 'topic:claims')).toBe(true)
    expect(matchesFacetFilter(record, 'capability', 'topic-claims')).toBe(false)
    expect(matchesFacetFilter(record, 'unit_of_analysis', 'facility_period')).toBe(true)
    expect(matchesFacetFilter(record, 'unit_of_analysis', 'facility-period')).toBe(false)
    expect(matchesFacetFilter(record, 'geography', 'US-PA')).toBe(true)
    expect(matchesFacetFilter(record, 'geography', 'pennsylvania')).toBe(false)
    expect(matchesFacetFilter(record, 'access_status', 'public_catalog')).toBe(true)
    expect(matchesFacetFilter(record, 'access_status', 'catalog-metadata-only')).toBe(false)

    expect(matchesLegacyFacetFilter(record, 'geography', 'pennsylvania')).toBe(true)
    expect(matchesLegacyFacetFilter(record, 'access_status', 'catalog-metadata-only')).toBe(true)
    expect(matchesLegacyFacetFilter(record, 'data-category', 'claims')).toBe(true)
    expect(matchesLegacyFacetFilter(record, 'reporting-unit', 'facility-period')).toBe(true)
  })

  it('uses captured and bounded labels for canonical IDs', () => {
    const records = adaptDiscoveryResponse(acceptedResponse).records
    expect(facetOptionLabel('source', records[0].canonicalResult.record.identity.source.source_id, records)).toBe(records[0].canonicalResult.record.identity.source.name)
    expect(facetOptionLabel('geography', 'US-PA')).toBe('Pennsylvania')
    expect(facetOptionLabel('access_status', 'public_catalog')).toBe('Public catalog metadata; payload access unresolved')
    expect(facetOptionLabel('capability', 'topic:hospital-financials', records)).toBe('Hospital financials')
    expect(facetOptionLabel('capability', 'use-case:unknown')).toBe('Unresolved research concept')
  })
})
