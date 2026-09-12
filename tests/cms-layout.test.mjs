import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTypedLayout} from '../scripts/research/cms-typed-layout.mjs';
import {parseVariableLayout} from '../scripts/research/cms-variable-layout.mjs';
import {hash,extractVersionedVariables,verifyVariableIdentity} from '../scripts/research/source-extractors.mjs';
const fixture=async name=>JSON.parse(await fs.readFile(new URL('./fixtures/research-layouts/'+name+'.json',import.meta.url)));
test('public HHA layout retains CHAR identifiers, wrapped names and bounded evidence spans',async()=>{
 const source=await fixture('cms-hha'),p=parseTypedLayout(source);
 assert.equal(p.variables.length,22);const npi=p.variables.find(v=>v.name==='NPI');assert.equal(npi.publisher_type,'CHAR');assert.equal(npi.publisher_length,10);assert.equal(npi.unit,null);
 assert.ok(p.variables.some(v=>v.name==='DOING BUSINESS AS NAME'));assert.ok(p.variables.some(v=>v.name==='ORGANIZATION TYPE STRUCTURE'));
 for(const row of p.variables)assert.equal(row.source_quote,source.text.split('\n').slice(row.start_line-1,row.end_line).join('\n'));
 assert.equal(p.variables.at(-1).continuation_pending,true);assert.ok(p.variables.every(v=>v.eligible_for_schema_promotion===false));assert.equal(p.publication_authorized,false);
});
test('Muse cross-page SNF definition is explicitly incomplete, never silently closed',async()=>{
 const p=parseTypedLayout(await fixture('cms-snf-chow')),last=p.variables.at(-1);
 assert.equal(last.name,'ENROLLMENT ID – SELLER');assert.match(last.description,/enrollment type,$/);assert.equal(last.continuation_pending,true);assert.ok(p.unparsed_pages.includes(2));
});
test('ACO fixed-width columns separate wrapped label from definition without invented types',async()=>{
 const p=parseVariableLayout(await fixture('cms-aco')),v=p.variables.find(v=>v.name==='NORM_RISK_SCORE');
 assert.equal(v.label,'Normalized weighted average risk score');assert.equal(v.description,'Normalized weighted average risk score');assert.equal(v.data_type,null);assert.equal(v.unit,null);
 assert.equal(p.publication_authorized,false);assert.equal(p.variables.at(-1).continuation_pending,true);
});
test('layout parsers reject missing headers, narrow cells, duplicate names and ambiguous rows',async()=>{
 const source=await fixture('cms-hha');
 assert.throws(()=>parseTypedLayout({...source,text:'bad'}),/HEADER/);
 const lines=source.text.split('\n'),header=lines.findIndex(l=>l.includes('Term Name'));
 assert.throws(()=>parseTypedLayout({...source,text:lines.slice(0,header+1).join('\n')+'\na b c CHAR 2'}),/FIRST_ROW/);
 assert.throws(()=>parseTypedLayout({...source,text:source.text+'\n'+lines[header+1]}),/VARIABLE_IDENTITY/);
 assert.throws(()=>parseTypedLayout({...source,text:source.text+'\n'+' '.repeat(5000)+'bad'}),/AMBIGUOUS_ROW/);
});

test('CMS layout adapter consumes parser rows without rewriting parser semantics',async()=>{
 const source=await fixture('cms-hha'),parsed=parseTypedLayout(source),body=JSON.stringify(parsed),capture={status:'captured',url:'https://example.test/cms-layout.json',text:body,data:parsed,sha256:hash(body),captured_at:'2026-09-11T00:00:00Z',evidence_id:'evidence:test:cms-v1'};
 const variables=extractVersionedVariables(parsed,'cms',{capture}),first=variables[0];
 assert.equal(first.wire_name,null);assert.equal(first.mapping.state,'unmatched');assert.equal(first.mapping.documented_name,'ENROLLMENT ID');assert.equal(first.variable_id,null);assert.equal(first.publisher_label,'Enrollment ID');assert.match(first.definition,/unique 15-digit/);assert.equal(first.source_type.value,'CHAR');assert.equal(first.unit.state,'unknown');
 assert.equal(first.publication_authorized,false);assert.equal(first.promotion_eligible,false);assert.ok(first.limitations.some(value=>/partial/.test(value)));assert.equal(verifyVariableIdentity(first,capture),true);
});
test('CMS explicit wire spellings without mapping evidence stay unresolved',async()=>{
 const run=(entry)=>{const data={variables:[entry]},body=JSON.stringify(data),capture={status:'captured',url:'https://example.test/cms-explicit-wire.json',text:body,data,sha256:hash(body),captured_at:'2026-09-11T00:00:00Z',evidence_id:'evidence:test:cms-explicit-wire'};const [claim]=extractVersionedVariables(data,'cms',{capture});return {claim,verified:verifyVariableIdentity(claim,capture)}};
 for(const entry of [{name:'FIELD',wire_name:'FIELD',label:'Documented field'},{name:'FIELD',wire_name:'FIELD',label:'Documented field',mapping:{state:'exact',documented_name:'FIELD',wire_name:'FIELD',candidate_wire_names:[],evidence_ids:[]}}]){
  const {claim,verified}=run(entry);
  assert.equal(verified,true);
  assert.ok(!['exact','reviewed_alias'].includes(claim.mapping.state),'wire spelling alone must not create an evidence-bearing CMS mapping');
  assert.equal(claim.wire_name,null);
  assert.equal(claim.mapping.documented_name,'FIELD');
 }
});
test('CMS explicit exact and reviewed-alias mappings with evidence remain supported',async()=>{
 const run=(entry)=>{const data={variables:[entry]},body=JSON.stringify(data),capture={status:'captured',url:'https://example.test/cms-explicit-wire.json',text:body,data,sha256:hash(body),captured_at:'2026-09-11T00:00:00Z',evidence_id:'evidence:test:cms-explicit-wire'};const [claim]=extractVersionedVariables(data,'cms',{capture});return {claim,verified:verifyVariableIdentity(claim,capture)}};
 const exact=run({name:'FIELD',wire_name:'FIELD',mapping:{state:'exact',documented_name:'FIELD',wire_name:'FIELD',candidate_wire_names:[],evidence_ids:['evidence:test:payload-name-mapping']}});
 assert.equal(exact.claim.mapping.state,'exact');assert.equal(exact.verified,true);assert.equal(exact.claim.publication_authorized,false);
 const alias=run({name:'Documented field',wire_name:'API_FIELD',mapping:{state:'reviewed_alias',documented_name:'Documented field',wire_name:'API_FIELD',candidate_wire_names:['API_FIELD'],evidence_ids:['evidence:test:reviewed-alias']}});
 assert.equal(alias.claim.mapping.state,'reviewed_alias');assert.equal(alias.verified,true);assert.equal(alias.claim.promotion_eligible,false);
});

