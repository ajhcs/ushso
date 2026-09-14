import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkSample,
  classifyValue,
  definePriceContext,
  refuseMeasureCollapse,
  refusePassingSampleClaims,
  summarizeSample,
} from '../../packages/connectors/mrf/price-semantics.mjs';
import { refuseComparableDollar } from '../../packages/connectors/mrf/hospital-json.mjs';

test('a gross charge, discounted cash price, negotiated amount and allowed amount remain different measures', () => {
  const gross = definePriceContext({ measure: 'gross_charge', code_system: 'CPT', code: '99214', setting: 'outpatient', effective_period: '2026' });
  const cash = definePriceContext({ measure: 'discounted_cash', code_system: 'CPT', code: '99214', setting: 'outpatient', effective_period: '2026' });
  const negotiated = definePriceContext({ measure: 'negotiated_amount', code_system: 'CPT', code: '99214', setting: 'outpatient', effective_period: '2026', payer: 'Platform' });
  const allowed = definePriceContext({ measure: 'allowed_amount', code_system: 'CPT', code: '99214', setting: 'outpatient', effective_period: '2026', payer: 'Platform' });
  assert.notEqual(gross.measure, cash.measure);
  assert.notEqual(negotiated.measure, allowed.measure);
  assert.throws(() => refuseMeasureCollapse(gross, cash), { code: 'DISTINCT_PRICE_MEASURES_NOT_COMPARABLE' });
  assert.throws(() => refuseMeasureCollapse(negotiated, allowed), { code: 'DISTINCT_PRICE_MEASURES_NOT_COMPARABLE' });
  assert.throws(() => refuseComparableDollar({ kind: 'percentage', comparable_dollar_price: true }), { code: 'NON_DOLLAR_RATE_NOT_COMPARABLE_DOLLAR' });
  assert.throws(() => refuseComparableDollar({ kind: 'algorithm', comparable_dollar_price: true }), { code: 'NON_DOLLAR_RATE_NOT_COMPARABLE_DOLLAR' });
  assert.throws(() => refuseComparableDollar({ kind: 'per_diem', comparable_dollar_price: true }), { code: 'NON_DOLLAR_RATE_NOT_COMPARABLE_DOLLAR' });
});

test('missing or negative/zero values are investigated by documented semantics, not universally dropped or treated as valid prices', () => {
  const missing = classifyValue(null, { documentedSemantics: 'blank_is_not_zero' });
  assert.equal(missing.valid_price, false);
  assert.equal(missing.dropped, false);
  const zero = classifyValue(0, { documentedSemantics: 'zero_requires_source_note' });
  assert.equal(zero.valid_price, false);
  assert.equal(zero.dropped, false);
  const negative = classifyValue(-1);
  assert.equal(negative.valid_price, false);
  const check = checkSample([
    { measure: 'gross_charge', code_system: 'CPT', code: '99214', setting: 'outpatient', effective_period: '2026', value: 1200, date: '2026-04-01' },
    { measure: 'gross_charge', code_system: 'CPT', code: '99214', setting: 'outpatient', effective_period: '2026', value: '', date: '2026-04-01' },
    { measure: 'gross_charge', code_system: 'CPT', code: '99214', setting: 'outpatient', effective_period: '2026', value: 1200, date: '2026-04-01' },
  ]);
  assert.equal(check.duplicate_exact_rows, 1);
  assert.equal(check.sampled_check_is_not_full_file, true);
  assert.equal(check.full_file_validity, 'unknown');
  assert.ok(check.failed_rules.some((row) => row.rule === 'missing'));
});

test('a passing sample does not imply legal compliance, complete hospital reporting or comparable patient costs', () => {
  const check = checkSample([
    { measure: 'negotiated_amount', code_system: 'CPT', code: '99214', setting: 'outpatient', effective_period: '2026', value: 150, date: '2026-04-01', payer: 'Platform', plan: 'PPO' },
  ]);
  const summary = summarizeSample(check, { unresolvedReferences: 0, bytes: 7290, excludedComparisons: ['gross_vs_negotiated', 'percentage_as_dollar'] });
  assert.equal(summary.legal_compliance, false);
  assert.equal(summary.complete_hospital_reporting, false);
  assert.equal(summary.comparable_patient_costs, false);
  assert.equal(summary.schema.obsolete_generic_mrf, false);
  assert.throws(() => refusePassingSampleClaims({ legal_compliance: true }), { code: 'PASSING_SAMPLE_IS_NOT_LEGAL_COMPLIANCE' });
  assert.throws(() => refusePassingSampleClaims({ complete_hospital_reporting: true }), { code: 'PASSING_SAMPLE_IS_NOT_COMPLETE_HOSPITAL_REPORTING' });
  assert.throws(() => refusePassingSampleClaims({ comparable_patient_costs: true }), { code: 'PASSING_SAMPLE_IS_NOT_COMPARABLE_PATIENT_COSTS' });
});
