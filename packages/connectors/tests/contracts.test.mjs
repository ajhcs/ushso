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
import { R2CaptureProtocol } from '../src/capture-protocol.mjs';
import { compileManifestRequest, redactedLocator } from '../src/route-manifest.mjs';
import { connectorRequestKey } from '../src/runner.mjs';
const validateIngestionRecord = validateIngestionV10;
const OBS = '2026-09-12T12:00:00.000Z';
const BASE = 'https://catalog.example.gov/data.json';
const descriptor = validateDescriptor(
  makeFixtureDescriptor({
    maximumPages: 2,
    maximumResponseBytes: 4096,
    maximumDecompressedBytes: 4096,
    maximumRedirects: 0,
    redirectPolicy: 'deny'
  })
);
const request = (query = {}) => ({
  endpointId: 'endpoint_fixture_catalog',
  templateId: 'route_fixture_catalog',
  purpose: 'catalog_metadata',
  method: 'GET',
  targetClass: 'collection',
  pathParameters: {},
  query
});
function harness({ strict = true, clock = () => new Date(OBS) } = {}) {
  const h = makeHarness({ descriptor, clock });
  h.validationResults = [];
  h.fetches = [];
  const originalCommit = h.referenceStore.commit.bind(h.referenceStore);
  h.referenceStore.commit = async (reference) => {
    const result = await validateIngestionRecord('capture-reference.schema.json', reference);
    h.validationResults.push({ reference: structuredClone(reference), validation: result });
    if (strict && !result.valid)
      throw Object.assign(new Error('STRICT_CAPTURE_REFERENCE_REJECTED'), {
        code: 'STRICT_CAPTURE_REFERENCE_REJECTED'
      });
    return originalCommit(reference);
  };
  h.captureProtocol = new R2CaptureProtocol({
    objectStore: h.objectStore,
    referenceStore: h.referenceStore,
    clock
  });
  h.client.captureProtocol = h.captureProtocol;
  const execute = h.client.execute.bind(h.client);
  h.client.execute = async (context) => {
    const result = await execute(context);
    h.fetches.push(structuredClone(result));
    if (result.metadataFetch)
      assert.deepEqual(
        await validateIngestionRecord('metadata-fetch.schema.json', result.metadataFetch),
        { valid: true, issues: [] }
      );
    return result;
  };
  h.connector = new DcatDataJsonConnector({
    descriptor,
    endpointId: 'endpoint_fixture_catalog',
    templateId: 'route_fixture_catalog'
  });
  return h;
}
function twoPages(h) {
  h.transport.add(
    'GET',
    BASE,
    jsonResponse(
      {
        dataset: [
          { identifier: 'fixture-a', title: 'Fixture A', modified: '2026-09-10T00:00:00.000Z' }
        ],
        next_cursor: 'page-2'
      },
      { etag: '"fixture-page-1"' }
    )
  );
  h.transport.add(
    'GET',
    BASE + '?cursor=page-2',
    jsonResponse(
      {
        dataset: [
          { identifier: 'fixture-b', title: 'Fixture B', modified: '2026-09-11T00:00:00.000Z' }
        ]
      },
      { etag: '"fixture-page-2"' }
    )
  );
}
async function execute(h, q = {}, runId = 'run_locator_capture', jobId = 'job_locator_capture') {
  return h.client.execute({
    descriptor,
    runId,
    jobId,
    request: request(q),
    responseProfile: h.connector.responseProfile()
  });
}
async function oneCapture(q = {}) {
  const h = harness();
  const url = compileManifestRequest(descriptor, request(q)).url.href;
  h.transport.add('GET', url, jsonResponse({ dataset: [{ identifier: 'same', title: 'Same' }] }));
  const result = await execute(h, q);
  assert.equal(result.outcome, 'captured');
  return { h, result };
}

test('strict reference store rejects the historical query-bearing reference before commit', async () => {
  const h = harness();
  twoPages(h);
  const first = await execute(h);
  const tampered = structuredClone(first.capture);
  tampered.source_locator.redacted_locator = BASE + '?cursor=page-2';
  const before = h.referenceStore.commitCalls.length;
  await assert.rejects(h.referenceStore.commit(tampered), {
    code: 'STRICT_CAPTURE_REFERENCE_REJECTED'
  });
  assert.equal(h.referenceStore.commitCalls.length, before);
  assert.equal(h.referenceStore.references.size, 1);
});

test('public capture locator completes the real two-page runner with strict capture and checkpoint records', async () => {
  const h = harness();
  twoPages(h);
  const run = await h.runner.run({
    connector: h.connector,
    runId: 'run_prototype_two_page',
    scheduledSlot: OBS,
    mode: 'full_membership'
  });
  assert.equal(run.outcome, 'succeeded');
  assert.equal(run.checkpointCommitted, true);
  assert.equal(run.seal.pagesCommitted, 2);
  assert.deepEqual(
    run.seal.observations.map((x) => x.nativeId),
    ['fixture-a', 'fixture-b']
  );
  assert.deepEqual(await validateIngestionRecord('checkpoint.schema.json', run.checkpoint), {
    valid: true,
    issues: []
  });
  assert.equal(h.referenceStore.references.size, 2);
  assert.ok(h.validationResults.every((x) => x.validation.valid));
  assert.deepEqual(
    [...h.referenceStore.references.values()].map((x) => x.source_locator.redacted_locator),
    [BASE, BASE]
  );
  assert.deepEqual(
    h.requestLedger.records.map((x) => x.redacted_locator),
    [BASE, BASE + '?cursor=page-2']
  );
});

test('same body and clocks retain baseline query-sensitive capture and request identities', async () => {
  const h = harness(),
    values = ['page-2', 'page-3'],
    captures = [];
  for (const cursor of values) {
    h.transport.add(
      'GET',
      BASE + '?cursor=' + cursor,
      jsonResponse({ dataset: [{ identifier: 'same', title: 'Same' }] })
    );
    captures.push(
      (await execute(h, { cursor }, 'run_identity_equal', 'job_identity_equal')).capture
    );
  }
  assert.equal(captures[0].raw_sha256, captures[1].raw_sha256);
  assert.deepEqual(captures[0].clocks, captures[1].clocks);
  // Exact values observed from the accepted pre-amendment implementation.
  assert.deepEqual(
    captures.map((x) => x.capture_ref_id),
    ['capture_09f6988222e703a5bed883b58fdf9442', 'capture_8d9cd9b349185899d2656bcaa03deeb7']
  );
  assert.deepEqual(
    h.requestLedger.records.map((x) => x.request_id),
    ['request_7d27d70fec3410ae146c076c4d623743', 'request_59a2524f2dc8cf60541cf6ba40da73ee']
  );
  assert.equal(h.objectStore.objects.size, 1);
  assert.equal(h.referenceStore.references.size, 2);
  assert.notEqual(
    connectorRequestKey(request({ cursor: 'page-2' })),
    connectorRequestKey(request({ cursor: 'page-3' }))
  );
  assert.equal(redactedLocator(BASE + '?cursor=page-2'), BASE + '?cursor=page-2');
});

test('wrong final query remains rejected before object or reference writes', async () => {
  {
    const h = harness();
    const compiled = compileManifestRequest(descriptor, request({ cursor: 'page-2' }));
    await assert.rejects(
      h.captureProtocol.capture({
        descriptor,
        runId: 'run_wrong_final',
        compiledRequest: compiled,
        finalUrl: BASE + '?cursor=page-3',
        headers: new Headers({ 'content-type': 'application/json' }),
        bodyBytes: new TextEncoder().encode('{}'),
        observedAt: OBS
      }),
      (error) => error.safeDetailCode === 'CAPTURE_FINAL_URL_MISMATCH'
    );
    assert.equal(h.objectStore.putCalls.length, 0);
    assert.equal(h.referenceStore.commitCalls.length, 0);
  }
});

test('no-query capture retains its baseline observation identity and locator', async () => {
  const { h, result } = await oneCapture();
  assert.equal(result.capture.capture_ref_id, 'capture_f212d1fe1ec41e0da1584552d26d2d19');
  assert.equal(result.capture.source_locator.redacted_locator, BASE);
  assert.equal(h.requestLedger.records[0].redacted_locator, BASE);
  assert.deepEqual(await validateIngestionRecord('capture-reference.schema.json', result.capture), {
    valid: true,
    issues: []
  });
});

test('public projection contains no userinfo, query or fragment without changing query-sensitive identity', async () => {
  const h = harness();
  const compiled = compileManifestRequest(descriptor, request({ cursor: 'page-2' }));
  const reference = await h.captureProtocol.capture({
    descriptor,
    runId: 'run_public_projection',
    compiledRequest: compiled,
    finalUrl:
      'https://fixture-user:fixture-value@catalog.example.gov/data.json?cursor=page-2#fixture-fragment',
    headers: new Headers({ 'content-type': 'application/json' }),
    bodyBytes: new TextEncoder().encode('{}'),
    observedAt: OBS
  });
  assert.equal(reference.source_locator.redacted_locator, BASE);
  assert.deepEqual(await validateIngestionRecord('capture-reference.schema.json', reference), {
    valid: true,
    issues: []
  });
});

test('released strict validator still rejects a tampered query-bearing public reference', async () => {
  const { result } = await oneCapture();
  const tampered = structuredClone(result.capture);
  tampered.source_locator.redacted_locator = BASE + '?cursor=page-2';
  const check = await validateIngestionRecord('capture-reference.schema.json', tampered);
  assert.equal(check.valid, false);
  assert.ok(check.issues.some((x) => x.code === 'CAPTURE_LOCATOR_SECRET_RISK'));
});

test('two-page 304 reuse still uses full request keys and original capture references', async () => {
  const h = harness();
  twoPages(h);
  const firstId = 'run_before_304';
  const nextId = 'run_after_304';
  const first = await h.runner.run({
    connector: h.connector,
    runId: firstId,
    scheduledSlot: OBS,
    mode: 'full_membership'
  });
  assert.equal(first.outcome, 'succeeded');
  const refsBefore = structuredClone([...h.referenceStore.references.values()]);
  const pages = [...h.runRepository.runs.get(firstId).pages.values()];
  for (const page of pages) {
    assert.equal(page.pageKey, connectorRequestKey(page.request));
    const ref = h.referenceStore.references.get(page.captureRefId);
    h.runRepository.setConditional(nextId, page.pageKey, {
      validators: { etag: ref.safe_response_headers.etag },
      priorCaptureRefId: ref.capture_ref_id
    });
    h.transport.add(
      'GET',
      compileManifestRequest(descriptor, page.request).url.href,
      jsonResponse(null, { status: 304, bodyBytes: '', contentLength: 0 })
    );
  }
  const second = await h.runner.run({
    connector: h.connector,
    runId: nextId,
    scheduledSlot: OBS,
    mode: 'full_membership',
    checkpoint: first.checkpoint
  });
  assert.equal(second.outcome, 'succeeded');
  assert.equal(second.seal.pagesCommitted, 2);
  assert.deepEqual([...h.referenceStore.references.values()], refsBefore);
  assert.equal(h.referenceStore.commitCalls.length, 2);
  const reused = h.fetches.slice(2);
  assert.equal(reused.length, 2);
  assert.ok(
    reused.every(
      (x) =>
        x.outcome === 'not_modified' &&
        x.capture === null &&
        x.bodyBytes === null &&
        x.metadataFetch.response_bytes === 0 &&
        x.metadataFetch.decompressed_bytes === 0
    )
  );
  assert.deepEqual(
    reused.map((x) => x.metadataFetch.reused_capture_ref_id),
    pages.map((x) => x.captureRefId)
  );
  assert.ok([...h.referenceStore.references.values()].every((x) => x.run_id === firstId));
  assert.deepEqual(second.seal.observations, first.seal.observations);
});
