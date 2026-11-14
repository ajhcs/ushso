import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { openShortlist, useShortlist } from '../features/shortlist/store'
import { samePin } from '../features/shortlist/validation'
import type { PublicationPin } from '../features/shortlist/types'
const dimensions = ['purpose','geography','grain','population','observation_period','access_routes','dictionaries','joins','limitations']
interface Comparison { pin: PublicationPin; items: {asset_id:string; dimensions:Record<string,unknown>}[]; unresolved:unknown[] }
function dimensionValue(value: unknown, depth = 0): ReactNode {
  if (depth > 8) return 'Additional detail unavailable'
  if (value === null || value === undefined) return 'Unresolved'
  if (typeof value !== 'object') return String(value).replaceAll('_',' ')
  if (Array.isArray(value)) return value.length ? <ul>{value.map((item,index)=><li key={index}>{dimensionValue(item,depth+1)}</li>)}</ul> : 'No entries documented'
  const row=value as Record<string,unknown>
  if ('status' in row && 'value' in row) return <><strong>{String(row.status).replaceAll('_',' ')}</strong><div>{dimensionValue(row.value,depth+1)}</div>{Array.isArray(row.evidence_ids)&&row.evidence_ids.length>0&&<small>Evidence: {row.evidence_ids.map(String).join(', ')}</small>}</>
  return <dl>{Object.entries(row).map(([key,item])=><div key={key}><dt>{key.replaceAll('_',' ')}</dt><dd>{dimensionValue(item,depth+1)}</dd></div>)}</dl>
}
export function ComparePage() {
  const {shortlist, imported} = useShortlist()
  const [result,setResult] = useState<Comparison|null>(null)
  const [error,setError] = useState('')
  useEffect(openShortlist, [])
  useEffect(() => {
    setResult(null); setError('')
    if (!shortlist?.items.length || shortlist.items.length > 4) return
    const controller = new AbortController()
    fetch('/api/machine/v2/compare-assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contract_version:'ushso.compare-assets.input.v2',asset_ids:shortlist.items.map(item=>item.asset_id),dimensions,expected_pin:shortlist.pin}),signal:controller.signal})
      .then(async response => { if (!response.ok) throw new Error(response.status === 410 ? 'This retained publication is unavailable. Historical snapshots remain in your shortlist.' : 'Accepted comparison unavailable. No saved facts were presented as current.'); return response.json() })
      .then(value => { if (value.contract_version !== 'ushso.compare-assets.result.v2' || !samePin(value.pin,shortlist.pin) || !Array.isArray(value.items) || value.items.length !== shortlist.items.length || new Set(value.items.map((item:{asset_id:string})=>item.asset_id)).size !== value.items.length || value.items.some((item:{asset_id:string;dimensions:unknown})=>!shortlist.items.some(saved=>saved.asset_id===item.asset_id) || !item.dimensions)) throw new Error('Comparison publication or source identity mismatch.'); setResult(value) })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Comparison unavailable.') })
    return () => controller.abort()
  },[shortlist])
  return <><ObservatoryHeader /><main id="main-content" className="selection-page"><h1>Compare sources</h1><p><Link to="/shortlist">Edit shortlist</Link>. Comparison sends only source IDs, dimensions and the publication pin. Notes and questions stay in your browser.</p>
    {imported && <p>Imported snapshots are unverified. Values below, when available, come from the pinned accepted publication.</p>}
    {!shortlist?.items.length && <p>No sources selected.</p>}{shortlist && shortlist.items.length > 4 && <p>Choose at most four sources for a simultaneous comparison.</p>}
    {error && <p role="alert">{error}</p>}
    {result && <><p>Accepted publication <code>{result.pin.generation_id}</code>. Restricted access and unresolved dimensions require source review.</p><div className="comparison-scroll"><table><caption>Accepted source dimensions in one pinned publication</caption><thead><tr><th scope="col">Dimension</th>{result.items.map(item=><th scope="col" key={item.asset_id}>{item.asset_id}</th>)}</tr></thead><tbody>{dimensions.map(dimension=><tr key={dimension}><th scope="row">{dimension.replaceAll('_',' ')}</th>{result.items.map(item=><td key={item.asset_id}>{dimensionValue(item.dimensions[dimension] ?? {status:'unavailable',value:null})}</td>)}</tr>)}</tbody></table></div></>}
  </main><ObservatoryFooter /></>
}
