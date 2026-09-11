import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [repo,out]=process.argv.slice(2);
const mod=rel=>import(pathToFileURL(path.join(repo,rel)));
const {mintReleaseIdentity}=await mod('packages/identity/src/release-identity.mjs');
const {bindCapturedCatalogRecord}=await mod('packages/identity/src/release-binding.mjs');
const {projectCoreReleaseDecision}=await mod('packages/identity/src/core-conformance.mjs');
const {fingerprintTruthRevision}=await mod('contracts/core/v2.0.0/tools/common.mjs');
const {live20260903GenerationMap,lookupProductContext}=await mod('packages/identity/src/generation-identity.mjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
const sources=['contracts/core/v2.0.0/bundle/valid-bundle.json','verification/research-program/pr-007/fixtures/catalog-resources.captures.json'];
const bytes=await Promise.all(sources.map(p=>fs.readFile(path.join(repo,p))));
const release=JSON.parse(bytes[0]).releases[0], native=release.native_identifiers[0], f=JSON.parse(bytes[1]);
const identity=mintReleaseIdentity({asset_id:release.asset_id,source_id:native.source_id,publisher_identifiers:[native],locator:{kind:'exact_distribution',url:'https://example.org/release.csv',evidence_ids:native.evidence_ids},publisher_version:release.publisher_version,release_kind:release.release_kind,evidence_ids:native.evidence_ids,observed_at:'2026-09-03T22:22:33.908Z'});
const envelope={...structuredClone(release),release_id:identity.release_id,entity_id:identity.release_id};
envelope.canonical_content_fingerprint=fingerprintTruthRevision(envelope);
const binding=bindCapturedCatalogRecord({record:f.cms_record,catalogCapture:f.cms_catalog,resourcesCapture:f.cms_resources});
const map=live20260903GenerationMap();
const lookup=b=>lookupProductContext({map,record:f.cms_record,pin:map.machine_generation.value,binding:b});
const cases=[];
function check(id,description,probe){try{const r=probe();cases.push({id,description,...r,status:r.pass?'passed':'failed'});}catch(e){cases.push({id,description,status:'probe_error',error:e.stack});}}
check('control-valid-core-fingerprint','A complete owned envelope with its actual canonical fingerprint projects unchanged',()=>{const r=projectCoreReleaseDecision(identity,{envelope});return {pass:r.projected===true&&r.core_object.canonical_content_fingerprint===fingerprintTruthRevision(r.core_object),actual:r};});
check('stale-core-fingerprint','A changed revision body cannot retain its old canonical fingerprint and project as a conformant core object',()=>{const changed={...envelope,publisher_version:`${envelope.publisher_version}-changed`};assert.notEqual(changed.canonical_content_fingerprint,fingerprintTruthRevision(changed));const r=projectCoreReleaseDecision(identity,{envelope:changed});return {pass:r.projected===false,actual:{decision:r,expected_fingerprint:fingerprintTruthRevision(changed),supplied_fingerprint:changed.canonical_content_fingerprint}};});
check('control-complete-captured-binding','The full captured CMS binding supplies internally consistent release and distribution context',()=>{assert.equal(binding.binding_state,'one_to_many');assert.equal(binding.release_identity.asset_id,binding.asset_id);assert.equal(binding.release_identity.source_id,binding.source_id);assert(binding.distributions.length>1);assert(binding.distributions.every(d=>d.release_id===binding.release_identity.release_id));assert(binding.releases.includes(binding.release_identity.release_id));const r=lookup(binding);return {pass:r.restart_required===false&&r.release_id===binding.release_identity.release_id,actual:{binding_state:binding.binding_state,release_ids:binding.releases,distributions:binding.distributions.map(d=>({distribution_id:d.distribution_id,release_id:d.release_id})),lookup:r}};});
for(const [id,description,mutate] of [
 ['foreign-distribution-release','A distribution whose release reference was changed cannot be attached to the current product context',b=>{b.distributions[0].release_id='urn:ushso:release:controller-foreign';}],
 ['foreign-nested-release-asset','A nested release belonging to another asset cannot be presented under the unchanged binding asset',b=>{b.release_identity.asset_id='obs:asset:controller-foreign';}],
 ['foreign-release-list','An unrelated release inserted into the release list cannot become the product context while its nested release and distributions remain unchanged',b=>{b.releases[0]='urn:ushso:release:controller-foreign';}],
])check(id,description,()=>{const altered=structuredClone(binding);mutate(altered);const r=lookup(altered);return {pass:r.restart_required===true,actual:{lookup:r,binding_asset:altered.asset_id,nested_asset:altered.release_identity.asset_id,release_list:altered.releases,nested_release_id:altered.release_identity.release_id,distribution_release_ids:altered.distributions.map(d=>d.release_id)}};});
for(let i=0;i<sources.length;i++)assert.equal(hash(await fs.readFile(path.join(repo,sources[i]))),hash(bytes[i]));
await fs.mkdir(out,{recursive:true});
const report={format:'ushso.pr007-controller-r3-relationships.v1',recorded_at:new Date().toISOString(),synthetic_inputs:true,source_fixtures:sources.map((p,i)=>({path:p,sha256:hash(bytes[i])})),source_fixtures_unchanged:true,script_sha256:hash(await fs.readFile(new URL(import.meta.url))),cases,accepted:false};
await fs.writeFile(path.join(out,'semantics.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({cases:cases.map(x=>({id:x.id,status:x.status})),report:path.join(out,'semantics.json')}));process.exitCode=cases.every(x=>x.status==='passed')?0:1;
