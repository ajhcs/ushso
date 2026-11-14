import {withSubjectSupportTransition} from '../../../tests/helpers/subject-support-transition.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRetrievalEngine} from '../tools/retrieval-core-v1.2.mjs';
const tools=new URL('../tools/',import.meta.url);
const old=await fs.readFile(new URL('../fixtures/retrieval-core-before-lexical-index.txt',import.meta.url),'utf8');
const reference=await import('data:text/javascript;base64,'+Buffer.from(old.replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${new URL(p,tools).href}'`)).toString('base64'));
const fixture=JSON.parse((await fs.readFile(new URL('../corpus/records.jsonl',import.meta.url),'utf8')).trim().split('\n')[0]);
const vocabulary=JSON.parse(await fs.readFile(new URL('../fixtures/controlled-vocabulary.json',import.meta.url)));
const texts=[['Hospital reports reports','Counties report care'],['Reporting hospitals','Hospital reports'],['Hospitality','Unrelated'],['County care','Counties counties'],['Alpha-beta Γάμμα','Prices and diagnoses'],['Alpha','Beta gamma']];
const records=texts.map(([title,description],i)=>{const r=structuredClone(fixture);r.record_id=`fixture:lexical:${i}`;r.identity.asset.asset_id=r.record_id;r.identity.asset.name=title;r.title=title;r.description=description;return r});
function withoutFacetLabels(value){const normalize=value=>{if(typeof value==='string'){try{const cursor=JSON.parse(Buffer.from(value,'base64url').toString());if(cursor.v===1&&cursor.signature&&Number.isInteger(cursor.offset)){cursor.signature='[ranking-sensitive]';return JSON.stringify(cursor)}}catch{}return value}if(Array.isArray(value))return value.map(normalize);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,normalize(item)]));return value};const copy=normalize(value);if(copy.pagination.cursor)copy.retrieval_id='[cursor-derived-retrieval-id]';copy.ranking.version='[version]';copy.receipt.ranking_version='[version]';for(const section of copy.facets?.sections ?? [])for(const option of section.options)option.label='[facet-label]';return copy;}
for(const mode of ['projected','on_demand'])test(`compact lexical index preserves complete output: ${mode}`,()=>{
 const options={records,vocabulary,joinRoutes:[],namedSourceRegistry:{sources:[]},corpus:{corpus_id:'lexical-parity',corpus_version:'test'},...(mode==='on_demand'?{searchDocuments:null}:{})};
 const before=reference.createRetrievalEngine(options),after=createRetrievalEngine(options);
 for(const question of ['hospital','hospitals','report','reports','county','counties','care','hospitality','hospital reports','alpha beta','gamma','price','diagnoses','hospital NOT care','zzzznonexistent'])for(const sort of ['canonical_relevance','title_asc','release_newest','observation_latest']){
  const query={question,sort,page_size:2};let cursor=null,candidateCursor=null;do{const a=before.retrieve({...query,cursor}),b=after.retrieve({...query,cursor:candidateCursor});assert.deepEqual(withoutFacetLabels(b),withoutFacetLabels(withSubjectSupportTransition(a)),question+' '+sort);cursor=a.pagination.next_cursor;candidateCursor=b.pagination.next_cursor}while(cursor);
 }
});
