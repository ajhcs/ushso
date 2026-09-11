import {useEffect,useRef,useState} from 'react'
type Row={preview_id:string;card_id:string;record_id:string;field_name:string|null;display_label:string;review_status:'pending_owner_review';state:string;scope_warning:string;proposed_text:string;missing_evidence:unknown;owner_decision:null;publication_authorized:false;eligible_for_schema_promotion:false;payload:Record<string,unknown>}
type Page={review_status:'pending_owner_review';record_id:string;generation:string;manifest_sha256:string;owner_decision:null;publication_authorized:false;canonical_records_changed:0;row_count:number;page:number;page_count:number;next_page:number|null;rows:Row[]}
export default function ScientificConflictsPanel({recordId,generation}:{recordId:string;generation:string}){
 const [page,setPage]=useState<Page|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>{active.current?.abort();setPage(null);setError(null);setLoading(false);return()=>active.current?.abort()},[recordId,generation])
 async function load(index=0,pin:string|null=null){
  active.current?.abort();const controller=new AbortController();active.current=controller;setLoading(true);setError(null)
  try{
   const params=new URLSearchParams({record_id:recordId,generation,page:String(index)});if(pin)params.set('manifest_sha256',pin)
   const response=await fetch(`/api/research/v1/scientific-conflicts?${params}`,{signal:controller.signal,headers:{accept:'application/json'}})
   if(!response.body)throw Error('review_unavailable');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>128*1024)throw Error('review_response_limit');chunks.push(value)}}finally{await reader.cancel();reader.releaseLock()}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
   const body:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
   if(!response.ok)throw Error(reviewFailureCode(body))
   if(!isReviewPage(body,recordId,generation,index,pin,response.ok))throw Error('review_identity_or_boundary')
   const p=body.result
   if(!controller.signal.aborted)setPage(p)
  }catch(e){if(!controller.signal.aborted){setPage(null);setError(e instanceof Error?e.message:'review_unavailable')}}finally{if(!controller.signal.aborted)setLoading(false)}
 }
 return <section className="details-panel" style={{overflowWrap:'anywhere'}} aria-label="Unresolved scientific conflicts"><h2>Unresolved field evidence — review only</h2><p>Conflicting publisher literals and candidate relationships are not canonical facts, approved schemas, units, aliases or release mappings.</p><button type="button" disabled={loading} onClick={()=>void load()}>Inspect unresolved field evidence</button>{loading?<p role="status">Loading bounded conflict page…</p>:null}{error?<p role="alert">Conflict review unavailable: {error}. Restart inspection after a package change; no resolution is inferred.</p>:null}{page&&page.record_id===recordId&&page.generation===generation?<><p>Page {page.page+1} of {page.page_count}; {page.row_count} packaged review items. Owner decision: pending.</p>{page.rows.map(row=><article key={row.preview_id}><h3>{row.card_id}: {row.display_label}</h3><p>Publisher variable identity: {row.field_name??'unresolved / not asserted'}</p><p>Review state: {row.state}</p><p>{row.scope_warning}</p><p>{row.proposed_text?`Proposed review wording (not approved): ${row.proposed_text}`:'No scientific resolution proposed.'}</p><details><summary>Exact publisher literals, dates, source bindings and candidate relationships</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(row.payload,null,2)}</pre><p>Remaining evidence:</p><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(row.missing_evidence,null,2)}</pre></details></article>)}<div>{page.page>0?<button disabled={loading} onClick={()=>void load(page.page-1,page.manifest_sha256)}>Previous conflict page</button>:null}{page.next_page!==null?<button disabled={loading} onClick={()=>void load(page.next_page!,page.manifest_sha256)}>Next conflict page</button>:null}</div><p>Manifest SHA-256: <code>{page.manifest_sha256}</code>. End of pagination means packaged review items only, not scientific completeness.</p></>:null}</section>
}

function isObject(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)}
export function isReviewPage(value:unknown,recordId:string,generation:string,index:number,pin:string|null,httpOk:boolean):value is {schema:string;result:Page}{
 if(!httpOk||!isObject(value)||value.schema!=='ushso.scientific-conflicts-response.v1'||!isObject(value.result))return false
 const p=value.result
 if(p.review_status!=='pending_owner_review'||p.record_id!==recordId||p.generation!==generation||p.owner_decision!==null||p.publication_authorized!==false||p.canonical_records_changed!==0||typeof p.manifest_sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.manifest_sha256)||(pin!==null&&p.manifest_sha256!==pin)||p.page!==index||typeof p.page_count!=='number'||!Number.isSafeInteger(p.page_count)||p.page_count<1||p.page_count>100||index<0||index>=p.page_count||typeof p.row_count!=='number'||!Number.isSafeInteger(p.row_count)||p.row_count<1||p.row_count>100||!Array.isArray(p.rows)||p.rows.length<1||p.rows.length>10||p.rows.length>p.row_count||p.next_page!==(index+1<p.page_count?index+1:null))return false
 const ids=new Set<string>()
 return p.rows.every((r:unknown)=>{if(!isObject(r)||r.record_id!==recordId||r.owner_decision!==null||r.publication_authorized!==false||r.eligible_for_schema_promotion!==false||r.review_status!=='pending_owner_review'||typeof r.card_id!=='string'||!['SCI-01','SCI-02','SCI-03','SCI-06'].includes(r.card_id)||typeof r.preview_id!=='string'||r.preview_id.length<1||r.preview_id.length>200||ids.has(r.preview_id)||typeof r.display_label!=='string'||r.display_label.length>1000||typeof r.state!=='string'||r.state.length>500||typeof r.scope_warning!=='string'||r.scope_warning.length>6000||typeof r.proposed_text!=='string'||r.proposed_text.length>6000||(r.field_name!==null&&typeof r.field_name!=='string')||!isObject(r.payload))return false;ids.add(r.preview_id);return true})
}

export function reviewFailureCode(body:unknown):string{
 if(isObject(body)&&isObject(body.error)&&typeof body.error.code==='string'&&/^[a-z][a-z0-9_]{0,99}$/.test(body.error.code))return body.error.code
 return 'review_unavailable'
}
