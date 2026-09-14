import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HELD_OUT_LABELS_USED,
  NONSENSE_PENNSYLVANIA_QUERY,
  applyExclusions,
  classifyNearMiss,
  explain,
  loadRelevanceFixtures,
  maternalInfantNonEquivalence,
  rankScientific,
  scopedZero,
} from '../../packages/enrichment/relevance.mjs';

const fixtures = loadRelevanceFixtures();

test('fixtures identify forbidden, uncertain or merely contextual matches; no test expects a title-only answer', () => {
  assert.equal(fixtures.held_out_labels_used, false);
  assert.equal(HELD_OUT_LABELS_USED, false);
  const maternal = fixtures.cases.find((item) => item.case_id === 'maternal-vs-infant-mortality');
  const infant = classifyNearMiss(maternal.question, maternal.candidates[1]);
  assert.equal(infant.state, 'forbidden');
  assert.equal(infant.title_only, false);
  const psi = fixtures.cases.find((item) => item.case_id === 'readmissions-vs-psi');
  assert.equal(classifyNearMiss(psi.question, psi.candidates[1]).state, 'contextual');
  const relief = fixtures.cases.find((item) => item.case_id === 'provider-relief-vs-quality');
  assert.equal(classifyNearMiss(relief.question, relief.candidates[1]).state, 'forbidden');
  const rates = fixtures.cases.find((item) => item.case_id === 'insurer-rate-vs-enforcement');
  assert.equal(classifyNearMiss(rates.question, rates.candidates[1]).state, 'uncertain');
  const period = fixtures.cases.find((item) => item.case_id === 'observation-period-mismatch');
  assert.equal(classifyNearMiss(period.question, period.candidates[1]).state, 'uncertain');
  assert.equal(maternalInfantNonEquivalence().equivalent, false);
});

test('an explicit without Census filter excludes Census; maternal mortality does not promote infant data as the leading compatible result', () => {
  const censusCase = fixtures.cases.find((item) => item.case_id === 'without-census');
  const filtered = applyExclusions(censusCase.question, censusCase.candidates);
  assert.deepEqual(filtered.excluded.map((row) => row.record_id), ['census-sahie']);
  assert.ok(filtered.retained.some((row) => row.record_id === 'fac-census-note'));
  const ranked = rankScientific(censusCase.question, censusCase.candidates);
  assert.ok(ranked.excluded.every((row) => row.reason === 'EXPLICIT_WITHOUT_CENSUS'));

  const maternal = fixtures.cases.find((item) => item.case_id === 'maternal-vs-infant-mortality');
  const result = rankScientific(maternal.question, maternal.candidates);
  assert.equal(result.leading.record_id, 'cdc-nvss-maternal-mortality');
  assert.notEqual(result.leading.measure, 'infant_mortality');
  assert.equal(result.ranked.find((row) => row.measure === 'infant_mortality').state, 'forbidden');
});

test('the nonsense-plus-Pennsylvania query remains a scoped zero; ranking reasons agree with actual filters and evidence', () => {
  const nonsense = fixtures.cases.find((item) => item.case_id === 'nonsense-pennsylvania');
  const zero = scopedZero(NONSENSE_PENNSYLVANIA_QUERY, nonsense.candidates);
  assert.equal(zero.result_count, 0);
  assert.equal(zero.state, 'scoped_zero');
  const censusCase = fixtures.cases.find((item) => item.case_id === 'without-census');
  const ranked = rankScientific(censusCase.question, censusCase.candidates);
  for (const row of ranked.excluded) {
    const explained = explain(row);
    assert.equal(explained.agrees_with_filter, true);
    assert.equal(explained.state, 'excluded');
  }
});
