import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {buildReviewNotes} from './review-note-builder.mjs';
const [repo,draftPath,out]=process.argv.slice(2);
if(!out)throw Error('Usage: node verify-preview.mjs repository draft-directory output-directory');
const {browserRecordErrors}=await import(pathToFileURL(repo+'/packages/retrieval/tools/catalog-contract.mjs'));
const {semanticErrors}=await import(pathToFileURL(repo+'/packages/retrieval/tools/record-semantics.mjs'));
const {createStaticMachineToolkitRuntime}=await import(pathToFileURL(repo+'/worker/static-machine-toolkit-service.mjs'));
const corpusPath=repo+'/packages/retrieval/versions/v1.2.0/corpus',corpus=JSON.parse(await fs.readFile(corpusPath+'/corpus.json')),records=new Map();
for(const file of corpus.record_files)for(const line of (await fs.readFile(corpusPath+'/'+file,'utf8')).trim().split('\n')){const r=JSON.parse(line);records.set(r.record_id,r);}
const draft=JSON.parse(await fs.readFile(draftPath+'/manifest.json'));
const preview=buildReviewNotes({records,claims:draft.claims,generation:corpus.publication.generation,validateRecord:browserRecordErrors,validateSemantics:semanticErrors});
const runtime=createStaticMachineToolkitRuntime({corpus,records:[...records.values()]});
const responses=[];
for(const p of preview){
 const canonical=await runtime.operations.getAsset({record_id:p.record_id,expected_generation:corpus.publication.generation,collection_cursors:{}});
 if(JSON.stringify(canonical).includes(p.proposal_sha256))throw Error('CANONICAL_PREVIEW_LEAK');
 responses.push({canonical_response:canonical,review_only_overlay:{schema:'ushso.scientific-note-preview.v1',claim_id:p.claim_id,record_id:p.record_id,generation:corpus.publication.generation,proposal_sha256:p.proposal_sha256,owner_decision:null,canonical_publication:false,proposed_evidence:p.changes.at(-1).after,proposed_provenance:p.changes.slice(0,-1).map(c=>c.after)}});
}
const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Scientific note review — not publication</title><style>body{font:18px system-ui;max-width:900px;margin:2rem auto;padding:1rem}article{border:1px solid #777;padding:1rem;margin:1rem 0}code{overflow-wrap:anywhere}li{margin:.5rem 0}</style><h1>Scientific note review</h1><p>Review-only evidence dossier preview. No owner approval, canonical catalog change, or deployment. This standalone preview uses the existing evidence/provenance representation; it is not the deployed detail page.</p>'+preview.map(p=>{const e=p.changes.at(-1).after;return '<article><h2>'+escape(p.record.title)+'</h2><code>'+escape(p.claim_id)+'</code><h3>Proposed evidence note — unresolved</h3><p>'+escape(e.claim)+'</p><ul>'+e.limitations.map(l=>'<li>'+escape(l)+'</li>').join('')+'</ul><p>Proposal SHA-256: <code>'+p.proposal_sha256+'</code></p></article>';}).join('')+'<h2>Other claim states remain unresolved</h2><ul>'+draft.cards.filter(c=>!['SCI-04','SCI-05'].includes(c.card_id)).map(c=>'<li>'+escape(c.card_id+': '+c.state+' — '+c.missing_evidence)+'</li>').join('')+'</ul></html>';
await fs.mkdir(out,{recursive:true});
await fs.writeFile(out+'/review-records.json',JSON.stringify(preview,null,2));
await fs.writeFile(out+'/machine-preview.json',JSON.stringify(responses,null,2));
await fs.writeFile(out+'/index.html',html);
const report={recorded_at:new Date().toISOString(),records_validated:preview.length,validators:['browserRecordErrors','semanticErrors'],canonical_service_responses:responses.length,canonical_records_changed:0,owner_decisions_recorded:0,canonical_claim_leakage:0,preview_is_standalone_not_deployed_detail_page:true,review_overlay_is_not_canonical_machine_envelope:true};
await fs.writeFile(out+'/verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
