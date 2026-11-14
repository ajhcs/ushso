import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {browserRecordErrors,descriptionQuality,hasEvidenceBoundMissingDescription,validateCatalogRecords} from '../tools/catalog-contract.mjs';
import {createRetrievalEngine} from '../tools/retrieval-core-v1.2.mjs';
const root=new URL('../versions/v1.2.0/',import.meta.url);
const records=[1,2,3].flatMap(n=>fs.readFileSync(new URL(`corpus/records-000${n}.jsonl`,root),'utf8').trim().split('\n').map(JSON.parse));
const missing=records.filter(record=>record.description==='');
test('four preserved missing descriptions remain searchable inventory with explicit missing state',()=>{
 assert.equal(missing.length,4);
 const vocabulary=JSON.parse(fs.readFileSync(new URL('fixtures/controlled-vocabulary.json',root)));
 const before=JSON.stringify(missing);
 const engine=createRetrievalEngine({allowEvidenceBoundMissingDescriptions:true,records:missing,vocabulary,corpus:{corpus_id:'missing-description-review',corpus_version:'synthetic'},joinRoutes:[]});
 assert.equal(engine.browse({page_size:20}).results.length,4);
 for(const record of missing){assert.equal(hasEvidenceBoundMissingDescription(record),true);assert.deepEqual(browserRecordErrors(record,{allowEvidenceBoundMissingDescriptions:true}),[]);assert.equal(descriptionQuality(record).state,'missing');assert.equal(descriptionQuality(record).raw_description,'');assert.equal(descriptionQuality(record).display_description,'')}
 assert.equal(JSON.stringify(missing),before);
});
test('missing description cannot bypass absent identity, missing evidence or failed capture',()=>{
 for(const mutate of [r=>r.identity.match_fields.source_id='',r=>r.identity.asset.asset_id='mismatched',r=>r.evidence=[],r=>r.provenance[0].capture_state='locator_only',r=>r.provenance[0].content_sha256=null,r=>r.description=null]){
 const record=structuredClone(missing[0]);mutate(record);assert.equal(hasEvidenceBoundMissingDescription(record),false);assert.equal(validateCatalogRecords([record],{allowEvidenceBoundMissingDescriptions:true}).invalid.length,1);
 }
});
