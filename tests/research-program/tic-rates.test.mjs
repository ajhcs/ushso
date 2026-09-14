import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRateType,
  extractInNetworkRates,
  loadOfficialInNetworkExample,
  loadPinnedInNetworkSchema,
  refuseDollarCoercion,
  refuseInferences,
} from '../../packages/connectors/mrf/payer-in-network.mjs';

const example = loadOfficialInNetworkExample();
const schema = loadPinnedInNetworkSchema();

test('unsupported schema/rate types are typed, not coerced into a dollar comparison', () => {
  assert.equal(example.synthetic, true);
  assert.equal(schema.$id.includes('in-network-rates'), true);
  assert.equal(classifyRateType('percentage').comparable_dollar, false);
  assert.equal(classifyRateType('per diem').comparable_dollar, false);
  assert.equal(classifyRateType('bundle-unknown').kind, 'unsupported');
  assert.equal(classifyRateType('bundle-unknown').coerced_to_dollar, false);
  assert.throws(() => refuseDollarCoercion({ kind: 'percentage', negotiated_type: 'percentage', comparable_dollar: true }), { code: 'NON_DOLLAR_RATE_NOT_COMPARABLE_DOLLAR' });
  assert.throws(() => refuseDollarCoercion({ kind: 'unsupported', comparable_dollar: true }), { code: 'UNSUPPORTED_RATE_NOT_DOLLAR' });
  const extracted = extractInNetworkRates(example, { maxItems: 20 });
  const kinds = new Set();
  for (const item of extracted.items) {
    for (const rate of item.rates) {
      for (const price of rate.prices) {
        kinds.add(price.negotiated_type.negotiated_type);
        if (['percentage', 'per diem'].includes(price.negotiated_type.negotiated_type)) {
          assert.equal(price.negotiated_type.comparable_dollar, false);
        }
      }
    }
  }
  assert.equal(kinds.has('percentage'), true);
  assert.equal(kinds.has('per diem'), true);
});

test('stopping before end-of-file produces a partial-validation receipt; row order and file prefixes do not define a representative sample', () => {
  const partial = extractInNetworkRates(example, { maxItems: 1 });
  assert.equal(partial.partial_sample, true);
  assert.equal(partial.whole_file_validated, false);
  assert.equal(partial.file_schema_validity, 'unknown');
  assert.equal(partial.representative_sample, false);
  assert.equal(partial.row_order_defines_sample, false);
  assert.equal(partial.file_prefix_defines_sample, false);
  assert.equal(partial.loaded_into_worker_memory, false);
  assert.ok(partial.item_count_total > 1);
  const giant = { ...example, in_network: Array.from({ length: 51 }, () => example.in_network[0]) };
  assert.throws(() => extractInNetworkRates(giant, { maxItems: 51, loadWholeFile: true, workerMemoryLimit: true }), { code: 'PARSER_DOES_NOT_LOAD_GIANT_FILE_INTO_WORKER_MEMORY' });
});

test('no utilization weights, patient liability or observed paid-price claims are generated from a negotiated-rate object', () => {
  assert.throws(() => refuseInferences({ utilization_weight: true }), { code: 'NO_UTILIZATION_WEIGHT_FROM_NEGOTIATED_RATE' });
  assert.throws(() => refuseInferences({ patient_liability: true }), { code: 'NO_PATIENT_LIABILITY_FROM_NEGOTIATED_RATE' });
  assert.throws(() => refuseInferences({ observed_paid_price: true }), { code: 'NO_OBSERVED_PAID_PRICE_FROM_NEGOTIATED_RATE' });
  const extracted = extractInNetworkRates(example, { maxItems: 20 });
  for (const item of extracted.items) {
    for (const rate of item.rates) {
      for (const price of rate.prices) {
        assert.equal(price.inferences.utilization_weight, false);
        assert.equal(price.inferences.patient_liability, false);
        assert.equal(price.inferences.observed_paid_price, false);
        if (price.provider_references.length === 0) assert.equal(price.incomplete, true);
      }
    }
  }
  const incomplete = extractInNetworkRates({
    synthetic: true,
    reporting_entity_name: 'Fixture Issuer',
    version: '2.0.0',
    in_network: [{
      negotiation_arrangement: 'ffs',
      name: 'no provider context',
      billing_code_type: 'CPT',
      billing_code_type_version: '2024',
      billing_code: '99213',
      negotiated_rates: [{
        negotiated_prices: [{
          setting: 'outpatient',
          negotiated_type: 'negotiated',
          negotiated_rate: 100,
          expiration_date: '2024-12-31',
          billing_class: 'professional',
        }],
      }],
    }],
  });
  assert.equal(incomplete.items[0].rates[0].prices[0].incomplete, true);
});
