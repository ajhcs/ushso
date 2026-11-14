import { createRetrievalEngine } from '../packages/retrieval/tools/retrieval-core-v1.2.mjs';
import { createStaticMachineToolkitRuntime } from '../worker/static-machine-toolkit-service.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, sha256, projectLedger, createDataManifest } from '../packages/source-selection/index.mjs';
import { fixture } from './source-selection/fixture.mjs';
import { commitLedger, setRightsPolicy, publishCandidate } from '../packages/source-selection/ledger.mjs';
import { stagePublication } from '../scripts/release-source-selection/stage-publication.mjs';
import { createWorker } from '../worker/index.mjs';
import { loadAcceptedPublication } from '../worker/source-selection-publication.mjs';
import { createMachineCursorSigner } from '../worker/machine-cursor.mjs';

test('accepted ledger stages and serves only the pinned rights-valid generation', async () => {
 const root = await mkdtemp(join(tmpdir(), 'ushso-runtime-'));
 try {
  const ledgerRoot = join(root,'ledger'), assetsDirectory = join(root,'assets');
  const {revision} = await commitLedger(ledgerRoot,null,fixture());
  const policy = {revoked_rights:[]}, {hash} = await setRightsPolicy(ledgerRoot,policy);
  const published = await publishCandidate(ledgerRoot,{expectedRevision:revision,expectedRightsHash:hash,rightsPolicy:policy,schemaHashes:{source_selection:'a'.repeat(64)}});
  await stagePublication({ledgerRoot,assetsDirectory});
  let content = await readFile(join(assetsDirectory,'source-selection/publication.json'),'utf8');
  const assets = {fetch: async () => new Response(content)};
  const worker = createWorker(), request = () => new Request('https://fixture.test/api/source-selection/v1/publication');
  let response = await worker.fetch(request(),{ASSETS:assets});
  assert.equal(response.status,503); assert.equal((await response.json()).reason,'current_rights_pin_required');
  response = await worker.fetch(request(),{ASSETS:assets,USHSO_ACCEPTED_RIGHTS_HASH:hash});
  assert.equal(response.status,200); const body = await response.json();
  assert.equal(body.generation_id,published.generation_id); assert.equal(body.bundle.views[0].asset_id,'asset_1');
  assert.equal(response.headers.get('cache-control'),'no-store');
  const compare = input => worker.fetch(new Request('https://fixture.test/api/machine/v2/compare-assets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}),{ASSETS:assets,USHSO_ACCEPTED_RIGHTS_HASH:hash});
  const input={contract_version:'ushso.compare-assets.input.v2',asset_ids:['asset_1','missing'],dimensions:['geography','joins'],expected_pin:body.pin};
  let compared=await compare(input); assert.equal(compared.status,200); let result=await compared.json();
  assert.deepEqual(result.pin,body.pin); assert.equal(result.items[0].dimensions.geography.status,'verified'); assert.equal(result.items[0].dimensions.joins.status,'unresolved'); assert.equal(result.items[1].dimensions.geography.status,'unavailable');
  compared=await compare({...input,expected_pin:{...body.pin,ranking_version:'wrong'}});assert.equal(compared.status,409);
  compared=await compare({...input,question:'must not accept research questions'});assert.equal(compared.status,400);
  response = await worker.fetch(request(),{ASSETS:assets,USHSO_ACCEPTED_RIGHTS_HASH:'b'.repeat(64)});
  assert.equal(response.status,503); assert.equal((await response.json()).reason,'rights_changed');
  const validContent=content;
  const expired=JSON.parse(content);expired.bundle.rights_expire_at='2000-01-01T00:00:00Z';expired.bundle_hash=sha256(canonical(expired.bundle));content=canonical(expired);
  response=await worker.fetch(request(),{ASSETS:assets,USHSO_ACCEPTED_RIGHTS_HASH:hash});assert.equal(response.status,503);assert.equal((await response.json()).reason,'rights_expired');
  const malformed=JSON.parse(validContent);malformed.bundle.views[0].geography.assertion_ids=[];malformed.bundle_hash=sha256(canonical(malformed.bundle));content=canonical(malformed);
  response=await worker.fetch(request(),{ASSETS:assets,USHSO_ACCEPTED_RIGHTS_HASH:hash});assert.equal(response.status,503);assert.equal((await response.json()).reason,'publication_invalid');
  content = validContent.replace('Synthetic hospital source','Forged source');
  response = await worker.fetch(request(),{ASSETS:assets,USHSO_ACCEPTED_RIGHTS_HASH:hash});
  assert.equal(response.status,503); assert.equal((await response.json()).reason,'publication_invalid');
 } finally { await rm(root,{recursive:true,force:true}); }
});

test('query cursor binding is keyed, domain-separated, and stable only for the same dedicated key', async () => {
 const query={capability:'search_assets',input:{limit:1,question:'synthetic private research question'},generation:'g',manifest:'m',items:[1,2],section:'summaries'};
 const a=createMachineCursorSigner({signingKey:'a'.repeat(32)}), b=createMachineCursorSigner({signingKey:'b'.repeat(32)}), same=createMachineCursorSigner({signingKey:'a'.repeat(32)});
 const one=await a.page(query), two=await b.page(query), three=await same.page(query);
 assert.match(one.binding,/^sha256:[a-f0-9]{64}$/); assert.notEqual(one.binding,two.binding); assert.equal(one.binding,three.binding);
 assert.ok(!one.envelope.next_cursor.includes(query.input.question));
 assert.deepEqual((await same.page({...query,input:{...query.input,cursor:one.envelope.next_cursor}})).selected,[2]);
});

test('generated public pages use actual HTML artifacts and unknown datasets return 404',async()=>{
 const files=new Map([
  ['/public-pages.json',JSON.stringify({schema_version:'ushso-public-pages.v1',routes:[{path:'/datasets/known',file:'/datasets/known/index.html',status:200}]})],
  ['/datasets/known/index.html','<!doctype html><title>Known published inventory</title>'],
  ['/sitemap.xml','<urlset><url><loc>https://ushso.org/datasets/known</loc></url></urlset>']
 ]);
 const env={ASSETS:{fetch:async request=>{const value=files.get(new URL(request.url).pathname);return new Response(value??'missing',{status:value?200:404});}}};
 const worker=createWorker();
 const known=await worker.fetch(new Request('https://fixture.test/datasets/known'),env);assert.equal(known.status,200);assert.match(await known.text(),/Known published inventory/);assert.equal(known.headers.get('cache-control'),'public, max-age=0, must-revalidate');
 const missing=await worker.fetch(new Request('https://fixture.test/datasets/missing'),env);assert.equal(missing.status,404);
 const sitemap=await worker.fetch(new Request('https://fixture.test/sitemap.xml'),env);assert.match(await sitemap.text(),/datasets\/known/);
});

test('health separates catalog identity, unconfigured build identity and cursor readiness without revealing keys',async()=>{
 const corpus={corpus_id:'synthetic',corpus_version:'1',manifest_sha256:'c'.repeat(64)};
 const engine={interpret:()=>({compiler:{llm_used:false}})};
 const worker=createWorker({loadCatalog:async()=>({corpus,engine}),loadEngine:async()=>engine});
 const request=()=>new Request('https://fixture.test/api/health');
 for (const [key,mode,ready] of [[undefined,'ephemeral_instance',false],['short','invalid_key',false],['synthetic-test-only-dedicated-key-1234567890','configured_key',true]]) {
  const response=await worker.fetch(request(),{USHSO_CURSOR_SIGNING_KEY:key}); const body=await response.json();
  assert.equal(response.status,200);assert.equal(body.catalog.content_fingerprint_sha256,corpus.manifest_sha256);assert.equal(body.catalog.absence_claim_permitted,false);assert.deepEqual(body.build,{identity:null,state:'not_configured'});assert.equal(body.machine_cursor.mode,mode);assert.equal(body.machine_cursor.persistent_key_ready,ready);if(key)assert.ok(!JSON.stringify(body).includes(key));
 }
});

test('security contact file is served as its published plain text asset',async()=>{
 const contact='Contact: mailto:info@ushso.org\n';
 const worker=createWorker();let requested;
 const response=await worker.fetch(new Request('https://fixture.test/.well-known/security.txt'),{ASSETS:{fetch:async request=>{requested=new URL(request.url).pathname;return new Response(contact,{headers:{'content-type':'text/plain; charset=utf-8'}});}}});
 assert.equal(requested,'/.well-known/security.txt');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/plain/);assert.equal(await response.text(),contact);
});


test('rehashed projections cannot invent readiness, malformed typed facts or detached evidence',async()=>{
 const revision='a'.repeat(64), rights='b'.repeat(64);
 const data=createDataManifest({ledgerRevision:revision,ledgerHash:revision,evidenceHash:'c'.repeat(64),rightsHash:rights,schemaHashes:{source_selection:'d'.repeat(64)}});
 const base={status:'available',revision,rights_hash:rights,generation_id:data.generation_id,bundle:{data_manifest:data.manifest,views:projectLedger(fixture(),data.generation_id),rights_expire_at:null}};
 const load=async publication=>{publication.bundle_hash=sha256(canonical(publication.bundle));return loadAcceptedPublication(new Request('https://fixture.test/api/source-selection/v1/publication'),{USHSO_ACCEPTED_RIGHTS_HASH:rights,ASSETS:{fetch:async()=>new Response(canonical(publication))}});};
 assert.equal((await load(structuredClone(base))).status,'available');
 for(const change of [
  view=>{view.decision_readiness='decision_ready';},
  view=>{view.geography.value=false;},
  view=>{view.geography.value.regions=['PA','PA'];},
  view=>{view.geography.assertion_ids=['detached_assertion'];},
  view=>{view.geography.evidence_ids=['detached_evidence'];},
  view=>{view.unresolved=[];},
  view=>{view.checked_at='2026-02-30';},
  view=>{view.identity={status:'verified',value:{asset_id:'wrong_asset',publisher_id:view.publisher_id},assertion_ids:['new_identity'],evidence_ids:view.evidence_ids};view.assertion_ids.push('new_identity');view.unresolved=view.unresolved.filter(x=>x!=='identity');}
 ]) {
  const malformed=structuredClone(base);change(malformed.bundle.views[0]);
  assert.deepEqual(await load(malformed),{status:'unavailable',reason:'publication_invalid'});
 }
 const wrongLedger=structuredClone(base);wrongLedger.bundle.data_manifest.accepted_ledger_sha256='e'.repeat(64);wrongLedger.generation_id=sha256(canonical(wrongLedger.bundle.data_manifest));wrongLedger.bundle.views[0].generation_id=wrongLedger.generation_id;
 assert.deepEqual(await load(wrongLedger),{status:'unavailable',reason:'publication_invalid'});
});


test('cursor rejects an ordering-version change with the same key, corpus and query',async()=>{
 const options={signingKey:'dedicated-synthetic-test-key-1234567890'};
 const input={capability:'search_assets',input:{limit:1,research_need:'synthetic question'},generation:'same-generation',manifest:'same-manifest',items:[1,2],section:'summaries',orderVersion:'ranker.old'};
 const first=await createMachineCursorSigner(options).page(input);
 assert.deepEqual((await createMachineCursorSigner(options).page({...input,input:{...input.input,cursor:first.envelope.next_cursor}})).selected,[2]);
 await assert.rejects(createMachineCursorSigner(options).page({...input,orderVersion:'ranker.new',input:{...input.input,cursor:first.envelope.next_cursor}}),/MACHINE_CURSOR_RESTART_REQUIRED/);
});


test('generated encoded dataset filenames survive the asset binding URI decode',async()=>{
 const id='obs:asset:synthetic',route='/datasets/'+encodeURIComponent(id),file=route+'/index.html';
 const files=new Map([['/public-pages.json',JSON.stringify({schema_version:'ushso-public-pages.v1',routes:[{path:route,file,status:200}]})],[file,'<h1>Synthetic encoded detail</h1>']]);
 const env={ASSETS:{fetch:async request=>{const path=decodeURIComponent(new URL(request.url).pathname),bytes=files.get(path);return new Response(bytes??'<h1>Wrong SPA fallback</h1>',{status:200});}}};
 const response=await createWorker().fetch(new Request('https://fixture.test'+route),env);assert.equal(response.status,200);assert.equal(await response.text(),'<h1>Synthetic encoded detail</h1>');
});


test('machine freshness uses the same request clock as human discovery rather than a historical verification label',async()=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/direct-base-input.json',import.meta.url),'utf8')),clock=new Date('2026-11-14T00:00:00Z');
 const filters={geography_ids:[],subject_ids:[],grain:[],access_classes:[],authority_levels:[],machine_readiness:[],time_period:null,negative_constraints:[],dimensions:[]};
 for(const [due,expected] of [['2026-01-01T00:00:00Z','stale'],['2027-01-01T00:00:00Z','current'],[null,'unknown']]){
  const record=structuredClone(fixture.record);record.freshness_verification.verification_status='current_verified';record.freshness_verification.next_review_due=due;
  const engine=createRetrievalEngine({records:[record],corpus:fixture.corpus,vocabulary:fixture.vocabulary,searchDocuments:[]});
  const human=engine.browse({limit:1},{now:clock});
  const runtime=createStaticMachineToolkitRuntime({records:[record],corpus:fixture.corpus},{now:clock});
  const machine=await runtime.operations.searchAssets({mode:'browse',sort:'title_asc',filters,grouping:'none',limit:1,cursor:null,expected_generation:null});
  assert.equal(machine.result.summaries[0].staleness_state,expected);assert.equal(machine.evidence_references.find(ref=>ref.evidence_class==='catalog_record').staleness_state,expected);
  if(expected==='stale')assert.equal(human.results[0].metadata.freshness.freshness_state,'overdue');
 }
});
