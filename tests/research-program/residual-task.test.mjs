import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildResidualManifest,
  buildResidualTask,
  chunkPassages,
  classifyResidualType,
} from '../../packages/enrichment/task-builder.mjs';

test('missing publisher documents abstain and are never converted into a guess', () => {
  assert.equal(classifyResidualType({ missing_publisher_document: true }), 'missing_evidence');
  assert.equal(classifyResidualType({ cause: 'dictionary_locator_unresolved' }), 'table_extraction');
  assert.equal(classifyResidualType({ scientific_ambiguity: true }), 'scientific_ambiguity');
  const abstain = buildResidualTask({
    record_id: 'obs:asset:cms-data-catalog:example',
    field: 'dictionary',
    missing_publisher_document: true,
  });
  assert.equal(abstain.status, 'abstain');
  assert.equal(abstain.model_extraction, false);
  assert.equal(abstain.asks_to_guess_missing_document, false);
  assert.ok(abstain.cannot_conclude.includes('publisher_document_absent'));
  assert.throws(() => buildResidualTask({
    record_id: 'x',
    field: 'dictionary',
    missing_publisher_document: true,
    ask_model_to_guess: true,
  }), { code: 'MISSING_DOCUMENT_NOT_GUESSED' });
  assert.throws(() => buildResidualTask({
    record_id: 'x',
    field: 'access',
    access_blocked: true,
    ask_to_authorize_access: true,
  }), { code: 'MODEL_NOT_ASKED_TO_AUTHORIZE_ACCESS' });
});

test('multi-page tables keep header/denominator and overlapping chunks cannot double-count a field', () => {
  const chunks = chunkPassages({
    field: 'S0101_C01_001E',
    header: 'Variable | Estimate',
    denominator: 'Total population',
    pages: [
      { page: 1, text: 'row a '.repeat(200) },
      { page: 2, text: 'row b '.repeat(200) },
    ],
    tokenBudget: 40,
  });
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.header === 'Variable | Estimate'));
  assert.ok(chunks.every((chunk) => chunk.denominator === 'Total population'));
  assert.ok(chunks.every((chunk) => chunk.field === 'S0101_C01_001E'));
  assert.equal(new Set(chunks.map((chunk) => chunk.field)).size, 1);
});

test('accepted tasks have source bytes and a stable ID; incomplete context abstains; corpus is not processed', () => {
  const accepted = buildResidualTask({
    record_id: 'obs:asset:cdc-socrata:example',
    field: 'definition',
    source_bytes: 'Crude prevalence is the percent of adults.',
    source_release: 'places-2023',
    pages: [{ page: 1, text: 'Crude prevalence is the percent of adults.', header: 'Definition' }],
  });
  assert.equal(accepted.status, 'accepted');
  assert.equal(typeof accepted.source_bytes, 'string');
  assert.match(accepted.task_id, /^task:/);
  const again = buildResidualTask({
    record_id: 'obs:asset:cdc-socrata:example',
    field: 'definition',
    source_bytes: 'Crude prevalence is the percent of adults.',
    source_release: 'places-2023',
    pages: [{ page: 1, text: 'Crude prevalence is the percent of adults.', header: 'Definition' }],
  });
  assert.equal(accepted.task_id, again.task_id);
  const low = buildResidualTask({
    record_id: 'obs:asset:cdc-socrata:example',
    field: 'definition',
    source_bytes: '.',
    low_information: true,
  });
  assert.equal(low.status, 'return_to_parsing');
  const manifest = buildResidualManifest([
    { record_id: 'a', field: 'definition', source_bytes: 'A definition.' },
    { record_id: 'b', field: 'dictionary', missing_publisher_document: true },
  ]);
  assert.equal(manifest.processes_entire_corpus, false);
  assert.ok(manifest.task_count < 3434);
  assert.throws(() => buildResidualTask({ record_id: 'x', field: 'y', entire_corpus: true, source_bytes: 'z' }), { code: 'TASK_NOT_ENTIRE_CORPUS' });
});
