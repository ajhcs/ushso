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
