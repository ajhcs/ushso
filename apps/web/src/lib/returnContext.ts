export const RETURN_CONTEXT_VERSION = 'ushso-return-context.v1' as const

export interface SearchReturnContext {
  version: typeof RETURN_CONTEXT_VERSION
  path: '/search'
  search: string
  selected_record_id: string
  scroll_y: number
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError('Invalid return context encoding.')
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
}

export function createSearchReturnContext(
  location: { pathname: string; search: string },
  selectedRecordId: string,
  scrollY = 0,
): SearchReturnContext {
  if (location.pathname !== '/search') throw new TypeError('Dataset return context must originate from the search route.')
  if (!selectedRecordId.trim()) throw new TypeError('Dataset return context requires a selected record.')
  return {
    version: RETURN_CONTEXT_VERSION,
    path: '/search',
    search: location.search.startsWith('?') || location.search === '' ? location.search : `?${location.search}`,
    selected_record_id: selectedRecordId,
    scroll_y: Number.isFinite(scrollY) && scrollY >= 0 ? Math.floor(scrollY) : 0,
  }
}

export function serializeReturnContext(context: SearchReturnContext) {
  return toBase64Url(JSON.stringify(context))
}

export function parseReturnContext(value: string | null | undefined): SearchReturnContext | null {
  if (!value || value.length > 8192) return null
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(value))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const candidate = parsed as Record<string, unknown>
    if (candidate.version !== RETURN_CONTEXT_VERSION || candidate.path !== '/search') return null
    if (typeof candidate.search !== 'string' || (candidate.search !== '' && !candidate.search.startsWith('?'))) return null
    if (typeof candidate.selected_record_id !== 'string' || !candidate.selected_record_id.trim()) return null
    if (typeof candidate.scroll_y !== 'number' || !Number.isSafeInteger(candidate.scroll_y) || candidate.scroll_y < 0) return null
    const destination = new URL(`/search${candidate.search}`, 'https://ushso.invalid')
    if (destination.origin !== 'https://ushso.invalid' || destination.pathname !== '/search') return null
    return candidate as unknown as SearchReturnContext
  } catch {
    return null
  }
}

export function safeReturnDestination(value: string | null | undefined, fallback = '/search') {
  const context = parseReturnContext(value)
  return context ? `${context.path}${context.search}` : fallback
}

export function datasetDetailsHref(recordId: string, context?: SearchReturnContext | null) {
  const path = `/datasets/${encodeURIComponent(recordId)}`
  if (!context) return path
  return `${path}?return=${encodeURIComponent(serializeReturnContext(context))}`
}

export function resultAnchorId(recordId: string) {
  return `search-result-${recordId.replace(/[^a-zA-Z0-9_-]+/g, '-')}`
}

export interface BriefOriginContext {
  profileId: string
  question: string | null
}

export function briefOriginContext(returnParam: string | null | undefined): BriefOriginContext | null {
  const context = parseReturnContext(returnParam)
  if (!context || !context.selected_record_id.startsWith('navigator-')) return null
  const profileId = context.selected_record_id.slice('navigator-'.length)
  if (!profileId) return null
  return { profileId, question: new URLSearchParams(context.search).get('q') }
}
