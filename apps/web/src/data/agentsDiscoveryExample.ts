import type { DiscoveryResult } from '../types/discovery'
import { discoveryBounds } from '../lib/resultCounts'

export interface AgentsDiscoveryExample {
  contract_version: DiscoveryResult['contract_version']
  query: {
    interpretation: {
      geographies: DiscoveryResult['query']['interpretation']['geographies']
      subjects: DiscoveryResult['query']['interpretation']['subjects']
      units_of_analysis: DiscoveryResult['query']['interpretation']['units_of_analysis']
    }
  }
  result_count: number
  returned_count: number
  total_matches: number
  has_more: boolean
  results: Array<{ record_id: string; record: { authoritative_url?: string } }>
  warnings: string[]
}

export function compactDiscoveryExample(result: DiscoveryResult): AgentsDiscoveryExample {
  const bounds = discoveryBounds(result)
  const first = result.results[0]
  return {
    contract_version: result.contract_version,
    query: {
      interpretation: {
        geographies: result.query.interpretation.geographies,
        subjects: result.query.interpretation.subjects,
        units_of_analysis: result.query.interpretation.units_of_analysis,
      },
    },
    result_count: result.result_count,
    returned_count: bounds.returnedCount,
    total_matches: bounds.totalMatches,
    has_more: bounds.hasMore,
    results: first
      ? [{ record_id: first.record_id, record: { authoritative_url: first.record.authoritative_url } }]
      : [],
    warnings: result.warnings.slice(0, 1),
  }
}

export function agentsCurlExample(question: string, limit = 10) {
  return `curl -sS https://ushso.org/api/discover \\
  -H "content-type: application/json" \\
  --data '${JSON.stringify({ question, limit })}'`
}
