import {digest,claimHash} from './claim-selector.mjs';
// In-memory review-only overlay using existing evidence/provenance fields.
// No files or canonical artifacts are written by this function.
export function buildReviewNotes({records,claims,generation,validateRecord,validateSemantics}) {
 if(typeof validateRecord!=='function'||typeof validateSemantics!=='function')throw Error('VALIDATORS_REQUIRED');
 const output=[],seen=new Set();
 for(const c of claims){
  if(seen.has(c.claim_id))throw Error('DUPLICATE_CLAIM');seen.add(c.claim_id);
  const original=records.get(c.record_id);
  if(!original||digest(original)!==c.baseline_record_sha256)throw Error('STALE_RECORD');
  if(c.generation!==generation||c.proposal_sha256!==claimHash(c))throw Error('STALE_CLAIM');
  if(c.field_path!=='/evidence/-'||c.promotion_policy!=='owner_scoped_note_only'||c.owner_decision!==null)throw Error('NOT_PENDING_NOTE');
  const candidate=structuredClone(original),provenance=[],pids=[];
  for(const s of c.sources){
   const p={provenance_id:'provenance:scientific-review:'+digest(s).slice(0,24),kind:'documentation',locator:s.url,observed_at:s.observed_at,capture_state:'captured_hashed',content_sha256:s.source_sha256};
   if(!pids.includes(p.provenance_id)){pids.push(p.provenance_id);provenance.push(p);}
  }
  const limitations=['REVIEW ONLY: owner scientific decision pending; not canonical publication.', 'No observation-period certification, measurement-unit assignment, row-key uniqueness, join validation or unrelated attached claim is approved.', ...Object.entries(c.proposed_value).filter(([k,v])=>k!=='text'&&typeof v==='string').map(([k,v])=>k+': '+v), ...c.sources.map(s=>'Passage: '+JSON.stringify(s.passage_locator)+(s.observed_at_scope?'; '+s.observed_at_scope:''))];
  const evidence={evidence_id:'evidence:scientific-review:'+c.proposal_sha256.slice(0,24),claim:c.proposed_value.text,state:'unresolved',provenance_ids:pids,limitations};
  if(candidate.evidence.some(e=>e.evidence_id===evidence.evidence_id))throw Error('DUPLICATE_EVIDENCE');
  candidate.provenance.push(...provenance);candidate.evidence.push(evidence);
  const errors=[...validateRecord(candidate),...validateSemantics(candidate)];if(errors.length)throw Error('INVALID_REVIEW_RECORD:'+JSON.stringify(errors));
  output.push({record_id:c.record_id,claim_id:c.claim_id,proposal_sha256:c.proposal_sha256,record:candidate,changes:[...provenance.map(p=>({path:'/provenance/-',before:null,after:p})),{path:'/evidence/-',before:null,after:evidence}],review_only:true,canonical_records_changed:0});
 }
 return output;
}
