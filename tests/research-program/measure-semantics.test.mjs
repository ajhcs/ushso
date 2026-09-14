import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIXTURES,
  assertDistinctUnits,
  cautionFor,
  defineMeasureSemantics,
  nonEquivalence,
  refuseInferredConversion,
  validateResearchReady,
} from '../../packages/enrichment/measure-semantics.mjs';

test('a rate, count, percentage and monetary total cannot share a unit merely because labels look similar', () => {
  const rate = defineMeasureSemantics({
    measure_id: 'demo:rate',
    label: 'Admission rate',
    unit_kind: 'rate',
    scale_unit: { value: 'per_1000', kind: 'rate', essential: true, evidence_ids: ['ev:r'] },
    denominator: { value: 'population', essential: true, evidence_ids: ['ev:d'] },
  });
  const count = defineMeasureSemantics({
    measure_id: 'demo:count',
    label: 'Admission count',
    unit_kind: 'count',
    scale_unit: { value: 'admissions', kind: 'count', essential: true, evidence_ids: ['ev:c'] },
    denominator: { state: 'unknown' },
  });
  const percentage = FIXTURES.cdc_adult_obesity_prevalence;
  const money = FIXTURES.hcris_net_patient_revenue;
  assert.equal(rate.unit_kind, 'rate');
  assert.equal(count.unit_kind, 'count');
  assert.equal(percentage.unit_kind, 'percentage');
  assert.equal(money.unit_kind, 'monetary_total');
  assertDistinctUnits([rate, count, percentage, money]);
  assert.throws(() => assertDistinctUnits([
    rate,
    defineMeasureSemantics({
      measure_id: 'demo:count-shared',
      label: 'Admission count',
      unit_kind: 'count',
      scale_unit: { value: 'per_1000', kind: 'count', essential: true, evidence_ids: ['ev:bad'] },
    }),
  ]), { code: 'SHARED_UNIT_ACROSS_UNLIKE_MEASURES' });
  for (const field of ['numerator', 'denominator', 'universe', 'scale_unit', 'adjustment', 'weight', 'confidence_interval_moe', 'suppression', 'missingness']) {
    assert.ok(field in percentage.fields);
  }
});

test('maternal versus infant mortality, crude versus adjusted rates and overlapping ACS estimates are explicit non-equivalences', () => {
  const maternal = FIXTURES.cdc_maternal_mortality;
  const infant = FIXTURES.cdc_infant_mortality;
  const obesity = FIXTURES.cdc_adult_obesity_prevalence;
  const acs = FIXTURES.acs_uninsured_estimate;
  const mm = nonEquivalence(maternal, infant, 'maternal deaths are not infant deaths even when both use live births');
  assert.equal(mm.equivalent, false);
  const adj = nonEquivalence(
    defineMeasureSemantics({
      measure_id: 'cdc:crude',
      label: 'crude rate',
      unit_kind: 'rate',
      scale_unit: { value: 'per_100000', kind: 'rate', essential: true, evidence_ids: ['ev:cr'] },
      adjustment: { value: 'crude', evidence_ids: ['ev:cr-a'] },
      denominator: { value: 'population', essential: true, evidence_ids: ['ev:d'] },
    }),
    defineMeasureSemantics({
      measure_id: 'cdc:adjusted',
      label: 'age-adjusted rate',
      unit_kind: 'rate',
      scale_unit: { value: 'per_100000_age_adjusted', kind: 'rate', essential: true, evidence_ids: ['ev:ar'] },
      adjustment: { value: 'age_adjusted', evidence_ids: ['ev:ar-a'] },
      denominator: { value: 'population', essential: true, evidence_ids: ['ev:d'] },
    }),
    'crude and age-adjusted rates are not equivalent',
  );
  assert.equal(adj.equivalent, false);
  const overlap = nonEquivalence(
    acs,
    defineMeasureSemantics({
      measure_id: 'census:acs:uninsured-2017-2021',
      label: 'Uninsured estimate overlapping ACS window',
      unit_kind: 'count',
      scale_unit: { value: 'person_count_2017_2021', kind: 'count', essential: true, evidence_ids: ['ev:acs2'] },
      denominator: { value: 'civilian_noninstitutionalized_population', essential: true, evidence_ids: ['ev:acs2d'] },
      universe: { value: 'acs_5_year_overlapping', evidence_ids: ['ev:acs2u'] },
    }),
    'overlapping ACS 5-year estimates are not independent equivalent counts',
  );
  assert.equal(overlap.equivalent, false);
  assert.equal(obesity.definition_status, 'captured');
  assert.throws(() => refuseInferredConversion({ from: 'drug-a', to: 'drug-b' }), { code: 'CROSS_CONVERSION_WITHOUT_EVIDENCE' });
  const caution = cautionFor(obesity);
  assert.equal(caution.specific, true);
  assert.equal(caution.generic, false);
  assert.ok(caution.text.includes('age_adjusted') || caution.text.includes('obesity'));
});

test('unknown essential denominator blocks research-ready even when an API is executable; optional unknowns are preserved', () => {
  const missing = defineMeasureSemantics({
    measure_id: 'api:unknown-den',
    label: 'Executable API measure',
    unit_kind: 'rate',
    scale_unit: { value: 'per_100000', kind: 'rate', essential: true, evidence_ids: ['ev:u'] },
    denominator: { state: 'unknown', essential: true },
  });
  const result = validateResearchReady(missing, { executableApi: true, recipe: { essential_fields: ['denominator', 'scale_unit'] } });
  assert.equal(result.research_ready, false);
  assert.equal(result.code, 'UNKNOWN_MEASUREMENT_DENOMINATOR');
  assert.equal(result.executable_api, true);
  const ready = validateResearchReady(FIXTURES.cdc_adult_obesity_prevalence, { recipe: { essential_fields: ['denominator', 'scale_unit'] } });
  assert.equal(ready.research_ready, true);
  assert.equal(FIXTURES.hcris_net_patient_revenue.fields.denominator.state, 'unknown');
  assert.equal(FIXTURES.hcris_net_patient_revenue.fields.weight.state, 'unknown');
});
