import { useSyncExternalStore } from 'react'
import type { LocalShortlist, PublicationPin, ShortlistItem } from './types'
import { MAX_ITEMS, parseShortlist, samePin, STORAGE_KEY, validSnapshot } from './validation'
interface State { shortlist: LocalShortlist | null; message: string; imported: boolean; conflict: boolean }
let state: State = {shortlist: null, message: 'Memory only. Nothing is saved on this device.', imported: false, conflict: false}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())
function storage() { return window.localStorage }
function update(list: LocalShortlist | null) {
  if (state.conflict) throw new Error('Another tab changed this shortlist. Export your work or reload before saving.')
  if (list?.expires_at && Date.parse(list.expires_at) <= Date.now()) { clearShortlist(); throw new Error('Shortlist expired and was cleared.') }
  state = {...state, shortlist: list}
  if (list?.storage_consent) {
    try {
      const previous = storage().getItem(STORAGE_KEY)
      if (previous && state.shortlist && JSON.parse(previous).revision > list.revision - 1) throw new Error('revision_conflict')
      storage().setItem(STORAGE_KEY, JSON.stringify(list))
      state = {...state, message: 'Saved on this device. Expired entries are deleted on next opening.'}
    } catch (error) {
      if (error instanceof Error && error.message === 'revision_conflict') state = {...state, conflict: true, message: 'Another tab changed this shortlist. Export your work or reload to choose the saved revision.'}
      else state = {...state, shortlist: {...list, storage_consent: null, expires_at: null}, message: 'Device storage unavailable. Your shortlist remains in memory and is unsaved.'}
    }
  }
  emit()
}
function revise(list: LocalShortlist): LocalShortlist { return {...list, revision: list.revision + 1, updated_at: new Date().toISOString()} }
export function addSource(item: ShortlistItem, pin: PublicationPin) {
  if (!validSnapshot(item.snapshot, pin)) throw new Error('Accepted source snapshot is unavailable or invalid.')
  const current = state.shortlist
  if (current && !samePin(current.pin, pin)) throw new Error('This source belongs to another publication. Keep the historical shortlist or clear it before starting a new one.')
  if (current?.items.some(value => value.asset_id === item.asset_id)) return
  if ((current?.items.length ?? 0) >= MAX_ITEMS) throw new Error('The shortlist limit is 50 sources.')
  const now = new Date().toISOString()
  update(current ? revise({...current, items: [...current.items, item]}) : {schema_version: STORAGE_KEY, id: crypto.randomUUID(), created_at: now, updated_at: now, expires_at: null, storage_consent: null, pin, items: [item], revision: 0})
}
export function editItem(assetId: string, change: Partial<Pick<ShortlistItem, 'decision' | 'note'>>) {
  if (!state.shortlist) return
  if ((change.note?.length ?? 0) > 2000) throw new Error('Notes are limited to 2,000 characters.')
  update(revise({...state.shortlist, items: state.shortlist.items.map(item => item.asset_id === assetId ? {...item, ...change} : item)}))
}
export function removeSource(assetId: string) { if (state.shortlist) update(revise({...state.shortlist, items: state.shortlist.items.filter(item => item.asset_id !== assetId)})) }
export function saveOnDevice(includeQuestion: boolean, question: string) {
  if (!state.shortlist) return
  if (question.length > 2000) throw new Error('Question exceeds 2,000 characters.')
  const now = new Date()
  const list = {...state.shortlist, storage_consent: {granted_at: now.toISOString(), version: '1' as const}, expires_at: new Date(now.getTime() + 30 * 86400000).toISOString()}
  delete list.question
  if (includeQuestion) list.question = question
  update(revise(list))
}
export function clearShortlist() {
  let deviceCleared = false
  try { storage().removeItem(STORAGE_KEY); deviceCleared = true } catch { /* Memory clearing still succeeds; prior saved bytes may remain. */ }
  state = {shortlist: null, message: deviceCleared ? 'Shortlist cleared from memory and this device.' : 'Shortlist cleared from memory. Device storage removal could not be confirmed; use your browser settings to clear saved site data.', imported: false, conflict: false}; emit()
}
export function importShortlist(text: string) {
  const list = parseShortlist(text)
  // Import never grants device storage consent or promotes facts to accepted evidence.
  state = {shortlist: {...list, storage_consent: null, expires_at: null}, imported: true, conflict: false, message: 'Imported snapshots are unverified. Memory only; no facts were accepted into the catalog.'}; emit()
}
let opened = false
export function openShortlist() {
  if (opened) return
  opened = true
  try {
    const text = storage().getItem(STORAGE_KEY)
    if (text) { const list = parseShortlist(text); state = {...state, shortlist: list, imported: true, message: 'Saved device snapshots are unverified until matched to a retained rights-valid publication.'} }
  } catch { try { storage().removeItem(STORAGE_KEY) } catch { /* Unavailable storage. */ } state = {...state, message: 'Expired or invalid device shortlist was cleared; storage may be unavailable.'} }
  window.addEventListener('storage', event => { if (event.key === STORAGE_KEY && state.shortlist) { state = {...state, conflict: true, message: 'Another tab changed this shortlist. Export your work or reload to choose the saved revision.'}; emit() } })
  emit()
}
export function useShortlist() { return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => state, () => state) }
