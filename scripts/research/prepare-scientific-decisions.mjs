import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {digest,claimHash,selectClaims} from './claim-selector.mjs';
const [packetPath,corpusPath,out]=process.argv.slice(2);
if(!out)throw Error('Usage: node prepare-decisions.mjs conflicts-reviewed.json corpus-directory output-directory');
const packetBytes=await fs.readFile(packetPath),packet=JSON.parse(packetBytes),packetHash=createHash('sha256').update(packetBytes).digest('hex');
const corpus=JSON.parse(await fs.readFile(corpusPath+'/corpus.json')),records=new Map();
for(const file of corpus.record_files)for(const line of (await fs.readFile(corpusPath+'/'+file,'utf8')).trim().split('\n')){const r=JSON.parse(line);records.set(r.record_id,r);}
if(packet.generation!==corpus.publication.generation)throw Error('WRONG_GENERATION');
const texts={
 'SCI-04':'These files contain national, state and provider aggregates, not individual patient records. Home health uses calendar years; SNF and hospice use fiscal years. Counts should not be assumed to add across aggregation levels: suppression and beneficiary counting differ by level. These unadjusted data do not establish provider quality. Record uniqueness and suitability for linkage have not been verified by USHSO.',
 'SCI-05':'Dosage units depend on the drug and its lowest dispensable amount; they are not one shared physical unit across drugs. Mixed administration routes and flagged outliers can affect interpretation of spending per dosage unit. These fields alone do not establish comparable cross-drug prices or a valid conversion between unlike dosage units.'
};
const states={'SCI-01':'documentation_link_observation_field_applicability_unresolved','SCI-02':'conflicted_meaning_quarantined','SCI-03':'single_row_numeric_string_observation_not_transformation','SCI-04':'pending_owner_scoped_note','SCI-05':'pending_owner_descriptive_unit_note','SCI-06':'candidate_exact_name_relationships_not_canonical_binding'};
const claims=[],cards=[];
for(const [i,card] of packet.conflicts.entries()){
 const reviewCard={card_id:card.id,state:states[card.id],owner_decision:null,source_packet_sha256:packetHash,source_packet_pointer:'/conflicts/'+i,literal_evidence_preserved:true,missing_evidence:card.remaining,proposed_text:texts[card.id]??null,automatic_semantic_promotion:false};
 if(card.id==='SCI-06'){
  const reviewRoot=path.dirname(path.dirname(packetPath));
  reviewCard.original_artifacts=[];
  for(const relative of ['cms-grid-term-passages/18cb1ed2c5732c357a83eb321ed35b110aa0c2c828b087d777294b7bbcbebd71.json','pbj-schema-probe/comparison.json','pbj-schema-probe/csv-header-receipt.json','pbj-schema-probe/csv-header.txt']){
   const file=path.join(reviewRoot,relative),bytes=await fs.readFile(file);reviewCard.original_artifacts.push({file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
   if(relative.startsWith('cms-grid-term-passages/')){const value=JSON.parse(bytes);reviewCard.original_term_passages=value.term_passages;reviewCard.original_term_passage_count=value.term_passages.length;if(value.term_passages.some(p=>p.eligible_for_schema_promotion!==false||p.variable_name!==null))throw Error('PBJ_HOLD_BOUNDARY');}
  }
 }
 cards.push(reviewCard);
 if(!texts[card.id])continue;
 for(const affected of card.affected_records){
  const r=records.get(affected.record_id);if(!r)throw Error('RECORD_NOT_FOUND');
  const sources=card.id==='SCI-04'?[{source_sha256:'a2ba9f9ce3ada916ae894de6be4da68f45c60d92b1130bcd29a1e04f82fbd3d5',url:card.new_evidence[0].url,observed_at:card.new_evidence[0].captured_at,passage_locator:'methodology pages 5, 16, 17',packet_pointer:'/conflicts/'+i+'/new_evidence'}]:card.selected_source_bindings.filter(b=>b.record_id===r.record_id).flatMap(b=>b.passages.map(p=>({source_sha256:b.pdf_sha256,url:b.publisher_url,observed_at:packet.recorded_at,observed_at_scope:'review packet recording time; not independently authenticated publisher capture time',passage_locator:{page:p.page,variable:p.variable,row_bounds:p.row_bounds},literal_description_sha256:p.description_sha256})));
  const claim_id=card.id+':'+digest(r.record_id).slice(0,16)+':descriptive-note';
  const proposed_value={text:texts[card.id],state:'pending_owner_review',measurement_units:null,row_key_uniqueness:'unknown',join_compatibility:'unknown',...(card.id==='SCI-04'?{year_basis:r.title.includes('Home Health')?'calendar':'fiscal',suppression:'Each aggregation table is suppressed separately; detailed counts can differ from aggregate counts.',beneficiary_counting:'Distinct beneficiaries are counted separately at provider, state and national levels; a beneficiary may occur in more than one provider or state.'}:{physical_unit_per_drug:'unknown',cross_drug_conversion:'not_established'})};
  const c={claim_id,card_id:card.id,record_id:r.record_id,generation:packet.generation,baseline_record_sha256:digest(r),field_path:'/evidence/-',proposed_value,sources,source_packet_sha256:packetHash,source_packet_pointer:'/conflicts/'+i,promotion_policy:'owner_scoped_note_only',owner_decision:null};c.proposal_sha256=claimHash(c);claims.push(c);
 }
}
const manifest={schema:'ushso.claim-decisions.draft.v1',generation:packet.generation,source_packet_sha256:packetHash,owner_decision:null,claims,cards,canonical_records_changed:0,publication_authorized:false};
await fs.mkdir(out,{recursive:true});await fs.writeFile(out+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
const dry=selectClaims({claims,records,generation:packet.generation,sourceHashes:new Set(claims.flatMap(c=>c.sources.map(s=>s.source_sha256)))});
await fs.writeFile(out+'/dry-run.json',JSON.stringify({...dry,review_only_before_after:claims.map(c=>({claim_id:c.claim_id,record_id:c.record_id,path:c.field_path,before:null,proposed_after:c.proposed_value,proposal_sha256:c.proposal_sha256}))},null,2)+'\n');
console.log(JSON.stringify({claims:claims.length,cards:cards.length,selected:dry.selected.length,canonical_records_changed:0}));
