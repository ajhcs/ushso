import type { DatasetFamily, SortMode } from '../types/catalog'

export const DEMO_QUERY = 'hospital financial and utilization data for Pennsylvania'

export const DEMO_SUGGESTIONS = [
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

// "best" preserves the canonical engine rank. The other modes are explicit user-selected presentation orders.
function catalogQueryScore(item: DatasetFamily, query: string) {
  const { original, expanded } = expandedQueryTokens(query)
  const fields = [
    { weight: 12, text: item.title },
    { weight: 8, text: item.categories.join(' ') },
    { weight: 6, text: item.variablesCodebook },
    { weight: 4, text: item.description },
    { weight: 3, text: `${item.recordType} ${item.reportingUnit} ${item.sourceName}` },
  ]
  let score = 0
  const matchedOriginal = new Set<string>()
  fields.forEach(({ weight, text }) => {
    const tokens = normalizeSearchText(text).split(' ')
    original.forEach((token) => {
      if (!matchedOriginal.has(token) && tokens.some((candidate) => isNearToken(token, candidate))) {
        matchedOriginal.add(token)
        score += weight
      }
    })
    score += Math.min(3, expanded.filter((token) => tokens.includes(token)).length)
  })
  if (original.length > 1 && normalizeSearchText(item.title).includes(original.join(' '))) score += 18
  score += Math.round(8 * matchedOriginal.size / Math.max(1, original.length))
  return score
}

export function orderCatalogViews<T extends DatasetFamily>(items: T[], sort: SortMode, query = '') {
  const copy = [...items]
  if (sort === 'title') return copy.sort((a, b) => a.title.localeCompare(b.title))
  if (sort === 'newest') return copy.sort((a, b) => b.latestVerifiedRelease.localeCompare(a.latestVerifiedRelease))
  if (query.trim()) return copy.sort((a, b) => catalogQueryScore(b, query) - catalogQueryScore(a, query)
    || a.canonicalResult.rank - b.canonicalResult.rank
    || a.id.localeCompare(b.id))
  return copy.sort((a, b) => a.canonicalResult.rank - b.canonicalResult.rank)
}
