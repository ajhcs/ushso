import type { DatasetFamily, SortMode } from '../types/catalog'

export const DEMO_QUERY = 'hospital financial and utilization data for Pennsylvania'

export const DEMO_SUGGESTIONS = [
  'Pennsylvania hospital financial data',
  'Pennsylvania hospital utilization data',
  'CMS HCRIS cost reports',
  'Pennsylvania hospital discharge data',
  'Medicare provider and hospital datasets',
]

export function getSuggestions(query: string) {
  if (!query.trim()) return []
  return [...DEMO_SUGGESTIONS]
}

export function getGroupingDescription(group: 'family' | 'record') {
  return group === 'family'
    ? 'Results are grouped by family to reduce duplicates.'
    : 'Results are shown as individual records; related records may appear separately.'
}

export function filterCatalog<T extends DatasetFamily>(items: T[], selectedFilters: string[]) {
  if (selectedFilters.length === 0) return items
  const grouped = selectedFilters.reduce<Record<string, string[]>>((acc, filter) => {
    const separator = filter.indexOf(':')
    if (separator === -1) return acc
    const section = filter.slice(0, separator)
    const value = filter.slice(separator + 1)
    acc[section] = [...(acc[section] ?? []), value]
    return acc
  }, {})

  return items.filter((item) =>
    Object.entries(grouped).every(([section, values]) => {
      const itemValues = item.facetValues[section] ?? []
      return values.some((value) => itemValues.includes(value))
    }),
  )
}

// "best" preserves the canonical engine rank. The other modes are explicit user-selected presentation orders.
export function orderCatalogViews<T extends DatasetFamily>(items: T[], sort: SortMode) {
  const copy = [...items]
  if (sort === 'title') return copy.sort((a, b) => a.title.localeCompare(b.title))
  if (sort === 'newest') return copy.sort((a, b) => b.latestVerifiedRelease.localeCompare(a.latestVerifiedRelease))
  return copy.sort((a, b) => a.canonicalResult.rank - b.canonicalResult.rank)
}
