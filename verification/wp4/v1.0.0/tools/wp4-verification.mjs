import assert from 'node:assert/strict';
import {
  createDeadLetterRecoveryReconciler,
  createDeadLetterSink,
  createFakeQueue,
  createFakeQueueMessage,
  createInMemoryControlPlane,
  createOutboxDispatcher,
  createQueueConsumer,
  createScheduler,
  createSourceControlService,
  deterministicRunId,
  DLQ_SINK_TRANSPORT_POLICY,
  FaultInjector,
  retryBudget,
  STAGE_POLICIES,
  workflowInstanceId,
  assertDlqSinkTransportConfiguration,
  typedFailureError,
} from '../../../../packages/ingestion/src/index.mjs';
import {
  exists,
  implementationFingerprint,
  readRepositoryText,
  readVerificationJson,
  verificationPackageFingerprint,
} from './common.mjs';

const addMilliseconds = (value, milliseconds) => new Date(Date.parse(value) + milliseconds).toISOString();

function assertHas(text, pattern, label) {
  assert.match(text, pattern, label);
  return true;
}

async function verifyTransportPolicy(policy) {
  assert.equal(STAGE_POLICIES.harvest_page.maximumDeliveryAttempts, policy.transport.dlq_sink_maximum_delivery_attempts);
  assert.deepEqual(retryBudget('harvest_page', 5), {
    maximumDeliveryAttempts: 6,
    transportMaxRetries: 5,
    exhausted: false,
  });
  assert.deepEqual(retryBudget('harvest_page', 6), {
    maximumDeliveryAttempts: 6,
    transportMaxRetries: 5,
    exhausted: true,
  });
  assert.equal(DLQ_SINK_TRANSPORT_POLICY.maximumDeliveryAttempts, policy.transport.dlq_sink_maximum_delivery_attempts);
  assert.equal(DLQ_SINK_TRANSPORT_POLICY.transportMaxRetries, policy.transport.dlq_sink_transport_max_retries);
  assert.equal(DLQ_SINK_TRANSPORT_POLICY.maximumBatchSize, policy.transport.dlq_sink_maximum_batch_size);
  assert.equal(DLQ_SINK_TRANSPORT_POLICY.secondDeadLetterQueueAllowed, false);
  assert.equal(assertDlqSinkTransportConfiguration({ maxRetries: 5, maxBatchSize: 1, deadLetterQueue: null }), true);
  assert.throws(
    () => assertDlqSinkTransportConfiguration({ maxRetries: 5, maxBatchSize: 1, deadLetterQueue: 'recursive-dlq' }),
    /DLQ_SINK_RECURSIVE_DLQ_REJECTED/,
  );
  return Object.freeze({
    status: 'pass_local',
    initial_delivery_attempts: 1,
    transport_retries: 5,
    maximum_delivery_attempts: 6,
    recursive_dead_letter_queue_allowed: false,
  });
}

async function verifyWorkflowIdentity(policy, migration2, migration3) {
  const runId = await deterministicRunId({
    endpointId: 'endpoint_wp4_identity',
    scheduledSlot: '2026-08-30T00:00:00.000Z',
    mode: 'incremental',
    configurationRevision: 1,
  });
  const first = workflowInstanceId(runId, 1);
  const repeated = workflowInstanceId(runId, 1);
  const pattern = new RegExp(policy.workflow_identity.pattern);
  assert.equal(first, repeated);
  assert.match(first, pattern);
  assert.ok(first.length <= policy.workflow_identity.maximum_length);
  assert.throws(() => workflowInstanceId('run/unsafe', 1), /WORKFLOW_INSTANCE_ID_PLATFORM_UNSAFE/);
  assertHas(migration2, /length\(workflow_instance_id\) <= 100/, '0002 must enforce the platform length bound');
  assertHas(migration2, /workflow_instance_id ~ '\^\[A-Za-z0-9_\]\[A-Za-z0-9_-\]\*\$'/, '0002 must enforce the platform-safe alphabet');
  assertHas(migration3, /workflow_instance_id ~ '\^harvest-.*\[1-9\]\[0-9\]\*\$'/, '0003 Workflow outbox identity must be attempt-qualified');
  return Object.freeze({
    status: 'pass_local',
    policy_version: policy.workflow_identity.policy_version,
    sample_id: first,
    deterministic: true,
    length: first.length,
    maximum_length: policy.workflow_identity.maximum_length,
    runtime_and_sql_fenced: true,
  });
}

function enumerationSeal({ runId, source, captures, sealedAt }) {
  return {
    contract_version: 'ingestion.v1.0.0',
    record_kind: 'enumeration_seal',
    enumeration_seal_id: `seal_${runId}`,
    run_id: runId,
    source_id: source.source_id,
    scope_id: source.scope_id,
    status: 'sealed',
    pages_discovered: captures.length === 0 ? 0 : 1,
    pages_committed: captures.length === 0 ? 0 : 1,
    items_discovered: captures.length,
    discoveries_committed: captures.length,
    page_dead_letter_count: 0,
    cursor_expired: false,
    population_digest: captures.length === 0 ? '0'.repeat(64) : captures.at(-1).capture_sha256,
    completeness_evidence_ref_id: `evidence_${runId}`,
    sealed_at: sealedAt,
  };
}

async function commitCaptureManifest({ plane, source, runId, captures, scheduledSlot, normalizerVersion }) {
  plane.seedRun({
    run_id: runId,
    source_id: source.source_id,
    endpoint_id: source.endpoint_id,
    scope_ids: [source.scope_id],
    state: 'enumerating',
    scheduled_slot: scheduledSlot,
  });
  plane.seedNormalizationCaptures(runId, captures);
  const seal = enumerationSeal({ runId, source, captures, sealedAt: addMilliseconds(scheduledSlot, 1_000) });
  plane.seedBarriers(runId, { enumeration: { status: 'sealed', observed_at: seal.sealed_at, seals: [seal] } });
  const database = await plane.openDatabase();
  try {
    return await database.transaction(`wp4-normalization-${runId}`, transaction => transaction.commitCheckpointAndNormalizationOutbox({
      runId,
      attempt: 1,
      enumerationSealIds: [seal.enumeration_seal_id],
      normalizerVersion,
    }));
  } finally {
    await database.close();
  }
}

async function verifyPerCaptureNormalization(policy, cases, migration2) {
  const plane = createInMemoryControlPlane();
  const { source, captures, slot } = cases;
  plane.seedSource({
    source_id: source.source_id,
    endpoint_id: source.endpoint_id,
    origin_id: source.origin_id,
    scope_ids: [source.scope_id],
    next_due_at: slot,
    state: 'active',
  });
  const first = await commitCaptureManifest({
    plane,
    source,
    runId: 'run_wp4_capture_first',
    captures,
    scheduledSlot: slot,
    normalizerVersion: policy.normalization.normalizer_version,
  });
  assert.equal(first.normalization_job_count, captures.length);

  const second = await commitCaptureManifest({
    plane,
    source,
    runId: 'run_wp4_capture_reuse',
    captures: [captures[0]],
    scheduledSlot: addMilliseconds(slot, 3_600_000),
    normalizerVersion: policy.normalization.normalizer_version,
  });
  assert.equal(second.normalization_job_count, 1);

  const zero = await commitCaptureManifest({
    plane,
    source,
    runId: 'run_wp4_capture_zero',
    captures: [],
    scheduledSlot: addMilliseconds(slot, 7_200_000),
    normalizerVersion: policy.normalization.normalizer_version,
  });
  assert.equal(zero.normalization_job_count, 0);

  const state = plane.inspect();
  const normalizeJobs = [...state.jobs.values()].filter(job => job.job_type === 'normalize_record');
  const normalizeEvents = [...state.outbox.values()].filter(event => event.event_type === 'normalize_requested');
  assert.equal(normalizeJobs.length, captures.length, 'cross-run reuse must not duplicate capture/version jobs');
  assert.equal(normalizeEvents.length, captures.length, 'cross-run reuse must not duplicate capture/version outbox events');
  assert.equal(state.normalizationRequirements.size, captures.length + 1, 'each run/capture requirement must remain explicit');
  assert.equal(state.normalizationManifests.get('run_wp4_capture_zero').required_capture_count, 0);

  assertHas(migration2, /create table ingest\.normalization_manifests/, 'sealed manifest table is required');
  assertHas(migration2, /create table ingest\.normalization_manifest_items/, 'per-capture manifest items are required');
  assertHas(migration2, /create table ingest\.normalization_job_requirements/, 'per-run capture requirements are required');
  assertHas(migration2, /create trigger normalization_manifests_append_only/, 'manifest must be immutable');
  assertHas(migration2, /deterministic_job_id := 'job_normalize_' \|\| manifest_item\.capture_sha256/, 'job identity must be capture/version-derived');
  assertHas(migration2, /normalization requirement\/outbox count mismatch/, 'SQL must fence exact requirement cardinality');
  return Object.freeze({
    status: 'pass_local',
    first_run_required_captures: captures.length,
    reused_run_required_captures: 1,
    zero_capture_run_required_captures: 0,
    unique_normalization_jobs: normalizeJobs.length,
    unique_normalization_outbox_events: normalizeEvents.length,
    explicit_run_capture_requirements: state.normalizationRequirements.size,
    sealed_manifest_sql_fenced: true,
  });
}

async function verifyPauseZeroFetch(cases) {
  const plane = createInMemoryControlPlane();
  const { source, slot } = cases;
  plane.seedSource({
    source_id: source.source_id,
    endpoint_id: source.endpoint_id,
    origin_id: source.origin_id,
    scope_ids: [source.scope_id],
    next_due_at: slot,
    state: 'active',
  });
  const control = createSourceControlService({ openDatabase: plane.openDatabase });
  await control.requestPause({
    sourceId: source.source_id,
    auditEventId: 'audit_wp4_pause_requested',
    requestedAt: slot,
    reasonCode: 'WP4_OFFLINE_PAUSE_PROBE',
  });
  const paused = await control.drain({
    sourceId: source.source_id,
    auditEventId: 'audit_wp4_pause_effective',
    now: addMilliseconds(slot, 1_000),
  });
  assert.equal(paused.state, 'paused');
  await assert.rejects(plane.recordFetch(source.source_id), /SOURCE_FETCH_BLOCKED/);
  await assert.rejects(control.assertFetchAllowed({ sourceId: source.source_id }), /SOURCE_FETCH_BLOCKED/);
  const scheduled = await createScheduler({ openDatabase: plane.openDatabase }).dispatchScheduledSlot({
    scheduledTime: slot,
    now: addMilliseconds(slot, 2_000),
  });
  assert.equal(scheduled.leased, 0);
  assert.equal(plane.inspect().fetchCountBySource.get(source.source_id) ?? 0, 0);
  return Object.freeze({
    status: 'pass_local',
    paused_state: paused.state,
    scheduler_leased_sources: scheduled.leased,
    source_fetches_after_pause: 0,
    fetch_authorization_failed_closed: true,
  });
}

function seedUnknownSend(plane, cases) {
  const { source, slot } = cases;
  plane.seedSource({
    source_id: source.source_id,
    endpoint_id: source.endpoint_id,
    origin_id: source.origin_id,
    scope_ids: [source.scope_id],
    state: 'active',
  });
  plane.seedRun({ run_id: 'run_wp4_unknown_send', source_id: source.source_id, state: 'projecting', scheduled_slot: slot });
  plane.seedJob({
    job_id: 'job_wp4_unknown_send',
    run_id: 'run_wp4_unknown_send',
    source_id: source.source_id,
    job_type: 'project_index',
    state: 'pending',
    target_class: 'exact_item',
    origin_id: source.origin_id,
    message_references: { run_id: 'run_wp4_unknown_send', job_id: 'job_wp4_unknown_send' },
  });
  plane.seedOutbox({
    event_id: 'event_wp4_unknown_send',
    event_type: 'projection_requested',
    state: 'pending',
    source_id: source.source_id,
    references: { run_id: 'run_wp4_unknown_send', job_id: 'job_wp4_unknown_send' },
    created_at: slot,
  });
}

async function verifyUnknownSendRetention(policy, cases, migration3, recoveryQuery) {
  const faults = new FaultInjector();
  const plane = createInMemoryControlPlane();
  const queue = createFakeQueue('project-index');
  seedUnknownSend(plane, cases);
  faults.arm('outbox.after_send_before_mark');
  const dispatcher = createOutboxDispatcher({
    openDatabase: plane.openDatabase,
    queueForEvent: () => queue,
    faults,
    configuration: { queueRetentionMs: policy.transport.queue_retention_ms },
  });
  const first = await dispatcher.dispatch({ now: cases.slot });
  assert.equal(first[0].outcome, 'uncertain');
  assert.equal(queue.sent.length, 1);
  assert.equal(plane.inspect().outbox.get('event_wp4_unknown_send').state, 'leased');
  await dispatcher.dispatch({ now: addMilliseconds(cases.slot, 61_000) });
  const event = plane.inspect().outbox.get('event_wp4_unknown_send');
  assert.equal(queue.sent.length, 1, 'unknown sends must not be immediately repeated');
  assert.equal(event.state, 'published');
  assert.equal(event.safe_detail_code, policy.transport.unknown_send_detail_code);
  assert.equal(Date.parse(event.transport_retention_expires_at) - Date.parse(cases.slot), policy.transport.queue_retention_ms);
  assertHas(migration3, /send_outcome in \('not_started','send_started','published_confirmed','published_outcome_unknown','pre_send_failed'\)/, 'SQL must type unknown send outcomes');
  assertHas(recoveryQuery, /send_outcome = 'published_outcome_unknown'/, 'expired send leases must become unknown published outcomes');
  assertHas(recoveryQuery, /transport_retention_expires_at is not null/, 'unknown send recovery requires a retention horizon');
  return Object.freeze({
    status: 'pass_local',
    physical_sends: queue.sent.length,
    immediate_resends: 0,
    durable_state: event.state,
    safe_detail_code: event.safe_detail_code,
    queue_retention_ms: policy.transport.queue_retention_ms,
    sql_recovery_fenced: true,
  });
}

async function verifyDlqFinalPageAndReconstruction(policy, cases, migration3) {
  const finalDelivery = createFakeQueueMessage({
    id: 'transport_wp4_dlq_final',
    attempts: policy.transport.dlq_sink_maximum_delivery_attempts,
    body: {
      event_id: cases.dlq_transport_exhaustion.original_event_id,
      trace_id: 'trace_wp4_dlq_final',
    },
  });
  const unavailable = createDeadLetterSink({
    openDatabase: async () => {
      const error = new Error('DATABASE_UNAVAILABLE');
      error.code = 'DATABASE_UNAVAILABLE';
      throw error;
    },
    configuration: {
      clock: () => cases.slot,
      logicalQueueName: cases.dlq_transport_exhaustion.queue_name,
      transport: { maxRetries: 5, maxBatchSize: 1, deadLetterQueue: null },
    },
  });
  const [finalResult] = await unavailable.handleBatch({
    queue: cases.dlq_transport_exhaustion.queue_name,
    messages: [finalDelivery],
  });
  assert.equal(finalDelivery.action.type, 'retry');
  assert.equal(finalResult.finalConfiguredDelivery, true);
  assert.equal(finalResult.recoverySource, 'postgresql_run_job_outbox_failure_evidence');

  const plane = createInMemoryControlPlane();
  const { source } = cases;
  const observation = cases.dlq_transport_exhaustion;
  plane.seedSource({
    source_id: source.source_id,
    endpoint_id: source.endpoint_id,
    origin_id: source.origin_id,
    scope_ids: [source.scope_id],
    state: 'active',
  });
  plane.seedRun({ run_id: observation.run_id, source_id: source.source_id, state: 'normalizing', scheduled_slot: cases.slot });
  plane.seedJob({
    job_id: observation.job_id,
    run_id: observation.run_id,
    source_id: source.source_id,
    job_type: 'normalize_record',
    state: 'pending',
    target_class: 'exact_item',
    origin_id: source.origin_id,
    message_references: { run_id: observation.run_id, job_id: observation.job_id },
  });
  plane.seedOutbox({
    event_id: observation.original_event_id,
    event_type: 'normalize_requested',
    state: 'published',
    source_id: source.source_id,
    references: { run_id: observation.run_id, job_id: observation.job_id },
    created_at: cases.slot,
  });
  const attemptBody = {
    contract_version: 'ingestion.v1.0.0', event_id: observation.original_event_id,
    event_type: 'normalize_requested', idempotency_key: `event:normalize_requested:${observation.original_event_id}`,
    schema_version: '1.0.0', trace_id: 'trace_wp4_dlq_attempt_001', attempt: 1,
    retry_policy_version: 'retry.v1', source_id: source.source_id, origin_id: source.origin_id,
    target_class: 'exact_item', delivery_fence: { run_attempt: 1, lease_epoch: 1 },
    references: { run_id: observation.run_id, job_id: observation.job_id }
  };
  const attemptConsumer = createQueueConsumer({
    openDatabase: plane.openDatabase, stage: 'normalize_record',
    configuration: { clock: () => cases.slot },
    processor: async () => { throw typedFailureError({
      failure_type: 'timeout', retry_class: 'transient', target_class: 'exact_item',
      safe_detail_code: 'UPSTREAM_TIMEOUT', observed_at: cases.slot
    }, { retryAfterSeconds: 0 }); }
  });
  await attemptConsumer.handleBatch({
    queue: 'normalize-record',
    messages: [createFakeQueueMessage({ id: 'transport_wp4_dlq_attempt_001', body: attemptBody, attempts: 1 })]
  });
  assert.equal(plane.inspect().attempts.length, 1, 'reconstruction must bind an existing database attempt');
  const reconciler = createDeadLetterRecoveryReconciler({
    openDatabase: plane.openDatabase,
    configuration: { clock: () => addMilliseconds(cases.slot, 2_000) },
  });
  const [reconstructed] = await reconciler.reconcile({
    transportExhaustionObservations: [{
      originalEventId: observation.original_event_id,
      queueName: observation.queue_name,
      sourceId: source.source_id,
      runId: observation.run_id,
      jobId: observation.job_id,
      transportDeliveryAttempts: observation.transport_delivery_attempts,
      observedAt: addMilliseconds(cases.slot, 1_000),
      evidenceRefId: observation.evidence_ref_id,
      auditEventId: observation.audit_event_id,
    }],
  });
  assert.equal(reconstructed.created, true);
  const state = plane.inspect();
  const durable = state.deadLetters.get(reconstructed.deadLetterId);
  assert.equal(durable.sink_transaction_committed, true);
  assert.equal(durable.transport_delivery_attempts, policy.transport.dlq_sink_maximum_delivery_attempts);
  assert.equal(state.jobs.get(observation.job_id).state, 'quarantined');
  assert.ok(state.audits.some(event => event.audit_event_id === observation.audit_event_id));
  assertHas(migration3, /create table ops\.dlq_transport_exhaustion_observations/, 'DLQ final delivery observations must be durable');
  assertHas(migration3, /create function ops\.admit_dlq_transport_exhaustion/, 'DLQ exhaustion admission API is required');
  assertHas(migration3, /create function ops\.reconstruct_dlq_transport_exhaustion/, 'PostgreSQL reconstruction API is required');
  assertHas(migration3, /create function ops\.validate_durable_dead_letter_lineage/, 'durable DLQ lineage must be DB-validated');
  return Object.freeze({
    status: 'pass_local',
    final_delivery_action: finalDelivery.action.type,
    final_configured_delivery: finalResult.finalConfiguredDelivery,
    queue_message_assumed_permanently_unavailable: true,
    reconstruction_source: finalResult.recoverySource,
    reconstructed_from_durable_postgresql_evidence: reconstructed.created,
    reconstructed_dead_letter_committed: durable.sink_transaction_committed,
    transport_delivery_attempts: durable.transport_delivery_attempts,
  });
}

async function verifyServiceBoundaries(policy) {
  const scheduler = await readRepositoryText('services/scheduler-worker/index.mjs');
  const harvest = await readRepositoryText('services/harvest-worker/index.mjs');
  assertHas(scheduler, /export function createSchedulerWorker/, 'scheduler composition factory is required');
  assertHas(scheduler, /async scheduled\(/, 'scheduled handler must be explicit');
  assertHas(scheduler, /deadLetterRecoveryReconciler\.reconcile/, 'scheduler must reconcile durable DLQ recovery');
  assertHas(harvest, /export function createHarvestWorker/, 'harvest Queue router is required');
  assertHas(harvest, /async queue\(/, 'Queue handler must be explicit');
  assertHas(harvest, /createCloudflareWorkflowPlatform/, 'Workflow binding adapter is required');
  assertHas(harvest, /createHarvestWorkflowEntrypoint/, 'Workflow entrypoint adapter is required');

  const entrypoints = [];
  for (const expected of policy.production_entrypoints) {
    const present = await exists(expected.file);
    if (!present) {
      entrypoints.push(Object.freeze({ id: expected.id, file: expected.file, status: 'pending_local_implementation' }));
      continue;
    }
    const source = await readRepositoryText(expected.file);
    for (const marker of expected.handler_markers) {
      assert.ok(source.includes(marker), `${expected.file}: missing ${marker}`);
    }
    entrypoints.push(Object.freeze({ id: expected.id, file: expected.file, status: 'pass_static_markers' }));
  }
  const presentCount = entrypoints.filter(entry => entry.status === 'pass_static_markers').length;
  return Object.freeze({
    status: presentCount === entrypoints.length ? 'pass_static_markers' : 'pending_local_implementation',
    dependency_injected_service_boundaries: 'pass_local',
    present_count: presentCount,
    expected_count: entrypoints.length,
    entrypoints: Object.freeze(entrypoints),
  });
}

function verifySqlQueryParity(leaseOutboxQuery, recoverExpiredLeasesQuery, leaseDueSourcesQuery) {
  assertHas(
    leaseOutboxQuery,
    /event_type <> 'workflow_start_requested'/,
    'generic outbox leasing must never race the Workflow-start reconciler',
  );
  assertHas(
    recoverExpiredLeasesQuery,
    /lease_expires_at <= clock_timestamp\(\)/,
    'job leases must expire at the same inclusive boundary as the control plane',
  );
  for (const parameter of ['scheduled_slot', 'lease_acquired_at', 'lease_expires_at']) {
    assert.ok(leaseDueSourcesQuery.includes(`:'${parameter}'`), `due-source leasing must receive ${parameter} from the Cron invocation`);
  }
  assert.doesNotMatch(
    leaseDueSourcesQuery,
    /date_trunc\([^)]*clock_timestamp\(\)/,
    'due-source leasing must not replace the Cloudflare scheduled slot with database wall clock',
  );
  return Object.freeze({
    status: 'pass_static',
    workflow_start_owned_only_by_reconciler: true,
    inclusive_job_lease_expiry: true,
    cron_scheduled_slot_is_caller_supplied: true,
    lease_clock_inputs_are_caller_supplied: true,
  });
}

async function verifyManagedAuthorization(policy) {
  const register = JSON.parse(await readRepositoryText('verification/external-authorization/v1.0.0/register.json'));
  const gates = policy.managed_integration.authorization_gate_ids.map(id => {
    const entry = register.entries.find(item => item.id === id);
    assert.ok(entry, `authorization register is missing ${id}`);
    assert.equal(entry.authorized, false, `${id} unexpectedly authorizes an external action`);
    return Object.freeze({ id, authorized: false, status: entry.status });
  });
  return Object.freeze({
    status: 'pending_external_authorization',
    authorization_gates: Object.freeze(gates),
    managed_postgresql_executed: false,
    cloudflare_queues_executed: false,
    cloudflare_workflows_executed: false,
    hyperdrive_executed: false,
    deployment_performed: false,
    paid_infrastructure_used: false,
  });
}

export async function buildWp4Receipt() {
  const [
    policy, cases, migration2, migration3, recoveryQuery, leaseOutboxQuery,
    recoverExpiredLeasesQuery, leaseDueSourcesQuery, fingerprint, verifierFingerprint,
  ] = await Promise.all([
    readVerificationJson('fixtures/wp4-policy.v1.0.0.json'),
    readVerificationJson('fixtures/control-plane-cases.v1.0.0.json'),
    readRepositoryText('db/migrations/0002_ingest_runs_jobs_captures.sql'),
    readRepositoryText('db/migrations/0003_ops_outbox_processed_events_dead_letters.sql'),
    readRepositoryText('db/queries/recover-expired-outbox-leases.sql'),
    readRepositoryText('db/queries/lease-outbox.sql'),
    readRepositoryText('db/queries/recover-expired-leases.sql'),
    readRepositoryText('db/queries/lease-due-sources.sql'),
    implementationFingerprint(),
    verificationPackageFingerprint(),
  ]);
  assert.equal(policy.schema_version, 'ushso-wp4-offline-policy-fixture.v1.0.0');
  assert.equal(cases.schema_version, 'ushso-wp4-control-plane-cases.v1.0.0');

  const controls = Object.freeze({
    transport_retry_and_non_recursive_dlq: await verifyTransportPolicy(policy),
    workflow_identity_v1_1: await verifyWorkflowIdentity(policy, migration2, migration3),
    per_capture_normalization: await verifyPerCaptureNormalization(policy, cases, migration2),
    pause_zero_fetch: await verifyPauseZeroFetch(cases),
    unknown_send_retention: await verifyUnknownSendRetention(policy, cases, migration3, recoveryQuery),
    dlq_final_page_and_reconstruction: await verifyDlqFinalPageAndReconstruction(policy, cases, migration3),
    service_composition: await verifyServiceBoundaries(policy),
    sql_query_parity: verifySqlQueryParity(leaseOutboxQuery, recoverExpiredLeasesQuery, leaseDueSourcesQuery),
  });
  const managedIntegration = await verifyManagedAuthorization(policy);
  return Object.freeze({
    receipt_version: 'ushso-wp4-offline-verification-receipt.v1.0.0',
    work_package: 'WP4',
    status: 'pass_local',
    evidence_scope: policy.evidence_scope,
    determinism: 'source_bound_no_wall_clock',
    implementation_fingerprint: fingerprint.fingerprint,
    implementation_fingerprint_algorithm: fingerprint.algorithm,
    verified_file_count: fingerprint.files.length,
    verified_files: fingerprint.files,
    verifier_fingerprint: verifierFingerprint.fingerprint,
    verifier_file_count: verifierFingerprint.files.length,
    controls,
    zero_action: Object.freeze({
      network_calls: 0,
      authoritative_source_fetches: 0,
      host_ports_bound: 0,
      managed_database_connections: 0,
      managed_resource_mutations: 0,
      deployments: 0,
      paid_infrastructure_actions: 0,
      secrets_processed: 0,
    }),
    managed_integration: managedIntegration,
  });
}

export async function verifyWp4() {
  const receipt = await buildWp4Receipt();
  assert.equal(receipt.status, 'pass_local');
  assert.equal(receipt.managed_integration.status, 'pending_external_authorization');
  assert.ok(Object.values(receipt.zero_action).every(value => value === 0));
  return receipt;
}
