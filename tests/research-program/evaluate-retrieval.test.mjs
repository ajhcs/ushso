import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HISTORICAL_BASELINE_RECORD_COUNT,
  compareRuns,
  evaluateRetrieval,
  historicalBaselineSeparate,
  loadIdentities,
  loadPublicQuestions,
  runCli,
} from '../../scripts/research-program/evaluate-retrieval.mjs';

const evalDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../evaluation/research-program/retrieval-eval');

test('comparisons reject mismatched cohorts or generations rather than reporting misleading improvements', () => {
  const identities = loadIdentities();
  assert.equal(identities.historical_baseline.retained_separately, true);
  const separated = historicalBaselineSeparate(identities);
  assert.equal(separated.historical_record_count, HISTORICAL_BASELINE_RECORD_COUNT);
  assert.notEqual(separated.current_record_count, HISTORICAL_BASELINE_RECORD_COUNT);
  assert.throws(() => compareRuns({
    generation: identities.current_generation,
    corpus_id: identities.current_corpus.corpus_id,
    corpus_version: identities.current_corpus.corpus_version,
    record_count: identities.current_corpus.record_count,
    algorithm_fingerprint: 'a',
    evaluator_version: 'ushso.retrieval-eval.v1',
  }, {
    generation: identities.current_generation,
    corpus_id: identities.historical_baseline.corpus_id,
    corpus_version: identities.historical_baseline.corpus_version,
    record_count: HISTORICAL_BASELINE_RECORD_COUNT,
    algorithm_fingerprint: 'a',
    evaluator_version: 'ushso.retrieval-eval.v1',
  }), { code: 'MISMATCHED_EVALUATION_COHORT' });
});

test('known absent sources reduce full-universe coverage; they do not silently vanish from the evaluation', () => {
  const result = evaluateRetrieval();
  assert.ok(result.absent_named_sources.includes('ahrq-hcup'));
  assert.ok(result.absent_named_sources.includes('cms-nppes'));
  assert.ok(result.metrics.named_source_misses > 0);
  assert.ok(result.metrics.denominators.universe > result.metrics.denominators.present);
  assert.ok(result.metrics.full_universe_recall < 1);
  const publicQuestions = loadPublicQuestions();
  assert.equal(publicQuestions.held_out_labels_included, false);
  assert.equal(result.held_out_labels_used, false);
  const publicBytes = readFileSync(path.join(evalDir, 'questions.public.json'), 'utf8');
  assert.equal(publicBytes.includes('expected_first_record_id'), false);
  assert.equal(publicBytes.includes('reviewer_disagreement'), false);
});

test('R07 remains incomplete; a failing domain has a bounded remediation task instead of a passing summary; producer tests and reviewer labels are separate', () => {
  const out = runCli();
  assert.equal(out.ok, true);
  assert.equal(out.result.metrics.r07_complete, false);
  assert.ok(out.result.metrics.failing_domains.length >= 1);
  assert.ok(out.result.metrics.failing_domains.every((row) => row.remediation_task && row.passing_summary_forbidden === true));
  assert.equal(out.result.producer_tests_separate_from_reviewer_labels, true);
  const methods = readFileSync(path.join(evalDir, 'METHODS.md'), 'utf8');
  assert.match(methods, /Historical 143-record/);
  assert.match(methods, /R07 remains incomplete/);
});
