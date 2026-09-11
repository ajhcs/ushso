import type { DatasetFamily, SortMode } from '../types/catalog'

export const DEMO_QUERY = 'hospital financial and utilization data for Pennsylvania'

export const EXAMPLE_QUERY_SET_VERSION = 'example-research-questions.v1.1.0'

export const EXAMPLE_RESEARCH_QUESTIONS = [
  {
    question: 'CMS HCRIS hospital cost reports by state',
    usefulResultIds: ['obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17'],
    rationale: 'Routes directly to the production CMS Hospital Provider Cost Report catalog record and its source documentation.',
  },
  {
    question: 'CDC maternal mortality data',
    usefulResultIds: ['obs:asset:cdc-socrata:e2d5-ggg7-de73391d5d45d504'],
    rationale: 'Leads with the CDC provisional maternal death counts and rates record.',
  },
  {
    question: 'What CMS sources describe hospital ownership in Pennsylvania?',
    usefulResultIds: ['obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-60625-369694b51de508f8'],
    rationale: 'Leads with the CMS Hospital Change of Ownership owner record while labeling Pennsylvania coverage as unknown.',
  },
  {
    question: 'Public-use hospital utilization data',
    usefulResultIds: ['obs:asset:cdc-socrata:tqpr-vcrm-4aa4061557d57dc8'],
    rationale: 'Leads with the CDC National Hospital Ambulatory Medical Care Survey public-use record.',
  },
  {
    question: 'CMS Medicare inpatient hospital utilization',
    usefulResultIds: ['obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-1e1be-2e19bf0aa4756bb2'],
    rationale: 'Leads with CMS Program Statistics for Medicare inpatient hospitals.',
  },
] as const

export const DEMO_SUGGESTIONS = EXAMPLE_RESEARCH_QUESTIONS.map((example) => example.question)

const SEARCH_CONCEPTS: Record<string, string[]> = {
  financial: ['financial', 'finance', 'cost', 'costs', 'hcris', 'revenue', 'expense'],
  utilization: ['utilization', 'utilisation', 'admission', 'admissions', 'discharge', 'discharges', 'volume', 'visits'],
  provider: ['provider', 'providers', 'facility', 'facilities', 'hospital', 'hospitals'],
  geography: ['pennsylvania', 'pa'],
  medicare: ['medicare', 'cms'],
}

function normalizeSearchText(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/ +/g, ' ')
}

function isNearToken(left: string, right: string) {
  if (left === right) return true
  if (left.length < 5 || Math.abs(left.length - right.length) > 1) return false
  if (left.length === right.length) {
    const differences = [...left].map((letter, index) => letter === right[index] ? -1 : index).filter((index) => index >= 0)
    if (differences.length === 1) return true
    return differences.length === 2 && differences[1] === differences[0] + 1
      && left[differences[0]] === right[differences[1]] && left[differences[1]] === right[differences[0]]
  }
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left]
  let shortIndex = 0
  let longIndex = 0
  let skipped = false
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) { shortIndex += 1; longIndex += 1 }
    else if (skipped) return false
    else { skipped = true; longIndex += 1 }
  }
  return true
}

function expandedQueryTokens(query: string) {
  const original = [...new Set(normalizeSearchText(query).split(' ').filter((token) => token.length > 1))]
  const expanded = new Set(original)
  Object.values(SEARCH_CONCEPTS).forEach((terms) => {
    if (original.some((token) => terms.some((term) => isNearToken(token, term)))) terms.forEach((term) => expanded.add(term))
  })
  return { original, expanded: [...expanded] }
}

function suggestionScore(suggestion: string, query: string) {
  const suggestionText = normalizeSearchText(suggestion)
  const suggestionTokens = suggestionText.split(' ')
  const { original, expanded } = expandedQueryTokens(query)
  const originalMatches = original.filter((token) => suggestionTokens.some((candidate) => isNearToken(token, candidate))).length
  const expandedMatches = expanded.filter((token) => suggestionTokens.includes(token)).length
  const phraseBonus = original.length > 1 && suggestionText.includes(original.join(' ')) ? 8 : 0
  return originalMatches * 10 + expandedMatches * 2 + phraseBonus
}

export function getSuggestions(query: string) {
  if (!query.trim()) return []
  return DEMO_SUGGESTIONS
    .map((suggestion, index) => ({ suggestion, index, score: suggestionScore(suggestion, query) }))
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

// Canonical relevance always preserves the server's versioned rank. Alternate
// sorts remain as a compatibility fallback for fixtures without server sorting.
export function orderCatalogViews<T extends DatasetFamily>(items: T[], sort: SortMode, _query = '') {
  const copy = [...items]
  if (sort === 'title_asc') return copy.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
  if (sort === 'release_newest' || sort === 'observation_latest') {
    const value = (item: T) => {
      const dates = item.canonicalResult.metadata?.dates
      const raw = sort === 'release_newest'
        ? dates?.publisher_release_date
        : dates?.observation_period?.end ?? dates?.observation_period?.start ?? item.canonicalResult.record.time_coverage.end ?? item.canonicalResult.record.time_coverage.start
      const timestamp = Date.parse(raw ?? '')
      if (Number.isFinite(timestamp)) return timestamp
      const year = Number(raw?.match(/^\d{4}/)?.[0])
      return Number.isInteger(year) ? Date.UTC(year, 0, 1) : null
    }
    return copy.sort((a, b) => {
      const left = value(a)
      const right = value(b)
      if (left === null) return right === null ? a.canonicalResult.rank - b.canonicalResult.rank : 1
      if (right === null) return -1
      return right - left || a.canonicalResult.rank - b.canonicalResult.rank
    })
  }
  return copy.sort((a, b) => a.canonicalResult.rank - b.canonicalResult.rank)
}
