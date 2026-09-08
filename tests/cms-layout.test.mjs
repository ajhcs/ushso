import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTypedLayout} from '../scripts/research/cms-typed-layout.mjs';
import {parseVariableLayout} from '../scripts/research/cms-variable-layout.mjs';
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
