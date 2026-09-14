import { LAST_GOOD_GENERATION } from '../../coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';
import { refuseComparableDollar } from './hospital-json.mjs';
import { classifyRateType, refuseInferences } from './payer-in-network.mjs';
import { refuseNpiAsHospitalCcn } from './payer-provider-reference.mjs';
import { nonEquivalence } from '../../enrichment/measure-semantics.mjs';

export const PRICE_SEMANTICS_FORMAT = 'ushso.price-semantics.v1';
export const PINNED_HOSPITAL_SCHEMA = 'cms-hospital-price-transparency-v3.0.0';
export const PINNED_PAYER_SCHEMA = 'cms-payer-tic-in-network-v2.2.1';
export { LAST_GOOD_GENERATION };

const MEASURES = Object.freeze(['gross_charge', 'discounted_cash', 'negotiated_amount', 'allowed_amount']);

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

export function definePriceContext(input = {}) {
  const missing = [];
  for (const field of ['code_system', 'code', 'setting', 'measure', 'effective_period']) {
    if (input[field] == null || input[field] === '') missing.push(field);
  }
  if (!MEASURES.includes(input.measure)) fail('UNKNOWN_PRICE_MEASURE', String(input.measure));
  return freeze({
    format: PRICE_SEMANTICS_FORMAT,
    code_system: input.code_system ?? null,
    code_system_version: input.code_system_version ?? null,
    modifiers: freeze([...(input.modifiers ?? [])]),
    code: input.code ?? null,
    setting: input.setting ?? null,
    measure: input.measure,
    payer: input.payer ?? null,
    plan: input.plan ?? null,
    network: input.network ?? null,
    unit: input.unit ?? null,
    provider_context: input.provider_context ?? null,
    effective_period: input.effective_period ?? null,
    missing_required_context: freeze(missing),
    complete: missing.length === 0,
  });
}

export function refuseMeasureCollapse(left, right) {
  if (left?.measure && right?.measure && left.measure !== right.measure) {
    fail('DISTINCT_PRICE_MEASURES_NOT_COMPARABLE', `${left.measure}|${right.measure}`);
  }
  return freeze({ comparable: false, reason: 'distinct_measures' });
}

export function classifyValue(value, { documentedSemantics = null } = {}) {
  if (value == null || value === '') {
    return freeze({ status: 'missing', valid_price: false, dropped: false, investigation: documentedSemantics ?? 'missing_requires_documented_semantics' });
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return freeze({ status: 'malformed', valid_price: false, dropped: false, raw: String(value) });
  }
  if (numeric <= 0) {
    return freeze({
      status: numeric < 0 ? 'negative' : 'zero',
      valid_price: false,
      dropped: false,
      value: numeric,
      investigation: documentedSemantics ?? 'non_positive_requires_documented_semantics',
    });
  }
  return freeze({ status: 'positive', valid_price: true, dropped: false, value: numeric });
}

export function checkSample(rows = [], { fullFileValidated = false } = {}) {
  const failed = [];
  const seen = new Set();
  let duplicates = 0;
  for (const [index, row] of rows.entries()) {
    const context = definePriceContext(row);
    if (!context.complete) failed.push(freeze({ index, rule: 'missing_required_context', fields: context.missing_required_context }));
    const classified = classifyValue(row.value, { documentedSemantics: row.documented_semantics });
    if (classified.valid_price !== true) failed.push(freeze({ index, rule: classified.status, dropped: classified.dropped }));
    if (row.date && !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) failed.push(freeze({ index, rule: 'malformed_date', date: row.date }));
    const key = JSON.stringify({ measure: row.measure, code: row.code, payer: row.payer, plan: row.plan, setting: row.setting, value: row.value, date: row.date });
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
    if (['algorithm', 'percentage', 'per_diem'].includes(row.rate_kind)) {
      refuseComparableDollar({ kind: row.rate_kind, comparable_dollar_price: row.comparable_dollar === true });
    }
  }
  return freeze({
    parsed_rows: rows.length,
    failed_rules: freeze(failed),
    duplicate_exact_rows: duplicates,
    full_file_validity: fullFileValidated ? 'validated' : 'unknown',
    sampled_check_is_not_full_file: fullFileValidated !== true,
  });
}

export function summarizeSample(check, { unresolvedReferences = 0, bytes = 0, excludedComparisons = [] } = {}) {
  return freeze({
    format: PRICE_SEMANTICS_FORMAT,
    generation: LAST_GOOD_GENERATION,
    parsed_rows: check.parsed_rows,
    checked_fields: freeze(['code_system', 'code', 'setting', 'measure', 'value', 'effective_period']),
    unresolved_references: unresolvedReferences,
    failed_rules: check.failed_rules.length,
    byte_scope: bytes,
    excluded_comparisons: freeze([...excludedComparisons]),
    legal_compliance: false,
    complete_hospital_reporting: false,
    comparable_patient_costs: false,
    schema: freeze({ hospital: PINNED_HOSPITAL_SCHEMA, payer: PINNED_PAYER_SCHEMA, obsolete_generic_mrf: false }),
    last_good_generation_changed: false,
  });
}

export function refusePassingSampleClaims(summary) {
  if (summary?.legal_compliance === true) fail('PASSING_SAMPLE_IS_NOT_LEGAL_COMPLIANCE');
  if (summary?.complete_hospital_reporting === true) fail('PASSING_SAMPLE_IS_NOT_COMPLETE_HOSPITAL_REPORTING');
  if (summary?.comparable_patient_costs === true) fail('PASSING_SAMPLE_IS_NOT_COMPARABLE_PATIENT_COSTS');
  return freeze({
    legal_compliance: false,
    complete_hospital_reporting: false,
    comparable_patient_costs: false,
  });
}

export { classifyRateType, refuseInferences, refuseNpiAsHospitalCcn, nonEquivalence };
