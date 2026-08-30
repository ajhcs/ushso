import type { DatasetFamily, SortMode } from '../types/catalog'

const SUGGESTION_CATALOG = [
  'Hospital financial and utilization data in California',
  'CMS HCRIS hospital cost reports by state',
  'Hospital ownership changes and enrollments in Texas',
  'Rural hospital classifications and closures in Kansas',
  'Hospital quality and workforce data in New York',
  'Medicare provider enrollment data by state',
  'Hospital capacity and service availability in Florida',
  'Pennsylvania hospital discharge and utilization data',
  'HRSA workforce shortage areas by state',
  'Census geography crosswalks for hospital service areas',
]

export function getSuggestions(query: string) {
  const tokens = [...new Set(query.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 2) ?? [])]
  if (!tokens.length) return []
  return SUGGESTION_CATALOG
    .map((suggestion, index) => ({ suggestion, index, score: tokens.filter((token) => suggestion.toLowerCase().includes(token)).length }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 5)
    .map(({ suggestion }) => suggestion)
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
