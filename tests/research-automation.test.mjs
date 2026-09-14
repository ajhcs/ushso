import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {makeServer} from '../plugins/ushso-research/scripts/mcp.mjs';
import {createWorker} from '../worker/index.mjs';
import {metadataUrl,capture,validateProposals,extractDictionaries} from '../scripts/research/refresh.mjs';
const definitions=JSON.parse(await fs.readFile(new URL('../plugins/ushso-research/assets/tools.json',import.meta.url)));
const filters={geography_ids:[],subject_ids:[],grain:[],access_classes:[],authority_levels:[],machine_readiness:[],time_period:null,negative_constraints:[],dimensions:[]};
test('MCP exercises all eight actual Worker routes against the full corpus',async()=>{
 const base=new URL('../packages/retrieval/versions/v1.2.0/',import.meta.url);
 const corpus=JSON.parse(await fs.readFile(new URL('corpus/corpus.json',base)));
 const records=[];for(const f of corpus.record_files)records.push(...(await fs.readFile(new URL('corpus/'+f,base),'utf8')).trim().split(/\r?\n/).map(JSON.parse));
 const catalog={corpus,records};
 const worker=createWorker();const env={ASSETS:{fetch:async request=>{
 const pathname=new URL(request.url).pathname;
 if(!pathname.startsWith('/corpus-v1.2.0/'))return new Response('',{status:404});
 try{return new Response(await fs.readFile(new URL(pathname.slice('/corpus-v1.2.0/'.length),base))); }catch{return new Response('',{status:404})}
 }}};
 const server=makeServer({fetchImpl:(url,init)=>worker.fetch(new Request(url,init),env)});
 assert.equal((await server({jsonrpc:'2.0',id:1,method:'tools/list'})).error.code,-32002);
 await server({jsonrpc:'2.0',id:2,method:'initialize'});
 assert.equal((await server({jsonrpc:'2.0',id:3,method:'tools/list'})).result.tools.length,8);
  const [first, second] = catalog.records;
  const generation = catalog.corpus.publication.generation;
  const contexts = {
    release_id: 'release.test', distribution_id: 'distribution.test', schema_id: 'schema.test', access_route_id: 'access.test',
  };
  const cases = [
    ['search_assets', { contract_version: 'observatory.machine.search-assets.input.v1.0.0', mode: 'search', research_need: first.title, filters, grouping: 'none', limit: 5, cursor: null, expected_generation: generation }],
    ['get_asset', { contract_version: 'observatory.machine.get-asset.input.v1.0.0', record_id: first.record_id, expected_generation: generation, collection_limits: { releases: 20, distributions: 20, documentation: 20, schemas: 20 }, collection_cursors: { releases: null, distributions: null, documentation: null, schemas: null } }],
    ['get_access_plan', { contract_version: 'observatory.machine.get-access-plan.input.v1.0.0', record_id: first.record_id, release_id: contexts.release_id, distribution_id: contexts.distribution_id, access_route_id: contexts.access_route_id, expected_generation: generation }],
    ['get_retrieval_recipe', { contract_version: 'observatory.machine.get-retrieval-recipe.input.v1.0.0', record_id: first.record_id, release_id: contexts.release_id, distribution_id: contexts.distribution_id, access_route_id: contexts.access_route_id, expected_generation: generation }],
    ['get_variables', { contract_version: 'observatory.machine.get-variables.input.v1.0.0', record_id: first.record_id, release_id: contexts.release_id, distribution_id: contexts.distribution_id, schema_id: contexts.schema_id, semantic_query: null, filters: [], limit: 25, cursor: null, expected_generation: generation }],
    ['get_join_routes', { contract_version: 'observatory.machine.get-join-routes.input.v1.0.0', from_id: first.record_id, to_id: second.record_id, from_release_id: null, to_release_id: null, research_purpose: null, include_indirect: false, max_hops: 1, limit: 20, expected_generation: generation }],
    ['compare_assets', { contract_version: 'observatory.machine.compare-assets.input.v1.0.0', asset_ids: [first.record_id, second.record_id], dimensions: ['access', 'freshness', 'geography'], expected_generation: generation }],
    ['get_coverage_status', { contract_version: 'observatory.machine.get-coverage-status.input.v1.0.0', geography_ids: ['geo.us'], subject_ids: [], source_classes: [], time_period: null, authority_levels: ['authoritative'], limit: 25, cursor: null, expected_generation: generation }],
  ];

 for(const [capability,input] of cases){
 const result=await server({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:definitions.find(t=>t.capability===capability).name,arguments:input}});
 assert.equal(result.result.isError,false,capability+JSON.stringify(result));
 const unavailableCode={get_access_plan:'route_not_documented',get_retrieval_recipe:'route_not_documented',get_variables:'schema_context_required'}[capability];
 assert.equal(result.result.structuredContent.ok,!unavailableCode,capability+JSON.stringify(result));
 if(unavailableCode){assert.equal(result.result.structuredContent.error.code,unavailableCode);assert.equal(result.result.structuredContent.result,null);assert.equal(result.result.structuredContent.result_state,'unknown');}
 assert.equal(result.result.structuredContent.index_generation,generation);
 if(capability==='search_assets'){
  assert.ok(result.result.structuredContent.result.summaries.every(s=>s.grain==='unknown'));
  assert.ok(result.result.structuredContent.result.facet_counts.filter(f=>f.dimension==='grain').every(f=>f.value==='unknown'));
 }
 if(capability==='get_variables'){
  assert.equal(result.result.structuredContent.error.code,'schema_context_required');
  assert.equal(result.result.structuredContent.result_state,'unknown');
  assert.equal(result.result.structuredContent.result,null);
  assert.equal(result.result.structuredContent.truth_boundary.payloads_acquired,false);
 }
 }
 assert.equal((await server({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'plan_research',arguments:{}}})).error.code,-32602);
 const bad={...cases[1][1],expected_generation:'generation.unavailable'};
 const response=await server({jsonrpc:'2.0',id:6,method:'tools/call',params:{name:definitions.find(t=>t.capability==='get_asset').name,arguments:bad}});
 assert.equal(response.result.isError,false);
 assert.equal(response.result.structuredContent.ok,false);
 assert.equal(response.result.structuredContent.result_state,'unavailable');
 assert.equal(response.result.structuredContent.error.code,'generation_unavailable');
 // Actual Astra session case: a stale search generation is an application
 // error, not an MCP transport error or an empty successful search.
 const staleSearch={...cases[0][1],research_need:'hospital free data',expected_generation:'live-1900-01-01-deliberately-stale'};
 const stale=await server({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:definitions.find(t=>t.capability==='search_assets').name,arguments:staleSearch}});
 assert.equal(stale.result.isError,false);assert.equal(stale.result.structuredContent.ok,false);
 assert.equal(stale.result.structuredContent.error.code,'generation_unavailable');
 assert.equal(stale.result.structuredContent.result,null);
 for(const [change,code] of [[{dimensions:[{dimension:'typo_dimension',values:['x']}]},'invalid_input'],[{grain:['facility']},'coverage_unknown'],[{geography_ids:['geo.county.001']},'coverage_unknown'],[{time_period:{start:'2024-01-01',end:'2024-12-31',period_kind:'calendar',precision:'day'}},'coverage_unknown']]){
  const input={...cases[0][1],filters:{...filters,...change}};
  const response=await server({jsonrpc:'2.0',id:8,method:'tools/call',params:{name:definitions.find(t=>t.capability==='search_assets').name,arguments:input}});
  assert.equal(response.result.structuredContent.ok,false);assert.equal(response.result.structuredContent.error.code,code);assert.equal(response.result.structuredContent.result,null);
 }
});
test('publisher capture rejects secrets, redirects, oversized data and nonpublic hosts',async()=>{
 for(const url of ['http://data.cdc.gov/a','https://127.0.0.1/','https://data.cdc.gov/?%74oken=secret'])assert.equal(metadataUrl(url),null);
 const result=await capture('https://data.cdc.gov/a',{maxBytes:5,fetchImpl:async()=>new Response('too much data',{headers:{'content-type':'text/plain'}})});assert.equal(result.status,'response_too_large');
 const redirect=await capture('https://data.cdc.gov/a',{fetchImpl:async()=>new Response('',{status:302,headers:{location:'https://example.com','content-type':'text/plain'}})});assert.notEqual(redirect.status,'captured');
});
test('quotes require exact record binding and do not confer approval or establish observation grain',()=>{
 const o={url:'https://data.cdc.gov/a',sha256:'hash',status:'captured',text:'Data are reported on a quarterly basis.'};const q={record_id:'a',generation:'g',metadata_urls:[o.url]};const c={record_id:'a',capture_sha256:'hash',field:'observation_grain',value:'quarterly',quote:o.text};
 assert.equal(validateProposals({claims:[c]},[o],[q]).claims.length,0);
 c.field='limitations';c.value='Quarterly reporting';const valid=validateProposals({claims:[c]},[o],[q]).claims[0];assert.equal(valid.publication_authorized,false);assert.equal(valid.generation,'g');
 c.record_id='other';assert.equal(validateProposals({claims:[c]},[o],[q]).claims.length,0);
});

test('dictionary extraction requires matching publisher asset identity and retains release uncertainty',()=>{
 const o={status:'captured',url:'https://data.cdc.gov/api/views/abcd-1234.json',sha256:'h',text:JSON.stringify({id:'abcd-1234',columns:[{fieldName:':id',dataTypeName:'meta_data'},{fieldName:'count',name:'Count',dataTypeName:'number'}]})};
 const q={record_id:'r',generation:'g',source_id:'cdc-socrata',source_native_id:'abcd-1234',metadata_urls:[o.url]};
 const [d]=extractDictionaries([o],[q]);assert.equal(d.columns.length,1);assert.equal(d.columns[0].name,'count');assert.equal(d.payload_schema_verified,false);assert.equal(d.release_binding,'unresolved');assert.equal(d.publication_authorized,false);
 assert.deepEqual(extractDictionaries([o],[{...q,source_native_id:'wrong'}]),[]);
});

import { spawnSync } from 'node:child_process';
const captureClock = () => new Date('2026-09-12T00:00:01.000Z');
const fixtureLocator = 'https://catalog.example.gov/data.json';
test('C2 capture injected clock covers every legacy outcome and leaves default policy intact', async () => {
  const url = 'https://data.cdc.gov/api/views/abcd-1234.json';
  const cases = [
    [
      'captured',
      url,
      () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }),
      {}
    ],
    [
      'http_failed',
      url,
      () => new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }),
      {}
    ],
    ['blocked_locator', fixtureLocator, () => assert.fail('blocked delivery'), {}],
    [
      'response_too_large',
      url,
      () => new Response('123', { headers: { 'content-type': 'text/plain' } }),
      { maxBytes: 2 }
    ],
    [
      'unsupported_content_type',
      url,
      () => new Response('x', { headers: { 'content-type': 'image/png' } }),
      {}
    ],
    [
      'unsupported_text_encoding',
      url,
      () => new Response(new Uint8Array([255]), { headers: { 'content-type': 'text/plain' } }),
      {}
    ],
    [
      'fetch_failed',
      url,
      () => {
        throw Error('controlled refusal');
      },
      {}
    ]
  ];
  for (const [status, locator, fetchImpl, options] of cases) {
    const result = await capture(locator, { fetchImpl, clock: captureClock, ...options });
    assert.equal(result.status, status);
    assert.equal(result.captured_at, captureClock().toISOString());
    assert.equal('recorded_at' in result, false);
  }
  const timed = await capture(url, {
    clock: captureClock,
    timeoutMs: 1,
    fetchImpl: (_url, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })
      )
  });
  assert.equal(timed.status, 'timed_out');
  assert.equal(timed.captured_at, captureClock().toISOString());
  assert.equal(metadataUrl(fixtureLocator), null);
});
test('L2 custom locator policies require the same explicitly supplied callable fetch value', async () => {
  let policies = 0,
    bridges = 0,
    globalCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    globalCalls++;
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  };
  const policy = (url) => {
      policies++;
      return url;
    },
    bridge = async () => {
      bridges++;
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    };
  try {
    for (const options of [
      {},
      { fetchImpl: undefined },
      { fetchImpl: null },
      { fetchImpl: 3 },
      Object.create({ fetchImpl: bridge })
    ]) {
      options.locatorPolicy = policy;
      options.clock = captureClock;
      assert.equal(
        (await capture(fixtureLocator, options)).safe_detail_code,
        'LOCATOR_POLICY_REQUIRES_INJECTED_FETCH'
      );
    }
    let reads = 0;
    const changing = {
      locatorPolicy: policy,
      clock: captureClock,
      get fetchImpl() {
        return ++reads === 1 ? undefined : bridge;
      }
    };
    assert.equal((await capture(fixtureLocator, changing)).status, 'blocked_locator');
    assert.equal(reads, 1);
    assert.equal(policies, 0);
    assert.equal(bridges, 0);
    assert.equal(globalCalls, 0);
    assert.equal(
      (
        await capture(fixtureLocator, {
          locatorPolicy: policy,
          fetchImpl: bridge,
          clock: captureClock
        })
      ).status,
      'captured'
    );
    assert.equal(bridges, 1);
    assert.equal(
      (await capture('https://data.cdc.gov/api/views/abcd-1234.json', { clock: captureClock }))
        .status,
      'captured'
    );
    assert.equal(globalCalls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test('L3 custom policy rejects rewritten, noncanonical and fragment locators before transport', async () => {
  let calls = 0;
  const bridge = async () => {
    calls++;
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  };
  for (const value of [
    null,
    true,
    {},
    new URL(fixtureLocator),
    Promise.resolve(fixtureLocator),
    fixtureLocator + '?cursor=other'
  ])
    assert.equal(
      (
        await capture(fixtureLocator, {
          clock: captureClock,
          fetchImpl: bridge,
          locatorPolicy: () => value
        })
      ).status,
      'blocked_locator'
    );
  for (const url of [
    fixtureLocator + '#',
    fixtureLocator + '#part',
    'https://user:pass@catalog.example.gov/data.json',
    'https://CATALOG.example.gov/data.json',
    'https://catalog.example.gov:443/data.json'
  ])
    assert.equal(
      (
        await capture(url, {
          clock: captureClock,
          fetchImpl: bridge,
          locatorPolicy: (value) => value
        })
      ).status,
      'blocked_locator'
    );
  assert.equal(
    (
      await capture(fixtureLocator, {
        clock: captureClock,
        fetchImpl: bridge,
        locatorPolicy: () => {
          throw Error('refused');
        }
      })
    ).status,
    'blocked_locator'
  );
  assert.equal(calls, 0);
  const cursor = fixtureLocator + '?cursor=page-2';
  assert.equal(
    (
      await capture(cursor, {
        clock: captureClock,
        fetchImpl: bridge,
        locatorPolicy: (value) => (value === cursor ? value : null)
      })
    ).status,
    'captured'
  );
  assert.equal(calls, 1);
});
test('L3 native process rejected asynchronous policies settle as typed blocks without unhandled rejection', () => {
  const moduleUrl = new URL('../scripts/research/refresh.mjs', import.meta.url).href;
  for (const expression of ["async()=>{throw Error('controlled refusal')}", 'async url=>url']) {
    const code = `import {capture} from ${JSON.stringify(moduleUrl)};let calls=0;const result=await capture(${JSON.stringify(fixtureLocator)},{fetchImpl:()=>{calls++;throw Error('unexpected');},locatorPolicy:${expression}});await new Promise(resolve=>setImmediate(resolve));console.log(JSON.stringify({status:result.status,code:result.safe_detail_code,calls}));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8'
    });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), {
      status: 'blocked_locator',
      code: 'LOCATOR_POLICY_REJECTED',
      calls: 0
    });
    assert.equal(child.stderr, '');
  }
});
