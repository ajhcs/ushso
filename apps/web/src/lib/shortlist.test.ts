import { describe, expect, it } from 'vitest'
import {
  SHORTLIST_FORMAT,
  STORAGE_POLICY,
  addShortlistItem,
  clearShortlist,
  createMemoryShortlistStorage,
  exportShortlist,
  isOnShortlist,
  itemIsStale,
  loadShortlist,
  rememberLastSeenGeneration,
  removeShortlistItem,
  setShortlistNotes,
  setShortlistStorage,
  refreshShortlistGeneration,
} from './shortlist'

const sample = {
  record_id: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17',
  title: 'Hospital Provider Cost Report',
  source_name: 'CMS',
  details_path: '/datasets/obs%3Aasset%3Acms-data-catalog%3Adata.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17',
  generation: 'live-2026-09-03-85b50522b420',
}

describe('versioned local shortlist', () => {
  it('stores product/context IDs and generation without credentials or payloads', () => {
    const storage = createMemoryShortlistStorage()
    setShortlistStorage(storage)
    addShortlistItem({ ...sample, notes: 'check Worksheet G-3 definitions' })
    addShortlistItem(sample)
    const document = loadShortlist()
    expect(document.format).toBe(SHORTLIST_FORMAT)
    expect(document.storage_policy).toBe(STORAGE_POLICY)
    expect(document.items).toHaveLength(1)
    expect(document.items[0].record_id).toBe(sample.record_id)
    expect(document.items[0].generation).toBe(sample.generation)
    expect(document.items[0].notes).toBe('check Worksheet G-3 definitions')
    const stored = JSON.parse(storage.getItem('ushso.local-shortlist.v1') ?? '{}')
    expect(Object.keys(stored.items[0]).sort()).toEqual(['added_at', 'details_path', 'generation', 'notes', 'record_id', 'source_name', 'title'])
    expect(stored.items[0]).not.toHaveProperty('payload')
    expect(stored.items[0]).not.toHaveProperty('credential')
    expect(stored.items[0]).not.toHaveProperty('authorization')
    expect(JSON.stringify(stored.items)).not.toContain('BEGIN ')
    setShortlistStorage(null)
  })

  it('keeps stale entries in original context until an explicit refresh', () => {
    const storage = createMemoryShortlistStorage()
    setShortlistStorage(storage)
    addShortlistItem(sample)
    rememberLastSeenGeneration('live-2026-09-10-changed')
    const stale = loadShortlist().items[0]
    expect(itemIsStale(stale)).toBe(true)
    expect(stale.generation).toBe(sample.generation)
    refreshShortlistGeneration(sample.record_id, 'live-2026-09-10-changed')
    const refreshed = loadShortlist().items[0]
    expect(refreshed.generation).toBe('live-2026-09-10-changed')
    expect(itemIsStale(refreshed)).toBe(false)
    setShortlistStorage(null)
  })

  it('never automatically sends private notes to enrichment or telemetry', async () => {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
    const source = await readFile(`${repositoryRoot}apps/web/src/lib/shortlist.ts`, 'utf8')
    const workspace = await readFile(`${repositoryRoot}apps/web/src/pages/WorkspacePage.tsx`, 'utf8')
    const card = await readFile(`${repositoryRoot}apps/web/src/components/ResultCard.tsx`, 'utf8')
    expect(source).not.toMatch(/packages\/enrichment|sendBeacon|XMLHttpRequest|fetch\(/)
    expect(workspace).not.toMatch(/packages\/enrichment|sendBeacon|XMLHttpRequest|fetch\(/)
    expect(card).not.toMatch(/packages\/enrichment|sendBeacon|XMLHttpRequest|fetch\(/)
    const storage = createMemoryShortlistStorage()
    setShortlistStorage(storage)
    addShortlistItem({ ...sample, notes: 'do not upload this note' })
    const exported = exportShortlist()
    expect(exported).toContain('do not upload this note')
    expect(exported).toContain('not scientific approval')
    setShortlistNotes(sample.record_id, 'revised local note')
    expect(loadShortlist().items[0].notes).toBe('revised local note')
    removeShortlistItem(sample.record_id)
    expect(isOnShortlist(sample.record_id)).toBe(false)
    addShortlistItem(sample)
    clearShortlist()
    expect(loadShortlist().items).toEqual([])
    setShortlistStorage(null)
  })
})
