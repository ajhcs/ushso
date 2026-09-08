import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWorker } from '../worker/index.mjs';
import { inspectCursorConfiguration } from '../scripts/check-cursor-configuration.mjs';
const base=new URL('../packages/retrieval/versions/v1.2.0/corpus/',import.meta.url);
test('configuration preflight preserves secrets and distinguishes missing/invalid/configured',()=>{
 assert.equal(inspectCursorConfiguration({}).state,'missing');
 for(const key of ['',null,3,'short'])assert.equal(inspectCursorConfiguration({USHSO_CURSOR_SIGNING_KEY:key}).state,'invalid');
 const key='unit-test-only-dedicated-cursor-key-not-production';
 const result=inspectCursorConfiguration({USHSO_CURSOR_SIGNING_KEY:key});assert.equal(result.ready,true);assert.ok(!JSON.stringify(result).includes(key));
});
test('independent Workers share traversal; mid-pagination rotation invalidates old cursors and restart succeeds',async()=>{
 const corpus=JSON.parse(await fs.readFile(new URL('corpus.json',base)));
 const first=JSON.parse((await fs.readFile(new URL(corpus.record_files[0],base),'utf8')).trim().split('\n')[0]);
 const records=Array.from({length:6},(_,i)=>({...first,record_id:`asset.rotation.${i}`,title:`Rotation ${i}`}));
 const catalog={corpus,records},make=()=>createWorker({loadCatalog:async()=>catalog});
 const input={contract_version:'observatory.machine.search-assets.input.v1.0.0',mode:'browse',sort:'title_asc',filters:{geography_ids:[],subject_ids:[],grain:[],access_classes:[],authority_levels:[],machine_readiness:[],time_period:null,negative_constraints:[],dimensions:[]},grouping:'none',limit:2,cursor:null,expected_generation:null};
 const a={USHSO_CURSOR_SIGNING_KEY:'unit-test-only-before-rotation-key-123456789'},b={USHSO_CURSOR_SIGNING_KEY:'unit-test-only-after-rotation-key-123456789'};
 const call=async(worker,env,query)=>{const r=await worker.fetch(new Request('https://rotation.test/api/machine/v1/search-assets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(query)}),env);return r.json();};
 const one=await call(make(),a,input);assert.equal(one.ok,true);assert.ok(one.next_cursor);
 const two=await call(make(),a,{...input,cursor:one.next_cursor,expected_generation:one.index_generation});assert.equal(two.ok,true);assert.ok(two.next_cursor);
 assert.deepEqual([...one.result.summaries,...two.result.summaries].map(x=>x.asset_id),records.slice(0,4).map(x=>x.record_id));
 const rotated=await call(make(),b,{...input,cursor:two.next_cursor});assert.equal(rotated.error.code,'cursor_expired');assert.equal(rotated.restart_required,true);
 const restart=await call(make(),b,input);assert.equal(restart.ok,true);assert.equal(restart.result.summaries[0].asset_id,records[0].record_id);
 const continued=await call(make(),b,{...input,cursor:restart.next_cursor});assert.equal(continued.ok,true);
 const wrongKey=await call(make(),a,{...input,cursor:restart.next_cursor});assert.equal(wrongKey.error.code,'cursor_expired');
});
