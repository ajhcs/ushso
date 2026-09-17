import type { DiscoveryResult, DiscoverySearchManifest } from '../types/discovery'

export const SEARCH_RECEIPT_VERSION = 'observatory-search-manifest.v1.0.0' as const
export type SearchReceipt = DiscoverySearchManifest

export interface CreateSearchReceiptOptions {
  displayedIds?: string[]
  createdAt?: string
}

function generationFor(result: DiscoveryResult) {
  return result.pagination?.generation
    ?? `${result.corpus.corpus_id}@${result.corpus.corpus_version}:${result.corpus.manifest_sha256 ?? 'manifest-unavailable'}`
}

/**
 * Creates a durable, self-describing receipt from the exact response rendered
 * by the browser. It never re-runs or re-orders the search.
 */
export function createSearchReceipt(result: DiscoveryResult, options: CreateSearchReceiptOptions = {}): SearchReceipt {
  const responseIds = result.results.map((item) => item.record_id)
  const displayedIds = options.displayedIds ?? result.ranking?.ordered_ids ?? responseIds
  const resultById = new Map(result.results.map((item) => [item.record_id, item]))
  if (new Set(displayedIds).size !== displayedIds.length) throw new TypeError('Displayed search receipt IDs must be unique.')
  if (displayedIds.some((id) => !resultById.has(id))) throw new TypeError('A displayed search receipt ID is not present in the response.')

  const createdAt = options.createdAt ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(createdAt))) throw new TypeError('Search receipt createdAt must be an ISO date-time.')
  const pagination = result.pagination
  const totalMatches = pagination?.total_matches ?? result.total_matches ?? result.results.length

  return {
    manifest_version: SEARCH_RECEIPT_VERSION,
    scope: 'current_page',
    question: result.query.question,
    interpreted_constraints: structuredClone(result.query.interpretation),
    filters: {
      ...structuredClone(result.query.filters),
      traversal: {
        cursor: pagination?.cursor ?? null,
        page_size: pagination?.page_size ?? result.results.length,
        total_matches: totalMatches,
        has_more: pagination?.has_more ?? result.has_more ?? totalMatches > result.results.length,
      },
    },
    sort: result.ranking?.sort ?? 'canonical_relevance',
    displayed_ordered_ids: [...displayedIds],
    ranking_version: result.ranking?.version ?? 'legacy-canonical-ranking',
    catalog_generation: generationFor(result),
    generated_at: createdAt,
    citations: displayedIds.map((id) => {
      const item = resultById.get(id)!
      return {
        record_id: id,
        title: item.record.title,
        source_url: item.record.authoritative_url ?? null,
        evidence_ids: item.record.evidence.map((evidence) => evidence.evidence_id),
      }
    }),
    limitations: [...new Set([
      ...result.warnings,
      'This receipt covers only the currently displayed page.',
      'Catalog metadata and source links are preserved for inspection; the receipt is not a copy of source data or proof of current access.',
    ])],
  }
}

export function serializeSearchReceipt(receipt: SearchReceipt) {
  return `${JSON.stringify(receipt, null, 2)}\n`
}

export function searchReceiptFilename(receipt: SearchReceipt) {
  const date = receipt.generated_at.slice(0, 10)
  const retrieval = receipt.catalog_generation.replace(/[^a-z0-9.-]+/gi, '-').slice(0, 48)
  return `ushso-search-receipt-${date}-${retrieval}.json`
}

export function downloadSearchReceipt(receipt: SearchReceipt) {
  const filename = searchReceiptFilename(receipt)
  const url = URL.createObjectURL(new Blob([serializeSearchReceipt(receipt)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.title = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  announceDownload(filename)
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function announceDownload(filename: string) {
  if (typeof document === 'undefined') return
  let announcer = document.getElementById('ushso-download-announcer')
  if (!announcer) {
    announcer = document.createElement('p')
    announcer.id = 'ushso-download-announcer'
    announcer.className = 'sr-only'
    announcer.setAttribute('aria-live', 'polite')
    document.body.appendChild(announcer)
  }
  announcer.textContent = 'Downloading ' + filename
}

export function downloadJsonPacket(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.title = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  announceDownload(filename)
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}
