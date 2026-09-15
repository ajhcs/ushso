import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { PageTitle } from '../components/PageTitle'
import { formatBibTeX, formatRIS } from '../lib/citations'
import { buildResearchExport, citationBundle, parseImportedPacket, summarizeResearchExport } from '../lib/researchExport'
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

function downloadText(filename: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function WorkspacePage() {
  const [items, setItems] = useState<ShortlistItem[]>(() => loadShortlist().items)
  const [includeQuestion, setIncludeQuestion] = useState(false)
  const [includeNotes, setIncludeNotes] = useState(false)
  const [question, setQuestion] = useState('')
  const [importText, setImportText] = useState('')
  const [importSummary, setImportSummary] = useState('')
  const lastSeen = readLastSeenGeneration()
  const staleCount = useMemo(() => items.filter((item) => itemIsStale(item, lastSeen)).length, [items, lastSeen])
  const packet = useMemo(() => buildResearchExport(items, { include_question: includeQuestion, include_notes: includeNotes, question }), [includeNotes, includeQuestion, items, question])
  const citations = useMemo(() => citationBundle(items), [items])

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
              <button type="button" onClick={() => downloadText('ushso-local-shortlist.json', exportShortlist(), 'application/json')}>Export local copy</button>
              <Link className="button-link" to="/compare?preset=hcris_phc4">Compare documented examples</Link>
              {items.length >= 2 && <Link className="button-link" to={`/compare?${items.slice(0, 5).map((item) => `id=${encodeURIComponent(item.record_id)}`).join('&')}`}>Compare selected sources</Link>}
              <button type="button" onClick={() => { clearShortlist(); setItems([]) }}>Clear shortlist</button>
            </div>
            <section className="workspace-export" aria-labelledby="workspace-citations-heading">
              <h2 id="workspace-citations-heading">Cite the publisher product</h2>
              <p>A cited source is the publisher’s product. USHSO verification is identified separately and is not a publisher endorsement. Authors, DOI, year and license are marked not captured when absent and are not invented.</p>
              <pre>{citations.plain_text.join('\n\n')}</pre>
              <div className="workspace-toolbar">
                <button type="button" onClick={() => downloadText('ushso-citations.bib', citations.citations.map(formatBibTeX).join('\n\n'), 'application/x-bibtex')}>Download BibTeX</button>
                <button type="button" onClick={() => downloadText('ushso-citations.ris', citations.citations.map(formatRIS).join('\n'), 'application/x-research-info-systems')}>Download RIS</button>
              </div>
            </section>
            <section className="workspace-export" aria-labelledby="workspace-packet-heading">
              <h2 id="workspace-packet-heading">Export a reproducible packet</h2>
              <p>Exports exclude credentials and default to source evidence only. Include the originating question or private notes only by explicit choice. Reproducing a selection does not silently re-run a different search.</p>
              <label><input type="checkbox" checked={includeQuestion} onChange={(event) => setIncludeQuestion(event.target.checked)} /> Include originating question</label>
              {includeQuestion && <label>Question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} /></label>}
              <label><input type="checkbox" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} /> Include private notes</label>
              <pre>{summarizeResearchExport(packet)}</pre>
              <button type="button" onClick={() => downloadText('ushso-research-packet.json', `${JSON.stringify(packet, null, 2)}\n`, 'application/json')}>Download evidence packet</button>
              <label>Import packet JSON<textarea value={importText} onChange={(event) => setImportText(event.target.value)} /></label>
              <button type="button" onClick={() => {
                try {
                  const imported = parseImportedPacket(importText)
                  setImportSummary(`${imported.retired ? 'Retired generation. ' : ''}${imported.readable_summary}\nSilent search re-run: ${imported.silent_search_rerun ? 'yes' : 'no'}.`)
                } catch (error) {
                  setImportSummary(error instanceof Error ? error.message : 'import failed')
                }
              }}>Open imported packet</button>
              {importSummary && <pre>{importSummary}</pre>}
            </section>
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
