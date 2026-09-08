import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
export const sha = b => createHash('sha256').update(b).digest('hex');
const check=(v,c)=>{if(!v)throw Error(c);};
async function input(file,max){const st=await fs.stat(file);check(st.size<=max,'CONFLICT_INPUT_BOUND');const b=await fs.readFile(file);check(b.length<=max,'CONFLICT_INPUT_BOUND');return {bytes:b,value:JSON.parse(b),sha256:sha(b)};}
export function buildConflictRows({packet,draft,pbj,records}){
 check(packet.generation===draft.generation&&draft.owner_decision===null&&draft.publication_authorized===false&&packet.canonical_records_changed===0&&packet.scientific_approval===null&&packet.deployment_authorized===false,'CONFLICT_BOUNDARY');
 const result=[];
 for(const id of ['SCI-01','SCI-02','SCI-03','SCI-06']){
  const cards=packet.conflicts.filter(c=>c.id===id),decisions=draft.cards.filter(c=>c.card_id===id);check(cards.length===1&&decisions.length===1,'CONFLICT_CARD');const c=cards[0],decision=decisions[0];check(decision.owner_decision===null&&decision.automatic_semantic_promotion===false,'CONFLICT_DECISION');
  for(const affected of c.affected_records){
   const record=records.find(r=>r.record_id===affected.record_id);check(record,'CONFLICT_RECORD');
   const binding=c.selected_source_bindings?.find(b=>b.record_id===record.record_id);
   if(affected.baseline_record_sha256||binding?.baseline_record_sha256)check((affected.baseline_record_sha256??binding.baseline_record_sha256)===sha(JSON.stringify(record)),'CONFLICT_BASELINE');
   check(typeof decision.state==='string'&&typeof c.remaining==='string'&&(decision.proposed_text===null||typeof decision.proposed_text==='string'),'CONFLICT_RENDER_FIELDS');
   const common={card_id:id,record_id:record.record_id,baseline_record_sha256:sha(JSON.stringify(record)),review_status:'pending_owner_review',owner_decision:null,publication_authorized:false,eligible_for_schema_promotion:false,state:decision.state,scope_warning:c.remaining,proposed_text:decision.proposed_text??'No scientific resolution proposed.',missing_evidence:decision.missing_evidence,source_packet_pointer:`/conflicts/${packet.conflicts.indexOf(c)}`};
   const add=(field_name,display_label,payload)=>result.push({...common,preview_id:`${id}:${sha(record.record_id).slice(0,16)}:${result.length}`,field_name,display_label,payload});
   if(id==='SCI-01'){
    const statements=c.competing_statements.filter(s=>s.distribution?.resourcesAPI===binding?.release_binding?.resources_url);check(statements.length===1,'CONFLICT_DOCUMENT_BINDING');
    add(null,'Documentation applicability — not field approval',{competing_statement:statements[0],new_evidence:c.new_evidence,selected_source_binding:binding});
   }else if(id==='SCI-02'){
    const s=c.competing_statements.filter(s=>s.record_id===record.record_id);check(s.length===1,'CONFLICT_FIELD_BINDING');
    add(affected.variable,s[0].term_cell,{literal_label:s[0].term_cell,literal_definition:s[0].definition,correct_side:s[0].correct_side,source_statement:s[0],affected_record:affected,selected_source_binding:binding??null});
   }else if(id==='SCI-03'){
    for(const name of affected.columns){const s=c.competing_statements.filter(s=>s.variable===name),observed=c.new_evidence.columns.filter(v=>v.name===name);check(s.length===1&&observed.length===1&&typeof observed[0].preview_value==='string','CONFLICT_OBSERVATION_BINDING');
     add(name,name,{literal_definition:s[0].literal,source_statement:s[0],observed_value:observed[0],observation_scope:c.new_evidence.public_preview_scope,observation_source:{...c.new_evidence,columns:undefined},selected_source_binding:binding});}
   }else{
    check(pbj.term_passages.length===81&&isDeepStrictEqual(decision.original_term_passages,pbj.term_passages),'CONFLICT_PBJ_PASSAGES');
    const comparison=c.competing_statements;check(comparison.headers.length===82&&comparison.matching_terms.length===80,'CONFLICT_PBJ_COMPARISON');
    for(const passage of pbj.term_passages){check(passage.variable_name===null&&passage.eligible_for_schema_promotion===false,'CONFLICT_PBJ_NO_IDENTITY');
     const exact=comparison.headers.includes(passage.publisher_term);
     const references=pbj.references.map(reference=>Object.fromEntries(['record_id','generation','baseline_record_sha256','source_record_sha256','resources_pointer','publisher_url','release_binding','binding_verification','pdf_sha256','geometry_sha256'].filter(k=>Object.hasOwn(reference,k)).map(k=>[k,reference[k]])));
     add(null,passage.publisher_term,{original_term_passage:passage,candidate_relationship:{publisher_term:passage.publisher_term,publisher_variable_name:null,matching_header:exact?passage.publisher_term:null,case_only_candidates:comparison.case_only_candidates.filter(x=>x.publisher_term===passage.publisher_term),status:'candidate_only_not_canonical_binding',canonical_binding:false},source_document:{pdf_sha256:pbj.pdf_sha256,geometry_sha256:pbj.geometry_sha256,references},comparison_context:{publisher_url:comparison.publisher_url,response_sha256:comparison.response_sha256,complete_metadata_member_sha256:comparison.complete_metadata_member_sha256,publisher_file:comparison.publisher_file,publisher_file_url:comparison.publisher_file_url,captured_distribution:comparison.captured_distribution,release_applicability:comparison.release_applicability,headers_without_exact_term:comparison.headers_without_exact_term,unmatched_terms:comparison.unmatched_terms}});
    }
   }
  }
 }
 check(result.length===90,'CONFLICT_COMPLETE_SCOPE');check(!/\/mnt\/d\/|\/home\//.test(JSON.stringify(result)),'CONFLICT_LOCAL_PATH');return result;
}
export async function packageScientificConflicts({packetFile,draftFile,corpusDirectory,output}){
 const packet=await input(packetFile,4*1024*1024),draft=await input(draftFile,512*1024);check(draft.value.source_packet_sha256===packet.sha256,'CONFLICT_PACKET_PIN');
 const pbjCard=draft.value.cards.find(c=>c.card_id==='SCI-06');check(pbjCard?.original_artifacts?.length===4,'CONFLICT_PBJ_ARTIFACTS');
 let pbj;
 for(const [i,a]of pbjCard.original_artifacts.entries()){const st=await fs.stat(a.file);check(st.size===a.bytes&&st.size<=256*1024,'CONFLICT_ARTIFACT_BOUND');const b=await fs.readFile(a.file);check(sha(b)===a.sha256,'CONFLICT_ARTIFACT_PIN');if(i===0)pbj=JSON.parse(b);}
 const corpus=await input(path.join(corpusDirectory,'corpus.json'),2*1024*1024);check(corpus.value.publication.generation===packet.value.generation,'CONFLICT_GENERATION');
 check(Number.isSafeInteger(corpus.value.record_count)&&corpus.value.record_count>0&&corpus.value.record_count<=4000&&Array.isArray(corpus.value.record_files)&&corpus.value.record_files.length>0&&corpus.value.record_files.length<=4000,'CONFLICT_CORPUS_BOUND');
 const records=[];for(const f of corpus.value.record_files){check(typeof f==='string'&&!path.isAbsolute(f)&&!f.split('/').includes('..'),'CONFLICT_CORPUS_PATH');const file=path.join(corpusDirectory,f),stat=await fs.stat(file);check(stat.isFile()&&stat.size<=64*1024*1024,'CONFLICT_CORPUS_BOUND');const b=await fs.readFile(file);check(b.length<=64*1024*1024,'CONFLICT_CORPUS_BOUND');const lines=b.toString().trim().split('\n').filter(Boolean);check(records.length+lines.length<=corpus.value.record_count,'CONFLICT_CORPUS_BOUND');records.push(...lines.map(JSON.parse));}
 check(Number.isSafeInteger(corpus.value.record_count)&&corpus.value.record_count>0&&records.length===corpus.value.record_count&&records.every(r=>typeof r.record_id==='string')&&new Set(records.map(r=>r.record_id)).size===corpus.value.record_count,'CONFLICT_CORPUS_SCOPE');
 const rows=buildConflictRows({packet:packet.value,draft:draft.value,pbj,records});
 await fs.mkdir(output,{recursive:false});await fs.mkdir(output+'/records');await fs.mkdir(output+'/pages');
 const items=[];
 for(const record_id of [...new Set(rows.map(r=>r.record_id))].sort()){
  const selected=rows.filter(r=>r.record_id===record_id),pages=[];let page=[];
  async function flush(){if(!page.length)return;const b=Buffer.from(JSON.stringify(page)),h=sha(b);check(b.length<=64*1024,'CONFLICT_PAGE_BOUND');await fs.writeFile(output+'/pages/'+h+'.json',b,{flag:'wx'});pages.push({sha256:h,bytes:b.length,count:page.length,preview_ids:page.map(r=>r.preview_id)});page=[];}
  for(const row of selected){if(page.length===10||Buffer.byteLength(JSON.stringify([...page,row]))>64*1024)await flush();page.push(row);}await flush();
  const descriptor={schema:'ushso.scientific-conflicts-record.v1',record_id,generation:packet.value.generation,baseline_record_sha256:selected[0].baseline_record_sha256,review_status:'pending_owner_review',owner_decision:null,publication_authorized:false,canonical_records_changed:0,row_count:selected.length,pages};
  const b=Buffer.from(JSON.stringify(descriptor));check(b.length<=256*1024,'CONFLICT_DESCRIPTOR_BOUND');await fs.writeFile(output+'/records/'+sha(record_id)+'.json',b,{flag:'wx'});items.push({record_id,sha256:sha(b)});
 }
 const manifest={schema:'ushso.scientific-conflicts-package.v1',generation:packet.value.generation,source_packet_sha256:packet.sha256,draft_sha256:draft.sha256,original_artifacts:pbjCard.original_artifacts.map(({file,...a})=>a),review_status:'pending_owner_review',owner_decision:null,publication_authorized:false,canonical_records_changed:0,records:items};const b=Buffer.from(JSON.stringify(manifest));check(b.length<=64*1024,'CONFLICT_MANIFEST_BOUND');await fs.writeFile(output+'/manifest.json',b,{flag:'wx'});return {manifest_sha256:sha(b),records:items.length,rows:rows.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const [packetFile,draftFile,corpusDirectory,output]=process.argv.slice(2);console.log(JSON.stringify(await packageScientificConflicts({packetFile,draftFile,corpusDirectory,output})));}
