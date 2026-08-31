import type { DiscoveryResult } from '../types/discovery'

export function discoveryBounds(result: DiscoveryResult) {
  const returnedCount = result.returned_count ?? result.result_count
  const totalMatches = result.total_matches ?? returnedCount
  const hasMore = result.has_more ?? totalMatches > returnedCount
  return { returnedCount, totalMatches, hasMore }
}

export function formatDiscoveryCountSummary(input: {
  returnedCount: number
  hasMore: boolean
  filteredRecordCount: number
  filtersActive: boolean
}) {
  const recordNoun = input.returnedCount === 1 ? 'returned record' : 'returned records'
  if (input.filtersActive) {
    return [`${input.filteredRecordCount} of ${input.returnedCount} ${recordNoun} match these filters`]
  }
  return input.hasMore
    ? [`${input.returnedCount} ${recordNoun}`, 'more matches exist']
    : [`${input.returnedCount} ${recordNoun}`]
}
