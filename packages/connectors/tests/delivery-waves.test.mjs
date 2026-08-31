import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  APPROVED_SOURCE_DESCRIPTOR_TEMPLATES, DELIVERY_WAVE_SOURCE_INSTANCES,
  DataCiteCatalogConnector, OaiPmhCatalogConnector, REGULATOR_APCD_REGISTRY,
  buildLegacyLaneParity, deliveryWaveManifest,
  validateDeliveryWaveRegistry, validateRegulatorApcdRegistry,
} from '../src/index.mjs';
import { runFixtureMatrix } from '../src/testing/fixture-matrix.mjs';
import {
  DELIVERY_WAVE_FIXTURE_REQUIREMENTS, DESCRIPTOR_FIXTURE_COVERAGE, RECORDED_DELIVERY_WAVE_FIXTURES,
  runDeliveryWaveFixtureMatrix,
} from '../src/testing/wave-fixtures.mjs';
import { jsonResponse, makeFixtureDescriptor, makeHarness } from '../src/testing/index.mjs';

test('Waves 2-6 recorded fixture matrix passes with no external action', async () => {
  const result = await runDeliveryWaveFixtureMatrix();
  assert.equal(result.status, 'PASS');
  assert.equal(result.totals.scenarios, 10);
  assert.equal(result.totals.assertions, 61);
  assert.equal(result.recorded_fixtures, 18);
  assert.ok(Object.values(result.zero_external_actions).every((value) => value === 0));
});

test('required 304/change/cursor/failure and source-specific fixtures are all executable', async () => {
  const foundation = await runFixtureMatrix();
  const waves = await runDeliveryWaveFixtureMatrix();
  const covered = new Set([...foundation.scenarios, ...waves.scenarios].map((scenario) => scenario.scenario));
  assert.deepEqual(DELIVERY_WAVE_FIXTURE_REQUIREMENTS.filter((scenario) => !covered.has(scenario)), []);
  for (const fixture of Object.values(RECORDED_DELIVERY_WAVE_FIXTURES)) {
    assert.equal(fixture.recording_kind, 'offline_contract_fixture_not_live_capture');
    assert.match(fixture.exact_body_sha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(Object.keys(DESCRIPTOR_FIXTURE_COVERAGE).sort(), DELIVERY_WAVE_SOURCE_INSTANCES.map((entry) => entry.descriptor_id).sort());
});

test('every source-specific instance is disabled, paused, candidate-only, and AUTH-04 gated', () => {
  const result = validateDeliveryWaveRegistry();
  assert.equal(result.source_instances, 18);
  assert.equal(DELIVERY_WAVE_SOURCE_INSTANCES.length, APPROVED_SOURCE_DESCRIPTOR_TEMPLATES.length);
  assert.ok(DELIVERY_WAVE_SOURCE_INSTANCES.every((entry) => entry.lifecycle === 'fixture_only' && entry.source_state === 'paused'));
  assert.ok(DELIVERY_WAVE_SOURCE_INSTANCES.every((entry) => entry.coverage_cell_state === 'candidate' && entry.external_authorization_gate === 'AUTH-04'));
  assert.ok(DELIVERY_WAVE_SOURCE_INSTANCES.every((entry) => !entry.activation_authorized && !entry.live_network_permitted));
});

test('route inventory declares metadata only and Form 990 never routes to bulk archives', () => {
  const manifest = deliveryWaveManifest();
  const routes = manifest.flatMap((entry) => entry.routes);
  assert.ok(routes.every((route) => ['catalog_metadata', 'documentation', 'schema', 'access_probe'].includes(route.purpose)));
  assert.ok(routes.every((route) => route.forbidden_route_classes.includes('source_data_payload')));
  assert.ok(routes.every((route) => !/\.(?:zip|gz|7z|rar)(?:$|\/)/i.test(route.path_template)));
  assert.ok(routes.filter((route) => route.template_id.includes('form990')).every((route) => route.purpose === 'documentation' || route.purpose === 'schema'));
});

test('regulator/APCD workflows cannot become executable through declarative state', () => {
  assert.equal(validateRegulatorApcdRegistry().entries, 8);
  const adversarial = structuredClone(REGULATOR_APCD_REGISTRY);
  adversarial[1].workflow.steps[0].execution_authorized = true;
  assert.throws(() => validateRegulatorApcdRegistry(adversarial), /human-only, and non-executable/);
  const states = new Map(REGULATOR_APCD_REGISTRY.map((entry) => [entry.registry_id, entry.assessment_outcome]));
  assert.notEqual(states.get('registry_us_xx_evidence_gap_fixture'), states.get('registry_us_xy_not_assessed_fixture'));
  assert.notEqual(states.get('registry_us_xz_transport_failure_fixture'), states.get('registry_us_xw_source_absent_fixture'));
  const injected = structuredClone(REGULATOR_APCD_REGISTRY);
  injected[0].machine_actionable = true;
  assert.throws(() => validateRegulatorApcdRegistry(injected), /invalid property set/);
});

test('protocol-specific metadata allowances do not create row or active-XML bypasses', async () => {
  const dataciteDescriptor = makeFixtureDescriptor({ connectorName: 'datacite-catalog' });
  dataciteDescriptor.endpoints[0].routes[0].allowed_parameters = ['page[number]', 'page[size]'];
  const datacite = new DataCiteCatalogConnector({ descriptor: dataciteDescriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog', pageSize: 1 });
  const dataciteHarness = makeHarness({ descriptor: dataciteDescriptor });
  dataciteHarness.transport.add('GET', 'https://catalog.example.gov/data.json?page%5Bnumber%5D=1&page%5Bsize%5D=1', jsonResponse({
    data: [{ id: '10.0000/adversarial', type: 'dois', attributes: { titles: [{ title: 'Metadata-looking wrapper' }], updated: '2026-08-01T00:00:00.000Z', data: [{ county_code: '001', measure_value: 7 }] } }], links: { next: null },
  }));
  const dataciteRun = await dataciteHarness.runner.run({ connector: datacite, runId: 'run_datacite_nested_rows', scheduledSlot: '2026-08-30T00:00:00.000Z', mode: 'full_membership' });
  assert.equal(dataciteRun.failure.safe_detail_code, 'ROW_SHAPED_RESPONSE_QUARANTINED');
  assert.equal(dataciteHarness.objectStore.objects.size, 0);

  const oaiDescriptor = makeFixtureDescriptor({ connectorName: 'oai-pmh-catalog' });
  oaiDescriptor.endpoints[0].routes[0].allowed_parameters = ['verb', 'metadataPrefix', 'resumptionToken'];
  const oai = new OaiPmhCatalogConnector({ descriptor: oaiDescriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' });
  const oaiHarness = makeHarness({ descriptor: oaiDescriptor });
  const activeXml = '<!DOCTYPE OAI-PMH [<!ENTITY xxe SYSTEM "https://example.org/entity">]><OAI-PMH><ListRecords></ListRecords></OAI-PMH>';
  oaiHarness.transport.add('GET', 'https://catalog.example.gov/data.json?metadataPrefix=oai_dc&verb=ListRecords', jsonResponse({}, { bodyBytes: activeXml, contentType: 'application/xml' }));
  const oaiRun = await oaiHarness.runner.run({ connector: oai, runId: 'run_oai_active_xml', scheduledSlot: '2026-08-30T00:00:00.000Z', mode: 'full_membership' });
  assert.equal(oaiRun.failure.safe_detail_code, 'OAI_PMH_SCHEMA_DRIFT');
  assert.equal(oaiHarness.objectStore.objects.size, 0);
});

test('all 52 Dataverse and 50 DataCite records retain stable IDs and complete evidence lineage', async () => {
  const input = await readFile(new URL('../../retrieval/versions/v1.1.0/corpus/records.jsonl', import.meta.url), 'utf8');
  const parity = buildLegacyLaneParity(input.trim().split(/\n/).map(JSON.parse));
  assert.deepEqual(parity.counts, { harvard_dataverse: 52, datacite: 50 });
  assert.equal(parity.records, 102);
  assert.equal(parity.stable_id_collisions, 0);
  assert.equal(parity.missing_source_evidence, 0);
  assert.equal(parity.missing_provenance_links, 0);
  assert.equal(parity.automatic_identity_merges, 0);
  assert.equal(parity.authority_precedence, 'below_first_party_government');
});
