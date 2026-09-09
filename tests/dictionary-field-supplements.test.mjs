import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { packageFieldSupplement } from '../scripts/research/dictionary-field-supplements.mjs';
import { dictionaryReviewPage } from '../worker/dictionary-review-store.mjs';
import { createMachineCursorSigner } from '../worker/machine-cursor.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
async function fixture(t) {
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ushso-field-supplement-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const fields=[{name:'large_concept',evidence_ids:['ev.a'],publisher_concept:'日😀é'.repeat(18000),description:null,unit:null},
  {name:'large_enum',evidence_ids:['ev.a'],allowed_values:Array.from({length:12000},(_,i)=>`${i}:文字😀`),publisher_value_labels:{'é':'Literal'},unit:null}];
 const supplements=[];for(const field of fields)supplements.push(await packageFieldSupplement(field,directory));
 const record={record_id:'asset.test'},generation='generation.test';
 const descriptor={format:'ushso.dictionary-review.v1',record_id:record.record_id,generation,baseline_record_sha256:hash(JSON.stringify(record)),source_proposal_sha256:'a'.repeat(64),review_status:'pending_owner_review',publication_authorized:false,schema_applicability:'unresolved',pages:[],variable_count:0,isolated_fields:[],supplements:supplements.map(x=>x.binding),evidence:[{evidence_id:'ev.a',provenance_ids:['pv.a']}],provenance:[{provenance_id:'pv.a'}],limitations:['pending']};
 const body=JSON.stringify(descriptor),manifest=JSON.stringify({format:'ushso.dictionary-review-package.v1',generation,review_status:'pending_owner_review',publication_authorized:false,records:[{record_id:record.record_id,sha256:hash(body)}]});
 const assets={fetch:async request=>{const file=new URL(request.url).pathname.replace('/research-dictionaries-v1/','');return new Response(file==='manifest.json'?manifest:file.startsWith('records/')?body:await fs.readFile(path.join(directory,file)));}};
 return {directory,fields,supplements,options:{assets,origin:'https://review.test',record,generation,packageManifestSha256:hash(manifest),cursorSigner:createMachineCursorSigner({signingKey:'test-only-large-field-supplement-signing-key'})}};
}
test('large concepts and enums reassemble byte-exactly across multibyte boundaries',async t=>{
 const {fields,supplements,options}=await fixture(t);
 for(let i=0;i<fields.length;i++){
  let cursor=null,index=0;const chunks=[];
  do{const r=await dictionaryReviewPage({...options,field:supplements[i].binding.field_sha256,cursor});
   assert.equal(r.fragment.index,index++);assert.equal(r.publication_authorized,false);assert.equal(r.field_completeness,'partial');assert.ok(Buffer.byteLength(JSON.stringify(r))<128*1024);
   chunks.push(Buffer.from(r.fragment.data,'base64'));cursor=r.next_cursor;
  }while(cursor);
  const bytes=Buffer.concat(chunks);assert.equal(hash(bytes),supplements[i].binding.field_sha256);assert.equal(bytes.length,supplements[i].stub.supplement.total_bytes);
  assert.deepEqual(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),fields[i]);assert.equal(index,supplements[i].stub.supplement.fragment_count);
 }
});
test('cursors cannot cross fields or switch from supplement to normal listing',async t=>{
 const {supplements,options}=await fixture(t),a=supplements[0].binding.field_sha256,b=supplements[1].binding.field_sha256;
 const first=await dictionaryReviewPage({...options,field:a});assert.ok(first.next_cursor);
 await assert.rejects(dictionaryReviewPage({...options,field:b,cursor:first.next_cursor}),/MACHINE_CURSOR_RESTART_REQUIRED/);
 await assert.rejects(dictionaryReviewPage({...options,cursor:first.next_cursor}),/MACHINE_CURSOR_RESTART_REQUIRED/);
});
test('fragment substitution and unpinned fields fail closed',async t=>{
 const {supplements,options}=await fixture(t),field=supplements[0].binding.field_sha256;
 const bad={fetch:async request=>{const response=await options.assets.fetch(request);const text=await response.text();return new Response(JSON.parse(text).encoding==='base64'?text+' ':text);}};
 await assert.rejects(dictionaryReviewPage({...options,assets:bad,field}),/dictionary_hash_mismatch/);
 await assert.rejects(dictionaryReviewPage({...options,field:'b'.repeat(64)}),/dictionary_field_unavailable/);
});
