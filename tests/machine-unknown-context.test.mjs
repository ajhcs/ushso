import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createStaticMachineToolkitRuntime } from '../worker/static-machine-toolkit-service.mjs';
import { createMachineToolkit } from '../packages/machine-toolkit/src/index.mjs';
const base=new URL('../packages/retrieval/versions/v1.2.0/corpus/',import.meta.url);
const corpus=JSON.parse(await fs.readFile(new URL('corpus.json',base),'utf8'));
const source=JSON.parse((await fs.readFile(new URL(corpus.record_files[0],base),'utf8')).trim().split('\n')[0]);
const records=['z','A','ä','Z','a'].map((title,i)=>({...source,title,record_id:`asset.test.${i}`}));
const catalog={corpus:{...corpus,source_slices:{[source.identity.source.source_id]:7}},records};
const runtime=createStaticMachineToolkitRuntime(catalog);
const toolkit=createMachineToolkit({service:runtime.operations,responseContext:runtime.context});
const filters={geography_ids:[],subject_ids:[],grain:[],access_classes:[],authority_levels:[],machine_readiness:[],time_period:null,negative_constraints:[],dimensions:[]};
const search={contract_version:'observatory.machine.search-assets.input.v1.0.0',mode:'browse',research_need:null,sort:'title_asc',filters,grouping:'none',limit:20,cursor:null,expected_generation:null};
test('release grouping is typed unknown, not silently asset grouping',async()=>{
 const response=await runtime.operations.searchAssets({...search,grouping:'release'});
 assert.equal(response.ok,false);assert.equal(response.error.code,'coverage_unknown');assert.equal(response.result_state,'unknown');assert.equal(response.result,null);
});
test('total ordering does not depend on locale collation',async()=>{
 const saved=String.prototype.localeCompare;String.prototype.localeCompare=()=>{throw new Error('locale used')};
 try{const response=await runtime.operations.searchAssets(search);assert.deepEqual(response.result.summaries.map(x=>x.title),['A','Z','a','z','ä']);}finally{String.prototype.localeCompare=saved;}
});
for(const [cap,contract] of [['get_access_plan','get-access-plan'],['get_retrieval_recipe','get-retrieval-recipe']])test(`${cap} rejects supplied and absent unverified contexts with safe contract`,async()=>{
 for(const value of [null,'unverified.test']){
  const failures=[];
  const r=await toolkit.invokeJsonApi(cap,{contract_version:`observatory.machine.${contract}.input.v1.0.0`,record_id:records[0].record_id,release_id:value,distribution_id:value,access_route_id:value,expected_generation:null},{onSafetyFailure:x=>failures.push(x)});
  assert.deepEqual(failures,[]);assert.equal(r.ok,false);assert.equal(r.error.code,'route_not_documented');assert.equal(r.result_state,'unknown');assert.equal(r.result,null);
 }
});
test('coverage count and digest describe same accepted membership, with exclusions explicit',async()=>{
 const r=await toolkit.invokeJsonApi('get_coverage_status',{contract_version:'observatory.machine.get-coverage-status.input.v1.0.0',geography_ids:[],subject_ids:[],source_classes:[],time_period:null,authority_levels:[],limit:25,cursor:null,expected_generation:null});
 assert.equal(r.ok,true,JSON.stringify(r.error));assert.equal(r.result.cells[0].denominator.count,5);assert.match(r.result.cells[0].interpretation,/2 excluded/);assert.doesNotMatch(r.result.federal_baseline.description,/completely enumerated/);assert.match(r.result.federal_baseline.description,/1 first-party/);
});

test('supplied schema identifiers do not establish dictionary applicability',async()=>{
 const r=await toolkit.invokeJsonApi('get_variables',{contract_version:'observatory.machine.get-variables.input.v1.0.0',record_id:records[0].record_id,release_id:'release.fake',distribution_id:'distribution.fake',schema_id:'schema.fake',semantic_query:null,filters:[],limit:25,cursor:null,expected_generation:null});
 assert.equal(r.ok,false);assert.equal(r.error.code,'schema_context_required');assert.equal(r.result_state,'unknown');assert.equal(r.result,null);
});
