import { describe, expect, it } from 'vitest'
import { discoveryBounds, formatDiscoveryCountSummary } from './resultCounts'
import type { DiscoveryResult } from '../types/discovery'

function boundsResult(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
  return {
    contract_version: 'observatory-discovery-result.v1.0.0',
    retrieval_id: 'retrieval-0123456789abcdef',
    evidence_mode: 'published_offline_evidence',
    corpus: { corpus_id: 'fixture', corpus_version: '1.1.0', record_count: 157, join_route_count: 14 },
    query: {
      question: 'hospital ownership changes in Texas',
      normalized_question: 'hospital ownership changes in texas',
      interpretation: {
        geographies: [],
        subjects: [],
        units_of_analysis: [],
        time_window: null,
        access_intent: { include_restricted: true, public_only: false, accepts_restricted: true, match_basis: 'default' },
      },
      filters: { limit: 10 },
    },
    result_count: 10,
    returned_count: 10,
    total_matches: 24,
    has_more: true,
    results: [],
    join_routes: [],
    warnings: [],
    ...overrides,
  }
}

describe('discovery result bounds', () => {
  it('prefers explicit backend pagination fields', () => {
    expect(discoveryBounds(boundsResult())).toEqual({ returnedCount: 10, totalMatches: 24, hasMore: true })
  })

  it('derives a closed bound from result_count when pagination fields are absent', () => {
    expect(discoveryBounds(boundsResult({ returned_count: undefined, total_matches: undefined, has_more: undefined }))).toEqual({
      returnedCount: 10,
      totalMatches: 10,
      hasMore: false,
    })
  })
})

describe('result count copy', () => {
  it('names the bounded response instead of implying a complete catalog', () => {
    expect(formatDiscoveryCountSummary({
      returnedCount: 50,
      hasMore: true,
      familyCount: 40,
      sourceCount: 18,
      filteredRecordCount: 50,
      filtersActive: false,
      group: 'family',
    })).toEqual([
      '50 returned records',
      'more matches exist',
      '40 families in this response',
      '18 sources in this response',
    ])
  })

  it('distinguishes client-side filters from the backend bound', () => {
    expect(formatDiscoveryCountSummary({
      returnedCount: 50,
      hasMore: true,
      familyCount: 4,
      sourceCount: 3,
      filteredRecordCount: 6,
      filtersActive: true,
      group: 'record',
    })).toEqual([
      '6 of 50 returned records match these filters',
      '3 sources in this response',
    ])
  })
})
