import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CDC_SOURCE_ID,
  ISOLATED_CDC_RECORD_IDS,
  PLACES_154_VIEW_ID,
  bindCdcView,
  blockedFetch,
  buildCdcExtractionReceipt,
  classifyCdcViewKind,
  htmlDocumentationCannotBeJsonSuccess,
  rowSampleEligible,
} from '../../packages/connectors/src/adapters/cdc-view.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const indexGz = path.join(root, 'verification/research-program/pr-014/fixtures/cdc-view-index.json.gz');
const placesGz = path.join(root, 'verification/research-program/pr-014/fixtures/places-7cmc-7y5g.json.gz');
const examplesPath = path.join(root, 'verification/research-program/pr-014/fixtures/cdc-view-type-examples.json');

async function loadJsonGz(file) {
  return JSON.parse(gunzipSync(await fs.readFile(file)).toString('utf8'));
}

async function loadCdcRecords() {
  const corpus = JSON.parse(await fs.readFile(path.join(root, 'packages/retrieval/versions/v1.2.0/corpus/corpus.json'), 'utf8'));
  const records = [];
  for (const file of corpus.record_files) {
    const text = await fs.readFile(path.join(root, 'packages/retrieval/versions/v1.2.0/corpus', file), 'utf8');
    for (const line of text.trim().split(/\r?\n/u).filter(Boolean)) records.push(JSON.parse(line));
  }
  return records.filter((record) => record.identity.source.source_id === CDC_SOURCE_ID);
}

function headers(contentType) {
  return new Headers({ 'content-type': contentType });
}

test('tabular datasets stay in the row-sample queue', async () => {
  const examples = JSON.parse(await fs.readFile(examplesPath, 'utf8'));
  const kind = classifyCdcViewKind(examples.tabular);
  assert.equal(kind, 'tabular_dataset');
  assert.equal(rowSampleEligible(kind), true);
});

test('document, visualization and external-link views stay out of the row-sample queue', async () => {
  const examples = JSON.parse(await fs.readFile(examplesPath, 'utf8'));
  assert.equal(classifyCdcViewKind(examples.blobby), 'document');
  assert.equal(rowSampleEligible('document'), false);
  assert.equal(classifyCdcViewKind(examples.story), 'visualization');
  assert.equal(rowSampleEligible('visualization'), false);
  assert.equal(classifyCdcViewKind(examples.href), 'external_link');
  assert.equal(rowSampleEligible('external_link'), false);
  assert.equal(classifyCdcViewKind({ viewType: 'tabular', displayType: 'visualization_canvas_chart', assetType: 'chart' }), 'visualization');
});

test('view identity is verified before field extraction', async () => {
  const places = await loadJsonGz(placesGz);
  const records = await loadCdcRecords();
  const record = records.find((item) => item.identity.match_fields.source_id === PLACES_154_VIEW_ID);
  assert.throws(() => bindCdcView({ record, view: { ...places, id: 'other' } }), { code: 'CDC_VIEW_IDENTITY_MISMATCH' });
  const bound = bindCdcView({ record, view: places });
  assert.equal(bound.view_identity_verified, true);
  assert.equal(bound.named_column_count, 154);
});

test('PLACES 154 fields preserve wire names without geography completeness or person grain', async () => {
  const places = await loadJsonGz(placesGz);
  const records = await loadCdcRecords();
  const record = records.find((item) => item.identity.match_fields.source_id === PLACES_154_VIEW_ID);
  const bound = bindCdcView({ record, view: places });
  assert.equal(bound.columns.length, 154);
  assert.equal(bound.columns[0].fieldName, 'stateabbr');
  assert.equal(bound.columns[0].label, 'StateAbbr');
  assert.equal(bound.columns[0].type, 'text');
  assert.equal(typeof bound.columns[0].description, 'string');
  assert.equal(bound.geography_complete, false);
  assert.equal(bound.person_level_grain, false);
  assert.equal(bound.columns.every((column) => column.geography_complete === false && column.person_level_grain === false), true);
  assert.equal(bound.row_label, null);
  assert.ok(bound.custom_fields?.['Common Core']);
  assert.equal(bound.queryable_table, true);
  assert.equal(bound.payload_success, false);
});

test('row-sample eligibility uses retained view kinds across all 1472 CDC IDs', async () => {
  const [index, records] = await Promise.all([loadJsonGz(indexGz), loadCdcRecords()]);
  assert.equal(records.length, 1472);
  assert.equal(index.record_count, 1472);
  const receipt = buildCdcExtractionReceipt({ records, views: index.views });
  assert.equal(receipt.record_count, 1472);
  assert.equal(receipt.disappeared_record_count, 0);
  assert.equal(new Set(receipt.rows.map((row) => row.record_id)).size, 1472);
  const tabular = receipt.rows.filter((row) => row.kind === 'tabular_dataset');
  const nonTabular = receipt.rows.filter((row) => row.kind !== 'tabular_dataset');
  assert.ok(tabular.length > 1000);
  assert.equal(tabular.every((row) => row.row_sample_eligible === true || row.isolated === true || row.named_column_count === 0), true);
  assert.equal(nonTabular.every((row) => row.row_sample_eligible === false), true);
  assert.equal(nonTabular.every((row) => row.queryable_table === false), true);
});

test('four isolated CDC records stay in explicit compatibility or missing-data handling', async () => {
  const [index, records] = await Promise.all([loadJsonGz(indexGz), loadCdcRecords()]);
  const receipt = buildCdcExtractionReceipt({ records, views: index.views });
  assert.deepEqual(receipt.isolated_record_ids, ISOLATED_CDC_RECORD_IDS);
  for (const id of ISOLATED_CDC_RECORD_IDS) {
    const row = receipt.rows.find((item) => item.record_id === id);
    assert.equal(row.isolated, true);
    assert.equal(row.handling, 'compatibility_or_missing_data');
    assert.equal(row.row_sample_eligible, false);
  }
});

test('dictionary counts use record IDs with parse receipts, not fetched pages', async () => {
  const [index, records, places] = await Promise.all([loadJsonGz(indexGz), loadCdcRecords(), loadJsonGz(placesGz)]);
  const receipt = buildCdcExtractionReceipt({
    records,
    views: index.views.map((view) => view.source_native_id === PLACES_154_VIEW_ID ? { ...view, view: places } : view),
  });
  assert.equal(receipt.fetched_page_count, null);
  assert.ok(receipt.dictionary_count >= 1);
  assert.equal(receipt.dictionary_count, receipt.dictionary_record_ids.length);
  assert.ok(receipt.dictionary_record_ids.includes(records.find((item) => item.identity.match_fields.source_id === PLACES_154_VIEW_ID).record_id));
});

test('HTTP 200 HTML documentation cannot become JSON payload success', () => {
  const classified = htmlDocumentationCannotBeJsonSuccess({
    headers: headers('text/html; charset=utf-8'),
    bodyBytes: Buffer.from('<html><title>PLACES</title><p>documentation</p></html>'),
  });
  assert.notEqual(classified.classification, 'catalog_metadata');
  assert.equal(classified.accepted, false);
});

test('live fetch is forbidden in the CDC view adapter path', async () => {
  await assert.rejects(() => blockedFetch('https://data.cdc.gov/api/views/7cmc-7y5g.json'), { code: 'CDC_VIEW_LIVE_NETWORK_FORBIDDEN' });
});
