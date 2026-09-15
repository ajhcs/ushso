import { CITATION_FORMAT, buildSourceCitation, formatPlainTextCitation, type SourceCitation, type SourceCitationInput } from './citations'
import type { ShortlistItem } from './shortlist'

export const RESEARCH_EXPORT_FORMAT = 'ushso.research-evidence-packet.v1'
export const LAST_GOOD_GENERATION_ID = 'live-2026-09-03-85b50522b420'

const SECRET_KEYS = new Set(['authorization', 'cookie', 'password', 'api_key', 'api_key_value', 'token', 'access_token', 'signed_url', 'presigned_url', 'credential', 'credentials'])

export interface ResearchExportOptions {
  include_question?: boolean
  include_notes?: boolean
  question?: string | null
  accessed_at?: string
}

export interface ResearchExportPacket {
  format: typeof RESEARCH_EXPORT_FORMAT
  generation: string
  last_good_generation: string
  generation_state: 'current' | 'retired'
  source_order: string[]
  sources: Array<{
    asset_id: string
    title: string
    publisher: string
    locator: string
    generation: string
    citation: SourceCitation
    notes: string | null
  }>
  contexts: Array<{ record_id: string; details_path: string; generation: string }>
  fields: string[]
  recipes: Array<{ asset_id: string; documented: boolean; secrets: null }>
  limitations: string[]
  receipts: string[]
  question: string | null
  credentials: null
  llm_invoked: false
  source_data_fetched: false
  hidden_research_query_telemetry: false
  ushso_verification_separate: true
}

function containsSecrets(value: unknown): boolean {
  if (value == null || value === false) return false
  if (typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsSecrets)
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item == null || item === false) continue
    if (SECRET_KEYS.has(key) || SECRET_KEYS.has(key.toLowerCase())) return true
    if (containsSecrets(item)) return true
  }
  return false
}

export function citationInputFromShortlist(item: ShortlistItem, accessedAt: string): SourceCitationInput {
  return {
    record_id: item.record_id,
    title: item.title,
    publisher: item.source_name || null,
    product: item.title,
    locator: item.details_path.startsWith('/datasets/') ? `https://ushso.org${item.details_path}` : item.details_path,
    observed_at: item.added_at,
    accessed_at: accessedAt,
    ushso_generation: item.generation,
  }
}

export function buildResearchExport(items: ShortlistItem[], options: ResearchExportOptions = {}): ResearchExportPacket {
  const accessedAt = options.accessed_at ?? new Date().toISOString()
  const includeNotes = options.include_notes === true
  const includeQuestion = options.include_question === true
  const sources = items.map((item) => {
    const citation = buildSourceCitation(citationInputFromShortlist(item, accessedAt))
    return {
      asset_id: item.record_id,
      title: item.title,
      publisher: citation.publisher,
      locator: citation.locator,
      generation: item.generation,
      citation,
      notes: includeNotes ? item.notes : null,
    }
  })
  const generations = [...new Set(items.map((item) => item.generation))]
  const generation = generations[0] ?? LAST_GOOD_GENERATION_ID
  const generationState = generation === LAST_GOOD_GENERATION_ID ? 'current' : 'retired'
  const packet: ResearchExportPacket = {
    format: RESEARCH_EXPORT_FORMAT,
    generation,
    last_good_generation: LAST_GOOD_GENERATION_ID,
    generation_state: generationState,
    source_order: items.map((item) => item.record_id),
    sources,
    contexts: items.map((item) => ({ record_id: item.record_id, details_path: item.details_path, generation: item.generation })),
    fields: ['title', 'publisher', 'locator', 'generation', 'citation'],
    recipes: items.map((item) => ({ asset_id: item.record_id, documented: true, secrets: null })),
    limitations: [
      'This packet contains catalog metadata and citations, not source payloads.',
      'USHSO verification is identified separately from the publisher product.',
      'Credentials, cookies, signed URLs and telemetry are excluded.',
      generationState === 'retired' ? `Generation ${generation} is retired relative to last-good ${LAST_GOOD_GENERATION_ID}. Reproducing this selection must not silently re-run a different search.` : `Generation ${generation} matches last-good ${LAST_GOOD_GENERATION_ID}.`,
      includeQuestion ? 'The originating question was included by explicit user choice.' : 'The originating question was omitted by default.',
      includeNotes ? 'Private notes were included by explicit user choice.' : 'Private notes were omitted by default.',
    ],
    receipts: ['local-shortlist'],
    question: includeQuestion ? (options.question ?? null) : null,
    credentials: null,
    llm_invoked: false,
    source_data_fetched: false,
    hidden_research_query_telemetry: false,
    ushso_verification_separate: true,
  }
  if (containsSecrets(packet)) throw new Error('PACKET_CONTAINS_SECRETS')
  return packet
}

export function validateResearchExport(packet: ResearchExportPacket) {
  if (packet.format !== RESEARCH_EXPORT_FORMAT) throw new Error('PACKET_FORMAT_INVALID')
  if (packet.credentials != null) throw new Error('PACKET_HAS_CREDENTIALS')
  if (packet.llm_invoked !== false) throw new Error('PACKET_LLM_INVOKED')
  if (packet.source_data_fetched !== false) throw new Error('PACKET_SOURCE_FETCHED')
  if (packet.hidden_research_query_telemetry !== false) throw new Error('PACKET_HIDDEN_TELEMETRY')
  if (containsSecrets(packet)) throw new Error('PACKET_CONTAINS_SECRETS')
  if (packet.source_order.join('|') !== packet.sources.map((source) => source.asset_id).join('|')) throw new Error('PACKET_ORDER_MISMATCH')
  return { valid: true as const, generation: packet.generation, generation_state: packet.generation_state, source_count: packet.sources.length }
}

export function summarizeResearchExport(packet: ResearchExportPacket) {
  return [
    `USHSO research packet (${packet.format})`,
    `Generation: ${packet.generation} (${packet.generation_state})`,
    `Sources in saved order: ${packet.source_order.length}`,
    ...packet.sources.map((source, index) => `${index + 1}. ${source.title} — ${source.asset_id}`),
    packet.question ? 'Question included by explicit choice.' : 'Question omitted by default.',
    packet.sources.some((source) => source.notes) ? 'Private notes included by explicit choice.' : 'Private notes omitted by default.',
    'USHSO verification is separate from the publisher product. This is not scientific approval or a completed research task.',
  ].join('\n')
}

export function parseImportedPacket(raw: string) {
  const packet = JSON.parse(raw) as ResearchExportPacket
  const validated = validateResearchExport(packet)
  return {
    ...validated,
    packet,
    retired: packet.generation_state === 'retired',
    silent_search_rerun: false,
    readable_summary: summarizeResearchExport(packet),
  }
}

export function citationBundle(items: ShortlistItem[], accessedAt?: string) {
  const citations = items.map((item) => buildSourceCitation(citationInputFromShortlist(item, accessedAt ?? new Date().toISOString())))
  return {
    format: CITATION_FORMAT,
    citations,
    plain_text: citations.map(formatPlainTextCitation),
  }
}
