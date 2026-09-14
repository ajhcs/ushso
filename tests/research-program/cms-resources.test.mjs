import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  HOSPITAL_COST_REPORT_ID,
  bindCmsCatalogResources,
  blockedFetch,
  buildCmsCauseLedger,
  cmsCorpusRecords,
  htmlDocumentationCannotBeJsonSuccess,
  retainedCatalogCapture,
  sha256Text,
} from '../../scripts/research/cms-documents.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureGz = path.join(root, 'verification/research-program/pr-013/fixtures/cms-catalog-slim.json.gz');

async function loadCatalog() {
  const bytes = await fs.readFile(fixtureGz);
  const text = gunzipSync(bytes).toString('utf8');
  const data = JSON.parse(text);
  return retainedCatalogCapture({
    url: 'https://data.cms.gov/data.json',
    status: 'captured',
    sha256: sha256Text(text),
    text,
    data,
  });
}

async function loadCmsRecords() {
  const corpus = JSON.parse(await fs.readFile(path.join(root, 'packages/retrieval/versions/v1.2.0/corpus/corpus.json'), 'utf8'));
  const records = [];
  for (const file of corpus.record_files) {
    const text = await fs.readFile(path.join(root, 'packages/retrieval/versions/v1.2.0/corpus', file), 'utf8');
    for (const line of text.trim().split(/\r?\n/u).filter(Boolean)) records.push(JSON.parse(line));
  }
  return cmsCorpusRecords(records);
}

function headers(contentType) {
  return new Headers({ 'content-type': contentType });
}

test('CMS catalog fixture is retained JSON and not live network', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = blockedFetch;
  try {
    const catalog = await loadCatalog();
    assert.equal(catalog.url, 'https://data.cms.gov/data.json');
    assert.equal(catalog.status, 'captured');
    assert.equal(catalog.payload_success, false);
    assert.equal(catalog.data.dataset.length, 159);
  } finally {
    globalThis.fetch = previous;
  }
});

test('cost-report fixture distinguishes product coverage, 2023 distribution, and later metadata modification', async () => {
  const [catalog, records] = await Promise.all([loadCatalog(), loadCmsRecords()]);
  const record = records.find((item) => item.identity.match_fields.source_id === HOSPITAL_COST_REPORT_ID);
  assert.ok(record);
  const bound = bindCmsCatalogResources(record, catalog);
  assert.equal(bound.title, 'Hospital Provider Cost Report');
  assert.equal(bound.roles.title, 'Hospital Provider Cost Report');
  assert.equal(bound.roles.temporal, '2011-01-01/2023-12-31');
  assert.equal(bound.product_temporal, '2011-01-01/2023-12-31');
  assert.equal(bound.roles.modified, '2026-01-08');
  assert.notEqual(bound.roles.temporal, bound.roles.modified);
  const dist2023 = bound.distributions.find((item) => item.temporal === '2023-01-01/2023-12-31' && item.role === 'csv');
  assert.ok(dist2023);
  assert.equal(dist2023.title, 'Hospital Provider Cost Report : 2023-12-04');
  assert.notEqual(dist2023.temporal, bound.product_temporal);
  assert.ok(bound.roles.modified > '2023-12-04');
  assert.equal(bound.payload_success, false);
});

test('title, temporal, modified and format stay in distinct roles', async () => {
  const [catalog, records] = await Promise.all([loadCatalog(), loadCmsRecords()]);
  const record = records.find((item) => item.identity.match_fields.source_id === HOSPITAL_COST_REPORT_ID);
  const bound = bindCmsCatalogResources(record, catalog);
  assert.equal(Object.keys(bound.roles).sort().join(','), 'format,landing_page,modified,temporal,title');
  assert.equal(bound.roles.format, null);
  assert.match(bound.roles.landing_page, /hospital-provider-cost-report$/);
  const csv = bound.distributions.find((item) => item.role === 'csv');
  assert.equal(csv.format, 'CSV');
  assert.notEqual(csv.format, bound.roles.title);
});

test('API, CSV, XLSX, ZIP and landing-page locators keep catalog pointers', async () => {
  const [catalog, records] = await Promise.all([loadCatalog(), loadCmsRecords()]);
  const boundAll = records.map((record) => bindCmsCatalogResources(record, catalog));
  const roles = new Set(boundAll.flatMap((bound) => bound.distributions.map((item) => item.role)));
  assert.ok(roles.has('api'));
  assert.ok(roles.has('csv'));
  const landing = boundAll[0].landing_page;
  assert.equal(landing.role, 'landing_page');
  assert.match(landing.locators[0].pointer, /landingPage$/);
  for (const bound of boundAll) {
    for (const candidate of bound.unique_locators) {
      assert.equal(typeof candidate.locator, 'string');
      assert.equal(typeof candidate.pointer, 'string');
      assert.match(candidate.pointer, /^\/dataset\/\d+/);
      assert.equal(candidate.payload_success, false);
    }
  }
  const xlsx = boundAll.flatMap((bound) => bound.distributions).filter((item) => item.role === 'xlsx_dictionary_or_table' || item.format === 'XLSX');
  const zip = boundAll.flatMap((bound) => bound.distributions).filter((item) => item.role === 'zip' || item.format === 'ZIP');
  assert.ok(xlsx.length > 0);
  assert.ok(zip.length > 0);
});

test('duplicate locators deduplicate by capture identity, not product identity', () => {
  const dataset = [{
    identifier: 'https://data.cms.gov/data-api/v1/dataset/dup/data-viewer',
    title: 'Duplicate locator product',
    modified: '2026-01-01',
    temporal: '2020-01-01/2020-12-31',
    landingPage: 'https://data.cms.gov/dup',
    distribution: [
      { format: 'CSV', downloadURL: 'https://data.cms.gov/same.csv', resourcesAPI: 'https://data.cms.gov/data-api/v1/dataset-resources/a' },
      { format: 'CSV', downloadURL: 'https://data.cms.gov/same.csv', resourcesAPI: 'https://data.cms.gov/data-api/v1/dataset-resources/b' },
    ],
  }];
  const text = JSON.stringify({ dataset });
  const capture = retainedCatalogCapture({
    url: 'https://data.cms.gov/data.json',
    status: 'captured',
    sha256: sha256Text(text),
    text,
    data: JSON.parse(text),
  });
  const record = {
    record_id: 'obs:asset:cms-data-catalog:dup',
    title: 'Duplicate locator product',
    identity: { source: { source_id: 'cms-data-catalog' }, match_fields: { source_id: 'https://data.cms.gov/data-api/v1/dataset/dup/data-viewer' } },
  };
  const bound = bindCmsCatalogResources(record, capture);
  const csv = bound.unique_locators.filter((item) => item.locator === 'https://data.cms.gov/same.csv');
  assert.equal(csv.length, 1);
  assert.equal(bound.distributions.length, 2);
  assert.equal(bound.distributions[0].capture_identity, bound.distributions[1].capture_identity);
});

test('adapter emits a reconciled cause-ledger row for all 159 CMS IDs', async () => {
  const [catalog, records] = await Promise.all([loadCatalog(), loadCmsRecords()]);
  assert.equal(records.length, 159);
  const ledger = buildCmsCauseLedger({ records, catalogCapture: catalog });
  assert.equal(ledger.record_count, 159);
  assert.equal(ledger.rows.length, 159);
  assert.equal(new Set(ledger.rows.map((row) => row.record_id)).size, 159);
  assert.equal(ledger.dictionary_absent_count, 0);
  assert.ok(ledger.unresolved_dictionary_locator_count > 0);
  assert.equal(ledger.payload_success, false);
  const cost = ledger.rows.find((row) => row.source_native_id === HOSPITAL_COST_REPORT_ID);
  assert.equal(cost.dictionary_locator_status, 'unresolved');
  assert.notEqual(cost.dictionary_locator_status, 'dictionary-absent');
  assert.equal(cost.next_action, 'retain_unresolved_dictionary_locator');
  assert.equal(cost.parser_family, 'cms_dcat_api_csv');
  assert.equal(cost.product_temporal, '2011-01-01/2023-12-31');
  assert.equal(cost.metadata_modified, '2026-01-08');
});

test('missing dictionary locator stays unresolved rather than dictionary-absent', async () => {
  const [catalog, records] = await Promise.all([loadCatalog(), loadCmsRecords()]);
  const ledger = buildCmsCauseLedger({ records, catalogCapture: catalog });
  assert.equal(ledger.rows.filter((row) => row.dictionary_locator_status === 'dictionary-absent').length, 0);
  assert.ok(ledger.rows.every((row) => row.dictionary_locator_status === 'present' || row.dictionary_locator_status === 'unresolved'));
});

test('HTTP 200 HTML documentation cannot become JSON payload success', () => {
  const classified = htmlDocumentationCannotBeJsonSuccess({
    headers: headers('text/html; charset=utf-8'),
    bodyBytes: Buffer.from('<html><title>Hospital Provider Cost Report</title><p>documentation</p></html>'),
    purpose: 'catalog_metadata',
  });
  assert.notEqual(classified.classification, 'catalog_metadata');
  assert.equal(classified.accepted, false);
});

test('live fetch is forbidden in the CMS resource adapter path', async () => {
  await assert.rejects(() => blockedFetch('https://data.cms.gov/data.json'), { code: 'CMS_RESOURCES_LIVE_NETWORK_FORBIDDEN' });
});
