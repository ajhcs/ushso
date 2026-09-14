import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareFixtureFormats,
  extractTallCsv,
  extractWideCsv,
  loadOfficialTallCsv,
  loadOfficialWideCsv,
  parseCsv,
  refuseGenericHeaderAsSchema,
} from '../../packages/connectors/mrf/hospital-csv.mjs';
import { extractHospitalJson, loadOfficialExample } from '../../packages/connectors/mrf/hospital-json.mjs';

const wideText = loadOfficialWideCsv();
const tallText = loadOfficialTallCsv();

test('a generic CSV header parser cannot misclassify a metadata row as the variable schema', () => {
  const wideRows = parseCsv(wideText);
  assert.equal(wideRows[0][0], 'hospital_name');
  assert.equal(wideRows[2][0], 'description');
  assert.throws(() => refuseGenericHeaderAsSchema(wideRows), { code: 'GENERIC_HEADER_CANNOT_BE_VARIABLE_SCHEMA' });
  const extracted = extractWideCsv(wideText);
  assert.equal(extracted.metadata_is_not_variable_schema, true);
  assert.equal(extracted.hospital_name, 'West Mercy Hospital');
  assert.equal(extracted.items[0].description, 'MRI of brain (no contrast)');
});

test('wide and tall synthetic representations yield equivalent selected charges without losing payer/plan associations', () => {
  const wide = extractWideCsv(wideText);
  const tall = extractTallCsv(tallText);
  const json = extractHospitalJson(loadOfficialExample(), { maxItems: 20 });
  const comparison = compareFixtureFormats({ json, wide, tall });
  assert.equal(comparison.fixture_values_equivalent, true);
  assert.equal(comparison.real_hospital_files_not_thereby_identical, true);
  const mriWide = wide.items.find((item) => item.description === 'MRI of brain (no contrast)');
  const mriTall = tall.items.find((item) => item.description === 'MRI of brain (no contrast)');
  assert.deepEqual(
    mriWide.payers.map((payer) => [payer.payer_name, payer.plan_name, payer.charge.value]).sort(),
    mriTall.payers.map((payer) => [payer.payer_name, payer.plan_name, payer.charge.value]).sort(),
  );
});

test('format equivalence applies to fixture values only; malformed rows remain visible and cannot fabricate zero prices', () => {
  const comparison = compareFixtureFormats({
    json: extractHospitalJson(loadOfficialExample(), { maxItems: 20 }),
    wide: extractWideCsv(wideText),
    tall: extractTallCsv(tallText),
  });
  assert.equal(comparison.real_hospital_files_not_thereby_identical, true);
  const malformed = extractTallCsv([
    'hospital_name,version',
    'West Mercy Hospital,3.0.0',
    'description,payer_name,plan_name,setting,standard_charge | negotiated_dollar,standard_charge | methodology',
    'Broken row,Platform Health Insurance,PPO,outpatient,not-a-number,fee schedule',
  ].join('\n'));
  assert.equal(malformed.items[0].payers[0].charge.kind, 'malformed');
  assert.equal(malformed.items[0].payers[0].charge.value, 'not-a-number');
  assert.notEqual(malformed.items[0].payers[0].charge.value, 0);
  assert.equal(malformed.fabricated_zero_prices, false);
  assert.throws(() => extractWideCsv('description,code\\nMRI,70551\\n'), { code: 'METADATA_ROW_REQUIRED' });
});
