import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256, deterministicId } from '../../connectors/src/canonical.mjs';
import { compileManifestRequest } from '../../connectors/src/route-manifest.mjs';
import { assertPinnedTransportRequest } from '../../connectors/src/pinned-streaming-transport.mjs';
import { BoundedHttpClient } from '../../connectors/src/bounded-http-client.mjs';
import { R2CaptureProtocol } from '../../connectors/src/capture-protocol.mjs';
import { MemoryOriginGovernor } from '../../connectors/src/origin-governor.mjs';
import {
  MemoryRunRepository,
  FixtureDnsResolver
} from '../../connectors/src/testing/memory-ports.mjs';
import { DcatDataJsonConnector } from '../../connectors/src/adapters/dcat-data-json.mjs';
import { DeterministicConnectorRunner, connectorRequestKey } from '../../connectors/src/runner.mjs';
import { validateIngestionRecord } from '../../../contracts/ingestion/v1.0.0/tools/index.mjs';
import { loadSchemas } from '../../../contracts/ingestion/v1.0.0/tools/schema.mjs';
import { composeEvidenceReceipt } from '../../../scripts/research-program/operating-bounds.mjs';
import { capture } from '../../../scripts/research/refresh.mjs';
import { createInMemoryControlPlane } from './in-memory-control-plane.mjs';
import { createScheduler } from './scheduler.mjs';
import { PORT_METHODS } from './ports.mjs';
import {
  admitCollectionJob,
  DESCRIPTOR_HASH_BASIS,
  LocalCollectionError,
  requireLocal,
  blocked,
  exactKeys
} from './collection-job.mjs';
import { LocalCollectionStore, valueDigest } from './local-collection-store.mjs';
import { loadFixtureCatalog, FIXTURE_CLOCK, JOURNAL_BOUNDS } from './local-fixture-catalog.mjs';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const TX_METHODS = new Set([
  'leaseDueSources',
  'ensureRunAndWorkflowOutbox',
  'recordScheduleDispatchFailure'
]);
const MUTATIONS = new Set([
  'beginRun',
  'commitPage',
  'failRun',
  'sealEnumeration',
  'commitMembershipAndCheckpoint',
  'setConditional',
  'seedReusableCapture'
]);
const READS = new Set(['conditionalFor', 'getResume', 'getCommittedPage', 'reuseCapturePage']);
const TERMINALS = new Set(['complete_fixture', 'typed_failure', 'partial_unresolved']);
const copy = (value) => structuredClone(value);
const strictStored = ({ parsed, ...result }) => result;
const strictRestored = (result) =>
  result.outcome === 'captured'
    ? { ...copy(result), parsed: JSON.parse(Buffer.from(result.bodyBytes).toString('utf8')) }
    : copy(result);
const childOf = (record) => record.payload.child_id;

/** Pin the executed relative-import closure and dynamically loaded schemas/data. */
export async function localRuntimePins(fixture) {
  const paths = new Set();
  async function visit(relative) {
    if (paths.has(relative)) return;
    paths.add(relative);
    const source = await fs.readFile(path.join(REPO, relative), 'utf8');
    if (!relative.endsWith('.mjs')) return;
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
      const next = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]));
      requireLocal(!next.startsWith('../'), 'RUNTIME_IMPORT_ESCAPE');
      await visit(next);
    }
  }
  await visit('packages/ingestion/src/local-collector-adapter.mjs');
  let cliPresent = false;
  try {
    await fs.access(path.join(REPO, 'packages/ingestion/src/local-job-cli.mjs'));
    cliPresent = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (cliPresent) await visit('packages/ingestion/src/local-job-cli.mjs');
  for (const version of ['v1.0.0', 'v1.1.0'])
    for (const file of await fs.readdir(path.join(REPO, 'contracts/ingestion', version, 'schemas')))
      if (file.endsWith('.json')) paths.add(`contracts/ingestion/${version}/schemas/${file}`);
  for (const relative of [
    'package-lock.json',
    'scripts/research-program/policy.json',
    'scripts/research-program/receipts/v1.0.0/evidence-receipt.schema.json'
  ])
    paths.add(relative);
  const source_pins = [];
  for (const relative of [...paths].sort())
    source_pins.push({
      path: relative,
      sha256: sha256(await fs.readFile(path.join(REPO, relative)))
    });
  return {
    format: 'ushso.local-runtime-pins.v1',
    source_pins,
    runtime: process.version,
    platform: process.platform,
    architecture: process.arch,
    fixture_sha256: sha256(canonicalJson(fixture.manifest)),
    registry_sha256: fixture.registrySha256,
    policy_sha256: fixture.policySha256,
    descriptor_sha256: sha256(canonicalJson(fixture.descriptor)),
    clock: {
      ...FIXTURE_CLOCK,
      observation_derivation:
        'scheduled_slot + journal-wide zero-based durable request-intent ordinal * page_spacing_ms',
      recording_derivation: 'observed_at + recorded_offset_ms'
    },
    bounds: JOURNAL_BOUNDS
  };
}

async function receiptContext() {
  const { ajv } = await loadSchemas();
  const schema = JSON.parse(
    await fs.readFile(
      path.join(REPO, 'scripts/research-program/receipts/v1.0.0/evidence-receipt.schema.json')
    )
  );
  const validate = ajv.getSchema(schema.$id) ?? ajv.compile(schema);
  return {
    validateIngestionRecord,
    validateReceiptSchema(value) {
      const valid = validate(value);
      return { valid, issues: valid ? [] : copy(validate.errors) };
    }
  };
}
async function strictRecord(name, value) {
  requireLocal((await validateIngestionRecord(name, value)).valid, 'RELEASED_RECORD_INVALID');
}
async function same(actual, expected, code = 'REDUCER_REPLAY_MISMATCH') {
  requireLocal((await valueDigest(actual)) === (await valueDigest(expected)), code);
}
function connectorProjection(repository) {
  return {
    runs: repository.runs,
    reusableCaptures: repository.reusableCaptures,
    memberships: repository.memberships,
    checkpoints: repository.checkpoints,
    conditionals: repository.conditionals
  };
}

/** Exact-locator guard independent of the collector's policy, including cursor. */
export function createExactCaptureBridge({ compiled, execute, timeoutMs }) {
  const expected = compiled.url.href;
  return async function bridge(url, options = {}) {
    requireLocal(
      typeof url === 'string' && url === expected && options.redirect === 'manual',
      'BRIDGE_LOCATOR_MISMATCH'
    );
    requireLocal(
      options.signal instanceof AbortSignal && !options.signal.aborted,
      'BRIDGE_CANCELLED'
    );
    let active = true,
      timer,
      onAbort;
    const fence = {
      assert() {
        requireLocal(active && !options.signal.aborted, 'BRIDGE_CANCELLED');
      },
      signal: options.signal
    };
    const cancelled = new Promise((_, reject) => {
      const stop = () => {
        active = false;
        reject(new LocalCollectionError('BRIDGE_CANCELLED'));
      };
      onAbort = stop;
      options.signal.addEventListener('abort', stop, { once: true });
      timer = setTimeout(stop, timeoutMs);
    });
    try {
      const result = await Promise.race([execute(fence), cancelled]);
      fence.assert();
      return new Response(result.status === 304 ? null : result.bodyBytes, {
        status: result.status,
        headers: result.headers
      });
    } finally {
      active = false;
      clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
    }
  };
}

/** Local disk is authority; these in-memory implementations are only reducers. */
export async function createLocalCollector({
  stateDir,
  fixture,
  readOnly = false,
  fault = null,
  onDelivery = null,
  responseFor = null
} = {}) {
  fixture ??= await loadFixtureCatalog();
  const admission = await admitCollectionJob(fixture.input, fixture);
  requireLocal(admission.kind === 'admitted', admission.code ?? 'ADMISSION_BLOCKED');
  const store = await LocalCollectionStore.open(stateDir, {
    pins: await localRuntimePins(fixture),
    readOnly,
    fault
  });
  const control = createInMemoryControlPlane();
  const repositories = new Map();
  const children = new Map();
  const receiptOptions = await receiptContext();
  let logicalNow = Date.parse(fixture.input.scheduled_slot),
    busy = false;
  const governor = new MemoryOriginGovernor({ clock: () => logicalNow });
  function repository(id) {
    requireLocal(children.has(id), 'CHILD_NOT_ADMITTED');
    if (!repositories.has(id)) repositories.set(id, new MemoryRunRepository());
    return repositories.get(id);
  }
  function assertChildArguments(job, method, args) {
    const runId = ['beginRun', 'commitPage', 'commitMembershipAndCheckpoint'].includes(method)
      ? args[0]?.runId
      : args[0];
    if (method !== 'seedReusableCapture' && method !== 'reuseCapturePage')
      requireLocal(runId === job.execution_run_id, 'CROSS_CHILD_EXECUTION');
    if (method === 'beginRun')
      requireLocal(
        args[0].attempt === 1 &&
          canonicalJson(args[0].descriptor) === canonicalJson(job.descriptor),
        'CHILD_CONFIGURATION_MISMATCH'
      );
    if (method === 'commitMembershipAndCheckpoint')
      requireLocal(
        job.identity.selected_record_ids.every((id) =>
          args[0]?.seal?.observations?.some((row) => row.nativeId === id)
        ),
        'SELECTED_RECORD_NOT_OBSERVED'
      );
    if (method === 'commitMembershipAndCheckpoint')
      requireLocal(
        args[0].sourceId === job.identity.source_id &&
          args[0].configurationRevision === job.identity.configuration_revision &&
          args[0].scopeId === job.identity.scope_id,
        'CHILD_CHECKPOINT_MISMATCH'
      );
  }
  function connectorFor(job) {
    return new DcatDataJsonConnector({
      descriptor: job.descriptor,
      endpointId: job.identity.endpoint_id,
      templateId: job.identity.template_id
    });
  }
  async function reduceConnector(job, method, args) {
    requireLocal(MUTATIONS.has(method), 'CONNECTOR_METHOD_UNSUPPORTED');
    assertChildArguments(job, method, args);
    if (method === 'beginRun') {
      requireLocal(args[0].checkpoint === null, 'LOCAL_PRIOR_CHECKPOINT_UNSUPPORTED');
      await same(
        args[0].plan,
        await connectorFor(job).plan(null, {
          scheduledSlot: job.identity.scheduled_slot,
          mode: job.identity.mode,
          createdAt: job.identity.scheduled_slot
        }),
        'HARVEST_PLAN_MISMATCH'
      );
    }
    if (method === 'commitPage') {
      requireLocal(
        args[0].pageKey === connectorRequestKey(args[0].request),
        'PAGE_REQUEST_KEY_MISMATCH'
      );
      const wrapper = store.find(`wrapper:${job.collection_job_id}:${args[0].pageKey}`);
      requireLocal(wrapper, 'PAGE_WRAPPER_NOT_DURABLE');
      await same(args[0].fetch, wrapper.result.strict, 'PAGE_FETCH_MISMATCH');
      const intent = store.find(`intent:${job.collection_job_id}:${args[0].pageKey}`);
      requireLocal(args[0].pageIndex === intent?.payload.page_ordinal, 'PAGE_ORDINAL_MISMATCH');
      const fetch = args[0].fetch;
      const ref =
        fetch.capture ??
        store.find(`capture:${fetch.metadataFetch?.reused_capture_ref_id}`)?.result;
      requireLocal(ref && ref.source_id === job.identity.source_id, 'PAGE_CAPTURE_MISSING');
      if (fetch.capture) requireLocal(ref.run_id === job.execution_run_id, 'CROSS_CHILD_CAPTURE');
      requireLocal(store.find(`capture:${ref.capture_ref_id}`), 'PAGE_CAPTURE_NOT_DURABLE');
      const parsedPage =
        fetch.outcome === 'not_modified'
          ? await repository(job.collection_job_id).reuseCapturePage(ref.capture_ref_id)
          : connectorFor(job).parsePage({ ...strictRestored(fetch), request: args[0].request });
      await same(
        {
          observations: args[0].observations,
          nextRequest: args[0].nextRequest,
          cursor: args[0].cursor
        },
        parsedPage,
        'PAGE_PARSER_REPLAY_MISMATCH'
      );
    }
    if (method === 'commitMembershipAndCheckpoint') {
      const run = repository(job.collection_job_id).runs.get(job.execution_run_id);
      await same(args[0].seal, run?.seal, 'CHECKPOINT_SEAL_MISMATCH');
      requireLocal(
        args[0].priorCheckpoint === null && args[0].mode === job.identity.mode,
        'CHECKPOINT_CONTEXT_MISMATCH'
      );
      const seal = args[0].seal;
      const proposal = connectorFor(job).proposeCheckpoint({
        sealed: true,
        failure: null,
        cursorExpired: false,
        items: seal.observations,
        committedCursorRefId: seal.committedCursorRefId,
        fullEnumerationSequence: seal.fullEnumerationSequence
      });
      await same(args[0].proposal, proposal, 'CHECKPOINT_PROPOSAL_MISMATCH');
      await same(
        args[0].downstreamEffects,
        seal.observations.map((observation) => ({
          eventId: deterministicId('event', {
            runId: job.execution_run_id,
            nativeId: observation.nativeId,
            revision: observation.sourceRevision
          }),
          eventType: 'normalize_record_requested',
          captureRefId: observation.sourceLocator.captureRefId,
          discoveryKey: `${job.identity.source_id}\u0000${job.descriptor.native_identifier.namespace}\u0000${observation.nativeId}`
        })),
        'DOWNSTREAM_INTENT_MISMATCH'
      );
    }
    if (method === 'seedReusableCapture') {
      const reference = store.find(`capture:${args[0]}`);
      const priorId = reference?.payload.child_id;
      requireLocal(
        priorId &&
          priorId !== job.collection_job_id &&
          store.find(`outcome:${priorId}`)?.result.status === 'complete_fixture',
        'REUSE_PROVENANCE_INVALID'
      );
      await same(
        await repository(priorId).reuseCapturePage(args[0]),
        args[1],
        'REUSE_PAGE_MISMATCH'
      );
    }
    if (method === 'setConditional')
      requireLocal(
        repository(job.collection_job_id).reusableCaptures.has(args[2]?.priorCaptureRefId),
        'REUSE_PAGE_MISSING'
      );
    const result = await repository(job.collection_job_id)[method](...copy(args));
    if (method === 'commitMembershipAndCheckpoint')
      await strictRecord('checkpoint.schema.json', result.checkpoint);
    return { value: result, projection: connectorProjection(repository(job.collection_job_id)) };
  }
  function preceding(record, id) {
    const prior = store.find(id);
    requireLocal(prior && prior.sequence < record.sequence, 'JOURNAL_DEPENDENCY_ORDER');
    return prior;
  }
  async function validateStoredStrict(job, key, result, record) {
    const intent = preceding(record, `intent:${job.collection_job_id}:${key}`);
    const p = intent.payload;
    const compiled = compileManifestRequest(job.descriptor, p.request);
    requireLocal(
      ['captured', 'not_modified', 'typed_failure'].includes(result.outcome),
      'STRICT_OUTCOME_INVALID'
    );
    if (result.metadataFetch) {
      await strictRecord('metadata-fetch.schema.json', result.metadataFetch);
      const fetch = result.metadataFetch;
      requireLocal(
        fetch.run_id === job.execution_run_id &&
          fetch.job_id === deterministicId('job', { runId: job.execution_run_id, key }) &&
          fetch.endpoint_id === job.identity.endpoint_id &&
          fetch.template_id === job.identity.template_id &&
          fetch.target_class === compiled.targetClass &&
          fetch.observed_at === p.observed_at,
        'FETCH_LINEAGE_MISMATCH'
      );
    }
    if (result.outcome === 'captured') {
      const reference = preceding(record, `capture:${result.capture?.capture_ref_id}`);
      await same(reference.result, result.capture, 'CAPTURE_REFERENCE_MISMATCH');
      requireLocal(
        result.bodyBytes instanceof Uint8Array &&
          sha256(result.bodyBytes) === result.capture.raw_sha256 &&
          result.metadataFetch?.capture_ref_id === result.capture.capture_ref_id,
        'STRICT_CAPTURE_BODY_MISMATCH'
      );
    }
    if (result.outcome === 'not_modified') {
      requireLocal(
        result.capture === null && result.bodyBytes === null,
        'REUSE_NEW_BODY_FORBIDDEN'
      );
      preceding(record, `capture:${result.metadataFetch?.reused_capture_ref_id}`);
    }
  }
  async function replay() {
    let intentsSeen = 0;
    for (const record of store.records) {
      const p = record.payload;
      if (record.kind === 'child_admitted') {
        const result = await admitCollectionJob(p.input, fixture);
        requireLocal(result.kind === 'admitted', 'REPLAY_ADMISSION_BLOCKED');
        await same(result.job, record.result, 'CHILD_IDENTITY_TAMPERED');
        requireLocal(
          record.operation_id === `child:${result.job.collection_job_id}` &&
            !children.has(result.job.collection_job_id),
          'CHILD_DUPLICATE'
        );
        children.set(result.job.collection_job_id, result.job);
      } else if (record.kind === 'scheduler_seed') {
        requireLocal(!control.inspect().sources.has(p.source_id), 'SCHEDULER_RESEED');
        control.seedSource(p);
        await same(null, record.result);
      } else if (record.kind === 'scheduler_transaction') {
        requireLocal(
          ['scheduler-lease-due', 'scheduler-source', 'scheduler-source-failure'].includes(p.label),
          'TRANSACTION_LABEL_INVALID'
        );
        const client = await control.openDatabase();
        try {
          const value = await client.transaction(p.label, async (tx) => {
            for (const call of p.calls) {
              requireLocal(TX_METHODS.has(call.method), 'TRANSACTION_METHOD_INVALID');
              const actual = await tx[call.method](...copy(call.args));
              await same(actual, call.result);
            }
            return transactionValue(p.label, p.calls);
          });
          await same(value, record.result.value);
          await same(schedulerProjection(), record.result.projection);
        } finally {
          await client.close();
        }
      } else if (record.kind === 'connector_operation') {
        const job = children.get(p.child_id);
        requireLocal(job && p.execution_id === job.execution_run_id, 'CROSS_CHILD_REPLAY');
        if (!['setConditional', 'seedReusableCapture'].includes(p.method))
          preceding(record, `attempt:${p.child_id}`);
        await same(await reduceConnector(job, p.method, p.args), record.result);
      } else if (record.kind === 'child_bound') {
        const job = children.get(p.child_id);
        requireLocal(
          job &&
            record.result.parent_run_id === job.parent_run_id &&
            control.inspect().runKeys.get(job.parent_run_idempotency_key) === job.parent_run_id,
          'PARENT_ASSOCIATION_INVALID'
        );
      } else if (record.kind === 'capture_reference') {
        await strictRecord('capture-reference.schema.json', record.result);
        const job = children.get(p.child_id);
        requireLocal(
          job &&
            record.result.run_id === job.execution_run_id &&
            record.result.source_id === job.identity.source_id,
          'CROSS_CHILD_CAPTURE'
        );
        const bytes = await store.getObject(record.result.raw_sha256);
        requireLocal(
          bytes.byteLength === record.result.decompressed_bytes,
          'CAPTURE_SIZE_MISMATCH'
        );
        const intent = preceding(record, `intent:${p.child_id}:${p.request_key}`).payload;
        preceding(record, `response:${p.child_id}:${p.request_key}`);
        requireLocal(
          record.result.captured_at === intent.observed_at &&
            record.result.clocks.recorded_at === intent.recorded_at,
          'CAPTURE_CLOCK_MISMATCH'
        );
        requireLocal(
          record.result.capture_ref_id ===
            deterministicId('capture', {
              source: job.identity.source_id,
              runId: job.execution_run_id,
              rawSha256: record.result.raw_sha256,
              locator: intent.url,
              observedAt: intent.observed_at,
              recordedAt: intent.recorded_at
            }),
          'CAPTURE_ID_MISMATCH'
        );
      } else if (record.kind === 'attempt_outcome') {
        const job = children.get(p.child_id);
        requireLocal(
          job &&
            record.operation_id === `outcome:${p.child_id}` &&
            record.result.execution_run_id === job.execution_run_id &&
            record.result.attempt === 1 &&
            TERMINALS.has(record.result.status),
          'ATTEMPT_OUTCOME_INVALID'
        );
        preceding(record, `attempt:${p.child_id}`);
        const run = repository(p.child_id).runs.get(job.execution_run_id);
        if (record.result.status === 'complete_fixture') {
          requireLocal(run?.checkpointCommitted, 'FALSE_COMPLETION');
          await same(
            record.result,
            {
              status: 'complete_fixture',
              collection_job_id: job.collection_job_id,
              parent_run_id: job.parent_run_id,
              execution_run_id: job.execution_run_id,
              attempt: 1,
              checkpoint: run.commitResult.checkpoint,
              selected_records: job.identity.selected_record_ids.map((id) => ({
                record_id: id,
                status: 'observed_fixture'
              })),
              publication_authorized: false,
              production_composition: false
            },
            'ATTEMPT_RESULT_MISMATCH'
          );
        }
        const terminalBase = {
          status: record.result.status,
          collection_job_id: job.collection_job_id,
          parent_run_id: job.parent_run_id,
          execution_run_id: job.execution_run_id,
          attempt: 1,
          publication_authorized: false,
          production_composition: false
        };
        if (record.result.status === 'typed_failure') {
          requireLocal(run?.failed, 'ATTEMPT_FAILURE_MISSING');
          await same(
            record.result,
            { ...terminalBase, failure: run.failed },
            'ATTEMPT_FAILURE_MISMATCH'
          );
        }
        if (record.result.status === 'partial_unresolved')
          await same(
            record.result,
            { ...terminalBase, code: 'DELIVERY_UNRESOLVED' },
            'ATTEMPT_UNRESOLVED_MISMATCH'
          );
        if (record.result.status === 'partial_unresolved')
          requireLocal(
            store
              .byKind('request_intent')
              .some(
                (intent) =>
                  intent.payload.child_id === p.child_id &&
                  !store.find(`response:${p.child_id}:${intent.payload.request_key}`) &&
                  !store.find(`strict:${p.child_id}:${intent.payload.request_key}`)
              ),
            'UNRESOLVED_INTENT_MISSING'
          );
      } else if (
        [
          'attempt_started',
          'request_intent',
          'response',
          'strict_outcome',
          'wrapper_outcome',
          'request_ledger'
        ].includes(record.kind)
      ) {
        const job = children.get(p.child_id);
        requireLocal(job && p.execution_id === job.execution_run_id, 'CROSS_CHILD_RECORD');
        if (record.kind === 'attempt_started') {
          requireLocal(record.operation_id === `attempt:${p.child_id}`, 'ATTEMPT_START_INVALID');
          preceding(record, `bound:${p.child_id}`);
          await same(record.result, { attempt: 1 }, 'ATTEMPT_START_INVALID');
        }
        if (record.kind === 'request_intent') {
          preceding(record, `attempt:${p.child_id}`);
          requireLocal(
            record.operation_id === `intent:${p.child_id}:${p.request_key}` &&
              p.request_key === connectorRequestKey(p.request),
            'REQUEST_KEY_MISMATCH'
          );
          await same(
            p.reservation,
            job.identity.budget_reservation,
            'RESERVATION_IDENTITY_MISMATCH'
          );
          const compiled = compileManifestRequest(job.descriptor, p.request);
          requireLocal(
            compiled.url.href === p.url && fixture.manifest.pages[p.page_ordinal]?.url === p.url,
            'REQUEST_LOCATOR_TAMPERED'
          );
          requireLocal(p.delivery_ordinal === intentsSeen++, 'REQUEST_ORDINAL_INVALID');
          requireLocal(
            Number.isSafeInteger(p.delivery_ordinal) &&
              p.delivery_ordinal >= 0 &&
              p.delivery_ordinal < JOURNAL_BOUNDS.maximum_total_deliveries,
            'REQUEST_ORDINAL_INVALID'
          );
          requireLocal(
            p.observed_at ===
              new Date(
                Date.parse(job.identity.scheduled_slot) +
                  p.delivery_ordinal * FIXTURE_CLOCK.page_spacing_ms
              ).toISOString() &&
              p.recorded_at ===
                new Date(
                  Date.parse(p.observed_at) + FIXTURE_CLOCK.recorded_offset_ms
                ).toISOString(),
            'REQUEST_CLOCK_TAMPERED'
          );
        }
        if (record.kind === 'response') {
          preceding(record, `intent:${p.child_id}:${p.request_key}`);
          requireLocal(
            record.operation_id === `response:${p.child_id}:${p.request_key}` &&
              record.result.bodyBytes instanceof Uint8Array &&
              record.result.bodyBytes.byteLength <=
                job.identity.budget_reservation.maximum_response_bytes &&
              record.result.bodyBytes.byteLength <=
                job.identity.budget_reservation.maximum_decompressed_bytes,
            'RESPONSE_BOUND_INVALID'
          );
        }
        if (record.kind === 'strict_outcome') {
          requireLocal(
            record.operation_id === `strict:${p.child_id}:${p.request_key}`,
            'STRICT_KEY_MISMATCH'
          );
          await validateStoredStrict(job, p.request_key, record.result, record);
        }
        if (record.kind === 'wrapper_outcome') {
          requireLocal(
            record.operation_id === `wrapper:${p.child_id}:${p.request_key}`,
            'WRAPPER_KEY_MISMATCH'
          );
          await same(
            preceding(record, `strict:${p.child_id}:${p.request_key}`).result,
            record.result.strict,
            'WRAPPER_STRICT_MISMATCH'
          );
          const intent = preceding(record, `intent:${p.child_id}:${p.request_key}`).payload;
          const legacy = record.result.legacy;
          requireLocal(
            legacy.url === intent.url && legacy.captured_at === intent.observed_at,
            'LEGACY_LINEAGE_MISMATCH'
          );
          if (record.result.strict.outcome === 'captured')
            requireLocal(
              legacy.status === 'captured' &&
                legacy.sha256 === record.result.strict.capture.raw_sha256 &&
                legacy.bytes === record.result.strict.bodyBytes.byteLength &&
                legacy.http_status === record.result.strict.metadataFetch.response_status,
              'LEGACY_CAPTURE_MISMATCH'
            );
          if (record.result.strict.outcome === 'not_modified')
            requireLocal(
              legacy.status === 'http_failed' && legacy.http_status === 304 && legacy.bytes === 0,
              'LEGACY_REUSE_MISMATCH'
            );
          await same(
            await makeReceipt(job, p.request_key, record.result.strict),
            record.result.receipt,
            'RECEIPT_TAMPERED'
          );
        }
      }
    }
    requireLocal(
      children.size <= JOURNAL_BOUNDS.maximum_children &&
        store.byKind('request_intent').length <= JOURNAL_BOUNDS.maximum_total_deliveries,
      'RESERVATION_BOUND_EXCEEDED'
    );
    for (const job of children.values())
      requireLocal(
        store.byKind('request_intent').filter((r) => childOf(r) === job.collection_job_id).length <=
          job.identity.budget_reservation.maximum_requests,
        'RESERVATION_BOUND_EXCEEDED'
      );
  }
  function schedulerProjection() {
    const state = control.inspect();
    return {
      sources: state.sources,
      runs: state.runs,
      runKeys: state.runKeys,
      outbox: state.outbox
    };
  }
  function transactionValue(label, calls) {
    const method = {
      'scheduler-lease-due': 'leaseDueSources',
      'scheduler-source': 'ensureRunAndWorkflowOutbox',
      'scheduler-source-failure': 'recordScheduleDispatchFailure'
    }[label];
    requireLocal(calls.length === 1 && calls[0].method === method, 'TRANSACTION_SHAPE_INVALID');
    if (label !== 'scheduler-source') return calls[0].result;
    const input = calls[0].args[0];
    return {
      runId: input.runId,
      workflowInstanceId: input.workflowInstanceId,
      created: calls[0].result.created,
      sourceId: input.sourceId
    };
  }
  async function openDatabase() {
    store.assertUsable(true);
    const client = await control.openDatabase();
    let closed = false;
    const result = Object.fromEntries(
      PORT_METHODS.controlStore.map((method) => [
        method,
        async () => {
          store.assertUsable(true);
          throw new LocalCollectionError('LOCAL_CONTROL_METHOD_DISABLED');
        }
      ])
    );
    result.close = async () => {
      if (!closed) {
        closed = true;
        await client.close();
      }
    };
    result.transaction = async (label, callback) => {
      store.assertUsable(true);
      requireLocal(!closed, 'LOCAL_CLIENT_CLOSED');
      const committed = await store.transactionRecord(label, async () => {
        const calls = [];
        const value = await client.transaction(label, async (tx) => {
          const port = Object.fromEntries(
            [...TX_METHODS].map((method) => [
              method,
              async (...args) => {
                store.assertUsable(true);
                const result = await tx[method](...args);
                calls.push({ method, args: copy(args), result: copy(result) });
                return result;
              }
            ])
          );
          return callback(port);
        });
        await same(value, transactionValue(label, calls), 'TRANSACTION_RESULT_INVALID');
        return { calls, result: { value, projection: schedulerProjection() } };
      });
      return committed.value;
    };
    return result;
  }
  async function makeReceipt(job, key, result) {
    const intent = store.find(`intent:${job.collection_job_id}:${key}`);
    requireLocal(intent, 'RECEIPT_INTENT_MISSING');
    const compiled = compileManifestRequest(job.descriptor, intent.payload.request);
    const response = store.find(`response:${job.collection_job_id}:${key}`)?.result;
    const prior = result.metadataFetch?.reused_capture_ref_id
      ? store.find(`capture:${result.metadataFetch.reused_capture_ref_id}`)?.result
      : null;
    const composed = await composeEvidenceReceipt(
      {
        receipt_id: deterministicId('receipt', { child: job.collection_job_id, key }),
        request_type: 'catalog_metadata',
        source_id: job.identity.source_id,
        descriptor_id: job.identity.descriptor_id,
        endpoint_id: job.identity.endpoint_id,
        template_id: job.identity.template_id,
        configuration_revision: job.identity.configuration_revision,
        descriptor_hash: {
          algorithm: 'sha256',
          sha256: job.identity.descriptor_sha256,
          hash_basis: DESCRIPTOR_HASH_BASIS,
          hash_version: DESCRIPTOR_HASH_BASIS
        },
        purpose: 'catalog_metadata',
        expected_content_classes: compiled.route.expected_content_classes,
        safe_final_host: compiled.url.hostname,
        safe_final_path: compiled.url.pathname,
        redirect_count: 0,
        observed_status: response?.status ?? null,
        observed_media_type: response?.headers['content-type'] ?? null,
        observed_bytes: response?.bodyBytes.byteLength ?? 0,
        truncated: false,
        capture_reference: result.capture ?? prior,
        metadata_fetch: result.metadataFetch,
        parser_state: 'not_run',
        connector_name: job.descriptor.connector_name,
        connector_version: job.descriptor.connector_version,
        attempt_outcome: result.outcome,
        schema_validated: result.outcome === 'captured',
        next_action:
          result.outcome === 'captured'
            ? 'none'
            : result.outcome === 'not_modified'
              ? 'reuse_capture'
              : 'quarantine',
        observed_at: intent.payload.observed_at
      },
      receiptOptions
    );
    requireLocal(composed.valid, 'EVIDENCE_RECEIPT_INVALID');
    return composed.receipt;
  }
  function connectorPort(job) {
    const port = {};
    for (const method of MUTATIONS)
      port[method] = async (...args) => {
        store.assertUsable(true);
        assertChildArguments(job, method, args);
        const input = copy(args);
        if (method === 'commitPage') input[0].fetch = strictStored(input[0].fetch);
        const result = await store.mutation(
          'connector_operation',
          {
            child_id: job.collection_job_id,
            execution_id: job.execution_run_id,
            method,
            args: input
          },
          () => reduceConnector(job, method, input)
        );
        return result.value;
      };
    for (const method of READS)
      port[method] = async (...args) => {
        store.assertUsable();
        assertChildArguments(job, method, args);
        return repository(job.collection_job_id)[method](...args);
      };
    return port;
  }
  async function admit(input = fixture.input) {
    store.assertUsable(true);
    const result = await admitCollectionJob(input, fixture);
    if (result.kind !== 'admitted') return result;
    const job = result.job;
    if (children.has(job.collection_job_id)) return result;
    requireLocal(children.size < JOURNAL_BOUNDS.maximum_children, 'CHILD_BOUND_EXCEEDED');
    for (const existing of children.values())
      if (
        existing.identity.source_id === job.identity.source_id &&
        existing.identity.configuration_revision === job.identity.configuration_revision
      )
        requireLocal(
          existing.identity.descriptor_sha256 === job.identity.descriptor_sha256,
          'IMMUTABLE_REVISION_CONFLICT'
        );
    await store.record(
      'child_admitted',
      `child:${job.collection_job_id}`,
      { input: copy(input) },
      job
    );
    children.set(job.collection_job_id, job);
    return result;
  }
  async function schedule(job) {
    store.assertUsable(true);
    requireLocal(children.has(job.collection_job_id), 'CHILD_NOT_ADMITTED');
    if (!control.inspect().sources.has(job.identity.source_id)) {
      const seed = {
        source_id: job.identity.source_id,
        endpoint_id: job.identity.endpoint_id,
        scope_ids: [job.identity.scope_id],
        configuration_revision: job.identity.configuration_revision,
        next_due_at: job.identity.scheduled_slot,
        mode: job.identity.mode
      };
      await store.mutation('scheduler_seed', seed, () => {
        control.seedSource(seed);
        return null;
      });
    }
    if (!control.inspect().runs.has(job.parent_run_id)) {
      const source = control.inspect().sources.get(job.identity.source_id);
      // A durable lease prefix is honoured; retry only at its recorded expiry.
      const now = source.lease?.expires_at ?? job.identity.scheduled_slot;
      await createScheduler({
        openDatabase,
        configuration: { mode: job.identity.mode, runDeadlineMs: 30000 }
      }).dispatchScheduledSlot({ scheduledTime: job.identity.scheduled_slot, now });
    }
    const state = control.inspect();
    requireLocal(
      state.runKeys.get(job.parent_run_idempotency_key) === job.parent_run_id &&
        state.runs.has(job.parent_run_id),
      'PARENT_RUN_NOT_FOUND'
    );
    requireLocal(
      [...state.outbox.values()].some((row) => row.references?.run_id === job.parent_run_id),
      'PARENT_OUTBOX_NOT_FOUND'
    );
    await store.record(
      'child_bound',
      `bound:${job.collection_job_id}`,
      { child_id: job.collection_job_id },
      { parent_run_id: job.parent_run_id }
    );
  }
  async function executePage(job, context) {
    store.assertUsable(true);
    const key = connectorRequestKey(context.request),
      suffix = `${job.collection_job_id}:${key}`;
    const cached = store.find(`wrapper:${suffix}`);
    if (cached) return strictRestored(cached.result.strict);
    const compiled = compileManifestRequest(job.descriptor, context.request);
    const ordinal = fixture.manifest.pages.findIndex((page) => page.url === compiled.url.href);
    requireLocal(ordinal >= 0, 'FIXTURE_ROUTE_NOT_REGISTERED');
    const priorIntent = store.find(`intent:${suffix}`);
    const priorResponse = store.find(`response:${suffix}`);
    const priorStrict = store.find(`strict:${suffix}`);
    requireLocal(!priorIntent || priorResponse || priorStrict, 'DELIVERY_UNRESOLVED');
    const deliveryOrdinal =
      priorIntent?.payload.delivery_ordinal ?? store.byKind('request_intent').length;
    const observedAt = new Date(
      Date.parse(job.identity.scheduled_slot) + deliveryOrdinal * FIXTURE_CLOCK.page_spacing_ms
    ).toISOString();
    const recordedAt = new Date(
      Date.parse(observedAt) + FIXTURE_CLOCK.recorded_offset_ms
    ).toISOString();
    logicalNow = Date.parse(observedAt);
    const lineage = {
      child_id: job.collection_job_id,
      execution_id: job.execution_run_id,
      request_key: key
    };
    if (!priorIntent) {
      const intents = store.byKind('request_intent');
      requireLocal(
        intents.length < JOURNAL_BOUNDS.maximum_total_deliveries &&
          intents.filter((r) => childOf(r) === job.collection_job_id).length <
            job.identity.budget_reservation.maximum_requests,
        'RESERVATION_BOUND_EXCEEDED'
      );
      await store.record(
        'request_intent',
        `intent:${suffix}`,
        {
          ...lineage,
          request: context.request,
          url: compiled.url.href,
          page_ordinal: ordinal,
          delivery_ordinal: deliveryOrdinal,
          observed_at: observedAt,
          recorded_at: recordedAt,
          reservation: job.identity.budget_reservation
        },
        null
      );
    }
    let strict = priorStrict?.result ?? null;
    const bridge = createExactCaptureBridge({
      compiled,
      timeoutMs: job.identity.budget_reservation.timeout_ms,
      execute: async (fence) => {
        const guarded = () => {
          store.assertUsable(true);
          fence.assert();
        };
        if (!strict) {
          const captureProtocol = new R2CaptureProtocol({
            clock: () => new Date(recordedAt),
            crashInjector: (point, detail) => store.hit(`capture.${point}`, detail),
            objectStore: {
              async putIfAbsent(objectKey, bytes, options) {
                guarded();
                const hash = sha256(bytes);
                requireLocal(
                  objectKey === `captures/sha256/${hash.slice(0, 2)}/${hash}` &&
                    options.sha256 === hash,
                  'CAPTURE_OBJECT_KEY_MISMATCH'
                );
                await store.putObject(bytes);
                guarded();
                return { key: objectKey, sha256: hash, size: bytes.byteLength };
              }
            },
            referenceStore: {
              async commit(reference) {
                guarded();
                await strictRecord('capture-reference.schema.json', reference);
                return store.record(
                  'capture_reference',
                  `capture:${reference.capture_ref_id}`,
                  lineage,
                  reference
                );
              }
            }
          });
          const client = new BoundedHttpClient({
            clock: () => new Date(observedAt),
            governor,
            resolver: new FixtureDnsResolver(),
            requestTimeoutMs: job.identity.budget_reservation.timeout_ms,
            captureProtocol,
            requestLedger: {
              async append(record) {
                guarded();
                return store.record(
                  'request_ledger',
                  `ledger:${suffix}:${record.outcome}`,
                  lineage,
                  record
                );
              }
            },
            transport: {
              async send(request) {
                guarded();
                assertPinnedTransportRequest(request);
                requireLocal(
                  request.url === compiled.url.href &&
                    request.method === 'GET' &&
                    request.redirect === 'manual',
                  'FIXTURE_TRANSPORT_MISMATCH'
                );
                requireLocal(
                  control.inspect().clientLifecycle.every((client) => client.closed),
                  'DATABASE_OPEN_DURING_DELIVERY'
                );
                const cachedResponse = store.find(`response:${suffix}`);
                if (cachedResponse) return copy(cachedResponse.result);
                await store.hit('before_fixture_delivery', lineage);
                guarded();
                await onDelivery?.({ child_id: job.collection_job_id, url: request.url, ordinal });
                await store.hit('after_fixture_delivery', lineage);
                const defaultResponse = {
                  status: 200,
                  headers: { 'content-type': 'application/json', etag: `"fixture-${ordinal}"` },
                  bodyBytes: new Uint8Array(
                    Buffer.from(canonicalJson(fixture.manifest.pages[ordinal].body))
                  ),
                  connectedAddress: '93.184.216.34'
                };
                const response = await (responseFor
                  ? responseFor({ request, ordinal, response: copy(defaultResponse) })
                  : defaultResponse);
                guarded();
                requireLocal(
                  response.bodyBytes instanceof Uint8Array &&
                    response.bodyBytes.byteLength <=
                      job.identity.budget_reservation.maximum_response_bytes &&
                    response.bodyBytes.byteLength <=
                      job.identity.budget_reservation.maximum_decompressed_bytes,
                  'FIXTURE_RESPONSE_BOUND'
                );
                const total = store
                  .byKind('response')
                  .filter((r) => childOf(r) === job.collection_job_id)
                  .reduce((sum, r) => sum + r.result.bodyBytes.byteLength, 0);
                requireLocal(
                  total + response.bodyBytes.byteLength <=
                    job.identity.budget_reservation.maximum_total_bytes,
                  'FIXTURE_TOTAL_BOUND'
                );
                await store.record('response', `response:${suffix}`, lineage, response);
                guarded();
                return copy(response);
              }
            }
          });
          const executed = await client.execute(context);
          guarded();
          strict = strictStored(executed);
          if (strict.metadataFetch)
            await strictRecord('metadata-fetch.schema.json', strict.metadataFetch);
          await store.record('strict_outcome', `strict:${suffix}`, lineage, strict);
        }
        const response = store.find(`response:${suffix}`)?.result;
        if (strict.outcome === 'typed_failure' && !response)
          throw new LocalCollectionError('STRICT_FETCH_FAILED');
        return {
          status: response.status,
          headers: response.headers,
          bodyBytes: response.bodyBytes
        };
      }
    });
    const legacy = await capture(compiled.url.href, {
      fetchImpl: bridge,
      clock: () => new Date(observedAt),
      locatorPolicy: (url) => (url === compiled.url.href ? url : null),
      maxBytes: job.identity.budget_reservation.maximum_decompressed_bytes,
      timeoutMs: job.identity.budget_reservation.timeout_ms
    });
    store.assertUsable(true);
    if (!strict) {
      requireLocal(
        ['timed_out', 'fetch_failed'].includes(legacy.status),
        'COLLECTOR_DID_NOT_EXECUTE'
      );
      strict = {
        outcome: 'typed_failure',
        failure: {
          failure_type: legacy.status === 'timed_out' ? 'timeout' : 'internal_failure',
          retry_class: 'transient',
          target_class: compiled.targetClass,
          safe_detail_code:
            legacy.status === 'timed_out'
              ? 'LOCAL_COLLECTOR_DEADLINE'
              : 'LOCAL_COLLECTOR_FETCH_FAILED',
          http_status: null,
          observed_at: observedAt
        },
        capture: null,
        bodyBytes: null,
        metadataFetch: null,
        blockedBeforeEgress: false
      };
      await store.record('strict_outcome', `strict:${suffix}`, lineage, strict);
    }
    requireLocal(
      legacy.url === compiled.url.href && legacy.captured_at === observedAt,
      'COLLECTOR_IDENTITY_MISMATCH'
    );
    if (strict.outcome === 'captured')
      requireLocal(
        legacy.status === 'captured' &&
          legacy.http_status === strict.metadataFetch.response_status &&
          legacy.sha256 === strict.capture.raw_sha256 &&
          legacy.bytes === strict.bodyBytes.byteLength &&
          Buffer.from(legacy.text).equals(Buffer.from(strict.bodyBytes)) &&
          legacy.content_type.split(';')[0] === strict.capture.media_type,
        'COLLECTOR_CAPTURE_MISMATCH'
      );
    if (strict.outcome === 'not_modified')
      requireLocal(
        legacy.status === 'http_failed' && legacy.http_status === 304 && legacy.bytes === 0,
        'COLLECTOR_304_MISMATCH'
      );
    const { text: discarded, ...legacySummary } = legacy;
    const receipt = await makeReceipt(job, key, strict);
    await store.record(
      'wrapper_outcome',
      `wrapper:${suffix}`,
      { ...lineage },
      { legacy: legacySummary, strict, receipt }
    );
    return strictRestored(strict);
  }
  async function seedFixtureReuse({ childId, priorChildId }) {
    store.assertUsable(true);
    const job = children.get(childId),
      prior = children.get(priorChildId);
    requireLocal(
      job &&
        prior &&
        childId !== priorChildId &&
        !repository(childId).runs.size &&
        job.identity.descriptor_sha256 === prior.identity.descriptor_sha256 &&
        store.find(`outcome:${priorChildId}`)?.result.status === 'complete_fixture',
      'REUSE_PROVENANCE_INVALID'
    );
    const port = connectorPort(job);
    for (const page of repository(priorChildId).runs.get(prior.execution_run_id).pages.values()) {
      const reference = store.find(`capture:${page.captureRefId}`)?.result;
      requireLocal(reference?.safe_response_headers.etag, 'REUSE_VALIDATOR_MISSING');
      await port.seedReusableCapture(
        page.captureRefId,
        await repository(priorChildId).reuseCapturePage(page.captureRefId)
      );
      await port.setConditional(job.execution_run_id, page.pageKey, {
        validators: { etag: reference.safe_response_headers.etag, lastModified: null },
        priorCaptureRefId: page.captureRefId
      });
    }
  }
  async function execute(id) {
    store.assertUsable(true);
    requireLocal(!busy, 'LOCAL_EXECUTION_BUSY');
    busy = true;
    try {
      const job = children.get(id);
      requireLocal(job, 'CHILD_NOT_ADMITTED');
      const terminal = store.find(`outcome:${id}`);
      if (terminal) return copy(terminal.result);
      await schedule(job);
      await store.record(
        'attempt_started',
        `attempt:${id}`,
        { child_id: id, execution_id: job.execution_run_id },
        { attempt: 1 }
      );
      let result;
      try {
        const connector = new DcatDataJsonConnector({
          descriptor: job.descriptor,
          endpointId: job.identity.endpoint_id,
          templateId: job.identity.template_id
        });
        result = await new DeterministicConnectorRunner({
          httpClient: { execute: (context) => executePage(job, context) },
          runRepository: connectorPort(job),
          clock: () => new Date(logicalNow),
          crashInjector: (point, detail) => store.hit(`runner.${point}`, detail)
        }).run({
          connector,
          runId: job.execution_run_id,
          scheduledSlot: job.identity.scheduled_slot,
          mode: job.identity.mode,
          attempt: 1
        });
      } catch (error) {
        store.assertUsable(true);
        if (error.code === 'DELIVERY_UNRESOLVED')
          return settle(job, 'partial_unresolved', { code: error.code });
        const known = error instanceof LocalCollectionError;
        const failure = {
          failure_type: known ? 'canonical_invariant_failure' : 'internal_failure',
          retry_class: known ? 'quarantine' : 'transient',
          target_class: 'collection',
          safe_detail_code: known ? error.code : 'COLLECTOR_RUN_FAILED',
          http_status: null,
          observed_at: new Date(logicalNow).toISOString()
        };
        await connectorPort(job).failRun(job.execution_run_id, failure);
        return settle(job, 'typed_failure', { failure });
      }
      if (result.outcome === 'succeeded') {
        requireLocal(
          job.identity.selected_record_ids.every((id) =>
            result.membership.some((row) => row.nativeId === id && row.state === 'active')
          ),
          'SELECTED_RECORD_NOT_OBSERVED'
        );
        return settle(job, 'complete_fixture', {
          checkpoint: result.checkpoint,
          selected_records: job.identity.selected_record_ids.map((id) => ({
            record_id: id,
            status: 'observed_fixture'
          }))
        });
      }
      return settle(job, 'typed_failure', { failure: result.failure });
    } finally {
      busy = false;
    }
  }
  async function settle(job, status, detail) {
    const result = {
      status,
      collection_job_id: job.collection_job_id,
      parent_run_id: job.parent_run_id,
      execution_run_id: job.execution_run_id,
      attempt: 1,
      ...detail,
      publication_authorized: false,
      production_composition: false
    };
    return store.record(
      'attempt_outcome',
      `outcome:${job.collection_job_id}`,
      { child_id: job.collection_job_id },
      result
    );
  }
  function status(id) {
    store.assertUsable();
    const job = children.get(id);
    requireLocal(job, 'CHILD_NOT_ADMITTED');
    const outcome = store.find(`outcome:${id}`)?.result;
    if (outcome) return copy(outcome);
    const run = repository(id).runs.get(job.execution_run_id);
    return {
      status: run?.pages.size ? 'partial' : store.find(`attempt:${id}`) ? 'running' : 'selected',
      collection_job_id: id,
      parent_run_id: job.parent_run_id,
      execution_run_id: job.execution_run_id,
      attempt: 1,
      pages_committed: run?.pages.size ?? 0,
      resumable: true,
      publication_authorized: false,
      production_composition: false
    };
  }
  try {
    await replay();
    if (!readOnly) {
      requireLocal(
        store.byKind('replay_session').length < JOURNAL_BOUNDS.maximum_replays,
        'REPLAY_BOUND_EXCEEDED'
      );
      await store.record(
        'replay_session',
        `replay:${store.byKind('replay_session').length + 1}`,
        {},
        null
      );
    }
  } catch (error) {
    await store.close();
    throw error;
  }

  const EVIDENCE_KINDS = new Set([
    'catalog_metadata_validation',
    'documentation_reachability',
    'payload_validation',
    'browser_cors_observation'
  ]);
  const ORIGINS = new Set(['local_fixture_execution', 'retained_observation_fixture']);
  function seriesKey(series) {
    requireLocal(series && Object.getPrototypeOf(series) === Object.prototype, 'EVIDENCE_SERIES_INVALID');
    exactKeys(series, ['source_id', 'descriptor_role', 'record_or_route_id', 'evidence_kind', 'origin_class'], 'EVIDENCE_SERIES_INVALID');
    requireLocal(
      typeof series.source_id === 'string' &&
        series.source_id.length > 0 &&
        series.source_id.length <= 512,
      'EVIDENCE_SERIES_INVALID'
    );
    requireLocal(EVIDENCE_KINDS.has(series.evidence_kind), 'EVIDENCE_KIND_INVALID');
    requireLocal(ORIGINS.has(series.origin_class), 'EVIDENCE_ORIGIN_INVALID');
    requireLocal(
      typeof series.descriptor_role === 'string' &&
        typeof series.record_or_route_id === 'string' &&
        series.descriptor_role.length <= 512 &&
        series.record_or_route_id.length <= 512,
      'EVIDENCE_SERIES_INVALID'
    );
    return series;
  }
  function evidenceStatus(query = {}) {
    store.assertUsable();
    const wanted = seriesKey(query.series);
    const wantedCanon = canonicalJson(wanted);
    const rows = store.byKind('attempt_evidence').filter(
      (record) => canonicalJson(record.payload.series) === wantedCanon
    );
    const ordered = [...rows].sort((a, b) => a.payload.attempt_order - b.payload.attempt_order);
    const latest = ordered.at(-1) ?? null;
    const lastGood = [...ordered].reverse().find((row) => row.result.qualified_success === true) ?? null;
    return {
      series: wanted,
      latest_attempt: latest
        ? {
            attempt_order: latest.payload.attempt_order,
            operation_id: latest.operation_id,
            observation: copy(latest.result.observation),
            proof: copy(latest.payload.proof),
            qualified_success: latest.result.qualified_success
          }
        : null,
      last_good: lastGood
        ? {
            attempt_order: lastGood.payload.attempt_order,
            operation_id: lastGood.operation_id,
            observation: copy(lastGood.result.observation),
            proof: copy(lastGood.payload.proof),
            qualified_success: true
          }
        : null
    };
  }
  async function recordAttemptEvidence(context = {}) {
    store.assertUsable(true);
    requireLocal(context && Object.getPrototypeOf(context) === Object.prototype, 'EVIDENCE_CONTEXT_INVALID');
    const origin = context.origin;
    requireLocal(ORIGINS.has(origin), 'EVIDENCE_ORIGIN_INVALID');
    const series = seriesKey(context.series);
    requireLocal(series.origin_class === origin, 'EVIDENCE_ORIGIN_MISMATCH');
    requireLocal(Number.isSafeInteger(context.attempt_order) && context.attempt_order >= 1, 'EVIDENCE_ORDER_INVALID');
    const observation = context.observation;
    requireLocal(observation && Object.getPrototypeOf(observation) === Object.prototype, 'EVIDENCE_OBSERVATION_INVALID');
    requireLocal(!('body' in observation) && !('text' in observation) && !('raw_body' in observation), 'EVIDENCE_UNSAFE_FIELD');
    const proof = context.proof;
    requireLocal(proof && Object.getPrototypeOf(proof) === Object.prototype, 'EVIDENCE_PROOF_INVALID');
    if (origin === 'retained_observation_fixture') {
      requireLocal(
        proof.retained_artifact &&
          typeof proof.retained_artifact.path === 'string' &&
          /^[a-f0-9]{64}$/.test(proof.retained_artifact.sha256) &&
          Number.isSafeInteger(proof.retained_artifact.bytes),
        'EVIDENCE_RETAINED_PROOF_INVALID'
      );
    } else {
      requireLocal(
        typeof proof.response_op_id === 'string' && proof.response_op_id.length > 0,
        'EVIDENCE_EXECUTION_PROOF_INVALID'
      );
    }
    const qualified = context.qualified_success === true;
    const operationId =
      typeof context.operation_id === 'string' && context.operation_id.length > 0
        ? context.operation_id
        : `evidence:${sha256(canonicalJson({ series, attempt_order: context.attempt_order }))}`;
    const payload = {
      origin,
      series,
      attempt_order: context.attempt_order,
      proof: copy(proof),
      publication_authorized: false,
      promotion_authorized: false,
      production_composition: false
    };
    const result = {
      observation: copy(observation),
      qualified_success: qualified
    };
    await store.record('attempt_evidence', operationId, payload, result);
    return evidenceStatus({ series });
  }

  return Object.freeze({
    admit,
    schedule,
    execute,
    status,
    seedFixtureReuse,
    store,
    openDatabase,
    inspect: () => {
      store.assertUsable();
      return {
        scheduler: control.inspect(),
        children: copy(children),
        repositories: new Map(
          [...repositories].map(([id, repo]) => [id, copy(connectorProjection(repo))])
        )
      };
    },
    close: () => store.close(),
    recordAttemptEvidence,
    evidenceStatus
  });
}

export async function previewLocalFixture(fixtureId) {
  const fixture = await loadFixtureCatalog(fixtureId);
  const admitted = await admitCollectionJob(fixture.input, fixture);
  if (admitted.kind !== 'admitted') return admitted;
  return {
    status: 'selected',
    job: admitted.job,
    estimated_limits: fixture.input.budget_reservation,
    publication_authorized: false,
    production_composition: false
  };
}
export function localFailure(error) {
  return blocked(error instanceof LocalCollectionError ? error.code : 'LOCAL_COLLECTION_FAILED');
}
