import assert from 'node:assert/strict';

// Counts are independently qualified in the retained glyph-v2 extraction, not
// inferred from the API response or the package being checked.
const targets = [
 ['obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-14d8e-4cf4e59fb22f2fc8',59],
 ['obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-8889d-b7da45eac5932fb7',57],
 ['obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-95527-db64605090f37840',20]
];
export async function verifyResearchRelease(base, generation) {
 const records=[];
 for (const [recordId,expectedCount] of targets) {
  let cursor=null, count=0, pages=0;
  const cursors=new Set(), names=new Set();
  do {
   const url=new URL('/api/research/v1/dictionary-review',base);
   url.searchParams.set('record_id',recordId);url.searchParams.set('generation',generation);
   if(cursor) url.searchParams.set('cursor',cursor);
   const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
   assert.equal(response.status,200,recordId);
   assert.match(response.headers.get('cache-control')??'',/no-store/);
   const body=await response.json();assert.equal(body.error,null);
   const r=body.result;
   assert.equal(r.record_id,recordId);assert.equal(r.generation,generation);
   assert.equal(r.review_status,'pending_owner_review');
   assert.equal(r.publication_authorized,false);assert.equal(r.schema_applicability,'unresolved');
   assert.equal(r.scientific_approval,null);assert.equal(r.dictionary_completeness,'unknown');
   assert.equal(r.variable_count,expectedCount);assert.equal(r.result_state,'partial');
   assert.ok(Array.isArray(r.variables)&&r.variables.length>0&&r.variables.length<=50);
   assert.ok(r.evidence.length>0&&r.provenance.length>0);
   const evidenceIds=new Set(r.evidence.map(e=>e.evidence_id));
   for(const field of r.variables){
    assert.equal(typeof field.description,'string');assert.ok(field.description.trim().length>0,'qualified definition missing from summary');
    assert.equal(typeof field.name,'string');assert.ok(!names.has(field.name),'duplicate field name');names.add(field.name);
    assert.ok(field.evidence_ids.length>0&&field.evidence_ids.every(id=>evidenceIds.has(id)));
   }
   count+=r.variables.length;pages++;
   assert.ok(pages<=expectedCount,'pagination did not terminate within the qualified row bound');
   cursor=r.next_cursor;
   assert.equal(r.truncated,cursor!==null);
   if(cursor){assert.ok(!cursors.has(cursor),'repeated cursor');cursors.add(cursor);}
  } while(cursor);
  assert.equal(count,expectedCount);
  records.push({record_id:recordId,variables:count,pages});
 }
 const stale=new URL('/api/research/v1/dictionary-review',base);
 stale.searchParams.set('record_id',targets[0][0]);stale.searchParams.set('generation','unavailable-generation');
 const response=await fetch(stale,{signal:AbortSignal.timeout(15000)});
 assert.equal(response.status,410);assert.equal((await response.json()).error.code,'generation_unavailable');
 return {status:'PASS',records,total_variables:records.reduce((n,r)=>n+r.variables,0),schema_promotion:false};
}

// Frozen review packet expectations, independent of the response under test.
const scientificClaims = [["obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-43ef0-555c77a203217c07", "SCI-04:85c9d799474681b1:descriptive-note"], ["obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-eaed3-013864b159f2c352", "SCI-04:502442be2cedb6cf:descriptive-note"], ["obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-4e73f-f36c8ece4cb4fb38", "SCI-04:3fda959e2a27ce8c:descriptive-note"], ["obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-7e0b4-636464fc80e166b0", "SCI-05:a87644e30eebbe8c:descriptive-note"]];
const scientificConflicts = [["obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-0d9ee-afb8a976e1640e09", 1], ["obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-2935c-803422f6c6899cd6", 1], ["obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-43ef0-555c77a203217c07", 2], ["obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-4e73f-f36c8ece4cb4fb38", 1], ["obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-b4974-fc0d967128f4893a", 81], ["obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-c37eb-776f448a0d0d0540", 2], ["obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-eaed3-013864b159f2c352", 2]];

async function pendingReview(base, route, query) {
 const url=new URL('/api/research/v1/'+route,base);
 for(const [key,value] of Object.entries(query))url.searchParams.set(key,String(value));
 const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
 assert.equal(response.status,200,url.pathname);assert.match(response.headers.get('cache-control')??'',/no-store/);
 const body=await response.json();assert.equal(body.error,null);
 assert.equal(body.result.owner_decision,null);assert.equal(body.result.publication_authorized,false);
 assert.equal(body.result.canonical_records_changed,0);return body.result;
}
export async function verifyScientificReviewRelease(base,generation) {
 for(const [record_id,claimId] of scientificClaims){
  const result=await pendingReview(base,'scientific-review',{record_id,generation});
  assert.equal(result.record_id,record_id);assert.equal(result.generation,generation);
  assert.deepEqual(result.claims.map(row=>row.claim.claim_id),[claimId]);
  for(const row of result.claims){assert.equal(row.claim.owner_decision,null);assert.equal(row.claim.proposed_value.state,'pending_owner_review');assert.ok(row.passages.length>0);}
 }
 let total=0;
 for(const [record_id,expected] of scientificConflicts){
  let page=0,manifest_sha256=null,count=0;const ids=new Set();
  do{
   const query={record_id,generation,page};if(manifest_sha256)query.manifest_sha256=manifest_sha256;
   const result=await pendingReview(base,'scientific-conflicts',query);
   assert.equal(result.record_id,record_id);assert.equal(result.generation,generation);
   assert.equal(result.page,page);assert.equal(result.row_count,expected);assert.equal(result.review_status,'pending_owner_review');
   if(manifest_sha256)assert.equal(result.manifest_sha256,manifest_sha256);else manifest_sha256=result.manifest_sha256;
   for(const row of result.rows){assert.ok(!ids.has(row.preview_id));ids.add(row.preview_id);assert.equal(row.owner_decision,null);assert.equal(row.publication_authorized,false);assert.equal(row.eligible_for_schema_promotion,false);}
   count+=result.rows.length;assert.ok(count<=expected);assert.ok(result.rows.length>0);
   assert.ok(result.next_page===null||result.next_page===page+1);page=result.next_page;
  }while(page!==null);
  assert.equal(count,expected);total+=count;
 }
 return {status:'PASS',claims:scientificClaims.length,conflict_rows:total,scientific_approval:false};
}
