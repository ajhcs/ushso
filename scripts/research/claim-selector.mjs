import {createHash} from 'node:crypto';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function claimHash(claim) {
  const {proposal_sha256, owner_decision, promotion_class, literal_observation, class: _class, inferred, literal, publisher_metadata, current_field_hash, field_hash, ...subject} = claim;
  return digest(subject);
}
export function fieldHash(claim) {
  return digest({record_id: claim.record_id, field_path: claim.field_path, generation: claim.generation, proposed_value: claim.proposed_value});
}
// Produces builder inputs only. It never mutates a record or authenticates an owner.
// verifyAuthorization must be supplied by the repository's verified-owner workflow.
export function selectClaims({claims, decisions=[], records, generation, sourceHashes, verifyAuthorization=()=>false, completeSourceRun=true}) {
  const selected=[], excluded=[];
  const seen=new Set(), decisionIds=new Set();
  if (completeSourceRun !== true) {
    for (const c of claims) excluded.push({claim_id:c.claim_id,reason:'INCOMPLETE_SOURCE_RUN'});
    return {selected,excluded,canonical_records_changed:0,publication_authorized:false};
  }
  for(const d of decisions) {if(decisionIds.has(d.claim_id)) throw Error('DUPLICATE_DECISION');decisionIds.add(d.claim_id);}
  for(const c of claims) {
    if(seen.has(c.claim_id)) throw Error('DUPLICATE_CLAIM'); seen.add(c.claim_id);
    let reason=null;
    const record=records.get(c.record_id), d=decisions.find(x=>x.claim_id===c.claim_id);
    if(c.proposal_sha256!==claimHash(c)) reason='STALE_PROPOSAL';
    else if(c.generation!==generation) reason='WRONG_GENERATION';
    else if(!record || digest(record)!==c.baseline_record_sha256) reason='STALE_RECORD';
    else if(!Array.isArray(c.sources)||!c.sources.length||c.sources.some(s=>!sourceHashes.has(s.source_sha256)||!s.passage_locator)) reason='SOURCE_BINDING';
    else if(c.field_path!=='/evidence/-' && c.promotion_class !== 'literal_publisher_metadata') reason='FIELD_NOT_ALLOWED';
    else if(c.promotion_policy!=='owner_scoped_note_only' && c.promotion_class !== 'literal_publisher_metadata') reason='SEMANTIC_HOLD';
    else if(!d || d.decision!=='approved') reason='UNAPPROVED';
    else if(d.proposal_sha256!==c.proposal_sha256) reason='STALE_APPROVAL';
    else if(c.field_hash && d.field_hash && c.field_hash!==d.field_hash) reason='CHANGED_FIELD_HASH';
    else if(verifyAuthorization(d)!==true) reason='OWNER_AUTHORIZATION_UNVERIFIED';
    if(reason) excluded.push({claim_id:c.claim_id,reason});
    else selected.push({claim_id:c.claim_id,record_id:c.record_id,field_path:c.field_path,before:null,after:structuredClone(c.proposed_value),proposal_sha256:c.proposal_sha256,sources:structuredClone(c.sources)});
  }
  for(const d of decisions)if(!seen.has(d.claim_id))excluded.push({claim_id:d.claim_id,reason:'UNKNOWN_CLAIM'});
  return {selected,excluded,canonical_records_changed:0,publication_authorized:false};
}
