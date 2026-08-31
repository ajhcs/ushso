import assert from 'node:assert/strict';
import { ArcGisCatalogConnector } from '../adapters/arcgis.mjs';
import { CensusMetadataConnector } from '../adapters/census.mjs';
import { classifyCmsReleaseLocators } from '../adapters/cms.mjs';
import { DataGovV4CatalogConnector } from '../adapters/data-gov-v4.mjs';
import { DataCiteCatalogConnector } from '../adapters/datacite.mjs';
import { DataverseCatalogConnector } from '../adapters/dataverse.mjs';
import { OaiPmhCatalogConnector } from '../adapters/oai-pmh.mjs';
import { canonicalJson, deepFreeze, sha256 } from '../canonical.mjs';
import { deliveryWaveManifest, validateDeliveryWaveRegistry } from '../delivery-waves.mjs';
import { RegulatorApcdRegistryDispatcher, validateRegulatorApcdRegistry } from '../regulator-apcd-registry.mjs';
import { compileManifestRequest } from '../route-manifest.mjs';
import { jsonResponse, makeFixtureDescriptor, makeHarness } from './fixtures.mjs';

const SLOT = '2026-08-30T00:00:00.000Z';
const ROOT = 'https://catalog.example.gov/data.json';

function recordedFixture(fixtureId, body, mediaType = 'application/json') {
  const exactBody = typeof body === 'string' ? body : JSON.stringify(body);
  return { fixture_id: fixtureId, recording_kind: 'offline_contract_fixture_not_live_capture', media_type: mediaType, exact_body: exactBody, exact_body_sha256: sha256(exactBody) };
}

export const RECORDED_DELIVERY_WAVE_FIXTURES = deepFreeze({
  dcat_catalog_page: recordedFixture('dcat_catalog_page', { dataset: [{ identifier: 'dcat-fixture-1', title: 'Public catalog metadata', modified: '2026-08-01T00:00:00.000Z' }] }),
  cms_provider_page: recordedFixture('cms_provider_page', [{ identifier: 'cms-provider-fixture-1', title: 'Provider catalog metadata', modified: '2026-08-01T00:00:00.000Z' }]),
  socrata_metadata_page: recordedFixture('socrata_metadata_page', [{ id: 'abcd-1234', name: 'Socrata metadata fixture', rowsUpdatedAt: 1_786_579_200 }]),
  ckan_catalog_page: recordedFixture('ckan_catalog_page', { success: true, result: { count: 1, results: [{ id: 'ckan-fixture-1', name: 'ckan-fixture-1', title: 'CKAN metadata fixture', metadata_modified: '2026-08-01T00:00:00.000Z' }] } }),
  html_release_inventory: recordedFixture('html_release_inventory', '<html><body><a data-release-id="release-2026" data-modified="2026-08-01T00:00:00.000Z" href="/public/releases/2026">2026 public metadata release</a></body></html>', 'text/html'),
  form990_manifest_index: recordedFixture('form990_manifest_index', '<html><body><a data-release-id="form990-2026-index" data-modified="2026-08-01T00:00:00.000Z" href="/pub/epostcard/990/xml/2026/">2026 filing manifest index</a></body></html>', 'text/html'),
  form990_xsd: recordedFixture('form990_xsd', '<?xml version="1.0"?><xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="Return" type="xs:string"/></xs:schema>', 'application/xml'),
  data_gov_page_1: recordedFixture('data_gov_page_1', { data: [{ id: 'dg-1', title: 'Hospital metadata', modified: '2026-08-01T00:00:00.000Z', organization: { id: 'cms', title: 'Centers for Medicare & Medicaid Services' } }], meta: { after: 'next-2' } }),
  data_gov_page_2: recordedFixture('data_gov_page_2', { data: [{ id: 'dg-2', title: 'Workforce metadata', modified: '2026-08-02T00:00:00.000Z', publisher: { name: 'Health Resources and Services Administration' } }], meta: {} }),
  arcgis_page_1: recordedFixture('arcgis_page_1', { total: 2, start: 1, num: 1, nextStart: 2, results: [{ id: 'arc-1', title: 'Hospital locations metadata', modified: 1_786_579_200_000, type: 'Feature Service' }] }),
  arcgis_page_2: recordedFixture('arcgis_page_2', { total: 2, start: 2, num: 1, nextStart: -1, results: [{ id: 'arc-2', title: 'Facility registry metadata', modified: 1_786_665_600_000, type: 'Map Service' }] }),
  dataverse_page_1: recordedFixture('dataverse_page_1', { status: 'OK', data: { total_count: 2, start: 0, items: [{ type: 'dataset', name: 'Dataset one', global_id: 'doi:10.7910/DVN/FIXTURE1', updated_at: '2026-08-01T00:00:00.000Z' }] } }),
  dataverse_page_2: recordedFixture('dataverse_page_2', { status: 'OK', data: { total_count: 2, start: 1, items: [{ type: 'dataset', name: 'Dataset two', global_id: 'doi:10.7910/DVN/FIXTURE2', updated_at: '2026-08-02T00:00:00.000Z' }] } }),
  datacite_page_1: recordedFixture('datacite_page_1', { data: [{ id: '10.0000/fixture.1', type: 'dois', attributes: { doi: '10.0000/fixture.1', titles: [{ title: 'Registry metadata one' }], updated: '2026-08-01T00:00:00.000Z' } }], links: { next: 'https://catalog.example.gov/data.json?page%5Bnumber%5D=2&page%5Bsize%5D=1' } }),
  datacite_page_2: recordedFixture('datacite_page_2', { data: [{ id: '10.0000/fixture.2', type: 'dois', attributes: { doi: '10.0000/fixture.2', titles: [{ title: 'Registry metadata two' }], updated: '2026-08-02T00:00:00.000Z' } }], links: { next: null } }),
  oai_page_1: recordedFixture('oai_page_1', '<?xml version="1.0" encoding="UTF-8"?><OAI-PMH><ListRecords><record><header><identifier>oai:cdc:fixture-1</identifier><datestamp>2026-08-01</datestamp><setSpec>health</setSpec></header><metadata><oai_dc:dc><dc:title>CDC metadata one</dc:title></oai_dc:dc></metadata></record><resumptionToken>resume-2</resumptionToken></ListRecords></OAI-PMH>', 'application/xml'),
  oai_page_2: recordedFixture('oai_page_2', '<?xml version="1.0" encoding="UTF-8"?><OAI-PMH><ListRecords><record><header status="deleted"><identifier>oai:cdc:fixture-2</identifier><datestamp>2026-08-02</datestamp></header></record><resumptionToken></resumptionToken></ListRecords></OAI-PMH>', 'application/xml'),
  census_variables: recordedFixture('census_variables', { variables: { NAME: { label: 'Geographic area name', concept: 'Geography', predicateType: 'string' } } }),
});

export const DESCRIPTOR_FIXTURE_COVERAGE = deepFreeze({
  descriptor_data_gov_v4_fixture_v1: ['data_gov_page_1', 'data_gov_page_2'],
  descriptor_data_cms_data_json_fixture_v1: ['dcat_catalog_page'],
  descriptor_cms_provider_data_fixture_v1: ['cms_provider_page'],
  descriptor_cdc_socrata_fixture_v1: ['socrata_metadata_page'],
  descriptor_cdc_non_socrata_fixture_v1: ['dcat_catalog_page', 'html_release_inventory'],
  descriptor_census_metadata_fixture_v1: ['dcat_catalog_page', 'census_variables'],
  descriptor_hrsa_inventory_fixture_v1: ['dcat_catalog_page', 'html_release_inventory'],
  descriptor_ahrq_family_inventory_fixture_v1: ['html_release_inventory'],
  descriptor_irs_teos_eobmf_inventory_fixture_v1: ['html_release_inventory'],
  descriptor_irs_form990_manifest_fixture_v1: ['form990_manifest_index', 'form990_xsd'],
  descriptor_irs_soi_inventory_fixture_v1: ['html_release_inventory'],
  descriptor_pa_socrata_fixture_v1: ['socrata_metadata_page'],
  descriptor_ca_ckan_canary_fixture_v1: ['ckan_catalog_page'],
  descriptor_pa_arcgis_canary_fixture_v1: ['arcgis_page_1', 'arcgis_page_2'],
  descriptor_pa_static_canary_fixture_v1: ['html_release_inventory'],
  descriptor_harvard_dataverse_fixture_v1: ['dataverse_page_1', 'dataverse_page_2'],
  descriptor_datacite_fixture_v1: ['datacite_page_1', 'datacite_page_2'],
  descriptor_cdc_stacks_oai_fixture_v1: ['oai_page_1', 'oai_page_2'],
});

export const DELIVERY_WAVE_FIXTURE_REQUIREMENTS = deepFreeze([
  'conditional_304_reuse', 'insert_and_update', 'expired_cursor_blocks_checkpoint', 'rate_limited',
  'unapproved_redirect', 'content_quarantine_matrix', 'oversize_response', 'deletion_target_classes',
  'data_gov_origin_and_cursor', 'cms_latest_vs_immutable', 'socrata_metadata_only', 'census_no_observations',
  'arcgis_bounded_pagination', 'regulator_apcd_nonexecution', 'dataverse_stable_pagination',
  'datacite_stable_pagination', 'oai_pmh_resumption_and_deletion', 'source_registry_activation_boundary',
]);

function fixtureDescriptor(connectorName, allowedParameters) {
  const descriptor = makeFixtureDescriptor({ connectorName });
  descriptor.endpoints[0].routes[0].allowed_parameters = [...allowedParameters];
  return descriptor;
}

function addFixture(transport, method, url, fixture) {
  transport.add(method, url, jsonResponse({}, { bodyBytes: fixture.exact_body, contentType: fixture.media_type }));
}

function pass(results, scenario, assertions) { results.push({ scenario, status: 'PASS', assertions }); }

export async function runDeliveryWaveFixtureMatrix() {
  const results = [];

  {
    const descriptor = fixtureDescriptor('data-gov-v4-catalog', ['per_page', 'after']);
    const connector = new DataGovV4CatalogConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog', pageSize: 1 });
    const harness = makeHarness({ descriptor });
    addFixture(harness.transport, 'GET', `${ROOT}?per_page=1`, RECORDED_DELIVERY_WAVE_FIXTURES.data_gov_page_1);
    addFixture(harness.transport, 'GET', `${ROOT}?after=next-2&per_page=1`, RECORDED_DELIVERY_WAVE_FIXTURES.data_gov_page_2);
    const run = await harness.runner.run({ connector, runId: 'run_wave_data_gov', scheduledSlot: SLOT, mode: 'full_membership' });
    assert.equal(run.outcome, 'succeeded');
    assert.equal(run.seal.pagesCommitted, 2);
    const normalized = connector.normalize(run.seal.observations[0]);
    assert.equal(normalized.aggregation_origin.originating_agency_name, 'Centers for Medicare & Medicaid Services');
    assert.equal(normalized.aggregation_origin.aggregator, 'Data.gov');
    pass(results, 'data_gov_origin_and_cursor', 4);
  }

  {
    const modeled = classifyCmsReleaseLocators({ distribution: [
      { accessURL: 'https://data.cms.gov/provider-data/api/1/datastore/sql?ignored=no' },
      { downloadURL: 'https://data.cms.gov/provider-data/files/latest/hospital.csv' },
      { downloadURL: 'https://data.cms.gov/provider-data/files/2026-08-01/hospital.csv' },
    ] });
    assert.equal(modeled.find((entry) => entry.locator.includes('/latest/')).locator_kind, 'latest_alias');
    assert.equal(modeled.find((entry) => entry.locator.includes('/2026-08-01/')).locator_kind, 'immutable_release');
    assert.ok(modeled.every((entry) => entry.retrieval_authorized === false));
    pass(results, 'cms_latest_vs_immutable', 3);
  }

  {
    const manifest = deliveryWaveManifest();
    const socrata = manifest.filter((source) => source.platform === 'socrata');
    assert.ok(socrata.length >= 2);
    assert.ok(socrata.flatMap((source) => source.routes).every((route) => !/\/resource\//.test(route.path_template)));
    assert.ok(socrata.flatMap((source) => source.routes).every((route) => route.purpose === 'catalog_metadata' || route.purpose === 'schema'));
    pass(results, 'socrata_metadata_only', 3);
  }

  {
    const descriptor = makeFixtureDescriptor({ connectorName: 'census-metadata' });
    const schemaRoute = descriptor.endpoints.find((entry) => entry.endpoint_id === 'endpoint_fixture_schema').routes[0];
    schemaRoute.path_template = '/data/{year}/{dataset_family}/{dataset}/variables.json';
    schemaRoute.allowed_parameters = ['year', 'dataset_family', 'dataset'];
    const connector = new CensusMetadataConnector({
      descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog',
      variablesEndpointId: 'endpoint_fixture_schema', variablesTemplateId: 'route_fixture_schema',
      configuredDatasets: [{ year: '2025', datasetFamily: 'acs', dataset: 'acs5' }],
    });
    const request = connector.variablesRequest({ year: '2025', datasetFamily: 'acs', dataset: 'acs5' });
    const compiled = compileManifestRequest(descriptor, request);
    assert.equal(compiled.url.toString(), 'https://catalog.example.gov/data/2025/acs/acs5/variables.json');
    assert.deepEqual(Object.keys(request.query), []);
    assert.throws(() => connector.variablesRequest({ year: '2025', datasetFamily: 'dec', dataset: 'pl' }), /outside the configured metadata scope/);
    assert.ok(!descriptor.endpoints.flatMap((entry) => entry.routes).some((route) => route.allowed_parameters.includes('get')));
    pass(results, 'census_no_observations', 4);
  }

  {
    const descriptor = fixtureDescriptor('arcgis-catalog', ['f', 'q', 'num', 'start']);
    const connector = new ArcGisCatalogConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog', pageSize: 1, fixedQuery: 'orgid:fixture' });
    const harness = makeHarness({ descriptor });
    addFixture(harness.transport, 'GET', `${ROOT}?f=json&num=1&q=orgid%3Afixture&start=1`, RECORDED_DELIVERY_WAVE_FIXTURES.arcgis_page_1);
    addFixture(harness.transport, 'GET', `${ROOT}?f=json&num=1&q=orgid%3Afixture&start=2`, RECORDED_DELIVERY_WAVE_FIXTURES.arcgis_page_2);
    const run = await harness.runner.run({ connector, runId: 'run_wave_arcgis', scheduledSlot: SLOT, mode: 'full_membership' });
    assert.equal(run.outcome, 'succeeded');
    assert.equal(run.seal.pagesCommitted, 2);
    assert.deepEqual(run.seal.observations.map((item) => item.nativeId), ['arc-1', 'arc-2']);
    assert.ok(run.seal.observations.every((item) => item.sourceLocator.nativePointer === '/results/0'));
    pass(results, 'arcgis_bounded_pagination', 4);
  }

  {
    const validated = validateRegulatorApcdRegistry();
    const dispatcher = new RegulatorApcdRegistryDispatcher();
    const workflow = dispatcher.dispatch('registry_us_pa_discharge_regulator');
    assert.equal(validated.entries, 8);
    assert.equal(workflow.outcome, 'human_workflow');
    assert.equal(workflow.execution_authorized, false);
    assert.equal(workflow.transport_calls, 0);
    assert.ok(workflow.entry.workflow.steps.every((step) => step.requires_human && !step.execution_authorized));
    const gap = dispatcher.dispatch('registry_us_xx_evidence_gap_fixture').entry;
    const unassessed = dispatcher.dispatch('registry_us_xy_not_assessed_fixture').entry;
    const transportFailure = dispatcher.dispatch('registry_us_xz_transport_failure_fixture').entry;
    const sourceAbsent = dispatcher.dispatch('registry_us_xw_source_absent_fixture').entry;
    assert.notEqual(gap.assessment_outcome, unassessed.assessment_outcome);
    assert.notEqual(transportFailure.assessment_outcome, sourceAbsent.assessment_outcome);
    assert.notEqual(dispatcher.dispatch('registry_missing').outcome, 'assessment_state');
    pass(results, 'regulator_apcd_nonexecution', 9);
  }

  {
    const descriptor = fixtureDescriptor('dataverse-catalog', ['q', 'type', 'per_page', 'start']);
    const connector = new DataverseCatalogConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog', pageSize: 1 });
    const harness = makeHarness({ descriptor });
    addFixture(harness.transport, 'GET', `${ROOT}?per_page=1&q=*&start=0&type=dataset`, RECORDED_DELIVERY_WAVE_FIXTURES.dataverse_page_1);
    addFixture(harness.transport, 'GET', `${ROOT}?per_page=1&q=*&start=1&type=dataset`, RECORDED_DELIVERY_WAVE_FIXTURES.dataverse_page_2);
    const run = await harness.runner.run({ connector, runId: 'run_wave_dataverse', scheduledSlot: SLOT, mode: 'full_membership' });
    assert.equal(run.outcome, 'succeeded');
    assert.deepEqual(run.seal.observations.map((item) => item.nativeId), ['doi:10.7910/DVN/FIXTURE1', 'doi:10.7910/DVN/FIXTURE2']);
    assert.equal(connector.normalize(run.seal.observations[0]).authority_boundary.ranking_precedence, 'below_first_party_government');
    assert.ok(run.seal.observations.every((item) => item.sourceLocator.nativePointer === '/data/items/0'));
    pass(results, 'dataverse_stable_pagination', 4);
  }

  {
    const descriptor = fixtureDescriptor('datacite-catalog', ['page[number]', 'page[size]']);
    const connector = new DataCiteCatalogConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog', pageSize: 1 });
    const harness = makeHarness({ descriptor });
    addFixture(harness.transport, 'GET', `${ROOT}?page%5Bnumber%5D=1&page%5Bsize%5D=1`, RECORDED_DELIVERY_WAVE_FIXTURES.datacite_page_1);
    addFixture(harness.transport, 'GET', `${ROOT}?page%5Bnumber%5D=2&page%5Bsize%5D=1`, RECORDED_DELIVERY_WAVE_FIXTURES.datacite_page_2);
    const run = await harness.runner.run({ connector, runId: 'run_wave_datacite', scheduledSlot: SLOT, mode: 'full_membership' });
    assert.equal(run.outcome, 'succeeded');
    assert.deepEqual(run.seal.observations.map((item) => item.nativeId), ['10.0000/fixture.1', '10.0000/fixture.2']);
    assert.equal(connector.normalize(run.seal.observations[0]).authority_boundary.underlying_asset_authority, 'unverified');
    assert.ok(run.seal.observations.every((item) => item.sourceLocator.nativePointer === '/data/0'));
    pass(results, 'datacite_stable_pagination', 4);
  }

  {
    const descriptor = fixtureDescriptor('oai-pmh-catalog', ['verb', 'metadataPrefix', 'set', 'resumptionToken']);
    const connector = new OaiPmhCatalogConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' });
    const harness = makeHarness({ descriptor });
    addFixture(harness.transport, 'GET', `${ROOT}?metadataPrefix=oai_dc&verb=ListRecords`, RECORDED_DELIVERY_WAVE_FIXTURES.oai_page_1);
    addFixture(harness.transport, 'GET', `${ROOT}?resumptionToken=resume-2&verb=ListRecords`, RECORDED_DELIVERY_WAVE_FIXTURES.oai_page_2);
    const run = await harness.runner.run({ connector, runId: 'run_wave_oai', scheduledSlot: SLOT, mode: 'full_membership' });
    assert.equal(run.outcome, 'succeeded');
    assert.equal(run.seal.pagesCommitted, 2);
    assert.equal(run.seal.observations.find((item) => item.nativeId === 'oai:cdc:fixture-2').tombstone, true);
    assert.equal(harness.objectStore.objects.size, 2);
    pass(results, 'oai_pmh_resumption_and_deletion', 4);
  }

  {
    const registry = validateDeliveryWaveRegistry();
    const manifest = deliveryWaveManifest();
    assert.equal(registry.source_instances, manifest.length);
    assert.deepEqual(registry.waves, [2, 3, 4, 6]);
    assert.ok(manifest.every((source) => source.external_authorization_gate === 'AUTH-04' && !source.activation_authorized && !source.live_network_permitted));
    assert.ok(manifest.every((source) => source.routes.every((route) => !/\.(?:zip|gz|csv|parquet)(?:$|\/)/i.test(route.path_template))));
    assert.ok(manifest.find((source) => source.platform === 'datacite').authority_precedence === 'below_first_party_government');
    pass(results, 'source_registry_activation_boundary', 5);
  }

  for (const fixture of Object.values(RECORDED_DELIVERY_WAVE_FIXTURES)) assert.equal(sha256(fixture.exact_body), fixture.exact_body_sha256);
  assert.deepEqual(Object.keys(DESCRIPTOR_FIXTURE_COVERAGE).sort(), deliveryWaveManifest().map((entry) => entry.descriptor_id).sort());
  assert.ok(Object.values(DESCRIPTOR_FIXTURE_COVERAGE).flat().every((fixtureId) => Object.hasOwn(RECORDED_DELIVERY_WAVE_FIXTURES, fixtureId)));

  return {
    status: 'PASS', evidence_scope: 'fixture_only', integration_level: 'local_integration',
    scenarios: results,
    recorded_fixtures: Object.keys(RECORDED_DELIVERY_WAVE_FIXTURES).length,
    fixture_manifest_digest: sha256(canonicalJson(RECORDED_DELIVERY_WAVE_FIXTURES)),
    totals: { scenarios: results.length, assertions: results.reduce((total, result) => total + result.assertions, 0) + Object.keys(RECORDED_DELIVERY_WAVE_FIXTURES).length + 2 },
    zero_external_actions: { dns_queries: 0, network_requests: 0, credentials_created: 0, r2_calls: 0, database_calls: 0, cloudflare_calls: 0, deployments: 0, source_activations: 0 },
  };
}
