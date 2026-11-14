import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreQuery, aggregate } from '../../scripts/source-selection-evaluation/metrics.mjs';
import { validateQueries, frozenBinding } from '../../scripts/source-selection-evaluation/execute.mjs';
const score = (ids, relevant, membership = relevant, k = 5, status = 'ok') => scoreQuery({query_id:'q', status, ranked:ids.map(unit_id => ({unit_id, match_state:'supported'}))}, {query_id:'q',units:[...new Set([...ids,...relevant])].map(unit_id => ({unit_id,relevance:relevant.includes(unit_id)?'relevant':'irrelevant'}))}, membership,k);
test('rank six does not count at five and missing slots retain denominator', () => {
  assert.equal(score(['a','b','c','d','e','f'],['a','f']).precision_lower, .2);
  assert.equal(score(['a','b'],['a','b']).precision_lower, .4);
});
test('macro differs from micro; missing sources stay in universe', () => {
  const rows = [score(['a'],['a']),score(['b'],['b','c','d'],['b','c'])];
  assert.equal(aggregate(rows).macro_universe_recall, 2/3);
  assert.equal(aggregate(rows).micro_universe_recall, .5);
  assert.equal(rows[1].conditional_recall, .5);
});
test('zero denominator is undefined; duplicates consume slots', () => {
  assert.equal(score([],['missing'],[]).conditional_recall,null);
  const r=score(['a','a','b'],['a','b'],['a','b'],2);
  assert.equal(r.hits,1); assert.equal(r.duplicate_slots,1); assert.equal(r.precision_lower,.5);
});
test('unjudged bounds and failures remain visible', () => {
  const r=scoreQuery({query_id:'q',status:'ok',ranked:[{unit_id:'u'}]}, {query_id:'q',units:[]},['u'],5);
  assert.equal(r.precision_lower,0); assert.equal(r.precision_upper,.2); assert.equal(r.judgment_coverage,0);
  assert.equal(aggregate([score([],['a'],['a'],5,'engine_failed')]).failed_queries,1);
});
test('labels cannot be smuggled into public query cohort', () => {
  assert.throws(()=>validateQueries({cohort_id:'x',split:'public_regression',queries:[{query_id:'q',text:'hospital',expected_ids:['a']}]}),/INVALID_PUBLIC_QUERY/);
});
test('missing required named registry fails closed',async()=>{
  await assert.rejects(frozenBinding([]), /REQUIRED_REGISTRY_MISSING/);
});

test('frozen corpus membership cannot be narrowed by judgments',async()=>{
  const {scoreFrozen}=await import('../../scripts/source-selection-evaluation/score.mjs');
  const {sha}=await import('../../scripts/source-selection-evaluation/execute.mjs');
  const units=['a','b'];
  const receipt={schema:'ushso.frozen-retrieval.v2',cohort_sha256:'cohort',source_unit:'record_id',corpus_units:units,corpus_units_sha256:sha(JSON.stringify(units)),rows:[{query_id:'q',status:'ok',ranked:[{unit_id:'a'}]}]};
  const labels={cohort_sha256:'cohort',source_unit:'record_id',revision:'fixture',independence:'producer_fixture',corpus_units_sha256:receipt.corpus_units_sha256,queries:[{query_id:'q',units:units.map(unit_id=>({unit_id,relevance:'relevant'}))}]};
  assert.equal(scoreFrozen(receipt,labels).metrics[5].aggregate.micro_conditional_recall,.5);
  assert.throws(()=>scoreFrozen(receipt,{...labels,corpus_units:['a']}),/LABELS_MUST_NOT_DEFINE/);
  const before=JSON.stringify(receipt);
  scoreFrozen(receipt,{...labels,queries:[{query_id:'q',units:[{unit_id:'a',relevance:'irrelevant'}]}]});
  assert.equal(JSON.stringify(receipt),before);
});
