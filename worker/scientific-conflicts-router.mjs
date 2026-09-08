import {boundedJson,dictionaryHash} from './dictionary-review-store.mjs';
const HEX=/^[a-f0-9]{64}$/;
const base='/scientific-conflicts-v1';
const check=(value,code)=>{if(!value)throw Error(code);};
const reply=(status,result=null,code=null)=>new Response(JSON.stringify({schema:'ushso.scientific-conflicts-response.v1',result,error:code?{code}:null}),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function routeScientificConflicts(request,env,{loadCatalog}){
 if(env.USHSO_SCIENTIFIC_CONFLICTS_REVIEW!=='enabled')return reply(404,null,'scientific_conflicts_disabled');
 if(request.method!=='GET')return reply(405,null,'method_not_allowed');
 const url=new URL(request.url),id=url.searchParams.get('record_id'),generation=url.searchParams.get('generation'),rawPage=url.searchParams.get('page')??'0',continuation=url.searchParams.get('manifest_sha256');
 if([...url.searchParams.keys()].some(k=>!['record_id','generation','page','manifest_sha256'].includes(k)||url.searchParams.getAll(k).length!==1)||!id||id.length>500||!generation||generation.length>200||!/^(0|[1-9][0-9]?)$/.test(rawPage)||(continuation!==null&&!HEX.test(continuation)))return reply(400,null,'invalid_review_query');
 const page=Number(rawPage),pin=env.USHSO_SCIENTIFIC_CONFLICTS_MANIFEST_SHA256;
 if(!HEX.test(pin))return reply(503,null,'scientific_conflicts_pin_required');
 if((page>0&&!continuation)||(continuation&&continuation!==pin))return reply(409,null,'scientific_conflicts_restart_required');
 try{
  const catalog=await loadCatalog(request,env);if(catalog.corpus.publication?.generation!==generation)return reply(409,null,'generation_unavailable');
  const record=catalog.records.find(r=>r.record_id===id);if(!record)return reply(404,null,'record_unavailable');
  const {value:m}=await boundedJson(env.ASSETS,url.origin,base+'/manifest.json',64*1024,pin);
  check(m.schema==='ushso.scientific-conflicts-package.v1'&&m.generation===generation&&m.review_status==='pending_owner_review'&&m.owner_decision===null&&m.publication_authorized===false&&m.canonical_records_changed===0&&HEX.test(m.source_packet_sha256)&&HEX.test(m.draft_sha256)&&Array.isArray(m.records)&&m.records.length<=20,'scientific_conflicts_binding');
  const matches=m.records.filter(r=>r?.record_id===id);if(!matches.length)return reply(404,null,'scientific_conflicts_not_documented');check(matches.length===1&&HEX.test(matches[0].sha256),'scientific_conflicts_binding');
  const {value:d}=await boundedJson(env.ASSETS,url.origin,base+'/records/'+await dictionaryHash(id)+'.json',256*1024,matches[0].sha256);
  check(d.schema==='ushso.scientific-conflicts-record.v1'&&d.record_id===id&&d.generation===generation&&d.baseline_record_sha256===await dictionaryHash(JSON.stringify(record))&&d.review_status==='pending_owner_review'&&d.owner_decision===null&&d.publication_authorized===false&&d.canonical_records_changed===0&&Number.isSafeInteger(d.row_count)&&d.row_count>0&&d.row_count<=100&&Array.isArray(d.pages)&&d.pages.length>0&&d.pages.length<=100,'scientific_conflicts_binding');
  check(d.pages.every(p=>HEX.test(p.sha256)&&Number.isSafeInteger(p.count)&&p.count>0&&p.count<=10&&Number.isSafeInteger(p.bytes)&&p.bytes>1&&p.bytes<=64*1024&&Array.isArray(p.preview_ids)&&p.preview_ids.length===p.count&&p.preview_ids.every(id=>typeof id==='string'&&id.length>0&&id.length<=200))&&d.pages.reduce((n,p)=>n+p.count,0)===d.row_count&&new Set(d.pages.flatMap(p=>p.preview_ids)).size===d.row_count,'scientific_conflicts_binding');
  if(page>=d.pages.length)return reply(404,null,'review_page_unavailable');
  const selected=d.pages[page],{value:rows,bytes:pageBytes}=await boundedJson(env.ASSETS,url.origin,base+'/pages/'+selected.sha256+'.json',64*1024,selected.sha256);
  check(pageBytes===selected.bytes,'scientific_conflicts_binding');
  check(Array.isArray(rows)&&rows.length===selected.count&&rows.every((r,i)=>r&&r.record_id===id&&r.baseline_record_sha256===d.baseline_record_sha256&&['SCI-01','SCI-02','SCI-03','SCI-06'].includes(r.card_id)&&r.review_status==='pending_owner_review'&&r.owner_decision===null&&r.publication_authorized===false&&r.eligible_for_schema_promotion===false&&r.preview_id===selected.preview_ids[i]&&typeof r.display_label==='string'&&r.display_label.length<=1000&&typeof r.state==='string'&&r.state.length<=500&&typeof r.scope_warning==='string'&&r.scope_warning.length<=6000&&typeof r.proposed_text==='string'&&r.proposed_text.length<=6000&&(r.field_name===null||typeof r.field_name==='string')&&r.payload&&typeof r.payload==='object'&&!Array.isArray(r.payload)),'scientific_conflicts_binding');
  const result={record_id:id,generation,manifest_sha256:pin,source_packet_sha256:m.source_packet_sha256,draft_sha256:m.draft_sha256,review_status:'pending_owner_review',owner_decision:null,publication_authorized:false,canonical_records_changed:0,row_count:d.row_count,page,page_count:d.pages.length,next_page:page+1<d.pages.length?page+1:null,rows};
  check(new TextEncoder().encode(JSON.stringify(result)).length<=128*1024,'scientific_conflicts_response_limit');return reply(200,result);
 }catch(error){return reply(503,null,['scientific_conflicts_binding','scientific_conflicts_response_limit'].includes(error.message)?error.message:'scientific_conflicts_verification_failed');}
}
