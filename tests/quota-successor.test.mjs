import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createStaticMachineToolkitRuntime } from '../worker/static-machine-toolkit-service.mjs';
import { createMachineToolkit, validateCanonicalCore } from '../packages/machine-toolkit/src/index.mjs';
import { createSuccessorValidators } from '../contracts/machine-toolkit/v1.1.0/tools/verify.mjs';
const record={record_id:'asset.test',title:'Test',identity:{source:{source_id:'cdc-socrata',name:'CDC'}},evidence:[{evidence_id:'evidence.test'}],authoritative_url:'https://data.cdc.gov/',freshness_verification:{metadata_observed_at:'2026-09-07T00:00:00Z',verification_status:'current_verified'}};
const runtime=createStaticMachineToolkitRuntime({records:[record],corpus:{corpus_version:'1',manifest_sha256:'a'.repeat(64),publication:{generation:'generation.test',observed_at:'2026-09-07T00:00:00Z'}}});
const input={contract_version:'observatory.machine.get-asset.input.v1.0.0',record_id:'asset.test',expected_generation:null,collection_limits:{releases:20,distributions:20,documentation:20,schemas:20},collection_cursors:{releases:null,distributions:null,documentation:null,schemas:null}};
test('successor success and domain errors expose explicit unknown quota, never fabricated counters',async()=>{
 const toolkit=createMachineToolkit({service:runtime.operations,responseContext:runtime.context});
 for(const id of ['asset.test','asset.missing']){
  const failures=[],r=await toolkit.invokeJsonApi('get_asset',{...input,record_id:id},{onSafetyFailure:x=>failures.push(x)});
  assert.deepEqual(failures,[]);assert.equal(r.tool_contract_version,'observatory-machine-toolkit.v1.1.0');
  assert.deepEqual(r.rate_limit,{state:'unknown',policy_id:null,limit:null,remaining:null,reset_at:null,retry_after_seconds:null});
  assert.equal(r.ok,id==='asset.test');
 }
});
test('versioned validator rejects unknown quota disguised as legacy and fabricated successor numbers',async()=>{
 const core=await runtime.operations.getAsset(input);
 const invalid=structuredClone(core);invalid.rate_limit.remaining=59;
 assert.ok(validateCanonicalCore(invalid,'get_asset',input).length>0);
 const legacy=structuredClone(core);legacy.tool_contract_version='observatory-machine-toolkit.v1.0.0';
 assert.ok(validateCanonicalCore(legacy,'get_asset',input).length>0);
 legacy.rate_limit={policy_id:'test.historical',limit:60,remaining:59,reset_at:'2026-09-07T01:00:00Z',retry_after_seconds:null};
 assert.deepEqual(validateCanonicalCore(legacy,'get_asset',input),[]);
});
test('all nine successor JSON schemas validate actual unknown-error envelopes',async()=>{
 const folder=new URL('../contracts/machine-toolkit/v1.1.0/schemas/',import.meta.url);
 const validators=await createSuccessorValidators({schemaDirectory:folder,dependencyRoot:new URL('../contracts/',import.meta.url)});
 const validate=validators.get('get_asset');
 const toolkit=createMachineToolkit({service:runtime.operations,responseContext:runtime.context});
 const response=await toolkit.invokeJsonApi('get_asset',input);assert.equal(validate(response),true,JSON.stringify(validate.errors));
 response.rate_limit.limit=60;assert.equal(validate(response),false);
 let schemas = 0;
 for (const name of await fs.readdir(folder)) {
  if (!name.endsWith('-response.schema.json')) continue;
  const capability = name.replace('-response.schema.json', '').replaceAll('-', '_');
  const check = validators.get(capability);
  const error = await toolkit.invokeJsonApi(capability, {});
  assert.equal(error.error.code, 'invalid_input'); assert.equal(error.rate_limit.state, 'unknown');
  assert.equal(check(error), true, `${name}: ${JSON.stringify(check.errors)}`); schemas++;
 }
 assert.equal(schemas, 9);
});
test('malformed input and safety fallback remain unknown even when response context is absent',async()=>{
 for (const responseContext of [runtime.context, undefined]) {
  const toolkit=createMachineToolkit({service:{...runtime.operations,getAsset:async()=>({invalid:true})},responseContext});
  for (const request of [{}, input]) {
   const r=await toolkit.invokeJsonApi('get_asset',request);
   assert.equal(r.tool_contract_version,'observatory-machine-toolkit.v1.1.0');
   assert.equal(r.rate_limit.state,'unknown');assert.equal(r.rate_limit.limit,null);assert.equal(r.rate_limit.remaining,null);assert.equal(r.rate_limit.reset_at,null);
   assert.equal(r.error.code,request===input?'service_unavailable':'invalid_input');
  }
 }
});
