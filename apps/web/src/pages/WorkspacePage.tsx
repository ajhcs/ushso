import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { PageTitle } from '../components/PageTitle'
import {
  STORAGE_POLICY,
  SHORTLIST_CHANGED_EVENT,
  clearShortlist,
  exportShortlist,
  itemIsStale,
  loadShortlist,
  readLastSeenGeneration,
  refreshShortlistGeneration,
  removeShortlistItem,
  setShortlistNotes,
  type ShortlistItem,
} from '../lib/shortlist'

function downloadExport() {
  const blob = new Blob([exportShortlist()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'ushso-local-shortlist.json'
  link.click()
  URL.revokeObjectURL(url)
}

export function WorkspacePage() {
  const [items, setItems] = useState<ShortlistItem[]>(() => loadShortlist().items)
  const lastSeen = readLastSeenGeneration()
  const staleCount = useMemo(() => items.filter((item) => itemIsStale(item, lastSeen)).length, [items, lastSeen])

  useEffect(() => {
    const refresh = () => setItems(loadShortlist().items)
    window.addEventListener(SHORTLIST_CHANGED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(SHORTLIST_CHANGED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  return (
    <div className="standard-page workspace-page">
      <PageTitle label="Local shortlist" />
      <ObservatoryHeader compact />
      <main id="main-content" className="standard-page__main">
        <p className="section-eyebrow">Local workspace</p>
        <h1>Keep selected sources in this browser</h1>
        <p>{STORAGE_POLICY}</p>
        <p className="workspace-count" role="status" aria-live="polite">{items.length} saved source{items.length === 1 ? '' : 's'}{staleCount > 0 ? ` · ${staleCount} need an explicit generation refresh` : ''}. Shortlist success is not scientific suitability.</p>
        <p>Supported comparison and local export remain available while the planner is disabled. Opening compare or exporting this list does not compile a research plan.</p>
        {items.length === 0 ? (
          <div className="empty-results">
            <h2>No sources are saved in this browser.</h2>
            <p>Add a source from search results or a source page. Navigate away and return; the list stays here until you clear it.</p>
            <Link className="button-link" to="/search">Explore sources</Link>
            <Link className="button-link" to="/compare?preset=hcris_phc4">Compare documented HCRIS and PHC4 metadata</Link>
          </div>
        ) : (
          <>
            <div className="workspace-toolbar">
              <button type="button" onClick={downloadExport}>Export local copy</button>
              <Link className="button-link" to="/compare?preset=hcris_phc4">Compare documented examples</Link>
              {items.length >= 2 && <Link className="button-link" to={`/compare?${items.slice(0, 5).map((item) => `id=${encodeURIComponent(item.record_id)}`).join('&')}`}>Compare selected sources</Link>}
              <button type="button" onClick={() => { clearShortlist(); setItems([]) }}>Clear shortlist</button>
            </div>
            <ul className="workspace-list">
              {items.map((item) => {
                const stale = itemIsStale(item, lastSeen)
                return (
                  <li key={item.record_id}>
                    <p><Link to={item.details_path}>{item.title}</Link></p>
                    <p>{item.source_name || 'Publisher not captured'} · saved generation {item.generation}</p>
                    {stale && (
                      <p className="workspace-stale">This entry kept its original generation after a later catalog load. Refresh only if you want the last-seen generation.</p>
                    )}
                    <label>
                      Private note
                      <textarea
                        value={item.notes}
                        onChange={(event) => setItems(setShortlistNotes(item.record_id, event.target.value).items)}
                        aria-description="Stored only in this browser. Never sent to enrichment or telemetry."
                      />
                    </label>
                    <div className="workspace-item-actions">
                      {stale && lastSeen && <button type="button" onClick={() => setItems(refreshShortlistGeneration(item.record_id, lastSeen).items)}>Refresh generation</button>}
                      <button type="button" onClick={() => setItems(removeShortlistItem(item.record_id).items)}>Remove</button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </main>
      <ObservatoryFooter />
    </div>
  )
}
