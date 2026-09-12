import assert from 'node:assert/strict';
import realTest from 'node:test';
const workerOptions = process.env.USHSO_JOB_WORKER
  ? JSON.parse(process.env.USHSO_JOB_WORKER)
  : null;
const test = workerOptions ? () => {} : realTest;
import { canonicalJson, sha256 } from '../../packages/connectors/src/canonical.mjs';
import {
  compileManifestRequest,
  validateDescriptor
} from '../../packages/connectors/src/route-manifest.mjs';
import { createInMemoryControlPlane } from '../../packages/ingestion/src/in-memory-control-plane.mjs';
import { createScheduler } from '../../packages/ingestion/src/scheduler.mjs';
import { admitCollectionJob } from '../../packages/ingestion/src/collection-job.mjs';
import {
  loadFixtureCatalog,
  createFixtureRegistry
} from '../../packages/ingestion/src/local-fixture-catalog.mjs';

const copy = (value) => structuredClone(value);
test('A1/L1 approved exact fixture descriptor and route produce a strict collection job', async () => {
  const fixture = await loadFixtureCatalog();
  const result = await admitCollectionJob(fixture.input, fixture);
  assert.equal(result.kind, 'admitted');
  assert.equal(
    result.job.identity.descriptor_sha256,
    sha256(canonicalJson(validateDescriptor(fixture.descriptor)))
  );
  assert.equal(
    compileManifestRequest(fixture.descriptor, result.job.initial_request).url.href,
    'https://catalog.example.gov/data.json'
  );
  assert.notEqual(result.job.execution_run_id, result.job.parent_run_id);
  assert.equal(result.job.activation.live_network, false);
});

test('A2 invalid identity, route, scope, extra fields and unapproved context block admission', async () => {
  const fixture = await loadFixtureCatalog();
  for (const [field, value] of [
    ['source_id', 'source_cdc_socrata'],
    ['descriptor_id', 'descriptor_other'],
    ['configuration_revision', 2],
    ['scope_id', 'scope_other'],
    ['endpoint_id', 'endpoint_other'],
    ['template_id', 'route_other'],
    ['extra', true],
    ['fixture_manifest_sha256', 'f'.repeat(64)]
  ]) {
    const input = { ...fixture.input, [field]: value };
    assert.equal((await admitCollectionJob(input, fixture)).kind, 'blocked', field);
  }
  assert.equal(
    (await admitCollectionJob(fixture.input, { ...fixture, resolveApprovedDescriptor: undefined }))
      .code,
    'APPROVED_REGISTRY_REQUIRED'
  );
  assert.equal(
    (
      await admitCollectionJob(fixture.input, {
        ...fixture,
        resolveApprovedDescriptor: async () => ({ kind: 'resolved', approvalScope: 'live' })
      })
    ).code,
    'DESCRIPTOR_NOT_APPROVED'
  );
});

test('A3 canonical key ordering preserves identity; stale hashes block; approved revision changes identity', async () => {
  const fixture = await loadFixtureCatalog();
  const a = await admitCollectionJob(fixture.input, fixture);
  const reordered = Object.fromEntries(Object.entries(fixture.input).reverse());
  assert.equal(
    (await admitCollectionJob(reordered, fixture)).job.collection_job_id,
    a.job.collection_job_id
  );
  assert.equal(
    (await admitCollectionJob({ ...fixture.input, descriptor_sha256: 'a'.repeat(64) }, fixture))
      .code,
    'DESCRIPTOR_HASH_MISMATCH'
  );
  const descriptor = copy(fixture.descriptor);
  descriptor.configuration_revision = 2;
  const registry = createFixtureRegistry({
    descriptor,
    manifest: fixture.manifest,
    policySha256: fixture.policySha256
  });
  const b = await admitCollectionJob(
    {
      ...fixture.input,
      configuration_revision: 2,
      descriptor_sha256: sha256(canonicalJson(descriptor))
    },
    { ...fixture, ...registry }
  );
  assert.equal(b.kind, 'admitted');
  assert.notEqual(a.job.parent_run_id, b.job.parent_run_id);
  assert.notEqual(a.job.collection_job_id, b.job.collection_job_id);
});

test('A4 real, paused and activated foreign descriptors cannot enter the fixture lane', async () => {
  const fixture = await loadFixtureCatalog();
  for (const state of ['paused', 'auth_blocked']) {
    const descriptor = copy(fixture.descriptor);
    descriptor.source_state = state;
    const registry = createFixtureRegistry({
      descriptor,
      manifest: fixture.manifest,
      policySha256: fixture.policySha256
    });
    assert.equal(
      (
        await admitCollectionJob(
          { ...fixture.input, descriptor_sha256: sha256(canonicalJson(descriptor)) },
          { ...fixture, ...registry }
        )
      ).code,
      'FIXTURE_DESCRIPTOR_NOT_ACTIVE'
    );
  }
  const policy = copy(fixture.policy);
  policy.activation.live_network = true;
  assert.equal(
    (await admitCollectionJob(fixture.input, { ...fixture, policy })).code,
    'ACTIVATION_FORBIDDEN'
  );
});

test('A5 repeated actual scheduler slots converge on one run and workflow outbox', async () => {
  const fixture = await loadFixtureCatalog();
  const admitted = await admitCollectionJob(fixture.input, fixture);
  const job = admitted.job;
  const control = createInMemoryControlPlane();
  control.seedSource({
    source_id: job.identity.source_id,
    endpoint_id: job.identity.endpoint_id,
    scope_ids: [job.identity.scope_id],
    configuration_revision: 1,
    next_due_at: job.identity.scheduled_slot,
    mode: job.identity.mode
  });
  const scheduler = createScheduler({
    openDatabase: control.openDatabase,
    configuration: { mode: 'full_membership' }
  });
  const first = await scheduler.dispatchScheduledSlot({
    scheduledTime: job.identity.scheduled_slot
  });
  const second = await scheduler.dispatchScheduledSlot({
    scheduledTime: job.identity.scheduled_slot
  });
  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(control.inspect().runs.size, 1);
  assert.equal(control.inspect().outbox.size, 1);
  assert.equal([...control.inspect().runs.keys()][0], job.parent_run_id);
  assert.ok(control.inspect().clientLifecycle.every((client) => client.closed));
});

test('A6 selections and reservations give child identities while rejecting duplicates and loose limits', async () => {
  const fixture = await loadFixtureCatalog();
  const a = await admitCollectionJob(fixture.input, fixture);
  const b = await admitCollectionJob(
    { ...fixture.input, selected_record_ids: [fixture.input.selected_record_ids[0]] },
    fixture
  );
  assert.equal(b.kind, 'admitted');
  assert.equal(a.job.parent_run_id, b.job.parent_run_id);
  assert.notEqual(a.job.collection_job_id, b.job.collection_job_id);
  assert.notEqual(a.job.execution_run_id, b.job.execution_run_id);
  assert.equal(
    (
      await admitCollectionJob(
        { ...fixture.input, selected_record_ids: ['fixture-record-a', 'fixture-record-a'] },
        fixture
      )
    ).code,
    'SELECTED_RECORDS_DUPLICATE'
  );
  for (const value of [0, -1, 1.5, 3])
    assert.equal(
      (
        await admitCollectionJob(
          {
            ...fixture.input,
            budget_reservation: { ...fixture.input.budget_reservation, maximum_requests: value }
          },
          fixture
        )
      ).kind,
      'blocked'
    );
  assert.equal(
    (await admitCollectionJob({ ...fixture.input, capture_class: 'source_data_payload' }, fixture))
      .code,
    'CAPTURE_CLASS_NOT_SUPPORTED'
  );
  const c = await admitCollectionJob(
    {
      ...fixture.input,
      budget_reservation: {
        ...fixture.input.budget_reservation,
        reservation_id: 'reservation_other'
      }
    },
    fixture
  );
  assert.notEqual(c.job.collection_job_id, a.job.collection_job_id);
});

import fs from 'node:fs/promises';
import path from 'node:path';
import { createLocalCollector } from '../../packages/ingestion/src/local-collector-adapter.mjs';
import {
  localScratchRoot,
  encodeLocalValue,
  decodeLocalValue,
  valueDigest
} from '../../packages/ingestion/src/local-collection-store.mjs';

async function stateDir(t) {
  const directory = await fs.mkdtemp(path.join(localScratchRoot(), 'ushso-job-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
test('A2 correction: sparse selected arrays and hidden or accessor JSON fields never admit', async () => {
  const fixture = await loadFixtureCatalog();
  for (const selection of [Array(1), Object.assign(Array(2), { 0: 'fixture-record-a' })])
    assert.equal(
      (await admitCollectionJob({ ...fixture.input, selected_record_ids: selection }, fixture))
        .code,
      'JSON_ARRAY_NOT_DENSE'
    );
  for (const selection of [
    Object.defineProperty(['fixture-record-a'], 'secret', { value: 'hidden' }),
    Object.defineProperty(['fixture-record-a'], '0', { set() {}, enumerable: true }),
    Object.assign(new (class extends Array {})(), 'fixture-record-a')
  ])
    assert.equal(
      (await admitCollectionJob({ ...fixture.input, selected_record_ids: selection }, fixture))
        .kind,
      'blocked'
    );
});
test('C8 codec retains Maps, undefined and referenced bytes; unsupported types fail', async () => {
  const objects = new Map();
  const value = {
    map: new Map([
      ['second', undefined],
      ['first', new Uint8Array([1, 2, 3])]
    ])
  };
  const encoded = await encodeLocalValue(value, async (bytes) => {
    const hash = sha256(bytes);
    objects.set(hash, bytes);
    return { sha256: hash, byte_length: bytes.length };
  });
  assert.deepEqual(await decodeLocalValue(encoded, (hash) => objects.get(hash)), value);
  assert.notEqual(await valueDigest(value), await valueDigest({ map: {} }));
  await assert.rejects(
    encodeLocalValue(new Uint8Array([1]), async () => ({ sha256: 'f'.repeat(64), byte_length: 1 })),
    { code: 'BYTES_REFERENCE_INVALID' }
  );
  await assert.rejects(
    decodeLocalValue(encoded, () => new Uint8Array([9, 9, 9])),
    { code: 'BYTES_REFERENCE_HASH' }
  );
  for (const invalid of [
    { secret: 'x' },
    { body: 'data' },
    { x: () => {} },
    new (class extends Map {})(),
    new (class extends Array {})(),
    new (class extends Uint8Array {})(1),
    Object.assign(new Uint8Array([1]), { extra: true }),
    Object.defineProperty({}, 'x', { set() {}, enumerable: true })
  ])
    await assert.rejects(encodeLocalValue(invalid));
});
test('D1 actual collector composes two durable pages, strict receipts and selected fixture completion', async (t) => {
  const directory = await stateDir(t),
    deliveries = [];
  const app = await createLocalCollector({
    stateDir: directory,
    onDelivery: (request) => {
      const clients = app.inspect().scheduler.clientLifecycle;
      assert.ok(clients.length > 0);
      assert.ok(clients.every((client) => client.closed));
      deliveries.push(request);
    }
  });
  t.after(() => app.close());
  const admitted = await app.admit();
  assert.equal(admitted.kind, 'admitted');
  assert.equal(app.status(admitted.job.collection_job_id).status, 'selected');
  const outcome = await app.execute(admitted.job.collection_job_id);
  assert.equal(outcome.status, 'complete_fixture', JSON.stringify(outcome));
  assert.equal(deliveries.length, 2);
  assert.equal(outcome.checkpoint.state, 'committed');
  assert.equal(outcome.publication_authorized, false);
  assert.equal(app.store.byKind('wrapper_outcome').length, 2);
  assert.ok(
    app.store
      .byKind('wrapper_outcome')
      .every(
        (record) =>
          record.result.legacy.status === 'captured' &&
          record.result.receipt.attempt_outcome === 'captured'
      )
  );
  const before = await valueDigest(app.inspect().repositories);
  await app.close();
  const replay = await createLocalCollector({
    stateDir: directory,
    onDelivery: () => assert.fail('replay delivered')
  });
  t.after(() => replay.close());
  assert.equal(replay.status(admitted.job.collection_job_id).status, 'complete_fixture');
  assert.equal(await valueDigest(replay.inspect().repositories), before);
  assert.deepEqual(await replay.execute(admitted.job.collection_job_id), outcome);
});

import { spawn, spawnSync } from 'node:child_process';
import { LocalCollectionStore } from '../../packages/ingestion/src/local-collection-store.mjs';
import { createExactCaptureBridge } from '../../packages/ingestion/src/local-collector-adapter.mjs';
import { capture } from '../../scripts/research/refresh.mjs';
const storeModule = new URL(
  '../../packages/ingestion/src/local-collection-store.mjs',
  import.meta.url
).href;
const storePins = { format: 'bounded-store-regression.v1', source_sha256: 'a'.repeat(64) };
function storeProcess(directory, mode = 'inspect') {
  const code = `import {LocalCollectionStore} from ${JSON.stringify(storeModule)};try{const store=await LocalCollectionStore.open(${JSON.stringify(directory)},{pins:${JSON.stringify(storePins)}});console.log(JSON.stringify({status:'open',records:store.records.length}));if(${JSON.stringify(mode)}==='hold')process.stdin.resume();else await store.close();}catch(error){console.log(JSON.stringify({status:'blocked',code:error.code}));process.exitCode=2;}`;
  return spawn(process.execPath, ['--input-type=module', '-e', code], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
}
async function firstLine(child) {
  return new Promise((resolve, reject) => {
    let data = '';
    const timer = setTimeout(() => reject(Error('child readiness deadline')), 5000);
    child.stdout.on('data', (chunk) => {
      data += chunk;
      if (data.includes('\n')) {
        clearTimeout(timer);
        resolve(JSON.parse(data.split('\n')[0]));
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      if (!data) {
        clearTimeout(timer);
        reject(Error('child exited ' + code));
      }
    });
  });
}
async function exited(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => child.once('exit', resolve));
}
test('D9 two writer processes exclude one another; SIGKILL releases the actual writer lock', async (t) => {
  const directory = await stateDir(t);
  const first = storeProcess(directory, 'hold');
  t.after(() => first.kill('SIGKILL'));
  assert.equal((await firstLine(first)).status, 'open');
  const second = storeProcess(directory);
  assert.deepEqual(await firstLine(second), { status: 'blocked', code: 'WRITER_BUSY' });
  await exited(second);
  assert.equal(second.exitCode, 2);
  first.kill('SIGKILL');
  await exited(first);
  const third = storeProcess(directory);
  assert.equal((await firstLine(third)).status, 'open');
  await exited(third);
  assert.equal(third.exitCode, 0);
  assert.ok((await fs.stat(path.join(directory, '.writer.lock'))).isFile());
});
test('D8 object writes serialize accounting and close retains authority until in-flight sync finishes', async (t) => {
  const directory = await stateDir(t);
  let release, entered;
  const barrier = new Promise((resolve) => {
      release = resolve;
    }),
    ready = new Promise((resolve) => {
      entered = resolve;
    });
  const store = await LocalCollectionStore.open(directory, {
    pins: storePins,
    fault: async (point, detail) => {
      if (point === 'after_file_sync' && detail.folder === 'objects') {
        entered();
        await barrier;
      }
    }
  });
  const bytes = new Uint8Array([1, 2, 3]),
    put = store.putObject(bytes);
  await ready;
  let closed = false;
  const closing = store.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  const contender = storeProcess(directory);
  assert.equal((await firstLine(contender)).code, 'WRITER_BUSY');
  await exited(contender);
  release();
  await put;
  await closing;
  const reopened = await LocalCollectionStore.open(directory, { pins: storePins });
  t.after(() => reopened.close());
  assert.equal(reopened.objectBytes, 3);
  await Promise.all([reopened.putObject(bytes), reopened.putObject(bytes)]);
  assert.equal(reopened.objectBytes, 3);
  const writes = await Promise.allSettled(
    Array.from({ length: 33 }, (_, index) => {
      const data = new Uint8Array(262144);
      data[0] = index;
      return reopened.putObject(data);
    })
  );
  assert.equal(writes.filter((result) => result.status === 'fulfilled').length, 31);
  assert.ok(reopened.objectBytes <= 8388608);
});
test('D7/D8 replay rejects noncanonical records, wrong pins, missing objects and malformed value tags', async (t) => {
  for (const corruption of ['whitespace', 'pins', 'missing-object', 'unknown-tag', 'overlong-id']) {
    const directory = await stateDir(t);
    const store = await LocalCollectionStore.open(directory, { pins: storePins });
    await store.record(
      'response',
      'response:test',
      { value: new Uint8Array([3, 4, 5]) },
      new Map([['one', undefined]])
    );
    await store.close();
    const file = path.join(directory, 'journal', '00000002.json'),
      record = JSON.parse(await fs.readFile(file));
    if (corruption === 'whitespace') await fs.writeFile(file, JSON.stringify(record, null, 2));
    if (corruption === 'missing-object')
      await fs.unlink(path.join(directory, 'objects', sha256(new Uint8Array([3, 4, 5]))));
    if (corruption === 'unknown-tag') {
      record.result = { t: 'unsupported', v: [] };
      record.result_digest = sha256(canonicalJson(record.result));
      await fs.writeFile(file, canonicalJson(record));
    }
    if (corruption === 'overlong-id') {
      record.operation_id = 'x'.repeat(513);
      await fs.writeFile(file, canonicalJson(record));
    }
    await assert.rejects(
      LocalCollectionStore.open(directory, {
        pins: corruption === 'pins' ? { ...storePins, source_sha256: 'b'.repeat(64) } : storePins
      }),
      {
        code: {
          whitespace: 'JOURNAL_NONCANONICAL',
          pins: 'STATE_PIN_MISMATCH',
          'missing-object': 'ENOENT',
          'unknown-tag': 'VALUE_TAG_UNSUPPORTED',
          'overlong-id': 'JOURNAL_OPERATION_INVALID'
        }[corruption]
      }
    );
  }
});
test('L4 bridge and capture guards independently enforce the exact compiled locator', async () => {
  const fixture = await loadFixtureCatalog();
  const compiled = compileManifestRequest(
    fixture.descriptor,
    (await admitCollectionJob(fixture.input, fixture)).job.initial_request
  );
  let calls = 0;
  const bridge = createExactCaptureBridge({
    compiled,
    timeoutMs: 100,
    execute: async () => {
      calls++;
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        bodyBytes: new Uint8Array(Buffer.from('{}'))
      };
    }
  });
  for (const url of [
    compiled.url.href + '?cursor=other',
    compiled.url.href + '#',
    compiled.url.href + '/other'
  ])
    await assert.rejects(
      bridge(url, { redirect: 'manual', signal: new AbortController().signal }),
      { code: 'BRIDGE_LOCATOR_MISMATCH' }
    );
  assert.equal(
    (await capture(compiled.url.href, { fetchImpl: bridge, locatorPolicy: () => null })).status,
    'blocked_locator'
  );
  assert.equal(calls, 0);
  assert.equal(
    (await capture(compiled.url.href, { fetchImpl: bridge, locatorPolicy: (url) => url })).status,
    'captured'
  );
  assert.equal(calls, 1);
});
test('L6 bridge cancellation fences a signal-ignoring completion and constructs null-body 304', async () => {
  const fixture = await loadFixtureCatalog();
  const compiled = compileManifestRequest(
    fixture.descriptor,
    (await admitCollectionJob(fixture.input, fixture)).job.initial_request
  );
  let release,
    late = false;
  const bridge = createExactCaptureBridge({
    compiled,
    timeoutMs: 10,
    execute: async (fence) => {
      await new Promise((resolve) => {
        release = resolve;
      });
      fence.assert();
      late = true;
      return { status: 200, headers: {}, bodyBytes: new Uint8Array() };
    }
  });
  const start = Date.now();
  await assert.rejects(
    bridge(compiled.url.href, { redirect: 'manual', signal: new AbortController().signal }),
    { code: 'BRIDGE_CANCELLED' }
  );
  assert.ok(Date.now() - start < 1000);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(late, false);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(bridge(compiled.url.href, { redirect: 'manual', signal: aborted.signal }), {
    code: 'BRIDGE_CANCELLED'
  });
  const reuse = createExactCaptureBridge({
    compiled,
    timeoutMs: 100,
    execute: async () => ({
      status: 304,
      headers: { 'content-type': 'application/json' },
      bodyBytes: new Uint8Array()
    })
  });
  const result = await capture(compiled.url.href, {
    fetchImpl: reuse,
    locatorPolicy: (url) => url
  });
  assert.equal(result.status, 'http_failed');
  assert.equal(result.http_status, 304);
  assert.equal(result.bytes, 0);
});

const lifecycleModule = new URL('./job-lifecycle.test.mjs', import.meta.url);
async function jobProcess(directory, options = {}) {
  const child = spawn(process.execPath, [lifecycleModule.pathname], {
    env: { ...process.env, USHSO_JOB_WORKER: JSON.stringify({ directory, ...options }) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (bytes) => {
    stdout += bytes;
  });
  child.stderr.on('data', (bytes) => {
    stderr += bytes;
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  await exited(child);
  clearTimeout(timer);
  return {
    code: child.exitCode,
    signal: child.signalCode,
    stdout,
    stderr,
    result: stdout.trim() ? JSON.parse(stdout.trim().split('\n').at(-1)) : null
  };
}
async function deliveriesAt(directory) {
  try {
    return (await fs.readFile(path.join(directory, 'delivery-counter.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
for (const [group, point, kind, nth] of [
  ['D2/C3', 'runner.after_fetch_before_page_commit', null, 1],
  ['D3', 'runner.after_page_commit_before_resume', null, 1],
  ['D4 response', 'after_record_commit', 'response', 1],
  ['D4 object', 'capture.after_object_write_before_reference_commit', null, 1],
  ['C4 reference', 'after_record_commit', 'capture_reference', 1],
  ['D6 seal', 'runner.after_seal_before_checkpoint_commit', null, 1],
  ['D6 final', 'runner.after_checkpoint_transaction', null, 1],
  ['C6 parent', 'after_record_commit', 'scheduler_transaction', 2],
  ['C6 lease', 'after_record_commit', 'scheduler_transaction', 1]
])
  test(
    group + ' actual process death resumes one attempt without duplicate fixture delivery',
    async (t) => {
      const directory = await stateDir(t);
      const killed = await jobProcess(directory, { point, kind, nth });
      assert.equal(killed.signal, 'SIGKILL', JSON.stringify(killed));
      const prefix = await createLocalCollector({ stateDir: directory, readOnly: true });
      const child = [...prefix.inspect().children.values()][0];
      const state = prefix.status(child.collection_job_id);
      assert.notEqual(state.status, 'complete_fixture');
      await prefix.close();
      const resumed = await jobProcess(directory);
      assert.equal(resumed.code, 0, JSON.stringify(resumed));
      assert.equal(resumed.result.outcome.status, 'complete_fixture');
      assert.equal(resumed.result.outcomes, 1);
      assert.equal(resumed.result.attempts, 1);
      assert.equal(resumed.result.parents, 1);
      assert.equal(resumed.result.parent_outboxes, 1);
      const deliveries = await deliveriesAt(directory);
      assert.equal(deliveries.length, 2);
      assert.deepEqual(
        deliveries.map((row) => row.ordinal),
        [0, 1]
      );
      assert.equal(resumed.result.captures.length, 2);
      assert.equal(new Set(resumed.result.captures).size, 2);
      const repeat = await jobProcess(directory);
      assert.equal(repeat.code, 0, JSON.stringify(repeat));
      assert.equal(repeat.result.projection_digest, resumed.result.projection_digest);
      assert.equal(repeat.result.outcomes, 1);
      assert.equal((await deliveriesAt(directory)).length, 2);
    }
  );
test('D5/C9/L5 unknown delivery is charged and terminal unresolved across fresh processes', async (t) => {
  const directory = await stateDir(t);
  const killed = await jobProcess(directory, { point: 'after_fixture_delivery', nth: 1 });
  assert.equal(killed.signal, 'SIGKILL', JSON.stringify(killed));
  assert.equal((await deliveriesAt(directory)).length, 1);
  const resumed = await jobProcess(directory);
  assert.equal(resumed.code, 0, JSON.stringify(resumed));
  assert.equal(resumed.result.outcome.status, 'partial_unresolved');
  assert.equal(resumed.result.outcomes, 1);
  assert.equal(resumed.result.requests, 1);
  assert.equal(resumed.result.captures.length, 0);
  const again = await jobProcess(directory);
  assert.equal(again.result.outcome.status, 'partial_unresolved');
  assert.equal(again.result.requests, 1);
  assert.equal((await deliveriesAt(directory)).length, 1);
});
test('C7 aborted multi-call scheduler transaction has no journal record and poisons every client', async (t) => {
  const directory = await stateDir(t),
    app = await createLocalCollector({ stateDir: directory });
  t.after(() => app.close());
  const existing = await app.openDatabase(),
    second = await app.openDatabase();
  const prior = app.store.records.length;
  await assert.rejects(
    existing.transaction('scheduler-lease-due', async (tx) => {
      await tx.leaseDueSources({
        scheduledSlot: '2026-09-12T00:00:00.000Z',
        leaseOwner: 'scheduler_test',
        leaseExpiresAt: '2026-09-12T00:01:00.000Z',
        limit: 1
      });
      await tx.leaseDueSources({
        scheduledSlot: '2026-09-12T00:00:00.000Z',
        leaseOwner: 'scheduler_test',
        leaseExpiresAt: '2026-09-12T00:01:00.000Z',
        limit: 1
      });
      throw Error('controlled failure after two buffered calls');
    })
  );
  assert.equal(app.store.records.length, prior);
  assert.equal(app.store.poisoned, true);
  await assert.rejects(
    second.transaction('scheduler-lease-due', () => null),
    { code: 'LOCAL_STORE_POISONED' }
  );
  await assert.rejects(app.openDatabase(), { code: 'LOCAL_STORE_POISONED' });
  assert.throws(() => app.inspect(), { code: 'LOCAL_STORE_POISONED' });
  await existing.close();
  await second.close();
  await app.close();
  const replay = await createLocalCollector({ stateDir: directory });
  t.after(() => replay.close());
  assert.equal(replay.inspect().scheduler.runs.size, 0);
});
test('C7/D8 scheduler disk failure blocks its fresh failure handler and all delivery', async (t) => {
  const directory = await stateDir(t);
  let transactions = 0,
    deliveries = 0;
  const app = await createLocalCollector({
    stateDir: directory,
    onDelivery: () => deliveries++,
    fault: (point, detail) => {
      if (
        point === 'after_record_commit' &&
        detail.kind === 'scheduler_transaction' &&
        ++transactions === 2
      )
        throw Error('controlled commit response failure');
    }
  });
  t.after(() => app.close());
  const job = (await app.admit()).job;
  await assert.rejects(app.execute(job.collection_job_id), { code: 'LOCAL_STORE_POISONED' });
  assert.equal(deliveries, 0);
  assert.equal(app.store.records.filter((row) => row.kind === 'scheduler_transaction').length, 2);
  await assert.rejects(app.openDatabase(), { code: 'LOCAL_STORE_POISONED' });
  await app.close();
  const recovered = await createLocalCollector({ stateDir: directory });
  t.after(() => recovered.close());
  assert.equal(recovered.inspect().scheduler.runs.size, 1);
  assert.equal(recovered.status(job.collection_job_id).status, 'selected');
});

test('C5/L7 independent child repositories share one durable parent and keep selected outcomes separate', async (t) => {
  const directory = await stateDir(t),
    fixture = await loadFixtureCatalog(),
    app = await createLocalCollector({ stateDir: directory });
  t.after(() => app.close());
  const first = (await app.admit({ ...fixture.input, selected_record_ids: ['fixture-record-a'] }))
      .job,
    second = (await app.admit({ ...fixture.input, selected_record_ids: ['fixture-record-b'] })).job;
  assert.equal(first.parent_run_id, second.parent_run_id);
  assert.notEqual(first.execution_run_id, second.execution_run_id);
  const one = await app.execute(first.collection_job_id),
    two = await app.execute(second.collection_job_id);
  assert.equal(one.status, 'complete_fixture', JSON.stringify(one));
  assert.equal(two.status, 'complete_fixture', JSON.stringify(two));
  assert.deepEqual(one.selected_records, [
    { record_id: 'fixture-record-a', status: 'observed_fixture' }
  ]);
  assert.deepEqual(two.selected_records, [
    { record_id: 'fixture-record-b', status: 'observed_fixture' }
  ]);
  const snapshot = app.inspect();
  assert.equal(snapshot.scheduler.runs.size, 1);
  assert.equal(snapshot.scheduler.outbox.size, 1);
  assert.equal(snapshot.repositories.size, 2);
  assert.notEqual(one.checkpoint.checkpoint_id, two.checkpoint.checkpoint_id);
  assert.equal(app.store.byKind('child_admitted').length, 2);
  const clocks = app.store
    .byKind('request_intent')
    .map((row) => Date.parse(row.payload.observed_at));
  assert.deepEqual(
    clocks.map((time, index) => time - clocks[0]),
    [0, 1000, 2000, 3000]
  );
  const digest = await valueDigest(snapshot.repositories);
  await app.close();
  const reload = await createLocalCollector({ stateDir: directory });
  t.after(() => reload.close());
  assert.equal(await valueDigest(reload.inspect().repositories), digest);
  assert.deepEqual(await reload.execute(first.collection_job_id), one);
  assert.deepEqual(await reload.execute(second.collection_job_id), two);
});
test('D10/C10 actual collector 304 retains legacy limitation and prior capture provenance', async (t) => {
  const directory = await stateDir(t),
    fixture = await loadFixtureCatalog();
  const app = await createLocalCollector({
    stateDir: directory,
    responseFor: ({ request, response }) =>
      request.headers.has('if-none-match')
        ? { ...response, status: 304, bodyBytes: new Uint8Array() }
        : response
  });
  t.after(() => app.close());
  const prior = (await app.admit()).job;
  assert.equal((await app.execute(prior.collection_job_id)).status, 'complete_fixture');
  const child = (await app.admit({ ...fixture.input, selected_record_ids: ['fixture-record-a'] }))
    .job;
  await app.seedFixtureReuse({
    childId: child.collection_job_id,
    priorChildId: prior.collection_job_id
  });
  const outcome = await app.execute(child.collection_job_id);
  assert.equal(outcome.status, 'complete_fixture', JSON.stringify(outcome));
  assert.equal(app.store.byKind('capture_reference').length, 2);
  const wrappers = app.store
    .byKind('wrapper_outcome')
    .filter((row) => row.payload.child_id === child.collection_job_id);
  assert.equal(wrappers.length, 2);
  for (const row of wrappers) {
    assert.equal(row.result.legacy.status, 'http_failed');
    assert.equal(row.result.legacy.http_status, 304);
    assert.equal(row.result.legacy.bytes, 0);
    assert.equal(row.result.strict.outcome, 'not_modified');
    assert.equal(
      row.result.receipt.underlying_records.capture_reference.run_id,
      prior.execution_run_id
    );
    assert.equal(
      row.result.receipt.underlying_records.metadata_fetch.run_id,
      child.execution_run_id
    );
    assert.equal(row.result.receipt.observed_bytes, 0);
  }
  await app.close();
  const replay = await createLocalCollector({ stateDir: directory });
  t.after(() => replay.close());
  assert.equal(replay.status(child.collection_job_id).status, 'complete_fixture');
});
test('C1/D10 invalid UTF8, oversized response and missing selected evidence cannot commit a checkpoint', async (t) => {
  for (const mode of ['invalid-utf8', 'oversized', 'missing-selected', 'empty-catalog']) {
    const directory = await stateDir(t);
    const app = await createLocalCollector({
      stateDir: directory,
      responseFor: ({ response, ordinal }) => ({
        ...response,
        bodyBytes:
          mode === 'invalid-utf8'
            ? new Uint8Array([255])
            : mode === 'oversized'
              ? new Uint8Array(4097)
              : new Uint8Array(
                  Buffer.from(
                    canonicalJson({
                      dataset:
                        mode === 'empty-catalog'
                          ? []
                          : [
                              {
                                identifier: 'fixture-unselected',
                                title: 'Unselected',
                                modified: '2026-09-11T00:00:00.000Z'
                              }
                            ],
                      ...(ordinal === 0 ? { next_cursor: 'page-2' } : {})
                    })
                  )
                )
      })
    });
    const job = (await app.admit()).job;
    const outcome = await app.execute(job.collection_job_id);
    assert.equal(outcome.status, 'typed_failure', mode + JSON.stringify(outcome));
    if (mode === 'missing-selected')
      assert.equal(outcome.failure.safe_detail_code, 'SELECTED_RECORD_NOT_OBSERVED');
    if (mode === 'empty-catalog') {
      assert.equal(outcome.failure.safe_detail_code, 'COLLECTOR_RUN_FAILED');
      assert.equal(outcome.failure.failure_type, 'internal_failure');
      assert.equal(app.store.byKind('capture_reference').length, 2);
      assert.equal(
        app.inspect().repositories.get(job.collection_job_id).runs.get(job.execution_run_id).pages
          .size,
        2
      );
    }
    assert.equal(app.inspect().repositories.get(job.collection_job_id).checkpoints.size, 0);
    await app.close();
    const replay = await createLocalCollector({
      stateDir: directory,
      onDelivery: () => assert.fail('failed attempt delivered')
    });
    assert.equal((await replay.execute(job.collection_job_id)).status, 'typed_failure');
    await replay.close();
  }
});
test('L6 actual fixture collector deadline is terminal and rejects a late transport success', async (t) => {
  const directory = await stateDir(t),
    fixture = await loadFixtureCatalog();
  fixture.input.budget_reservation.timeout_ms = 30;
  let release;
  const app = await createLocalCollector({
    stateDir: directory,
    fixture,
    responseFor: async ({ response }) => {
      await new Promise((resolve) => {
        release = resolve;
      });
      return response;
    }
  });
  t.after(() => app.close());
  const job = (await app.admit()).job;
  const outcome = await app.execute(job.collection_job_id);
  assert.equal(outcome.status, 'typed_failure', JSON.stringify(outcome));
  assert.equal(app.store.byKind('capture_reference').length, 0);
  const count = app.store.records.length;
  release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(app.store.records.length, count);
  assert.equal(app.inspect().repositories.get(job.collection_job_id).checkpoints.size, 0);
  await app.close();
  const replay = await createLocalCollector({
    stateDir: directory,
    fixture,
    onDelivery: () => assert.fail('terminal deadline retried')
  });
  t.after(() => replay.close());
  assert.equal((await replay.execute(job.collection_job_id)).status, 'typed_failure');
});

test('C8 actual existing-run Map survives fresh replay; rehashed Map-to-object tampering blocks', async (t) => {
  const directory = await stateDir(t);
  assert.equal(
    (await jobProcess(directory, { point: 'runner.after_page_commit_before_resume' })).signal,
    'SIGKILL'
  );
  assert.equal(
    (await jobProcess(directory, { point: 'runner.before_page_fetch' })).signal,
    'SIGKILL'
  );
  const app = await createLocalCollector({ stateDir: directory, readOnly: true });
  const begin = app.store
    .byKind('connector_operation')
    .filter((row) => row.payload.method === 'beginRun')
    .at(-1);
  assert.ok(begin.result.value.pages instanceof Map);
  assert.equal(begin.result.value.pages.size, 1);
  assert.equal((await deliveriesAt(directory)).length, 1);
  const sequence = begin.sequence;
  await app.close();
  const file = path.join(directory, 'journal', String(sequence).padStart(8, '0') + '.json'),
    raw = JSON.parse(await fs.readFile(file));
  const value = raw.result.v.find(([key]) => key === 'value')[1];
  value.v.find(([key]) => key === 'pages')[1] = { t: 'object', v: [] };
  raw.result_digest = sha256(canonicalJson(raw.result));
  await fs.writeFile(file, canonicalJson(raw));
  await assert.rejects(createLocalCollector({ stateDir: directory, readOnly: true }), {
    code: 'REDUCER_REPLAY_MISMATCH'
  });
});
test('B1 store rejects path escapes and symlinks; unknown fixture fails before storage', async (t) => {
  const directory = await stateDir(t),
    target = await stateDir(t);
  await fs.symlink(target, path.join(directory, 'linked'));
  await assert.rejects(
    LocalCollectionStore.open(path.join(directory, 'linked', 'state'), { pins: storePins }),
    { code: 'STATE_PATH_SYMLINK' }
  );
  assert.deepEqual(await fs.readdir(target), []);
  await assert.rejects(
    LocalCollectionStore.open(path.resolve(localScratchRoot(), '..', 'ushso-test-outside'), {
      pins: storePins
    }),
    { code: 'STATE_PATH_OUTSIDE_SCRATCH' }
  );
  await assert.rejects(loadFixtureCatalog('https://catalog.example.gov/data.json'), {
    code: 'FIXTURE_NOT_REGISTERED'
  });
});

test('B2 public and ingestion worker compositions remain disabled', async () => {
  const [{ default: scheduler }, { default: harvest }, { createWorker }] = await Promise.all([
    import('../../services/scheduler-worker/worker.mjs'),
    import('../../services/harvest-worker/worker.mjs'),
    import('../../worker/index.mjs')
  ]);
  await assert.rejects(scheduler.scheduled(), /WP4_SCHEDULER_COMPOSITION_DISABLED/);
  let retries = 0;
  const outcomes = await harvest.queue({
    messages: [{ body: { event_id: 'event_fixture' }, retry: () => retries++ }]
  });
  assert.equal(retries, 1);
  assert.equal(outcomes[0].reason, 'WP4_HARVEST_COMPOSITION_DISABLED');
  assert.equal(harvest.Workflow, null);
  const worker = createWorker();
  let assets = 0;
  for (const route of ['dictionary-review', 'scientific-review', 'scientific-conflicts']) {
    const response = await worker.fetch(new Request('https://ushso.org/api/research/v1/' + route), {
      ASSETS: {
        fetch: () => {
          assets++;
          throw Error('unconfigured assets');
        }
      }
    });
    assert.equal(response.status, 404);
    assert.match((await response.json()).error.code, /disabled$/);
  }
  assert.equal(assets, 0);
});
test('B3 journal rejects secret and inline-body fields and read-only status never observes an active writer', async (t) => {
  for (const value of [
    { authorization: 'fixture' },
    { cookie: 'fixture' },
    { token: 'fixture' },
    { body: 'fixture' },
    { text: 'fixture' },
    { x: 'Bearer ABCDEFGHIJKLMNOPQRST' }
  ])
    await assert.rejects(encodeLocalValue(value));
  const directory = await stateDir(t),
    store = await LocalCollectionStore.open(directory, { pins: storePins });
  const before = (await fs.readdir(directory)).sort();
  await assert.rejects(LocalCollectionStore.open(directory, { pins: storePins, readOnly: true }), {
    code: 'WRITER_BUSY'
  });
  assert.deepEqual((await fs.readdir(directory)).sort(), before);
  await store.close();
  const reader = await LocalCollectionStore.open(directory, { pins: storePins, readOnly: true });
  await assert.rejects(reader.record('response', 'forbidden', {}, null), {
    code: 'WRITER_LOCK_REQUIRED'
  });
  await reader.close();
  assert.deepEqual((await fs.readdir(directory)).sort(), before);
});

test('D8 failed file/directory sync leaves only a verified prefix and poisons the writer', async (t) => {
  for (const point of ['after_file_sync', 'before_directory_sync', 'after_directory_sync']) {
    const directory = await stateDir(t);
    const store = await LocalCollectionStore.open(directory, {
      pins: storePins,
      fault: (seen, detail) => {
        if (seen === point && detail.folder === 'objects')
          throw Error('controlled persistence failure');
      }
    });
    await assert.rejects(
      store.record('response', 'response:unacknowledged', {}, new Uint8Array([1, 2, 3])),
      /controlled persistence failure/
    );
    assert.equal(store.poisoned, true);
    await assert.rejects(store.record('response', 'forbidden', {}, null), {
      code: 'LOCAL_STORE_POISONED'
    });
    await store.close();
    const recovered = await LocalCollectionStore.open(directory, { pins: storePins });
    assert.equal(recovered.records.length, 1);
    assert.equal(recovered.find('response:unacknowledged'), null);
    assert.equal(recovered.objectBytes, point === 'after_file_sync' ? 0 : 3);
    await recovered.close();
  }
});
test('L5 durable reservation exhaustion retains its capture and never obtains another delivery on restart', async (t) => {
  const directory = await stateDir(t),
    fixture = await loadFixtureCatalog();
  fixture.input.budget_reservation.maximum_requests = 1;
  let deliveries = 0;
  const app = await createLocalCollector({
    stateDir: directory,
    fixture,
    onDelivery: () => deliveries++
  });
  const job = (await app.admit()).job;
  const outcome = await app.execute(job.collection_job_id);
  assert.equal(outcome.status, 'typed_failure', JSON.stringify(outcome));
  assert.equal(outcome.failure.safe_detail_code, 'RESERVATION_BOUND_EXCEEDED');
  assert.equal(deliveries, 1);
  assert.equal(app.store.byKind('request_intent').length, 1);
  assert.equal(app.store.byKind('capture_reference').length, 1);
  assert.equal(app.inspect().repositories.get(job.collection_job_id).checkpoints.size, 0);
  await app.close();
  const recovered = await createLocalCollector({
    stateDir: directory,
    fixture,
    onDelivery: () => assert.fail('exhausted reservation delivered')
  });
  assert.deepEqual(await recovered.execute(job.collection_job_id), outcome);
  assert.equal(recovered.store.byKind('request_intent').length, 1);
  await recovered.close();
});
async function rewriteJournal(directory, change) {
  const names = (await fs.readdir(path.join(directory, 'journal')))
    .filter((name) => name.endsWith('.json'))
    .sort();
  let previous = null;
  for (const name of names) {
    const file = path.join(directory, 'journal', name),
      raw = JSON.parse(await fs.readFile(file));
    const payload = await decodeLocalValue(raw.payload, (hash) =>
      fs.readFile(path.join(directory, 'objects', hash))
    );
    const result = await decodeLocalValue(raw.result, (hash) =>
      fs.readFile(path.join(directory, 'objects', hash))
    );
    change(raw, payload, result);
    raw.payload = await encodeLocalValue(payload);
    raw.result = await encodeLocalValue(result);
    raw.result_digest = sha256(canonicalJson(raw.result));
    raw.previous_record_sha256 = previous;
    const bytes = Buffer.from(canonicalJson(raw));
    previous = sha256(bytes);
    await fs.writeFile(file, bytes);
  }
}
test('D7/L7 canonically rehashed capture, wrapper, child and terminal tampering fails semantic replay', async (t) => {
  const base = await stateDir(t),
    fixture = await loadFixtureCatalog(),
    app = await createLocalCollector({ stateDir: base });
  const one = (await app.admit()).job,
    two = (await app.admit({ ...fixture.input, selected_record_ids: ['fixture-record-b'] })).job;
  assert.equal((await app.execute(one.collection_job_id)).status, 'complete_fixture');
  assert.equal((await app.execute(two.collection_job_id)).status, 'complete_fixture');
  await app.close();
  const cases = [
    [
      'capture-source',
      'CROSS_CHILD_CAPTURE',
      (raw, payload, result) => {
        if (raw.kind === 'capture_reference') result.source_id = 'source_fixture_other';
      }
    ],
    [
      'legacy-hash',
      'LEGACY_CAPTURE_MISMATCH',
      (raw, payload, result) => {
        if (raw.kind === 'wrapper_outcome') result.legacy.sha256 = 'f'.repeat(64);
      }
    ],
    [
      'receipt',
      'RECEIPT_TAMPERED',
      (raw, payload, result) => {
        if (raw.kind === 'wrapper_outcome') result.receipt.descriptor_hash.sha256 = 'f'.repeat(64);
      }
    ],
    [
      'child',
      'CROSS_CHILD_REPLAY',
      (raw, payload) => {
        if (raw.kind === 'connector_operation' && payload.child_id === one.collection_job_id)
          payload.child_id = two.collection_job_id;
      }
    ],
    [
      'terminal',
      'ATTEMPT_RESULT_MISMATCH',
      (raw, payload, result) => {
        if (raw.kind === 'attempt_outcome')
          result.selected_records[0].record_id = 'fixture-record-wrong';
      }
    ],
    [
      'request',
      'REQUEST_KEY_MISMATCH',
      (raw, payload) => {
        if (raw.kind === 'request_intent') payload.request.query = { cursor: 'wrong' };
      }
    ]
  ];
  for (const [name, code, change] of cases) {
    const directory = await stateDir(t);
    for (const entry of await fs.readdir(base))
      await fs.cp(path.join(base, entry), path.join(directory, entry), { recursive: true });
    await rewriteJournal(directory, change);
    await assert.rejects(
      createLocalCollector({ stateDir: directory, readOnly: true }),
      { code },
      name
    );
  }
});

test('C1 actual collector rejects bridge bytes that differ from the committed strict capture', async (t) => {
  const directory = await stateDir(t);
  let app,
    changed = false;
  app = await createLocalCollector({
    stateDir: directory,
    fault: (point, detail) => {
      if (!changed && point === 'after_record_commit' && detail.kind === 'strict_outcome') {
        changed = true;
        const response = app.store.byKind('response').at(-1);
        response.result.bodyBytes[0] = 91;
      }
    }
  });
  t.after(() => app.close());
  const job = (await app.admit()).job;
  const outcome = await app.execute(job.collection_job_id);
  assert.equal(changed, true);
  assert.equal(outcome.status, 'typed_failure', JSON.stringify(outcome));
  assert.equal(outcome.failure.safe_detail_code, 'COLLECTOR_CAPTURE_MISMATCH');
  assert.equal(app.store.byKind('capture_reference').length, 1);
  assert.equal(app.store.byKind('wrapper_outcome').length, 0);
  assert.equal(app.inspect().repositories.get(job.collection_job_id).checkpoints.size, 0);
  await app.close();
  const replay = await createLocalCollector({
    stateDir: directory,
    onDelivery: () => assert.fail('failed collector comparison retried')
  });
  t.after(() => replay.close());
  assert.equal((await replay.execute(job.collection_job_id)).status, 'typed_failure');
});

if (workerOptions) {
  let app;
  try {
    let matched = 0;
    globalThis.fetch = () => {
      throw Error('LIVE_FETCH_FORBIDDEN');
    };
    app = await createLocalCollector({
      stateDir: workerOptions.directory,
      fault: (point, detail) => {
        if (
          point === workerOptions.point &&
          (!workerOptions.kind || detail.kind === workerOptions.kind) &&
          ++matched === (workerOptions.nth ?? 1)
        )
          process.kill(process.pid, 'SIGKILL');
      },
      onDelivery: async (row) => {
        const file = await fs.open(
          path.join(workerOptions.directory, 'delivery-counter.jsonl'),
          'a'
        );
        try {
          await file.writeFile(JSON.stringify(row) + '\n');
          await file.sync();
        } finally {
          await file.close();
        }
      }
    });
    const admitted = await app.admit();
    const outcome = await app.execute(admitted.job.collection_job_id);
    const inspected = app.inspect();
    console.log(
      JSON.stringify({
        outcome,
        outcomes: app.store.byKind('attempt_outcome').length,
        attempts: app.store.byKind('attempt_started').length,
        requests: app.store.byKind('request_intent').length,
        captures: app.store.byKind('capture_reference').map((row) => row.result.capture_ref_id),
        parents: inspected.scheduler.runs.size,
        parent_outboxes: inspected.scheduler.outbox.size,
        projection_digest: await valueDigest(inspected.repositories)
      })
    );
  } catch (error) {
    console.log(JSON.stringify({ status: 'blocked', code: error.code ?? error.name }));
    process.exitCode = 2;
  } finally {
    await app?.close();
  }
}
