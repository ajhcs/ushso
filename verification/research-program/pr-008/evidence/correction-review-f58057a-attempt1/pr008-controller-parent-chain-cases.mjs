import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const [root,out]=process.argv.slice(2);assert(root&&out);
const identity=await import(pathToFileURL(path.join(root,'packages/identity/src/index.mjs')));
const {schemaFixture}=await import(pathToFileURL(path.join(root,'packages/identity/fixtures/production-shaped.mjs')));
const Ajv2020=createRequire(path.join(root,'package.json'))('ajv/dist/2020.js').default;
const sha=b=>createHash('sha256').update(b).digest('hex');
const fixturePath='verification/research-program/pr-007/fixtures/catalog-resources.captures.json';
const fixtureBytes=await fs.readFile(path.join(root,fixturePath));const fixture=JSON.parse(fixtureBytes);
// Derive a synthetic single-distribution case from the retained PR007 test
// fixture. This is controller test data, not a new or authenticated CMS capture.
const capture=structuredClone(fixture.cms_catalog);
capture.data.dataset=capture.data.dataset.slice(0,1);
capture.data.dataset[0].distribution=capture.data.dataset[0].distribution.slice(0,1);
capture.text=JSON.stringify(capture.data);capture.sha256=sha(capture.text);
const binding=identity.bindCapturedCatalogRecord({record:fixture.cms_record,catalogCapture:capture,observedAt:fixture.observed_at});
assert.equal(binding.binding_state,'exact','Controller setup needs an actual exact PR007 binding');
assert.equal(binding.distributions.length,1);
const ajv=new Ajv2020({strict:true,allErrors:true});
ajv.addFormat('date-time',v=>typeof v==='string'&&Number.isFinite(Date.parse(v)));
ajv.addFormat('date',v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v));
const validateRelease=ajv.compile(JSON.parse(await fs.readFile(path.join(root,'packages/identity/schemas/release-identity.schema.json'))));
assert.equal(validateRelease(binding.release_identity),true,JSON.stringify(validateRelease.errors));
const released=schemaFixture('left');
released.snapshot.release_id=binding.release_identity.release_id;
released.snapshot.distribution_id=binding.distributions[0].distribution_id;
assert(!Object.hasOwn(released.snapshot,'source_id')&&!Object.hasOwn(released.snapshot,'asset_id'));
const context={source_id:binding.source_id,asset_id:binding.asset_id,release_id:released.snapshot.release_id,distribution_id:released.snapshot.distribution_id,schema_snapshot_id:released.snapshot.schema_snapshot_id,schema_field_id:released.fields[0].schema_field_id,field_revision_id:released.fields[0].revision_id};
function catalog(){const c=new identity.ImmutableSchemaCatalog();c.registerSnapshot(released.snapshot,released.fields);return c;}
function refuses(fn){try{const r=fn();assert(r===false||r?.state==='unresolved'||r?.valid===false,'Incomplete or contradictory parent relationships returned a resolved field');}catch(e){if(e.code==='ERR_ASSERTION')throw e;}}
const cases=[];async function check(id,fn){try{const r=await fn();cases.push({id,status:'passed',observation:r??null});}catch(e){cases.push({id,status:'failed',error:{message:e.message,code:e.code??null}});}}
await check('actual-pr007-binding-released-core-positive',()=>{const r=catalog().resolveVariableContext(context,binding);assert.equal(r.field.revision_id,context.field_revision_id);assert.equal(r.snapshot.release_id,context.release_id);return {binding_state:binding.binding_state,release_schema_valid:true,snapshot_has_added_parent_fields:false};});
await check('released-core-missing-relationship-negative',()=>refuses(()=>catalog().resolveVariableContext(context)));
await check('source-asset-facts-without-release-distribution-chain',()=>refuses(()=>catalog().resolveVariableContext(context,{binding_state:'exact',source_id:context.source_id,asset_id:context.asset_id,evidence_ids:['evidence:controller:unrelated-parent-facts']})));
await check('actual-binding-nested-foreign-asset',()=>{const b=structuredClone(binding);b.release_identity.asset_id='obs:asset:controller:foreign';refuses(()=>catalog().resolveVariableContext(context,b));});
await check('actual-binding-nested-foreign-source',()=>{const b=structuredClone(binding);b.release_identity.source_id='urn:ushso:source:controller-foreign';refuses(()=>catalog().resolveVariableContext(context,b));});
await check('actual-binding-conflicting-release-list',()=>{const b=structuredClone(binding);b.releases=['urn:ushso:release:controller-foreign'];refuses(()=>catalog().resolveVariableContext(context,b));});
await check('actual-binding-distribution-foreign-parent-release',()=>{const b=structuredClone(binding);b.distributions[0].release_id='urn:ushso:release:controller-foreign';refuses(()=>catalog().resolveVariableContext(context,b));});
await check('actual-binding-nested-distribution-foreign-parent-release',()=>{const b=structuredClone(binding);b.release_identity.distributions[0].release_id='urn:ushso:release:controller-foreign';refuses(()=>catalog().resolveVariableContext(context,b));});
await check('actual-binding-source-asset-positive-preserved',()=>{const c=catalog();const b=structuredClone(binding);assert.equal(c.resolveVariableContext(context,b).snapshot.schema_snapshot_id,context.schema_snapshot_id);assert.deepEqual(b,binding);assert.equal(c.resolveEndpoint(context).field.schema_field_id,context.schema_field_id);});
const receipt={format:'ushso.pr008.controller-parent-chain-probes.v1',author:'Astra/root',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(),recorded_at:new Date().toISOString(),script_sha256:sha(await fs.readFile(new URL(import.meta.url))),fixture:{path:fixturePath,sha256:sha(fixtureBytes),synthetic_single_distribution_capture_sha256:capture.sha256},scope:'Offline accepted PR007 API output, released core fixture shape and contradictory parent facts. No publisher access or scientific qualification.',passed:cases.filter(c=>c.status==='passed').length,failed:cases.filter(c=>c.status==='failed').length,cases};
await fs.writeFile(out,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));process.exitCode=receipt.failed?1:0;
