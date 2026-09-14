import assert from 'node:assert/strict';
import test from 'node:test';
import { parseConstrainedExtraction } from '../../packages/enrichment/extract.mjs';
import { validateBatch, validateClaim } from '../../packages/enrichment/validate-claims.mjs';
import { buildResidualTask } from '../../packages/enrichment/task-builder.mjs';

const source = 'Crude prevalence is the percent of adults. The unit is percent.';
const task = buildResidualTask({
  record_id: 'obs:asset:cdc-socrata:example',
  field: 'definition',
  source_bytes: source,
  pages: [{ page: 1, text: source, header: 'Definition' }],
});

const good = {
  field: 'definition',
  value: 'percent of adults',
  passage_ids: [task.chunks[0].chunk_id],
  quotation: 'percent of adults',
  span: { start: source.indexOf('percent of adults'), end: source.indexOf('percent of adults') + 'percent of adults'.length },
  claim_type: 'definition',
  uncertainty: 'certain',
  abstention_reason: null,
};

test('schema-valid JSON cannot introduce an unknown field, citation or record ID', () => {
  assert.throws(() => parseConstrainedExtraction({ ...good, field: 'secret_field' }, task), { code: 'UNKNOWN_FIELD' });
  assert.throws(() => parseConstrainedExtraction({ ...good, passage_ids: ['invented-passage'] }, task), { code: 'UNKNOWN_CITATION' });
  assert.throws(() => parseConstrainedExtraction({ ...good, record_id: 'obs:asset:other:record' }, task), { code: 'UNKNOWN_RECORD_ID' });
  const parsed = parseConstrainedExtraction(good, task);
  assert.equal(parsed.schema_valid, true);
  assert.equal(parsed.scientific_certified, false);
});

test('quote matching is not scientific certification and wrong semantic role is review', () => {
  const accepted = validateClaim({ task, raw: good });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.resolvable_citation, true);
  assert.equal(accepted.scientific_certified, false);
  assert.equal(accepted.quote_match, true);
  const wrongRole = validateClaim({
    task,
    raw: { ...good, claim_type: 'unit', value: 'percent of adults' },
  });
  assert.equal(wrongRole.status, 'review');
  assert.equal(wrongRole.quote_match, true);
  assert.equal(wrongRole.scientific_certified, false);
  const hallucinated = validateClaim({
    task,
    raw: { ...good, quotation: 'this sentence is not in the capture', span: { start: 0, end: 5 }, value: 'invented prevalence' },
  });
  assert.equal(hallucinated.status, 'rejected');
  assert.ok(hallucinated.reasons.includes('SCHEMA_VALID_HALLUCINATION'));
  assert.equal(hallucinated.schema_valid, true);
});

test('unsupported claims stay rejected across reruns and accepted literals are traceable without calling the model', () => {
  const first = validateClaim({
    task,
    raw: { ...good, quotation: 'missing quote', span: { start: 0, end: 4 }, value: 'guess' },
  });
  assert.equal(first.status, 'rejected');
  const second = validateClaim({
    task,
    raw: { ...good, quotation: 'missing quote', span: { start: 0, end: 4 }, value: 'guess' },
    prior: { hash: first.hash, status: 'rejected' },
  });
  assert.equal(second.status, 'rejected');
  assert.equal(second.retry, false);
  assert.equal(second.reason, 'UNSUPPORTED_CLAIM_STABLE');
  const syntax = validateClaim({ task, raw: '{not json' });
  assert.equal(syntax.retry, true);
  const traced = validateClaim({ task, raw: good });
  assert.equal(traced.traceable_without_model, true);
  const batch = validateBatch([{ task, raw: good }]);
  assert.equal(batch.accepted_with_resolvable_citations, true);
});


test('literal and table values require support in the actual cited quotation', () => {
  const text = 'Published count is 12. Other count is 999999. Zero is 0.';
  const localTask = buildResidualTask({record_id:'review:literal',field:'count',source_bytes:text});
  const quotation = 'Published count is 12.';
  const proposal = {...good,field:'count',value:'12',passage_ids:['source'],quotation,span:{start:0,end:quotation.length},claim_type:'literal'};
  for (const claim_type of ['literal','table_value']) {
    assert.equal(validateClaim({task:localTask,raw:{...proposal,claim_type}}).status,'accepted');
    for (const value of ['999999','2','',null]) {
      assert.equal(validateClaim({task:localTask,raw:{...proposal,value,claim_type}}).status,'rejected');
    }
  }
  for (const [quotation,value] of [['.5','5'],['-.5','.5'],['−.5','.5']]) {
    assert.equal(validateClaim({task:{...localTask,source_bytes:quotation},raw:{...proposal,value,quotation,span:{start:0,end:quotation.length}}}).status,'rejected');
  }
  const start = text.indexOf('Zero is 0.');
  assert.equal(validateClaim({task:localTask,raw:{...proposal,value:'0',quotation:'Zero is 0.',span:{start,end:text.length}}}).status,'accepted');
  for (const quotation of ['120','-12','−12','12.5','12,000']) {
    assert.equal(validateClaim({task:{...localTask,source_bytes:quotation},raw:{...proposal,quotation,span:{start:0,end:quotation.length}}}).status,'rejected');
  }
});

test('source-global spans must resolve inside every cited passage, not prompt prefixes or another page', () => {
  const first = 'Published count is 12.';
  const second = 'The unit is percent.';
  const text = first + '\n' + second;
  const localTask = buildResidualTask({record_id:'review:pages',field:'unit',source_bytes:text,pages:[{page:1,text:first,header:'percent'},{page:2,text:second,header:'Unit'}]});
  const start = text.lastIndexOf('percent');
  const proposal = {...good,field:'unit',claim_type:'unit',value:'percent',quotation:'percent',span:{start,end:start+7},passage_ids:['2.0']};
  assert.equal(validateClaim({task:localTask,raw:proposal}).status,'accepted');
  for (const passage_ids of [['1.0'],['source','1.0'],[],['missing']]) {
    assert.equal(validateClaim({task:localTask,raw:{...proposal,passage_ids}}).status,'rejected');
  }
  for (const span of [{start:999,end:1006},{start:-1,end:6},{start:start+0.5,end:start+7.5},{start,end:start},{start:0,end:7}]) {
    assert.equal(validateClaim({task:localTask,raw:{...proposal,span}}).status,'rejected');
  }
  assert.equal(validateClaim({task:localTask,raw:{...proposal,claim_type:'abstention',value:null,abstention_reason:'insufficient evidence'}}).status,'rejected');
});

test('unit and definition values elsewhere in a source do not support a cited claim', () => {
  const text = 'Unit: percent. Unit: dollars.';
  for (const claim_type of ['unit','definition']) {
    const localTask = {record_id:'review:scope',field:claim_type,source_bytes:text};
    const raw = {...good,field:claim_type,claim_type,value:'dollars',quotation:'percent',passage_ids:['source'],span:{start:6,end:13}};
    const result = validateClaim({task:localTask,raw});
    assert.equal(result.status,'rejected');
    assert.ok(result.reasons.includes('UNSUPPORTED_QUOTED_VALUE'));
  }
});
