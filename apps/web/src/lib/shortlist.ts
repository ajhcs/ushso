export const SHORTLIST_FORMAT = 'ushso.local-shortlist.v1'
export const SHORTLIST_STORAGE_KEY = 'ushso.local-shortlist.v1'
export const LAST_SEEN_GENERATION_KEY = 'ushso.local-shortlist.last-seen-generation.v1'
export const SHORTLIST_CHANGED_EVENT = 'ushso-shortlist-changed'
export const STORAGE_POLICY = 'This shortlist stays in this browser. It stores selected product/context IDs, catalog generation, titles, local paths and optional user notes. Credentials, source payloads, cookies and telemetry are never written here. Private notes are never automatically sent to enrichment, search, workers or any remote endpoint. Clearing the list is explicit and user-controlled. Shortlist success does not mean a source is scientifically suitable.'

export interface ShortlistItem {
  record_id: string
  title: string
  source_name: string
  details_path: string
  generation: string
  added_at: string
  notes: string
}

export interface ShortlistDocument {
  format: typeof SHORTLIST_FORMAT
  storage_policy: string
  items: ShortlistItem[]
}

export interface ShortlistStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function memoryStorage(): ShortlistStorage {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
    removeItem: (key) => { data.delete(key) },
  }
}

let injected: ShortlistStorage | null = null

export function setShortlistStorage(storage: ShortlistStorage | null) {
  injected = storage
}

export function createMemoryShortlistStorage(): ShortlistStorage {
  return memoryStorage()
}

function activeStorage(): ShortlistStorage | null {
  if (injected) return injected
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

function emptyDocument(): ShortlistDocument {
  return { format: SHORTLIST_FORMAT, storage_policy: STORAGE_POLICY, items: [] }
}

function isRecordId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/password|secret|token|authorization/i.test(value)
}

function sanitizeNotes(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.slice(0, 2000)
}

function normalizeItem(raw: unknown): ShortlistItem | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  if (!isRecordId(item.record_id)) return null
  if (typeof item.title !== 'string' || typeof item.details_path !== 'string' || typeof item.generation !== 'string') return null
  if (item.details_path.startsWith('http:') || item.details_path.startsWith('https:')) return null
  if ('payload' in item || 'credential' in item || 'credentials' in item || 'authorization' in item) return null
  return {
    record_id: item.record_id,
    title: item.title,
    source_name: typeof item.source_name === 'string' ? item.source_name : '',
    details_path: item.details_path.startsWith('/datasets/') ? item.details_path : `/datasets/${encodeURIComponent(item.record_id)}`,
    generation: item.generation,
    added_at: typeof item.added_at === 'string' ? item.added_at : new Date(0).toISOString(),
    notes: sanitizeNotes(item.notes),
  }
}

export function loadShortlist(storage = activeStorage()): ShortlistDocument {
  if (!storage) return emptyDocument()
  const raw = storage.getItem(SHORTLIST_STORAGE_KEY)
  if (!raw) return emptyDocument()
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.format !== SHORTLIST_FORMAT || !Array.isArray(parsed.items)) return emptyDocument()
    const items: ShortlistItem[] = []
    const seen = new Set<string>()
    for (const candidate of parsed.items) {
      const item = normalizeItem(candidate)
      if (!item || seen.has(item.record_id)) continue
      seen.add(item.record_id)
      items.push(item)
    }
    return { format: SHORTLIST_FORMAT, storage_policy: STORAGE_POLICY, items }
  } catch {
    return emptyDocument()
  }
}

function persist(document: ShortlistDocument, storage = activeStorage()) {
  if (!storage) return document
  const body = JSON.stringify({ format: SHORTLIST_FORMAT, storage_policy: STORAGE_POLICY, items: document.items })
  if (/password|secret|token|authorization|BEGIN [A-Z ]+PRIVATE KEY/i.test(body)) {
    throw new Error('shortlist_refuses_secrets')
  }
  storage.setItem(SHORTLIST_STORAGE_KEY, body)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SHORTLIST_CHANGED_EVENT))
  return document
}

export function readLastSeenGeneration(storage = activeStorage()): string | null {
  if (!storage) return null
  const value = storage.getItem(LAST_SEEN_GENERATION_KEY)
  return value && value.trim() ? value : null
}

export function rememberLastSeenGeneration(generation: string, storage = activeStorage()) {
  if (!storage || !generation.trim()) return
  storage.setItem(LAST_SEEN_GENERATION_KEY, generation)
}

export function addShortlistItem(input: { record_id: string; title: string; source_name: string; details_path: string; generation: string; notes?: string }, storage = activeStorage()) {
  const document = loadShortlist(storage)
  if (document.items.some((item) => item.record_id === input.record_id)) return document
  const item = normalizeItem({
    ...input,
    added_at: new Date().toISOString(),
    notes: input.notes ?? '',
  })
  if (!item) return document
  return persist({ ...document, items: [...document.items, item] }, storage)
}

export function removeShortlistItem(recordId: string, storage = activeStorage()) {
  const document = loadShortlist(storage)
  return persist({ ...document, items: document.items.filter((item) => item.record_id !== recordId) }, storage)
}

export function clearShortlist(storage = activeStorage()) {
  return persist(emptyDocument(), storage)
}

export function setShortlistNotes(recordId: string, notes: string, storage = activeStorage()) {
  const document = loadShortlist(storage)
  return persist({
    ...document,
    items: document.items.map((item) => item.record_id === recordId ? { ...item, notes: sanitizeNotes(notes) } : item),
  }, storage)
}

export function refreshShortlistGeneration(recordId: string, generation: string, storage = activeStorage()) {
  const document = loadShortlist(storage)
  return persist({
    ...document,
    items: document.items.map((item) => item.record_id === recordId ? { ...item, generation } : item),
  }, storage)
}

export function exportShortlist(storage = activeStorage()) {
  const document = loadShortlist(storage)
  return JSON.stringify({
    format: document.format,
    storage_policy: document.storage_policy,
    exported_at: new Date().toISOString(),
    items: document.items,
    note: 'This export is a local workspace copy. It is not scientific approval, payload access, or a completed research task.',
  }, null, 2)
}

export function isOnShortlist(recordId: string, storage = activeStorage()) {
  return loadShortlist(storage).items.some((item) => item.record_id === recordId)
}

export function shortlistCount(storage = activeStorage()) {
  return loadShortlist(storage).items.length
}

export function itemIsStale(item: ShortlistItem, lastSeenGeneration = readLastSeenGeneration()) {
  return Boolean(lastSeenGeneration && item.generation !== lastSeenGeneration)
}
