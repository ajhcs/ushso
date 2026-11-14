import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const filters={geography_ids:[],subject_ids:[],grain:[],access_classes:[],authority_levels:[],machine_readiness:[],time_period:null,negative_constraints:[],dimensions:[]};
export async function checkWorkerRankingParity(base) {
 const receipts=[];
 const post=async(path,input)=>{const response=await fetch(`${base}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,200,path);return response.json();};
 for(const question of ['hospital finances in Pennsylvania','county life expectancy','Medicaid']) {
  const human=await post('/api/discover',{question,limit:5});
  const input={contract_version:'observatory.machine.search-assets.input.v1.0.0',mode:'search',research_need:question,filters,grouping:'none',limit:5,cursor:null,expected_generation:null};
  const machine=await post('/api/machine/v1/search-assets',input);
  const controlled=await post('/api/discovery-controls/v1/search',{contract_version:'ushso.controlled-discovery.input.v1',query:{question,limit:5},coverage_mode:'all'});
  assert.equal(controlled.contract_version,'ushso.controlled-discovery.result.v1');
  assert.deepEqual(controlled.discovery.results.map(row=>row.record_id),human.results.map(row=>row.record_id));
  for(let i=0;i<human.results.length;i++)assert.equal(controlled.discovery.results[i].metadata.freshness.freshness_state,human.results[i].metadata.freshness.freshness_state,'Controlled route must use the same current-clock freshness semantics.');
  assert.equal(machine.ok,true);assert.equal(machine.result.ranker_version,'observatory-canonical-ranking.v1.3.0');assert.ok(Object.values(machine.truth_boundary).every(value=>value===false));
  const ids=human.results.map(row=>row.record_id);assert.deepEqual(machine.result.summaries.map(row=>row.asset_id),ids,question);
  for(let i=0;i<human.results.length;i++) {const row=human.results[i],summary=machine.result.summaries[i];assert.equal(row.record_id,row.record.identity.asset.asset_id);assert.equal(summary.title,row.record.title.slice(0,2000));if(row.metadata.freshness.freshness_state==='overdue')assert.equal(summary.staleness_state,'stale','Historical current_verified must not override an overdue request-clock review.');if(row.match_state==='contextual'){assert.equal(summary.confidence,'low');assert.ok(summary.near_miss_reasons.some(reason=>/contextual.*unresolved/i.test(reason)));}}
  const family=await post('/api/machine/v1/search-assets',{...input,grouping:'family'});assert.equal(family.ok,true);assert.equal(family.result.summaries[0].asset_id,ids[0]);
  if(machine.next_cursor){const next=await post('/api/machine/v1/search-assets',{...input,cursor:machine.next_cursor,expected_generation:machine.index_generation});assert.equal(next.ok,true);assert.ok(next.result.summaries.every(row=>!ids.includes(row.asset_id)));}
  receipts.push({question,first_ids:ids,first_titles:human.results.map(row=>row.record.title),match_states:human.results.map(row=>row.match_state),human_freshness:human.results.map(row=>row.metadata.freshness.freshness_state),machine_staleness:machine.result.summaries.map(row=>row.staleness_state),family_first_id:family.result.summaries[0].asset_id});
 }
 const invalid=await fetch(`${base}/api/discovery-controls/v1/search`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contract_version:'ushso.controlled-discovery.input.v1',query:{question:'Medicaid',limit:5,cursor:'invalid-fixture'},coverage_mode:'all'})});assert.equal(invalid.status,409);const invalidBody=await invalid.json();assert.equal(invalidBody.restart_required,true);assert.equal(invalidBody.error.code,'invalid_cursor');
 return {status:'PASS',scope:'Actual local HTTP Worker; identical unfiltered first-page IDs, retained contextual classification, family-first and continuation checks.',queries:receipts};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await checkWorkerRankingParity(process.argv[2]??'http://127.0.0.1:8787'),null,2));
