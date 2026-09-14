import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAST_GOOD_GENERATION } from '../../coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';
import { PAYER_TIC_SCHEMA_FAMILY } from './payer-index.mjs';

export const PAYER_IN_NETWORK_FORMAT = 'ushso.payer-in-network-rates.v1';
export const PINNED_IN_NETWORK_VERSION = '2.2.1';
export const PINNED_IN_NETWORK_BLOB_SHA = '836c6f075d13c52b73a513236db2b49e1539649f';
export const PINNED_SAMPLE_BLOB_SHA = 'a738bc50bb366ab4c3259946cdb626be36846001';
export { LAST_GOOD_GENERATION, PAYER_TIC_SCHEMA_FAMILY };

const SUPPORTED_RATE_TYPES = Object.freeze(['negotiated', 'derived', 'fee schedule', 'percentage', 'per diem']);
const COMPARABLE_DOLLAR_TYPES = Object.freeze(['negotiated', 'derived', 'fee schedule']);

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function defaultFixtureDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../evaluation/research-program/mrf-fixtures/payer');
}

export function loadPinnedInNetworkSchema(dir = defaultFixtureDir()) {
  return JSON.parse(readFileSync(path.join(dir, 'in-network-rates.json'), 'utf8'));
}

export function loadOfficialInNetworkExample(dir = defaultFixtureDir()) {
  const example = JSON.parse(readFileSync(path.join(dir, 'in-network-rates-all-negotiated-types-sample.json'), 'utf8'));
  return freeze({ ...example, synthetic: true, official_fictional_example: true });
}

export function classifyRateType(negotiatedType) {
  const raw = String(negotiatedType ?? '');
  if (!SUPPORTED_RATE_TYPES.includes(raw)) {
    return freeze({
      kind: 'unsupported',
      negotiated_type: raw || null,
      comparable_dollar: false,
      typed: true,
      coerced_to_dollar: false,
    });
  }
  const comparable = COMPARABLE_DOLLAR_TYPES.includes(raw);
  return freeze({
    kind: raw === 'fee schedule' ? 'fee_schedule' : raw.replace(/\s+/g, '_'),
    negotiated_type: raw,
    comparable_dollar: comparable,
    typed: true,
    coerced_to_dollar: false,
  });
}

export function refuseDollarCoercion(rate) {
  if (rate?.kind === 'unsupported' && rate?.comparable_dollar === true) fail('UNSUPPORTED_RATE_NOT_DOLLAR');
  if ((rate?.kind === 'percentage' || rate?.kind === 'per_diem') && rate?.comparable_dollar === true) {
    fail('NON_DOLLAR_RATE_NOT_COMPARABLE_DOLLAR', rate.kind);
  }
  return freeze({ ...rate, comparable_dollar: rate?.kind && COMPARABLE_DOLLAR_TYPES.includes(rate.negotiated_type) });
}

export function refuseInferences(claims = {}) {
  if (claims.utilization_weight === true) fail('NO_UTILIZATION_WEIGHT_FROM_NEGOTIATED_RATE');
  if (claims.patient_liability === true) fail('NO_PATIENT_LIABILITY_FROM_NEGOTIATED_RATE');
  if (claims.observed_paid_price === true) fail('NO_OBSERVED_PAID_PRICE_FROM_NEGOTIATED_RATE');
  return freeze({
    utilization_weight: false,
    patient_liability: false,
    observed_paid_price: false,
    negotiated_rate_is_not_paid_claim: true,
  });
}

export function extractInNetworkRates(document, { maxItems = 3, loadWholeFile = false, workerMemoryLimit = true } = {}) {
  if (document?.synthetic !== true && document?.official_fictional_example === true) {
    fail('OFFICIAL_FICTIONAL_EXAMPLE_MUST_BE_SYNTHETIC');
  }
  if (loadWholeFile === true && workerMemoryLimit === true && (document?.in_network ?? []).length > 50) {
    fail('PARSER_DOES_NOT_LOAD_GIANT_FILE_INTO_WORKER_MEMORY');
  }
  const items = Array.isArray(document?.in_network) ? document.in_network : [];
  const limited = items.slice(0, maxItems);
  const budgetStop = items.length > maxItems;
  const extracted = limited.map((item, itemIndex) => {
    const rates = (item.negotiated_rates ?? []).map((entry, rateIndex) => {
      const prices = (entry.negotiated_prices ?? []).map((price, priceIndex) => {
        const classified = refuseDollarCoercion(classifyRateType(price.negotiated_type));
        const providerRefs = freeze([...(entry.provider_references ?? [])]);
        const incomplete = providerRefs.length === 0 && !entry.provider_groups;
        return freeze({
          setting: price.setting ?? null,
          billing_class: price.billing_class ?? null,
          negotiated_type: classified,
          negotiated_rate: price.negotiated_rate ?? null,
          expiration_date: price.expiration_date ?? null,
          service_code: freeze([...(price.service_code ?? [])]),
          billing_code_modifier: freeze([...(price.billing_class_modifier ?? price.billing_code_modifier ?? [])]),
          additional_information: price.additional_information ?? null,
          provider_references: providerRefs,
          incomplete,
          source_pointer: freeze({ item_index: itemIndex, rate_index: rateIndex, price_index: priceIndex }),
          inferences: refuseInferences(),
        });
      });
      return freeze({
        provider_references: freeze([...(entry.provider_references ?? [])]),
        prices: freeze(prices),
      });
    });
    return freeze({
      name: item.name ?? null,
      negotiation_arrangement: item.negotiation_arrangement ?? null,
      billing_code: item.billing_code ?? null,
      billing_code_type: item.billing_code_type ?? null,
      billing_code_type_version: item.billing_code_type_version ?? null,
      description: item.description ?? null,
      rates: freeze(rates),
    });
  });
  return freeze({
    format: PAYER_IN_NETWORK_FORMAT,
    schema_family: PAYER_TIC_SCHEMA_FAMILY,
    generation: LAST_GOOD_GENERATION,
    reporting_entity_name: document?.reporting_entity_name ?? null,
    plan_id: document?.plan_id ?? null,
    plan_id_type: document?.plan_id_type ?? null,
    version: document?.version ?? null,
    synthetic: document?.synthetic === true,
    official_fictional_example: document?.official_fictional_example === true,
    items: freeze(extracted),
    item_count_seen: limited.length,
    item_count_total: items.length,
    partial_sample: budgetStop,
    whole_file_validated: loadWholeFile === true && budgetStop === false,
    file_schema_validity: loadWholeFile === true && budgetStop === false ? 'validated' : 'unknown',
    representative_sample: false,
    row_order_defines_sample: false,
    file_prefix_defines_sample: false,
    loaded_into_worker_memory: false,
    last_good_generation_changed: false,
  });
}
