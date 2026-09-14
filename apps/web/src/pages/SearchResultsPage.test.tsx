import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import { adaptDiscoveryResponse } from '../lib/catalogAdapter'
import { createSearchReceipt } from '../lib/searchReceipt'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import type { DatasetRecord } from '../types/catalog'
import type { DiscoveryResult, DiscoverySort } from '../types/discovery'
import { buildSearchFacetSections, displayedRecordIds, OrderedResultCards, SearchIdentityNote } from './SearchResultsPage'

function renderedCardsMarkup(records: DatasetRecord[]) {
  return renderToStaticMarkup(createElement(
    MemoryRouter,
    {},
    createElement(OrderedResultCards, {
      records,
      detailsHref: (record: DatasetRecord) => record.detailsUrl,
    }),
  ))
}

function renderedCanonicalIds(records: DatasetRecord[]) {
  const markup = renderedCardsMarkup(records)
  const renderedViewIds = [...markup.matchAll(/data-result-id="([^"]+)"/g)].map((match) => match[1])
  const canonicalByViewId = new Map(records.map((record) => [record.id, record.canonicalResult.record_id]))
  return renderedViewIds.map((id) => canonicalByViewId.get(id))
}

function responseInOrder(source: DiscoveryResult, records: DatasetRecord[], sort: DiscoverySort): DiscoveryResult {
  const results = records.map((record, index) => ({ ...record.canonicalResult, rank: index + 1 }))
  const ids = results.map((result) => result.record_id)
  return {
    ...structuredClone(source),
    results,
    result_count: results.length,
    returned_count: results.length,
    ranking: { ...(source.ranking ?? { version: 'test-ranking' }), sort, ordered_ids: ids },
    ...(source.pagination ? { pagination: { ...source.pagination, page_size: results.length } } : {}),
    sections: {
      supported: results.filter((result) => !result.match_state || result.match_state === 'supported').map((result) => result.record_id),
      uncertain: results.filter((result) => result.match_state === 'uncertain').map((result) => result.record_id),
      contextual: results.filter((result) => result.match_state === 'contextual').map((result) => result.record_id),
    },
  }
}

describe('search result display and receipt ordering', () => {
  it('keeps selected live controls through a narrowed response and uses no fabricated unknown count', async () => {
    const source = await loadAcceptedDiscoveryFixture()
    assertDiscoveryResult(source)
    const records = adaptDiscoveryResponse(source).records.slice(0, 1)
    const response = structuredClone(source)
    response.facets = {
      count_basis: 'records',
      collection_scope: 'all_matching_records_before_pagination',
      approximate: false,
      sections: [{
        id: 'geography',
        label: 'Geography',
        options: [{ value: 'US-PA', label: 'US-PA', count: 1 }],
      }],
    }
    response.total_matches = 1
    const geography = buildSearchFacetSections(response, records, ['geography:unknown'])
      .find((section) => section.id === 'geography')
    const unknown = geography?.options.find((option) => option.value === 'unknown')

    expect(unknown?.label).toBe('Include records with unresolved geography (if present)')
    expect(unknown?.count).toBeUndefined()
    expect(geography?.options.find((option) => option.value === 'US-PA')?.label).toBe('Pennsylvania')
    expect(geography?.options.find((option) => option.value === 'unknown')).toBeDefined()
  })

  it('displays the response ranking version and catalog pin without inventing a missing version', async () => {
    const response = await loadAcceptedDiscoveryFixture()
    assertDiscoveryResult(response)
    const pinned = { ...response, corpus: { ...response.corpus, generation: 'exact-generation-test' }, pagination: undefined,
      ranking: { version: 'exact-ranking-test', sort: 'title_asc' as const, ordered_ids: [] } }
    const markup = renderToStaticMarkup(createElement(SearchIdentityNote, { result: pinned }))
    expect(markup).toContain('exact-generation-test')
    expect(markup).toContain('Ranking version: exact-ranking-test')
    const missing = renderToStaticMarkup(createElement(SearchIdentityNote, { result: { ...pinned, ranking: undefined } }))
    expect(missing).toContain('not reported by this response')
    expect(missing).not.toContain('exact-ranking-test')
  })
  it('preserves the exact API sequence across relevance, alphabetical, and chronological sorts', async () => {
    const source = await loadAcceptedDiscoveryFixture()
    assertDiscoveryResult(source)
    const records = adaptDiscoveryResponse(source).records.slice(0, 6)
    const cases: Array<[DiscoverySort, DatasetRecord[]]> = [
      ['canonical_relevance', records],
      ['title_asc', [...records].sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id))],
      ['release_newest', [...records].reverse()],
      ['observation_latest', [...records.slice(2), ...records.slice(0, 2)]],
    ]

    for (const [sort, orderedRecords] of cases) {
      const expectedIds = displayedRecordIds(orderedRecords)
      const response = responseInOrder(source, orderedRecords, sort)
      const receipt = createSearchReceipt(response, { displayedIds: expectedIds, createdAt: '2026-09-06T12:00:00.000Z' })

      expect(renderedCanonicalIds(orderedRecords), sort).toEqual(expectedIds)
      expect(receipt.sort, sort).toBe(sort)
      expect(receipt.displayed_ordered_ids, sort).toEqual(expectedIds)
      expect(receipt.citations.map((citation) => citation.record_id), sort).toEqual(expectedIds)
    }
  })

  it('does not promote a supported maternal-mortality result above earlier contextual or uncertain cards', async () => {
    const source = await loadAcceptedDiscoveryFixture()
    assertDiscoveryResult(source)
    const records = adaptDiscoveryResponse(source).records.slice(0, 3)
    records[0].canonicalResult.match_state = 'contextual'
    records[1].canonicalResult.match_state = 'uncertain'
    records[2].canonicalResult.match_state = 'supported'
    records[2].title = 'VSRR Provisional Maternal Death Counts and Rates'
    records[2].canonicalResult.record.title = records[2].title
    const expectedIds = displayedRecordIds(records)
    const response = responseInOrder(source, records, 'title_asc')
    response.query.question = 'maternal mortality'
    const receipt = createSearchReceipt(response, { displayedIds: expectedIds, createdAt: '2026-09-06T12:00:00.000Z' })
    const markup = renderedCardsMarkup(records)

    expect(renderedCanonicalIds(records)).toEqual(expectedIds)
    expect(renderedCanonicalIds(records).at(-1)).toBe(records[2].canonicalResult.record_id)
    expect(markup.indexOf('Broader context')).toBeLessThan(markup.indexOf('Uncertain match'))
    expect(markup.indexOf('Uncertain match')).toBeLessThan(markup.indexOf('Documented match'))
    expect(receipt.displayed_ordered_ids).toEqual(expectedIds)
  })
})
