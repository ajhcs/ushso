import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCmsDictionary,templates} from '../scripts/research/cms-dictionary-parser.mjs';
test('CMS hospital dictionary preserves multiword identifiers, worksheet locators and continuation notes',()=>{
 const document={pages:[{page:1,text:'Variable Name Cost Report Worksheet Element Definition\nProvider CCN S2‐Part1‐Line‐3‐Column‐2 CMS Certification Number.\nFiscal Year End Date S2‐Part1‐Line‐20‐Column‐2 Fiscal Year End Date.\ncontinued note.'},{page:2,text:'unparsed'}]};
 const p=parseCmsDictionary(document,templates.hospital);assert.equal(p.variables.length,2);assert.equal(p.variables[0].name,'Provider CCN');assert.equal(p.variables[1].end_line,4);assert.match(p.variables[1].publisher_definition_and_notes,/continued note/);assert.deepEqual(p.unparsed_pages,[2]);assert.equal(p.publication_authorized,false);assert.ok(p.variables.every(v=>v.unit===null&&v.data_type===null));
});
test('CMS unsupported bytes and broken headers fail closed',()=>{
 assert.throws(()=>parseCmsDictionary({pages:[{page:1,text:'unknown'}]},'other'),/LAYOUT_UNSUPPORTED/);
 assert.throws(()=>parseCmsDictionary({pages:[{page:1,text:'unknown'}]},templates.hospital),/HEADER/);
 assert.throws(()=>parseCmsDictionary({pages:[]},templates.hospital),/PAGE_MISSING/);
});
