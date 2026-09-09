import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseCostReportGrid} from './cms-cost-report-grid-parser.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(name){
 const directory=new URL('./fixtures/cms-cost-grid/',import.meta.url);
 const refs=JSON.parse(await fs.readFile(new URL('provenance.json',directory)));
 const ref=refs.find(r=>r.fixture===name+'.json'),bytes=await fs.readFile(new URL(ref.fixture,directory));
 assert.equal(hash(bytes),ref.fixture_sha256);assert.ok(ref.publisher_url.startsWith('https://data.cms.gov/'));
 return JSON.parse(bytes);
}
test('public HHA painted cells recover literal spaced variable names and bounded continuation',async()=>{
 const p=parseCostReportGrid(await fixture('hha'));
 assert.ok(p.variables.length>20);assert.equal(p.issues.length,0);
 const v=p.variables.find(v=>v.name==='Fiscal Year Begin Date');
 assert.ok(v);assert.equal(v.unit,null);assert.equal(v.label,null);assert.equal(v.eligible_for_schema_promotion,false);
 assert.ok(p.variables.some(v=>v.page===2&&v.header_page===1));
});
test('public hospital cost grammar retains worksheet cells separately from labels',async()=>{
 const p=parseCostReportGrid(await fixture('hospital'));
 assert.ok(p.variables.length>10);assert.equal(p.issues.length,0);
 assert.ok(p.variables.every(v=>v.publisher_worksheet_element&&v.source_cells.length===3&&v.label===null));
});
test('changed continuation column boundaries do not inherit ownership',async()=>{
 const g=await fixture('hha');g.pages[1].rectangles=g.pages[1].rectangles.map(r=>r[2]-r[0]<=2?[r[0]+4,r[1],r[2]+4,r[3]]:r);
 const p=parseCostReportGrid(g);assert.ok(p.issues.some(i=>i.code==='COST_GRID_CONTINUATION_COLUMNS'));
 assert.ok(p.variables.every(v=>v.page===1));
});
test('unpainted or missing row borders cannot establish a table',async()=>{
 const g=await fixture('hha');g.pages[0].rectangles=[];
 const p=parseCostReportGrid(g);assert.equal(p.variables.length,0);assert.ok(p.issues.length>=2);
});
test('multiline or unpositioned text is isolated beside a healthy publisher page',async()=>{
 const g=await fixture('hha');g.pages[1]=structuredClone(g.pages[0]);g.pages[1].page=2;
 g.pages[0].spans.push({text:'ambiguous\nother row',x:52,y:660});
 const p=parseCostReportGrid(g);assert.ok(p.issues.some(i=>i.code==='COST_GRID_AMBIGUOUS_TEXT_POSITION'));
 assert.ok(p.variables.length>0);assert.ok(p.variables.every(v=>v.page===2));
});
test('duplicate literal field identities remain isolated rather than overwritten',async()=>{
 const g=await fixture('hha');g.pages[1]=structuredClone(g.pages[0]);g.pages[1].page=2;
 const p=parseCostReportGrid(g);assert.equal(p.variables.length,0);assert.ok(p.issues.some(i=>i.code==='COST_GRID_DUPLICATE_IDENTITY'));
});
test('malformed page collection is a typed unavailable outcome',()=>{
 assert.equal(parseCostReportGrid({pages:{}}).status,'unavailable');
});
test('a new heading outside the continuation grid prevents header inheritance',async()=>{
 const g=await fixture('hha');g.pages[1].spans.push({text:'Different table',x:50,y:750});
 const p=parseCostReportGrid(g);assert.ok(p.issues.some(i=>i.code==='COST_GRID_CONTINUATION_CONTENT'));
 assert.ok(p.variables.every(v=>v.page===1));
});
test('a gap in one interior vertical border isolates only its affected row',async()=>{
 const g=await fixture('hha'),original=parseCostReportGrid(g),target=original.variables.find(v=>v.name==='rpt_rec_num');
 const [left,bottom,right,top]=target.bounds;
 const vertical=g.pages[0].rectangles.find(r=>r[2]-r[0]>0&&r[2]-r[0]<=2&&r[0]>left+5&&r[2]<right-5&&r[1]<bottom&&r[3]>top);
 assert.ok(vertical);
 g.pages[0].rectangles=g.pages[0].rectangles.flatMap(r=>r===vertical?[[r[0],r[1],r[2],bottom+1],[r[0],top-1,r[2],r[3]]]:[r]);
 const p=parseCostReportGrid(g);assert.ok(p.issues.some(i=>i.code==='COST_GRID_ROW_COLUMN_BOUNDARY_GAP'));
 assert.ok(!p.variables.some(v=>v.name===target.name));assert.ok(p.variables.length>0);
});
test('text exactly on a row border is retained as a typed isolation outcome',async()=>{
 const g=await fixture('hha'),target=parseCostReportGrid(g).variables[0];
 g.pages[0].spans.push({text:'unowned border text',x:target.bounds[0]+5,y:target.bounds[1]});
 const p=parseCostReportGrid(g),issue=p.issues.find(i=>i.code==='COST_GRID_TEXT_ON_BOUNDARY');
 assert.ok(issue);assert.equal(issue.source_spans[0].text,'unowned border text');
 assert.ok(!p.variables.some(v=>v.name===target.name));
});
test('text exactly on a column divider cannot silently enter either cell',async()=>{
 const g=await fixture('hha'),target=parseCostReportGrid(g).variables[0];
 const divider=g.pages[0].rectangles.find(r=>r[2]-r[0]>0&&r[2]-r[0]<=2&&r[0]>target.bounds[0]+5&&r[2]<target.bounds[2]-5&&r[1]<target.bounds[1]&&r[3]>target.bounds[3]);
 g.pages[0].spans.push({text:'ambiguous column text',x:divider[2],y:(target.bounds[1]+target.bounds[3])/2});
 const p=parseCostReportGrid(g);assert.ok(p.issues.some(i=>i.code==='COST_GRID_TEXT_ON_BOUNDARY'));
 assert.ok(!p.variables.some(v=>v.name===target.name));
});
