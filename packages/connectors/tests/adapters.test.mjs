import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CkanCatalogConnector, DcatDataJsonConnector, HtmlReleaseInventoryConnector,
  SocrataCatalogConnector, extractDocumentation, extractSchemaMetadata,
} from '../src/index.mjs';
import { jsonResponse, makeFixtureDescriptor, makeHarness } from '../src/testing/index.mjs';

const SLOT = '2026-08-30T00:00:00.000Z';

test('DCAT data.json parses only metadata records and normalizes deterministically', async () => {
  const descriptor = makeFixtureDescriptor();
  const connector = new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' });
  const harness = makeHarness({ descriptor });
  harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: [{ identifier: 'dcat-1', title: 'DCAT one', modified: '2026-08-01T00:00:00.000Z' }] }));
  const result = await harness.runner.run({ connector, runId: 'run_dcat_adapter', scheduledSlot: SLOT, mode: 'full_membership' });
  assert.equal(result.outcome, 'succeeded');
  const observation = result.seal.observations[0];
  const first = connector.normalize(observation);
  const second = connector.normalize(observation);
  assert.deepEqual(first, second);
  assert.equal(first.native_id, 'dcat-1');
  assert.equal(first.source_locator.captureRefId, observation.sourceLocator.captureRefId);
});

test('CKAN adapter traverses bounded metadata pagination', async () => {
  const descriptor = makeFixtureDescriptor({ connectorName: 'ckan-catalog' });
  const connector = new CkanCatalogConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog', pageSize: 2 });
  const harness = makeHarness({ descriptor });
  harness.transport.add('GET', 'https://catalog.example.gov/data.json?rows=2&start=0', jsonResponse({ success: true, result: { count: 3, results: [
    { id: 'ckan-1', name: 'one', title: 'One', metadata_modified: '2026-08-01T00:00:00.000Z' },
    { id: 'ckan-2', name: 'two', title: 'Two', metadata_modified: '2026-08-01T00:00:00.000Z' },
  ] } }));
  harness.transport.add('GET', 'https://catalog.example.gov/data.json?rows=2&start=2', jsonResponse({ success: true, result: { count: 3, results: [
    { id: 'ckan-3', name: 'three', title: 'Three', metadata_modified: '2026-08-01T00:00:00.000Z' },
  ] } }));
  const result = await harness.runner.run({ connector, runId: 'run_ckan_adapter', scheduledSlot: SLOT, mode: 'full_membership' });
  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.seal.pagesCommitted, 2);
  assert.deepEqual(result.seal.observations.map((item) => item.nativeId), ['ckan-1', 'ckan-2', 'ckan-3']);
  assert.equal(result.seal.observations.find((item) => item.nativeId === 'ckan-3').sourceLocator.nativePointer, '/result/results/0');
});

test('Socrata adapter uses metadata endpoints and never SODA row routes', async () => {
  const descriptor = makeFixtureDescriptor({ connectorName: 'socrata-catalog' });
  const connector = new SocrataCatalogConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog', pageSize: 2 });
  const harness = makeHarness({ descriptor });
  harness.transport.add('GET', 'https://catalog.example.gov/data.json?limit=2&page=1', jsonResponse([
    { id: 'abcd-1234', name: 'Metadata one', rowsUpdatedAt: 1_787_875_200 },
    { id: 'efgh-5678', name: 'Metadata two', rowsUpdatedAt: 1_787_875_201 },
  ]));
  harness.transport.add('GET', 'https://catalog.example.gov/data.json?limit=2&page=2', jsonResponse([]));
  const result = await harness.runner.run({ connector, runId: 'run_socrata_adapter', scheduledSlot: SLOT, mode: 'full_membership' });
  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.seal.discoveriesCommitted, 2);
  assert.ok(harness.transport.calls.every((request) => !new URL(request.url).pathname.startsWith('/resource/')));
});

test('bounded HTML release inventory accepts labeled links and rejects unlabeled crawling', async () => {
  const descriptor = makeFixtureDescriptor({ connectorName: 'html-release-inventory' });
  const connector = new HtmlReleaseInventoryConnector({ descriptor, endpointId: 'endpoint_fixture_html_inventory', templateId: 'route_fixture_html_inventory' });
  const harness = makeHarness({ descriptor });
  harness.transport.add('GET', 'https://catalog.example.gov/inventory', jsonResponse({}, {
    bodyBytes: '<html><body><a data-release-id="r-2026" data-modified="2026-08-01T00:00:00.000Z" href="/releases/r-2026">2026 release</a><a href="https://evil.example">ignore</a></body></html>',
    contentType: 'text/html',
  }));
  const result = await harness.runner.run({ connector, runId: 'run_html_adapter', scheduledSlot: SLOT, mode: 'full_membership' });
  assert.equal(result.outcome, 'succeeded');
  assert.deepEqual(result.seal.observations.map((item) => item.nativeId), ['r-2026']);
  assert.equal(harness.transport.calls.length, 1);
});

test('documentation and schema extractors are bounded and reject active or row content', () => {
  const documentation = extractDocumentation('<h1>Guide</h1><p>Metadata only.</p>', { locator: 'https://catalog.example.gov/docs/guide', observedAt: SLOT });
  assert.equal(documentation.sections.length, 2);
  assert.throws(() => extractDocumentation('<form><input name="password"></form>', { locator: 'https://catalog.example.gov/docs/login', observedAt: SLOT }));
  const schema = extractSchemaMetadata({ fields: [{ name: 'facility_id', type: 'string', description: 'Source field metadata.' }] }, { locator: 'https://catalog.example.gov/schemas/one', observedAt: SLOT });
  assert.equal(schema.fields[0].name, 'facility_id');
  assert.throws(() => extractSchemaMetadata({ rows: [{ patient_id: 'p1' }] }, { locator: 'https://catalog.example.gov/data', observedAt: SLOT }));
});
