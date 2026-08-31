import { canonicalJson, clone, deterministicOpaqueId, FaultInjector, invariant, iso, parseTimestamp, sha256Hex } from './common.mjs';
import { STAGE_POLICIES } from './failure-policy.mjs';

function initialState() {
  return {
    sources: new Map(), runs: new Map(), runKeys: new Map(), outbox: new Map(), outboxAttempts: [], workflowMappings: new Map(),
    jobs: new Map(), checkpoints: new Map(), activeCheckpoints: new Map(), processedEvents: new Map(), businessEffects: new Map(), attempts: [], attemptEvents: new Map(),
    deadLetters: new Map(), deadLetterSinkEvents: [], deadLetterTransportExhaustions: new Map(), replays: new Map(), audits: [], originBuckets: new Map(), circuits: new Map(),
    barriers: new Map(), normalizationCaptures: new Map(), normalizationManifests: new Map(), normalizationRequirements: new Map(), normalizationArtifacts: new Map(),
    gcPartitions: new Map(), gcProofs: new Map(), clientLifecycle: [], fetchCountBySource: new Map()
  };
}

function safeReferences(input = {}) {
  return {
    run_id: input.run_id ?? null, job_id: input.job_id ?? null, capture_ref_id: input.capture_ref_id ?? null,
    checkpoint_id: input.checkpoint_id ?? null, canonical_id: input.canonical_id ?? null,
    canonical_revision_id: input.canonical_revision_id ?? null, r2_key: input.r2_key ?? null, cursor_ref_id: input.cursor_ref_id ?? null
  };
}

const EVENT_TYPE_BY_JOB = Object.freeze({
  harvest_page: 'harvest_page_requested', normalize_record: 'normalize_requested',
  enrich_schema: 'schema_enrichment_requested', access_check: 'access_check_requested',
  project_index: 'projection_requested'
});

const JOB_BY_EVENT_TYPE = Object.freeze(Object.fromEntries(
  Object.entries(EVENT_TYPE_BY_JOB).map(([jobType, eventType]) => [eventType, jobType])
));

const DLQ_BY_JOB = Object.freeze({
  harvest_page: 'harvest-page-dlq', normalize_record: 'normalize-record-dlq',
  enrich_schema: 'enrich-schema-dlq', access_check: 'access-check-dlq',
  project_index: 'project-index-dlq'
});

const DEFAULT_TARGET_BY_JOB = Object.freeze({
  harvest_page: 'catalog_root', normalize_record: 'exact_item', enrich_schema: 'documentation',
  access_check: 'exact_distribution', project_index: 'exact_item'
});

export function createInMemoryControlPlane({ faults = new FaultInjector() } = {}) {
  let state = initialState();
  let clientSequence = 0;
  let transactionTail = Promise.resolve();

  const RUN_TRANSITIONS = new Map([
    ['scheduled', new Set(['starting', 'failed', 'cancelled', 'partial_unpublished'])],
    ['starting', new Set(['enumerating', 'failed', 'cancelled', 'partial_unpublished'])],
    ['enumerating', new Set(['enumerated', 'failed', 'cancelled', 'partial_unpublished'])],
    ['enumerated', new Set(['normalizing', 'failed', 'cancelled', 'partial_unpublished'])],
    ['normalizing', new Set(['projecting', 'failed', 'cancelled', 'partial_unpublished'])],
    ['projecting', new Set(['published', 'failed', 'cancelled', 'partial_unpublished'])],
    ['published', new Set(['succeeded', 'succeeded_with_optional_degradation', 'failed', 'cancelled'])]
  ]);

  function transitionRun(run, nextState, recordedAt, reasonCode) {
    invariant(run && run.terminal_at === null && RUN_TRANSITIONS.get(run.state)?.has(nextState), 'RUN_STATE_TRANSITION_REJECTED', `${run?.state}:${nextState}`);
    run.state = nextState;
    run.state_history.push({ state: nextState, recorded_at: recordedAt, reason_code: reasonCode });
    if (['succeeded', 'succeeded_with_optional_degradation', 'failed', 'cancelled', 'partial_unpublished'].includes(nextState)) run.terminal_at = recordedAt;
  }

  function closeWorkflowMapping(run, platformState, terminalAt) {
    const mapping = state.workflowMappings.get(`${run.run_id}:${run.active_attempt}`);
    if (!mapping) return;
    mapping.platform_state = platformState;
    mapping.is_active = false;
    mapping.terminal_at = terminalAt;
  }

  function contractFailure(failure) {
    if (failure === null || failure === undefined) return null;
    const clean = {
      failure_type: failure.failure_type,
      retry_class: failure.retry_class,
      target_class: failure.target_class,
      safe_detail_code: failure.safe_detail_code,
      observed_at: failure.observed_at
    };
    if (failure.http_status !== undefined) clean.http_status = failure.http_status;
    return clean;
  }

  async function upsertAttempt(job, input) {
    invariant(job, 'ATTEMPT_JOB_NOT_FOUND', input.jobId ?? 'unknown');
    const deliveryAttempt = input.deliveryAttempt;
    invariant(Number.isInteger(deliveryAttempt) && deliveryAttempt >= 1, 'ATTEMPT_INVALID', String(deliveryAttempt));
    const firstAttemptAt = job.first_attempt_at ?? input.startedAt;
    job.first_attempt_at = firstAttemptAt;
    job.updated_at = input.finishedAt ?? input.startedAt;
    const attemptId = await deterministicOpaqueId('attempt', { jobId: job.job_id, logicalAttempt: deliveryAttempt });
    const record = {
      contract_version: 'ingestion.v1.0.0', attempt_id: attemptId,
      job_id: job.job_id, run_id: job.run_id, delivery_attempt: deliveryAttempt,
      maximum_delivery_attempts: job.maximum_delivery_attempts,
      retry_policy_version: input.retryPolicyVersion ?? job.retry_policy_version,
      first_attempt_at: firstAttemptAt, started_at: input.startedAt,
      finished_at: input.finishedAt ?? null,
      delivery_fence: clone(input.deliveryFence ?? job.delivery_fence),
      failure: contractFailure(input.failure), retry_after_seconds: input.retryAfterSeconds ?? null,
      computed_delay_seconds: input.computedDelaySeconds ?? null,
      next_eligible_at: input.nextEligibleAt ?? null,
      database_transaction_committed: input.databaseTransactionCommitted ?? true,
      transport_action: input.transportAction,
      durable_dead_letter_id: input.durableDeadLetterId ?? null
    };
    const priorIndex = state.attempts.findIndex(attempt => attempt.attempt_id === attemptId);
    if (priorIndex >= 0) state.attempts[priorIndex] = record;
    else state.attempts.push(record);
    state.attemptEvents.set(attemptId, input.eventId);
    if (!job.attempt_ids.includes(attemptId)) job.attempt_ids.push(attemptId);
    return record;
  }

  function seedSource(source) {
    const scopeIds = clone(source.scope_ids ?? []);
    const schedules = clone(source.schedules ?? scopeIds.map(scopeId => ({ scope_id: scopeId }))).map(schedule => ({
      ...schedule,
      cadence_seconds: schedule.cadence_seconds ?? source.cadence_seconds ?? 3_600,
      next_due_at: schedule.next_due_at ?? source.next_due_at ?? '2026-08-30T00:00:00.000Z',
      last_scheduled_slot: schedule.last_scheduled_slot ?? null,
      mode: schedule.mode ?? source.mode ?? 'incremental',
      configuration_revision: schedule.configuration_revision ?? source.configuration_revision ?? 1,
      optional_degradation_policy: clone(schedule.optional_degradation_policy ?? source.optional_degradation_policy ?? []),
      state: schedule.state ?? 'active'
    }));
    state.sources.set(source.source_id, {
      source_id: source.source_id, endpoint_id: source.endpoint_id, scope_ids: scopeIds, schedules,
      origin_id: source.origin_id ?? `origin_${source.endpoint_id}`,
      configuration_revision: source.configuration_revision ?? 1, mode: source.mode ?? 'incremental',
      next_due_at: source.next_due_at ?? '2026-08-30T00:00:00.000Z', state: source.state ?? 'active', lease: null,
      connector_version: source.connector_version ?? 'connector.v1',
      optional_degradation_policy: clone(source.optional_degradation_policy ?? []),
      state_history: [{ state: source.state ?? 'active', recorded_at: source.next_due_at ?? '2026-08-30T00:00:00.000Z', reason_code: 'SEEDED' }]
    });
  }

  function seedJob(job) {
    const jobType = job.job_type ?? 'normalize_record';
    const runAttempt = job.active_run_attempt ?? job.delivery_fence?.run_attempt ?? 1;
    const leaseEpoch = job.delivery_fence?.lease_epoch ?? 1;
    state.jobs.set(job.job_id, {
      job_id: job.job_id, run_id: job.run_id, source_id: job.source_id, state: job.state ?? 'pending',
      job_type: jobType, active_run_attempt: runAttempt,
      attempt_count: job.attempt_count ?? 0, maximum_delivery_attempts: job.maximum_delivery_attempts ?? STAGE_POLICIES[jobType].maximumDeliveryAttempts,
      delivery_fence: { run_attempt: runAttempt, lease_epoch: leaseEpoch }, lease: clone(job.lease ?? null),
      next_eligible_at: job.next_eligible_at ?? null, last_transport_event_id: job.last_transport_event_id ?? null,
      transport_retention_expires_at: job.transport_retention_expires_at ?? null,
      transport_generation: job.transport_generation ?? 1, retry_policy_version: job.retry_policy_version ?? 'retry.v1',
      first_attempt_at: job.first_attempt_at ?? null, updated_at: job.updated_at ?? '2026-08-30T00:00:00.000Z',
      event_type: job.event_type ?? EVENT_TYPE_BY_JOB[jobType],
      target_class: job.target_class ?? DEFAULT_TARGET_BY_JOB[jobType],
      origin_id: job.origin_id ?? null, scope_id: job.scope_id ?? null,
      idempotency_key: job.idempotency_key ?? null,
      capture_sha256: job.capture_sha256,
      normalizer_version: job.normalizer_version,
      logical_idempotency_key: job.logical_idempotency_key,
      replay_of_job_id: job.replay_of_job_id,
      message_references: safeReferences(job.message_references ?? { run_id: job.run_id, job_id: job.job_id }),
      attempt_ids: clone(job.attempt_ids ?? [])
    });
  }

  function seedRun(run) {
    const scopeIds = clone(run.scope_ids ?? ['scope_fixture']);
    const expectedCheckpointHeads = Object.fromEntries(scopeIds.map(scopeId => {
      const checkpointId = state.activeCheckpoints.get(`${run.source_id}:${scopeId}`) ?? null;
      const checkpoint = checkpointId ? state.checkpoints.get(checkpointId) : null;
      return [scopeId, { checkpoint_id: checkpointId, checkpoint_digest: checkpoint?.checkpoint_digest ?? null }];
    }));
    state.runs.set(run.run_id, {
      run_id: run.run_id, source_id: run.source_id, endpoint_id: run.endpoint_id ?? 'endpoint_fixture', scope_ids: scopeIds,
      configuration_revision: run.configuration_revision ?? 1, scheduled_slot: run.scheduled_slot ?? '2026-08-30T00:00:00.000Z', mode: run.mode ?? 'incremental',
      run_idempotency_key: run.run_idempotency_key ?? `fixture:${run.run_id}`, state: run.state ?? 'normalizing', active_attempt: run.active_attempt ?? 1,
      workflow_instance_id: run.workflow_instance_id ?? `harvest-${run.run_id}-${run.active_attempt ?? 1}`, workflow_version: run.workflow_version ?? '1.0.0',
      workflow_retention_expires_at: run.workflow_retention_expires_at ?? '2026-09-29T00:00:00.000Z', deadline_at: run.deadline_at ?? '2026-08-31T00:00:00.000Z',
      terminal_at: run.terminal_at ?? null, trace_id: run.trace_id ?? `trace_${run.run_id}`, last_known_good_publication_id: run.last_known_good_publication_id ?? 'publication_last_known_good',
      publication_id: run.publication_id ?? null,
      expected_checkpoint_heads: clone(run.expected_checkpoint_heads ?? expectedCheckpointHeads),
      optional_degradation_policy: clone(run.optional_degradation_policy ?? []),
      barrier_policy: clone(run.barrier_policy ?? { policyVersion: 'barrier.v1', pollDelayMs: 60_000, maximumChecks: 1600, workflowStepBudget: 10_000 }),
      state_history: clone(run.state_history ?? [{ state: run.state ?? 'normalizing', recorded_at: run.scheduled_slot ?? '2026-08-30T00:00:00.000Z', reason_code: 'SEEDED' }])
    });
  }

  function seedBarriers(runId, barriers) {
    const seeded = clone(barriers);
    const enumerationSeals = Array.isArray(seeded.enumeration?.seals) ? seeded.enumeration.seals : seeded.enumeration?.record_kind === 'enumeration_seal' ? [seeded.enumeration] : [];
    for (const seal of enumerationSeals) seal.run_id = runId;
    if (seeded.projection?.record_kind === 'publication_barrier') seeded.projection.run_id = runId;
    state.barriers.set(runId, seeded);
    if (!state.normalizationCaptures.has(runId)) {
      const revisionCount = seeded.normalization?.observed_revision_count;
      const discoveredCount = enumerationSeals.reduce((sum, seal) => sum + (Number.isInteger(seal.discoveries_committed) ? seal.discoveries_committed : 0), 0);
      const requiredCount = Number.isInteger(revisionCount) ? revisionCount : discoveredCount;
      const captures = [];
      for (let index = 0; index < requiredCount; index += 1) {
        const seed = `${runId}:${index}`;
        let digest = '';
        for (let salt = 0; salt < 8; salt += 1) {
          let hash = 2166136261 ^ salt;
          for (const character of seed) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
          digest += (hash >>> 0).toString(16).padStart(8, '0');
        }
        captures.push({ capture_ref_id: `capture_${runId}_${index + 1}`, capture_sha256: digest, capture_kind: 'metadata', discovery_ref_id: `discovery_${runId}_${index + 1}` });
      }
      state.normalizationCaptures.set(runId, captures);
    }
  }

  function seedNormalizationCaptures(runId, captures) {
    invariant(Array.isArray(captures), 'NORMALIZATION_CAPTURE_FIXTURE_INVALID', runId);
    const normalized = captures.map((capture, index) => ({
      capture_ref_id: capture.capture_ref_id ?? `capture_${runId}_${index + 1}`,
      capture_sha256: capture.capture_sha256,
      capture_kind: capture.capture_kind ?? 'metadata',
      discovery_ref_id: capture.discovery_ref_id ?? `discovery_${runId}_${index + 1}`
    }));
    invariant(normalized.every(capture => /^[a-f0-9]{64}$/.test(capture.capture_sha256) && ['metadata', 'documentation'].includes(capture.capture_kind)), 'NORMALIZATION_CAPTURE_FIXTURE_INVALID', runId);
    state.normalizationCaptures.set(runId, clone(normalized));
  }

  function seedWorkflowMapping(mapping) {
    state.workflowMappings.set(`${mapping.run_id}:${mapping.attempt}`, {
      ...clone(mapping), is_active: mapping.is_active ?? true,
      platform_state: mapping.platform_state ?? 'running',
      last_reconciled_at: mapping.last_reconciled_at ?? null,
      terminal_at: mapping.terminal_at ?? null
    });
  }

  function enumerationObservation(run) {
    const raw = state.barriers.get(run.run_id)?.enumeration;
    const seals = clone(Array.isArray(raw?.seals) ? raw.seals : raw?.record_kind === 'enumeration_seal' ? [raw] : []);
    const expectedScopes = [...run.scope_ids].sort();
    const observedScopes = seals.map(seal => seal.scope_id);
    const missingScopeIds = expectedScopes.filter(scopeId => !observedScopes.includes(scopeId));
    const duplicateScopeIds = [...new Set(observedScopes.filter((scopeId, index) => observedScopes.indexOf(scopeId) !== index))].sort();
    const foreignScopeIds = [...new Set(observedScopes.filter(scopeId => !expectedScopes.includes(scopeId)))].sort();
    const allSealed = seals.length === expectedScopes.length && missingScopeIds.length === 0 && duplicateScopeIds.length === 0 && foreignScopeIds.length === 0 && seals.every(seal => seal.status === 'sealed');
    const terminalTimes = seals.map(seal => seal.sealed_at).filter(Boolean).sort();
    return {
      record_kind: 'enumeration_barrier_observation',
      status: raw?.status === 'failed' || raw?.status === 'cursor_expired' ? raw.status : allSealed ? 'sealed' : raw?.status ?? 'open',
      checked_at: raw?.checked_at ?? raw?.observed_at ?? null,
      sealed_at: allSealed ? terminalTimes.at(-1) : null,
      observed_at: raw?.observed_at ?? null,
      seals,
      missing_scope_ids: missingScopeIds,
      duplicate_scope_ids: duplicateScopeIds,
      foreign_scope_ids: foreignScopeIds
    };
  }

  function seedOutbox(event) {
    const jobType = JOB_BY_EVENT_TYPE[event.event_type];
    state.outbox.set(event.event_id, {
      event_id: event.event_id, event_type: event.event_type, state: event.state ?? 'pending',
      attempt_count: event.attempt_count ?? 0,
      maximum_delivery_attempts: event.maximum_delivery_attempts ?? (jobType ? STAGE_POLICIES[jobType].maximumDeliveryAttempts : 6),
      retry_policy_version: event.retry_policy_version ?? 'retry.v1', trace_id: event.trace_id ?? 'trace_fixture_event',
      schema_version: event.schema_version ?? '1.0.0', references: safeReferences(event.references),
      idempotency_key: event.idempotency_key ?? `event:${event.event_type}:${event.event_id}`,
      source_id: event.source_id ?? null, run_attempt: event.run_attempt ?? 1, job_lease_epoch: event.job_lease_epoch ?? 1,
      transport_retention_expires_at: event.transport_retention_expires_at ?? null,
      next_eligible_at: event.next_eligible_at ?? null, delay_seconds: event.delay_seconds ?? 0, lease: null,
      workflow_instance_id: event.workflow_instance_id ?? null, attempt: event.attempt ?? 1,
      created_at: event.created_at ?? '2026-08-30T00:00:00.000Z', published_at: null
    });
  }

  function seedGcPartition(partition, dependencies) {
    state.gcPartitions.set(partition.partition_id, { ...clone(partition), dependencies: clone(dependencies), deleted: false });
  }

  function coreMethods(clientId) {
    return {
      async transaction(label, callback) {
        const predecessor = transactionTail;
        let release;
        transactionTail = new Promise(resolve => { release = resolve; });
        await predecessor;
        const snapshot = structuredClone(state);
        let committed = false;
        try {
          faults.hit(`transaction.${label}.before_work`);
          const result = await callback(this);
          faults.hit(`transaction.${label}.before_commit`);
          committed = true;
          faults.hit(`transaction.${label}.after_commit_response`);
          return result;
        } catch (error) {
          if (!committed) state = snapshot;
          throw error;
        } finally {
          release();
        }
      },

      async leaseDueSources({ scheduledSlot, leaseAcquiredAt = scheduledSlot, leaseOwner, leaseExpiresAt, limit }) {
        const slot = parseTimestamp(scheduledSlot);
        const now = parseTimestamp(leaseAcquiredAt);
        const results = [];
        const candidates = [...state.sources.values()].filter(source =>
          source.state === 'active' &&
          source.schedules.some(schedule => schedule.state === 'active' && parseTimestamp(schedule.next_due_at) <= slot) &&
          (!source.lease || parseTimestamp(source.lease.expires_at) <= now)
        ).sort((left, right) => left.source_id.localeCompare(right.source_id));
        for (const source of candidates) {
          if (results.length >= limit) break;
          const groups = new Map();
          for (const schedule of source.schedules.filter(item => item.state === 'active' && parseTimestamp(item.next_due_at) <= slot)) {
            const key = `${schedule.mode}\u0000${schedule.configuration_revision}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(schedule);
          }
          const selectedGroups = [...groups.values()]
            .sort((left, right) => `${left[0].mode}:${left[0].configuration_revision}`.localeCompare(`${right[0].mode}:${right[0].configuration_revision}`))
            .slice(0, limit - results.length);
          if (selectedGroups.length === 0) continue;
          const epoch = (source.lease?.epoch ?? 0) + 1;
          const pendingScopeIds = selectedGroups.flatMap(group => group.map(schedule => schedule.scope_id));
          source.lease = {
            owner_id: leaseOwner, token: `${leaseOwner}_${source.source_id}_e${epoch}`, epoch,
            expires_at: leaseExpiresAt, pending_scope_ids: pendingScopeIds
          };
          for (const dueSchedules of selectedGroups) {
            const policies = dueSchedules.map(schedule => canonicalJson(schedule.optional_degradation_policy ?? []));
            results.push({
              ...clone(source), scope_ids: dueSchedules.map(schedule => schedule.scope_id),
              mode: dueSchedules[0].mode, configuration_revision: dueSchedules[0].configuration_revision,
              optional_degradation_policy: clone(dueSchedules[0].optional_degradation_policy ?? []),
              source_lease_token: source.lease.token,
              schedule_error_code: new Set(policies).size === 1 ? null : 'SOURCE_SCOPE_POLICY_REVISION_MISMATCH'
            });
          }
        }
        return results;
      },

      async ensureRunAndWorkflowOutbox(input) {
        const existingId = state.runKeys.get(input.runIdempotencyKey);
        if (existingId) return { created: false, run_id: existingId };
        invariant(!state.runs.has(input.runId), 'RUN_ID_COLLISION', input.runId);
        const run = {
          run_id: input.runId, source_id: input.sourceId, endpoint_id: input.endpointId, scope_ids: clone(input.scopeIds),
          configuration_revision: input.configurationRevision, scheduled_slot: input.scheduledSlot, mode: input.mode,
          run_idempotency_key: input.runIdempotencyKey, state: 'scheduled', active_attempt: input.activeAttempt,
          workflow_instance_id: input.workflowInstanceId, workflow_version: input.workflowVersion,
          workflow_retention_expires_at: input.workflowRetentionExpiresAt,
          deadline_at: input.deadlineAt, terminal_at: null,
          trace_id: input.traceId, last_known_good_publication_id: 'publication_last_known_good', publication_id: null,
          expected_checkpoint_heads: Object.fromEntries(input.scopeIds.map(scopeId => {
            const checkpointId = state.activeCheckpoints.get(`${input.sourceId}:${scopeId}`) ?? null;
            const checkpoint = checkpointId ? state.checkpoints.get(checkpointId) : null;
            return [scopeId, { checkpoint_id: checkpointId, checkpoint_digest: checkpoint?.checkpoint_digest ?? null }];
          }))
          , optional_degradation_policy: clone(input.optionalDegradationPolicy ?? []),
          barrier_policy: clone(input.barrierPolicy),
          state_history: [{ state: 'scheduled', recorded_at: input.scheduledSlot, reason_code: 'SCHEDULED_SLOT' }]
        };
        state.runs.set(run.run_id, run); state.runKeys.set(input.runIdempotencyKey, run.run_id);
        const eventId = `event_workflow_${run.run_id}`;
        seedOutbox({
          event_id: eventId, event_type: 'workflow_start_requested', workflow_instance_id: input.workflowInstanceId,
          attempt: input.activeAttempt, trace_id: input.traceId, references: { run_id: run.run_id }, created_at: input.scheduledSlot
        });
        const source = state.sources.get(input.sourceId);
        invariant(source?.lease?.token === input.sourceLeaseToken && input.scopeIds.every(scopeId => source.lease.pending_scope_ids.includes(scopeId) && source.schedules.some(schedule => schedule.scope_id === scopeId)), 'SOURCE_SCHEDULE_ADVANCE_FENCE_REJECTED', input.sourceId);
        for (const schedule of source.schedules.filter(schedule => input.scopeIds.includes(schedule.scope_id))) {
          invariant(parseTimestamp(schedule.next_due_at) <= parseTimestamp(input.scheduledSlot), 'SOURCE_SCHEDULE_NOT_DUE', schedule.scope_id);
          schedule.last_scheduled_slot = input.scheduledSlot;
          schedule.next_due_at = iso(parseTimestamp(input.scheduledSlot) + schedule.cadence_seconds * 1_000);
        }
        source.next_due_at = source.schedules.map(schedule => schedule.next_due_at).sort()[0];
        source.last_scheduled_slot = input.scheduledSlot;
        source.lease.pending_scope_ids = source.lease.pending_scope_ids.filter(scopeId => !input.scopeIds.includes(scopeId));
        if (source.lease.pending_scope_ids.length === 0) source.lease = null;
        return { created: true, run_id: run.run_id, event_id: eventId };
      },

      async recordScheduleDispatchFailure({ sourceId, sourceLeaseToken, scopeIds, scheduledSlot, reasonCode, quarantine = false }) {
        const source = state.sources.get(sourceId);
        invariant(source?.lease?.token === sourceLeaseToken, 'SOURCE_SCHEDULE_FAILURE_FENCE_REJECTED', sourceId);
        invariant(scopeIds.every(scopeId => source.lease.pending_scope_ids.includes(scopeId)), 'SOURCE_SCHEDULE_FAILURE_SCOPE_REJECTED', sourceId);
        if (quarantine) {
          for (const schedule of source.schedules.filter(schedule => scopeIds.includes(schedule.scope_id))) schedule.state = 'quarantined';
        }
        source.lease.pending_scope_ids = source.lease.pending_scope_ids.filter(scopeId => !scopeIds.includes(scopeId));
        if (source.lease.pending_scope_ids.length === 0) source.lease = null;
        state.audits.push({ action: 'schedule_dispatch_failed', source_id: sourceId, scope_ids: clone(scopeIds), recorded_at: scheduledSlot, reason_code: reasonCode, outcome: quarantine ? 'quarantined' : 'released_for_retry' });
        return { source_id: sourceId, quarantined: quarantine };
      },

      async leaseOutbox({ now, ownerId, leaseExpiresAt, transportRetentionExpiresAt = null, limit, excludeEventTypes = [] }) {
        const current = parseTimestamp(now);
        for (const event of state.outbox.values()) {
          if (!excludeEventTypes.includes(event.event_type) && event.state === 'leased' && parseTimestamp(event.lease.expires_at) <= current) {
            // The send completed before the mark failed, so non-delivery is
            // unknowable. Treat the event as potentially published and wait
            // through its full Queue-retention horizon; the job ledger will
            // then re-ledger with a fresh fence if no consumer committed.
            event.state = 'published'; event.published_at = now;
            event.safe_detail_code = 'OUTBOX_SEND_OUTCOME_UNKNOWN_AWAITING_QUEUE_RETENTION'; event.lease = null;
            state.outboxAttempts.push({ event_id: event.event_id, attempt: event.attempt_count, outcome: 'published_unknown_after_lease_expiry', recorded_at: now });
            state.audits.push({
              action: 'outbox_send_outcome_unknown', event_id: event.event_id,
              run_id: event.references?.run_id ?? null, job_id: event.references?.job_id ?? null,
              recorded_at: now, reason_code: 'OUTBOX_SEND_OUTCOME_UNKNOWN_AWAITING_QUEUE_RETENTION'
            });
          }
        }
        return [...state.outbox.values()].filter(event =>
          !excludeEventTypes.includes(event.event_type) &&
          (event.state === 'pending' || event.state === 'retry_wait') &&
          event.attempt_count < event.maximum_delivery_attempts &&
          (event.next_eligible_at === null || parseTimestamp(event.next_eligible_at) <= current)
        ).sort((a, b) => a.event_id.localeCompare(b.event_id)).slice(0, limit).map(event => {
          const epoch = (event.lease?.epoch ?? 0) + 1;
          event.attempt_count += 1;
          event.first_attempt_at ??= now;
          event.state = 'leased';
          event.lease = { owner_id: ownerId, token: `lease_${event.event_id}_e${epoch}`, epoch, expires_at: leaseExpiresAt };
          if (transportRetentionExpiresAt !== null) {
            event.transport_retention_expires_at = transportRetentionExpiresAt;
            const job = state.jobs.get(event.references?.job_id);
            if (job) {
              job.last_transport_event_id = event.event_id;
              job.transport_retention_expires_at = transportRetentionExpiresAt;
            }
          }
          state.outboxAttempts.push({ event_id: event.event_id, attempt: event.attempt_count, outcome: 'send_started', recorded_at: now, lease_epoch: epoch });
          return { ...clone(event), lease_token: event.lease.token };
        });
      },

      async loadQueueRouting({ eventId, eventType, sourceId, jobId }) {
        const event = state.outbox.get(eventId);
        const source = state.sources.get(sourceId);
        const job = state.jobs.get(jobId);
        invariant(event?.event_type === eventType && event.references?.job_id === jobId, 'QUEUE_ROUTING_EVENT_FENCE_REJECTED', eventId);
        invariant(job?.source_id === sourceId && source && typeof source.origin_id === 'string', 'QUEUE_ROUTING_SOURCE_FENCE_REJECTED', eventId);
        invariant(typeof job.target_class === 'string', 'QUEUE_ROUTING_TARGET_CLASS_MISSING', eventId);
        return { origin_id: job.origin_id ?? source.origin_id, target_class: job.target_class };
      },

      async markOutboxPublished({ eventId, leaseToken, publishedAt, transportRetentionExpiresAt }) {
        const event = state.outbox.get(eventId);
        invariant(event && event.state === 'leased' && event.lease.token === leaseToken, 'OUTBOX_LEASE_FENCE_REJECTED', eventId);
        event.state = 'published'; event.published_at = publishedAt; event.lease = null; event.transport_retention_expires_at = transportRetentionExpiresAt;
        state.outboxAttempts.push({ event_id: eventId, attempt: event.attempt_count, outcome: 'published', recorded_at: publishedAt });
        const job = state.jobs.get(event.references.job_id);
        if (job) { job.last_transport_event_id = eventId; job.transport_retention_expires_at = transportRetentionExpiresAt; }
        return clone(event);
      },

      async markOutboxRetry({ eventId, leaseToken, nextEligibleAt, safeDetailCode }) {
        const event = state.outbox.get(eventId);
        invariant(event && event.state === 'leased' && event.lease.token === leaseToken, 'OUTBOX_LEASE_FENCE_REJECTED', eventId);
        event.state = 'retry_wait'; event.next_eligible_at = nextEligibleAt; event.safe_detail_code = safeDetailCode; event.lease = null;
        event.transport_retention_expires_at = null;
        const job = state.jobs.get(event.references?.job_id);
        if (job?.last_transport_event_id === eventId) {
          job.last_transport_event_id = null;
          job.transport_retention_expires_at = null;
        }
        state.outboxAttempts.push({ event_id: eventId, attempt: event.attempt_count, outcome: 'retry_scheduled', recorded_at: nextEligibleAt });
        return clone(event);
      },

      async markOutboxDead({ eventId, leaseToken, failedAt, safeDetailCode }) {
        const event = state.outbox.get(eventId);
        invariant(event && event.state === 'leased' && event.lease.token === leaseToken, 'OUTBOX_LEASE_FENCE_REJECTED', eventId);
        event.state = 'dead'; event.failed_at = failedAt; event.safe_detail_code = safeDetailCode; event.lease = null;
        state.outboxAttempts.push({ event_id: eventId, attempt: event.attempt_count, outcome: 'dead', recorded_at: failedAt });
        const job = state.jobs.get(event.references?.job_id);
        if (job && ['pending', 'retry_wait', 'leased'].includes(job.state)) {
          const queueName = DLQ_BY_JOB[job.job_type];
          const deadLetterId = await deterministicOpaqueId('deadletter', { queueName, originalEventId: eventId });
          const failure = {
            failure_type: 'internal_failure', retry_class: 'transient', target_class: job.target_class,
            safe_detail_code: 'OUTBOX_DELIVERY_BUDGET_EXHAUSTED', http_status: null, observed_at: failedAt
          };
          await this.recordTransportLossAttempt({
            eventId, runId: job.run_id, jobId: job.job_id, observedAt: failedAt, failure,
            durableDeadLetterId: deadLetterId
          });
          await this.persistDurableDeadLetter({
            deadLetterId, queueName, originalEventId: eventId, sourceId: job.source_id,
            runId: job.run_id, jobId: job.job_id, failure,
            transportDeliveryAttempts: event.attempt_count, databaseAttempts: Math.max(1, job.attempt_count),
            retryPolicyVersion: job.retry_policy_version, messageReferences: job.message_references,
            replayState: 'not_requested', persistedAt: failedAt, sinkTransactionCommitted: true
          });
          await this.appendAudit({
            auditEventId: `audit_outbox_exhausted_${eventId}`, action: 'outbox_delivery_budget_exhausted',
            runId: job.run_id, jobId: job.job_id, deadLetterId, reasonCode: safeDetailCode,
            recordedAt: failedAt
          });
          event.dead_letter_id = deadLetterId;
        }
        return clone(event);
      },

      async getWorkflowStart({ now, limit }) {
        const current = parseTimestamp(now);
        for (const event of state.outbox.values()) {
          const exhaustedLease = event.state === 'leased' && parseTimestamp(event.lease.expires_at) <= current;
          const exhaustedUnleased = ['pending', 'retry_wait'].includes(event.state) && event.attempt_count >= event.maximum_delivery_attempts;
          if (event.event_type === 'workflow_start_requested' && event.attempt_count >= event.maximum_delivery_attempts && (exhaustedLease || exhaustedUnleased)) {
            event.state = 'dead'; event.failed_at = now; event.safe_detail_code = 'WORKFLOW_START_ATTEMPT_BUDGET_EXHAUSTED'; event.lease = null;
            await this.failRunForWorkflowControl({
              runId: event.references.run_id, attempt: event.attempt, failedAt: now,
              reasonCode: 'WORKFLOW_START_ATTEMPT_BUDGET_EXHAUSTED', auditAction: 'workflow_start_budget_exhausted'
            });
          }
        }
        return [...state.outbox.values()].filter(event => event.event_type === 'workflow_start_requested' &&
          ['pending', 'retry_wait', 'leased'].includes(event.state) && (!event.lease || parseTimestamp(event.lease.expires_at) <= current) &&
          event.attempt_count < event.maximum_delivery_attempts &&
          (event.next_eligible_at === null || parseTimestamp(event.next_eligible_at) <= current)
        ).sort((a, b) => a.event_id.localeCompare(b.event_id)).slice(0, limit).map(event => {
          const epoch = (event.lease?.epoch ?? 0) + 1;
          event.attempt_count += 1; event.first_attempt_at ??= now;
          event.state = 'leased'; event.lease = { token: `workflow_lease_${event.event_id}_e${epoch}`, expires_at: iso(current + 60_000), epoch };
          return {
            event_id: event.event_id, run_id: event.references.run_id, attempt: event.attempt,
            workflow_instance_id: event.workflow_instance_id, lease_token: event.lease.token,
            attempt_count: event.attempt_count, maximum_delivery_attempts: event.maximum_delivery_attempts
          };
        });
      },

      async listWorkflowRetentionRisks({ now, limit }) {
        const current = parseTimestamp(now);
        return [...state.runs.values()].filter(run =>
          run.terminal_at === null && parseTimestamp(run.workflow_retention_expires_at) <= current
        ).sort((a, b) => a.run_id.localeCompare(b.run_id)).slice(0, limit).map(clone);
      },

      async listActiveWorkflowMappings({ limit }) {
        return [...state.workflowMappings.values()].filter(mapping => mapping.is_active !== false)
          .sort((left, right) => `${left.last_reconciled_at ?? ''}:${left.run_id}:${left.attempt}`.localeCompare(`${right.last_reconciled_at ?? ''}:${right.run_id}:${right.attempt}`))
          .slice(0, limit).map(clone);
      },

      async recordWorkflowMapping(mapping) {
        const key = `${mapping.runId}:${mapping.attempt}`;
        const prior = state.workflowMappings.get(key);
        if (prior) invariant(prior.workflow_instance_id === mapping.workflowInstanceId, 'WORKFLOW_MAPPING_CONFLICT', key);
        else state.workflowMappings.set(key, {
          run_id: mapping.runId, attempt: mapping.attempt, workflow_instance_id: mapping.workflowInstanceId,
          workflow_version: mapping.workflowVersion, platform_state: mapping.platformState, recorded_at: mapping.recordedAt,
          is_active: mapping.terminalAt === null || mapping.terminalAt === undefined,
          last_reconciled_at: null,
          terminal_at: mapping.terminalAt ?? null
        });
        const run = state.runs.get(mapping.runId);
        if (run?.state === 'scheduled') transitionRun(run, 'starting', mapping.recordedAt, 'WORKFLOW_INSTANCE_RECONCILED');
        return { created: !prior };
      },

      async updateWorkflowMappingState({ runId, attempt, workflowInstanceId, platformState, observedAt }) {
        const mapping = state.workflowMappings.get(`${runId}:${attempt}`);
        invariant(mapping?.workflow_instance_id === workflowInstanceId && mapping.is_active !== false, 'WORKFLOW_MAPPING_FENCE_REJECTED', `${runId}:${attempt}`);
        mapping.platform_state = platformState;
        mapping.last_reconciled_at = observedAt;
        return clone(mapping);
      },

      async markWorkflowStartResolved({ eventId, workflowInstanceId, leaseToken, resolvedAt }) {
        const event = state.outbox.get(eventId);
        invariant(event?.workflow_instance_id === workflowInstanceId && event.state === 'leased' && event.lease?.token === leaseToken, 'WORKFLOW_EVENT_FENCE_REJECTED', eventId);
        event.state = 'published'; event.published_at = resolvedAt; event.lease = null;
      },

      async markWorkflowStartDead({ eventId, workflowInstanceId, leaseToken, failedAt, safeDetailCode }) {
        const event = state.outbox.get(eventId);
        invariant(event?.workflow_instance_id === workflowInstanceId && event.state === 'leased' && event.lease?.token === leaseToken, 'WORKFLOW_EVENT_FENCE_REJECTED', eventId);
        event.state = 'dead'; event.failed_at = failedAt; event.safe_detail_code = safeDetailCode; event.lease = null;
        return clone(event);
      },

      async failRunForWorkflowControl({ runId, attempt, failedAt, reasonCode, auditAction = 'workflow_control_failed', mappingPlatformState = 'errored', preserveWorkflowStartEvent = false }) {
        const run = state.runs.get(runId);
        invariant(run && run.active_attempt === attempt, 'RUN_ATTEMPT_FENCE_REJECTED', runId);
        if (run.terminal_at !== null) return clone(run);
        transitionRun(run, 'failed', failedAt, reasonCode); run.failure_code = reasonCode;
        closeWorkflowMapping(run, mappingPlatformState, failedAt);
        for (const event of state.outbox.values()) {
          if (!preserveWorkflowStartEvent && event.event_type === 'workflow_start_requested' && event.references?.run_id === runId && event.attempt === attempt && event.state !== 'published') {
            event.state = 'dead'; event.failed_at = failedAt; event.safe_detail_code = reasonCode; event.lease = null;
          }
        }
        state.audits.push({ action: auditAction, run_id: runId, attempt, recorded_at: failedAt, reason_code: reasonCode });
        return clone(run);
      },

      async failRunForExpiredWorkflow({ runId, attempt, reconciledAt, auditReason }) {
        return this.failRunForWorkflowControl({
          runId, attempt, failedAt: reconciledAt, reasonCode: auditReason,
          auditAction: 'workflow_retention_expired'
        });
      },

      async loadRunForWorkflow({ runId, attempt }) {
        const run = state.runs.get(runId);
        if (!run || run.active_attempt !== attempt) return null;
        return clone(run);
      },

      async ensureInitialPageJob({ runId, attempt, admittedAt }) {
        const run = state.runs.get(runId);
        invariant(run && run.active_attempt === attempt && run.terminal_at === null, 'RUN_ATTEMPT_FENCE_REJECTED', runId);
        invariant(typeof admittedAt === 'string' && parseTimestamp(admittedAt) < parseTimestamp(run.deadline_at), 'RUN_DEADLINE_ADMISSION_FENCE_REJECTED', runId);
        const jobIds = [];
        let created = 0;
        for (const scopeId of run.scope_ids) {
          const jobId = `job_page_${runId}_${scopeId}`;
          jobIds.push(jobId);
          if (!state.jobs.has(jobId)) {
            seedJob({ job_id: jobId, run_id: runId, source_id: run.source_id, state: 'pending', job_type: 'harvest_page', active_run_attempt: attempt, delivery_fence: { run_attempt: attempt, lease_epoch: 1 }, attempt_count: 0, scope_id: scopeId, message_references: { run_id: runId, job_id: jobId, cursor_ref_id: `cursor_initial_${runId}_${scopeId}` } });
            seedOutbox({ event_id: `event_page_${runId}_${scopeId}`, event_type: 'harvest_page_requested', trace_id: run.trace_id, source_id: run.source_id, run_attempt: attempt, job_lease_epoch: 1, references: { run_id: runId, job_id: jobId, cursor_ref_id: `cursor_initial_${runId}_${scopeId}` }, created_at: run.scheduled_slot });
            created += 1;
          }
        }
        if (run.state === 'starting') transitionRun(run, 'enumerating', run.scheduled_slot, 'INITIAL_PAGE_JOB_COMMITTED');
        return { created: created > 0, created_count: created, job_ids: jobIds };
      },

      async readEnumerationBarrier({ runId, attempt, checkedAt }) {
        const run = state.runs.get(runId); invariant(run?.active_attempt === attempt, 'RUN_ATTEMPT_FENCE_REJECTED', runId);
        parseTimestamp(checkedAt);
        return { ...clone(enumerationObservation(run)), checked_at: checkedAt };
      },

      async commitCheckpointAndNormalizationOutbox({ runId, attempt, enumerationSealIds, normalizerVersion = '1.0.0' }) {
        const run = state.runs.get(runId); invariant(run?.active_attempt === attempt && run.terminal_at === null, 'RUN_ATTEMPT_FENCE_REJECTED', runId);
        const barrier = enumerationObservation(run);
        const currentSealIds = barrier.seals.map(seal => seal.enumeration_seal_id).sort();
        invariant(barrier.status === 'sealed' && barrier.missing_scope_ids.length === 0 && barrier.duplicate_scope_ids.length === 0 && barrier.foreign_scope_ids.length === 0 && JSON.stringify(currentSealIds) === JSON.stringify(enumerationSealIds), 'CHECKPOINT_BARRIER_REJECTED', runId);
        const checkpointSetId = await deterministicOpaqueId('checkpointset', { runId, enumerationSealIds: currentSealIds });
        const existingForRun = [...state.checkpoints.values()].filter(checkpoint => checkpoint.proposed_by_run_id === runId);
        if (existingForRun.length === 0) {
          for (const seal of barrier.seals) {
            const headKey = `${run.source_id}:${seal.scope_id}`;
            const currentCheckpointId = state.activeCheckpoints.get(headKey) ?? null;
            const currentCheckpoint = currentCheckpointId ? state.checkpoints.get(currentCheckpointId) : null;
            const expected = run.expected_checkpoint_heads?.[seal.scope_id] ?? { checkpoint_id: null, checkpoint_digest: null };
            invariant(currentCheckpointId === expected.checkpoint_id && (currentCheckpoint?.checkpoint_digest ?? null) === expected.checkpoint_digest, 'CHECKPOINT_CAS_REJECTED', `${run.source_id}:${seal.scope_id}`);
          }
          for (const seal of barrier.seals) {
            const headKey = `${run.source_id}:${seal.scope_id}`;
            const priorCheckpointId = state.activeCheckpoints.get(headKey) ?? null;
            const priorCheckpoint = priorCheckpointId ? state.checkpoints.get(priorCheckpointId) : null;
            const sequence = (priorCheckpoint?.position.full_enumeration_sequence ?? 0) + 1;
            const position = {
              publisher_modified_at: null, native_id: null, opaque_cursor_ref_id: null,
              full_enumeration_sequence: sequence, position_digest: seal.population_digest
            };
            const checkpointId = await deterministicOpaqueId('checkpoint', { runId, sourceId: run.source_id, scopeId: seal.scope_id, enumerationSealId: seal.enumeration_seal_id });
            const checkpointDigest = await sha256Hex(canonicalJson({
              checkpointId, sourceId: run.source_id, scopeId: seal.scope_id,
              configurationRevision: run.configuration_revision, position,
              priorCheckpointId, priorCheckpointDigest: priorCheckpoint?.checkpoint_digest ?? null,
              enumerationSealId: seal.enumeration_seal_id
            }));
            if (priorCheckpoint) { priorCheckpoint.state = 'superseded'; priorCheckpoint.superseded_at = seal.sealed_at; }
            state.checkpoints.set(checkpointId, {
              contract_version: 'ingestion.v1.0.0', checkpoint_id: checkpointId,
              source_id: run.source_id, scope_id: seal.scope_id, configuration_revision: run.configuration_revision,
              strategy: 'full_snapshot', position, state: 'committed',
              prior_checkpoint_id: priorCheckpointId, prior_checkpoint_digest: priorCheckpoint?.checkpoint_digest ?? null,
              checkpoint_digest: checkpointDigest, proposed_by_run_id: runId,
              enumeration_seal_id: seal.enumeration_seal_id, downstream_outbox_committed: true,
              committed_at: seal.sealed_at, superseded_at: null
            });
            state.activeCheckpoints.set(headKey, checkpointId);
          }
          const captures = clone(state.normalizationCaptures.get(runId) ?? []);
          const uniqueCaptureIds = new Set(captures.map(capture => capture.capture_ref_id));
          const uniqueCaptureDigests = new Set(captures.map(capture => capture.capture_sha256));
          invariant(uniqueCaptureIds.size === captures.length && uniqueCaptureDigests.size === captures.length, 'NORMALIZATION_MANIFEST_DUPLICATE_CAPTURE', runId);
          const manifestDigest = await sha256Hex(canonicalJson(captures.slice().sort((left, right) => left.capture_ref_id.localeCompare(right.capture_ref_id))));
          state.normalizationManifests.set(runId, { run_id: runId, normalizer_version: normalizerVersion, required_capture_count: captures.length, manifest_sha256: manifestDigest, sealed_at: barrier.sealed_at, items: clone(captures) });
          for (const capture of captures) {
            const baseJobId = await deterministicOpaqueId('job', { captureSha256: capture.capture_sha256, normalizerVersion });
            const baseEventId = await deterministicOpaqueId('event', { eventType: 'normalize_requested', captureSha256: capture.capture_sha256, normalizerVersion });
            const jobIdempotencyKey = `normalize:${capture.capture_sha256}:${normalizerVersion}`;
            const artifactKey = `${capture.capture_sha256}:${normalizerVersion}`;
            const baseJob = state.jobs.get(baseJobId);
            let jobId = baseJobId;
            let eventId = baseEventId;
            let satisfaction = 'created';
            if (baseJob) {
              invariant(baseJob.job_type === 'normalize_record' && baseJob.idempotency_key === jobIdempotencyKey && baseJob.capture_sha256 === capture.capture_sha256 && baseJob.normalizer_version === normalizerVersion, 'NORMALIZATION_JOB_REUSE_COLLISION', baseJobId);
              const owningRun = state.runs.get(baseJob.run_id);
              if (baseJob.state === 'succeeded') {
                const artifact = state.normalizationArtifacts.get(artifactKey);
                invariant(artifact?.job_id === baseJobId && /^[a-f0-9]{64}$/.test(artifact.result_sha256), 'NORMALIZATION_SUCCESS_ARTIFACT_MISSING', baseJobId);
                satisfaction = 'already_succeeded';
              } else if (['pending', 'retry_wait', 'leased'].includes(baseJob.state) && owningRun?.terminal_at === null) {
                satisfaction = baseJob.run_id === runId ? 'created' : 'existing_pending';
              } else {
                jobId = await deterministicOpaqueId('job', { purpose: 'normalization_replay', captureSha256: capture.capture_sha256, normalizerVersion, runId });
                eventId = await deterministicOpaqueId('event', { purpose: 'normalization_replay', captureSha256: capture.capture_sha256, normalizerVersion, runId });
                const replayKey = `${jobIdempotencyKey}:replay:${runId}`;
                const replay = state.jobs.get(jobId);
                if (replay) {
                  invariant(replay.run_id === runId && replay.idempotency_key === replayKey && ['pending', 'retry_wait', 'leased', 'succeeded'].includes(replay.state), 'NORMALIZATION_REPLAY_LINEAGE_COLLISION', jobId);
                  if (replay.state === 'succeeded') invariant(state.normalizationArtifacts.get(artifactKey)?.job_id === jobId, 'NORMALIZATION_REPLAY_SUCCESS_ARTIFACT_MISSING', jobId);
                } else {
                  seedJob({ job_id: jobId, run_id: runId, source_id: run.source_id, state: 'pending', job_type: 'normalize_record', active_run_attempt: attempt, delivery_fence: { run_attempt: attempt, lease_epoch: 1 }, attempt_count: 0, message_references: { run_id: runId, job_id: jobId, capture_ref_id: capture.capture_ref_id, checkpoint_id: checkpointSetId } });
                  Object.assign(state.jobs.get(jobId), { idempotency_key: replayKey, logical_idempotency_key: jobIdempotencyKey, replay_of_job_id: baseJobId, capture_sha256: capture.capture_sha256, normalizer_version: normalizerVersion });
                  seedOutbox({ event_id: eventId, event_type: 'normalize_requested', trace_id: run.trace_id, source_id: run.source_id, run_attempt: attempt, job_lease_epoch: 1, idempotency_key: `event:normalize_requested:${jobId}`, references: { run_id: runId, job_id: jobId, capture_ref_id: capture.capture_ref_id, checkpoint_id: checkpointSetId }, created_at: run.scheduled_slot });
                }
                satisfaction = replay?.state === 'succeeded' ? 'already_succeeded' : 'replay_created';
              }
            } else {
              seedJob({ job_id: baseJobId, run_id: runId, source_id: run.source_id, state: 'pending', job_type: 'normalize_record', active_run_attempt: attempt, delivery_fence: { run_attempt: attempt, lease_epoch: 1 }, attempt_count: 0, message_references: { run_id: runId, job_id: baseJobId, capture_ref_id: capture.capture_ref_id, checkpoint_id: checkpointSetId } });
              Object.assign(state.jobs.get(baseJobId), { idempotency_key: jobIdempotencyKey, capture_sha256: capture.capture_sha256, normalizer_version: normalizerVersion });
              seedOutbox({ event_id: baseEventId, event_type: 'normalize_requested', trace_id: run.trace_id, source_id: run.source_id, run_attempt: attempt, job_lease_epoch: 1, idempotency_key: jobIdempotencyKey, references: { run_id: runId, job_id: baseJobId, capture_ref_id: capture.capture_ref_id, checkpoint_id: checkpointSetId }, created_at: run.scheduled_slot });
            }
            state.normalizationRequirements.set(`${runId}:${capture.capture_ref_id}`, { run_id: runId, capture_ref_id: capture.capture_ref_id, capture_sha256: capture.capture_sha256, normalizer_version: normalizerVersion, job_id: jobId, event_id: eventId, satisfaction });
          }
          invariant([...state.normalizationRequirements.values()].filter(requirement => requirement.run_id === runId).length === captures.length, 'NORMALIZATION_REQUIREMENT_COUNT_MISMATCH', runId);
        }
        if (run.state === 'enumerating') transitionRun(run, 'enumerated', barrier.sealed_at, 'ENUMERATION_SEALED');
        if (run.state === 'enumerated') transitionRun(run, 'normalizing', barrier.sealed_at, 'CHECKPOINT_AND_NORMALIZATION_OUTBOX_COMMITTED');
        const manifest = state.normalizationManifests.get(runId);
        return { checkpoint_set_id: checkpointSetId, normalization_job_count: manifest?.required_capture_count ?? 0, checkpoints: clone([...state.checkpoints.values()].filter(checkpoint => checkpoint.proposed_by_run_id === runId)) };
      },

      async readNormalizationBarrier({ runId, attempt, checkedAt }) {
        const run = state.runs.get(runId); invariant(run?.active_attempt === attempt, 'RUN_ATTEMPT_FENCE_REJECTED', runId);
        parseTimestamp(checkedAt);
        return { ...clone(state.barriers.get(runId)?.normalization ?? { status: 'pending', observed_at: run.scheduled_slot, required_dead_letter_count: 0, optional_degradations: [] }), checked_at: checkedAt };
      },

      async requestProjection({ runId, attempt, optionalDegradations }) {
        const run = state.runs.get(runId); invariant(run?.active_attempt === attempt && run.terminal_at === null, 'RUN_ATTEMPT_FENCE_REJECTED', runId);
        const eventId = `event_projection_${runId}`;
        const jobId = `job_projection_${runId}`;
        if (!state.jobs.has(jobId)) seedJob({ job_id: jobId, run_id: runId, source_id: run.source_id, state: 'pending', job_type: 'project_index', active_run_attempt: attempt, delivery_fence: { run_attempt: attempt, lease_epoch: 1 }, attempt_count: 0, message_references: { run_id: runId, job_id: jobId } });
        if (!state.outbox.has(eventId)) seedOutbox({ event_id: eventId, event_type: 'projection_requested', trace_id: run.trace_id, source_id: run.source_id, run_attempt: attempt, job_lease_epoch: 1, references: { run_id: runId, job_id: jobId }, created_at: run.scheduled_slot });
        if (run.state === 'normalizing') transitionRun(run, 'projecting', state.barriers.get(runId)?.normalization?.observed_at ?? run.scheduled_slot, 'NORMALIZATION_BARRIER_COMPLETE');
        run.optional_degradations = clone(optionalDegradations);
        return { event_id: eventId };
      },

      async readProjectionBarrier({ runId, attempt, checkedAt }) {
        const run = state.runs.get(runId); invariant(run?.active_attempt === attempt, 'RUN_ATTEMPT_FENCE_REJECTED', runId);
        parseTimestamp(checkedAt);
        return { ...clone(state.barriers.get(runId)?.projection ?? {
          status: 'pending', observed_at: run.scheduled_slot, eligible_projection_count: 0, projection_acknowledgement_count: 0,
          required_dead_letter_count: 0, references_resolved: false, checksums_verified: false, visibility_verified: false, coverage_reconciled: false
        }), checked_at: checkedAt };
      },

      async recordCoverageAndCompleteRun({ runId, attempt, enumeration, normalization, projection, outcome }) {
        const run = state.runs.get(runId); invariant(run?.active_attempt === attempt, 'RUN_ATTEMPT_FENCE_REJECTED', runId);
        const stepIdentity = canonicalJson({ kind: 'complete', attempt, enumeration, normalization, projection, outcome });
        if (run.terminal_at !== null) {
          invariant(run.terminal_step_identity === stepIdentity && run.state === outcome, 'RUN_TERMINAL_STEP_LINEAGE_MISMATCH', runId);
          return { state: run.state, recorded_at: run.recorded_at, publication_id: run.publication_id };
        }
        invariant(enumeration.status === 'sealed' && ['complete', 'complete_with_optional_degradation'].includes(normalization.status) && ['published', 'succeeded', 'succeeded_with_optional_degradation'].includes(projection.run_outcome), 'RUN_COMPLETION_BARRIER_REJECTED');
        transitionRun(run, 'published', projection.evaluated_at, 'PUBLICATION_BARRIER_COMPLETE');
        transitionRun(run, outcome, projection.evaluated_at, 'RUN_TERMINAL_OUTCOME'); run.recorded_at = projection.evaluated_at;
        closeWorkflowMapping(run, 'complete', projection.evaluated_at);
        run.publication_id = projection.candidate_publication_id; run.terminal_step_identity = stepIdentity;
        return { state: run.state, recorded_at: run.recorded_at, publication_id: run.publication_id };
      },

      async markRunPartialUnpublished({ runId, attempt, stage, barrier }) {
        const run = state.runs.get(runId); invariant(run?.active_attempt === attempt, 'RUN_ATTEMPT_FENCE_REJECTED', runId);
        const terminalAt = barrier.decision_at ?? barrier.evaluated_at ?? barrier.sealed_at ?? barrier.observed_at ?? run.scheduled_slot;
        const stepIdentity = canonicalJson({ kind: 'partial_unpublished', attempt, stage, terminalAt, barrier });
        if (run.terminal_at !== null) {
          invariant(run.state === 'partial_unpublished' && run.terminal_step_identity === stepIdentity, 'RUN_TERMINAL_STEP_LINEAGE_MISMATCH', runId);
          return clone(run);
        }
        transitionRun(run, 'partial_unpublished', terminalAt, `PARTIAL_${stage.toUpperCase()}`); run.recorded_at = run.terminal_at; run.partial_stage = stage;
        closeWorkflowMapping(run, 'complete', terminalAt);
        run.publication_id = null; run.terminal_step_identity = stepIdentity;
        return clone(run);
      },

      async prepareEventDelivery({ consumerName, eventId, eventType, messageIdempotencyKey, stage, sourceId, runId, jobId, runAttempt, leaseEpoch, transportAttempt, now, leaseExpiresAt, originId, originCapacity, originRefillPerSecond, targetClass, retryPolicyVersion, deadLetterQueueName }) {
        const guardKey = `${consumerName}:${eventId}`;
        const processed = state.processedEvents.get(guardKey);
        if (processed) {
          invariant(
            processed.state === 'committed' && processed.source_id === sourceId && processed.run_id === runId &&
            processed.job_id === jobId && processed.event_type === eventType &&
            processed.message_idempotency_key === messageIdempotencyKey &&
            processed.run_attempt === runAttempt && processed.lease_epoch === leaseEpoch &&
            processed.origin_id === originId && processed.target_class === targetClass &&
            processed.retry_policy_version === retryPolicyVersion && processed.business_effect_digest,
            'PROCESSED_EVENT_IDEMPOTENCY_COLLISION', eventId
          );
          return { decision: 'duplicate' };
        }
        const source = state.sources.get(sourceId);
        const run = state.runs.get(runId);
        if (!run || run.terminal_at !== null || run.active_attempt !== runAttempt) return { decision: 'suppressed', reason: 'stale_or_terminal_run' };
        const job = state.jobs.get(jobId);
        if (!job || job.run_id !== runId || job.source_id !== sourceId || job.active_run_attempt !== runAttempt || job.delivery_fence.lease_epoch !== leaseEpoch) {
          return { decision: 'suppressed', reason: 'stale_job_fence' };
        }
        invariant(job.job_type === stage && job.event_type === eventType && EVENT_TYPE_BY_JOB[stage] === eventType, 'QUEUE_STAGE_JOB_TYPE_MISMATCH', eventId);
        invariant(job.maximum_delivery_attempts === STAGE_POLICIES[stage].maximumDeliveryAttempts, 'JOB_RETRY_POLICY_DRIFT', jobId);
        if (!source || source.state !== 'active') {
          job.state = 'retry_wait'; job.lease = null; job.next_eligible_at = null; job.suppressed_for_pause = true;
          return { decision: 'suppressed', reason: 'source_not_active' };
        }
        invariant(job.target_class === targetClass && (job.origin_id === null || job.origin_id === originId) && source.origin_id === originId, 'QUEUE_ROUTING_AUTHORITY_MISMATCH', eventId);
        if (['succeeded', 'quarantined', 'dead'].includes(job.state)) return { decision: 'suppressed', reason: 'terminal_job' };
        if (job.state === 'retry_wait' && job.next_eligible_at && parseTimestamp(job.next_eligible_at) > parseTimestamp(now)) return { decision: 'defer', reason: 'retry_not_due', retry_at: job.next_eligible_at };
        if (job.state === 'leased' && job.lease && parseTimestamp(job.lease.expires_at) > parseTimestamp(now)) return { decision: 'defer', reason: 'lease_active', retry_at: job.lease.expires_at };
        const logicalAttempt = job.attempt_count + 1;
        invariant(logicalAttempt <= job.maximum_delivery_attempts, 'JOB_RETRY_BUDGET_EXHAUSTED_WITHOUT_TERMINAL', jobId);
        job.first_attempt_at ??= now;
        const permit = await this.acquireOriginPermit({ originId, now, requestedTokens: 1, capacity: originCapacity, refillPerSecond: originRefillPerSecond });
        if (!permit.allowed) {
          const failure = { failure_type: 'rate_limited', retry_class: 'transient', target_class: targetClass, safe_detail_code: permit.reason === 'circuit_open' ? 'ORIGIN_CIRCUIT_OPEN' : 'ORIGIN_RATE_LIMITED', http_status: null, observed_at: now };
          const deliveryFence = clone(job.delivery_fence);
          if (logicalAttempt >= job.maximum_delivery_attempts) {
            const disposition = { harvest_page: 'fail_enumeration', normalize_record: 'quarantine', enrich_schema: 'quarantine', access_check: 'typed_observation', project_index: 'projection_rejected' }[job.job_type];
            const deadLetterId = await deterministicOpaqueId('deadletter', { queueName: deadLetterQueueName, originalEventId: eventId });
            job.attempt_count = logicalAttempt;
            await this.recordTerminalOutcome({ eventId, jobId, runId, attempt: logicalAttempt, disposition, failure, retryPolicyVersion, startedAt: now, deliveryFence, durableDeadLetterId: deadLetterId });
            await this.persistDurableDeadLetter({
              deadLetterId, queueName: deadLetterQueueName,
              originalEventId: eventId, sourceId, runId, jobId, failure,
              transportDeliveryAttempts: transportAttempt, databaseAttempts: logicalAttempt,
              retryPolicyVersion, messageReferences: job.message_references, replayState: 'not_requested', persistedAt: now,
              sinkTransactionCommitted: true
            });
            return { decision: 'ack_exhausted', reason: permit.reason, logical_attempt: logicalAttempt };
          }
          const nextEpoch = job.delivery_fence.lease_epoch + 1;
          const delayedEventId = `event_delayed_${eventId}_${logicalAttempt}`;
          job.state = 'retry_wait'; job.lease = null; job.next_eligible_at = permit.retry_at; job.attempt_count = logicalAttempt;
          job.delivery_fence.lease_epoch = nextEpoch; job.transport_generation += 1;
          if (!state.outbox.has(delayedEventId)) seedOutbox({
            event_id: delayedEventId, event_type: job.event_type, source_id: job.source_id,
            run_attempt: job.active_run_attempt, job_lease_epoch: nextEpoch,
            references: job.message_references, next_eligible_at: permit.retry_at, created_at: now,
            idempotency_key: `event:${job.event_type}:${eventId}:${logicalAttempt}`
          });
          await upsertAttempt(job, {
            eventId, deliveryAttempt: logicalAttempt, retryPolicyVersion, startedAt: now, finishedAt: now,
            deliveryFence, failure,
            computedDelaySeconds: Math.max(0, Math.ceil((parseTimestamp(permit.retry_at) - parseTimestamp(now)) / 1000)),
            nextEligibleAt: permit.retry_at, transportAction: 'ack_reledgered_after_commit'
          });
          return { decision: 'ack_reledgered', reason: permit.reason, retry_at: permit.retry_at, logical_attempt: logicalAttempt, delayed_event_id: delayedEventId };
        }
        const token = `job_lease_${jobId}_f${leaseEpoch}_t${transportAttempt}`;
        job.state = 'leased'; job.lease = { token, epoch: leaseEpoch, owner_id: eventId, expires_at: leaseExpiresAt };
        job.attempt_count = logicalAttempt;
        await upsertAttempt(job, {
          eventId, deliveryAttempt: logicalAttempt, retryPolicyVersion,
          startedAt: now, finishedAt: null, failure: null,
          transportAction: 'none_pending'
        });
        return { decision: 'process', lease_token: token, lease_epoch: leaseEpoch, logical_attempt: logicalAttempt };
      },

      async processEventOnce({ consumerName, eventId, effectIdempotencyKey, sourceId, runId, jobId, eventType, messageIdempotencyKey, runAttempt, leaseEpoch, originId, targetClass, leaseToken, logicalAttempt, retryPolicyVersion, startedAt, committedAt, apply }) {
        const guardKey = `${consumerName}:${eventId}`;
        const prior = state.processedEvents.get(guardKey);
        if (prior) {
          invariant(
            prior.state === 'committed' && prior.effect_idempotency_key === effectIdempotencyKey &&
            prior.source_id === sourceId && prior.run_id === runId && prior.job_id === jobId &&
            prior.event_type === eventType && prior.message_idempotency_key === messageIdempotencyKey &&
            prior.run_attempt === runAttempt && prior.lease_epoch === leaseEpoch && prior.origin_id === originId &&
            prior.target_class === targetClass && prior.retry_policy_version === retryPolicyVersion,
            'PROCESSED_EVENT_IDEMPOTENCY_COLLISION', eventId
          );
          return { duplicate: true, business_effect_digest: prior.business_effect_digest };
        }
        const job = state.jobs.get(jobId);
        invariant(job && job.run_id === runId && job.state === 'leased' && job.lease?.token === leaseToken, 'JOB_LEASE_FENCE_REJECTED', jobId);
        invariant(parseTimestamp(job.lease.expires_at) > parseTimestamp(committedAt), 'JOB_LEASE_EXPIRED', jobId);
        state.processedEvents.set(guardKey, {
          consumer_name: consumerName, event_id: eventId, effect_idempotency_key: effectIdempotencyKey,
          message_idempotency_key: messageIdempotencyKey, source_id: sourceId, run_id: runId, job_id: jobId,
          event_type: eventType, run_attempt: runAttempt, lease_epoch: leaseEpoch,
          origin_id: originId, target_class: targetClass, retry_policy_version: retryPolicyVersion, state: 'processing'
        });
        const result = await apply();
        const digest = result?.businessEffectDigest ?? await sha256Hex(canonicalJson(result ?? { eventId, effectIdempotencyKey }));
        invariant(/^[a-f0-9]{64}$/.test(digest), 'BUSINESS_EFFECT_DIGEST_INVALID', eventId);
        state.businessEffects.set(effectIdempotencyKey, clone(result?.effect ?? { event_id: eventId }));
        if (job.job_type === 'normalize_record' && (job.capture_sha256 !== undefined || job.normalizer_version !== undefined)) {
          invariant(/^[a-f0-9]{64}$/.test(job.capture_sha256) && typeof job.normalizer_version === 'string', 'NORMALIZATION_JOB_IDENTITY_MISSING', jobId);
          const artifactKey = `${job.capture_sha256}:${job.normalizer_version}`;
          const artifact = { capture_sha256: job.capture_sha256, normalizer_version: job.normalizer_version, job_id: jobId, result_sha256: digest, recorded_at: committedAt };
          const priorArtifact = state.normalizationArtifacts.get(artifactKey);
          if (priorArtifact) invariant(canonicalJson(priorArtifact) === canonicalJson(artifact), 'NORMALIZATION_SUCCESS_ARTIFACT_COLLISION', artifactKey);
          else state.normalizationArtifacts.set(artifactKey, artifact);
        }
        for (const event of result?.downstreamOutbox ?? []) seedOutbox(event);
        const guard = state.processedEvents.get(guardKey); guard.business_effect_digest = digest; guard.state = 'committed';
        await upsertAttempt(job, {
          eventId, deliveryAttempt: logicalAttempt, retryPolicyVersion, startedAt, finishedAt: committedAt,
          failure: null, transportAction: 'ack_after_commit'
        });
        job.state = 'succeeded'; job.lease = null; job.next_eligible_at = null;
        return { duplicate: false, business_effect_digest: digest };
      },

      async recordAttemptFailure(input) {
        const job = state.jobs.get(input.jobId);
        if (job) {
          invariant(!input.leaseToken || job.lease?.token === input.leaseToken, 'JOB_LEASE_FENCE_REJECTED', input.jobId);
          await upsertAttempt(job, {
            eventId: input.eventId, deliveryAttempt: input.attempt, retryPolicyVersion: input.retryPolicyVersion,
            startedAt: input.startedAt ?? input.failure.observed_at, finishedAt: input.finishedAt ?? input.failure.observed_at,
            failure: input.failure, retryAfterSeconds: input.retryAfterSeconds,
            computedDelaySeconds: input.computedDelaySeconds, nextEligibleAt: input.nextEligibleAt,
            databaseTransactionCommitted: false, transportAction: 'retry_after_rollback'
          });
          job.state = 'retry_wait'; job.lease = null; job.next_eligible_at = input.nextEligibleAt; job.attempt_count = input.attempt;
        }
        return { recorded: true };
      },

      async recordTerminalOutcome(input) {
        const job = state.jobs.get(input.jobId);
        if (job) {
          if (input.leaseToken) invariant(job.lease?.token === input.leaseToken, 'JOB_LEASE_FENCE_REJECTED', input.jobId);
          await upsertAttempt(job, {
            eventId: input.eventId, deliveryAttempt: input.attempt, retryPolicyVersion: input.retryPolicyVersion,
            startedAt: input.startedAt ?? input.failure.observed_at, finishedAt: input.finishedAt ?? input.failure.observed_at,
            deliveryFence: input.deliveryFence, failure: input.failure,
            transportAction: 'ack_after_commit', durableDeadLetterId: input.durableDeadLetterId
          });
          job.state = {
            harvest_page: 'dead', normalize_record: 'quarantined', enrich_schema: 'quarantined',
            access_check: 'succeeded', project_index: 'dead'
          }[job.job_type];
          job.lease = null;
        }
        const run = state.runs.get(input.runId);
        if (run && input.disposition === 'fail_enumeration' && run.terminal_at === null) {
          transitionRun(run, 'partial_unpublished', input.failure.observed_at, 'ENUMERATION_TERMINAL_FAILURE');
          closeWorkflowMapping(run, 'complete', input.failure.observed_at);
        }
        const source = job ? state.sources.get(job.source_id) : null;
        if (source && (input.disposition === 'pause_source' || input.failure?.failure_type === 'schema_drift')) {
          source.state = input.failure.failure_type === 'catalog_auth_misconfigured' ? 'auth_blocked'
            : input.failure.failure_type === 'schema_drift' ? 'schema_drift'
              : 'pause_requested';
          source.state_history.push({ state: source.state, recorded_at: input.failure.observed_at, reason_code: input.failure.safe_detail_code });
        }
        return { recorded: true };
      },

      async recordTransportLossAttempt(input) {
        const job = state.jobs.get(input.jobId);
        invariant(job && job.run_id === input.runId && ['pending', 'retry_wait', 'leased'].includes(job.state), 'DLQ_RECOVERY_JOB_FENCE_REJECTED', input.jobId);
        const logicalAttempt = Math.max(1, job.attempt_count || 1);
        await upsertAttempt(job, {
          eventId: input.eventId, deliveryAttempt: logicalAttempt, retryPolicyVersion: job.retry_policy_version,
          startedAt: input.observedAt, finishedAt: input.observedAt, failure: input.failure,
          transportAction: 'ack_after_commit', durableDeadLetterId: input.durableDeadLetterId
        });
        job.attempt_count = logicalAttempt; job.state = 'dead'; job.lease = null; job.next_eligible_at = null;
        const run = state.runs.get(input.runId);
        if (job.job_type === 'harvest_page' && run?.terminal_at === null) {
          transitionRun(run, 'partial_unpublished', input.observedAt, 'PLATFORM_DLQ_TRANSPORT_EXHAUSTED');
          closeWorkflowMapping(run, 'complete', input.observedAt);
        }
        return { recorded: true };
      },

      async reledgerRetry(input) {
        const job = state.jobs.get(input.jobId);
        if (job) {
          if (input.leaseToken) invariant(job.lease?.token === input.leaseToken, 'JOB_LEASE_FENCE_REJECTED', input.jobId);
          const deliveryFence = clone(job.delivery_fence);
          await upsertAttempt(job, {
            eventId: input.eventId, deliveryAttempt: input.attempt, retryPolicyVersion: input.retryPolicyVersion,
            startedAt: input.startedAt ?? input.failure.observed_at, finishedAt: input.finishedAt ?? input.failure.observed_at,
            deliveryFence, failure: input.failure, retryAfterSeconds: input.retryAfterSeconds,
            computedDelaySeconds: input.computedDelaySeconds, nextEligibleAt: input.nextEligibleAt,
            transportAction: 'ack_reledgered_after_commit'
          });
          job.state = 'retry_wait'; job.lease = null; job.next_eligible_at = input.nextEligibleAt; job.attempt_count = input.attempt; job.delivery_fence.lease_epoch += 1; job.transport_generation += 1;
        }
        const eventId = `event_delayed_${input.eventId}_${input.attempt}`;
        if (!state.outbox.has(eventId)) seedOutbox({
          event_id: eventId, event_type: job?.event_type ?? 'normalize_requested', source_id: job?.source_id ?? null,
          run_attempt: job?.active_run_attempt ?? 1, job_lease_epoch: job?.delivery_fence?.lease_epoch ?? 1,
          references: job?.message_references ?? { run_id: input.runId, job_id: input.jobId }, next_eligible_at: input.nextEligibleAt, created_at: input.failure.observed_at,
          idempotency_key: input.delayedOutboxIdempotencyKey
        });
        return { event_id: eventId };
      },

      async listExpiredQueueDeliveries({ now, limit }) {
        const current = parseTimestamp(now);
        return [...state.jobs.values()].filter(job =>
          ['pending', 'retry_wait', 'leased'].includes(job.state) && job.transport_retention_expires_at &&
          parseTimestamp(job.transport_retention_expires_at) <= current &&
          (!job.next_eligible_at || parseTimestamp(job.next_eligible_at) <= current) &&
          (!job.lease || parseTimestamp(job.lease.expires_at) <= current)
        ).sort((a, b) => a.job_id.localeCompare(b.job_id)).slice(0, limit).map(clone);
      },

      async reledgerExpiredQueueDelivery({ jobId, runId, priorLeaseEpoch, recoveredAt, newTransportExpiresAt, recoveryEventId }) {
        const job = state.jobs.get(jobId);
        const run = state.runs.get(runId);
        invariant(job && run && run.terminal_at === null && run.active_attempt === job.active_run_attempt, 'QUEUE_RECOVERY_RUN_FENCE_REJECTED', jobId);
        invariant(job.delivery_fence.lease_epoch === priorLeaseEpoch, 'QUEUE_RECOVERY_STALE_FENCE', jobId);
        if (state.outbox.has(recoveryEventId)) return { created: false, event_id: recoveryEventId };
        job.delivery_fence.lease_epoch += 1; job.transport_generation += 1; job.state = 'pending'; job.lease = null;
        job.next_eligible_at = null; job.last_transport_event_id = recoveryEventId; job.transport_retention_expires_at = newTransportExpiresAt;
        seedOutbox({
          event_id: recoveryEventId, event_type: job.event_type, source_id: job.source_id,
          run_attempt: job.active_run_attempt, job_lease_epoch: job.delivery_fence.lease_epoch,
          references: job.message_references, created_at: recoveredAt,
          idempotency_key: `event:${job.event_type}:${job.job_id}:g${job.transport_generation}`,
          transport_retention_expires_at: newTransportExpiresAt
        });
        return { created: true, event_id: recoveryEventId, lease_epoch: job.delivery_fence.lease_epoch };
      },

      async persistDurableDeadLetter(input) {
        const prior = state.deadLetters.get(input.deadLetterId);
        if (prior) {
          invariant(prior.original_event_id === input.originalEventId, 'DEAD_LETTER_IDEMPOTENCY_CONFLICT', input.deadLetterId);
          return { created: false };
        }
        invariant(input.sinkTransactionCommitted === true, 'DEAD_LETTER_UNCOMMITTED_RECORD_REJECTED', input.deadLetterId);
        const job = state.jobs.get(input.jobId);
        const ownedAttempts = state.attempts.filter(attempt => attempt.job_id === input.jobId);
        const latestAttempt = ownedAttempts.at(-1);
        invariant(job && latestAttempt && state.attemptEvents.get(latestAttempt.attempt_id) === input.originalEventId,
          'DEAD_LETTER_ATTEMPT_EVIDENCE_MISSING', input.originalEventId);
        invariant(job.attempt_count === input.databaseAttempts && input.transportDeliveryAttempts >= input.databaseAttempts,
          'DEAD_LETTER_ATTEMPT_ACCOUNTING_MISMATCH', input.originalEventId);
        const exactAttemptIds = ownedAttempts.map(attempt => attempt.attempt_id);
        if (input.attemptIds !== undefined) invariant(canonicalJson(input.attemptIds) === canonicalJson(exactAttemptIds),
          'DEAD_LETTER_ATTEMPT_LINEAGE_MISMATCH', input.originalEventId);
        const terminalState = {
          harvest_page: 'dead', normalize_record: 'quarantined', enrich_schema: 'quarantined',
          access_check: 'succeeded', project_index: 'dead'
        }[job.job_type];
        invariant(terminalState, 'DEAD_LETTER_JOB_STAGE_INVALID', job.job_type);
        if (!['succeeded', 'quarantined', 'dead'].includes(job.state)) {
          job.state = terminalState;
          job.lease = null;
          job.next_eligible_at = null;
          latestAttempt.failure = clone(input.failure);
          latestAttempt.outcome = 'dead_lettered';
          latestAttempt.durable_dead_letter_id = input.deadLetterId;
          latestAttempt.database_transaction_committed = true;
          latestAttempt.transport_action = 'ack_after_commit';
          if (job.job_type === 'harvest_page') {
            const run = state.runs.get(job.run_id);
            if (run && run.terminal_at === null) {
              run.state = 'partial_unpublished';
              run.terminal_at = input.persistedAt;
              run.recorded_at = input.persistedAt;
              closeWorkflowMapping(run, 'complete', input.persistedAt);
            }
          }
        }
        invariant(job.state === terminalState, 'DEAD_LETTER_JOB_TERMINAL_STATE_MISMATCH', input.jobId);
        state.deadLetters.set(input.deadLetterId, {
          contract_version: 'ingestion.v1.0.0', record_kind: 'durable_dead_letter',
          dead_letter_id: input.deadLetterId, queue_name: input.queueName, original_event_id: input.originalEventId,
          source_id: input.sourceId, run_id: input.runId, job_id: input.jobId, failure: clone(input.failure),
          transport_delivery_attempts: input.transportDeliveryAttempts, database_attempts: input.databaseAttempts,
          retry_policy_version: input.retryPolicyVersion, message_references: safeReferences(input.messageReferences),
          attempt_ids: clone(input.attemptIds ?? exactAttemptIds),
          replay_state: input.replayState, persisted_at: input.persistedAt,
          sink_transaction_committed: input.sinkTransactionCommitted ?? false
        });
        return { created: true };
      },

      async getDeadLetter({ deadLetterId }) { return clone(state.deadLetters.get(deadLetterId) ?? null); },

      async getDeadLetterByOriginalEvent({ originalEventId, queueName = null }) {
        return clone([...state.deadLetters.values()].find(dead => dead.original_event_id === originalEventId && (!queueName || dead.queue_name === queueName)) ?? null);
      },

      async loadDeadLetterEvidence({ originalEventId }) {
        const eventAttempt = state.attempts.find(attempt => state.attemptEvents.get(attempt.attempt_id) === originalEventId);
        const attempts = eventAttempt ? state.attempts.filter(attempt => attempt.job_id === eventAttempt.job_id) : [];
        const latest = attempts.at(-1);
        if (!latest) return null;
        const job = state.jobs.get(latest.job_id);
        return {
          source_id: job?.source_id, run_id: latest.run_id ?? job?.run_id, job_id: latest.job_id,
          failure: clone(latest.failure), database_attempts: job?.attempt_count ?? attempts.length,
          retry_policy_version: latest.retry_policy_version ?? job?.retry_policy_version,
          message_references: clone(job?.message_references), attempt_ids: attempts.map(attempt => attempt.attempt_id)
        };
      },

      async recordDeadLetterTransportExhaustionObservation(input) {
        invariant(input.transportDeliveryAttempts === 6, 'DLQ_TRANSPORT_EXHAUSTION_ATTEMPT_COUNT_INVALID', String(input.transportDeliveryAttempts));
        parseTimestamp(input.observedAt);
        invariant(typeof input.evidenceRefId === 'string' && typeof input.auditEventId === 'string', 'DLQ_TRANSPORT_EXHAUSTION_EVIDENCE_MISSING');
        const job = state.jobs.get(input.jobId);
        const run = state.runs.get(input.runId);
        const event = state.outbox.get(input.originalEventId);
        invariant(job && run && event && job.run_id === run.run_id && job.source_id === input.sourceId &&
          event.references?.job_id === job.job_id && event.references?.run_id === run.run_id,
        'DLQ_TRANSPORT_EXHAUSTION_LINEAGE_FENCE_REJECTED', input.originalEventId);
        invariant(DLQ_BY_JOB[job.job_type] === input.queueName, 'DLQ_TRANSPORT_EXHAUSTION_QUEUE_FENCE_REJECTED', input.queueName);
        invariant(event.state === 'published' || (event.state === 'dead' && event.safe_detail_code === 'OUTBOX_UNCERTAIN_SEND_BUDGET_EXHAUSTED'), 'DLQ_TRANSPORT_EXHAUSTION_OUTBOX_FENCE_REJECTED', input.originalEventId);
        const prior = state.deadLetterTransportExhaustions.get(input.originalEventId);
        const observation = {
          original_event_id: input.originalEventId, queue_name: input.queueName,
          source_id: input.sourceId, run_id: input.runId, job_id: input.jobId,
          transport_delivery_attempts: input.transportDeliveryAttempts,
          observed_at: input.observedAt, evidence_ref_id: input.evidenceRefId,
          audit_event_id: input.auditEventId
        };
        if (prior) invariant(canonicalJson(prior) === canonicalJson(observation), 'DLQ_TRANSPORT_EXHAUSTION_OBSERVATION_CONFLICT', input.originalEventId);
        else {
          state.deadLetterTransportExhaustions.set(input.originalEventId, observation);
          state.audits.push({
            audit_event_id: input.auditEventId, action: 'dlq_transport_exhaustion_observed',
            event_id: input.originalEventId, run_id: input.runId, job_id: input.jobId,
            evidence_ref_id: input.evidenceRefId, recorded_at: input.observedAt,
            reason_code: 'CLOUDFLARE_DLQ_FINAL_DELIVERY_DELETED'
          });
        }
        return { created: !prior };
      },

      async listDeadLetterRecoveryCandidates({ now, limit }) {
        parseTimestamp(now);
        const latestFailureByJob = new Map();
        for (const attempt of state.attempts) if (attempt.failure && state.attemptEvents.get(attempt.attempt_id)) latestFailureByJob.set(attempt.job_id, attempt);
        const terminalCandidates = [...latestFailureByJob.entries()].map(([jobId, attempt]) => {
          const job = state.jobs.get(jobId);
          const run = job ? state.runs.get(job.run_id) : null;
          const queueName = job ? DLQ_BY_JOB[job.job_type] : null;
          const originalEventId = state.attemptEvents.get(attempt.attempt_id);
          const alreadyPersisted = [...state.deadLetters.values()].some(dead => dead.original_event_id === originalEventId && dead.queue_name === queueName);
          const durableIncidentExpected = ['dead', 'quarantined'].includes(job?.state) && attempt.durable_dead_letter_id !== null;
          if (!job || !run || !queueName || alreadyPersisted || !durableIncidentExpected) return null;
          return {
            original_event_id: originalEventId, queue_name: queueName,
            source_id: job.source_id, run_id: job.run_id, job_id: job.job_id,
            transport_delivery_attempts: Math.max(1, attempt.delivery_attempt ?? job.attempt_count ?? 1),
            evidence_refs: {
              run_id: job.run_id, job_id: job.job_id,
              outbox_event_id: [...state.outbox.values()].find(event => event.references?.job_id === job.job_id)?.event_id ?? null,
              attempt_id: attempt.attempt_id
            }, requires_synthetic_attempt: false
          };
        }).filter(Boolean);
        const transportLossCandidates = [...state.deadLetterTransportExhaustions.values()].map(observation => {
          const job = state.jobs.get(observation.job_id);
          const run = state.runs.get(observation.run_id);
          const attempt = latestFailureByJob.get(observation.job_id);
          const alreadyPersisted = [...state.deadLetters.values()].some(dead => dead.original_event_id === observation.original_event_id && dead.queue_name === observation.queue_name);
          if (!job || !run || !attempt || state.attemptEvents.get(attempt.attempt_id) !== observation.original_event_id
              || !['pending', 'retry_wait', 'leased'].includes(job.state) || alreadyPersisted) return null;
          return {
            original_event_id: observation.original_event_id, queue_name: observation.queue_name,
            source_id: observation.source_id, run_id: observation.run_id, job_id: observation.job_id,
            transport_delivery_attempts: observation.transport_delivery_attempts, requires_synthetic_attempt: false,
            failure: clone(attempt.failure),
            evidence_refs: {
              run_id: job.run_id, job_id: job.job_id, outbox_event_id: observation.original_event_id,
              attempt_id: attempt.attempt_id, transport_exhaustion_evidence_ref_id: observation.evidence_ref_id
            }
          };
        }).filter(Boolean);
        const deduplicated = new Map();
        for (const candidate of [...terminalCandidates, ...transportLossCandidates]) deduplicated.set(candidate.original_event_id, candidate);
        return [...deduplicated.values()].sort((left, right) => left.original_event_id.localeCompare(right.original_event_id)).slice(0, limit).map(clone);
      },

      async markDeadLetterSinkCommitted({ deadLetterId, persistedAt }) {
        const dead = state.deadLetters.get(deadLetterId); invariant(dead, 'DEAD_LETTER_NOT_FOUND', deadLetterId);
        dead.sink_transaction_committed = true;
        if (!state.deadLetterSinkEvents.some(event => event.dead_letter_id === deadLetterId && event.committed_at === persistedAt)) {
          state.deadLetterSinkEvents.push({ dead_letter_id: deadLetterId, committed_at: persistedAt, outcome: 'idempotent_sink_commit' });
        }
        return clone(dead);
      },

      async createReplay(input) {
        const prior = state.replays.get(input.replayId);
        if (prior) return { created: false };
        const dead = state.deadLetters.get(input.originalDeadLetterId);
        invariant(dead && dead.sink_transaction_committed === true && dead.original_event_id === input.originalEventId && dead.run_id === input.originalRunId && dead.retry_policy_version === input.originalRetryPolicyVersion, 'REPLAY_ORIGINAL_LINEAGE_FENCE_REJECTED');
        invariant(input.newRunId !== input.originalRunId && input.newEventId !== input.originalEventId, 'REPLAY_HISTORY_RESET_REJECTED');
        state.replays.set(input.replayId, {
          contract_version: 'ingestion.v1.0.0', record_kind: 'replay_lineage',
          replay_id: input.replayId, original_dead_letter_id: input.originalDeadLetterId,
          original_event_id: input.originalEventId, original_run_id: input.originalRunId,
          new_run_id: input.newRunId, new_event_id: input.newEventId,
          original_retry_policy_version: input.originalRetryPolicyVersion,
          replay_policy_version: input.replayPolicyVersion, requested_by_audit_event_id: input.requestedByAuditEventId,
          requested_at: input.requestedAt
        });
        dead.replay_state = 'replayed';
        const originalRun = state.runs.get(input.originalRunId);
        invariant(originalRun?.terminal_at !== null && ['succeeded', 'succeeded_with_optional_degradation', 'partial_unpublished', 'failed', 'cancelled'].includes(originalRun.state), 'REPLAY_ORIGINAL_RUN_NOT_TERMINAL', input.originalRunId);
        const retentionMs = Math.max(1, parseTimestamp(originalRun.workflow_retention_expires_at) - parseTimestamp(originalRun.scheduled_slot));
        const deadlineMs = Math.max(1, parseTimestamp(originalRun.deadline_at) - parseTimestamp(originalRun.scheduled_slot));
        invariant(originalRun.barrier_policy, 'REPLAY_ORIGINAL_BARRIER_POLICY_MISSING', input.originalRunId);
        const expectedCheckpointHeads = Object.fromEntries(originalRun.scope_ids.map(scopeId => {
          const checkpointId = state.activeCheckpoints.get(`${originalRun.source_id}:${scopeId}`) ?? null;
          const checkpoint = checkpointId ? state.checkpoints.get(checkpointId) : null;
          return [scopeId, { checkpoint_id: checkpointId, checkpoint_digest: checkpoint?.checkpoint_digest ?? null }];
        }));
        const replayRun = {
          run_id: input.newRunId, source_id: originalRun.source_id, endpoint_id: originalRun.endpoint_id, scope_ids: clone(originalRun.scope_ids), configuration_revision: originalRun.configuration_revision,
          scheduled_slot: input.requestedAt, mode: 'operator_replay', run_idempotency_key: `run:${originalRun.endpoint_id}:${input.requestedAt}:operator_replay:r${originalRun.configuration_revision}`,
          state: 'scheduled', active_attempt: 1, replay_of_run_id: input.originalRunId,
          workflow_instance_id: `harvest-${input.newRunId}-1`, workflow_version: originalRun.workflow_version,
          workflow_retention_expires_at: iso(parseTimestamp(input.requestedAt) + retentionMs),
          deadline_at: iso(parseTimestamp(input.requestedAt) + deadlineMs), terminal_at: null,
          trace_id: `trace_${input.replayId}`, last_known_good_publication_id: originalRun.last_known_good_publication_id, publication_id: null,
          expected_checkpoint_heads: expectedCheckpointHeads,
          optional_degradation_policy: clone(originalRun.optional_degradation_policy ?? []),
          barrier_policy: clone(originalRun.barrier_policy),
          state_history: [{ state: 'scheduled', recorded_at: input.requestedAt, reason_code: 'OPERATOR_REPLAY' }]
        };
        state.runs.set(input.newRunId, replayRun); state.runKeys.set(replayRun.run_idempotency_key, input.newRunId);
        state.audits.push({ audit_event_id: input.requestedByAuditEventId, action: 'dead_letter_replay_requested', dead_letter_id: input.originalDeadLetterId, replay_id: input.replayId, recorded_at: input.requestedAt, reason_code: 'OPERATOR_AUTHORIZED_REPLAY' });
        seedOutbox({ event_id: input.newEventId, event_type: 'workflow_start_requested', workflow_instance_id: `harvest-${input.newRunId}-1`, attempt: 1, trace_id: `trace_${input.replayId}`, references: { run_id: input.newRunId }, created_at: input.requestedAt, idempotency_key: `event:workflow_start_requested:${input.replayId}` });
        return { created: true };
      },

      async requestSourcePause({ sourceId, auditEventId, requestedAt, reasonCode }) {
        const source = state.sources.get(sourceId); invariant(source && source.state !== 'retired', 'SOURCE_NOT_PAUSABLE', sourceId);
        if (!source.pause_origin_state) source.pause_origin_state = source.state;
        if (source.state === 'active' || source.state === 'auth_blocked' || source.state === 'schema_drift') source.state = 'pause_requested';
        source.state_history.push({ state: source.state, recorded_at: requestedAt, reason_code: reasonCode });
        source.pause_requested_at = requestedAt; source.pause_audit_event_id = auditEventId; source.pause_reason_code = reasonCode;
        return clone(source);
      },

      async drainSource({ sourceId, reledger, now, leaseAbandonmentGraceMs = 5 * 60 * 1000 }) {
        const source = state.sources.get(sourceId); invariant(source && ['pause_requested', 'draining', 'paused'].includes(source.state), 'SOURCE_DRAIN_STATE_INVALID', sourceId);
        if (source.state === 'paused') return { state: 'paused', in_flight_work_count: 0, durably_reledgered_work_count: source.durably_reledgered_work_count ?? 0 };
        if (source.state !== 'draining') { source.state = 'draining'; source.state_history.push({ state: 'draining', recorded_at: now, reason_code: 'DRAIN_STARTED' }); }
        const active = [...state.jobs.values()].filter(job => job.source_id === sourceId && ['pending', 'leased', 'retry_wait'].includes(job.state));
        const externallyLeased = active.filter(job => job.state === 'leased' && parseTimestamp(job.lease.expires_at) + leaseAbandonmentGraceMs > parseTimestamp(now));
        const abandonedLeases = active.filter(job => job.state === 'leased' && parseTimestamp(job.lease.expires_at) + leaseAbandonmentGraceMs <= parseTimestamp(now));
        const reledgerable = active.filter(job => job.state !== 'leased').concat(abandonedLeases);
        let reledgered = 0;
        if (reledger) for (const job of reledgerable) {
          if (job.state === 'leased') { job.lease_abandonment_proof = { prior_lease: clone(job.lease), abandoned_at: now, grace_ms: leaseAbandonmentGraceMs }; job.delivery_fence.lease_epoch += 1; }
          job.state = 'retry_wait'; job.lease = null; job.next_eligible_at = null; job.reledgered_for_pause = true; reledgered += 1;
        }
        const unresolved = externallyLeased.length + (reledger ? 0 : reledgerable.length);
        if (unresolved === 0) { source.state = 'paused'; source.state_history.push({ state: 'paused', recorded_at: now, reason_code: 'DRAIN_RECONCILED' }); source.drain_completed_at = now; source.durably_reledgered_work_count = (source.durably_reledgered_work_count ?? 0) + reledgered; }
        return { state: source.state, in_flight_work_count: unresolved, durably_reledgered_work_count: reledgered };
      },

      async resumeSource({ sourceId, auditEventId, resumedAt, configurationRevision, remediationEvidenceRefId, connectorVersion }) {
        const source = state.sources.get(sourceId);
        invariant(source?.state === 'paused' && source.drain_completed_at, 'SOURCE_RESUME_DRAIN_NOT_RECONCILED', sourceId);
        invariant(typeof auditEventId === 'string' && configurationRevision > source.configuration_revision, 'SOURCE_RESUME_EVIDENCE_INVALID', sourceId);
        if (['auth_blocked', 'schema_drift'].includes(source.pause_origin_state)) {
          invariant(typeof remediationEvidenceRefId === 'string' && remediationEvidenceRefId.length > 0, 'SOURCE_RESUME_REMEDIATION_REQUIRED', sourceId);
          invariant(typeof connectorVersion === 'string' && connectorVersion !== source.connector_version, 'SOURCE_RESUME_CONNECTOR_VERSION_REQUIRED', sourceId);
        }
        source.state = 'active'; source.state_history.push({ state: 'active', recorded_at: resumedAt, reason_code: 'AUDITED_RESUME' }); source.configuration_revision = configurationRevision; source.remediation_evidence_ref_id = remediationEvidenceRefId ?? null; source.resumed_at = resumedAt;
        if (connectorVersion) source.connector_version = connectorVersion;
        for (const job of state.jobs.values()) if (job.source_id === sourceId && (job.reledgered_for_pause || job.suppressed_for_pause)) {
          job.state = 'pending'; job.reledgered_for_pause = false; job.suppressed_for_pause = false;
          job.delivery_fence.lease_epoch += 1; job.transport_generation += 1;
          const eventId = `event_resume_${job.job_id}_${job.transport_generation}`;
          job.last_transport_event_id = eventId;
          seedOutbox({
            event_id: eventId, event_type: job.event_type, source_id: job.source_id,
            run_attempt: job.active_run_attempt, job_lease_epoch: job.delivery_fence.lease_epoch,
            references: job.message_references, created_at: resumedAt,
            idempotency_key: `event:${job.event_type}:${sourceId}:${job.job_id}:g${job.transport_generation}`
          });
        }
        return clone(source);
      },

      async canSourceFetch({ sourceId }) { return state.sources.get(sourceId)?.state === 'active'; },

      async consumeOriginTokens({ originId, now, requestedTokens, capacity, refillPerSecond }) {
        const current = parseTimestamp(now);
        const bucket = state.originBuckets.get(originId) ?? { tokens: capacity, updated_at: now };
        const elapsedSeconds = Math.max(0, (current - parseTimestamp(bucket.updated_at)) / 1000);
        bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond); bucket.updated_at = now;
        const allowed = bucket.tokens >= requestedTokens;
        if (allowed) bucket.tokens -= requestedTokens;
        state.originBuckets.set(originId, bucket);
        const missing = Math.max(0, requestedTokens - bucket.tokens);
        return { allowed, remaining_tokens: bucket.tokens, retry_at: allowed ? null : iso(current + Math.ceil(missing / refillPerSecond) * 1000) };
      },

      async acquireOriginPermit({ originId, now, requestedTokens, capacity, refillPerSecond }) {
        const current = parseTimestamp(now);
        const circuit = state.circuits.get(originId) ?? { state: 'closed', failure_count: 0, next_probe_at: null, probe_in_flight: false };
        if (circuit.state === 'open' && parseTimestamp(circuit.next_probe_at) > current) return { allowed: false, reason: 'circuit_open', retry_at: circuit.next_probe_at, circuit_state: 'open' };
        if (circuit.state === 'half_open' && circuit.probe_in_flight) return { allowed: false, reason: 'half_open_probe_in_flight', retry_at: circuit.next_probe_at, circuit_state: 'half_open' };
        const bucketResult = await this.consumeOriginTokens({ originId, now, requestedTokens, capacity, refillPerSecond });
        if (!bucketResult.allowed) return { ...bucketResult, reason: 'token_bucket_empty', circuit_state: circuit.state };
        if (circuit.state === 'open') { circuit.state = 'half_open'; circuit.probe_in_flight = true; state.circuits.set(originId, circuit); }
        return { ...bucketResult, reason: null, circuit_state: circuit.state };
      },

      async recordCircuitFailure({ originId, observedAt, threshold, nextProbeAt = null }) {
        const circuit = state.circuits.get(originId) ?? { state: 'closed', failure_count: 0, next_probe_at: null };
        const previous = circuit.state;
        circuit.failure_count += 1;
        if (circuit.failure_count >= threshold || previous === 'half_open') { circuit.state = 'open'; circuit.next_probe_at = nextProbeAt ?? iso(parseTimestamp(observedAt) + 60_000); circuit.probe_in_flight = false; }
        state.circuits.set(originId, circuit); return { ...clone(circuit), previous_state: previous };
      },

      async recordCircuitSuccess({ originId, observedAt }) {
        const previous = state.circuits.get(originId)?.state ?? 'closed';
        const circuit = { state: 'closed', failure_count: 0, next_probe_at: null, last_success_at: observedAt };
        state.circuits.set(originId, circuit); return { ...clone(circuit), previous_state: previous };
      },

      async loadCircuit({ originId }) { return clone(state.circuits.get(originId) ?? { state: 'closed', failure_count: 0, next_probe_at: null }); },

      async listGcDependencies({ partitionId }) {
        const partition = state.gcPartitions.get(partitionId); invariant(partition, 'GC_PARTITION_NOT_FOUND', partitionId);
        return { partition: clone(partition), dependencies: clone(partition.dependencies) };
      },
      async recordGcProof(proof) { state.gcProofs.set(proof.proof_digest, clone(proof)); return { recorded: true }; },
      async deleteGcPartition({ partitionId, proofDigest, deletedAt }) {
        const partition = state.gcPartitions.get(partitionId); invariant(partition && !partition.deleted, 'GC_PARTITION_NOT_DELETABLE', partitionId);
        invariant(state.gcProofs.has(proofDigest), 'GC_PROOF_NOT_FOUND', proofDigest);
        partition.deleted = true; partition.deleted_at = deletedAt; partition.proof_digest = proofDigest;
        return { deleted_count: partition.row_count };
      },
      async appendAudit(event) { state.audits.push(clone(event)); return { recorded: true }; },
      async close() {
        const lifecycle = state.clientLifecycle.find(item => item.client_id === clientId);
        if (lifecycle) lifecycle.closed = true;
      }
    };
  }

  async function openDatabase() {
    const clientId = `client_${++clientSequence}`;
    state.clientLifecycle.push({ client_id: clientId, closed: false });
    return coreMethods(clientId);
  }

  async function recordFetch(input) {
    const sourceId = typeof input === 'string' ? input : input.sourceId;
    invariant(state.sources.get(sourceId)?.state === 'active', 'SOURCE_FETCH_BLOCKED', sourceId);
    if (typeof input === 'object' && input.jobId) {
      const job = state.jobs.get(input.jobId);
      invariant(job?.source_id === sourceId && job.state === 'leased' && job.lease?.token === input.leaseToken, 'SOURCE_FETCH_JOB_FENCE_REJECTED', input.jobId);
      invariant(parseTimestamp(job.lease.expires_at) > parseTimestamp(input.now), 'SOURCE_FETCH_LEASE_EXPIRED', input.jobId);
    }
    state.fetchCountBySource.set(sourceId, (state.fetchCountBySource.get(sourceId) ?? 0) + 1);
  }

  return Object.freeze({
    faults, openDatabase, seedSource, seedRun, seedJob, seedBarriers, seedNormalizationCaptures, seedWorkflowMapping, seedOutbox, seedGcPartition, recordFetch,
    inspect() { return structuredClone(state); }
  });
}

export function createFakeQueue(name, { faultOnSend = null } = {}) {
  const sent = [];
  let sends = 0;
  return Object.freeze({
    name,
    sent,
    async send(body, options) {
      sends += 1;
      if (faultOnSend === sends) {
        const error = new Error('QUEUE_SEND_FAILED'); error.code = 'QUEUE_SEND_FAILED'; throw error;
      }
      sent.push(Object.freeze({ body: clone(body), options: clone(options ?? null) }));
    }
  });
}

export function createFakeWorkflowPlatform() {
  const instances = new Map();
  const createBehaviors = [];
  const getBehaviors = [];
  return Object.freeze({
    instances,
    enqueueCreateBehavior(behavior) { createBehaviors.push(behavior); },
    enqueueGetBehavior(behavior) { getBehaviors.push(behavior); },
    setStatus(id, status) { const instance = instances.get(id); invariant(instance, 'WORKFLOW_NOT_FOUND', id); instance.status = status; },
    async create(input) {
      const behavior = createBehaviors.shift() ?? 'success';
      if (behavior === 'fail_before_create') { const error = new Error('WORKFLOW_CREATE_FAILED'); error.code = 'WORKFLOW_CREATE_FAILED'; throw error; }
      if (instances.has(input.id)) { const error = new Error('WORKFLOW_ALREADY_EXISTS'); error.code = 'WORKFLOW_ALREADY_EXISTS'; throw error; }
      const instance = { id: input.id, status: 'running', params: clone(input.params), retention_expires_at: input.retentionExpiresAt };
      instances.set(input.id, instance);
      if (behavior === 'unknown_after_create') { const error = new Error('WORKFLOW_CREATE_UNKNOWN'); error.code = 'WORKFLOW_CREATE_UNKNOWN'; throw error; }
      return clone(instance);
    },
    async get(id) {
      const behavior = getBehaviors.shift() ?? 'success';
      if (behavior === 'fail') { const error = new Error('WORKFLOW_GET_FAILED'); error.code = 'WORKFLOW_GET_FAILED'; throw error; }
      const instance = instances.get(id);
      if (!instance) { const error = new Error('WORKFLOW_NOT_FOUND'); error.code = 'WORKFLOW_NOT_FOUND'; throw error; }
      return clone(instance);
    }
  });
}

export function createFakeQueueMessage({ id, body, attempts = 1 }) {
  let action = null;
  const history = [];
  return {
    id, body: clone(body), attempts,
    ack() { if (action === null) { action = { type: 'ack' }; history.push(clone(action)); } },
    retry(options = {}) { if (action === null) { action = { type: 'retry', delaySeconds: options.delaySeconds ?? null }; history.push(clone(action)); } },
    get action() { return clone(action); },
    get history() { return clone(history); }
  };
}

export function createFakeWorkflowStep() {
  const results = new Map();
  const calls = [];
  const sleeps = [];
  return Object.freeze({
    calls, sleeps,
    async do(name, options, callback) {
      if (typeof options === 'function') { callback = options; options = null; }
      calls.push({ name, options: clone(options) });
      if (results.has(name)) return clone(results.get(name));
      const result = await callback();
      results.set(name, clone(result));
      return clone(result);
    },
    async sleep(name, duration) { sleeps.push({ name, duration }); }
  });
}
