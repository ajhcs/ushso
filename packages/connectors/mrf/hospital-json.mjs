import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAST_GOOD_GENERATION } from '../../coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';

export const HOSPITAL_JSON_FORMAT = 'ushso.hospital-json-mrf.v1';
export const PINNED_CMS_VERSION = '3.0.0';
export const PINNED_CMS_COMMIT = '5333564a710f80d7740180b9ffab8dbdcba9b502';
export const PINNED_SCHEMA_BLOB_SHA = '11043f073ab24e638c91bde1b8bcf73e4733b296';
export const PINNED_EXAMPLE_BLOB_SHA = '23229dfb1f93aa16ddbcc09887cc1b86bf591acf';
export { LAST_GOOD_GENERATION };

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function defaultFixtureDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../evaluation/research-program/mrf-fixtures/hospital-json');
}

export function loadPinnedSchema(dir = defaultFixtureDir()) {
  return JSON.parse(readFileSync(path.join(dir, 'V3.0.0_Hospital_price_transparency_schema.json'), 'utf8'));
}

export function loadOfficialExample(dir = defaultFixtureDir()) {
  const example = JSON.parse(readFileSync(path.join(dir, 'v3_json_format_example.json'), 'utf8'));
  return freeze({ ...example, synthetic: true, official_fictional_example: true });
}

export function classifySchemaVersion(version) {
  const raw = String(version ?? '');
  if (raw === PINNED_CMS_VERSION || raw === '3.0') {
    return freeze({ version: raw, compatible: true, historical: false, unknown_newer: false });
  }
  if (/^2(\.|$)/.test(raw)) {
    return freeze({ version: raw, compatible: false, historical: true, unknown_newer: false, support: 'historical_labeled_not_compatible' });
  }
  fail('UNKNOWN_NEWER_VERSION_NOT_COMPATIBLE', raw);
}

function chargeKind(payer = {}, settingCharge = {}) {
  if (payer.standard_charge_algorithm != null) {
    return freeze({ kind: 'algorithm', comparable_dollar_price: false, value: payer.standard_charge_algorithm });
  }
  if (payer.standard_charge_percentage != null) {
    return freeze({ kind: 'percentage', comparable_dollar_price: false, value: payer.standard_charge_percentage });
  }
  const methodology = String(payer.methodology ?? '').toLowerCase();
  if (methodology === 'per diem' || methodology === 'per-diem') {
    return freeze({ kind: 'per_diem', comparable_dollar_price: false, value: payer.standard_charge_dollar ?? null });
  }
  if (payer.standard_charge_dollar != null) {
    return freeze({ kind: 'dollar', comparable_dollar_price: true, value: payer.standard_charge_dollar });
  }
  if (typeof payer.standard_charge === 'string') {
    return freeze({ kind: 'string', comparable_dollar_price: false, value: payer.standard_charge });
  }
  if (settingCharge.gross_charge != null) {
    return freeze({ kind: 'gross_charge', comparable_dollar_price: true, value: settingCharge.gross_charge });
  }
  return freeze({ kind: 'unknown', comparable_dollar_price: false, value: null });
}

export function refuseComparableDollar(charge) {
  if (['algorithm', 'percentage', 'per_diem'].includes(charge?.kind) && charge?.comparable_dollar_price === true) {
    fail('NON_DOLLAR_RATE_NOT_COMPARABLE_DOLLAR', charge.kind);
  }
  return freeze({ ...charge, comparable_dollar_price: charge?.kind === 'dollar' || charge?.kind === 'gross_charge' });
}

export function extractHospitalJson(document, { maxItems = 5, validateWholeFile = false } = {}) {
  if (document?.synthetic !== true && document?.official_fictional_example === true) {
    fail('OFFICIAL_FICTIONAL_EXAMPLE_MUST_BE_SYNTHETIC');
  }
  const version = classifySchemaVersion(document?.version);
  const items = Array.isArray(document?.standard_charge_information) ? document.standard_charge_information : [];
  const limited = items.slice(0, maxItems);
  const budgetStop = items.length > maxItems;
  const extracted = limited.map((item, itemIndex) => {
    const charges = (item.standard_charges ?? []).map((entry, chargeIndex) => {
      const payers = (entry.payers_information ?? []).map((payer, payerIndex) => {
        const kind = refuseComparableDollar(chargeKind(payer, entry));
        return freeze({
          payer_name: payer.payer_name ?? null,
          plan_name: payer.plan_name ?? null,
          methodology: payer.methodology ?? null,
          setting: entry.setting ?? null,
          charge: kind,
          allowed_amount: freeze({
            median_amount: payer.median_amount ?? null,
            percentile_10: payer['10th_percentile'] ?? null,
            percentile_90: payer['90th_percentile'] ?? null,
            count: payer.count ?? null,
          }),
          source_pointer: freeze({ item_index: itemIndex, charge_index: chargeIndex, payer_index: payerIndex }),
        });
      });
      return freeze({
        setting: entry.setting ?? null,
        gross_charge: entry.gross_charge ?? null,
        discounted_cash: entry.discounted_cash ?? null,
        payers: freeze(payers),
      });
    });
    return freeze({
      description: item.description ?? null,
      codes: freeze((item.code_information ?? []).map((code) => freeze({ code: code.code ?? null, system: code.type ?? null }))),
      charges: freeze(charges),
    });
  });
  return freeze({
    format: HOSPITAL_JSON_FORMAT,
    generation: LAST_GOOD_GENERATION,
    version,
    hospital_name: document?.hospital_name ?? null,
    last_updated_on: document?.last_updated_on ?? null,
    location_name: freeze([...(document?.location_name ?? [])]),
    synthetic: document?.synthetic === true,
    official_fictional_example: document?.official_fictional_example === true,
    items: freeze(extracted),
    item_count_seen: limited.length,
    item_count_total: items.length,
    partial_sample: budgetStop,
    whole_file_validated: validateWholeFile === true && budgetStop === false,
    file_schema_validity: validateWholeFile === true && budgetStop === false ? 'validated' : 'unknown',
    last_good_generation_changed: false,
  });
}
