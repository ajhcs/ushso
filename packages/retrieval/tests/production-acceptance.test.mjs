import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRetrievalEngine } from '../tools/retrieval-core-v1.2.mjs';
import { documentedPublicPayload, validateCatalogRecords } from '../tools/catalog-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productionRoot = path.join(root, 'versions/v1.2.0');
const corpus = JSON.parse(fs.readFileSync(path.join(productionRoot, 'corpus/corpus.json'), 'utf8'));
const records = corpus.record_files.flatMap(file => fs.readFileSync(path.join(productionRoot, 'corpus', file), 'utf8')
  .trim().split(/\r?\n/).filter(Boolean).map(JSON.parse));
const catalogValidation = validateCatalogRecords(records);
const engine = createRetrievalEngine({
  records: catalogValidation.valid,
  searchDocuments: null,
  joinRoutes: fs.readFileSync(path.join(productionRoot, 'corpus/join-routes.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse),
  vocabulary: JSON.parse(fs.readFileSync(path.join(productionRoot, 'fixtures/controlled-vocabulary.json'), 'utf8')),
  namedSourceRegistry: JSON.parse(fs.readFileSync(path.join(root, 'fixtures/named-source-registry.v1.0.0.json'), 'utf8')),
  corpus,
  catalogValidation
});

function retrieveAll(question) {
  let cursor = null;
  let first = null;
  const results = [];
  do {
    const response = engine.retrieve({ question, page_size: 200, cursor });
    first ??= response;
    results.push(...response.results);
    cursor = response.pagination.next_cursor;
  } while (cursor);
  assert.equal(results.length, first.total_matches);
  assert.equal(new Set(results.map(result => result.record_id)).size, results.length);
  return { response: first, results };
}

test('production publication contract isolates four incompatible records from all 3,434 inputs', () => {
  assert.equal(records.length, 3434);
  assert.equal(catalogValidation.valid.length, 3430);
  assert.equal(catalogValidation.invalid.length, 4);
});

test('production access and exclusion constraints only narrow the complete hospital result set', () => {
  const base = retrieveAll('hospital');
  const baseIds = new Set(base.results.map(result => result.record_id));
  assert.equal(base.results.length, 344);
  for (const question of ['hospital public only', 'hospital public use data only', 'hospital NOT nursing home', 'hospital excluding nursing homes']) {
    const candidate = retrieveAll(question);
    assert.ok(candidate.results.length <= base.results.length, question);
    assert.ok(candidate.results.every(result => baseIds.has(result.record_id)), question);
    assert.deepEqual(candidate.response.query.interpretation.positive_terms.filter(term => term !== 'only'), ['hospital'], question);
  }
  for (const question of ['hospital NOT nursing home', 'hospital excluding nursing homes']) {
    const candidate = retrieveAll(question);
    assert.ok(candidate.results.every(result => !/\bnursing homes?\b/i.test(`${result.record.title} ${result.record.description}`)), question);
  }
});

test('production public-use and ambiguous public-hospital queries are honest across every result', () => {
  const explicit = retrieveAll('Public-use hospital utilization data');
  assert.equal(explicit.results[0].record_id, 'obs:asset:cdc-socrata:tqpr-vcrm-4aa4061557d57dc8');
  assert.ok(explicit.results.every(result => !/\brestricted[ -](?:data|use|file|dataset)\b/i.test(`${result.record.title} ${result.record.description}`)));
  assert.ok(explicit.results.filter(result => result.match_state === 'supported').every(result => documentedPublicPayload(result.record)));

  const ambiguous = retrieveAll('Public hospital utilization data');
  assert.equal(ambiguous.response.query.interpretation.access_intent.ambiguity, 'public_access_or_ownership');
  assert.ok(ambiguous.response.query.interpretation.interpretation_warnings.some(message => /ownership/.test(message)));
  assert.ok(ambiguous.results.every(result => result.match_state !== 'supported'));
});

test('production free-data queries only support records with documented no-fee evidence', () => {
  const free = retrieveAll('hospital free data');
  assert.equal(free.response.query.interpretation.access_intent.cost_requirement, 'documented_no_fee');
  assert.ok(free.results.filter(result => result.match_state === 'supported')
    .every(result => result.metadata.access.cost_state === 'documented_free'));
  assert.ok(free.results.filter(result => result.metadata.access.cost_state === 'unknown')
    .every(result => result.match_state !== 'supported'));
});

test('production essential-concept and named-source negatives cannot become documented matches', () => {
  const ahrq = retrieveAll('AHRQ Compendium of US Health Systems');
  assert.equal(ahrq.results.length, 0);
  assert.equal(ahrq.response.named_source_resolution[0].state, 'coverage_gap');

  const readmission = retrieveAll('hospital readmission rates');
  assert.ok(readmission.results.filter(result => result.match_state === 'supported')
    .every(result => /\breadmissions?\b/i.test(`${result.record.title} ${result.record.description}`)));
  for (const id of ['obs:asset:cdc-socrata:vdzy-6i9v-e9496e442781d677', 'obs:asset:cdc-socrata:bfqg-cb6d-b3024a563b5da4e1']) {
    assert.ok(readmission.results.every(result => result.record_id !== id || result.match_state !== 'supported'));
  }

  const uninsured = retrieveAll('uninsured adults by county');
  assert.equal(uninsured.results[0].record_id, 'obs:asset:census-api:api.census.gov-data-id-sahie-6e4b062e3c39ea95');
  assert.ok(uninsured.results.filter(result => result.match_state === 'supported').every(result => {
    const text = `${result.record.title} ${result.record.description}`;
    return /\buninsured\b/i.test(text) && /\badults?\b/i.test(text) && /\bcounty\b/i.test(text);
  }));
  assert.ok(uninsured.results.filter(result => /Heart Disease Mortality/i.test(result.record.title)).every(result => result.match_state === 'contextual'));
});
