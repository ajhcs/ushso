import type { LocalShortlist } from './types'
import { parseShortlist, samePin } from './validation'
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  return JSON.stringify(value)
}
export async function selectionBrief(list: LocalShortlist, generatedAt: string, includeQuestion = false) {
  parseShortlist(JSON.stringify(list))
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Invalid export timestamp.')
  const brief = {
    schema_version: 'ushso.selection-brief.v1', pin: list.pin, generated_at: generatedAt,
    question: includeQuestion ? list.question ?? null : null,
    interpretation: null,
    items: list.items.map(item => ({asset_id: item.asset_id, decision: item.decision, note: item.note, source_snapshot: item.snapshot, citations: item.snapshot.citations ? item.snapshot.citations.map(citation=>({...citation,pin:list.pin})) : item.snapshot.evidence_ids.map(evidence_id => ({evidence_id, pin: list.pin,locator_state:'unavailable'}))})),
    unresolved_questions: ['Assess source suitability, access authorization and acquisition steps at the authoritative source.'],
    limitations: ['Catalog metadata does not establish payload access or analytical fitness.', 'Saved and imported snapshots are historical or unverified until matched to a retained rights-valid publication. Citation capture dates do not establish current rights, access or payload availability.'],
  }
  const bytes = new TextEncoder().encode(canonicalJson(brief))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const content_sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return canonicalJson({...brief, content_sha256})
}

/** Integrity only: this does not authenticate imported source facts. */
export async function importBrief(text: string): Promise<LocalShortlist> {
  if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error('Import exceeds 1 MiB.')
  const value = JSON.parse(text)
  if (value?.schema_version !== 'ushso.selection-brief.v1' || typeof value.content_sha256 !== 'string' || !Array.isArray(value.items)) throw new Error('Invalid selection brief schema.')
  const {content_sha256, ...content} = value
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(content)))
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  if (actual !== content_sha256) throw new Error('Brief checksum mismatch. Imported facts were not accepted.')
  for(const item of value.items) {
    if(!Array.isArray(item.citations)||item.citations.some((citation:Record<string,unknown>)=>!citation.pin||!samePin(citation.pin as LocalShortlist['pin'],value.pin)))throw new Error('Imported citation publication mismatch.')
    if(Array.isArray(item.source_snapshot?.citations)) {
      const metadata=item.citations.map(({pin: _pin,...citation}:Record<string,unknown>)=>citation)
      if(canonicalJson(metadata)!==canonicalJson(item.source_snapshot.citations))throw new Error('Imported citation metadata does not match its source snapshot.')
    } else {
      const ids=item.source_snapshot?.evidence_ids
      if(!Array.isArray(ids)||item.citations.length!==ids.length||item.citations.some((citation:Record<string,unknown>,index:number)=>citation.evidence_id!==ids[index]||Object.keys(citation).some(key=>!['evidence_id','pin','locator_state'].includes(key))))throw new Error('Imported evidence citations do not match the legacy snapshot.')
    }
  }
  const list: LocalShortlist = {schema_version:'ushso.shortlist.v1',id:crypto.randomUUID(),created_at:value.generated_at,updated_at:value.generated_at,expires_at:null,storage_consent:null,pin:value.pin,question:value.question ?? undefined,revision:0,items:value.items.map((item: Record<string, unknown>)=>({asset_id:item.asset_id,decision:item.decision,note:item.note,snapshot:item.source_snapshot}))}
  return parseShortlist(JSON.stringify(list))
}
