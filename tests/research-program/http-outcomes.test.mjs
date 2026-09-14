import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  DcatDataJsonConnector,
  classifyResponse,
  readLimitedBody,
} from '../../packages/connectors/src/index.mjs';
import { classifyResourceRole } from '../../packages/connectors/src/content-classifier.mjs';
import {
  jsonResponse,
  makeFixtureDescriptor,
  makeHarness,
} from '../../packages/connectors/src/testing/index.mjs';
import { createLocalCollector } from '../../packages/ingestion/src/local-collector-adapter.mjs';
import { localScratchRoot } from '../../packages/ingestion/src/local-collection-store.mjs';
import { verifyRetainedArtifact } from '../../scripts/research/document-integrity.mjs';
import { hash } from '../../scripts/research/source-extractors.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CENSUS_HTML = path.join(ROOT, 'tests/research-program/fixtures/pr009-census-negative/sample-census-acs.html');
const CENSUS_RECEIPT = path.join(ROOT, 'tests/research-program/fixtures/pr009-census-negative/sample-census-acs.receipt.json');
const EPA_OBS = path.join(ROOT, 'verification/research-program/bootstrap/corrected-components-e3af8dd/epa-destination/observation.json.gz');
const EPA_BODY = path.join(ROOT, 'verification/research-program/bootstrap/corrected-components-e3af8dd/epa-destination/response-body.html.gz');

const REQUEST = {
  endpointId: 'endpoint_fixture_catalog',
  templateId: 'route_fixture_catalog',
  purpose: 'catalog_metadata',
  method: 'GET',
  targetClass: 'collection',
  pathParameters: {},
  query: {},
};
const DOC_REQUEST = {
  endpointId: 'endpoint_fixture_docs',
  templateId: 'route_fixture_docs',
  purpose: 'documentation',
  method: 'GET',
  targetClass: 'documentation',
  pathParameters: { slug: 'guide' },
  query: {},
};

async function stateDir(t) {
  const directory = await fs.mkdtemp(path.join(localScratchRoot(), 'ushso-pr011-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function documentationProfile() {
  return { validateText: () => ({ accepted: true, classification: 'documentation' }) };
}

test('Census Missing Key HTTP 200 HTML cannot be JSON success', async () => {
  const html = await readFile(CENSUS_HTML);
  const receipt = JSON.parse(await readFile(CENSUS_RECEIPT, 'utf8'));
  assert.equal(html.byteLength, 8531);
  assert.equal(hash(html), 'c2f4687e09b80676de7f68dec92ebea395209616dbc6f895520e547c5f68c0f5');
  verifyRetainedArtifact(html, receipt.sha256, receipt.bytes);
  const classified = classifyResponse({
    purpose: 'catalog_metadata',
    expectedContentClasses: ['catalog_collection', 'catalog_item_record'],
    headers: new Headers({ 'content-type': 'text/html' }),
    bodyBytes: html,
  });
  assert.equal(classified.accepted, false);
  assert.notEqual(classified.reasonCode, null);
  const role = classifyResourceRole({
    requestedUrl: 'https://api.census.gov/data/acs',
    finalUrl: `https://${receipt.safe_final_host}${receipt.safe_final_path}`,
    expectedRole: 'catalog_metadata',
    observedTitle: 'Missing Key',
    mediaType: receipt.observed_media_type,
    status: receipt.observed_status,
    redirectCount: receipt.redirect_count,
    purpose: 'catalog_metadata',
  });
  assert.equal(role.json_success_possible, false);
  assert.equal(role.http_status, 200);
  assert.equal(role.redirect_count, null);
  assert.equal(role.actionable_recipe, false);
  assert.equal(role.observed_role, 'error_html');
});

test('EPA developer-directory Widgets observation is a destination/resource-role mismatch', async () => {
  const observationBytes = await readFile(EPA_OBS);
  const bodyGz = await readFile(EPA_BODY);
  assert.equal(hash(observationBytes), '26f6c96eed2ed80d3208b0ffed68bfa0c02d2b4bd775f6df7fd231673fabf73c');
  assert.equal(hash(bodyGz), '9c7688b29b09982f433969db8000452e8744fa02e99def5e92c31d0c84df114b');
  const observation = JSON.parse(gunzipSync(observationBytes).toString('utf8'));
  const body = gunzipSync(bodyGz);
  verifyRetainedArtifact(body, observation.body_sha256, observation.body_bytes);
  assert.equal(observation.requested_locator, 'https://www.epa.gov/developers/data-data-products#apis');
  assert.equal(observation.final_url, 'https://www.epa.gov/developers/widgets');
  assert.equal(observation.redirect_count, 1);
  assert.equal(observation.http_status, 200);
  assert.equal(observation.actionable_recipe, false);
  const classified = classifyResponse({
    purpose: 'documentation',
    expectedContentClasses: ['documentation_page'],
    headers: new Headers({ 'content-type': 'text/html; charset=UTF-8' }),
    bodyBytes: body,
  });
  assert.equal(classified.accepted, false);
  const role = classifyResourceRole({
    requestedUrl: observation.requested_locator,
    finalUrl: observation.final_url,
    expectedRole: 'developer_api_data_products_documentation',
    observedTitle: observation.observed_page_title,
    mediaType: 'text/html',
    status: observation.http_status,
    redirectCount: observation.redirect_count,
    purpose: 'documentation',
  });
  assert.equal(role.reason_code, 'DESTINATION_RESOURCE_ROLE_MISMATCH');
  assert.equal(role.classification, 'content-mismatch');
  assert.equal(role.actionable_recipe, false);
  assert.equal(role.destination_match, false);
  assert.equal(role.redirect_count, 1);
  assert.equal(role.observed_role, 'widgets_documentation');
});

test('matching-role documentation HTML is a positive control on the fixture host', async () => {
  const descriptor = makeFixtureDescriptor();
  const harness = makeHarness({ descriptor });
  harness.transport.add(
    'GET',
    'https://catalog.example.gov/docs/guide',
    jsonResponse({}, { bodyBytes: '<html><body><h1>API Guide</h1></body></html>', contentType: 'text/html' })
  );
  const result = await harness.client.execute({
    descriptor,
    runId: 'run_doc_positive',
    jobId: 'job_doc_positive',
    request: DOC_REQUEST,
    responseProfile: documentationProfile(),
  });
  assert.equal(result.outcome, 'captured');
  assert.equal(result.attemptObservation.evidence_kind, 'documentation_reachability');
  assert.equal(result.attemptObservation.http_status, 200);
  assert.equal(result.metadataFetch.outcome, 'captured');
  assert.equal('attemptObservation' in result.metadataFetch, false);
  const role = classifyResourceRole({
    requestedUrl: 'https://catalog.example.gov/docs/guide',
    finalUrl: 'https://catalog.example.gov/docs/guide',
    expectedRole: 'documentation_page',
    observedTitle: 'API Guide',
    mediaType: 'text/html',
    status: 200,
    redirectCount: 0,
    purpose: 'documentation',
  });
  assert.equal(role.destination_match, false);
  assert.equal(role.actionable_recipe, false);
});

test('read and expansion bounds fail closed before parsers', async () => {
  const descriptor = makeFixtureDescriptor({ maximumResponseBytes: 100, maximumDecompressedBytes: 20 });
  const harness = makeHarness({ descriptor });
  harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({}, {
    wireBytes: '{}',
    bodyBytes: JSON.stringify({ dataset: [], padding: 'x'.repeat(30) }),
    contentLength: 2,
  }));
  const oversized = await harness.client.execute({
    descriptor,
    runId: 'run_expand_bound',
    jobId: 'job_expand_bound',
    request: REQUEST,
    responseProfile: new DcatDataJsonConnector({
      descriptor,
      endpointId: 'endpoint_fixture_catalog',
      templateId: 'route_fixture_catalog',
    }).responseProfile(),
  });
  assert.equal(oversized.failure.safe_detail_code, 'RESPONSE_SIZE_BOUND_EXCEEDED');
  assert.equal(oversized.attemptObservation.detail_code, 'RESPONSE_SIZE_BOUND_EXCEEDED');
  assert.equal(harness.objectStore.objects.size, 0);

  async function* interrupted() {
    yield new Uint8Array([1, 2, 3]);
    throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  }
  await assert.rejects(readLimitedBody(interrupted(), { maximumBytes: 100, targetClass: 'collection' }));

  async function* compressed() {
    yield new Uint8Array(16);
    yield new Uint8Array(16);
  }
  await assert.rejects(
    readLimitedBody(compressed(), { maximumBytes: 20, targetClass: 'collection' }),
    (error) => error.safeDetailCode === 'RESPONSE_SIZE_BOUND_EXCEEDED'
  );
});

test('fixture host redirect mismatch is recorded without contacting EPA', async () => {
  const descriptor = makeFixtureDescriptor({ redirectPolicy: 'same_origin', maximumRedirects: 2 });
  const harness = makeHarness({ descriptor });
  harness.transport.add(
    'GET',
    'https://catalog.example.gov/docs/api',
    jsonResponse({}, { status: 301, location: 'https://catalog.example.gov/docs/widgets', bodyBytes: '', contentType: 'text/html', contentLength: 0 })
  );
  harness.transport.add(
    'GET',
    'https://catalog.example.gov/docs/widgets',
    jsonResponse({}, { bodyBytes: '<html><body><h1>Widgets</h1></body></html>', contentType: 'text/html' })
  );
  const request = {
    ...DOC_REQUEST,
    pathParameters: { slug: 'api' },
  };
  const result = await harness.client.execute({
    descriptor,
    runId: 'run_role_redirect',
    jobId: 'job_role_redirect',
    request,
    responseProfile: documentationProfile(),
  });
  assert.equal(result.outcome, 'captured');
  assert.equal(result.attemptObservation.redirect_count, 1);
  const role = classifyResourceRole({
    requestedUrl: 'https://catalog.example.gov/docs/api',
    finalUrl: 'https://catalog.example.gov/docs/widgets',
    expectedRole: 'developer_api_data_products_documentation',
    observedTitle: 'Widgets',
    mediaType: 'text/html',
    status: 200,
    redirectCount: result.attemptObservation.redirect_count,
    purpose: 'documentation',
  });
  assert.equal(role.reason_code, 'DESTINATION_RESOURCE_ROLE_MISMATCH');
  assert.equal(role.actionable_recipe, false);
});

function series(kind, origin = 'retained_observation_fixture') {
  return {
    source_id: 'source_retained_docs',
    descriptor_role: 'documentation',
    record_or_route_id: 'route_docs',
    evidence_kind: kind,
    origin_class: origin,
  };
}

test('latest_attempt updates on later failure while last_good proof is byte-identical after restart', async (t) => {
  const directory = await stateDir(t);
  const proof = {
    retained_artifact: {
      path: 'tests/research-program/fixtures/pr009-census-negative/sample-census-acs.html',
      sha256: 'c2f4687e09b80676de7f68dec92ebea395209616dbc6f895520e547c5f68c0f5',
      bytes: 8531,
    },
  };
  const successObservation = { http_status: 200, classification: 'documentation', detail_code: null };
  const failureObservation = { http_status: 200, classification: 'content-mismatch', detail_code: 'DESTINATION_RESOURCE_ROLE_MISMATCH' };
  const first = await createLocalCollector({ stateDir: directory });
  t.after(() => first.close());
  await first.recordAttemptEvidence({
    origin: 'retained_observation_fixture',
    series: series('documentation_reachability'),
    attempt_order: 1,
    observation: successObservation,
    proof,
    qualified_success: true,
    operation_id: 'evidence:docs:1',
  });
  await first.close();

  const second = await createLocalCollector({ stateDir: directory });
  t.after(() => second.close());
  await second.recordAttemptEvidence({
    origin: 'retained_observation_fixture',
    series: series('documentation_reachability'),
    attempt_order: 2,
    observation: failureObservation,
    proof,
    qualified_success: false,
    operation_id: 'evidence:docs:2',
  });
  const mid = second.evidenceStatus({ series: series('documentation_reachability') });
  assert.equal(mid.latest_attempt.attempt_order, 2);
  assert.equal(mid.latest_attempt.qualified_success, false);
  assert.equal(mid.last_good.attempt_order, 1);
  const lastGoodProof = JSON.stringify(mid.last_good.proof);
  await second.close();

  const third = await createLocalCollector({ stateDir: directory });
  t.after(() => third.close());
  const after = third.evidenceStatus({ series: series('documentation_reachability') });
  assert.equal(after.latest_attempt.attempt_order, 2);
  assert.equal(after.last_good.attempt_order, 1);
  assert.equal(JSON.stringify(after.last_good.proof), lastGoodProof);
  assert.equal(after.last_good.observation.classification, 'documentation');
});

test('cross-kind success never supplies another kind last-good', async (t) => {
  const directory = await stateDir(t);
  const app = await createLocalCollector({ stateDir: directory });
  t.after(() => app.close());
  const proof = {
    retained_artifact: {
      path: 'verification/research-program/bootstrap/corrected-components-e3af8dd/epa-destination/observation.json.gz',
      sha256: '26f6c96eed2ed80d3208b0ffed68bfa0c02d2b4bd775f6df7fd231673fabf73c',
      bytes: 1326,
    },
  };
  await app.recordAttemptEvidence({
    origin: 'retained_observation_fixture',
    series: series('documentation_reachability'),
    attempt_order: 1,
    observation: { http_status: 200, classification: 'documentation' },
    proof,
    qualified_success: true,
    operation_id: 'evidence:docs-kind:1',
  });
  const payload = app.evidenceStatus({ series: series('payload_validation') });
  const browser = app.evidenceStatus({ series: series('browser_cors_observation') });
  assert.equal(payload.last_good, null);
  assert.equal(browser.last_good, null);
  const docs = app.evidenceStatus({ series: series('documentation_reachability') });
  assert.equal(docs.last_good.attempt_order, 1);
});

test('unknown redirect counts stay null and duplicate observations are idempotent', async (t) => {
  const unknown = classifyResourceRole({
    requestedUrl: 'https://api.census.gov/data/missing_key.html',
    finalUrl: 'https://api.census.gov/data/missing_key.html',
    expectedRole: 'catalog_metadata',
    observedTitle: 'Missing Key',
    mediaType: 'text/html',
    status: 200,
    purpose: 'catalog_metadata',
  });
  assert.equal(unknown.redirect_count, null);
  assert.equal(unknown.json_success_possible, false);

  const directory = await stateDir(t);
  const app = await createLocalCollector({ stateDir: directory });
  t.after(() => app.close());
  const context = {
    origin: 'retained_observation_fixture',
    series: series('catalog_metadata_validation'),
    attempt_order: 1,
    observation: { http_status: 200, classification: 'content-mismatch', detail_code: 'JSON_SUCCESS_IMPOSSIBLE' },
    proof: {
      retained_artifact: {
        path: 'tests/research-program/fixtures/pr009-census-negative/sample-census-acs.receipt.json',
        sha256: 'ec82248a6c9e4ba7f92b5d5721aed46b639036a96a0f5df0297e45ac51738896',
        bytes: 937,
      },
    },
    qualified_success: false,
    operation_id: 'evidence:census:1',
  };
  await app.recordAttemptEvidence(context);
  await app.recordAttemptEvidence(context);
  assert.equal(app.store.byKind('attempt_evidence').filter((row) => row.operation_id === 'evidence:census:1').length, 1);
  await assert.rejects(
    app.recordAttemptEvidence({
      ...context,
      observation: { http_status: 500, classification: 'content-mismatch', detail_code: 'JSON_SUCCESS_IMPOSSIBLE' },
    }),
    { code: 'JOURNAL_IDEMPOTENCY_CONFLICT' }
  );
});

test('304 reuse keeps prior same-kind provenance and rejects missing prior evidence', async () => {
  const descriptor = makeFixtureDescriptor();
  const harness = makeHarness({ descriptor });
  const body = { dataset: [{ identifier: 'fixture-record-a', title: 'Synthetic fixture A', modified: '2026-09-10T00:00:00.000Z' }] };
  harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse(body, { etag: '"abc"' }));
  const first = await harness.client.execute({
    descriptor,
    runId: 'run_304_first',
    jobId: 'job_304_first',
    request: REQUEST,
    responseProfile: new DcatDataJsonConnector({
      descriptor,
      endpointId: 'endpoint_fixture_catalog',
      templateId: 'route_fixture_catalog',
    }).responseProfile(),
  });
  assert.equal(first.outcome, 'captured');
  harness.transport.add('GET', 'https://catalog.example.gov/data.json', jsonResponse({}, {
    status: 304,
    etag: '"abc"',
    bodyBytes: '',
    contentLength: 0,
  }));
  const reused = await harness.client.execute({
    descriptor,
    runId: 'run_304_reuse',
    jobId: 'job_304_reuse',
    request: REQUEST,
    validators: { etag: '"abc"' },
    priorCaptureRefId: first.capture.capture_ref_id,
    responseProfile: new DcatDataJsonConnector({
      descriptor,
      endpointId: 'endpoint_fixture_catalog',
      templateId: 'route_fixture_catalog',
    }).responseProfile(),
  });
  assert.equal(reused.outcome, 'not_modified');
  assert.equal(reused.metadataFetch.reused_capture_ref_id, first.capture.capture_ref_id);
  assert.equal(reused.attemptObservation.http_status, 304);

  const missing = await harness.client.execute({
    descriptor,
    runId: 'run_304_missing',
    jobId: 'job_304_missing',
    request: REQUEST,
    validators: { etag: '"abc"' },
    responseProfile: new DcatDataJsonConnector({
      descriptor,
      endpointId: 'endpoint_fixture_catalog',
      templateId: 'route_fixture_catalog',
    }).responseProfile(),
  });
  assert.equal(missing.outcome, 'typed_failure');
});

test('current fixture admission remains one attempt per child', async (t) => {
  const directory = await stateDir(t);
  const app = await createLocalCollector({ stateDir: directory });
  t.after(() => app.close());
  const admitted = await app.admit();
  assert.equal(admitted.kind, 'admitted');
  await app.schedule(admitted.job);
  const outcome = await app.execute(admitted.job.collection_job_id);
  assert.equal(outcome.status, 'complete_fixture');
  assert.equal(outcome.attempt, 1);
  assert.equal(app.store.byKind('attempt_outcome').length, 1);
  assert.equal(outcome.publication_authorized, false);
});
