import fs from 'node:fs/promises';
import path from 'node:path';
import {sha,packageScientificConflicts} from './package-scientific-conflicts.mjs';
export async function makeConflictFixture(root){
 const generation='test-generation',records=Array.from({length:7},(_,i)=>({record_id:'record-'+i,title:'Public test record '+i}));
 const affected=i=>({record_id:records[i].record_id,baseline_record_sha256:sha(JSON.stringify(records[i]))});
 const base=id=>({id,remaining:'Scientific interpretation remains unresolved.',affected_records:[],selected_source_bindings:[]});
 const doc={...base('SCI-01'),affected_records:[0,1,2].map(affected),new_evidence:[{literal:'2024 documentation text',url:'https://data.cms.gov/example.pdf'}]};
 doc.selected_source_bindings=[0,1,2].map(i=>({...affected(i),release_binding:{resources_url:'https://data.cms.gov/resource/'+i}}));
 doc.competing_statements=[0,1,2].map(i=>({literal:'Dictionary 2020-2023',distribution:{resourcesAPI:'https://data.cms.gov/resource/'+i,temporal:'2024-01-01/2024-12-31'}}));
 const depression={...base('SCI-02'),affected_records:[0,1,3,4].map(i=>({...affected(i),variable:'BENE_CC_BH_DEPRESS_V1_PCT'})),competing_statements:[0,1,3,4].map(i=>({record_id:records[i].record_id,term_cell:'Major Depressive Affective Disorder',definition:'bipolar disorders',correct_side:'unknown'}))};
 const opioid={...base('SCI-03'),affected_records:[{...affected(5),columns:['opioid','long_acting']}],competing_statements:['opioid','long_acting'].map(variable=>({variable,literal:'Displayed as an increase, decrease, or no change.'})),new_evidence:{public_preview_scope:'One selected public aggregate row only',columns:[{name:'opioid',preview_value:'-0.37'},{name:'long_acting',preview_value:'0.13'}]}};
 const terms=[...Array.from({length:80},(_,i)=>'TERM_'+i),'CY_QTR'];
 const pbj={term_passages:terms.map(publisher_term=>({publisher_term,definition_passage:'Literal definition '+publisher_term,source_cells:['',publisher_term,'Literal definition '+publisher_term],variable_name:null,eligible_for_schema_promotion:false,release_applicability:'unresolved'})),references:[],pdf_sha256:'a'.repeat(64),geometry_sha256:'b'.repeat(64)};
 const payroll={...base('SCI-06'),affected_records:[affected(6)],competing_statements:{headers:[...terms.slice(0,80),'CY_Qtr','Hrs_Admin_fn'],matching_terms:terms.slice(0,80),case_only_candidates:[{publisher_term:'CY_QTR',header:'CY_Qtr',automatically_equated:false}],headers_without_exact_term:['CY_Qtr','Hrs_Admin_fn'],unmatched_terms:['CY_QTR']}};
 const packet={generation,canonical_records_changed:0,scientific_approval:null,deployment_authorized:false,conflicts:[doc,depression,opioid,payroll]};
 const packetFile=path.join(root,'packet.json'),draftFile=path.join(root,'draft.json'),corpusDirectory=path.join(root,'corpus');await fs.mkdir(corpusDirectory);
 await fs.writeFile(packetFile,JSON.stringify(packet));
 const artifacts=[];for(let i=0;i<4;i++){const file=path.join(root,'original-'+i+'.json'),b=Buffer.from(JSON.stringify(i===0?pbj:{public_fixture:true}));await fs.writeFile(file,b);artifacts.push({file,bytes:b.length,sha256:sha(b)});}
 const draft={generation,source_packet_sha256:sha(await fs.readFile(packetFile)),owner_decision:null,publication_authorized:false,cards:packet.conflicts.map(c=>({card_id:c.id,owner_decision:null,automatic_semantic_promotion:false,state:'pending_review',proposed_text:null,missing_evidence:'Owner interpretation pending',...(c.id==='SCI-06'?{original_artifacts:artifacts,original_term_passages:pbj.term_passages}:{})}))};
 await fs.writeFile(draftFile,JSON.stringify(draft));await fs.writeFile(path.join(corpusDirectory,'corpus.json'),JSON.stringify({record_count:records.length,record_files:['records.jsonl'],publication:{generation}}));await fs.writeFile(path.join(corpusDirectory,'records.jsonl'),records.map(r=>JSON.stringify(r)).join('\n'));
 const output=path.join(root,'package');await packageScientificConflicts({packetFile,draftFile,corpusDirectory,output});return {records,generation,output,packetFile,draftFile,corpusDirectory};
}
