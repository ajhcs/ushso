import {requireResearchPython} from './research-python.mjs';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {parseTypedLayout} from './cms-typed-layout.mjs';
import {parseVariableLayout} from './cms-variable-layout.mjs';
const variableFirst=process.argv.includes('--variable-first');
const exec=promisify(execFile),base=process.env.USHSO_RESEARCH_EVIDENCE_ROOT??'/mnt/d/tmp/plumbob/ushso-research-expansion-20260907',out=process.env.USHSO_RESEARCH_OUTPUT_DIR??base+'/review/'+(variableFirst?'cms-variable-dictionary-proposals-':'cms-typed-dictionary-proposals-')+new Date().toISOString().replace(/[:.]/g,'-');
const hash=x=>createHash('sha256').update(x).digest('hex');await fs.mkdir(out);
const results=[],isolated=[],cache=new Map();
for(const name of ['cms-documents-v2','cms-release-documents']){
 const directory=base+'/'+name;
 for(const file of await fs.readdir(directory)){
  if(!file.endsWith('.record.json'))continue;const record=JSON.parse(await fs.readFile(directory+'/'+file));
  for(const doc of record.documents??[]){
   if(doc.status!=='captured_document'||doc.role!=='dictionary')continue;
   const plain=await fs.readFile(directory+'/'+doc.sha256+'.text.json');if(hash(plain)!==doc.text_sha256)throw Error('TEXT_HASH');
   if(!JSON.parse(plain).pages?.[0]?.text?.split('\n').some(l=>l.replace(/\s+/g,' ').trim()===(variableFirst?'Variable Name Term Name Definition':'Term Name Variable Name Description Type Length')))continue;
   try{
    const pdf=await fs.readFile(directory+'/'+doc.sha256+'.pdf');if(hash(pdf)!==doc.sha256)throw Error('PDF_HASH');
    let layout=cache.get(doc.sha256);
    if(!layout){const response=await exec(requireResearchPython(), ['-I', fileURLToPath(new URL('./pdf-layout.py',import.meta.url)),directory+'/'+doc.sha256+'.pdf'],{timeout:20000,maxBuffer:4*1024*1024});layout=JSON.parse(response.stdout);cache.set(doc.sha256,layout);await fs.writeFile(out+'/'+doc.sha256+'.layout.json',JSON.stringify(layout));}
    const after=(variableFirst?parseVariableLayout:parseTypedLayout)(layout),binding=doc.release_binding??record.binding;
    const body=JSON.stringify({record_id:record.record_id,generation:record.generation,baseline_record_sha256:record.record_sha256,source_record_file:directory+'/'+file,source_record_sha256:hash(await fs.readFile(directory+'/'+file)),publisher_url:doc.url,pdf_sha256:doc.sha256,layout_sha256:hash(JSON.stringify(layout)),release_binding:binding,resources_pointer:doc.resources_pointer,before:null,after,review_status:'pending_owner_review',publication_authorized:false},null,2);
    const target=hash(record.record_id+doc.sha256+binding.distribution_pointer)+'.json';await fs.writeFile(out+'/'+target,body);results.push({record_id:record.record_id,pdf_sha256:doc.sha256,file:out+'/'+target,sha256:hash(body),variables:after.variables.length});
   }catch(error){isolated.push({record_id:record.record_id,pdf_sha256:doc.sha256,reason:error.message});}
  }
 }
}
const summary={generated_at:new Date().toISOString(),records:new Set(results.map(r=>r.record_id)).size,unique_documents:new Set(results.map(r=>r.pdf_sha256)).size,variables:results.reduce((n,r)=>n+r.variables,0),proposals:results,isolated,scientific_approval:false,canonical_records_changed:0,source_release_binding_verification:'pending independent revalidation'};
await fs.writeFile(out+'/manifest.json',JSON.stringify(summary,null,2));console.log(JSON.stringify({...summary,proposals:summary.proposals.length}));
