import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRetrievalEngine as control} from './fixtures/direct-base-control.mjs';
import {createRetrievalEngine as candidate} from '../packages/retrieval/tools/retrieval-core-v1.2.mjs';

const {corpus,record,vocabulary}=JSON.parse(await fs.readFile(new URL('./fixtures/direct-base-input.json',import.meta.url)));

test('private normalized phrase predicate rejects empty invalid input without hanging',async()=>{
  const source=await fs.readFile(new URL('../packages/retrieval/tools/retrieval-core-v1.2.mjs',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('function normalizedPhrasePresent('),source.indexOf('\nfunction prepareScoring('));
  const predicate=new Function(body+';return normalizedPhrasePresent;')();
  for(const text of ['', 'a', ' ', 'hospital cost'])assert.equal(predicate(text,''),false);
  for(const [text,phrase,expected]of [['hospital cost','hospital',true],['hospitality','hospital',false],['a mental health b','mental health',true],['a mental healthcare','mental health',false]])assert.equal(predicate(text,phrase),expected);
});

function facetLabelMap(response){
  return Object.fromEntries((response.facets?.sections ?? []).map(section=>[
    section.id,
    Object.fromEntries((section.options ?? []).map(option=>[option.value,option.label]))
  ]));
}

function withoutFacetOptionLabels(response){
  const copy=structuredClone(response);
  for(const section of copy.facets?.sections ?? []){
    for(const option of section.options ?? [])delete option.label;
  }
  return copy;
}

const commonPublicLabels={
  source:{'cdc-socrata':'Centers for Disease Control and Prevention Data Catalog'},
  geography:{unknown:'Geography unresolved'},
  access_status:{public_catalog:'Public catalog metadata; payload access unresolved'},
  unit_of_analysis:{unknown:'Observation unit unresolved'}
};
function expectedPublicLabels(capability){
  return {...commonPublicLabels,capability};
}

for(const [name,capabilities,description,publicLabels]of [
  ['document aliases without capability',[], 'Mental health and substance use treatment facility information.',expectedPublicLabels({})],
  ['contextual capability independently matches', [{id:'context-health',label:'Mental health',rationale:'Contextual metadata.',fitness:'context_only',evidence_state:'inferred'}], 'Other indexed metadata.',expectedPublicLabels({'context-health':'Mental health'})],
  ['identity capability preserves exact reasons', [{id:'behavioral_health',label:'Behavioral health',rationale:'Mental health.',fitness:'primary',evidence_state:'source_asserted'}], 'Mental health and addiction.',expectedPublicLabels({behavioral_health:'Behavioral health'})],
  ['multiple aliases preserve capability order and ties', [{id:'first-context',label:'Mental health',rationale:'Substance use.',fitness:'supporting',evidence_state:'inferred'},{id:'second-context',label:'Addiction',rationale:'Mental health.',fitness:'supporting',evidence_state:'inferred'}], 'Mental health mental health substance use addiction.',expectedPublicLabels({'first-context':'Mental health','second-context':'Addiction'})]
])test('subject short circuit preserves byte order and reasons: '+name,()=>{
  const rows=['Zulu metadata','Alpha metadata','Middle metadata'].map((title,i)=>({...structuredClone(record),record_id:record.record_id+'-subject-'+i,title,description,capabilities:{topics:capabilities.map(c=>({...c,evidence_ids:record.capabilities.topics[0].evidence_ids})),use_cases:[]}}));
  const before=JSON.stringify(rows),args={records:rows,searchDocuments:null,vocabulary,corpus,catalogValidation:{valid:rows,invalid:[]}},a=control(args),b=candidate(args);
  for(const sort of ['canonical_relevance','title_asc','release_newest','observation_latest']){
    const query={question:'mental health',sort,limit:10},expected=a.retrieve(query),actual=b.retrieve(query);
    assert.ok(expected.results.length>0,'fixture must produce actual subject matches');
    assert.deepEqual(facetLabelMap(expected),Object.fromEntries(Object.entries(facetLabelMap(expected)).map(([section,options])=>[section,Object.fromEntries(Object.keys(options).map(value=>[value,value]))])),'frozen control labels remain raw facet values');
    assert.deepEqual(facetLabelMap(actual),publicLabels,'candidate public facet labels remain independently expected');
    assert.equal(JSON.stringify(withoutFacetOptionLabels(actual)),JSON.stringify(withoutFacetOptionLabels(expected)),'all non-label response bytes remain exact');
    if(name==='document aliases without capability'&&sort==='canonical_relevance'){
      const mutated=withoutFacetOptionLabels(actual);
      mutated.pagination.total_matches+=1;
      assert.notEqual(JSON.stringify(mutated),JSON.stringify(withoutFacetOptionLabels(expected)),'a representative non-label mutation must fail parity');
    }
  }
  assert.equal(JSON.stringify(rows),before);
});
