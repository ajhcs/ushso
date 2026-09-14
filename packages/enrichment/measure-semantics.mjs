import { createHash } from 'node:crypto';

export const MEASURE_POLICY_VERSION = 'ushso.measure-semantics.v1';
export const UNKNOWN = Object.freeze({ state: 'unknown', value: null, inferred: false });

const FIELDS = Object.freeze([
  'numerator',
  'denominator',
  'universe',
  'scale_unit',
  'adjustment',
  'weight',
  'confidence_interval_moe',
  'suppression',
  'missingness',
]);

const UNIT_KINDS = Object.freeze({
  rate: 'rate',
  count: 'count',
  percentage: 'percentage',
  monetary_total: 'monetary_total',
});

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function sha(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function requireField(item, label) {
  if (!item || item.state === 'unknown' || item.value == null) {
    return freeze({
      state: 'unknown',
      value: null,
      inferred: false,
      essential: item?.essential === true,
      evidence_ids: freeze([...(item?.evidence_ids ?? [])]),
      source_native: item?.source_native ?? null,
    });
  }
  if (item.inferred === true) fail('INFERRED_MEASURE_FORBIDDEN', label);
  if (!Array.isArray(item.evidence_ids) || item.evidence_ids.length === 0) fail('MEASURE_EVIDENCE_REQUIRED', label);
  return freeze({
    state: 'evidenced',
    value: item.value,
    kind: item.kind ?? null,
    inferred: false,
    essential: item.essential === true,
    evidence_ids: freeze([...item.evidence_ids]),
    source_native: item.source_native ?? null,
  });
}

export function defineMeasureSemantics(input = {}) {
  const fields = {};
  for (const name of FIELDS) {
    fields[name] = requireField(input[name], name);
  }
  const unitKind = input.unit_kind ?? fields.scale_unit.kind ?? inferUnitKindFromLabel(input.label);
  if (unitKind && fields.scale_unit.kind && fields.scale_unit.kind !== unitKind) fail('UNIT_KIND_MISMATCH');
  return freeze({
    format: 'ushso.measure-semantics.v1',
    policy_version: MEASURE_POLICY_VERSION,
    measure_id: input.measure_id ?? null,
    label: input.label ?? null,
    unit_kind: unitKind ?? fields.scale_unit.kind,
    fields: freeze(fields),
    definition_status: input.definition_status ?? (fields.denominator.state === 'evidenced' ? 'captured' : 'missing'),
    unsupported_conversion: input.unsupported_conversion === true,
    checksum: sha(fields),
  });
}

export function inferUnitKindFromLabel(label) {
  if (!label) return null;
  const text = String(label).toLowerCase();
  if (text.includes('percent') || text.includes('%')) return UNIT_KINDS.percentage;
  if (text.includes('rate')) return UNIT_KINDS.rate;
  if (text.includes('count') || text.includes('number of')) return UNIT_KINDS.count;
  if (text.includes('dollar') || text.includes('charge') || text.includes('cost') || text.includes('payment')) return UNIT_KINDS.monetary_total;
  return null;
}

export function assertDistinctUnits(measures = []) {
  const byUnit = new Map();
  for (const measure of measures) {
    const unit = measure.fields?.scale_unit?.value ?? measure.unit;
    const kind = measure.unit_kind ?? measure.kind;
    if (!unit || !kind) continue;
    const prior = byUnit.get(unit);
    if (prior && prior !== kind) fail('SHARED_UNIT_ACROSS_UNLIKE_MEASURES', unit);
    byUnit.set(unit, kind);
  }
  const kinds = new Set(measures.map((measure) => measure.unit_kind).filter(Boolean));
  if (kinds.has(UNIT_KINDS.rate) && kinds.has(UNIT_KINDS.count) && measures.some((measure) => measure.forced_shared_unit === true)) {
    fail('SHARED_UNIT_ACROSS_UNLIKE_MEASURES');
  }
  return freeze({ ok: true, units: freeze(Object.fromEntries(byUnit)) });
}

export function nonEquivalence(left, right, reason) {
  if (!left || !right) fail('NON_EQUIVALENCE_REQUIRES_BOTH');
  if (left.measure_id === right.measure_id) fail('SAME_MEASURE_NOT_NON_EQUIVALENCE');
  return freeze({
    format: 'ushso.measure-non-equivalence.v1',
    left: left.measure_id,
    right: right.measure_id,
    equivalent: false,
    reason,
    inferred_conversion: false,
  });
}

export function validateResearchReady(measure, { recipe, executableApi = false } = {}) {
  const required = recipe?.essential_fields ?? ['denominator', 'scale_unit'];
  const missing = [];
  for (const field of required) {
    const value = measure.fields?.[field];
    if (!value || value.state === 'unknown' || value.value == null) missing.push(field);
  }
  if (executableApi === true && missing.includes('denominator')) {
    return freeze({
      research_ready: false,
      code: 'UNKNOWN_MEASUREMENT_DENOMINATOR',
      executable_api: true,
      missing: freeze(missing),
    });
  }
  if (missing.length) {
    return freeze({
      research_ready: false,
      code: 'ESSENTIAL_SEMANTICS_MISSING',
      missing: freeze(missing),
    });
  }
  if (measure.unsupported_conversion === true) {
    return freeze({ research_ready: false, code: 'UNSUPPORTED_CONVERSION', missing: freeze([]) });
  }
  return freeze({ research_ready: true, code: null, missing: freeze([]) });
}

export function cautionFor(measure) {
  return freeze({
    measure_id: measure.measure_id,
    specific: true,
    generic: false,
    text: measure.fields.adjustment.value
      ? `${measure.label ?? measure.measure_id} is ${measure.fields.adjustment.value}; do not treat unlike adjustments as interchangeable.`
      : `${measure.label ?? measure.measure_id} cautions apply only to this measure.`,
  });
}

export function refuseInferredConversion({ from, to, evidence = [] } = {}) {
  if (!evidence.length) fail('CROSS_CONVERSION_WITHOUT_EVIDENCE', `${from}->${to}`);
  return freeze({ converted: false, from, to, evidence: freeze([...evidence]) });
}

export const FIXTURES = Object.freeze({
  hcris_net_patient_revenue: defineMeasureSemantics({
    measure_id: 'hcris:net_patient_revenue',
    label: 'Net patient revenue',
    unit_kind: 'monetary_total',
    scale_unit: { value: 'usd', kind: 'monetary_total', essential: true, evidence_ids: ['ev:hcris:npr-unit'], source_native: 'Worksheet G-3 dollars' },
    numerator: { value: 'net_patient_revenue', essential: true, evidence_ids: ['ev:hcris:npr'] },
    denominator: { state: 'unknown', essential: false },
    universe: { value: 'medicare_certified_hospitals', evidence_ids: ['ev:hcris:universe'] },
    adjustment: { state: 'unknown' },
    weight: { state: 'unknown' },
    confidence_interval_moe: { state: 'unknown' },
    suppression: { value: 'cms_cell_suppression', evidence_ids: ['ev:hcris:supp'] },
    missingness: { value: 'cost_report_not_filed', evidence_ids: ['ev:hcris:miss'] },
    definition_status: 'captured',
  }),
  cdc_adult_obesity_prevalence: defineMeasureSemantics({
    measure_id: 'cdc:places:obesity_prevalence',
    label: 'Adult obesity prevalence',
    unit_kind: 'percentage',
    scale_unit: { value: 'percent_of_adults', kind: 'percentage', essential: true, evidence_ids: ['ev:places:unit'], source_native: 'age-adjusted prevalence' },
    numerator: { value: 'adults_with_obesity', evidence_ids: ['ev:places:num'] },
    denominator: { value: 'adult_population', essential: true, evidence_ids: ['ev:places:den'] },
    universe: { value: 'us_counties', evidence_ids: ['ev:places:universe'] },
    adjustment: { value: 'age_adjusted', evidence_ids: ['ev:places:adj'] },
    weight: { state: 'unknown' },
    confidence_interval_moe: { value: '95_ci', evidence_ids: ['ev:places:ci'] },
    suppression: { value: 'small_n', evidence_ids: ['ev:places:supp'] },
    missingness: { state: 'unknown' },
    definition_status: 'captured',
  }),
  cdc_maternal_mortality: defineMeasureSemantics({
    measure_id: 'cdc:nvss:maternal_mortality',
    label: 'Maternal mortality rate',
    unit_kind: 'rate',
    scale_unit: { value: 'deaths_per_100000_live_births', kind: 'rate', essential: true, evidence_ids: ['ev:nvss:mmr-unit'] },
    numerator: { value: 'maternal_deaths', evidence_ids: ['ev:nvss:mmr-num'] },
    denominator: { value: 'live_births', essential: true, evidence_ids: ['ev:nvss:mmr-den'] },
    universe: { value: 'us_residents', evidence_ids: ['ev:nvss:universe'] },
    adjustment: { value: 'crude', evidence_ids: ['ev:nvss:crude'] },
    weight: { state: 'unknown' },
    confidence_interval_moe: { state: 'unknown' },
    suppression: { state: 'unknown' },
    missingness: { state: 'unknown' },
    definition_status: 'captured',
  }),
  cdc_infant_mortality: defineMeasureSemantics({
    measure_id: 'cdc:nvss:infant_mortality',
    label: 'Infant mortality rate',
    unit_kind: 'rate',
    scale_unit: { value: 'deaths_per_1000_live_births', kind: 'rate', essential: true, evidence_ids: ['ev:nvss:imr-unit'] },
    numerator: { value: 'infant_deaths', evidence_ids: ['ev:nvss:imr-num'] },
    denominator: { value: 'live_births', essential: true, evidence_ids: ['ev:nvss:imr-den'] },
    universe: { value: 'us_residents', evidence_ids: ['ev:nvss:universe'] },
    adjustment: { value: 'crude', evidence_ids: ['ev:nvss:crude'] },
    weight: { state: 'unknown' },
    confidence_interval_moe: { state: 'unknown' },
    suppression: { state: 'unknown' },
    missingness: { state: 'unknown' },
    definition_status: 'captured',
  }),
  acs_uninsured_estimate: defineMeasureSemantics({
    measure_id: 'census:acs:uninsured',
    label: 'Uninsured estimate',
    unit_kind: 'count',
    scale_unit: { value: 'person_count', kind: 'count', essential: true, evidence_ids: ['ev:acs:unit'] },
    numerator: { value: 'uninsured_persons', evidence_ids: ['ev:acs:num'] },
    denominator: { value: 'civilian_noninstitutionalized_population', essential: true, evidence_ids: ['ev:acs:den'] },
    universe: { value: 'acs_5_year', evidence_ids: ['ev:acs:universe'] },
    adjustment: { state: 'unknown' },
    weight: { value: 'acs_person_weight', evidence_ids: ['ev:acs:wt'] },
    confidence_interval_moe: { value: 'acs_moe', essential: true, evidence_ids: ['ev:acs:moe'] },
    suppression: { state: 'unknown' },
    missingness: { state: 'unknown' },
    definition_status: 'captured',
  }),
});
