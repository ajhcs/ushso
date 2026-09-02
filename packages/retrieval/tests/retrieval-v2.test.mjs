import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRetrievalV2Engine, RETRIEVAL_V2_VERSION } from '../tools/retrieval-v2.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(packageRoot, relative), 'utf8'));
const readJsonl = relative => fs.readFileSync(path.join(packageRoot, relative), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);

const records = readJsonl('versions/v1.1.0/corpus/records.jsonl');
const searchDocuments = readJsonl('versions/v1.1.0/corpus/search-documents.jsonl');
const joinRoutes = readJsonl('versions/v1.1.0/corpus/join-routes.jsonl');
const vocabulary = readJson('versions/v1.1.0/fixtures/controlled-vocabulary.json');
const corpus = readJson('versions/v1.1.0/corpus/corpus.json');

function engine() {
  return createRetrievalV2Engine({ records, searchDocuments, joinRoutes, vocabulary, corpus });
}

test('v2 is deterministic, versioned, and explicitly development/validation scoped', () => {
  const query = { question: 'What public datasets could I use to study rural hospital closures?', limit: 10 };
  const first = engine().retrieve(query);
  const second = engine().retrieve(query);
  assert.deepEqual(second, first);
  assert.equal(first.ranking.algorithm_version, RETRIEVAL_V2_VERSION);
  assert.equal(first.ranking.tuning_scope, 'development_and_validation_only');
  assert.equal(first.ranking.final_holdout_accessed, false);
  assert.deepEqual(first.results.slice(0, 3).map(result => result.record_id), [
    'obs:asset:unc-sheps-rural-hospital-closures',
    'obs:asset:cms-provider-of-services-hospital',
    'us-federal:usda-rural-urban-continuum-codes'
  ]);
});

test('public retrieval excludes restricted projections and collapses exact source duplicates', () => {
  const result = engine().retrieve({ question: 'What public data describes the financial condition of nonprofit health systems?', limit: 20 });
  assert.ok(result.results.length > 0);
  assert.ok(result.results.every(item => !['registration_required', 'application_required', 'dua_required', 'licensed_paid', 'controlled'].includes(item.record.access.status)));
  const sourceIds = result.results.map(item => item.record.identity?.match_fields?.source_id).filter(Boolean);
  assert.equal(new Set(sourceIds).size, sourceIds.length);
});

test('facility framing favors a bounded facility/status source', () => {
  const result = engine().retrieve({ question: 'Which current index record is facility-level rather than county-level?', limit: 5 });
  assert.equal(result.results[0].record_id, 'us-federal:cms-provider-of-services');
  assert.ok(result.results[0].relevance.matched_anchors.includes('facility_status_anchor'));
});

test('v2 applies explicit grain and query-role safety constraints', () => {
  const daily = engine().retrieve({ question: 'Which public dataset gives comparable daily profitability for every hospital in all states?', limit: 20 });
  assert.equal(daily.results.length, 0);

  const namedPatient = engine().retrieve({ question: 'Can the current public index provide named-patient insurer claims linked to hospital facilities?', limit: 20 });
  assert.equal(namedPatient.results.length, 0);

  const facilityClaims = engine().retrieve({ question: 'Where is an anonymous, no-application, insurer-level all-payer claims file with facility and day granularity?', limit: 20 });
  assert.equal(facilityClaims.results.length, 0);
});

test('v2 keeps local-source and facility-role requests from emitting near-miss records', () => {
  const pennsylvania = engine().retrieve({ question: 'Which public Pennsylvania source reports hospital financial condition?', limit: 20 });
  assert.equal(pennsylvania.results[0].record_id, 'obs:asset:pa-phc4-public-financial-reports');
  assert.ok(!pennsylvania.results.some(result => result.record_id === 'us-federal:cms-hcris-cost-reports'));

  const facilityStatus = engine().retrieve({ question: 'Which original federal source provides current hospital facility identifiers and status?', limit: 20 });
  assert.ok(!facilityStatus.results.some(result => result.record_id === 'us-federal:cms-hcris-cost-reports'));

  const nonprofitStatus = engine().retrieve({ question: 'What public federal source provides the nonprofit-organization universe and status?', limit: 20 });
  assert.equal(nonprofitStatus.results[0].record_id, 'us-federal:irs-exempt-organizations-bmf');
  assert.ok(!nonprofitStatus.results.some(result => result.record_id === 'us-federal:irs-teos-990-xml'));
});
