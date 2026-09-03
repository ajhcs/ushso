import { createInMemoryControlPlane, createScheduler } from '../src/index.mjs';

export const SLOT = '2026-08-30T00:00:00.000Z';

export async function createScheduledPlane(options = {}) {
  const plane = createInMemoryControlPlane(options);
  plane.seedSource({
    source_id: 'source_cms_catalog', endpoint_id: 'endpoint_cms_catalog', scope_ids: ['scope_cms_public'],
    origin_id: 'origin_data_cms_gov', configuration_revision: 1, mode: 'full_membership', next_due_at: SLOT, state: 'active'
  });
  const scheduler = createScheduler({ openDatabase: plane.openDatabase, configuration: { workflowRetentionMs: options.workflowRetentionMs ?? 30 * 24 * 60 * 60 * 1000 } });
  const scheduled = await scheduler.dispatchScheduledSlot({ scheduledTime: SLOT, cron: '*/5 * * * *', traceId: 'trace_scheduler_fixture' });
  const runId = scheduled.runs[0].runId;
  return { plane, scheduler, scheduled, runId, run: plane.inspect().runs.get(runId) };
}

export function queueBody({ eventId = 'event_fixture_001', jobId = 'job_fixture_001', runId = 'run_fixture_001', originId = 'origin_data_cms_gov', targetClass = 'exact_item', eventType = 'normalize_requested', leaseEpoch = 1, runAttempt = 1 } = {}) {
  return {
    contract_version: 'ingestion.v1.0.0', event_id: eventId, event_type: eventType,
    idempotency_key: `event:${eventType}:${eventId}`, trace_id: `trace_${eventId}`, origin_id: originId,
    source_id: 'source_cms_catalog', target_class: targetClass, observed_at: SLOT, attempt: 1,
    retry_policy_version: 'retry.v1', references: {
      run_id: runId, job_id: jobId, capture_ref_id: null, checkpoint_id: null, canonical_id: null,
      canonical_revision_id: null, r2_key: null, cursor_ref_id: null
    }, delivery_fence: { run_attempt: runAttempt, lease_epoch: leaseEpoch }
  };
}

export function seedQueueWork(plane, body, { jobType = 'normalize_record', state = 'pending', attemptCount = 0, maximumDeliveryAttempts = 5, transportRetentionExpiresAt = null } = {}) {
  plane.seedSource({
    source_id: body.source_id, endpoint_id: 'endpoint_cms_catalog', scope_ids: ['scope_cms_public'],
    origin_id: body.origin_id, configuration_revision: 1, next_due_at: SLOT, state: 'active'
  });
  plane.seedRun({ run_id: body.references.run_id, source_id: body.source_id, active_attempt: body.delivery_fence.run_attempt, state: 'normalizing' });
  plane.seedJob({
    job_id: body.references.job_id, run_id: body.references.run_id, source_id: body.source_id, job_type: jobType,
    state, active_run_attempt: body.delivery_fence.run_attempt, attempt_count: attemptCount,
    maximum_delivery_attempts: maximumDeliveryAttempts,
    delivery_fence: body.delivery_fence, message_references: body.references,
    target_class: body.target_class, origin_id: body.origin_id,
    transport_retention_expires_at: transportRetentionExpiresAt
  });
}

export function completeBarriers() {
  return {
    enumeration: {
      contract_version: 'ingestion.v1.0.0', record_kind: 'enumeration_seal', enumeration_seal_id: 'seal_fixture_complete',
      run_id: 'run_fixture_rebound_at_seed', source_id: 'source_cms_catalog', scope_id: 'scope_cms_public', status: 'sealed',
      pages_discovered: 2, pages_committed: 2, items_discovered: 3, discoveries_committed: 3,
      page_dead_letter_count: 0, cursor_expired: false, population_digest: '2'.repeat(64),
      completeness_evidence_ref_id: 'evidence_fixture_complete', sealed_at: '2026-08-30T00:05:00.000Z'
    },
    normalization: {
      status: 'complete', observed_at: '2026-08-30T00:10:00.000Z', required_dead_letter_count: 0,
      observed_revision_count: 3, normalization_terminal_count: 3, membership_checkpoint_committed: true,
      w1_revision_manifest_sealed: true, optional_degradations: []
    },
    projection: {
      contract_version: 'ingestion.v1.0.0', record_kind: 'publication_barrier', barrier_id: 'barrier_fixture_complete',
      run_id: 'run_fixture_rebound_at_seed', run_outcome: 'published', evaluated_at: '2026-08-30T00:15:00.000Z', required_dead_letter_count: 0,
      enumerations_complete_and_sealed: true, membership_checkpoint_committed: true,
      normalization_terminal_count: 3, observed_revision_count: 3, w1_revision_manifest_sealed: true,
      eligible_projection_count: 3, projection_acknowledgement_count: 3, references_resolved: true,
      checksums_verified: true, visibility_verified: true, coverage_reconciled: true,
      optional_degradations: [], candidate_publication_id: 'publication_fixture_complete',
      active_publication_id: 'publication_fixture_complete', last_known_good_publication_id: 'publication_last_known_good'
    }
  };
}

export function zeroGcDependencies(overrides = {}) {
  return {
    active_run_count: 0, active_lease_count: 0, pending_outbox_count: 0, nonterminal_workflow_count: 0,
    open_dead_letter_count: 0, active_replay_count: 0, unexpired_idempotency_key_count: 0,
    retained_publication_reference_count: 0, rollback_reference_count: 0, evidence_lineage_reference_count: 0,
    pending_review_reference_count: 0, audit_dependency_count: 0,
    archive_checksum_verified: true, archive_access_controlled: true, archive_restore_tested: true,
    backup_pitr_compatible: true, legal_policy_approved: true, replay_horizon_expired: true,
    workflow_retention_grace_expired: true, rollback_window_expired: true,
    online_retention_days: 120, maximum_recovery_horizon_days: 90,
    publication_security_receipt_retention_days: 365, retention_policy_version: 'correctness-retention.v1',
    ...overrides
  };
}
