import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const [root, output] = process.argv.slice(2);
if (!root || !output) throw Error('Usage: candidate-root receipt-path');
const identity = await import(pathToFileURL(path.join(root, 'packages/identity/src/index.mjs')));
const ex = await import(pathToFileURL(path.join(root, 'scripts/research/source-extractors.mjs')));
const cms = await import(pathToFileURL(path.join(root, 'scripts/research/cms-typed-layout.mjs')));
const require = createRequire(path.join(root, 'package.json'));
const Ajv2020 = require('ajv/dist/2020.js').default;
const validate = new Ajv2020({strict:true,allErrors:true}).compile(JSON.parse(await fs.readFile(path.join(root, 'contracts/machine-toolkit/v1.2.0/schemas/variable-identity.schema.json'))));
const sha = value => createHash('sha256').update(value).digest('hex');
const evidence = ['evidence:controller:dictionary'];
const context = {
  source_id:'urn:ushso:source:controller-alpha',asset_id:'urn:ushso:asset:controller-alpha',
  release_id:'urn:ushso:release:controller-alpha',distribution_id:'urn:ushso:distribution:controller-alpha',
  schema_snapshot_id:'urn:ushso:schema:controller-alpha',schema_field_id:'urn:ushso:field:controller-alpha',
  field_revision_id:'urn:ushso:revision:controller-alpha'
};
const captureFor = data => { const text=JSON.stringify(data); return {status:'captured',url:'https://example.test/variables.json',data,text,sha256:sha(text),captured_at:'2026-09-11T00:00:00Z',evidence_id:evidence[0]}; };
const data = {variables:{'A/B~C':{label:'Population — estimate',concept:'Health coverage',description:'Literal definition',predicateType:'string',values:{item:{'001':'Code with zero','-999':'Not available','µ':'Unicode'}},missing_values:{'-999':'Not available'}}}};
const capture = captureFor(data);
const make = (options={}) => ex.extractVersionedVariables(data.variables,'census',{capture,...options})[0];
const makeIdentity = (overrides={}) => identity.createVariableIdentity({
  context_binding:context,wire_name:'AMOUNT',publisher_label:'Amount',publisher_concept:'Total',definition:'Recorded amount',
  source_type:{state:'documented',value:'number',evidence_ids:evidence},observed_type:{state:'observed',value:'number',evidence_ids:evidence},
  semantic_role:'measure',unit:{state:'documented',value:'USD',evidence_ids:evidence},
  provenance:{source_locator:capture.url,pointer:'/variables/A~1B~0C',capture_sha256:capture.sha256,raw_value_sha256:sha(JSON.stringify(data.variables['A/B~C'])),transformation:{name:'controller_fixture',version:'1.0.0'},evidence_ids:evidence},
  ...overrides
});
const cases=[];
async function check(id, purpose, fn) {
  try { const observation=await fn(); cases.push({id,purpose,status:'passed',observation:observation??null}); }
  catch(error) { cases.push({id,purpose,status:'failed',error:{name:error.name,code:error.code??null,message:error.message,actual:error.actual??null,expected:error.expected??null}}); }
}
function refuses(fn,message) { let result; try { result=fn(); } catch { return; } assert.ok(result===false || result?.valid===false || result?.state==='unresolved',message); }

await check('context-identity','All seven identity dimensions and literal punctuation distinguish derived identifiers.',()=>{
  const first=identity.variableIdForContext(context,'CODE');
  for(const key of Object.keys(context)) assert.notEqual(first,identity.variableIdForContext({...context,[key]:context[key]+'-beta'},'CODE'),key);
  assert.notEqual(identity.variableIdForContext(context,'Wage – Cost'),identity.variableIdForContext(context,'Wage - Cost'));
});
await check('unresolved-context','Missing context cannot mint a variable identifier.',()=>{
  const first=make(); assert.equal(first.variable_id,null); assert.equal(first.context_binding.state,'unresolved'); assert.ok(first.context_binding.reason);
  for(const key of Object.keys(context)) assert.throws(()=>identity.variableIdForContext({...context,[key]:null},'CODE'));
});
await check('literal-extraction','Wire, label, concept, definition and types stay separate.',()=>{
  const result=make(); assert.equal(result.wire_name,'A/B~C');assert.equal(result.publisher_label,'Population — estimate');assert.equal(result.publisher_concept,'Health coverage');assert.equal(result.definition,'Literal definition');assert.equal(result.observed_type.state,'unknown');assert.equal(result.source_type.state,'documented');
  const conceptOnly={variables:{COUNT:{label:'Count',concept:'Concept without a definition',predicateType:'int'}}}; const cap=captureFor(conceptOnly);
  assert.equal(ex.extractVersionedVariables(conceptOnly,'census',{capture:cap})[0].definition,null);
});
await check('raw-values-and-pointers','Exact literal codes, sentinel and JSON pointer replay.',()=>{
  const result=make();assert.equal(result.provenance.pointer,'/variables/A~1B~0C');assert.equal(result.provenance.raw_value_sha256,sha(JSON.stringify(data.variables['A/B~C'])));assert.deepEqual(result.code_values.values.map(x=>x.code),['001','-999','µ']);assert.equal(ex.verifyVariableIdentity(result,capture),true);assert.equal(validate(result),true,JSON.stringify(validate.errors));
});
await check('immutable-catalog','Existing snapshot and field revisions cannot be changed through registration or returned references.',()=>{
  const catalog=new identity.ImmutableSchemaCatalog(); const snapshot={entity_type:'SchemaSnapshot',schema_snapshot_id:context.schema_snapshot_id,asset_id:context.asset_id,source_id:context.source_id,release_id:context.release_id,distribution_id:context.distribution_id,field_ids:[context.schema_field_id],immutable:true}; const field={entity_type:'SchemaField',entity_id:context.schema_field_id,schema_field_id:context.schema_field_id,schema_snapshot_id:context.schema_snapshot_id,revision_id:context.field_revision_id,ordinal:0};
  catalog.registerSnapshot(snapshot,[field]);const resolved=catalog.resolveVariableContext(context);resolved.snapshot.release_id='foreign';assert.equal(catalog.getSnapshot(context.schema_snapshot_id).release_id,context.release_id);assert.throws(()=>catalog.registerSnapshot({...snapshot,release_id:'urn:foreign'},[field]));assert.throws(()=>catalog.resolveVariableContext({...context,field_revision_id:'urn:foreign'}));
});
await check('foreign-asset-context','Variable context resolver must not resolve an asset belonging to another snapshot.',()=>{
  const catalog=new identity.ImmutableSchemaCatalog();const snapshot={entity_type:'SchemaSnapshot',schema_snapshot_id:context.schema_snapshot_id,asset_id:context.asset_id,source_id:context.source_id,release_id:context.release_id,distribution_id:context.distribution_id,field_ids:[context.schema_field_id],immutable:true};const field={entity_type:'SchemaField',entity_id:context.schema_field_id,schema_field_id:context.schema_field_id,schema_snapshot_id:context.schema_snapshot_id,revision_id:context.field_revision_id,ordinal:0};catalog.registerSnapshot(snapshot,[field]);catalog.resolveVariableContext(context);refuses(()=>catalog.resolveVariableContext({...context,asset_id:'urn:ushso:asset:controller-beta'}),'Foreign asset was returned as a resolved variable context');
});
await check('foreign-source-context','Variable context resolver must not resolve a foreign source as the same registered snapshot.',()=>{
  const catalog=new identity.ImmutableSchemaCatalog();const snapshot={entity_type:'SchemaSnapshot',schema_snapshot_id:context.schema_snapshot_id,asset_id:context.asset_id,source_id:context.source_id,release_id:context.release_id,distribution_id:context.distribution_id,field_ids:[context.schema_field_id],immutable:true};const field={entity_type:'SchemaField',entity_id:context.schema_field_id,schema_field_id:context.schema_field_id,schema_snapshot_id:context.schema_snapshot_id,revision_id:context.field_revision_id,ordinal:0};catalog.registerSnapshot(snapshot,[field]);catalog.resolveVariableContext(context);refuses(()=>catalog.resolveVariableContext({...context,source_id:'urn:ushso:source:controller-beta'}),'Foreign source was returned as a resolved variable context');
});
await check('unresolved-schema-field-helper','Direct exported field helper cannot turn explicitly unresolved context into a stable field ID.',()=>{
  refuses(()=>identity.createContextScopedSchemaFieldId({...context,state:'unresolved',binding_state:'ambiguous',reason:'two possible releases'},'CODE'),'Explicitly unresolved context minted a field ID');
});
await check('measurement-unit-unknown','A measurement without any documented unit is never labeled complete.',()=>{
  const result=makeIdentity({unit:{state:'unknown',value:null,evidence_ids:[]}});assert.notEqual(result.completeness,'complete');
});
await check('measurement-unit-omitted','Omitted measurement units remain incomplete or unknown even if both type assertions exist.',()=>{
  const result=makeIdentity({unit:undefined});assert.notEqual(result.completeness,'complete');
});
await check('identifier-applicability','An identifier supports reasoned unit non-applicability without measurement coercion.',()=>{
  const result=makeIdentity({semantic_role:'identifier',unit:{state:'not_applicable',value:null,rationale:'Code identifies a facility rather than a measurement.',evidence_ids:evidence}});assert.equal(result.unit.state,'not_applicable');assert.equal(result.unit.value,null);assert.equal(validate(result),true,JSON.stringify(validate.errors));
});
await check('trusted-context-replay','Verification must use the caller trusted context instead of copying the claim context.',()=>{
  const good=make({context_binding:context});assert.equal(ex.verifyVariableIdentity(good,capture,{context_binding:context}),true);
  const foreign=make({context_binding:{...context,release_id:'urn:ushso:release:foreign'}});
  refuses(()=>ex.verifyVariableIdentity(foreign,capture,{context_binding:context}),'A claim from a foreign release verified against a different trusted release');
});
await check('capture-bytes-binding','Changed capture bytes or locator and wrong raw-value hashes cannot verify.',()=>{
  const good=make();assert.throws(()=>ex.verifyVariableIdentity(good,{...capture,text:capture.text+' '}));assert.throws(()=>ex.verifyVariableIdentity(good,{...capture,url:'https://example.test/foreign.json'}));assert.throws(()=>ex.verifyVariableIdentity({...good,provenance:{...good.provenance,raw_value_sha256:'b'.repeat(64)}},capture));
});
await check('capture-status-binding','A failed retained capture cannot be used as verified variable extraction.',()=>{
  const good=make();refuses(()=>ex.verifyVariableIdentity(good,{...capture,status:'failed'}),'Failed capture verified successfully');
});
await check('capture-bytes-required','Verified extraction needs actual captured bytes or an independently checked body binding.',()=>{
  const good=make();const {text,...missingBytes}=capture;refuses(()=>ex.verifyVariableIdentity(good,missingBytes),'No retained raw bytes but the variable verifier claimed success');
});
await check('arbitrary-extraction-source','Extraction cannot claim a raw pointer from different supplied data as verified capture provenance.',()=>{
  const foreignData={variables:{'A/B~C':{...data.variables['A/B~C'],description:'Different undocumented definition'}}};
  let proposed;try{proposed=ex.extractVersionedVariables(foreignData,'census',{capture})[0];}catch{return;}
  refuses(()=>ex.verifyVariableIdentity(proposed,capture),'Foreign supplied data was verified against this capture');
});
await check('mapping-evidence','Aliases need evidence; literal differences remain ambiguous or unmatched.',()=>{
  assert.throws(()=>identity.createVariableMapping({state:'reviewed_alias',documented_name:'Cost – Total',wire_name:'Cost - Total',candidate_wire_names:[],evidence_ids:[]}));assert.throws(()=>identity.createVariableMapping({state:'exact',documented_name:'Cost – Total',wire_name:'Cost - Total',candidate_wire_names:[],evidence_ids:evidence}));
  const ambiguous=identity.createVariableMapping({state:'ambiguous',documented_name:'Cost – Total',wire_name:null,candidate_wire_names:['Cost - Total'],evidence_ids:evidence});assert.equal(ambiguous.wire_name,null);
});
await check('cms-parser-compatibility','Existing CMS parser rows are unchanged by the additive adapter.',async()=>{
  const input=JSON.parse(await fs.readFile(path.join(root,'tests/fixtures/research-layouts/cms-hha.json')));const parsed=cms.parseTypedLayout(input);const before=JSON.stringify(parsed);const cap=captureFor(parsed);const variables=ex.extractVersionedVariables(parsed,'cms',{capture:cap});assert.equal(JSON.stringify(parsed),before);assert.ok(variables.length>0);assert.ok(variables.every(v=>v.variable_id===null&&v.promotion_eligible===false));
});
await check('cms-dictionary-only','A dictionary-only label never becomes a selected wire field.',()=>{
  const only={variables:[{documented_name:'Amount – recorded',label:'Amount label',definition:'Documentation only'}]};const cap=captureFor(only);const [result]=ex.extractVersionedVariables(only,'cms',{capture:cap});assert.equal(result.wire_name,null);assert.equal(result.mapping.state,'unmatched');assert.equal(result.mapping.documented_name,'Amount – recorded');assert.equal(result.variable_id,null);
});
await check('retained-audit','Actual retained 117/117 counts and eleven difference sets are unchanged and unresolved.',async()=>{
  const audit=JSON.parse(await fs.readFile(path.join(root,'verification/research-program/bootstrap/pr008-scope-20260911/sample-shape-comparison.json')));const source=audit.find(x=>x.sample==='cms-hcris');const result=identity.retainNameDiscrepancySummary({...source,mismatch_count:source.in_payload_not_dictionary.length});assert.equal(result.sample_fields,117);assert.equal(result.dictionary_fields,117);assert.equal(result.mismatch_count,11);assert.deepEqual(result.payload_names,source.in_payload_not_dictionary);assert.deepEqual(result.dictionary_names,source.in_dictionary_not_payload);assert.ok(result.mappings.every(x=>x.wire_name===null&&x.state==='ambiguous'));
});
await check('frozen-legacy-bytes','Legacy schema, machine routes, parsers and the old extractor implementation remain byte-identical.',async()=>{
  const base='a00630c712e3a4e64354a77d268cb168fa3f528a';
  execFileSync('git',['diff','--exit-code',base,'--','contracts/machine-toolkit/v1.0.0','contracts/machine-toolkit/v1.1.0','worker','apps/web/src/types/discovery.ts','scripts/research/cms-typed-layout.mjs','scripts/research/cms-variable-layout.mjs'],{cwd:root,encoding:'utf8'});
  const before=execFileSync('git',['show',base+':scripts/research/source-extractors.mjs'],{cwd:root,encoding:'utf8'});const current=await fs.readFile(path.join(root,'scripts/research/source-extractors.mjs'),'utf8');const section=text=>text.slice(text.indexOf('export function dictionaryFrom'),text.indexOf('export const VERSIONED_VARIABLE_TRANSFORMATIONS')<0?undefined:text.indexOf('export const VERSIONED_VARIABLE_TRANSFORMATIONS')).trim();assert.equal(section(current),section(before));
});
const receipt={format:'ushso.pr008.controller-semantic-probes.v1',author:'Astra/root',prepared_case_plan:'pr008-controller-case-plan.json',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(),recorded_at:new Date().toISOString(),script_sha256:sha(await fs.readFile(new URL(import.meta.url))),scope:'Offline synthetic negative and positive cases; no payload access or scientific acceptance.',passed:cases.filter(x=>x.status==='passed').length,failed:cases.filter(x=>x.status==='failed').length,cases};
await fs.writeFile(output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));process.exitCode=receipt.failed?1:0;
