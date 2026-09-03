import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BoundedHttpClient, DcatDataJsonConnector, HtmlReleaseInventoryConnector,
  MemoryOriginGovernor, R2CaptureProtocol, SocrataCatalogConnector, classifyIpAddress, compileManifestRequest, matchManifestRedirect, redactedLocator, resolveManifestRedirectLocation, routeManifestInventory,
  SECRET_QUERY_DENYLIST_ACTIVE, SOURCE_METADATA_ROUTE_ALLOWLIST, assertPositiveMetadataRouteAllowlist,
  assertPinnedTransportRequest, createPinnedStreamingTransport, readLimitedBody, validateDescriptor,
} from '../src/index.mjs';
import { DEFAULT_RESPONSE_LIMITS } from '../src/route-manifest.mjs';
import {
  FixtureDnsResolver, FixtureTransport, MemoryRunRepository, jsonResponse, makeFixtureDescriptor, makeHarness,
} from '../src/testing/index.mjs';
import { asBytes } from '../src/canonical.mjs';
import { MemoryCaptureReferenceStore, MemoryObjectStore } from '../src/testing/memory-ports.mjs';

const REQUEST = {
  endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog', purpose: 'catalog_metadata',
  method: 'GET', targetClass: 'collection', pathParameters: {}, query: {},
};
const DOC_REQUEST = {
  endpointId: 'endpoint_fixture_docs', templateId: 'route_fixture_docs', purpose: 'documentation',
  method: 'GET', targetClass: 'documentation', pathParameters: { slug: 'plain-row' }, query: {},
};
const SCHEMA_REQUEST = {
  endpointId: 'endpoint_fixture_schema', templateId: 'route_fixture_schema', purpose: 'schema',
  method: 'GET', targetClass: 'exact_item', pathParameters: { id: 'short-csv' }, query: {},
};

test('IP policy rejects private, loopback, link-local, metadata, multicast, reserved, and mapped ranges', () => {
  const blocked = [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.168.1.1', '192.0.2.1', '198.51.100.1', '203.0.113.1',
    '224.0.0.1', '255.255.255.255', '::', '::1', '::ffff:127.0.0.1', 'fc00::1',
    'fe80::1', 'ff02::1', '2001:db8::1', '2001:2::1', '2002:7f00:1::1', '3fff::1',
  ];
  for (const address of blocked) assert.equal(classifyIpAddress(address).allowed, false, address);
  assert.equal(classifyIpAddress('93.184.216.34').allowed, true);
  assert.equal(classifyIpAddress('2606:4700:4700::1111').allowed, true);
});

test('payload and query sentinels are blocked before transport egress', async () => {
  const descriptor = makeFixtureDescriptor();
  const harness = makeHarness({ descriptor });
  const blocked = await harness.client.execute({
    descriptor, runId: 'run_sentinel_001', jobId: 'job_sentinel_001',
    request: {
      endpointId: 'endpoint_fixture_item', templateId: 'route_fixture_item', purpose: 'catalog_metadata',
      method: 'GET', targetClass: 'exact_item', pathParameters: { id: 'USHSONOEGRESS_SOURCE_DATA_PAYLOAD' }, query: {},
    },
    responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
  });
  assert.equal(blocked.blockedBeforeEgress, true);
  assert.equal(blocked.failure.failure_type, 'policy_blocked');
  assert.equal(harness.transport.calls.length, 0);
  assert.equal(harness.requestLedger.records[0].outcome, 'blocked_before_egress');
  const queryBlocked = await harness.client.execute({
    descriptor, runId: 'run_sentinel_002', jobId: 'job_sentinel_002',
    request: { ...REQUEST, query: { cursor: 'execute_query_payload_sentinel' } },
    responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
  });
  assert.equal(queryBlocked.blockedBeforeEgress, true);
  assert.equal(harness.transport.calls.length, 0);
});

test('paused sources and unprofiled response media are blocked at the egress boundary', async () => {
  const pausedDescriptor = makeFixtureDescriptor({ sourceState: 'paused' });
  const paused = makeHarness({ descriptor: pausedDescriptor });
  paused.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: [] }));
  const pausedResult = await paused.client.execute({
    descriptor: pausedDescriptor, runId: 'run_paused_egress', jobId: 'job_paused_egress', request: REQUEST,
  });
  assert.equal(pausedResult.blockedBeforeEgress, true);
  assert.equal(pausedResult.failure.safe_detail_code, 'SOURCE_NOT_ACTIVE');
  assert.equal(paused.transport.calls.length, 0);
  assert.equal(paused.requestLedger.records[0].egress_performed, false);

  for (const [runId, contentType, body, request, expectedCode] of [
    ['run_vendor_media', 'application/vnd.unreviewed', '{}', REQUEST, 'UNEXPECTED_CONTENT_TYPE'],
    ['run_unprofiled_json', 'application/json', '{}', REQUEST, 'JSON_ADAPTER_PROFILE_REQUIRED'],
    ['run_unprofiled_html', 'text/html', '<html><body>unreviewed</body></html>', DOC_REQUEST, 'HTML_ADAPTER_PROFILE_REQUIRED'],
    ['run_unprofiled_csv', 'text/csv', 'header', SCHEMA_REQUEST, 'CSV_ADAPTER_PROFILE_REQUIRED'],
    ['run_unprofiled_text', 'text/plain', 'unreviewed', DOC_REQUEST, 'PLAIN_TEXT_ADAPTER_PROFILE_REQUIRED'],
    ['run_unprofiled_xml', 'application/xml', '<root>unreviewed</root>', DOC_REQUEST, 'XML_ADAPTER_PROFILE_REQUIRED'],
  ]) {
    const harness = makeHarness();
    const url = request === REQUEST ? 'https://catalog.example.gov/data.json'
      : request === DOC_REQUEST ? 'https://catalog.example.gov/docs/plain-row' : 'https://catalog.example.gov/schemas/short-csv';
    harness.transport.add('GET', url, jsonResponse({}, { bodyBytes: body, contentType }));
    const result = await harness.client.execute({
      descriptor: harness.descriptor, runId, jobId: `${runId}_job`, request,
    });
    assert.equal(result.failure.safe_detail_code, expectedCode, contentType);
    assert.equal(harness.objectStore.objects.size, 0);
  }
});

test('compressed, decompressed, duration, and page bounds fail closed', async () => {
  const decompressedDescriptor = makeFixtureDescriptor({ maximumResponseBytes: 100, maximumDecompressedBytes: 20 });
  const decompressed = makeHarness({ descriptor: decompressedDescriptor });
  decompressed.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({}, {
    wireBytes: '{}', bodyBytes: JSON.stringify({ dataset: [], padding: 'x'.repeat(30) }), contentLength: 2,
  }));
  const decompressedResult = await decompressed.client.execute({
    descriptor: decompressedDescriptor, runId: 'run_decompress_bound', jobId: 'job_decompress_bound',
    request: REQUEST,
    responseProfile: new DcatDataJsonConnector({ descriptor: decompressedDescriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
  });
  assert.equal(decompressedResult.failure.safe_detail_code, 'RESPONSE_SIZE_BOUND_EXCEEDED');
  assert.equal(decompressed.objectStore.objects.size, 0);

  let milliseconds = 0;
  const base = Date.parse('2026-08-30T00:00:00.000Z');
  const durationClock = () => new Date(base + milliseconds);
  const transport = new FixtureTransport();
  transport.send = async function send(request) {
    this.calls.push(request);
    milliseconds += 301_000;
    return jsonResponse({ dataset: [] }, { connectedAddress: request.approvedAddresses[0] });
  };
  const durationDescriptor = makeFixtureDescriptor();
  const duration = makeHarness({ descriptor: durationDescriptor, transport, clock: durationClock });
  const durationResult = await duration.client.execute({
    descriptor: durationDescriptor, runId: 'run_duration_bound', jobId: 'job_duration_bound',
    request: REQUEST,
    responseProfile: new DcatDataJsonConnector({ descriptor: durationDescriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
  });
  assert.equal(durationResult.failure.safe_detail_code, 'REQUEST_DURATION_BOUND_EXCEEDED');
  assert.equal(duration.objectStore.objects.size, 0);

  const pageDescriptor = makeFixtureDescriptor({ maximumPages: 1 });
  const page = makeHarness({ descriptor: pageDescriptor });
  page.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: [{ identifier: 'one', title: 'One' }], next_cursor: 'next' }));
  const pageResult = await page.runner.run({
    connector: new DcatDataJsonConnector({ descriptor: pageDescriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }),
    runId: 'run_page_bound', scheduledSlot: '2026-08-30T00:00:00.000Z', mode: 'full_membership',
  });
  assert.equal(pageResult.failure.safe_detail_code, 'MAXIMUM_PAGES_EXCEEDED');
  assert.equal(pageResult.checkpointCommitted, false);
});

test('nested row containers, plain-text challenges, and length mismatches quarantine before capture', async () => {
  const descriptor = makeFixtureDescriptor({ connectorName: 'socrata-catalog' });
  const socrata = new SocrataCatalogConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' });
  const nested = makeHarness({ descriptor });
  nested.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse([{ id: 'abcd-1234', name: 'metadata wrapper', rows: [{ id: 'row-1', value: 12 }], samples: [{ id: 'sample-1', value: 12 }] }]));
  const nestedResult = await nested.client.execute({ descriptor, runId: 'run_nested_rows', jobId: 'job_nested_rows', request: REQUEST, responseProfile: socrata.responseProfile() });
  assert.equal(nestedResult.failure.safe_detail_code, 'ROW_SHAPED_RESPONSE_QUARANTINED');
  assert.equal(nested.objectStore.objects.size, 0);

  const nestedRowObject = makeHarness({ descriptor });
  nestedRowObject.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse([{ id: 'abcd-1234', name: 'metadata wrapper', details: { record_id: 'row-2', value: 12 } }]));
  const nestedRowObjectResult = await nestedRowObject.client.execute({ descriptor, runId: 'run_nested_row_object', jobId: 'job_nested_row_object', request: REQUEST, responseProfile: socrata.responseProfile() });
  assert.equal(nestedRowObjectResult.failure.safe_detail_code, 'ROW_SHAPED_RESPONSE_QUARANTINED');
  assert.equal(nestedRowObject.objectStore.objects.size, 0);

  const plainRows = makeHarness({ descriptor });
  plainRows.transport.add('GET', 'https://catalog.example.gov/docs/plain-row', jsonResponse({}, {
    bodyBytes: 'id,name\nrow-1,untrusted', contentType: 'text/plain',
  }));
  const plainRowsResult = await plainRows.client.execute({
    descriptor, runId: 'run_plain_rows', jobId: 'job_plain_rows', request: DOC_REQUEST,
    responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
  });
  assert.equal(plainRowsResult.failure.safe_detail_code, 'TEXT_ROW_PAYLOAD_QUARANTINED');
  assert.equal(plainRows.objectStore.objects.size, 0);

  const shortCsv = makeHarness({ descriptor });
  shortCsv.transport.add('GET', 'https://catalog.example.gov/schemas/short-csv', jsonResponse({}, {
    bodyBytes: 'id,name\nrow-1,untrusted', contentType: 'text/csv',
  }));
  const shortCsvResult = await shortCsv.client.execute({
    descriptor, runId: 'run_short_csv', jobId: 'job_short_csv', request: SCHEMA_REQUEST,
    responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
  });
  assert.equal(shortCsvResult.failure.safe_detail_code, 'CSV_ROW_PAYLOAD_QUARANTINED');
  assert.equal(shortCsv.objectStore.objects.size, 0);

  const challenge = makeHarness({ descriptor });
  challenge.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({}, { bodyBytes: 'Verify you are human: CAPTCHA', contentType: 'text/plain' }));
  const challengeResult = await challenge.client.execute({ descriptor, runId: 'run_plain_challenge', jobId: 'job_plain_challenge', request: REQUEST, responseProfile: socrata.responseProfile() });
  assert.equal(challengeResult.failure.safe_detail_code, 'LOGIN_FORM_OR_CHALLENGE_QUARANTINED');
  assert.equal(challenge.objectStore.objects.size, 0);

  const mismatch = makeHarness({ descriptor });
  mismatch.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse([], { contentLength: 999 }));
  const mismatchResult = await mismatch.client.execute({ descriptor, runId: 'run_length_mismatch', jobId: 'job_length_mismatch', request: REQUEST, responseProfile: socrata.responseProfile() });
  assert.equal(mismatchResult.failure.safe_detail_code, 'CONTENT_LENGTH_MISMATCH');
  assert.equal(mismatch.objectStore.objects.size, 0);

  const signed = makeHarness({ descriptor });
  signed.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse([{ id: 'abcd-1234', name: 'signed metadata', landingPage: 'https://files.example.gov/object?X-Amz-Signature=SECRET' }]));
  const signedResult = await signed.client.execute({ descriptor, runId: 'run_signed_locator', jobId: 'job_signed_locator', request: REQUEST, responseProfile: socrata.responseProfile() });
  assert.equal(signedResult.failure.safe_detail_code, 'SECRET_OR_SIGNED_LOCATOR_QUARANTINED');
  assert.equal(signed.objectStore.objects.size, 0);

  const privateLocator = makeHarness({ descriptor });
  privateLocator.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse([{ id: 'abcd-1234', name: 'private locator', landingPage: 'http://169.254.169.254/latest/meta-data' }]));
  const privateLocatorResult = await privateLocator.client.execute({ descriptor, runId: 'run_private_locator', jobId: 'job_private_locator', request: REQUEST, responseProfile: socrata.responseProfile() });
  assert.equal(privateLocatorResult.failure.safe_detail_code, 'PRIVATE_LOCATOR_QUARANTINED');
  assert.equal(privateLocator.objectStore.objects.size, 0);

  const invalidLength = makeHarness({ descriptor });
  invalidLength.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse([], { headers: { 'content-length': '2, 2' } }));
  const invalidLengthResult = await invalidLength.client.execute({ descriptor, runId: 'run_invalid_length', jobId: 'job_invalid_length', request: REQUEST, responseProfile: socrata.responseProfile() });
  assert.equal(invalidLengthResult.failure.safe_detail_code, 'CONTENT_LENGTH_INVALID');
  assert.equal(invalidLength.objectStore.objects.size, 0);

  const unsupportedEncoding = makeHarness({ descriptor });
  unsupportedEncoding.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse([], { headers: { 'content-encoding': 'compress' } }));
  const unsupportedEncodingResult = await unsupportedEncoding.client.execute({ descriptor, runId: 'run_unsupported_encoding', jobId: 'job_unsupported_encoding', request: REQUEST, responseProfile: socrata.responseProfile() });
  assert.equal(unsupportedEncodingResult.failure.safe_detail_code, 'CONTENT_ENCODING_UNSUPPORTED');
  assert.equal(unsupportedEncoding.objectStore.objects.size, 0);
});

test('response structure and cardinality limits fail before capture or page persistence', async () => {
  const descriptor = makeFixtureDescriptor({ maximumResponseBytes: 1_000_000, maximumDecompressedBytes: 1_000_000 });
  const dcat = new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' });

  let deep = { value: 'bounded' };
  for (let index = 0; index <= DEFAULT_RESPONSE_LIMITS.maximum_response_depth; index += 1) deep = { nested: deep };
  const deepHarness = makeHarness({ descriptor });
  deepHarness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse([{ identifier: 'deep-1', title: 'Deep metadata', nested: deep }]));
  const deepResult = await deepHarness.client.execute({
    descriptor, runId: 'run_response_depth', jobId: 'job_response_depth', request: REQUEST, responseProfile: dcat.responseProfile(),
  });
  assert.equal(deepResult.failure.safe_detail_code, 'RESPONSE_STRUCTURE_LIMIT_EXCEEDED');
  assert.equal(deepHarness.objectStore.objects.size, 0);

  const nodeValue = { identifier: 'node-1', title: 'Node metadata' };
  for (let index = 0; index <= DEFAULT_RESPONSE_LIMITS.maximum_response_nodes; index += 1) nodeValue[`field_${index}`] = index;
  const nodeHarness = makeHarness({ descriptor });
  nodeHarness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse([nodeValue]));
  const nodeResult = await nodeHarness.client.execute({
    descriptor, runId: 'run_response_nodes', jobId: 'job_response_nodes', request: REQUEST, responseProfile: dcat.responseProfile(),
  });
  assert.equal(nodeResult.failure.safe_detail_code, 'RESPONSE_STRUCTURE_LIMIT_EXCEEDED');
  assert.equal(nodeHarness.objectStore.objects.size, 0);

  const records = Array.from({ length: DEFAULT_RESPONSE_LIMITS.maximum_records + 1 }, (_, index) => ({ identifier: `record-${index}`, title: 'Metadata record' }));
  const recordHarness = makeHarness({ descriptor });
  recordHarness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: records }));
  const recordResult = await recordHarness.client.execute({
    descriptor, runId: 'run_record_cardinality', jobId: 'job_record_cardinality', request: REQUEST, responseProfile: dcat.responseProfile(),
  });
  assert.equal(recordResult.failure.safe_detail_code, 'RECORD_CARDINALITY_EXCEEDED');
  assert.equal(recordHarness.objectStore.objects.size, 0);
});

test('HTML links and runner observations are bounded before mapping and persistence', async () => {
  const descriptor = makeFixtureDescriptor({ connectorName: 'html-release-inventory', maximumResponseBytes: 1_000_000, maximumDecompressedBytes: 1_000_000 });
  const connector = new HtmlReleaseInventoryConnector({ descriptor, endpointId: 'endpoint_fixture_html_inventory', templateId: 'route_fixture_html_inventory' });
  const html = Array.from({ length: DEFAULT_RESPONSE_LIMITS.maximum_links + 1 }, (_, index) => `<a data-release-id="release-${index}" href="/releases/${index}">Release ${index}</a>`).join('');
  const linksHarness = makeHarness({ descriptor });
  linksHarness.transport.add('GET', 'https://catalog.example.gov/inventory', jsonResponse({}, { bodyBytes: `<html><body>${html}</body></html>`, contentType: 'text/html' }));
  const linksResult = await linksHarness.client.execute({
    descriptor, runId: 'run_link_cardinality', jobId: 'job_link_cardinality',
    request: { endpointId: 'endpoint_fixture_html_inventory', templateId: 'route_fixture_html_inventory', purpose: 'documentation', method: 'GET', targetClass: 'collection', pathParameters: {}, query: {} },
    responseProfile: connector.responseProfile(),
  });
  assert.equal(linksResult.failure.safe_detail_code, 'LINK_CARDINALITY_EXCEEDED');
  assert.equal(linksHarness.objectStore.objects.size, 0);

  class OverProducingConnector extends DcatDataJsonConnector {
    parsePage({ capture }) {
      return {
        observations: Array.from({ length: DEFAULT_RESPONSE_LIMITS.maximum_observations + 1 }, (_, index) => this.nativeObservation({ identifier: `observation-${index}`, title: 'Metadata' }, index, capture)),
        nextRequest: null,
        cursor: null,
      };
    }
  }
  const observationDescriptor = makeFixtureDescriptor();
  const observationConnector = new OverProducingConnector({ descriptor: observationDescriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' });
  const observationHarness = makeHarness({ descriptor: observationDescriptor });
  observationHarness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: [{ identifier: 'one', title: 'One' }] }));
  const observationResult = await observationHarness.runner.run({
    connector: observationConnector, runId: 'run_observation_cardinality', scheduledSlot: '2026-08-30T00:00:00.000Z', mode: 'full_membership',
  });
  assert.equal(observationResult.failure.safe_detail_code, 'OBSERVATION_CARDINALITY_EXCEEDED');
  assert.equal(observationHarness.runRepository.runs.get('run_observation_cardinality').pages.size, 0);
});

test('classification exceptions release the origin lease and quarantine without capture', async () => {
  const descriptor = makeFixtureDescriptor();
  const harness = makeHarness({ descriptor });
  harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse([]));
  const result = await harness.client.execute({
    descriptor, runId: 'run_classifier_exception', jobId: 'job_classifier_exception', request: REQUEST,
    responseProfile: { metadataCollectionPaths: [''], validateJson() { throw new Error('validator failure'); } },
  });
  assert.equal(result.failure.safe_detail_code, 'RESPONSE_CLASSIFICATION_FAILED');
  assert.equal(harness.objectStore.objects.size, 0);
  assert.equal(harness.governor.snapshot('https://catalog.example.gov', descriptor.origin_policy).inFlight, 0);
});

test('unmanifested hosts, routes, methods, parameters, and secret query names fail closed', () => {
  const descriptor = makeFixtureDescriptor();
  assert.throws(() => compileManifestRequest(descriptor, { ...REQUEST, templateId: 'route_missing' }));
  assert.throws(() => compileManifestRequest(descriptor, { ...REQUEST, method: 'POST' }));
  assert.throws(() => compileManifestRequest(descriptor, { ...REQUEST, query: { q: 'anything' } }));
  assert.throws(() => compileManifestRequest(descriptor, { ...REQUEST, targetClass: 'exact_item' }));
  assert.throws(() => compileManifestRequest(descriptor, { ...REQUEST, body: 'not allowed' }));
  assert.throws(() => compileManifestRequest(descriptor, { ...REQUEST, query: { cursor: 'https://files.example.gov/o?X-Amz-Signature=secret' } }));
  assert.throws(() => compileManifestRequest({ ...descriptor, bounds: { ...descriptor.bounds, maximum_redirects: 6 } }, REQUEST));
  assert.throws(() => compileManifestRequest({ ...descriptor, legal_review: { ...descriptor.legal_review, api_key: 'must-not-persist' } }, REQUEST));
  const { source_id: _omittedSourceId, ...missingRequired } = descriptor;
  assert.throws(() => compileManifestRequest(missingRequired, REQUEST));
  assert.throws(() => compileManifestRequest({
    ...descriptor,
    endpoints: descriptor.endpoints.map((endpoint, index) => index === 0 ? {
      ...endpoint,
      routes: endpoint.routes.map((route) => ({ ...route, path_template: '/resource/{id}.json', allowed_parameters: ['id'] })),
    } : endpoint),
  }, REQUEST));
  assert.throws(() => compileManifestRequest({
    ...descriptor,
    allowed_hosts: ['127.0.0.1'],
    endpoints: descriptor.endpoints.map((endpoint) => ({ ...endpoint, base_url: 'https://127.0.0.1' })),
  }, REQUEST));
  assert.throws(() => compileManifestRequest({
    ...descriptor,
    endpoints: descriptor.endpoints.map((endpoint, index) => index === 0 ? {
      ...endpoint,
      routes: endpoint.routes.map((route) => route.template_id === REQUEST.templateId ? { ...route, path_template: '//evil.example/data.json' } : route),
    } : endpoint),
  }, REQUEST));
  for (const parameter of ['page[signature]', 'page[password]', 'page[authorization]', 'page[x-amz-signature]']) {
    const unsafeDescriptor = {
      ...descriptor,
      endpoints: descriptor.endpoints.map((endpoint, index) => index === 0 ? {
        ...endpoint,
        routes: endpoint.routes.map((route) => route.template_id === REQUEST.templateId ? { ...route, allowed_parameters: [parameter] } : route),
      } : endpoint),
    };
    assert.throws(() => compileManifestRequest(unsafeDescriptor, { ...REQUEST, query: { [parameter]: 'redacted' } }), parameter);
  }
  assert.equal(redactedLocator('https://catalog.example.gov/data.json?page%5Bsignature%5D=secret').includes('page%5Bsignature%5D'), false);
  const redirectDescriptor = makeFixtureDescriptor({ redirectPolicy: 'same_origin' });
  assert.throws(() => matchManifestRedirect(redirectDescriptor, 'https://catalog.example.gov/docs/%2e%2e/secret', {
    purpose: 'documentation', method: 'GET', targetClass: 'documentation',
  }), /REDIRECT_UNSAFE_PATH_SEGMENT/);
  assert.throws(() => matchManifestRedirect(redirectDescriptor, new URL('https://catalog.example.gov/docs/%2e%2e/secret'), {
    purpose: 'documentation', method: 'GET', targetClass: 'documentation',
  }), /REDIRECT_RAW_LOCATION_REQUIRED/);
  const inventory = routeManifestInventory(descriptor);
  assert.ok(inventory.every((route) => route.forbidden_route_classes.includes('source_data_payload')));
  assert.ok(inventory.every((route) => ['GET', 'HEAD'].includes(route.method)));
});

test('DNS rebinding and connected-address substitution are rejected', async () => {
  const descriptor = makeFixtureDescriptor();
  const transport = new FixtureTransport();
  transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: [] }));
  const resolver = new FixtureDnsResolver({ 'catalog.example.gov': (call) => call === 1 ? ['93.184.216.34'] : ['8.8.8.8'] });
  const harness = makeHarness({ descriptor, transport, resolver });
  const rebound = await harness.client.execute({ descriptor, runId: 'run_dns_rebind', jobId: 'job_dns_rebind', request: REQUEST, responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile() });
  assert.equal(rebound.failure.safe_detail_code, 'DNS_REBINDING_DETECTED');
  assert.equal(harness.objectStore.objects.size, 0);

  const substitutionTransport = new FixtureTransport();
  substitutionTransport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: [] }, { connectedAddress: '8.8.8.8' }));
  const substitution = makeHarness({ descriptor, transport: substitutionTransport });
  const result = await substitution.client.execute({ descriptor, runId: 'run_dns_substitution', jobId: 'job_dns_substitution', request: REQUEST, responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile() });
  assert.equal(result.failure.safe_detail_code, 'CONNECTED_ADDRESS_NOT_DNS_PINNED');
  assert.equal(substitution.objectStore.objects.size, 0);
});

test('credentials are resolved only into an initial-host request and never persisted', async () => {
  const descriptor = makeFixtureDescriptor({ credentialSecretLocator: 'cloudflare-secret://ushso/staging/fixture-key' });
  const harness = makeHarness({ descriptor, credentialProvider: { async headersFor(locator) {
    assert.equal(locator, descriptor.credential_secret_locator);
    return { 'x-api-key': 'fixture-secret-never-persist' };
  } } });
  harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: [] }));
  const result = await harness.client.execute({ descriptor, runId: 'run_secret_001', jobId: 'job_secret_001', request: REQUEST, responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile() });
  assert.equal(result.outcome, 'captured');
  assert.equal(harness.transport.calls[0].headers['x-api-key'], 'fixture-secret-never-persist');
  const persisted = JSON.stringify({ ledger: harness.requestLedger.records, captures: [...harness.referenceStore.references.values()], objects: [...harness.objectStore.objects.values()].map(({ options }) => options) });
  assert.equal(persisted.includes('fixture-secret-never-persist'), false);
  assert.equal(persisted.includes('x-api-key'), false);
});

test('conditional validators and retained response headers cannot persist injected locator material', async () => {
  const descriptor = makeFixtureDescriptor();
  const invalid = makeHarness({ descriptor });
  const blocked = await invalid.client.execute({
    descriptor, runId: 'run_bad_validator', jobId: 'job_bad_validator', request: REQUEST,
    validators: { etag: 'ok\r\nx-api-key: injected' },
    responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
  });
  assert.equal(blocked.blockedBeforeEgress, true);
  assert.equal(blocked.failure.safe_detail_code, 'REQUEST_ETAG_INVALID');
  assert.equal(invalid.transport.calls.length, 0);
  const signedValidator = await invalid.client.execute({
    descriptor, runId: 'run_signed_validator', jobId: 'job_signed_validator', request: REQUEST,
    validators: { etag: 'https://files.example.gov/item?X-Amz-Signature=must-not-send' },
    responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
  });
  assert.equal(signedValidator.blockedBeforeEgress, true);
  assert.equal(signedValidator.failure.safe_detail_code, 'REQUEST_ETAG_INVALID');
  assert.equal(invalid.transport.calls.length, 0);

  const headers = makeHarness({ descriptor });
  headers.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: [] }, {
    etag: 'https://files.example.gov/item?X-Amz-Signature=must-not-persist',
    lastModified: 'not-a-date',
    headers: { 'cache-control': 'public, url="https://files.example.gov/signed"' },
  }));
  const captured = await headers.client.execute({
    descriptor, runId: 'run_header_redaction', jobId: 'job_header_redaction', request: REQUEST,
    responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
  });
  assert.equal(captured.outcome, 'captured');
  assert.equal(captured.capture.safe_response_headers.etag, null);
  assert.equal(captured.capture.safe_response_headers.last_modified, null);
  assert.equal(captured.capture.safe_response_headers.cache_control, null);
  assert.equal(JSON.stringify(captured.capture).includes('must-not-persist'), false);
  assert.equal(JSON.stringify(captured.capture).includes('files.example.gov'), false);
});

test('redirects drop credentials and preserve destination target-class semantics', async () => {
  const descriptor = makeFixtureDescriptor({ credentialSecretLocator: 'cloudflare-secret://ushso/staging/fixture-key' });
  const harness = makeHarness({ descriptor, credentialProvider: { async headersFor() { return { 'x-api-key': 'initial-hop-only' }; } } });
  harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({}, {
    status: 302, bodyBytes: '', contentLength: 0, location: 'https://catalog.example.gov/data.json?cursor=next',
  }));
  harness.transport.add('GET', 'https://catalog.example.gov/data.json?cursor=next', jsonResponse({ dataset: [] }));
  const result = await harness.client.execute({
    descriptor, runId: 'run_redirect_credential', jobId: 'job_redirect_credential',
    request: REQUEST,
    responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
  });
  assert.equal(result.outcome, 'captured');
  assert.equal(harness.transport.calls[0].headers['x-api-key'], 'initial-hop-only');
  assert.equal(harness.transport.calls[1].headers['x-api-key'], undefined);
  assert.equal(harness.requestLedger.records.at(-1).target_class, 'pagination_cursor');
  assert.equal(result.capture.source_locator.final_path_class, 'pagination_cursor');

  const mismatched = makeHarness({ descriptor, credentialProvider: { async headersFor() { return { 'x-api-key': 'initial-hop-only' }; } } });
  mismatched.transport.add('GET', 'https://catalog.example.gov/items/one', jsonResponse({}, {
    status: 302, bodyBytes: '', contentLength: 0, location: 'https://catalog.example.gov/data.json',
  }));
  const blocked = await mismatched.client.execute({
    descriptor, runId: 'run_redirect_target_mismatch', jobId: 'job_redirect_target_mismatch',
    request: {
      endpointId: 'endpoint_fixture_item', templateId: 'route_fixture_item', purpose: 'catalog_metadata',
      method: 'GET', targetClass: 'exact_item', pathParameters: { id: 'one' }, query: {},
    },
    responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
  });
  assert.equal(blocked.failure.safe_detail_code, 'REDIRECT_TARGET_CLASS_MISMATCH');
  assert.equal(mismatched.transport.calls.length, 1);
  assert.equal(mismatched.objectStore.objects.size, 0);
});

test('allowlisted cross-origin redirects receive neither credentials nor conditional validators', async () => {
  const base = makeFixtureDescriptor({
    credentialSecretLocator: 'cloudflare-secret://ushso/staging/fixture-key',
    redirectPolicy: 'allowlisted_hosts',
  });
  const catalogRoute = base.endpoints[0].routes[0];
  const descriptor = {
    ...base,
    allowed_hosts: [...base.allowed_hosts, 'mirror.example.gov'],
    endpoints: [...base.endpoints, {
      endpoint_id: 'endpoint_fixture_mirror', base_url: 'https://mirror.example.gov', target_class: 'collection',
      routes: [{ ...catalogRoute, template_id: 'route_fixture_mirror' }],
    }],
    scopes: base.scopes.map((scope) => ({ ...scope, endpoint_ids: [...scope.endpoint_ids, 'endpoint_fixture_mirror'] })),
  };
  const harness = makeHarness({ descriptor, credentialProvider: { async headersFor() { return { authorization: 'Bearer fixture-initial-only' }; } } });
  harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({}, {
    status: 302, bodyBytes: '', contentLength: 0, location: 'https://mirror.example.gov/data.json',
  }));
  harness.transport.add('GET', 'https://mirror.example.gov/data.json', jsonResponse({ dataset: [] }));
  const result = await harness.client.execute({
    descriptor, runId: 'run_cross_origin_redirect', jobId: 'job_cross_origin_redirect', request: REQUEST,
    validators: { etag: '"fixture-v1"', lastModified: 'Sat, 30 Aug 2026 00:00:00 GMT' },
    responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
  });
  assert.equal(result.outcome, 'captured');
  assert.equal(harness.transport.calls[0].headers.authorization, 'Bearer fixture-initial-only');
  assert.equal(harness.transport.calls[0].headers['if-none-match'], '"fixture-v1"');
  assert.equal(harness.transport.calls[0].headers['if-modified-since'], 'Sat, 30 Aug 2026 00:00:00 GMT');
  for (const name of ['authorization', 'x-api-key', 'if-none-match', 'if-modified-since']) {
    assert.equal(harness.transport.calls[1].headers[name], undefined, name);
  }
  assert.equal(result.capture.source_locator.final_host, 'mirror.example.gov');
  assert.equal(result.capture.source_locator.final_path_class, 'collection');

  const invalid304 = makeHarness({ descriptor, credentialProvider: { async headersFor() { return { authorization: 'Bearer fixture-initial-only' }; } } });
  invalid304.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({}, {
    status: 302, bodyBytes: '', contentLength: 0, location: 'https://mirror.example.gov/data.json',
  }));
  invalid304.transport.add('GET', 'https://mirror.example.gov/data.json', jsonResponse({}, { status: 304, bodyBytes: '', contentLength: 0 }));
  const notModified = await invalid304.client.execute({
    descriptor, runId: 'run_redirect_304', jobId: 'job_redirect_304', request: REQUEST,
    validators: { etag: '"fixture-v1"' }, priorCaptureRefId: 'capture_prior_fixture',
    responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
  });
  assert.equal(notModified.failure.safe_detail_code, 'INVALID_NOT_MODIFIED_RESPONSE');
  assert.equal(notModified.quarantined, true);
});

test('missing security integration ports and required credentials fail before egress', async () => {
  assert.throws(() => new BoundedHttpClient({
    transport: new FixtureTransport(), resolver: new FixtureDnsResolver(),
    captureProtocol: { async capture() {} }, requestLedger: { async append() {} },
  }), /origin governor/);

  const descriptor = makeFixtureDescriptor({ credentialSecretLocator: 'cloudflare-secret://ushso/staging/fixture-key' });
  const harness = makeHarness({ descriptor });
  const result = await harness.client.execute({
    descriptor, runId: 'run_missing_credential_port', jobId: 'job_missing_credential_port',
    request: REQUEST,
    responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
  });
  assert.equal(result.blockedBeforeEgress, true);
  assert.equal(result.failure.failure_type, 'catalog_auth_misconfigured');
  assert.equal(result.failure.safe_detail_code, 'CREDENTIAL_PROVIDER_REQUIRED');
  assert.equal(harness.transport.calls.length, 0);
  assert.equal(harness.requestLedger.records[0].egress_performed, false);
});

test('shared origin governor enforces concurrency, pacing, and circuit state', async () => {
  let now = 0;
  const policy = { maximum_concurrency: 1, requests_per_second: 1, burst: 1 };
  const governor = new MemoryOriginGovernor({ clock: () => now, failureThreshold: 2, openMilliseconds: 1000 });
  const first = await governor.acquire('https://catalog.example.gov', policy, 'collection');
  await assert.rejects(() => governor.acquire('https://catalog.example.gov', policy, 'collection'));
  first.release({ success: false, consumeFailureBudget: true });
  now += 1000;
  const second = await governor.acquire('https://catalog.example.gov', policy, 'collection');
  second.release({ success: false, consumeFailureBudget: true });
  assert.equal(governor.snapshot('https://catalog.example.gov', policy).circuit, 'open');
  now += 1000;
  const probe = await governor.acquire('https://catalog.example.gov', policy, 'collection');
  probe.release({ success: true });
  assert.equal(governor.snapshot('https://catalog.example.gov', policy).circuit, 'closed');
});

test('terminal runs do not fetch again and checkpoint transaction failure is atomic and resumable', async () => {
  const descriptor = makeFixtureDescriptor();
  const connector = new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' });
  const terminal = makeHarness({ descriptor });
  terminal.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({}, { status: 429 }));
  const failed = await terminal.runner.run({ connector, runId: 'run_terminal_immutable', scheduledSlot: '2026-08-30T00:00:00.000Z', mode: 'full_membership' });
  assert.equal(failed.failure.failure_type, 'rate_limited');
  terminal.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: [{ identifier: 'must-not-fetch', title: 'Must not fetch' }] }));
  const repeated = await terminal.runner.run({ connector, runId: 'run_terminal_immutable', scheduledSlot: '2026-08-30T00:00:00.000Z', mode: 'full_membership' });
  assert.equal(repeated.failure.failure_type, 'rate_limited');
  assert.equal(terminal.transport.calls.length, 1);

  const repository = new MemoryRunRepository({ failCheckpointTransaction: true });
  const atomic = makeHarness({ descriptor, runRepository: repository });
  atomic.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: [{
    identifier: 'atomic-one', title: 'Atomic one', modified: '2026-08-01T00:00:00.000Z',
  }] }));
  await assert.rejects(() => atomic.runner.run({ connector, runId: 'run_atomic_checkpoint', scheduledSlot: '2026-08-30T00:00:00.000Z', mode: 'full_membership' }), /transaction failure/);
  assert.equal(repository.checkpoints.size, 0);
  assert.equal(repository.memberships.size, 0);
  repository.failCheckpointTransaction = false;
  const resumed = await atomic.runner.run({ connector, runId: 'run_atomic_checkpoint', scheduledSlot: '2026-08-30T00:00:00.000Z', mode: 'full_membership' });
  assert.equal(resumed.outcome, 'succeeded');
  assert.equal(repository.checkpoints.size, 1);
  assert.equal(repository.memberships.size, 1);
  assert.equal(atomic.transport.calls.length, 1);
});

test('later-clock refetch after capture-reference commit reuses content but preserves observation identity', async () => {
  const descriptor = makeFixtureDescriptor();
  const connector = new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' });
  let now = Date.parse('2026-08-30T00:00:00.000Z');
  let inject = true;
  const harness = makeHarness({
    descriptor,
    clock: () => new Date(now),
    runnerCrashInjector: async (point) => {
      if (inject && point === 'after_fetch_before_page_commit') {
        inject = false;
        throw new Error('injected:after_capture_reference_commit');
      }
    },
  });
  const body = { dataset: [{ identifier: 'durable-one', title: 'Durable one', modified: '2026-08-01T00:00:00.000Z' }] };
  harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse(body));
  await assert.rejects(() => harness.runner.run({
    connector, runId: 'run_capture_observation_identity', scheduledSlot: '2026-08-30T00:00:00.000Z', mode: 'full_membership',
  }), /after_capture_reference_commit/);
  const first = [...harness.referenceStore.references.values()][0];
  assert.ok(first);
  assert.equal(harness.objectStore.objects.size, 1);

  now += 1000;
  harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse(body));
  const resumed = await harness.runner.run({
    connector, runId: 'run_capture_observation_identity', scheduledSlot: '2026-08-30T00:00:00.000Z', mode: 'full_membership',
  });
  const references = [...harness.referenceStore.references.values()];
  const second = references.find((candidate) => candidate.capture_ref_id !== first.capture_ref_id);
  assert.equal(resumed.outcome, 'succeeded');
  assert.equal(references.length, 2);
  assert.ok(second);
  assert.equal(second.r2_key, first.r2_key);
  assert.equal(second.raw_sha256, first.raw_sha256);
  assert.notEqual(second.captured_at, first.captured_at);
  assert.equal(harness.objectStore.objects.size, 1);
  assert.equal(resumed.seal.observations[0].sourceLocator.captureRefId, second.capture_ref_id);
});

test('source descriptors must match the frozen positive metadata-route allowlist', async () => {
  assert.equal(SECRET_QUERY_DENYLIST_ACTIVE, true);
  const { CDC_SOCRATA_DESCRIPTOR } = await import('../src/descriptors.mjs');
  assert.doesNotThrow(() => assertPositiveMetadataRouteAllowlist(CDC_SOCRATA_DESCRIPTOR));
  assert.doesNotThrow(() => validateDescriptor(makeFixtureDescriptor()));
  const mutated = structuredClone(CDC_SOCRATA_DESCRIPTOR);
  mutated.endpoints[0].routes[0].path_template = '/api/views/metadata/v2';
  assert.throws(() => validateDescriptor(mutated), /positive allowlist/);
  const unknown = structuredClone(makeFixtureDescriptor());
  unknown.source_id = 'source_unknown_live';
  unknown.legal_review = { state: 'approved', reviewed_at: '2026-08-30T00:00:00.000Z', reviewer_role: 'connector-owner', terms_locator: 'https://catalog.example.gov/terms' };
  assert.throws(() => validateDescriptor(unknown), /No positive metadata-route allowlist/);
  const spoofedReviewer = structuredClone(CDC_SOCRATA_DESCRIPTOR);
  spoofedReviewer.legal_review = { ...spoofedReviewer.legal_review, state: 'approved', reviewer_role: 'fixture-reviewer' };
  spoofedReviewer.endpoints[0].routes[0].path_template = '/api/views/metadata/v2';
  assert.throws(() => validateDescriptor(spoofedReviewer), /positive allowlist/);
  const spoofedFixture = structuredClone(makeFixtureDescriptor({ sourceId: 'source_fixture_attacker' }));
  spoofedFixture.endpoints[0].routes[0].path_template = '/alternate-metadata';
  assert.throws(() => validateDescriptor(spoofedFixture), /No positive metadata-route allowlist/);
  const spoofedKnownFixtureRoute = structuredClone(makeFixtureDescriptor());
  spoofedKnownFixtureRoute.endpoints[0].routes[0].path_template = '/alternate-metadata';
  assert.throws(() => validateDescriptor(spoofedKnownFixtureRoute), /positive allowlist/);
  // Production-shaped routes must not ride a fixture descriptor via shape-union matching.
  const productionShapedFixture = structuredClone(makeFixtureDescriptor());
  productionShapedFixture.endpoints[0].routes[0].path_template = '/api/views/{id}';
  productionShapedFixture.endpoints[0].routes[0].allowed_parameters = ['id'];
  assert.throws(() => validateDescriptor(productionShapedFixture), /positive allowlist/);
  assert.throws(() => assertPositiveMetadataRouteAllowlist(productionShapedFixture), /positive allowlist/);
  assert.ok(Object.keys(SOURCE_METADATA_ROUTE_ALLOWLIST).length >= 18);
});

test('raw redirect Location path checks reject dot-segment evasion before a second transport call', async () => {
  const descriptor = makeFixtureDescriptor({ redirectPolicy: 'same_origin' });
  assert.throws(
    () => resolveManifestRedirectLocation('/docs/%2e%2e/data.json', 'https://catalog.example.gov/data.json', 'collection'),
    /REDIRECT_UNSAFE_PATH_SEGMENT/,
  );
  assert.throws(
    () => resolveManifestRedirectLocation('https://catalog.example.gov/items/%2e%2e/data.json', 'https://catalog.example.gov/data.json', 'collection'),
    /REDIRECT_UNSAFE_PATH_SEGMENT/,
  );
  assert.throws(
    () => resolveManifestRedirectLocation('/docs/foo%2fbar', 'https://catalog.example.gov/data.json', 'collection'),
    /REDIRECT_ENCODED_PATH_SEPARATOR_BLOCKED/,
  );

  for (const location of ['/docs/%2e%2e/data.json', 'https://catalog.example.gov/docs/%2e%2e/data.json', '/docs/%2e./data.json']) {
    const harness = makeHarness({ descriptor });
    harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({}, {
      status: 302, bodyBytes: '', contentLength: 0, location,
    }));
    // A normalized follow-up would otherwise look manifested; it must never be fetched.
    harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: [{ identifier: 'must-not-fetch', title: 'Must not fetch' }] }));
    const blocked = await harness.client.execute({
      descriptor, runId: `run_redirect_dot_${location.length}`, jobId: `job_redirect_dot_${location.length}`,
      request: REQUEST,
      responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
    });
    assert.equal(blocked.failure.safe_detail_code, 'REDIRECT_UNSAFE_PATH_SEGMENT', location);
    assert.equal(harness.transport.calls.length, 1, location);
    assert.equal(harness.objectStore.objects.size, 0, location);
    assert.equal(harness.requestLedger.records.at(-1).outcome, 'quarantined', location);
  }
});

test('R2 capture rejects incoherent URLs and oversize compressed or decompressed bodies', async () => {
  const descriptor = makeFixtureDescriptor({ maximumResponseBytes: 32, maximumDecompressedBytes: 64 });
  const compiled = compileManifestRequest(descriptor, REQUEST);
  const objectStore = new MemoryObjectStore();
  const referenceStore = new MemoryCaptureReferenceStore();
  const protocol = new R2CaptureProtocol({ objectStore, referenceStore });
  const headers = new Headers({ 'content-type': 'application/json', 'content-length': '2' });
  const observedAt = '2026-08-30T00:00:00.000Z';

  await assert.rejects(
    () => protocol.capture({
      descriptor, runId: 'run_capture_url_mismatch', compiledRequest: compiled,
      finalUrl: 'https://catalog.example.gov/items/other', headers,
      wireBytes: asBytes('{}'), bodyBytes: asBytes('{}'), observedAt,
    }),
    (error) => error.safeDetailCode === 'CAPTURE_FINAL_URL_MISMATCH',
  );
  assert.equal(objectStore.objects.size, 0);

  const foreignCompiled = {
    ...compiled,
    endpoint: { ...compiled.endpoint, endpoint_id: 'endpoint_missing' },
  };
  await assert.rejects(
    () => protocol.capture({
      descriptor, runId: 'run_capture_endpoint_mismatch', compiledRequest: foreignCompiled,
      finalUrl: compiled.url, headers,
      wireBytes: asBytes('{}'), bodyBytes: asBytes('{}'), observedAt,
    }),
    (error) => error.safeDetailCode === 'CAPTURE_REQUEST_DESCRIPTOR_MISMATCH',
  );
  assert.equal(objectStore.objects.size, 0);

  const foreignSourceCompiled = {
    ...compiled,
    descriptor: { ...compiled.descriptor, source_id: 'source_foreign' },
  };
  await assert.rejects(
    () => protocol.capture({
      descriptor, runId: 'run_capture_source_mismatch', compiledRequest: foreignSourceCompiled,
      finalUrl: compiled.url, headers,
      wireBytes: asBytes('{}'), bodyBytes: asBytes('{}'), observedAt,
    }),
    (error) => error.safeDetailCode === 'CAPTURE_REQUEST_DESCRIPTOR_MISMATCH',
  );
  assert.equal(objectStore.objects.size, 0);

  await assert.rejects(
    () => protocol.capture({
      descriptor, runId: 'run_capture_compressed_bound', compiledRequest: compiled,
      finalUrl: compiled.url, headers,
      wireBytes: asBytes('x'.repeat(33)), bodyBytes: asBytes('{}'), observedAt,
    }),
    (error) => error.safeDetailCode === 'CAPTURE_RESPONSE_BOUND_EXCEEDED',
  );
  assert.equal(objectStore.objects.size, 0);

  await assert.rejects(
    () => protocol.capture({
      descriptor, runId: 'run_capture_decompressed_bound', compiledRequest: compiled,
      finalUrl: compiled.url, headers,
      wireBytes: asBytes('{}'), bodyBytes: asBytes('y'.repeat(65)), observedAt,
    }),
    (error) => error.safeDetailCode === 'CAPTURE_RESPONSE_BOUND_EXCEEDED',
  );
  assert.equal(objectStore.objects.size, 0);
  assert.equal(referenceStore.references.size, 0);
});

test('transport requests pin approved addresses before connect and stream response limits', async () => {
  assert.throws(() => assertPinnedTransportRequest({ approvedAddresses: ['93.184.216.34'] }), /TRANSPORT_PIN_REQUIRED/);
  const chunks = [new Uint8Array(8), new Uint8Array(8)];
  async function* oversized() {
    yield chunks[0];
    yield chunks[1];
  }
  await assert.rejects(
    readLimitedBody(oversized(), { maximumBytes: 10, targetClass: 'collection' }),
    (error) => error.safeDetailCode === 'RESPONSE_SIZE_BOUND_EXCEEDED',
  );
  const pinned = createPinnedStreamingTransport(async (request) => {
    assert.equal(request.pinBeforeConnect, true);
    assert.deepEqual(request.approvedAddresses, ['93.184.216.34']);
    return { ok: true };
  });
  const wrapped = await pinned.send({
    url: 'https://catalog.example.gov/data.json',
    method: 'GET',
    headers: new Headers(),
    redirect: 'manual',
    approvedAddresses: ['93.184.216.34'],
    pinBeforeConnect: true,
    maximumCompressedBytes: 1000,
    maximumDecompressedBytes: 2000,
  });
  assert.equal(wrapped.ok, true);

  const descriptor = makeFixtureDescriptor();
  const harness = makeHarness({ descriptor });
  harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({ dataset: [] }));
  const result = await harness.client.execute({
    descriptor, runId: 'run_pin_stream', jobId: 'job_pin_stream', request: REQUEST,
    responseProfile: new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' }).responseProfile(),
  });
  assert.equal(result.outcome, 'captured');
  assert.equal(harness.transport.calls[0].pinBeforeConnect, true);
  assert.deepEqual(harness.transport.calls[0].approvedAddresses, ['93.184.216.34']);
});
