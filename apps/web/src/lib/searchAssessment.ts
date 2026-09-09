import type { DatasetRecord } from '../types/catalog'
import type { DiscoveryResult } from '../types/discovery'

export interface SearchAssessment {
  version: 'ushso.search-assessment.v1'
  record_id: string
  question: string
  generation: string
  ranking_version: string
  relevance: 'High' | 'Medium' | 'Low'
  reasons: string[]
}
export function assessmentGeneration(result: DiscoveryResult) {
  return result.pagination?.generation ?? result.corpus.generation ?? result.corpus.manifest_sha256 ?? `${result.corpus.corpus_id}@${result.corpus.corpus_version}`
}
export function createSearchAssessment(result: DiscoveryResult, record: DatasetRecord): SearchAssessment | null {
  if (!result.query.question.trim() || result.query.filters.mode === 'catalog_browse' || !result.ranking?.version || !['High', 'Medium', 'Low'].includes(record.relevance)) return null
  const item = result.results.find(item => item.record_id === record.canonicalResult.record_id)
  if (!item) return null
  return readSearchAssessment({ version: 'ushso.search-assessment.v1', record_id: item.record_id, question: result.query.question, generation: assessmentGeneration(result), ranking_version: result.ranking.version, relevance: record.relevance, reasons: item.relevance.why_relevant }, item.record_id, result.query.question, assessmentGeneration(result))
}
// History state is a local navigation snapshot, never scientific or authorization evidence.
export function readSearchAssessment(value: unknown, recordId: string, question: string, generation: string): SearchAssessment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (v.version !== 'ushso.search-assessment.v1' || v.record_id !== recordId || v.question !== question || v.generation !== generation || typeof v.ranking_version !== 'string' || !v.ranking_version.length || v.ranking_version.length > 200 || typeof v.relevance !== 'string' || !['High', 'Medium', 'Low'].includes(v.relevance) || !Array.isArray(v.reasons) || v.reasons.length > 100 || !v.reasons.every(x => typeof x === 'string' && x.length <= 6000)) return null
  return { version: 'ushso.search-assessment.v1', record_id: recordId, question, generation, ranking_version: v.ranking_version, relevance: v.relevance as SearchAssessment['relevance'], reasons: v.reasons }
}
