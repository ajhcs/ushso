import type { DiscoveryResult } from '../types/discovery'
import type { GroupMode } from '../types/catalog'

export function discoveryBounds(result: DiscoveryResult) {
  const returnedCount = result.returned_count ?? result.result_count
  const totalMatches = result.total_matches ?? returnedCount
  const hasMore = result.has_more ?? totalMatches > returnedCount
  return { returnedCount, totalMatches, hasMore }
}

export function formatDiscoveryCountSummary(input: {
  returnedCount: number
  hasMore: boolean
  familyCount: number
  sourceCount: number
  filteredRecordCount: number
  filtersActive: boolean
  group: GroupMode
}) {
  const recordNoun = input.returnedCount === 1 ? 'returned record' : 'returned records'
  const parts: string[] = []
  if (input.filtersActive) {
    parts.push(`${input.filteredRecordCount} of ${input.returnedCount} ${recordNoun} match these filters`)
  } else {
    parts.push(`${input.returnedCount} ${recordNoun}`)
    if (input.hasMore) parts.push('more matches exist')
  }
  if (input.group === 'family') {
    parts.push(`${input.familyCount} ${input.familyCount === 1 ? 'family' : 'families'} in this response`)
  }
  parts.push(`${input.sourceCount} ${input.sourceCount === 1 ? 'source' : 'sources'} in this response`)
  return parts
}
