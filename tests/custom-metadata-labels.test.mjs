import test from 'node:test';
import assert from 'node:assert/strict';
import {customMetadataDimensions} from '../scripts/research/source-extractors.mjs';
test('Muse: publisher metadata classification uses whole words, not candidate/mandate substrings',()=>{
 for(const label of ['Candidate','Mandate','candidateCoverage','accessibility','licentious'])assert.deepEqual(customMetadataDimensions(label),[]);
 for(const label of ['Date Updated','Temporal Applicability','Reporting Period','dateUpdated'])assert.deepEqual(customMetadataDimensions(label),['dates']);
 for(const label of ['Geographic Coverage','Spatial Extent'])assert.deepEqual(customMetadataDimensions(label),['geography']);
 for(const label of ['Access Rights','License','Restrictions'])assert.deepEqual(customMetadataDimensions(label),['access_requirements']);
});
