import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { R2CaptureProtocol as PrototypeCaptureProtocol } from './capture-protocol.prototype-bound.mjs';
import { R2CaptureProtocol as OriginalCaptureProtocol } from 'file:///mnt/d/worktrees/plumbob/ushso-research-program-20260910/packages/connectors/src/capture-protocol.mjs';
import { makeFixtureDescriptor, makeHarness, jsonResponse } from 'file:///mnt/d/worktrees/plumbob/ushso-research-program-20260910/packages/connectors/src/testing/fixtures.mjs';
import { DcatDataJsonConnector } from 'file:///mnt/d/worktrees/plumbob/ushso-research-program-20260910/packages/connectors/src/adapters/dcat-data-json.mjs';
import { compileManifestRequest, redactedLocator, validateDescriptor } from 'file:///mnt/d/worktrees/plumbob/ushso-research-program-20260910/packages/connectors/src/route-manifest.mjs';
import { connectorRequestKey } from 'file:///mnt/d/worktrees/plumbob/ushso-research-program-20260910/packages/connectors/src/runner.mjs';
import { validateIngestionRecord } from 'file:///mnt/d/worktrees/plumbob/ushso-research-program-20260910/contracts/ingestion/v1.0.0/tools/index.mjs';

// Explicit prototype binding: only the injected capture protocol uses candidate
// bytes. Client, runner, route compiler, stores and released validator are exact
// pinned baseline modules; no behavior is patched into the adapter or validator.
const OBS='2026-09-12T12:00:00.000Z';
const BASE='https://catalog.example.gov/data.json';
const observations={format:'ushso.capture-public-locator-prototype-observations.v1',external_fetch_calls:0,cases:{}};
const originalFetch=globalThis.fetch;
globalThis.fetch=()=>{observations.external_fetch_calls++;throw new Error('LIVE_FETCH_FORBIDDEN_IN_OFFLINE_PROTOTYPE');};
const descriptor=validateDescriptor(makeFixtureDescriptor({maximumPages:2,maximumResponseBytes:4096,maximumDecompressedBytes:4096,maximumRedirects:0,redirectPolicy:'deny'}));
const request=(query={})=>({endpointId:'endpoint_fixture_catalog',templateId:'route_fixture_catalog',purpose:'catalog_metadata',method:'GET',targetClass:'collection',pathParameters:{},query});
function harness({prototype=true,strict=true,clock=()=>new Date(OBS)}={}) {
  const h=makeHarness({descriptor,clock});h.validationResults=[];h.fetches=[];
  const originalCommit=h.referenceStore.commit.bind(h.referenceStore);
  h.referenceStore.commit=async reference=>{
    const result=await validateIngestionRecord('capture-reference.schema.json',reference);
    h.validationResults.push({reference:structuredClone(reference),validation:result});
    if(strict&&!result.valid)throw Object.assign(new Error('STRICT_CAPTURE_REFERENCE_REJECTED'),{code:'STRICT_CAPTURE_REFERENCE_REJECTED'});
    return originalCommit(reference);
  };
  h.captureProtocol=new (prototype?PrototypeCaptureProtocol:OriginalCaptureProtocol)({objectStore:h.objectStore,referenceStore:h.referenceStore,clock});
  h.client.captureProtocol=h.captureProtocol;
  const execute=h.client.execute.bind(h.client);
  h.client.execute=async context=>{
    const result=await execute(context);h.fetches.push(structuredClone(result));
    if(result.metadataFetch)assert.deepEqual(await validateIngestionRecord('metadata-fetch.schema.json',result.metadataFetch),{valid:true,issues:[]});
    return result;
  };
  h.connector=new DcatDataJsonConnector({descriptor,endpointId:'endpoint_fixture_catalog',templateId:'route_fixture_catalog'});
  return h;
}
function twoPages(h){
  h.transport.add('GET',BASE,jsonResponse({dataset:[{identifier:'fixture-a',title:'Fixture A',modified:'2026-09-10T00:00:00.000Z'}],next_cursor:'page-2'},{etag:'"fixture-page-1"'}));
  h.transport.add('GET',BASE+'?cursor=page-2',jsonResponse({dataset:[{identifier:'fixture-b',title:'Fixture B',modified:'2026-09-11T00:00:00.000Z'}]},{etag:'"fixture-page-2"'}));
}
async function execute(h,q={},runId='run_locator_capture',jobId='job_locator_capture'){
  return h.client.execute({descriptor,runId,jobId,request:request(q),responseProfile:h.connector.responseProfile()});
}
async function oneCapture(prototype,q={}){
  const h=harness({prototype,strict:Object.keys(q).length===0});
  const url=compileManifestRequest(descriptor,request(q)).url.href;
  h.transport.add('GET',url,jsonResponse({dataset:[{identifier:'same',title:'Same'}]}));
  const result=await execute(h,q);assert.equal(result.outcome,'captured');return {h,result};
}

test('original two-page fixture retains its actual strict public-query contract failure',async()=>{
  const h=harness({prototype:false});twoPages(h);
  const run=await h.runner.run({connector:h.connector,runId:'run_original_two_page',scheduledSlot:OBS,mode:'full_membership'});
  assert.equal(run.outcome,'partial_unpublished');assert.equal(run.checkpointCommitted,false);
  assert.equal(h.transport.calls.length,2);assert.equal(h.referenceStore.references.size,1);
  const rejected=h.validationResults.filter(entry=>!entry.validation.valid);
  assert.equal(rejected.length,1);assert.ok(rejected[0].validation.issues.some(issue=>issue.code==='CAPTURE_LOCATOR_SECRET_RISK'));
  assert.equal(rejected[0].reference.source_locator.redacted_locator,BASE+'?cursor=page-2');
  observations.cases.original_failure={run_outcome:run.outcome,checkpoint_committed:run.checkpointCommitted,reference:rejected[0].reference,validation:rejected[0].validation,fixture_deliveries:h.transport.calls.length};
});

test('prototype completes the real two-page runner with strict capture and checkpoint records',async()=>{
  const h=harness();twoPages(h);
  const run=await h.runner.run({connector:h.connector,runId:'run_prototype_two_page',scheduledSlot:OBS,mode:'full_membership'});
  assert.equal(run.outcome,'succeeded');assert.equal(run.checkpointCommitted,true);assert.equal(run.seal.pagesCommitted,2);
  assert.deepEqual(run.seal.observations.map(x=>x.nativeId),['fixture-a','fixture-b']);
  assert.deepEqual(await validateIngestionRecord('checkpoint.schema.json',run.checkpoint),{valid:true,issues:[]});
  assert.equal(h.referenceStore.references.size,2);assert.ok(h.validationResults.every(x=>x.validation.valid));
  assert.deepEqual([...h.referenceStore.references.values()].map(x=>x.source_locator.redacted_locator),[BASE,BASE]);
  assert.deepEqual(h.requestLedger.records.map(x=>x.redacted_locator),[BASE,BASE+'?cursor=page-2']);
  observations.cases.prototype_two_page={outcome:run.outcome,checkpoint_committed:run.checkpointCommitted,fixture_deliveries:h.transport.calls.length,captures:[...h.referenceStore.references.values()],request_ids:h.requestLedger.records.map(x=>x.request_id),request_locators:h.requestLedger.records.map(x=>x.redacted_locator)};
});

test('same body and clocks retain distinct query-sensitive capture and request identities',async()=>{
  const proto=harness();const original=harness({prototype:false,strict:false});const values=['page-2','page-3'];
  for(const h of [proto,original])for(const cursor of values)h.transport.add('GET',BASE+'?cursor='+cursor,jsonResponse({dataset:[{identifier:'same',title:'Same'}]}));
  const candidate=[];const baseline=[];
  for(const cursor of values){candidate.push((await execute(proto,{cursor},'run_identity_equal','job_identity_equal')).capture);baseline.push((await execute(original,{cursor},'run_identity_equal','job_identity_equal')).capture);}
  assert.equal(candidate[0].raw_sha256,candidate[1].raw_sha256);assert.deepEqual(candidate[0].clocks,candidate[1].clocks);
  assert.notEqual(candidate[0].capture_ref_id,candidate[1].capture_ref_id);
  assert.deepEqual(candidate.map(x=>x.capture_ref_id),baseline.map(x=>x.capture_ref_id));
  assert.deepEqual(proto.requestLedger.records.map(x=>x.request_id),original.requestLedger.records.map(x=>x.request_id));
  assert.notEqual(proto.requestLedger.records[0].request_id,proto.requestLedger.records[1].request_id);
  assert.equal(proto.objectStore.objects.size,1);assert.equal(proto.referenceStore.references.size,2);
  assert.equal(connectorRequestKey(request({cursor:'page-2'}))===connectorRequestKey(request({cursor:'page-3'})),false);
  assert.equal(redactedLocator(BASE+'?cursor=page-2'),BASE+'?cursor=page-2');
  observations.cases.query_identity={capture_ids:candidate.map(x=>x.capture_ref_id),baseline_capture_ids:baseline.map(x=>x.capture_ref_id),request_ids:proto.requestLedger.records.map(x=>x.request_id),one_body_object:proto.objectStore.objects.size,public_locators:candidate.map(x=>x.source_locator.redacted_locator)};
});

test('wrong final query remains rejected before object or reference writes',async()=>{
  for(const prototype of [false,true]){
    const h=harness({prototype});const compiled=compileManifestRequest(descriptor,request({cursor:'page-2'}));
    await assert.rejects(h.captureProtocol.capture({descriptor,runId:'run_wrong_final',compiledRequest:compiled,finalUrl:BASE+'?cursor=page-3',headers:new Headers({'content-type':'application/json'}),bodyBytes:new TextEncoder().encode('{}'),observedAt:OBS}),error=>error.safeDetailCode==='CAPTURE_FINAL_URL_MISMATCH');
    assert.equal(h.objectStore.putCalls.length,0);assert.equal(h.referenceStore.commitCalls.length,0);
  }
  observations.cases.wrong_final_query={baseline_and_prototype:'CAPTURE_FINAL_URL_MISMATCH',writes:0};
});

test('no-query capture reference and request ledger are byte-value unchanged',async()=>{
  const a=await oneCapture(false);const b=await oneCapture(true);
  assert.deepEqual(b.result,a.result);assert.deepEqual(b.h.requestLedger.records,a.h.requestLedger.records);
  observations.cases.no_query={reference_equal:true,fetch_equal:true,ledger_equal:true,capture_id:b.result.capture.capture_ref_id};
});

test('public projection contains no userinfo, query or fragment without changing query-sensitive identity',async()=>{
  const h=harness();const compiled=compileManifestRequest(descriptor,request({cursor:'page-2'}));
  const reference=await h.captureProtocol.capture({descriptor,runId:'run_public_projection',compiledRequest:compiled,finalUrl:'https://fixture-user:fixture-value@catalog.example.gov/data.json?cursor=page-2#fixture-fragment',headers:new Headers({'content-type':'application/json'}),bodyBytes:new TextEncoder().encode('{}'),observedAt:OBS});
  assert.equal(reference.source_locator.redacted_locator,BASE);
  assert.deepEqual(await validateIngestionRecord('capture-reference.schema.json',reference),{valid:true,issues:[]});
  observations.cases.public_projection={locator:reference.source_locator.redacted_locator,strict_valid:true,scope:'direct protocol projection with synthetic strings; no transport'};
});

test('released strict validator still rejects a tampered query-bearing public reference',async()=>{
  const {result}=await oneCapture(true);const tampered=structuredClone(result.capture);tampered.source_locator.redacted_locator=BASE+'?cursor=page-2';
  const check=await validateIngestionRecord('capture-reference.schema.json',tampered);
  assert.equal(check.valid,false);assert.ok(check.issues.some(x=>x.code==='CAPTURE_LOCATOR_SECRET_RISK'));
  observations.cases.tampered_public_query=check;
});

test('two-page 304 reuse still uses full request keys and original capture references',async()=>{
  const h=harness();twoPages(h);const firstId='run_before_304';const nextId='run_after_304';
  const first=await h.runner.run({connector:h.connector,runId:firstId,scheduledSlot:OBS,mode:'full_membership'});assert.equal(first.outcome,'succeeded');
  const refsBefore=structuredClone([...h.referenceStore.references.values()]);const pages=[...h.runRepository.runs.get(firstId).pages.values()];
  for(const page of pages){
    assert.equal(page.pageKey,connectorRequestKey(page.request));
    const ref=h.referenceStore.references.get(page.captureRefId);
    h.runRepository.setConditional(nextId,page.pageKey,{validators:{etag:ref.safe_response_headers.etag},priorCaptureRefId:ref.capture_ref_id});
    h.transport.add('GET',compileManifestRequest(descriptor,page.request).url.href,jsonResponse(null,{status:304,bodyBytes:'',contentLength:0}));
  }
  const second=await h.runner.run({connector:h.connector,runId:nextId,scheduledSlot:OBS,mode:'full_membership',checkpoint:first.checkpoint});
  assert.equal(second.outcome,'succeeded');assert.equal(second.seal.pagesCommitted,2);
  assert.deepEqual([...h.referenceStore.references.values()],refsBefore);assert.equal(h.referenceStore.commitCalls.length,2);
  const reused=h.fetches.slice(2);assert.equal(reused.length,2);
  assert.ok(reused.every(x=>x.outcome==='not_modified'&&x.capture===null&&x.bodyBytes===null&&x.metadataFetch.response_bytes===0&&x.metadataFetch.decompressed_bytes===0));
  assert.deepEqual(reused.map(x=>x.metadataFetch.reused_capture_ref_id),pages.map(x=>x.captureRefId));
  assert.ok([...h.referenceStore.references.values()].every(x=>x.run_id===firstId));
  assert.deepEqual(second.seal.observations,first.seal.observations);
  observations.cases.reuse_304={outcome:second.outcome,prior_capture_ids:pages.map(x=>x.captureRefId),reused_capture_ids:reused.map(x=>x.metadataFetch.reused_capture_ref_id),references_unchanged:true,total_fixture_deliveries:h.transport.calls.length,new_capture_commits:0,new_response_bytes:0,full_request_keys:pages.map(x=>x.pageKey)};
});

after(async()=>{globalThis.fetch=originalFetch;assert.equal(observations.external_fetch_calls,0);await writeFile(new URL('./observations.json',import.meta.url),JSON.stringify(observations,null,2)+'\n');});
