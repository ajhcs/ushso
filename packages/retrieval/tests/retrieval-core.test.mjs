import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRetrievalEngine } from '../tools/retrieval-core.mjs';
import { compileDiscoveryIntent } from '../tools/intent-compiler.mjs';
import { parseQuestion, validateQuery } from '../tools/question-parser.mjs';
import { validateJoinRoute } from '../tools/join-routes.mjs';
import { projectSearchDocuments } from '../tools/search-document.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(packageRoot, relative), 'utf8'));
const readJsonl = filePath => fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const vocabulary = readJson('fixtures/controlled-vocabulary.json');
const baseRecordIds = new Set([
  'obs:asset:cms-provider-of-services-hospital',
  'obs:asset:unc-sheps-rural-hospital-closures',
  'obs:asset:usda-rural-urban-continuum-codes',
  'obs:asset:aha-annual-survey-database'
]);
const records = readJsonl(path.join(packageRoot, 'corpus', 'records.jsonl')).filter(record => baseRecordIds.has(record.record_id));
const joinRoutes = readJsonl(path.join(packageRoot, 'fixtures', 'base-join-routes.jsonl'));
const engine = createRetrievalEngine({
  records,
  joinRoutes,
  vocabulary,
  corpus: { corpus_id: 'test-base-index', corpus_version: '1.0.0', manifest_sha256: null }
});

test('question interpretation resolves Pennsylvania without false Indiana match', () => {
  const parsed = parseQuestion({ question: 'I need hospital financial and utilization data for Pennsylvania' }, vocabulary);
  assert.deepEqual(parsed.interpretation.geographies.map(item => item.id), ['US-PA']);
  assert.deepEqual(parsed.interpretation.subjects.map(item => item.id), ['hospital_financials', 'utilization']);
  assert.deepEqual(new Set(parsed.interpretation.units_of_analysis.map(item => item.id)), new Set(['hospital', 'facility', 'provider']));
});

test('intent compilation is deterministic, offline, and reports unresolved dimensions', () => {
  const resolved = compileDiscoveryIntent({ question: 'Hospital finance in Pennsylvania' }, vocabulary);
  assert.equal(resolved.intent_version, 'observatory-discovery-intent.v1.0.0');
  assert.equal(resolved.compiler.mode, 'deterministic_controlled_vocabulary');
  assert.equal(resolved.compiler.llm_used, false);
  assert.equal(resolved.compiler.external_requests, 0);
  assert.deepEqual(compileDiscoveryIntent({ question: 'Hospital finance in Pennsylvania' }, vocabulary), resolved);
  const unknown = compileDiscoveryIntent({ question: 'Find relevant information' }, vocabulary);
  assert.ok(unknown.compiler.unknowns.includes('subject_not_resolved'));
  assert.ok(unknown.compiler.unknowns.includes('geography_not_resolved'));
});

test('search documents are non-authoritative, traceable projections', () => {
  const documents = projectSearchDocuments(records, joinRoutes);
  assert.equal(documents.length, records.length);
  assert.ok(documents.every(document => document.authoritative_record === false && document.projection_role === 'discovery_view'));
  assert.ok(documents.every(document => document.projection_inputs.length === 1 && document.evidence_refs.length > 0 && document.provenance_refs.length > 0));
  const cms = documents.find(document => document.resource_record_id === 'obs:asset:cms-provider-of-services-hospital');
  assert.ok(cms.relationship_refs.includes('join:cms-pos:usda-rucc:county-fips'));
});

test('uppercase postal abbreviation is resolved but common lowercase words are not', () => {
  const pa = parseQuestion({ question: 'Hospital ownership in PA' }, vocabulary);
  const prose = parseQuestion({ question: 'What data is in this directory for me?' }, vocabulary);
  assert.deepEqual(pa.interpretation.geographies.map(item => item.id), ['US-PA']);
  assert.deepEqual(prose.interpretation.geographies, []);
});

test('public-only rural closure query excludes licensed AHA while retaining context sources', () => {
  const result = engine.retrieve({ question: 'What public sources can I use to study rural hospital closures in Pennsylvania?', limit: 10 });
  assert.equal(result.contract_version, 'observatory-discovery-result.v1.0.0');
  assert.equal(result.query.interpretation.access_intent.public_only, true);
  assert.deepEqual(result.results.map(item => item.record_id), [
    'obs:asset:unc-sheps-rural-hospital-closures',
    'obs:asset:cms-provider-of-services-hospital',
    'obs:asset:usda-rural-urban-continuum-codes'
  ]);
  assert.ok(!result.results.some(item => item.record.access.status === 'licensed_paid'));
});

test('default discovery retains relevant restricted sources with visible restrictions', () => {
  const result = engine.retrieve({ question: 'What sources can I use to study rural hospital closures?', limit: 10 });
  const aha = result.results.find(item => item.record_id === 'obs:asset:aha-annual-survey-database');
  assert.ok(aha);
  assert.equal(aha.record.access.status, 'licensed_paid');
  assert.ok(aha.relevance.why_relevant.some(reason => reason.includes('Human action is required')));
});

test('explicit join routes include normalized keys, fallbacks, and incompatibility objects', () => {
  const result = engine.retrieve({ question: 'What sources can I use to study rural hospital closures?', limit: 10 });
  assert.deepEqual(result.join_routes.map(route => route.route_id), [
    'join:aha-survey:cms-pos:crosswalk-required',
    'join:cms-pos:usda-rucc:county-fips',
    'join:unc-sheps:cms-pos:facility-name-state'
  ]);
  assert.equal(result.join_routes[0].compatibility_state, 'incompatible');
  assert.ok(result.join_routes.every(route => route.key_pairs.length > 0 && route.caveats.length > 0));
});

test('retrieval is deterministic and zero results are not absence evidence', () => {
  const query = { question: 'Dental asteroid telemetry for PA', limit: 10 };
  const first = engine.retrieve(query);
  const second = engine.retrieve(query);
  assert.deepEqual(second, first);
  assert.equal(first.result_count, 0);
  assert.ok(first.warnings.some(warning => warning.includes('not evidence that no source exists')));
});

test('inferred geography alone is not lexical relevance', () => {
  const result = engine.retrieve({ question: 'Dental asteroid telemetry for Pennsylvania', limit: 10 });
  assert.equal(result.result_count, 0);
  assert.ok(result.warnings.some(warning => warning.includes('not evidence that no source exists')));
});

test('query and join-route guards fail closed', () => {
  assert.throws(() => validateQuery({ question: 'ok?', unknown: true }), /unknown query property/);
  assert.throws(() => validateQuery({ question: 'ok?', time_window: { start_year: 2026, end_year: 2020 } }), /must not exceed/);
  assert.throws(() => validateJoinRoute({ route_id: 'bad' }), /from_record_id/);
});
