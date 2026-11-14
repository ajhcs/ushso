import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRetrievalEngine } from '../tools/retrieval-core-v1.2.mjs';
const root = new URL('../versions/v1.2.0/', import.meta.url);
const corpus = JSON.parse(readFileSync(new URL('corpus/corpus.json', root)));
const vocabulary = JSON.parse(readFileSync(new URL('fixtures/controlled-vocabulary.json', root)));
const records = [1,2,3].flatMap(n => readFileSync(new URL(`corpus/records-000${n}.jsonl`, root),'utf8').trim().split('\n').map(JSON.parse));
test('publisher text alone cannot promote subject relevance to supported', () => {
  const engine = createRetrievalEngine({records, vocabulary, corpus, joinRoutes: []});
  const result = engine.retrieve({question:'hospital financials',page_size:20});
  assert.ok(result.results.length > 0);
  for (const item of result.results) {
    if (!item.relevance.score_components.some(c => c.kind === 'subject_capability')) assert.equal(item.match_state,'contextual');
  }
});

test('hospital finance requests rank hospital cost reports ahead of generic government finance without claiming direct support',()=>{
 const result=createRetrievalEngine({records,vocabulary,corpus,joinRoutes:[]}).retrieve({question:'hospital finances Pennsylvania',page_size:20});
 assert.match(result.results[0].record.title,/Hospital Provider Cost Report/i);
 assert.equal(result.results[0].match_state,'contextual');
 assert.ok(result.results[0].relevance.score_components.some(item=>item.kind==='requested_subject_text'));
});
test('life expectancy requests prioritize the measured subject rather than any county record',()=>{
 const result=createRetrievalEngine({records,vocabulary,corpus,joinRoutes:[]}).retrieve({question:'county life expectancy',page_size:5});
 assert.ok(result.results.length>0);
 assert.ok(result.results.every(item=>/life expectancy/i.test(`${item.record.title} ${item.record.description}`)));
 assert.ok(result.results.every(item=>item.match_state==='contextual'));
});
test('Medicaid outside an agency name ranks ahead of Medicare records that only name CMS',()=>{
 const result=createRetrievalEngine({records,vocabulary,corpus,joinRoutes:[]}).retrieve({question:'Medicaid',page_size:20});
 const trueMedicaid=result.results.findIndex(item=>/Medicaid Enrollment and Claims/i.test(item.record.title));
 const medicareOnly=result.results.findIndex(item=>/NHCS.*CMS.*Medicare Data/i.test(item.record.title));
 assert.ok(trueMedicaid>=0);
 assert.ok(medicareOnly<0 || trueMedicaid<medicareOnly);
 assert.ok(result.results.slice(0,5).every(item=>!/^National Hospital Care Survey.*Medicare Data/.test(item.record.title)));
});

test('agency names and URL slugs cannot earn requested Medicaid subject priority',()=>{
 const template=records.find(record=>/Weekly Hospitalization/i.test(record.title)) ?? records[0];
 const rows=[
  ['agency-only','Respiratory hospitalization capacity','Hospital capacity data from Centers for Medicare & Medicaid Services (CMS).'],
  ['url-only','Respiratory hospitalization capacity','Hospital capacity under https://example.org/medicare-and-medicaid-programs/rule.'],
  ['actual-medicaid','Medicaid enrollment','Medicaid enrollment and claims records.']
 ].map(([id,title,description])=>{const record=structuredClone(template);record.record_id=`synthetic:${id}`;record.identity.asset.asset_id=record.record_id;record.title=title;record.description=description;return record});
 const before=JSON.stringify(rows);
 const engine=createRetrievalEngine({records:rows,vocabulary,corpus,joinRoutes:[]});
 const result=engine.retrieve({question:'Medicaid hospital',page_size:20});
 assert.ok(result.results.some(item=>item.record_id==='synthetic:agency-only'));
 assert.ok(result.results.some(item=>item.record_id==='synthetic:url-only'));
 for(const item of result.results.filter(item=>item.record_id!=='synthetic:actual-medicaid')) assert.ok(!item.relevance.score_components.some(component=>component.kind==='requested_subject_text'));
 assert.equal(JSON.stringify(rows),before);
});
test('life expectancy in a title outranks a generic population description mention',()=>{
 const result=createRetrievalEngine({records,vocabulary,corpus,joinRoutes:[]}).retrieve({question:'county life expectancy',page_size:20});
 assert.match(result.results[0].record.title,/life expectancy/i);
 for(const item of result.results.filter(item=>!/life expectancy/i.test(item.record.title))) assert.ok(!item.relevance.score_components.some(component=>component.kind==='requested_subject_text'));
});

test('machine rank adapter preserves complete canonical ordering beyond the public page maximum',()=>{
 const rows=Array.from({length:235},(_,index)=>{const record=structuredClone(records[0]);record.record_id=`synthetic:complete:${index.toString().padStart(3,'0')}`;record.identity.asset.asset_id=record.record_id;record.title=`Hospital financial report ${index}`;record.description='Hospital financial reports and cost reports.';return record});
 const engine=createRetrievalEngine({records:rows,vocabulary,corpus:{corpus_id:'synthetic-full-order',corpus_version:'test'},joinRoutes:[]});
 const query={question:'hospital finances',page_size:200};
 const first=engine.retrieve(query),second=engine.retrieve({...query,cursor:first.pagination.next_cursor});
 const ranked=engine.rankAssets({question:query.question});
 assert.equal(ranked.items.length,235);
 assert.deepEqual(ranked.items.map(item=>item.record_id),[...first.results,...second.results].map(item=>item.record_id));
 assert.deepEqual(ranked.items.slice(0,200).map(item=>item.score),first.results.map(item=>item.score));
 assert.equal(ranked.ranking_version,first.ranking.version);
 assert.deepEqual(ranked.items[0].why_relevant,first.results[0].relevance.why_relevant);
});

test('generic hospital lexical/unit matches never claim documented subject support',()=>{
 const result=createRetrievalEngine({records,vocabulary,corpus,joinRoutes:[]}).retrieve({question:'hospital',page_size:20});
 assert.ok(result.results.length>0);assert.equal(result.query.interpretation.subjects.length,0);
 assert.ok(result.results.every(item=>item.match_state==='contextual'));
});
