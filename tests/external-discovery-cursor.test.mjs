import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createExternalDiscoveryCursor} from '../worker/external-discovery-cursor.mjs';
import {createMachineCursorSigner} from '../worker/machine-cursor.mjs';
import {createWorker} from '../worker/index.mjs';
import {createRetrievalEngine} from '../packages/retrieval/tools/retrieval-core-v1.2.mjs';
const key='synthetic-test-only-dedicated-key-not-production-123456';
const route='POST /api/discover',input={question:'synthetic private query',limit:1};
const inner=Buffer.from(JSON.stringify({v:1,generation:'g',signature:'offline-guessable-stable-digest',offset:1})).toString('base64url');
const generation='g';
const fails=(promise,code)=>assert.rejects(promise,error=>error.code===code&&error.restart_required===true);

test('opaque external cursor authenticates all bytes and hides internal query digest/offset',async()=>{
 const signer=createExternalDiscoveryCursor({signingKey:key}),token=await signer.seal(inner,input,route,generation);
 assert.equal(await signer.open(token,input,route),inner);
 assert.ok(!token.includes(input.question));assert.ok(!token.includes('offline-guessable'));assert.notEqual(token,await signer.seal(inner,input,route,generation));
 const parts=token.split('.');assert.equal(parts.length,4);assert.equal(parts[0],'v2');
 for(const index of [1,2,3]){const changed=[...parts];changed[index]=(changed[index][0]==='A'?'B':'A')+changed[index].slice(1);await fails(signer.open(changed.join('.'),input,route),'invalid_cursor');}
 const edited=Buffer.from(JSON.stringify({v:1,generation:'g',signature:'offline-guessable-stable-digest',offset:9000})).toString('base64url');
 await fails(signer.open(edited,input,route),'invalid_cursor');
 await fails(signer.open(inner,input,route),'invalid_cursor');
 await fails(signer.open(token,input,'GET /api/catalog'),'invalid_cursor');
 await fails(createExternalDiscoveryCursor({signingKey:'other-synthetic-only-key-1234567890123456789'}).open(token,input,route),'invalid_cursor');
});

test('binding rejects changed query, page size, controls, ranking and generation with typed restarts',async()=>{
 const signer=createExternalDiscoveryCursor({signingKey:key}),token=await signer.seal(inner,input,route,generation);
 await fails(signer.open(token,{...input,question:'another query'},route),'cursor_query_mismatch');
 await fails(signer.open(token,{...input,limit:2},route),'cursor_query_mismatch');
 await fails(signer.open(token,{...input,generation:'different'},route),'generation_unavailable');
 assert.equal(await signer.open(token,{...input,generation},route),inner);
 await fails(createExternalDiscoveryCursor({signingKey:key,rankingVersion:'next-ranking'}).open(token,input,route),'cursor_query_mismatch');
 const controlled={contract_version:'ushso.controlled-discovery.input.v1',query:input,coverage_mode:'all',intent_override:{subjects:[]}};
 const path='POST /api/discovery-controls/v1/search',bound=await signer.seal(inner,controlled,path,generation);
 await fails(signer.open(bound,{...controlled,coverage_mode:'verified_only'},path),'cursor_query_mismatch');
 await fails(signer.open(bound,{...controlled,intent_override:{subjects:['payer']}},path),'cursor_query_mismatch');
 const machine=await createMachineCursorSigner({signingKey:key}).page({capability:'search_assets',input:{limit:1},generation:'g',manifest:'m',items:[1,2],section:'summaries'});
 await fails(signer.open(machine.envelope.next_cursor,input,route),'invalid_cursor');
});

test('same-key independent signers permit idempotent replay; expiry is fixed across continuation pages',async()=>{
 let time=1000;const first=createExternalDiscoveryCursor({signingKey:key,clock:()=>time}),token=await first.seal(inner,input,route,generation);
 const independent=createExternalDiscoveryCursor({signingKey:key,clock:()=>time});
 assert.equal(await independent.open(token,input,route),inner);assert.equal(await independent.open(token,input,route),inner);
 time+=14*60*1000;const original={...input,cursor:token};await independent.unwrap(original,route);
 const result={ranking:{version:'observatory-canonical-ranking.v1.3.0'},pagination:{generation,next_cursor:inner,cursor:inner},query:{filters:{cursor:inner}},receipt:{filters:{cursor:inner}}};
 const continued=await independent.wrap(result,original,route);
 assert.equal(continued.pagination.cursor,token);assert.equal(continued.query.filters.cursor,token);assert.equal(continued.receipt.filters.cursor,token);
 time=1000+15*60*1000;
 await fails(independent.open(continued.pagination.next_cursor,input,route),'invalid_cursor');
 await fails(independent.open('',input,route),'invalid_cursor');
 const ephemeral=createExternalDiscoveryCursor(),local=await ephemeral.seal(inner,input,route,generation);
 await fails(createExternalDiscoveryCursor().open(local,input,route),'invalid_cursor');
});

async function workerFixture(){
 const fixture=JSON.parse(await readFile(new URL('./fixtures/direct-base-input.json',import.meta.url),'utf8'));
 const records=Array.from({length:4},(_,index)=>{const record=structuredClone(fixture.record);record.record_id+=`-cursor-${index}`;record.identity.asset.asset_id=record.record_id;return record;});
 const corpus={...fixture.corpus,record_count:records.length},engine=createRetrievalEngine({records,corpus,vocabulary:fixture.vocabulary,searchDocuments:[]});
 const make=()=>createWorker({loadCatalog:async()=>({records,corpus,engine,joinRoutes:[],searchDocuments:[]}),loadEngine:async()=>engine});
 return {make,records};
}

test('actual Worker boundary wraps all browser/control cursors and permits same-key independent Workers',async()=>{
 const {make}=await workerFixture(),a=make(),b=make(),env={USHSO_CURSOR_SIGNING_KEY:key};
 const first=await a.fetch(new Request('https://fixture.test/api/catalog?limit=1'),env);assert.equal(first.status,200);assert.equal(first.headers.get('cache-control'),'no-store');const body=await first.json(),token=body.pagination.next_cursor;assert.ok(token.startsWith('v2.'));
 const second=await b.fetch(new Request('https://fixture.test/api/catalog?limit=1&generation='+body.pagination.generation+'&cursor='+token),env);assert.equal(second.status,200);const page=await second.json();assert.notEqual(page.results[0].record_id,body.results[0].record_id);assert.equal(page.pagination.cursor,token);assert.equal(page.receipt.filters.cursor,token);
 const post=(worker,path,input)=>worker.fetch(new Request('https://fixture.test'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}),env);
 const cross=await post(b,'/api/discover',{question:'hospital',limit:1,cursor:token});assert.equal(cross.status,409);assert.equal((await cross.json()).error.code,'invalid_cursor');
 const question=(await workerFixture()).records[0].title;
 const query={question,limit:1};
 const discovery=await post(a,'/api/discover',query);assert.equal(discovery.status,200);const found=await discovery.json();assert.ok(found.pagination.next_cursor);
 const continuation=await post(b,'/api/discover',{...query,cursor:found.pagination.next_cursor});assert.equal(continuation.status,200);
 const changed=await post(b,'/api/discover',{...query,limit:2,cursor:found.pagination.next_cursor});assert.equal(changed.status,409);assert.equal((await changed.json()).error.code,'cursor_query_mismatch');
 const controlInput={contract_version:'ushso.controlled-discovery.input.v1',query,coverage_mode:'all'};
 const control=await post(a,'/api/discovery-controls/v1/search',controlInput);assert.equal(control.status,200);const controlled=await control.json();assert.ok(controlled.discovery.pagination.next_cursor);
 const next=await post(b,'/api/discovery-controls/v1/search',{...controlInput,query:{...query,cursor:controlled.discovery.pagination.next_cursor}});assert.equal(next.status,200);
 const wrongControls=await post(b,'/api/discovery-controls/v1/search',{...controlInput,coverage_mode:'verified_only',query:{...query,cursor:controlled.discovery.pagination.next_cursor}});assert.equal(wrongControls.status,409);
});
