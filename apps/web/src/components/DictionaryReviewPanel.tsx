import { useEffect, useRef, useState } from 'react'

type Field = { name: string; label?: string | null; description?: string | null; unit?: string | null; supplement?: { field_sha256: string; total_bytes: number; fragment_count: number } }
type ReviewPage = { record_id: string; generation: string; review_status: string; publication_authorized: false; variables: Field[]; variable_count: number; next_cursor: string | null; warnings: string[] }

/** Plain-language definition text: null provides no normalized definition; omitted+supplement means summary only. */
export function dictionaryFieldDescription(field: Field): string {
  if (Object.hasOwn(field, 'description')) return field.description ?? 'No normalized definition captured.'
  if (field.supplement) return 'Definition omitted from this summary.'
  return 'No normalized definition captured.'
}

/** Plain-language unit text: null means unknown; omitted+supplement means summary only. */
export function dictionaryFieldUnit(field: Field): string {
  if (Object.hasOwn(field, 'unit')) return field.unit ?? 'Unknown'
  if (field.supplement) return 'Omitted from this summary'
  return 'Unknown'
}

export async function readReviewPage(recordId: string, generation: string | null, cursor: string | null, signal?: AbortSignal): Promise<ReviewPage> {
  const params = new URLSearchParams({ record_id: recordId })
  if (generation) params.set('generation', generation)
  if (cursor) params.set('cursor', cursor)
  const response = await fetch(`/api/research/v1/dictionary-review?${params}`, { signal, headers: { accept: 'application/json' } })
  if (!response.body) throw Error('dictionary_response_unavailable')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 128 * 1024) throw Error('dictionary_response_limit')
      chunks.push(value)
    }
  } finally { await reader.cancel(); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (!response.ok) throw Error(body.error?.code ?? 'dictionary_response_unavailable')
  const page = body.result
  if (!page || page.record_id !== recordId || typeof page.generation !== 'string' || (generation !== null && page.generation !== generation)
    || page.review_status !== 'pending_owner_review' || page.publication_authorized !== false
    || !Array.isArray(page.variables) || !Number.isSafeInteger(page.variable_count) || page.variable_count < page.variables.length
    || (page.next_cursor !== null && typeof page.next_cursor !== 'string') || !Array.isArray(page.warnings) || !page.warnings.every((v: unknown) => typeof v === 'string')
    || !page.variables.every((v: Field) => v && typeof v.name === 'string'
      && ['label', 'description', 'unit'].every(k => v[k as keyof Field] == null || typeof v[k as keyof Field] === 'string')
      && (!v.supplement || (/^[a-f0-9]{64}$/.test(v.supplement.field_sha256) && Number.isSafeInteger(v.supplement.total_bytes) && v.supplement.total_bytes > 0 && Number.isSafeInteger(v.supplement.fragment_count) && v.supplement.fragment_count > 0)))) throw Error('dictionary_response_identity_or_boundary')
  return page
}

export function DictionaryReviewPanel({ recordId }: { recordId: string }) {
  const [page, setPage] = useState<ReviewPage | null>(null)
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [position, setPosition] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])
  async function load(cursor: string | null, target: number, restart = false) {
    active.current?.abort()
    const controller = new AbortController(); active.current = controller
    setPending(true); setError(null)
    try {
      const result = await readReviewPage(recordId, restart ? null : page?.generation ?? null, cursor, controller.signal)
      if (controller.signal.aborted) return
      setPage(result); setPosition(target)
      setCursors(previous => restart ? [null] : [...previous.slice(0, target), cursor])
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'dictionary_unavailable')
    } finally { if (!controller.signal.aborted) setPending(false) }
  }
  return <section className="details-panel dictionary-review" aria-labelledby="dictionary-review-heading">
    <h2 id="dictionary-review-heading">Dictionary proposals — review only</h2>
    <p>Publisher extraction proposals are not approved scientific facts or an established payload schema. Release applicability, observation units and measurement units remain unresolved unless separately approved.</p>
    {!page && <button type="button" disabled={pending} onClick={() => void load(null, 0)}>Inspect dictionary proposals</button>}
    {pending && <p role="status">Loading a bounded dictionary page…</p>}
    {error && <div role="alert"><p>Dictionary review unavailable: {error}. This is not evidence that the publisher lacks a dictionary.</p><button type="button" disabled={pending} onClick={() => void load(null, 0, true)}>Restart dictionary review</button></div>}
    {page && <div aria-busy={pending}>
      <p>Page {position + 1} · {page.variables.length} entries shown · {page.variable_count} packaged entries. Dictionary completeness is unknown.</p>
      <dl className="variable-list">{page.variables.map(field => <div key={field.name}><dt><code>{field.name}</code>{field.label ? ` — ${field.label}` : ''}</dt><dd>
        <p>{dictionaryFieldDescription(field)}</p><p>Measurement unit: {dictionaryFieldUnit(field)}</p>
        {field.supplement && <div><p>Oversized field: {field.supplement.total_bytes.toLocaleString()} bytes in {field.supplement.fragment_count} lossless API fragments. The full field is not rendered or reconstructed here; this summary is incomplete.</p><a href={`/api/research/v1/dictionary-review?${new URLSearchParams({ record_id: recordId, generation: page.generation, field: field.supplement.field_sha256 })}`} target="_blank" rel="noreferrer">Inspect first field fragment and continuation metadata</a><p>Verify the concatenated decoded bytes against SHA-256 <code>{field.supplement.field_sha256}</code> before interpreting the full field.</p></div>}
      </dd></div>)}</dl>
      {page.variables.length === 0 && <p>No ordinary variable entries are packaged for this record.</p>}
      <nav aria-label="Dictionary pages"><button type="button" disabled={pending || position === 0} onClick={() => void load(cursors[position - 1], position - 1)}>Previous dictionary page</button>{' '}<button type="button" disabled={pending || page.next_cursor === null} onClick={() => void load(page.next_cursor, position + 1)}>Next dictionary page</button></nav>
      {page.next_cursor === null && <p>End of packaged entries, not proof of publisher dictionary completeness.</p>}
      <ul>{page.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
    </div>}
  </section>
}
