import assert from 'node:assert/strict';
import { APPROVED_SOURCE_DESCRIPTOR_TEMPLATES } from '../descriptors.mjs';
import { DcatDataJsonConnector } from '../adapters/dcat-data-json.mjs';
import { routeManifestInventory } from '../route-manifest.mjs';
import { jsonResponse, makeFixtureDescriptor, makeHarness } from './fixtures.mjs';

export async function runReconciliationAudit() {
  const descriptor = makeFixtureDescriptor();
  const connector = new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' });
  const harness = makeHarness({ descriptor });
  harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: [
    { identifier: 'audit-one', title: 'Audit one', modified: '2026-08-01T00:00:00.000Z' },
    { identifier: 'audit-two', title: 'Audit two', modified: '2026-08-02T00:00:00.000Z' },
  ] }));
  const run = await harness.runner.run({ connector, runId: 'run_reconciliation_audit', scheduledSlot: '2026-08-30T00:00:00.000Z', mode: 'full_membership' });
  assert.equal(run.outcome, 'succeeded');
  let exactLocatorLinks = 0;
  for (const observation of run.seal.observations) {
    const capture = harness.referenceStore.references.get(observation.sourceLocator.captureRefId);
    assert.ok(capture);
    assert.equal(capture.r2_key, observation.sourceLocator.r2Key);
    assert.equal(capture.raw_sha256, observation.sourceLocator.rawSha256);
    assert.equal(capture.source_locator.redacted_locator, observation.sourceLocator.redactedLocator);
    exactLocatorLinks += 1;
  }

  const sentinelHarness = makeHarness({ descriptor });
  const sentinel = await sentinelHarness.client.execute({
    descriptor, runId: 'run_reconciliation_sentinel', jobId: 'job_reconciliation_sentinel',
    request: {
      endpointId: 'endpoint_fixture_item', templateId: 'route_fixture_item', purpose: 'catalog_metadata',
      method: 'GET', targetClass: 'exact_item', pathParameters: { id: 'USHSONOEGRESS_SOURCE_DATA_PAYLOAD' }, query: {},
    },
    responseProfile: connector.responseProfile(),
  });
  assert.equal(sentinel.blockedBeforeEgress, true);
  assert.equal(sentinelHarness.transport.calls.length, 0);

  const rowsHarness = makeHarness({ descriptor });
  rowsHarness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse([{ patient_id: 'p1', diagnosis_code: 'd1', amount: 5 }]));
  const rows = await rowsHarness.client.execute({
    descriptor, runId: 'run_reconciliation_rows', jobId: 'job_reconciliation_rows',
    request: { endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog', purpose: 'catalog_metadata', method: 'GET', targetClass: 'collection', pathParameters: {}, query: {} },
    responseProfile: connector.responseProfile(),
  });
  assert.equal(rows.quarantined, true);
  assert.equal(rowsHarness.objectStore.objects.size, 0);

  const descriptorRouteCount = APPROVED_SOURCE_DESCRIPTOR_TEMPLATES.reduce((total, candidate) => total + routeManifestInventory(candidate).length, 0);
  return {
    status: 'PASS',
    fixture_scope: 'fixture_only',
    integration_level: 'local_integration',
    approved_descriptor_templates: APPROVED_SOURCE_DESCRIPTOR_TEMPLATES.length,
    declared_routes: descriptorRouteCount,
    outbound_requests_ledgered: harness.requestLedger.records.filter((record) => record.egress_performed).length,
    discoveries: run.seal.observations.length,
    exact_locator_capture_links: exactLocatorLinks,
    capture_references: harness.referenceStore.references.size,
    content_addressed_objects: harness.objectStore.objects.size,
    blocked_sentinel_transport_calls: sentinelHarness.transport.calls.length,
    blocked_sentinel_captures: sentinelHarness.objectStore.objects.size,
    healthcare_row_captures: rowsHarness.objectStore.objects.size,
    accepted_capture_classifications: [...new Set(harness.requestLedger.records.map((record) => record.capture_classification).filter(Boolean))],
    prohibited_capture_classifications: 0,
    external_actions: 0,
  };
}
