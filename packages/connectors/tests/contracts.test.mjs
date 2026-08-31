import assert from 'node:assert/strict';
import test from 'node:test';
import { validateIngestionRecord as validateIngestionV10 } from '../../../contracts/ingestion/v1.0.0/tools/index.mjs';
import { validateIngestionRecord as validateIngestionV11 } from '../../../contracts/ingestion/v1.1.0/tools/index.mjs';
import {
  APPROVED_SOURCE_DESCRIPTOR_TEMPLATES, DESCRIPTOR_TEMPLATE_ACTIVATION,
  DcatDataJsonConnector, contractValidationTarget, validateDescriptor,
} from '../src/index.mjs';
import { jsonResponse, makeFixtureDescriptor, makeHarness } from '../src/testing/index.mjs';
import { runReconciliationAudit } from '../src/testing/reconciliation-audit.mjs';

test('all approved-source templates are strict ingestion descriptors and disabled pending authorization', async () => {
  assert.equal(APPROVED_SOURCE_DESCRIPTOR_TEMPLATES.length, 18);
  assert.equal(DESCRIPTOR_TEMPLATE_ACTIVATION.lifecycle, 'fixture_only');
  assert.equal(DESCRIPTOR_TEMPLATE_ACTIVATION.activation_authorized, false);
  assert.equal(DESCRIPTOR_TEMPLATE_ACTIVATION.external_authorization_gate, 'AUTH-04');
  for (const descriptor of APPROVED_SOURCE_DESCRIPTOR_TEMPLATES) {
    assert.doesNotThrow(() => validateDescriptor(descriptor));
    assert.deepEqual(contractValidationTarget('source_descriptor', descriptor.contract_version), {
      contract_version: 'ingestion.v1.1.0', package_version: 'v1.1.0', schema_file: 'source-descriptor.schema.json',
    });
    const result = await validateIngestionV11('source-descriptor.schema.json', descriptor);
    assert.deepEqual(result, { valid: true, issues: [] }, descriptor.descriptor_id);
    assert.equal(descriptor.source_state, 'paused');
    assert.equal(descriptor.legal_review.state, 'pending');
    assert.ok(descriptor.endpoints.flatMap((endpoint) => endpoint.routes).every((route) => !['source_data_payload', 'query_execution'].includes(route.purpose)));
  }
});

test('captured fetch and capture reference conform to ingestion contracts', async () => {
  const descriptor = makeFixtureDescriptor();
  const harness = makeHarness({ descriptor });
  const connector = new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' });
  harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: [{ identifier: 'one', title: 'One' }] }, { etag: '"one"', lastModified: 'Sat, 30 Aug 2026 00:00:00 GMT' }));
  const result = await harness.client.execute({
    descriptor, runId: 'run_contract_capture', jobId: 'job_contract_capture',
    request: { endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog', purpose: 'catalog_metadata', method: 'GET', targetClass: 'collection', pathParameters: {}, query: {} },
    responseProfile: connector.responseProfile(),
  });
  assert.equal(result.outcome, 'captured');
  assert.deepEqual(contractValidationTarget('metadata_fetch', result.metadataFetch.contract_version), {
    contract_version: 'ingestion.v1.0.0', package_version: 'v1.0.0', schema_file: 'metadata-fetch.schema.json',
  });
  assert.deepEqual(contractValidationTarget('capture_reference', result.capture.contract_version), {
    contract_version: 'ingestion.v1.0.0', package_version: 'v1.0.0', schema_file: 'capture-reference.schema.json',
  });
  assert.deepEqual(await validateIngestionV10('metadata-fetch.schema.json', result.metadataFetch), { valid: true, issues: [] });
  assert.deepEqual(await validateIngestionV10('capture-reference.schema.json', result.capture), { valid: true, issues: [] });
  assert.throws(() => contractValidationTarget('capture_reference', 'ingestion.v1.1.0'), /Unsupported connector contract pairing/);
});

test('compressed transport accounting retains the exact decoded metadata capture', async () => {
  const descriptor = makeFixtureDescriptor();
  const harness = makeHarness({ descriptor });
  const connector = new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' });
  const decoded = JSON.stringify({ dataset: [{ identifier: 'compressed-one', title: 'Compressed one' }] });
  harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({}, {
    wireBytes: new Uint8Array([0x1f, 0x8b, 0x00, 0x00]), bodyBytes: decoded, contentLength: 4,
    headers: { 'content-encoding': 'gzip' },
  }));
  const result = await harness.client.execute({
    descriptor, runId: 'run_compressed_capture', jobId: 'job_compressed_capture',
    request: { endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog', purpose: 'catalog_metadata', method: 'GET', targetClass: 'collection', pathParameters: {}, query: {} },
    responseProfile: connector.responseProfile(),
  });
  assert.equal(result.outcome, 'captured');
  assert.equal(result.capture.compressed_bytes, 4);
  assert.equal(result.capture.decompressed_bytes, new TextEncoder().encode(decoded).byteLength);
  assert.equal(new TextDecoder().decode(harness.objectStore.objects.get(result.capture.r2_key).bytes), decoded);
  assert.deepEqual(await validateIngestionV10('capture-reference.schema.json', result.capture), { valid: true, issues: [] });
});

test('every discovery reconciles to one exact source locator and confirmed capture', async () => {
  const descriptor = makeFixtureDescriptor();
  const harness = makeHarness({ descriptor });
  const connector = new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' });
  harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: [
    { identifier: 'one', title: 'One', modified: '2026-08-01T00:00:00.000Z' },
    { identifier: 'two', title: 'Two', modified: '2026-08-02T00:00:00.000Z' },
  ] }));
  const run = await harness.runner.run({ connector, runId: 'run_reconcile_001', scheduledSlot: '2026-08-30T00:00:00.000Z', mode: 'full_membership' });
  assert.deepEqual(await validateIngestionV10('checkpoint.schema.json', run.checkpoint), { valid: true, issues: [] });
  const captures = harness.referenceStore.references;
  for (const observation of run.seal.observations) {
    const capture = captures.get(observation.sourceLocator.captureRefId);
    assert.ok(capture);
    assert.equal(capture.r2_key, observation.sourceLocator.r2Key);
    assert.equal(capture.raw_sha256, observation.sourceLocator.rawSha256);
    assert.equal(capture.source_locator.redacted_locator, observation.sourceLocator.redactedLocator);
    assert.ok(observation.sourceLocator.nativePointer.startsWith('/dataset/'));
  }
  assert.equal(run.seal.observations.length, 2);
  assert.equal(captures.size, 1);
  assert.equal(harness.objectStore.objects.size, 1);
  assert.ok(harness.requestLedger.records.every((record) => !['source_data_payload', 'healthcare_rows'].includes(record.capture_classification)));
});

test('request/capture reconciliation audit proves zero prohibited capture', async () => {
  const audit = await runReconciliationAudit();
  assert.equal(audit.status, 'PASS');
  assert.equal(audit.discoveries, audit.exact_locator_capture_links);
  assert.equal(audit.blocked_sentinel_transport_calls, 0);
  assert.equal(audit.healthcare_row_captures, 0);
  assert.equal(audit.prohibited_capture_classifications, 0);
});
