import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_ROOT, PROJECT_ROOT, runValidation, validateRecordShape } from '../tools/validate_benchmark.mjs';

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, relativePath), 'utf8'));
}

async function readJsonl(relativePath) {
  const text = await fs.readFile(path.join(PACKAGE_ROOT, relativePath), 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

test('offline package validator passes with zero external requests', async () => {
  const result = await runValidation({ writeReport: false });
  assert.equal(result.ok, true, result.issues.join('\n'));
  assert.equal(result.report.status, 'PASS');
  assert.equal(result.report.external_requests, 0);
});

test('question partitions and response-type counts reconcile exactly', async () => {
  const questions = await readJsonl('questions.jsonl');
  const count = (items, key) => items.reduce((out, item) => { out[item[key]] = (out[item[key]] ?? 0) + 1; return out; }, {});
  assert.equal(questions.length, 60);
  assert.deepEqual(count(questions, 'geographic_composition'), {
    pennsylvania: 12,
    national_federal: 12,
    comparative_multi_state: 12,
    other_state_locality: 12,
    geography_ambiguous_or_independent: 12
  });
  assert.deepEqual(count(questions, 'expected_response_type'), {
    single_source: 18,
    multi_source_bundle: 24,
    clarification_required: 10,
    unsupported_or_incomplete: 8
  });
  assert.deepEqual(count(questions, 'split'), { development: 20, validation: 20, held_out: 20 });
  assert.equal(new Set(questions.map(item => item.topic_cluster)).size, 60);
});

test('all positive and negative judgments resolve to existing source records and evidence', async () => {
  const sourceIndex = await readJson('source_reference_index.json');
  const sourceById = new Map(sourceIndex.sources.map(item => [item.source_record_id, item]));
  const judgments = [...await readJsonl('relevance_judgments.jsonl'), ...await readJsonl('negative_judgments.jsonl')];
  assert.ok(judgments.length > 0);
  for (const judgment of judgments) {
    const source = sourceById.get(judgment.source_record_id);
    assert.ok(source, `${judgment.judgment_id} source missing`);
    assert.ok(judgment.evidence_references.length > 0, `${judgment.judgment_id} evidence missing`);
    assert.equal(judgment.source_family_id, source.source_family_id);
    for (const evidence of judgment.evidence_references) {
      await fs.access(path.join(PROJECT_ROOT, evidence.artifact_path));
      assert.ok(evidence.locator);
    }
  }
});

test('multi-source goldens are coherent and never claim proven joins', async () => {
  const bundles = await readJsonl('bundle_gold.jsonl');
  const sources = await readJson('source_reference_index.json');
  const sourceIds = new Set(sources.sources.map(item => item.source_record_id));
  assert.equal(bundles.length, 24);
  for (const bundle of bundles) {
    assert.notEqual(bundle.join_status, 'join_proven');
    assert.equal(bundle.actual_join_proven, false);
    assert.ok(bundle.minimum_viable_bundle.length >= 2);
    assert.equal(new Set(bundle.minimum_viable_bundle).size, bundle.minimum_viable_bundle.length);
    assert.ok(bundle.minimum_viable_bundle.every(id => sourceIds.has(id)));
    assert.ok(bundle.required_analytical_roles.length >= 2);
    assert.ok(bundle.required_analytical_roles.every(role => role.source_record_ids.every(id => bundle.minimum_viable_bundle.includes(id))));
  }
});

test('valid and invalid fixtures exercise the declared schema boundaries', async () => {
  const schema = async name => readJson(`schemas/${name}`);
  const validQuestion = await readJson('fixtures/valid/question.valid.json');
  assert.deepEqual(validateRecordShape(validQuestion, await schema('question.schema.json')), []);
  const invalidCases = [
    ['fixtures/invalid/question.missing-access.json', 'question.schema.json'],
    ['fixtures/invalid/relevance.no-evidence.json', 'relevance-judgment.schema.json'],
    ['fixtures/invalid/bundle.unknown-join-status.json', 'bundle-gold.schema.json'],
    ['fixtures/invalid/negative.recommended.json', 'negative-judgment.schema.json']
  ];
  for (const [fixture, schemaName] of invalidCases) {
    const errors = validateRecordShape(await readJson(fixture), await schema(schemaName));
    assert.ok(errors.length > 0, `${fixture} unexpectedly passed`);
  }
  const unsupportedQuestion = (await readJsonl('questions.jsonl')).find(item => item.expected_response_type === 'unsupported_or_incomplete');
  const confidentUnsupported = await readJson('fixtures/invalid/answer-plan.confident-unsupported.json');
  assert.equal(confidentUnsupported.question_id, unsupportedQuestion.question_id);
  assert.equal(confidentUnsupported.recommendation.mode, 'single_source');
  assert.ok(confidentUnsupported.recommendation.source_record_ids.includes('fake'));
});

test('manifest and package controls remain offline and retrieval-free', async () => {
  const manifest = await readJson('package_manifest.json');
  assert.equal(manifest.package_version, '0.1.0');
  assert.equal(manifest.offline, true);
  assert.equal(manifest.external_requests, 0);
  assert.equal(manifest.identity_merge_performed, false);
  assert.equal(manifest.retrieval_engine_implemented, false);
  const files = (await fs.readdir(path.join(PACKAGE_ROOT, 'tools'))).filter(file => file.endsWith('.mjs'));
  for (const file of files) {
    const source = await fs.readFile(path.join(PACKAGE_ROOT, 'tools', file), 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(/i, `${file} contains fetch`);
    assert.doesNotMatch(source, /\bhttps?\.request\b/i, `${file} contains HTTP request code`);
  }
});

test('required seeds are present and held-out questions have deterministic IDs', async () => {
  const stats = await readJson('benchmark_statistics.json');
  assert.ok(Object.values(stats.seed_coverage).every(item => item.matched));
  const splits = await readJson('benchmark_splits.json');
  assert.equal(splits.seed, 'QTD-O3-v0.1.0-fixed');
  assert.deepEqual(splits.counts, { development: 20, validation: 20, held_out: 20 });
  assert.equal(splits.leakage_controls.cross_split_near_duplicate_pairs.length, 0);
});
