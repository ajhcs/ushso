import { useEffect, useState } from 'react'
import { addSource, useShortlist } from './store'
import { validPin, validSnapshot } from './validation'
import type { PublicationPin, SourceSnapshot } from './types'
export function AcceptedSourceChooser() {
  const [publication,setPublication] = useState<{pin:PublicationPin;views:SourceSnapshot[]}|null>(null)
  const [message,setMessage] = useState('Loading accepted source selection…')
  const {shortlist} = useShortlist()
  useEffect(()=>{
    const controller=new AbortController()
    fetch('/api/source-selection/v1/publication',{signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error('Accepted source selection is unavailable for this publication. Catalog records cannot substitute for accepted snapshots.'); return response.json()})
      .then(value=>{if(value.status!=='available')throw new Error(`Accepted source selection unavailable: ${typeof value.reason==='string'?value.reason:'publication_unavailable'}. Catalog records cannot substitute for accepted snapshots.`);const pin=value.pin ?? {generation_id:value.generation_id,data_manifest_sha256:value.generation_id,ranking_version:'accepted-projection-order.v1',schema_version:'ushso.source-selection.v1'};const views=value.bundle?.views;if(value.status!=='available'||!validPin(pin)||!Array.isArray(views)||!views.every(view=>validSnapshot(view,pin)))throw new Error('Accepted publication validation failed.');setPublication({pin,views});setMessage(views.length ? '' : 'No accepted sources are published in this generation.')})
      .catch(error=>{if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:'Accepted sources unavailable.')})
    return ()=>controller.abort()
  },[])
  return <section aria-labelledby="accepted-sources-heading"><h2 id="accepted-sources-heading">Accepted sources</h2>{message&&<p role="status">{message}</p>}{publication&&<ul>{publication.views.map(view=><li key={view.asset_id}><strong>{view.title}</strong><p>{String(view.core_status??'Review status unavailable')} · {String(view.decision_readiness??'Readiness unavailable')}</p><button disabled={shortlist?.items.some(item=>item.asset_id===view.asset_id)} onClick={()=>{try{addSource({asset_id:view.asset_id,decision:'consider',note:'',snapshot:view},publication.pin);setMessage('Source added to memory shortlist.')}catch(error){setMessage(error instanceof Error?error.message:'Unable to add source.')}}}>Add {view.title} to shortlist</button></li>)}</ul>}</section>
}
