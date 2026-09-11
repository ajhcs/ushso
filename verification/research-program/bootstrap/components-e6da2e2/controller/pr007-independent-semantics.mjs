import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [repo,out]=process.argv.slice(2);
const mod=rel=>import(pathToFileURL(path.join(repo,rel)));
const {mintReleaseIdentity,mintDistributionIdentity,collectDateRoles,createPublisherIdentifier}=await mod('packages/identity/src/release-identity.mjs');
const {bindCapturedCatalogRecord}=await mod('packages/identity/src/release-binding.mjs');
const {live20260903GenerationMap,lookupProductContext}=await mod('packages/identity/src/generation-identity.mjs');
const {lookupMappedProductContext}=await mod('packages/registry/generation-identity.mjs');
const {createStaticPublicationReadContext}=await mod('packages/registry/publication-read-context.mjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
const evidence=['evidence:controller:identity'];
const identifier=(value,namespace='publisher.release')=>({source_id:'urn:ushso:source:controller',namespace,value,entity_scope:'release',uniqueness_policy:'source_scoped',evidence_ids:evidence});
const input=(value,namespace)=>({asset_id:'obs:asset:controller-example',source_id:'urn:ushso:source:controller',publisher_identifiers:[identifier(value,namespace)],locator:{kind:'exact_distribution',url:'https://example.org/data.csv',evidence_ids:evidence},publisher_version:'2026',release_kind:'vintage',evidence_ids:evidence,observed_at:'2026-09-03T22:22:33.908Z'});
const cases=[];
async function check(id,description,probe){try{const r=await probe();cases.push({id,description,...r,status:r.pass?'passed':'failed'});}catch(error){cases.push({id,description,status:'probe_error',error:error.stack});}}
await check('control-repeat','An unchanged complete publisher identifier is deterministic',()=>{const a=mintReleaseIdentity(input('release-1')),b=mintReleaseIdentity(input('release-1'));assert.equal(a.identity_state,'exact');return {pass:a.release_id===b.release_id,actual:{first:a.release_id,second:b.release_id}};});
for(const [id,a,b] of [
 ['punctuation',input('edition/1'),input('edition:1')],
 ['namespace',input('edition-1','publisher.release'),input('edition-1','archive.release')],
 ['long-suffix',input('a'.repeat(200)+'1'),input('a'.repeat(200)+'2')]
]) await check('release-'+id,'Distinct qualified publisher release identifiers must not collapse',()=>{const x=mintReleaseIdentity(a),y=mintReleaseIdentity(b);return {pass:x.release_id!==y.release_id,expected:'distinct release IDs',actual:{first:x.release_id,second:y.release_id,publisher_identifiers:[x.publisher_identifiers,y.publisher_identifiers]}};});
await check('distribution-release-scope','A distribution identifier reusable over time must not bind two immutable releases to one ID',()=>{
 const publisher=createPublisherIdentifier({...identifier('download','publisher.distribution'),entity_scope:'distribution',uniqueness_policy:'reusable_over_time'});
 const d={format:'CSV',distribution_kind:'download',locator:{kind:'exact_distribution',url:'https://example.org/data.csv',evidence_ids:evidence},content_sha256:'a'.repeat(64),publisher_identifiers:[publisher],evidence_ids:evidence};
 const a=mintDistributionIdentity(d,{releaseId:'urn:ushso:release:first',releaseState:'exact'});
 const b=mintDistributionIdentity({...d,content_sha256:'b'.repeat(64)},{releaseId:'urn:ushso:release:second',releaseState:'exact'});
 return {pass:a.distribution_id!==b.distribution_id,actual:{first:a,second:b}};
});
await check('date-conflict-values','Conflicting date-role values and both evidence links remain inspectable',()=>{const result=collectDateRoles([{role:'publisher_released_at',value:'2025-01-01',evidence_ids:['evidence:date:first']},{role:'publisher_released_at',value:'2026-01-01',evidence_ids:['evidence:date:second']}]);return {pass:JSON.stringify(result).includes('2025-01-01')&&JSON.stringify(result).includes('2026-01-01'),actual:result};});
const map=live20260903GenerationMap();
const record={record_id:'obs:asset:controller-example',source_id:'urn:ushso:source:controller',source_native_id:'product-1'};
await check('control-map-lookup','Human and machine pins yield the same context for the same source record',()=>{const a=lookupProductContext({map,record,pin:map.human_manifest.value}),b=lookupProductContext({map,record,pin:map.machine_generation.value});return {pass:!a.restart_required&&!b.restart_required&&a.product_context_fingerprint===b.product_context_fingerprint,actual:{human:a,machine:b}};});
await check('control-stale-pin','A recognized stale manifest pin is rejected',()=>{const r=lookupProductContext({map,record,pin:'b'.repeat(64)});return {pass:r.restart_required===true,actual:r};});
await check('unknown-pin-kind','An unsupported pin kind cannot authorize substitution to the current map',()=>{let r;try{r=lookupProductContext({map,record,pin:'old-unavailable-generation',pin_kind:'unsupported_kind'});}catch(e){return {pass:true,actual:{error:e.message}};}return {pass:r.restart_required===true,actual:r};});
await check('foreign-binding','A different asset/source binding cannot be attached to the requested product',()=>{const binding={asset_id:'obs:asset:foreign',source_id:'urn:ushso:source:foreign',releases:['urn:ushso:release:foreign'],distributions:[{distribution_id:'urn:ushso:distribution:foreign',release_id:'urn:ushso:release:foreign'}]};let r;try{r=lookupProductContext({map,record,pin:map.machine_generation.value,binding});}catch(e){return {pass:true,actual:{error:e.message}};}return {pass:r.restart_required===true,actual:r};});
await check('publication-pin-mismatch','An explicit current client pin cannot override a different publication corpus',()=>{const publication=createStaticPublicationReadContext({corpus_id:'controller-old-corpus',corpus_version:'0.9.0',manifest_sha256:'b'.repeat(64)});let r;try{r=lookupMappedProductContext({publication,map,record,pin:map.machine_generation.value});}catch(e){return {pass:true,actual:{error:e.message}};}return {pass:r.restart_required===true||r.lookup?.restart_required===true,actual:r};});
const fixturePath=path.join(repo,'verification/research-program/pr-007/fixtures/catalog-resources.captures.json');
const fixtureBytes=await fs.readFile(fixturePath);const f=JSON.parse(fixtureBytes);
await check('control-capture-binding','Producer synthetic catalog and linked resources bind one-to-many',()=>{const r=bindCapturedCatalogRecord({record:f.cms_record,catalogCapture:f.cms_catalog,resourcesCapture:f.cms_resources});return {pass:r.binding_state==='one_to_many'&&r.distributions.length>1,actual:{state:r.binding_state,releases:r.releases,distribution_count:r.distributions.length}};});
await check('catalog-vintage-not-global-release','Two assets with the same vintage do not acquire the same immutable release ID',()=>{
 const first=bindCapturedCatalogRecord({record:f.cms_record,catalogCapture:f.cms_catalog});
 const catalog=structuredClone(f.cms_catalog),otherRecord=structuredClone(f.cms_record);
 otherRecord.record_id='obs:asset:cms-data-catalog:other-product';otherRecord.identity.asset.asset_id=otherRecord.record_id;otherRecord.identity.match_fields.source_id='controller-other-native-id';catalog.data.dataset[0].identifier='controller-other-native-id';
 const second=bindCapturedCatalogRecord({record:otherRecord,catalogCapture:catalog});
 return {pass:first.releases[0]!==second.releases[0],actual:{first_asset:first.asset_id,second_asset:second.asset_id,first_releases:first.releases,second_releases:second.releases}};
});
await check('resources-link-required','Unrelated resources need evidence of linkage before joining a catalog record',()=>{
 const catalog=structuredClone(f.cms_catalog);for(const row of catalog.data.dataset)for(const d of row.distribution??[])delete d.resourcesAPI;
 const resources=structuredClone(f.cms_resources);resources.data.links.self.href='https://example.org/unrelated/resources';resources.data.data=[{downloadURL:'https://example.org/unrelated.csv',format:'CSV',sha256:'d'.repeat(64)}];
 const r=bindCapturedCatalogRecord({record:f.cms_record,catalogCapture:catalog,resourcesCapture:resources});
 return {pass:!r.distributions.some(d=>d.locator.url==='https://example.org/unrelated.csv'),actual:{state:r.binding_state,reasons:r.reason_codes,distribution_locators:r.distributions.map(d=>d.locator.url)}};
});
assert.equal(hash(await fs.readFile(fixturePath)),hash(fixtureBytes));
await fs.mkdir(out,{recursive:true});
const report={format:'ushso.pr007-independent-semantics.v1',recorded_at:new Date().toISOString(),synthetic_inputs:true,source_fixture_sha256:hash(fixtureBytes),source_fixture_unchanged:true,script_sha256:hash(await fs.readFile(new URL(import.meta.url))),cases,accepted:false};
await fs.writeFile(path.join(out,'semantics.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({cases:cases.map(x=>({id:x.id,status:x.status})),report:path.join(out,'semantics.json')}));process.exitCode=cases.every(x=>x.status==='passed')?0:1;
