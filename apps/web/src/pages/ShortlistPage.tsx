import { CitationList } from '../features/shortlist/CitationList'
import { AcceptedSourceChooser } from '../features/shortlist/AcceptedSourceChooser'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { clearShortlist, editItem, importShortlist, openShortlist, removeSource, saveOnDevice, useShortlist } from '../features/shortlist/store'
export function ShortlistPage() {
  const {shortlist, message, imported, conflict} = useShortlist()
  const [error, setError] = useState('')
  const [question, setQuestion] = useState('')
  const [storeQuestion, setStoreQuestion] = useState(false)
  const [exportQuestion, setExportQuestion] = useState(false)
  useEffect(openShortlist, [])
  useEffect(() => { setQuestion(shortlist?.question ?? ''); setExportQuestion(false); setStoreQuestion(false) }, [shortlist?.id])
  useEffect(() => { const clearExportConsent = () => setExportQuestion(false); window.addEventListener('afterprint', clearExportConsent); return () => window.removeEventListener('afterprint', clearExportConsent) }, [])
  const act = (fn: () => void) => { try { fn(); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'Action unavailable.') } }
  const exportBrief = async () => {
    if (!shortlist) return
    try {
      const {selectionBrief} = await import('../features/shortlist/export')
      const text = await selectionBrief({...shortlist, question}, new Date().toISOString(), exportQuestion)
      const href = URL.createObjectURL(new Blob([text], {type:'application/json'}))
      const link = document.createElement('a'); link.href = href; link.download = 'ushso-selection-brief.json'; link.click(); URL.revokeObjectURL(href)
      setExportQuestion(false); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Export unavailable.') }
  }
  return <><ObservatoryHeader /><main id="main-content" className="selection-page"><h1>Source shortlist</h1><p role="status">{message}</p>{error && <p role="alert">{error}</p>}
    <p>Select sources from an accepted source page. Notes and questions remain in your browser. No account or remote sync is used.</p>
    <AcceptedSourceChooser />
    {imported && <p><strong>Unverified import.</strong> A checksum proves integrity, not authenticity. Comparison requires a retained rights-valid publication.</p>}
    {shortlist ? <><p>Publication <code>{shortlist.pin.generation_id}</code>. Ranking {shortlist.pin.ranking_version}.</p>
      <ol>{shortlist.items.map(item => <li key={item.asset_id}><h2>{item.snapshot.title}</h2><p>{item.asset_id}</p><CitationList snapshot={item.snapshot} /><details><summary>Snapshot, evidence and unresolved gaps</summary><pre className="source-snapshot">{JSON.stringify(item.snapshot,null,2)}</pre></details>
        <p className="print-only">Decision: {item.decision}. Reason: {item.note || 'No reason supplied.'}</p><label>Decision <select disabled={conflict} value={item.decision} onChange={e => act(() => editItem(item.asset_id,{decision:e.target.value as typeof item.decision}))}><option value="consider">Consider</option><option value="include">Include</option><option value="exclude">Exclude</option></select></label>
        <label>Reason or note <textarea disabled={conflict} maxLength={2000} value={item.note} onChange={e => act(() => editItem(item.asset_id,{note:e.target.value}))} /></label><button disabled={conflict} onClick={() => act(() => removeSource(item.asset_id))}>Remove {item.snapshot.title}</button>
      </li>)}</ol><Link to="/compare">Compare up to four sources</Link>
      <label>Research question (optional) <textarea maxLength={2000} value={question} onChange={e => setQuestion(e.target.value)} /></label>
      <label><input type="checkbox" checked={storeQuestion} onChange={e => setStoreQuestion(e.target.checked)} />Also save this question on this device</label>
      <button disabled={conflict} onClick={() => act(() => saveOnDevice(storeQuestion,question))}>Save on this device for 30 days</button><p>Expiry is fixed when you save. Deletion occurs on next opening; use Clear for immediate deletion.</p>
      <label><input type="checkbox" checked={exportQuestion} onChange={e => setExportQuestion(e.target.checked)} />Include the question in this export only</label>
      <button onClick={exportBrief}>Export reproducible JSON brief</button><button onClick={() => { window.print(); setExportQuestion(false) }}>Print this selection</button>{exportQuestion && <p className="print-only">Research question: {question || 'Not supplied'}</p>}
    </> : <p>No sources shortlisted. <Link to="/search">Find sources</Link>.</p>}
    <button onClick={() => { clearShortlist(); setQuestion(''); setStoreQuestion(false); setExportQuestion(false); setError('') }}>Clear shortlist and revoke device storage</button>
    <label>Import shortlist JSON (maximum 1 MiB; imported facts remain unverified)<input type="file" accept="application/json,.json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 1024*1024) {setError('Import exceeds 1 MiB.'); return} const text = await file.text(); try { if (JSON.parse(text)?.schema_version === 'ushso.selection-brief.v1') { const {importBrief} = await import('../features/shortlist/export'); importShortlist(JSON.stringify(await importBrief(text))) } else importShortlist(text); setError('') } catch (error) { setError(error instanceof Error ? error.message : 'Import unavailable.') } e.target.value = '' }} /></label>
  </main><ObservatoryFooter /></>
}
