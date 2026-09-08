import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseGridContexts, verifyCmsGridItem } from '../scripts/research/package-cms-grid-review.mjs';
test('malformed peers and no-row records isolate without removing valid context',()=>{
 const good={record_id:'asset.good',variables:2,pdf_sha256:'a',publisher_url:'https://data.cms.gov/a',release_binding:{release:'2024'}};
 const result=chooseGridContexts([null,good,{record_id:'asset.empty',variables:0}]);
 assert.deepEqual(result.selected,[good]);assert.deepEqual(result.isolated.map(x=>x.code),['MALFORMED_GRID_ENTRY','NO_EXTRACTED_GRID_ROWS']);
});
test('multiple release or document contexts never silently concatenate',()=>{
 const a={record_id:'asset.good',variables:2,pdf_sha256:'a',publisher_url:'https://data.cms.gov/a',release_binding:{release:'2024'}};
 for(const b of [{...a,pdf_sha256:'b'},{...a,variables:0,release_binding:{release:'2023'}},{...a}]){
  const r=chooseGridContexts([a,b]);assert.equal(r.selected.length,0);assert.equal(r.isolated[0].code,'AMBIGUOUS_DICTIONARY_CONTEXT');
 }
});
test('invalid hash and wrong generation rejected before reading external inputs',async()=>{
 await assert.rejects(verifyCmsGridItem({record_id:'asset.a'},{}),/GRID_HASH_IDENTITY/);
 const hash='a'.repeat(64),item={record_id:'asset.a',pdf_sha256:hash,geometry_sha256:hash,source_record_sha256:hash,baseline_record_sha256:hash};
 await assert.rejects(verifyCmsGridItem(item,{records:new Map(),generation:'generation.actual'}),/GRID_RECORD_GENERATION/);
});
