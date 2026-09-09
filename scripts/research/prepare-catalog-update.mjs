import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyProposalClaim,documentedEnumeration} from './source-extractors.mjs';
import {browserRecordErrors} from '../../packages/retrieval/tools/catalog-contract.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''),base='/mnt/d/tmp/plumbob/ushso-research-expansion-20260907',evidence=process.argv[2]??base+'/evidence',out=process.argv[3]??base+'/review/canonical-dictionary-proposals';
await fs.mkdir(out,{recursive:true});const hash=x=>createHash('sha256').update(x).digest('hex');
const manifest=JSON.parse(await fs.readFile(root+'/packages/retrieval/versions/v1.2.0/corpus/corpus.json')),records=new Map();
for(const f of manifest.record_files)for(const l of (await fs.readFile(root+'/packages/retrieval/versions/v1.2.0/corpus/'+f,'utf8')).trim().split('\n')){const r=JSON.parse(l);records.set(r.record_id,r);}
const summary={generated_at:new Date().toISOString(),generation:manifest.publication.generation,proposed_records:0,proposed_variables:0,validation_passed:0,isolated:[],review_status:'pending_owner_review',publication_authorized:false,canonical_records_changed:0,index:[]};
summary.variables_with_documented_enumerations=0;
const collection=JSON.parse(await fs.readFile(evidence+'/completeness.json'));
if(collection.generation!==manifest.publication.generation)throw Error('GENERATION_BINDING');
const captureDir=collection.capture_directory??evidence+'/captures';
for(const f of await fs.readdir(evidence+'/records')){
 try {
 const bytes=await fs.readFile(evidence+'/records/'+f),r=JSON.parse(bytes),original=records.get(r.record_id),diff=r.diff.find(d=>d.path==='/variable_documentation');if(!diff)continue;
 if(hash(JSON.stringify(original))!==r.record_sha256)throw Error('BASELINE_IDENTITY');
 if(r.generation!==manifest.publication.generation)throw Error('GENERATION_BINDING');
 const captures=new Map();
 for(const c of Object.values(r.captures).filter(c=>c?.url)){
  const receipt=JSON.parse(await fs.readFile(captureDir+'/'+hash(c.url)+'.json'));
  if(receipt.url!==c.url)throw Error('CAPTURE_URL_IDENTITY');
  if(receipt.sha256){receipt.text=await fs.readFile(captureDir+'/'+receipt.sha256+'.body','utf8');if(hash(receipt.text)!==receipt.sha256)throw Error('CAPTURE_HASH');try{receipt.data=JSON.parse(receipt.text)}catch{receipt.status='captured_non_json'}}
  captures.set(c.url,receipt);
 }
 const {value_in_diff_path,...claim}=r.claims.find(c=>c.field==='variable_documentation');
 const verified=verifyProposalClaim(claim,diff,captures,original,manifest.publication.generation);
 const e=verified.evidence,id='evidence:dictionary:'+hash(JSON.stringify(e)).slice(0,24),pid='provenance:dictionary:'+e.capture_sha256.slice(0,24);
 const limitations=[diff.scope,'Pending owner scientific review. Captured publisher dictionary, not executed payload schema, release continuity, join compatibility, free access or fitness certification.','Measurement units and allowed values are unresolved unless literally documented; none inferred from names.'];
 const provenance={provenance_id:pid,kind:'catalog_metadata',locator:e.url,observed_at:e.observed_at,capture_state:'captured_hashed',content_sha256:e.capture_sha256};
 const parent=e.parent?{provenance_id:'provenance:dictionary-parent:'+e.parent.capture_sha256.slice(0,24),kind:'catalog_metadata',locator:e.parent.url,observed_at:captures.get(e.parent.url).captured_at,capture_state:'captured_hashed',content_sha256:e.parent.capture_sha256}:null;
 const evidenceRow={evidence_id:id,claim:'The captured publisher documentation contains these named variable entries at '+e.pointer+'.',state:'verified_first_party',provenance_ids:[pid],limitations};
 if(parent)evidenceRow.provenance_ids.push(parent.provenance_id);
 const variables=diff.after.map(v=>{
  const raw=r.source_id==='census-api'?captures.get(e.url).data.variables[v.name]?.values?.item:null;
  const labels=documentedEnumeration(raw)?.labels??null;
  if(labels&&Object.keys(labels).length)summary.variables_with_documented_enumerations++;
  return {...v,description:v.concept_is_not_variable_definition?'':v.description,publisher_concept:v.concept_is_not_variable_definition?v.description:null,allowed_values:labels?Object.keys(labels):v.allowed_values,publisher_value_labels:labels,publisher_value_labels_evidence:labels?{url:e.url,capture_sha256:e.capture_sha256,pointer:e.pointer+'/'+v.name.replace(/~/g,'~0').replace(/\//g,'~1')+'/values/item',raw_value_sha256:hash(JSON.stringify(labels))}:null,evidence_ids:[id],evidence_state:'verified_first_party'};
 });
 const dictionary={status:'partial',summary:'Publisher dictionary entries captured; scientific review pending.',variable_count:variables.length,variables,evidence_ids:[id],limitations,evidence_state:'verified_first_party',codebook:{title:'Captured publisher variable documentation',url:e.url}};
 const candidate={...original,variable_documentation:dictionary,provenance:[...original.provenance,provenance,...(parent?[parent]:[])],evidence:[...original.evidence,evidenceRow]};const errors=browserRecordErrors(candidate);
 if(errors.length){summary.isolated.push({record_id:r.record_id,errors,baseline_errors:browserRecordErrors(original)});continue;}
 const proposal={record_id:r.record_id,title:original.title,baseline_record_sha256:r.record_sha256,source_diff_file:evidence+'/records/'+f,source_diff_sha256:hash(bytes),source_evidence:e,review_status:'pending_owner_review',publication_authorized:false,changes:[{path:'/variable_documentation',before:original.variable_documentation??null,after:dictionary},{path:'/provenance/-',before:null,after:provenance},{path:'/evidence/-',before:null,after:evidenceRow}],validation:{validator:'browserRecordErrors',errors:[]}};
 if(parent)proposal.changes.push({path:'/provenance/-',before:null,after:parent});
 const body=JSON.stringify(proposal)+'\n',file=out+'/'+hash(r.record_id)+'.json';await fs.writeFile(file,body);summary.index.push({record_id:r.record_id,file,sha256:hash(body),variables:variables.length});summary.proposed_records++;summary.validation_passed++;summary.proposed_variables+=variables.length;
 } catch(error) { summary.isolated.push({source_file:f,code:error.message}); }
}
await fs.writeFile(out+'/manifest.json',JSON.stringify(summary,null,2));console.log(JSON.stringify({...summary,index:summary.index.length}));
