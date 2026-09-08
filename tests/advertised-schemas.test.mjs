import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {verifyAdvertisedSchemas} from '../scripts/verify-advertised-schemas.mjs';
import {createStaticMachineToolkitRuntime} from '../worker/static-machine-toolkit-service.mjs';
import {createMachineToolkit} from '../packages/machine-toolkit/src/index.mjs';
const root=new URL('../',import.meta.url);
const discovery=JSON.parse(await fs.readFile(new URL('packages/machine-toolkit/public-webmcp-tool.json',root)));
const {createBrowserMachineToolkitClient}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(await fs.readFile(new URL('apps/web/src/providers/machineToolkitClient.ts',root),'utf8'))).toString('base64'));
const localFetch=async url=>new Response(await fs.readFile(new URL(new URL(url).pathname.slice(1),root)),{headers:{'content-type':'application/json'}});
test('advertised schemas compile without network and validate all actual typed errors plus success',async()=>{
 const check=await verifyAdvertisedSchemas('http://localhost',discovery,localFetch);
 const runtime=createStaticMachineToolkitRuntime({records:[{record_id:'asset.test',title:'Test',identity:{source:{source_id:'cdc-socrata',name:'CDC'}},evidence:[{evidence_id:'evidence.test'}],authoritative_url:'https://data.cdc.gov/',freshness_verification:{metadata_observed_at:'2026-09-07T00:00:00Z',verification_status:'current_verified'}}],corpus:{corpus_version:'1',manifest_sha256:'a'.repeat(64),publication:{generation:'generation.test',observed_at:'2026-09-07T00:00:00Z'}}});
 const toolkit=createMachineToolkit({service:runtime.operations,responseContext:runtime.context});
 for(const tool of discovery.tools){const value=await toolkit.invokeJsonApi(tool.capability,{});assert.equal(value.error.code,'invalid_input');check.validate(tool.capability,value);
  const client=createBrowserMachineToolkitClient(async()=>Response.json(value));
  assert.deepEqual(await client.invokeWebMcp(tool.capability,{record_id:'asset.test'}),value);
 }
 const value=await toolkit.invokeJsonApi('get_asset',{contract_version:'observatory.machine.get-asset.input.v1.0.0',record_id:'asset.test',expected_generation:null,collection_limits:{releases:20,distributions:20,documentation:20,schemas:20},collection_cursors:{releases:null,distributions:null,documentation:null,schemas:null}});
 assert.equal(value.ok,true);check.validate('get_asset',value);assert.equal(check.legacy(value),false,'strict old consumers must reject successor');
 const client=createBrowserMachineToolkitClient(async()=>Response.json(value));
 assert.deepEqual(await client.invokeWebMcp('get_asset',{record_id:'asset.test'}),value);
 for(const version of ['observatory-machine-toolkit.v1.0.0','future']) await assert.rejects(createBrowserMachineToolkitClient(async()=>Response.json({...value,tool_contract_version:version})).invokeWebMcp('get_asset',{record_id:'asset.test'}),/UNSUPPORTED_RESPONSE_VERSION/);
});
test('missing advertised schema disguised by successful SPA HTML fails',async()=>{
 await assert.rejects(verifyAdvertisedSchemas('http://localhost',discovery,async url=>new URL(url).pathname===discovery.tools[0].response_schema?new Response('<html>SPA</html>',{headers:{'content-type':'text/html'}}):localFetch(url)),/SCHEMA_NOT_JSON/);
});
test('incorrect schema identity fails despite JSON and HTTP200',async()=>{
 await assert.rejects(verifyAdvertisedSchemas('http://localhost',discovery,async url=>new URL(url).pathname===discovery.tools[0].response_schema?Response.json({$id:'https://ushso.org/wrong.json'}):localFetch(url)),/SCHEMA_ID_MISMATCH/);
});
