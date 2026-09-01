import assert from 'node:assert/strict';
import { DcatDataJsonConnector } from '../adapters/dcat-data-json.mjs';
import { classifyDeletionEvidence } from '../deletion-policy.mjs';
import { connectorRequestKey } from '../runner.mjs';
import { FixtureTransport, MemoryRunRepository } from './memory-ports.mjs';
import { jsonResponse, makeFixtureDescriptor, makeHarness } from './fixtures.mjs';

const SLOT = '2026-08-30T00:00:00.000Z';
const CATALOG_URL = 'https://catalog.example.gov/data.json';

function dcat(descriptor) {
  return new DcatDataJsonConnector({ descriptor, endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog' });
}

function item(id, modified, extras = {}) {
  return { identifier: id, title: `Fixture ${id}`, modified, ...extras };
}

function pass(results, scenario, assertions, extra = {}) {
  results.push({ scenario, status: 'PASS', assertions, ...extra });
}

async function runCatalog(harness, connector, runId, body, { mode = 'full_membership', checkpoint = null, url = CATALOG_URL } = {}) {
  harness.transport.add('GET', url, jsonResponse(body, { etag: '"fixture-v1"', lastModified: 'Sat, 30 Aug 2026 00:00:00 GMT' }));
  return harness.runner.run({ connector, checkpoint, runId, scheduledSlot: SLOT, mode });
}

export async function runFixtureMatrix() {
  const results = [];

  {
    const descriptor = makeFixtureDescriptor();
    const harness = makeHarness({ descriptor });
    const connector = dcat(descriptor);
    const first = await runCatalog(harness, connector, 'run_full_001', { dataset: [item('a', '2026-08-01T00:00:00.000Z'), item('b', '2026-08-02T00:00:00.000Z')] });
    assert.equal(first.outcome, 'succeeded');
    assert.equal(first.seal.discoveriesCommitted, 2);
    assert.equal(first.membership.filter((entry) => entry.state === 'active').length, 2);
    assert.equal(harness.objectStore.objects.size, 1);
    pass(results, 'initial_full_scan', 4);

    const second = await runCatalog(harness, connector, 'run_noop_001', { dataset: [item('a', '2026-08-01T00:00:00.000Z'), item('b', '2026-08-02T00:00:00.000Z')] }, { checkpoint: first.checkpoint });
    assert.equal(second.outcome, 'succeeded');
    assert.equal(harness.objectStore.objects.size, 1, 'content-addressed duplicate must reuse the object');
    assert.deepEqual(second.membership.map(({ nativeId, sourceRevision, state }) => ({ nativeId, sourceRevision, state })), first.membership.map(({ nativeId, sourceRevision, state }) => ({ nativeId, sourceRevision, state })));
    pass(results, 'unchanged_no_op', 3);

    const request = connector.initialRequest(await connector.plan(first.checkpoint, { scheduledSlot: SLOT }));
    const thirdRun = 'run_not_modified_001';
    const priorPage = [...harness.runRepository.runs.get('run_full_001').pages.values()][0];
    harness.runRepository.seedReusableCapture(priorPage.captureRefId, { observations: priorPage.observations, nextRequest: null, cursor: null });
    harness.runRepository.setConditional(thirdRun, connectorRequestKey(request), { validators: { etag: '"fixture-v1"' }, priorCaptureRefId: priorPage.captureRefId });
    harness.transport.add('GET', CATALOG_URL, jsonResponse({}, { status: 304, bodyBytes: '', contentLength: 0, etag: '"fixture-v1"' }));
    const third = await harness.runner.run({ connector, checkpoint: first.checkpoint, runId: thirdRun, scheduledSlot: SLOT, mode: 'incremental' });
    assert.equal(third.outcome, 'succeeded');
    assert.equal(harness.requestLedger.records.at(-1).outcome, 'not_modified');
    assert.equal(harness.objectStore.objects.size, 1);
    pass(results, 'conditional_304_reuse', 3);
  }

  {
    const descriptor = makeFixtureDescriptor();
    const harness = makeHarness({ descriptor });
    const connector = dcat(descriptor);
    const first = await runCatalog(harness, connector, 'run_change_base', { dataset: [item('a', '2026-08-01T00:00:00.000Z')] });
    const changed = await runCatalog(harness, connector, 'run_change_next', { dataset: [item('a', '2026-08-10T00:00:00.000Z', { description: 'updated' }), item('b', '2026-08-09T00:00:00.000Z')] }, { checkpoint: first.checkpoint });
    assert.equal(changed.membership.length, 2);
    assert.notEqual(changed.membership.find((entry) => entry.nativeId === 'a').sourceRevision, first.membership[0].sourceRevision);
    pass(results, 'insert_and_update', 2);

    const duplicate = await runCatalog(harness, connector, 'run_duplicate_001', { dataset: [item('a', '2026-08-10T00:00:00.000Z'), item('a', '2026-08-11T00:00:00.000Z'), item('b', '2026-08-09T00:00:00.000Z')] }, { checkpoint: changed.checkpoint });
    assert.equal(duplicate.seal.logicalDuplicates, 1);
    assert.equal(duplicate.seal.discoveriesCommitted, 2);
    assert.equal(duplicate.membership.find((entry) => entry.nativeId === 'a').publisherModifiedAt, '2026-08-11T00:00:00.000Z');
    pass(results, 'duplicate_delivery', 3);

    const late = await runCatalog(harness, connector, 'run_late_001', { dataset: [item('a', '2026-07-01T00:00:00.000Z'), item('b', '2026-08-09T00:00:00.000Z')] }, { checkpoint: duplicate.checkpoint, mode: 'incremental' });
    assert.equal(late.membership.find((entry) => entry.nativeId === 'a').publisherModifiedAt, '2026-08-11T00:00:00.000Z');
    assert.equal(late.membership.find((entry) => entry.nativeId === 'a').lateObservationCount, 1);
    pass(results, 'late_update_no_regression', 2);
  }

  {
    const descriptor = makeFixtureDescriptor();
    const harness = makeHarness({ descriptor, runRepository: new MemoryRunRepository({ requiredCompleteMisses: 2 }) });
    const connector = dcat(descriptor);
    const base = await runCatalog(harness, connector, 'run_shrink_base', { dataset: [item('a', '2026-08-01T00:00:00.000Z'), item('b', '2026-08-01T00:00:00.000Z')] });
    const oneMiss = await runCatalog(harness, connector, 'run_shrink_one', { dataset: [item('a', '2026-08-01T00:00:00.000Z')] }, { checkpoint: base.checkpoint });
    assert.equal(oneMiss.membership.find((entry) => entry.nativeId === 'b').state, 'active');
    const twoMisses = await runCatalog(harness, connector, 'run_shrink_two', { dataset: [item('a', '2026-08-01T00:00:00.000Z')] }, { checkpoint: oneMiss.checkpoint });
    assert.equal(twoMisses.membership.find((entry) => entry.nativeId === 'b').state, 'withdrawn');
    const tombstone = await runCatalog(harness, connector, 'run_tombstone', { dataset: [item('a', '2026-08-12T00:00:00.000Z', { tombstone: true })] }, { checkpoint: twoMisses.checkpoint });
    assert.equal(tombstone.membership.find((entry) => entry.nativeId === 'a').state, 'withdrawn');
    pass(results, 'source_shrink_and_tombstone', 3);
  }

  {
    const descriptor = makeFixtureDescriptor();
    const transport = new FixtureTransport();
    const harness = makeHarness({ descriptor, transport });
    const connector = dcat(descriptor);
    transport.add('GET', CATALOG_URL, jsonResponse({ dataset: [item('a', '2026-08-01T00:00:00.000Z')], next_cursor: 'expired' }));
    transport.add('GET', `${CATALOG_URL}?cursor=expired`, jsonResponse({}, { status: 410 }));
    const result = await harness.runner.run({ connector, runId: 'run_expired_cursor', scheduledSlot: SLOT, mode: 'full_membership' });
    assert.equal(result.failure.failure_type, 'cursor_expired');
    assert.equal(result.checkpointCommitted, false);
    assert.equal(harness.runRepository.checkpoints.size, 0);
    pass(results, 'expired_cursor_blocks_checkpoint', 3);
  }

  {
    const descriptor = makeFixtureDescriptor();
    const transport = new FixtureTransport();
    const harness = makeHarness({ descriptor, transport });
    const connector = dcat(descriptor);
    transport.add('GET', CATALOG_URL, jsonResponse({}, { status: 429, headers: { 'retry-after': '30' } }));
    const limited = await harness.runner.run({ connector, runId: 'run_rate_limited', scheduledSlot: SLOT, mode: 'full_membership' });
    assert.equal(limited.failure.failure_type, 'rate_limited');
    assert.equal(limited.sealed, false);
    pass(results, 'rate_limited', 2);

    const networkHarness = makeHarness({ descriptor, transport: new FixtureTransport() });
    networkHarness.transport.add('GET', CATALOG_URL, Object.assign(new Error('fixture timeout'), { code: 'ETIMEDOUT' }));
    const timeout = await networkHarness.runner.run({ connector, runId: 'run_network_timeout', scheduledSlot: SLOT, mode: 'full_membership' });
    assert.equal(timeout.failure.failure_type, 'timeout');
    assert.equal(timeout.sealed, false);
    pass(results, 'transient_network_failure', 2);
  }

  {
    const descriptor = makeFixtureDescriptor();
    const harness = makeHarness({ descriptor });
    harness.transport.add('HEAD', 'https://catalog.example.gov/files/restricted', jsonResponse({}, { status: 403, bodyBytes: '', contentLength: 0 }));
    const access = await harness.client.execute({
      descriptor, runId: 'run_access_001', jobId: 'job_access_001',
      request: { endpointId: 'endpoint_fixture_access', templateId: 'route_fixture_access', purpose: 'access_probe', method: 'HEAD', targetClass: 'exact_distribution', pathParameters: { id: 'restricted' }, query: {} },
    });
    assert.equal(access.failure.failure_type, 'expected_access_restriction');
    assert.equal(harness.objectStore.objects.size, 0);
    pass(results, 'expected_access_restriction', 2);
  }

  {
    const descriptor = makeFixtureDescriptor();
    const harness = makeHarness({ descriptor });
    harness.transport.add('GET', CATALOG_URL, jsonResponse({}, { status: 302, bodyBytes: '', contentLength: 0, location: CATALOG_URL }));
    harness.transport.add('GET', CATALOG_URL, jsonResponse({ dataset: [item('a', '2026-08-01T00:00:00.000Z')] }));
    const approved = await harness.runner.run({ connector: dcat(descriptor), runId: 'run_redirect_approved', scheduledSlot: SLOT, mode: 'full_membership' });
    assert.equal(approved.outcome, 'succeeded');
    assert.equal(harness.transport.calls.length, 2);
    pass(results, 'approved_manifest_redirect', 2);

    const blockedHarness = makeHarness({ descriptor });
    blockedHarness.transport.add('GET', CATALOG_URL, jsonResponse({}, { status: 302, bodyBytes: '', contentLength: 0, location: 'https://evil.example/data.json' }));
    const blocked = await blockedHarness.runner.run({ connector: dcat(descriptor), runId: 'run_redirect_blocked', scheduledSlot: SLOT, mode: 'full_membership' });
    assert.equal(blocked.failure.failure_type, 'redirect_unapproved');
    assert.equal(blockedHarness.transport.calls.length, 1);
    pass(results, 'unapproved_redirect', 2);
  }

  {
    const descriptor = makeFixtureDescriptor();
    const cases = [
      ['login_page', '<html><body><form><input type="password"></form></body></html>', 'text/html', 'LOGIN_FORM_OR_CHALLENGE_QUARANTINED'],
      ['schema_drift', JSON.stringify({ unexpected: true }), 'application/json', 'DCAT_COLLECTION_SCHEMA_DRIFT'],
      ['healthcare_rows', JSON.stringify([{ patient_id: 'p1', diagnosis_code: 'x', value: 1 }]), 'application/json', 'HEALTHCARE_ROW_SHAPE_QUARANTINED'],
      ['payload_response_sentinel', JSON.stringify({ marker: 'USHSONOEGRESS_SOURCE_DATA_PAYLOAD' }), 'application/json', 'PAYLOAD_SENTINEL_RESPONSE_QUARANTINED'],
      ['misleading_content_type', '<html><body>metadata</body></html>', 'application/json', 'MISLEADING_CONTENT_TYPE_HTML'],
      ['archive_member', new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 'application/json', 'ARCHIVE_RESPONSE_QUARANTINED'],
    ];
    for (const [name, body, contentType, detail] of cases) {
      const harness = makeHarness({ descriptor });
      harness.transport.add('GET', CATALOG_URL, jsonResponse({}, { bodyBytes: body, contentType }));
      const result = await harness.runner.run({ connector: dcat(descriptor), runId: `run_${name}`, scheduledSlot: SLOT, mode: 'full_membership' });
      assert.equal(result.failure.safe_detail_code, detail);
      assert.equal(harness.objectStore.objects.size, 0);
      assert.equal(harness.referenceStore.references.size, 0);
    }
    pass(results, 'content_quarantine_matrix', cases.length * 3, { cases: cases.map(([name]) => name) });
  }

  {
    const descriptor = makeFixtureDescriptor({ maximumResponseBytes: 10, maximumDecompressedBytes: 20 });
    const harness = makeHarness({ descriptor });
    harness.transport.add('GET', CATALOG_URL, jsonResponse({ dataset: [] }, { contentLength: 1000 }));
    const result = await harness.runner.run({ connector: dcat(descriptor), runId: 'run_oversize', scheduledSlot: SLOT, mode: 'full_membership' });
    assert.equal(result.failure.failure_type, 'response_too_large');
    assert.equal(harness.objectStore.objects.size, 0);
    pass(results, 'oversize_response', 2);
  }

  {
    const descriptor = makeFixtureDescriptor();
    for (const point of ['after_fetch_before_page_commit', 'after_page_commit_before_resume', 'after_seal_before_checkpoint_commit', 'after_checkpoint_transaction']) {
      let injected = false;
      const harness = makeHarness({ descriptor, runnerCrashInjector: async (candidate) => {
        if (!injected && candidate === point) {
          injected = true;
          throw new Error(`injected:${point}`);
        }
      } });
      harness.transport.add('GET', CATALOG_URL, jsonResponse({ dataset: [item('a', '2026-08-01T00:00:00.000Z')] }));
      if (point === 'after_fetch_before_page_commit') harness.transport.add('GET', CATALOG_URL, jsonResponse({ dataset: [item('a', '2026-08-01T00:00:00.000Z')] }));
      await assert.rejects(() => harness.runner.run({ connector: dcat(descriptor), runId: `run_crash_${point}`, scheduledSlot: SLOT, mode: 'full_membership' }), /injected/);
      const resumed = await harness.runner.run({ connector: dcat(descriptor), runId: `run_crash_${point}`, scheduledSlot: SLOT, mode: 'full_membership' });
      assert.equal(resumed.outcome, 'succeeded');
      assert.equal(resumed.seal.discoveriesCommitted, 1);
      assert.equal(harness.objectStore.objects.size, 1);
    }
    pass(results, 'resume_crash_boundaries', 16, { boundaries: 4 });
  }

  {
    let inject = true;
    const descriptor = makeFixtureDescriptor();
    const harness = makeHarness({ descriptor, captureCrashInjector: async (point) => {
      if (inject && point === 'after_object_write_before_reference_commit') throw new Error('injected orphan');
    } });
    harness.transport.add('GET', CATALOG_URL, jsonResponse({ dataset: [item('a', '2026-08-01T00:00:00.000Z')] }));
    const failed = await harness.client.execute({
      descriptor, runId: 'run_r2_orphan', jobId: 'job_r2_orphan',
      request: { endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog', purpose: 'catalog_metadata', method: 'GET', targetClass: 'collection', pathParameters: {}, query: {} },
      responseProfile: dcat(descriptor).responseProfile(),
    });
    assert.equal(failed.outcome, 'typed_failure');
    assert.equal(harness.objectStore.objects.size, 1);
    assert.equal(harness.referenceStore.references.size, 0);
    inject = false;
    harness.transport.add('GET', CATALOG_URL, jsonResponse({ dataset: [item('a', '2026-08-01T00:00:00.000Z')] }));
    const recovered = await harness.client.execute({
      descriptor, runId: 'run_r2_orphan', jobId: 'job_r2_orphan',
      request: { endpointId: 'endpoint_fixture_catalog', templateId: 'route_fixture_catalog', purpose: 'catalog_metadata', method: 'GET', targetClass: 'collection', pathParameters: {}, query: {} },
      responseProfile: dcat(descriptor).responseProfile(),
    });
    assert.equal(recovered.outcome, 'captured');
    assert.equal(harness.objectStore.objects.size, 1);
    assert.equal(harness.referenceStore.references.size, 1);
    pass(results, 'r2_orphan_redelivery', 6);
  }

  {
    const classes = ['catalog_root', 'collection', 'pagination_cursor', 'exact_item', 'exact_distribution', 'documentation'];
    const dispositions = Object.fromEntries(classes.map((targetClass) => [targetClass, classifyDeletionEvidence({ httpStatus: 404, targetClass })]));
    assert.equal(dispositions.catalog_root.sealAllowed, false);
    assert.equal(dispositions.collection.sealAllowed, false);
    assert.equal(dispositions.pagination_cursor.sealAllowed, false);
    assert.equal(dispositions.exact_item.parentAssetWithdrawn, true);
    assert.equal(dispositions.exact_distribution.parentAssetWithdrawn, false);
    assert.equal(dispositions.documentation.parentAssetWithdrawn, false);
    pass(results, 'deletion_target_classes', 6, { targetClasses: classes });
  }

  return {
    fixture_scope: 'fixture_only',
    integration_level: 'local_integration',
    status: 'PASS',
    scenarios: results,
    totals: {
      scenarios: results.length,
      assertions: results.reduce((total, result) => total + result.assertions, 0),
    },
    zero_external_actions: {
      dns_queries: 0,
      network_requests: 0,
      credentials_created: 0,
      r2_calls: 0,
      database_calls: 0,
      cloudflare_calls: 0,
      deployments: 0,
    },
  };
}
