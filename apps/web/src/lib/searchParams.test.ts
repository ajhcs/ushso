import { describe, expect, it } from 'vitest'
import { readSearchState, writeSearchState } from './searchParams'

describe('search URL state', () => {
  it('leaves geography interpretation to the canonical discovery response', () => {
    const state = readSearchState(new URLSearchParams('q=test'))
    expect(state.group).toBe('family')
    expect(state.filters).toEqual([])
  })

  it('round-trips explicit ungrouped and cleared-filter state', () => {
    const encoded = writeSearchState({ q: 'hospital data', group: 'record', sort: 'title', page: 3, filters: [] })
    expect(readSearchState(encoded)).toEqual({ q: 'hospital data', group: 'record', sort: 'title', page: 3, filters: [] })
  })
})
