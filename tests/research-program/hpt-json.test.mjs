import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PINNED_CMS_VERSION,
  classifySchemaVersion,
  extractHospitalJson,
  loadOfficialExample,
  loadPinnedSchema,
  refuseComparableDollar,
} from '../../packages/connectors/mrf/hospital-json.mjs';

const example = loadOfficialExample();
const schema = loadPinnedSchema();

test('official fictional examples are marked synthetic; the parser never reports an unknown newer version as compatible', () => {
  assert.equal(example.synthetic, true);
  assert.equal(example.official_fictional_example, true);
  assert.equal(example.hospital_name, 'West Mercy Hospital');
  assert.equal(schema.$schema.includes('json-schema'), true);
  assert.equal(classifySchemaVersion(PINNED_CMS_VERSION).compatible, true);
  assert.equal(classifySchemaVersion('2.0.0').historical, true);
  assert.equal(classifySchemaVersion('2.0.0').compatible, false);
  assert.throws(() => classifySchemaVersion('4.0.0'), { code: 'UNKNOWN_NEWER_VERSION_NOT_COMPATIBLE' });
  assert.throws(() => extractHospitalJson({ ...example, synthetic: false }), { code: 'OFFICIAL_FICTIONAL_EXAMPLE_MUST_BE_SYNTHETIC' });
});

test('a budget stop yields a partial sample, not whole-file validation; numeric/string/percentage charge cases remain distinct', () => {
  const partial = extractHospitalJson(example, { maxItems: 1 });
  assert.equal(partial.partial_sample, true);
  assert.equal(partial.whole_file_validated, false);
  assert.equal(partial.file_schema_validity, 'unknown');
  assert.equal(partial.item_count_seen, 1);
  assert.ok(partial.item_count_total > 1);
  const dollar = partial.items[0].charges[0].payers.find((payer) => payer.charge.kind === 'dollar');
  assert.equal(dollar.charge.comparable_dollar_price, true);
  const percentDoc = {
    synthetic: true,
    version: '3.0.0',
    hospital_name: 'Fixture Hospital',
    last_updated_on: '2026-04-01',
    standard_charge_information: [{
      description: 'percent fixture',
      code_information: [{ code: '00000', type: 'CPT' }],
      standard_charges: [{
        setting: 'outpatient',
        payers_information: [{
          payer_name: 'Region Health Insurance',
          plan_name: 'HMO',
          methodology: 'percent of billed charges',
          standard_charge_percentage: 140,
        }],
      }],
    }],
  };
  const percent = extractHospitalJson(percentDoc, { maxItems: 5, validateWholeFile: true });
  assert.equal(percent.items[0].charges[0].payers[0].charge.kind, 'percentage');
  assert.equal(percent.items[0].charges[0].payers[0].charge.comparable_dollar_price, false);
  assert.equal(percent.file_schema_validity, 'validated');
  const stringDoc = {
    ...percentDoc,
    standard_charge_information: [{
      description: 'string fixture',
      code_information: [{ code: '11111', type: 'CPT' }],
      standard_charges: [{
        setting: 'outpatient',
        payers_information: [{
          payer_name: 'Region Health Insurance',
          plan_name: 'HMO',
          standard_charge: 'not a number',
        }],
      }],
    }],
  };
  const stringCharge = extractHospitalJson(stringDoc).items[0].charges[0].payers[0].charge;
  assert.equal(stringCharge.kind, 'string');
  assert.equal(stringCharge.comparable_dollar_price, false);
});

test('no algorithm/percentage/per-diem value is automatically represented as a comparable dollar price', () => {
  const full = extractHospitalJson(example, { maxItems: 20 });
  const kinds = new Set();
  for (const item of full.items) {
    for (const charge of item.charges) {
      for (const payer of charge.payers) {
        kinds.add(payer.charge.kind);
        if (['algorithm', 'percentage', 'per_diem'].includes(payer.charge.kind)) {
          assert.equal(payer.charge.comparable_dollar_price, false);
        }
      }
    }
  }
  assert.equal(kinds.has('algorithm'), true);
  assert.equal(kinds.has('per_diem'), true);
  assert.throws(() => refuseComparableDollar({ kind: 'algorithm', comparable_dollar_price: true }), { code: 'NON_DOLLAR_RATE_NOT_COMPARABLE_DOLLAR' });
  assert.throws(() => refuseComparableDollar({ kind: 'percentage', comparable_dollar_price: true }), { code: 'NON_DOLLAR_RATE_NOT_COMPARABLE_DOLLAR' });
  assert.throws(() => refuseComparableDollar({ kind: 'per_diem', comparable_dollar_price: true }), { code: 'NON_DOLLAR_RATE_NOT_COMPARABLE_DOLLAR' });
  const algorithm = full.items.flatMap((item) => item.charges).flatMap((charge) => charge.payers).find((payer) => payer.charge.kind === 'algorithm');
  assert.equal(algorithm.allowed_amount.median_amount != null, true);
  assert.equal(algorithm.charge.comparable_dollar_price, false);
});
