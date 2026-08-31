import { Buffer } from 'node:buffer';
import { Client as PgClient } from 'pg';

import { canonicalJson, deterministicOpaqueId, invariant, sha256Hex } from './common.mjs';
import { STAGE_POLICIES } from './failure-policy.mjs';
import { createNullLogger } from './redaction.mjs';

const TERMINAL_RUN_STATES = Object.freeze(['succeeded', 'succeeded_with_optional_degradation', 'partial_unpublished', 'failed', 'cancelled']);
const TERMINAL_JOB_STATES = Object.freeze(['succeeded', 'quarantined', 'dead']);
const EVENT_BY_STAGE = Object.freeze({
  harvest_page: 'harvest_page_requested',
  normalize_record: 'normalize_requested',
  enrich_schema: 'schema_enrichment_requested',
  access_check: 'access_check_requested',
  project_index: 'projection_requested'
});
const DLQ_BY_STAGE = Object.freeze({
  harvest_page: 'harvest-page-dlq',
  normalize_record: 'normalize-record-dlq',
  enrich_schema: 'enrich-schema-dlq',
  access_check: 'access-check-dlq',
  project_index: 'project-index-dlq'
});
const EFFECT_KIND_BY_STAGE = Object.freeze({
  harvest_page: 'harvest_metadata',
  normalize_record: 'normalization_import',
  enrich_schema: 'schema_enrichment',
  access_check: 'access_observation',
  project_index: 'projection_acknowledgement'
});
const PRODUCER_BY_CONSUMER = Object.freeze({
  harvest_page_consumer: 'harvest',
  normalize_record_consumer: 'normalize',
  enrich_schema_consumer: 'normalize',
  access_check_consumer: 'normalize',
  project_index_consumer: 'projector'
});
const REFERENCE_KEYS = Object.freeze([
  'run_id', 'job_id', 'capture_ref_id', 'checkpoint_id', 'canonical_id',
  'canonical_revision_id', 'r2_key', 'cursor_ref_id'
]);

function rows(result) {
  return (result?.rows ?? []).map(normalizePgValue);
}

function normalizePgValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizePgValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizePgValue(item)]));
  }
  return value;
}

function exactOne(result, code, detail = '') {
  const normalized = rows(result);
  invariant(normalized.length === 1, code, detail);
  return normalized[0];
}

function optionalOne(result, code, detail = '') {
  const normalized = rows(result);
  invariant(normalized.length <= 1, code, detail);
  return normalized[0] ?? null;
}

function completeReferences(input = {}) {
  return Object.freeze(Object.fromEntries(REFERENCE_KEYS.map(key => [key, input[key] ?? null])));
}

function token(prefix, value) {
  return `${prefix}.${Buffer.from(canonicalJson(value), 'utf8').toString('base64url')}`;
}

function parseToken(value, prefix, code) {
  invariant(typeof value === 'string' && value.startsWith(`${prefix}.`), code);
  try {
    const parsed = JSON.parse(Buffer.from(value.slice(prefix.length + 1), 'base64url').toString('utf8'));
    invariant(parsed && typeof parsed === 'object' && !Array.isArray(parsed), code);
    return parsed;
  } catch (error) {
    if (error?.code === code) throw error;
    invariant(false, code);
  }
}

function outboxLeaseToken(row) {
  return token('ol1', { eventId: row.event_id, ownerId: row.lease_owner, leaseEpoch: Number(row.lease_epoch) });
}

function jobLeaseToken(row) {
  return token('jl1', { jobId: row.job_id, ownerId: row.lease_owner, leaseEpoch: Number(row.lease_epoch) });
}

function scheduleLeaseToken(group) {
  return token('sl1', {
    ownerId: group[0].lease_owner,
    sourceId: group[0].source_id,
    endpointId: group[0].endpoint_id,
    schedules: group.map(row => ({ schedule_id: row.schedule_id, scope_id: row.scope_id, lease_epoch: Number(row.lease_epoch) }))
  });
}

function parseOutboxLease(value, eventId) {
  const lease = parseToken(value, 'ol1', 'OUTBOX_LEASE_TOKEN_INVALID');
  invariant(lease.eventId === eventId && typeof lease.ownerId === 'string' && Number.isInteger(lease.leaseEpoch), 'OUTBOX_LEASE_TOKEN_INVALID', eventId);
  return lease;
}

function parseJobLease(value, jobId) {
  const lease = parseToken(value, 'jl1', 'JOB_LEASE_TOKEN_INVALID');
  invariant(lease.jobId === jobId && typeof lease.ownerId === 'string' && Number.isInteger(lease.leaseEpoch), 'JOB_LEASE_TOKEN_INVALID', jobId);
  return lease;
}

function parseScheduleLease(value, sourceId, scopeIds) {
  const lease = parseToken(value, 'sl1', 'SOURCE_SCHEDULE_LEASE_TOKEN_INVALID');
  const requested = [...scopeIds].sort();
  const leased = (lease.schedules ?? []).map(item => item.scope_id).sort();
  invariant(lease.sourceId === sourceId && typeof lease.ownerId === 'string' && canonicalJson(requested) === canonicalJson(leased), 'SOURCE_SCHEDULE_LEASE_TOKEN_INVALID', sourceId);
  invariant(lease.schedules.every(item => typeof item.schedule_id === 'string' && Number.isInteger(item.lease_epoch)), 'SOURCE_SCHEDULE_LEASE_TOKEN_INVALID', sourceId);
  return lease;
}

function safeSqlState(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : null;
}

function retryableSqlState(sqlState) {
  return sqlState?.startsWith('08') || sqlState === '40001' || sqlState === '40P01' || sqlState === '53300' || sqlState === '57P01';
}

export class PostgresControlStoreError extends Error {
  constructor({ operation, sqlState = null, retryable = false, cause = undefined }) {
    super(`POSTGRES_CONTROL_STORE_ERROR:${operation}`, { cause });
    this.name = 'PostgresControlStoreError';
    this.code = sqlState ? `POSTGRES_${sqlState}` : 'POSTGRES_CONTROL_STORE_ERROR';
    this.operation = operation;
    this.sqlState = sqlState;
    this.retryable = retryable;
  }
}

function wrapDatabaseError(error, operation) {
  if (error instanceof PostgresControlStoreError || (typeof error?.code === 'string' && !safeSqlState(error))) return error;
  const sqlState = safeSqlState(error);
  return new PostgresControlStoreError({ operation, sqlState, retryable: retryableSqlState(sqlState), cause: error });
}

function traceFor(prefix, id) {
  const safe = String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return `${prefix}_${safe}`.padEnd(16, '_').slice(0, 128);
}

function auditDetails(event) {
  const details = {};
  for (const [key, value] of Object.entries(event)) {
    if (['auditEventId', 'action', 'recordedAt', 'operatorId'].includes(key) || value === undefined) continue;
    const snake = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    details[snake] = value;
  }
  return details;
}

function auditObject(event) {
  const candidates = [
    ['source', event.sourceId], ['run', event.runId], ['job', event.jobId],
    ['durable_dead_letter', event.deadLetterId], ['origin', event.originId],
    ['partition', event.partitionId], ['event', event.eventId]
  ];
  return candidates.find(([, id]) => typeof id === 'string') ?? ['system', event.auditEventId];
}

function runWithScopes(row) {
  if (!row) return null;
  const value = { ...row };
  value.scope_ids = value.scope_ids ?? [];
  value.barrier_policy = value.barrier_policy ?? null;
  value.optional_degradation_policy = value.optional_degradation_policy ?? [];
  return value;
}

async function attemptId(jobId, attempt) {
  return deterministicOpaqueId('attempt', { jobId, deliveryAttempt: attempt });
}

function assertConnectionString(value) {
  invariant(typeof value === 'string' && value.length > 0, 'POSTGRES_CONNECTION_STRING_MISSING');
  return value;
}

function createStore(client, { logger }) {
  let closed = false;
  let transactionDepth = 0;

  async function query(operation, text, values = []) {
    invariant(!closed, 'POSTGRES_CLIENT_CLOSED');
    try {
      return await client.query(text, values);
    } catch (error) {
      const wrapped = wrapDatabaseError(error, operation);
      logger.emit({ level: 'error', event: 'postgres.control_store_error', outcome: 'failed', safe_detail_code: wrapped.code });
      throw wrapped;
    }
  }

  async function loadJob(jobId, { lock = false } = {}) {
    return optionalOne(await query('load-job', `
      select job.*, run.trace_id, run.terminal_at as run_terminal_at,
             run.active_attempt as run_active_attempt
      from ingest.jobs job
      join ingest.harvest_runs run on run.run_id = job.run_id
      where job.job_id = $1
      ${lock ? 'for update of job, run' : ''}
    `, [jobId]), 'JOB_ID_NOT_UNIQUE', jobId);
  }

  async function insertAttemptStarted({ job, eventId, startedAt }) {
    const id = await attemptId(job.job_id, Number(job.attempt_count));
    await query('insert-attempt-key', `
      insert into ingest.job_attempt_keys(attempt_id, job_id, delivery_attempt, first_recorded_at)
      values ($1,$2,$3,$4::timestamptz)
      on conflict (job_id, delivery_attempt) do nothing
    `, [id, job.job_id, job.attempt_count, startedAt]);
    const key = exactOne(await query('verify-attempt-key', `
      select attempt_id, job_id, delivery_attempt from ingest.job_attempt_keys
      where job_id = $1 and delivery_attempt = $2
    `, [job.job_id, job.attempt_count]), 'JOB_ATTEMPT_KEY_MISSING', job.job_id);
    invariant(key.attempt_id === id, 'JOB_ATTEMPT_KEY_COLLISION', job.job_id);
    const existing = optionalOne(await query('load-started-attempt', `
      select attempt_id from ingest.job_attempts
      where attempt_id=$1 and job_id=$2 and original_event_id=$3 and outcome='started'
      order by recorded_at limit 1
    `, [id, job.job_id, eventId]), 'JOB_ATTEMPT_STARTED_DUPLICATE', job.job_id);
    if (!existing) {
      await query('insert-started-attempt', `
        insert into ingest.job_attempts(
          attempt_id, job_id, run_id, source_id, delivery_attempt,
          maximum_delivery_attempts, retry_policy_version, first_attempt_at,
          started_at, finished_at, run_attempt, lease_epoch, original_event_id,
          failure_payload, retry_after_seconds, computed_delay_seconds,
          next_eligible_at, outcome, error_class, database_transaction_committed,
          transport_action, durable_dead_letter_id, recorded_at, trace_id
        ) values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,null,$10,$11,$12,
                  null,null,null,null,'started',null,true,'none_pending',null,$9::timestamptz,$13)
      `, [id, job.job_id, job.run_id, job.source_id, job.attempt_count,
        job.maximum_delivery_attempts, job.retry_policy_version,
        job.first_attempt_at ?? startedAt, startedAt, job.active_run_attempt,
        job.lease_epoch, eventId, job.trace_id]);
    }
    return id;
  }

  async function insertAttemptOutcome({ job, eventId, deliveryAttempt, retryPolicyVersion, startedAt, finishedAt, failure = null,
    retryAfterSeconds = null, computedDelaySeconds = null, nextEligibleAt = null,
    outcome, databaseTransactionCommitted, transportAction, durableDeadLetterId = null }) {
    const id = await attemptId(job.job_id, Number(deliveryAttempt));
    const result = await query('insert-attempt-outcome', `
      insert into ingest.job_attempts(
        attempt_id, job_id, run_id, source_id, delivery_attempt,
        maximum_delivery_attempts, retry_policy_version, first_attempt_at,
        started_at, finished_at, run_attempt, lease_epoch, original_event_id,
        failure_payload, retry_after_seconds, computed_delay_seconds,
        next_eligible_at, outcome, error_class, database_transaction_committed,
        transport_action, durable_dead_letter_id, recorded_at, trace_id
      ) values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10::timestamptz,$11,$12,$13,
                $14::jsonb,$15,$16,$17::timestamptz,$18,$19,$20,$21,$22,$10::timestamptz,$23)
      returning *
    `, [id, job.job_id, job.run_id, job.source_id, deliveryAttempt,
      job.maximum_delivery_attempts, retryPolicyVersion, job.first_attempt_at ?? startedAt,
      startedAt, finishedAt, job.active_run_attempt, job.lease_epoch, eventId,
      failure === null ? null : JSON.stringify(failure), retryAfterSeconds, computedDelaySeconds,
      nextEligibleAt, outcome, failure?.safe_detail_code ?? null, databaseTransactionCommitted,
      transportAction, durableDeadLetterId, job.trace_id]);
    return exactOne(result, 'JOB_ATTEMPT_OUTCOME_NOT_RECORDED', job.job_id);
  }

  async function terminalizeJob({ jobId, eventId, attempt, leaseToken = null, disposition, failure,
    retryPolicyVersion, startedAt, finishedAt, durableDeadLetterId = null }) {
    const job = await loadJob(jobId, { lock: true });
    invariant(job && job.run_id, 'JOB_NOT_FOUND', jobId);
    if (leaseToken) {
      const lease = parseJobLease(leaseToken, jobId);
      invariant(job.state === 'leased' && job.lease_owner === lease.ownerId && Number(job.lease_epoch) === lease.leaseEpoch, 'JOB_LEASE_FENCE_REJECTED', jobId);
    }
    invariant(Number(job.attempt_count) === attempt && job.retry_policy_version === retryPolicyVersion, 'JOB_ATTEMPT_FENCE_REJECTED', jobId);
    const terminalState = disposition === 'quarantine' ? 'quarantined' : disposition === 'typed_observation' ? 'succeeded' : 'dead';
    if (!TERMINAL_JOB_STATES.includes(job.state)) {
      await query('terminalize-job', `
        update ingest.jobs set state=$2, lease_owner=null, lease_expires_at=null,
          next_eligible_at=null, updated_at=$3::timestamptz
        where job_id=$1 and attempt_count=$4
      `, [jobId, terminalState, finishedAt, attempt]);
    } else {
      invariant(job.state === terminalState, 'JOB_TERMINAL_DISPOSITION_CONFLICT', jobId);
    }
    const terminalJob = await loadJob(jobId, { lock: true });
    const prior = optionalOne(await query('load-terminal-attempt', `
      select * from ingest.job_attempts where attempt_id=$1 and job_id=$2 and outcome='dead_lettered'
      order by recorded_at desc limit 1
    `, [await attemptId(jobId, attempt), jobId]), 'JOB_TERMINAL_ATTEMPT_DUPLICATE', jobId);
    if (!prior) {
      await insertAttemptOutcome({ job: terminalJob, eventId, deliveryAttempt: attempt, retryPolicyVersion,
        startedAt, finishedAt, failure, outcome: 'dead_lettered', databaseTransactionCommitted: true,
        transportAction: 'ack_after_commit', durableDeadLetterId });
    } else {
      invariant(prior.original_event_id === eventId && prior.failure_payload && canonicalJson(prior.failure_payload) === canonicalJson(failure) && prior.durable_dead_letter_id === durableDeadLetterId, 'JOB_TERMINAL_ATTEMPT_CONFLICT', jobId);
    }
    if (disposition === 'fail_enumeration') {
      await query('terminalize-enumeration-run', `
        update ingest.harvest_runs set state='partial_unpublished', terminal_at=$2::timestamptz, updated_at=$2::timestamptz
        where run_id=$1 and terminal_at is null
      `, [job.run_id, failure.observed_at]);
      await query('close-enumeration-workflow', `
        update ingest.workflow_attempt_mappings
        set platform_state='complete', is_active=false, terminal_at=$3::timestamptz,
            last_reconciled_at=$3::timestamptz
        where run_id=$1 and attempt=$2 and is_active
      `, [job.run_id, job.active_run_attempt, failure.observed_at]);
    }
    if (disposition === 'pause_source' || failure.failure_type === 'schema_drift') {
      const state = failure.failure_type === 'catalog_auth_misconfigured' ? 'auth_blocked'
        : failure.failure_type === 'schema_drift' ? 'schema_drift' : 'pause_requested';
      await query('terminal-outcome-source-state', `
        update registry.sources set state=$2, updated_at=$3::timestamptz
        where source_id=$1 and state <> 'retired'
      `, [job.source_id, state, failure.observed_at]);
    }
    return { recorded: true, state: terminalState };
  }

  const store = {
    async transaction(label, callback) {
      invariant(typeof callback === 'function', 'POSTGRES_TRANSACTION_CALLBACK_MISSING');
      invariant(transactionDepth === 0, 'POSTGRES_NESTED_TRANSACTION_UNSUPPORTED', label);
      transactionDepth += 1;
      let began = false;
      try {
        await query('transaction-begin', 'begin');
        began = true;
        const result = await callback(store);
        await query('transaction-commit', 'commit');
        began = false;
        return result;
      } catch (error) {
        if (began) {
          try { await client.query('rollback'); }
          catch (rollbackError) {
            logger.emit({ level: 'error', event: 'postgres.rollback_failed', outcome: 'failed', safe_detail_code: safeSqlState(rollbackError) ? `POSTGRES_${rollbackError.code}` : 'POSTGRES_ROLLBACK_FAILED' });
          }
        }
        throw wrapDatabaseError(error, `transaction:${label}`);
      } finally {
        transactionDepth -= 1;
      }
    },

    async leaseDueSources({ scheduledSlot, leaseAcquiredAt, leaseOwner, leaseExpiresAt, limit }) {
      const leased = rows(await query('lease-due-sources', `
        select * from registry.lease_due_source_schedules(
          $1::timestamptz,$2::timestamptz,$3,$4::timestamptz,$5::integer
        )
      `, [scheduledSlot, leaseAcquiredAt, leaseOwner, leaseExpiresAt, limit]));
      const groups = new Map();
      for (const row of leased) {
        const key = canonicalJson([row.source_id, row.endpoint_id, row.mode, Number(row.configuration_revision), row.optional_degradation_policy]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      }
      return [...groups.values()].map(group => Object.freeze({
        source_id: group[0].source_id,
        endpoint_id: group[0].endpoint_id,
        scope_ids: group.map(row => row.scope_id),
        mode: group[0].mode,
        configuration_revision: Number(group[0].configuration_revision),
        optional_degradation_policy: group[0].optional_degradation_policy ?? [],
        source_lease_token: scheduleLeaseToken(group),
        schedule_error_code: null
      }));
    },

    async ensureRunAndWorkflowOutbox(input) {
      invariant(input.activeAttempt === 1, 'INITIAL_WORKFLOW_ATTEMPT_MUST_BE_ONE');
      const lease = parseScheduleLease(input.sourceLeaseToken, input.sourceId, input.scopeIds);
      invariant(lease.endpointId === input.endpointId, 'SOURCE_SCHEDULE_ENDPOINT_FENCE_REJECTED', input.sourceId);
      const plans = rows(await query('resolve-harvest-plan', `
        select plan.plan_id
        from ingest.harvest_plans plan
        where plan.source_id=$1 and plan.endpoint_id=$2
          and plan.source_configuration_revision=$3
          and (select array_agg(scope.scope_id order by scope.scope_id)
               from ingest.harvest_plan_scopes scope
               where scope.plan_id=plan.plan_id and scope.required_for_publication)
              = (select array_agg(value order by value) from unnest($4::text[]) value)
        order by plan.created_at desc, plan.plan_id
        limit 2
      `, [input.sourceId, input.endpointId, input.configurationRevision, input.scopeIds]));
      invariant(plans.length === 1, plans.length === 0 ? 'HARVEST_PLAN_NOT_FOUND' : 'HARVEST_PLAN_AMBIGUOUS', input.sourceId);
      const result = exactOne(await query('ensure-scheduled-run', `
        select ingest.ensure_scheduled_run_and_workflow_start(
          $1::jsonb,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10::timestamptz,
          $11::timestamptz,$12::jsonb,$13::jsonb
        ) as value
      `, [JSON.stringify(lease.schedules.map(item => ({ schedule_id: item.schedule_id, lease_epoch: item.lease_epoch }))),
        lease.ownerId, plans[0].plan_id, input.runId, input.runIdempotencyKey,
        input.scheduledSlot, input.traceId, input.workflowInstanceId, input.workflowVersion,
        input.workflowRetentionExpiresAt, input.deadlineAt,
        JSON.stringify(input.optionalDegradationPolicy ?? []), JSON.stringify(input.barrierPolicy)]),
      'SCHEDULED_RUN_RESULT_MISSING', input.runId);
      return result.value;
    },

    async recordScheduleDispatchFailure({ sourceId, sourceLeaseToken, scopeIds, scheduledSlot, reasonCode, quarantine = false }) {
      const lease = parseScheduleLease(sourceLeaseToken, sourceId, scopeIds);
      const leaseSet = lease.schedules.map(item => ({ schedule_id: item.schedule_id, lease_epoch: item.lease_epoch }));
      const released = exactOne(await query('release-schedule-leases', `
        select registry.release_source_schedule_leases($1::jsonb,$2,$3::timestamptz,$4::boolean) as count
      `, [JSON.stringify(leaseSet), lease.ownerId, scheduledSlot, quarantine]), 'SOURCE_SCHEDULE_RELEASE_RESULT_MISSING', sourceId);
      const failureId = await deterministicOpaqueId('failure', { sourceId, scheduleIds: leaseSet.map(item => item.schedule_id), scheduledSlot, reasonCode });
      const traceId = traceFor('trace_scheduler_failure', failureId);
      await query('record-schedule-failure', `
        insert into ops.scheduler_source_failures(
          failure_id,source_id,schedule_ids,scheduled_slot,reason_code,outcome,trace_id,recorded_at
        ) values ($1,$2,$3::text[],$4::timestamptz,$5,$6,$7,$4::timestamptz)
        on conflict (failure_id) do nothing
      `, [failureId, sourceId, leaseSet.map(item => item.schedule_id), scheduledSlot, reasonCode, quarantine ? 'quarantined' : 'released_for_retry', traceId]);
      const receipt = exactOne(await query('verify-schedule-failure', `
        select * from ops.scheduler_source_failures where failure_id=$1
      `, [failureId]), 'SOURCE_SCHEDULE_FAILURE_RECEIPT_MISSING', failureId);
      invariant(receipt.source_id === sourceId && receipt.reason_code === reasonCode && receipt.outcome === (quarantine ? 'quarantined' : 'released_for_retry'), 'SOURCE_SCHEDULE_FAILURE_IDEMPOTENCY_CONFLICT', failureId);
      return { source_id: sourceId, quarantined: quarantine, released_count: Number(released.count), failure_id: failureId };
    },

    async leaseOutbox({ now, ownerId, leaseExpiresAt, transportRetentionExpiresAt, limit, excludeEventTypes = [] }) {
      await query('recover-expired-outbox-leases', `
        update ops.outbox
        set state='published', lease_owner=null, lease_expires_at=null,
            published_at=$1::timestamptz, send_outcome='published_outcome_unknown',
            safe_detail_code='OUTBOX_SEND_OUTCOME_UNKNOWN_AWAITING_QUEUE_RETENTION'
        where state='leased' and lease_expires_at <= $1::timestamptz
          and event_type <> 'workflow_start_requested'
          and transport_retention_expires_at is not null
      `, [now]);
      const leased = rows(await query('lease-outbox', `
        with candidates as (
          select event_id from ops.outbox
          where state in ('pending','retry_wait')
            and not (event_type = any($5::text[]))
            and attempt_count < maximum_delivery_attempts
            and coalesce(next_eligible_at,'-infinity'::timestamptz) <= $1::timestamptz
          order by coalesce(next_eligible_at,'-infinity'::timestamptz),created_at,event_id
          for update skip locked limit $4::integer
        ), leased as (
          update ops.outbox event set state='leased',lease_owner=$2,
            lease_epoch=event.lease_epoch+1,lease_expires_at=$3::timestamptz,
            first_attempt_at=coalesce(event.first_attempt_at,$1::timestamptz),
            attempt_count=event.attempt_count+1,send_outcome='send_started',
            transport_retention_expires_at=$6::timestamptz
          from candidates where event.event_id=candidates.event_id returning event.*
        )
        select leased.*, job.active_run_attempt as run_attempt,
               job.lease_epoch as job_lease_epoch, job.retry_policy_version
        from leased
        left join ingest.jobs job on job.job_id=leased.references_payload->>'job_id'
        order by leased.created_at,leased.event_id
      `, [now, ownerId, leaseExpiresAt, limit, excludeEventTypes, transportRetentionExpiresAt]));
      return leased.map(row => Object.freeze({
        ...row,
        attempt_count: Number(row.attempt_count),
        maximum_delivery_attempts: Number(row.maximum_delivery_attempts),
        run_attempt: row.run_attempt === null ? null : Number(row.run_attempt),
        job_lease_epoch: row.job_lease_epoch === null ? null : Number(row.job_lease_epoch),
        references: row.references_payload,
        lease_token: outboxLeaseToken(row),
        schema_version: '1.0.0'
      }));
    },

    async loadQueueRouting({ eventId, eventType, sourceId, jobId }) {
      return exactOne(await query('load-queue-routing', `
        select job.origin_id, job.target_class
        from ops.outbox event
        join ingest.jobs job on job.job_id=event.references_payload->>'job_id'
        where event.event_id=$1 and event.event_type=$2
          and event.references_payload->>'job_id'=$4
          and job.source_id=$3 and job.run_id=event.references_payload->>'run_id'
      `, [eventId, eventType, sourceId, jobId]), 'QUEUE_ROUTING_LINEAGE_MISSING', eventId);
    },

    async markOutboxPublished({ eventId, leaseToken, publishedAt, transportRetentionExpiresAt }) {
      const lease = parseOutboxLease(leaseToken, eventId);
      const event = exactOne(await query('mark-outbox-published', `
        update ops.outbox set state='published',lease_owner=null,lease_expires_at=null,
          published_at=$4::timestamptz,transport_retention_expires_at=$5::timestamptz,
          send_outcome='published_confirmed',safe_detail_code=null
        where event_id=$1 and state='leased' and lease_owner=$2 and lease_epoch=$3
        returning *
      `, [eventId, lease.ownerId, lease.leaseEpoch, publishedAt, transportRetentionExpiresAt]), 'OUTBOX_LEASE_FENCE_REJECTED', eventId);
      await query('mark-job-transport-published', `
        update ingest.jobs set last_transport_event_id=$1,
          transport_retention_expires_at=$2::timestamptz,updated_at=$3::timestamptz
        where job_id=$4
      `, [eventId, transportRetentionExpiresAt, publishedAt, event.references_payload?.job_id ?? null]);
      return { ...event, references: event.references_payload };
    },

    async markOutboxRetry({ eventId, leaseToken, nextEligibleAt, safeDetailCode }) {
      const lease = parseOutboxLease(leaseToken, eventId);
      const event = exactOne(await query('mark-outbox-retry', `
        update ops.outbox set state='retry_wait',lease_owner=null,lease_expires_at=null,
          next_eligible_at=$4::timestamptz,transport_retention_expires_at=null,
          send_outcome='pre_send_failed',safe_detail_code=$5
        where event_id=$1 and state='leased' and lease_owner=$2 and lease_epoch=$3
        returning *
      `, [eventId, lease.ownerId, lease.leaseEpoch, nextEligibleAt, safeDetailCode]), 'OUTBOX_LEASE_FENCE_REJECTED', eventId);
      await query('clear-job-transport-after-retry', `
        update ingest.jobs set last_transport_event_id=null,transport_retention_expires_at=null
        where job_id=$1 and last_transport_event_id=$2
      `, [event.references_payload?.job_id ?? null, eventId]);
      return { ...event, references: event.references_payload };
    },

    async markOutboxDead({ eventId, leaseToken, failedAt, safeDetailCode }) {
      const lease = parseOutboxLease(leaseToken, eventId);
      const event = exactOne(await query('mark-outbox-dead', `
        update ops.outbox set state='dead',lease_owner=null,lease_expires_at=null,
          next_eligible_at=null,send_outcome='pre_send_failed',safe_detail_code=$5
        where event_id=$1 and state='leased' and lease_owner=$2 and lease_epoch=$3
        returning *
      `, [eventId, lease.ownerId, lease.leaseEpoch, failedAt, safeDetailCode]), 'OUTBOX_LEASE_FENCE_REJECTED', eventId);
      return { ...event, references: event.references_payload, failed_at: failedAt };
    },

    async getWorkflowStart({ now, limit }) {
      const starts = rows(await query('lease-workflow-start', `
        with candidates as (
          select event_id from ops.outbox
          where event_type='workflow_start_requested'
            and state in ('pending','retry_wait','leased')
            and (state <> 'leased' or lease_expires_at <= $1::timestamptz)
            and attempt_count < maximum_delivery_attempts
            and coalesce(next_eligible_at,'-infinity'::timestamptz) <= $1::timestamptz
          order by created_at,event_id for update skip locked limit $2::integer
        )
        update ops.outbox event set state='leased',lease_owner='workflow_start_dispatcher',
          lease_epoch=event.lease_epoch+1,lease_expires_at=$1::timestamptz+interval '60 seconds',
          first_attempt_at=coalesce(event.first_attempt_at,$1::timestamptz),
          attempt_count=event.attempt_count+1,send_outcome='send_started'
        from candidates where event.event_id=candidates.event_id
        returning event.*
      `, [now, limit]));
      return starts.map(row => Object.freeze({
        event_id: row.event_id,
        run_id: row.references_payload.run_id,
        attempt: Number(row.workflow_attempt),
        workflow_instance_id: row.workflow_instance_id,
        lease_token: outboxLeaseToken(row),
        attempt_count: Number(row.attempt_count),
        maximum_delivery_attempts: Number(row.maximum_delivery_attempts)
      }));
    },

    async listWorkflowRetentionRisks({ now, limit }) {
      return rows(await query('list-workflow-retention-risks', `
        select run.*, mapping.retention_expires_at as workflow_retention_expires_at
        from ingest.harvest_runs run
        join ingest.workflow_attempt_mappings mapping
          on mapping.run_id=run.run_id and mapping.attempt=run.active_attempt
        where run.terminal_at is null and mapping.retention_expires_at <= $1::timestamptz
        order by mapping.retention_expires_at,run.run_id limit $2::integer
      `, [now, limit]));
    },

    async listActiveWorkflowMappings({ limit }) {
      return rows(await query('list-active-workflow-mappings', `
        select * from ingest.workflow_attempt_mappings
        where is_active and platform_state not in ('complete','errored')
          and coalesce(next_status_check_at,'-infinity'::timestamptz) <= clock_timestamp()
        order by coalesce(last_reconciled_at,'-infinity'::timestamptz),retention_expires_at,run_id
        limit $1::integer
      `, [limit]));
    },

    async recordWorkflowMapping(mapping) {
      const run = exactOne(await query('load-run-for-workflow-mapping', `
        select run.*, event.workflow_retention_expires_at
        from ingest.harvest_runs run
        join ops.outbox event on event.event_type='workflow_start_requested'
          and event.references_payload->>'run_id'=run.run_id
        where run.run_id=$1 and run.active_attempt=$2
        for update of run
      `, [mapping.runId, mapping.attempt]), 'RUN_ATTEMPT_FENCE_REJECTED', mapping.runId);
      const inserted = rows(await query('record-workflow-mapping', `
        insert into ingest.workflow_attempt_mappings(
          run_id,attempt,workflow_instance_id,workflow_version,platform_state,is_active,
          created_at,retention_expires_at,last_reconciled_at,next_status_check_at,terminal_at
        ) values ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,null,null,$9::timestamptz)
        on conflict (run_id,attempt) do nothing returning *
      `, [mapping.runId, mapping.attempt, mapping.workflowInstanceId, mapping.workflowVersion,
        mapping.platformState, mapping.terminalAt === null || mapping.terminalAt === undefined,
        mapping.recordedAt, run.workflow_retention_expires_at, mapping.terminalAt ?? null]));
      const current = inserted[0] ?? exactOne(await query('verify-workflow-mapping', `
        select * from ingest.workflow_attempt_mappings where run_id=$1 and attempt=$2
      `, [mapping.runId, mapping.attempt]), 'WORKFLOW_MAPPING_MISSING', mapping.runId);
      invariant(current.workflow_instance_id === mapping.workflowInstanceId && current.workflow_version === mapping.workflowVersion, 'WORKFLOW_MAPPING_CONFLICT', mapping.runId);
      if (run.state === 'scheduled' && mapping.terminalAt == null) {
        await query('advance-run-to-starting', `
          update ingest.harvest_runs set state='starting',updated_at=$3::timestamptz
          where run_id=$1 and active_attempt=$2 and state='scheduled' and terminal_at is null
        `, [mapping.runId, mapping.attempt, mapping.recordedAt]);
      }
      return { created: inserted.length === 1 };
    },

    async updateWorkflowMappingState({ runId, attempt, workflowInstanceId, platformState, observedAt }) {
      return exactOne(await query('update-workflow-mapping-state', `
        update ingest.workflow_attempt_mappings
        set platform_state=$4,last_reconciled_at=$5::timestamptz,next_status_check_at=$5::timestamptz
        where run_id=$1 and attempt=$2 and workflow_instance_id=$3 and is_active
        returning *
      `, [runId, attempt, workflowInstanceId, platformState, observedAt]), 'WORKFLOW_MAPPING_FENCE_REJECTED', runId);
    },

    async markWorkflowStartResolved({ eventId, workflowInstanceId, leaseToken, resolvedAt }) {
      const lease = parseOutboxLease(leaseToken, eventId);
      return exactOne(await query('resolve-workflow-start', `
        update ops.outbox set state='published',lease_owner=null,lease_expires_at=null,
          published_at=$5::timestamptz,send_outcome='published_confirmed',safe_detail_code=null
        where event_id=$1 and workflow_instance_id=$2 and state='leased'
          and lease_owner=$3 and lease_epoch=$4 returning *
      `, [eventId, workflowInstanceId, lease.ownerId, lease.leaseEpoch, resolvedAt]), 'WORKFLOW_EVENT_FENCE_REJECTED', eventId);
    },

    async markWorkflowStartDead({ eventId, workflowInstanceId, leaseToken, failedAt, safeDetailCode }) {
      const lease = parseOutboxLease(leaseToken, eventId);
      return exactOne(await query('dead-workflow-start', `
        update ops.outbox set state='dead',lease_owner=null,lease_expires_at=null,
          send_outcome='pre_send_failed',safe_detail_code=$6
        where event_id=$1 and workflow_instance_id=$2 and state='leased'
          and lease_owner=$3 and lease_epoch=$4 returning *
      `, [eventId, workflowInstanceId, lease.ownerId, lease.leaseEpoch, failedAt, safeDetailCode]), 'WORKFLOW_EVENT_FENCE_REJECTED', eventId);
    },

    async failRunForWorkflowControl({ runId, attempt, failedAt, reasonCode, auditAction = 'workflow_control_failed', mappingPlatformState = 'errored', preserveWorkflowStartEvent = false }) {
      const run = exactOne(await query('load-run-for-control-failure', `
        select * from ingest.harvest_runs where run_id=$1 and active_attempt=$2 for update
      `, [runId, attempt]), 'RUN_ATTEMPT_FENCE_REJECTED', runId);
      if (run.terminal_at !== null) return runWithScopes(run);
      const failed = exactOne(await query('fail-run-for-workflow-control', `
        update ingest.harvest_runs set state='failed',terminal_at=$3::timestamptz,updated_at=$3::timestamptz
        where run_id=$1 and active_attempt=$2 and terminal_at is null returning *
      `, [runId, attempt, failedAt]), 'RUN_ATTEMPT_FENCE_REJECTED', runId);
      await query('close-workflow-mapping-for-failure', `
        update ingest.workflow_attempt_mappings
        set platform_state=$3,is_active=false,terminal_at=$4::timestamptz,last_reconciled_at=$4::timestamptz
        where run_id=$1 and attempt=$2 and is_active
      `, [runId, attempt, mappingPlatformState, failedAt]);
      if (!preserveWorkflowStartEvent) {
        await query('dead-workflow-event-for-run-failure', `
          update ops.outbox set state='dead',lease_owner=null,lease_expires_at=null,
            send_outcome='pre_send_failed',safe_detail_code=$3
          where event_type='workflow_start_requested' and references_payload->>'run_id'=$1
            and workflow_attempt=$2 and state in ('pending','retry_wait','leased')
        `, [runId, attempt, reasonCode]);
      }
      await store.appendAudit({ auditEventId: await deterministicOpaqueId('audit', { auditAction, runId, attempt, failedAt }), action: auditAction, runId, reasonCode, recordedAt: failedAt });
      return runWithScopes(failed);
    },

    async failRunForExpiredWorkflow({ runId, attempt, reconciledAt, auditReason }) {
      return store.failRunForWorkflowControl({ runId, attempt, failedAt: reconciledAt, reasonCode: auditReason, auditAction: 'workflow_retention_expired' });
    },

    async loadRunForWorkflow({ runId, attempt }) {
      const run = optionalOne(await query('load-run-for-workflow', `
        select run.*, coalesce(scopes.scope_ids,'{}'::text[]) as scope_ids,
               workflow.workflow_instance_id,
               workflow.workflow_retention_expires_at
        from ingest.harvest_runs run
        left join lateral (
          select array_agg(scope_id order by ordinal) as scope_ids
          from ingest.harvest_run_scopes where run_id=run.run_id and required_for_publication
        ) scopes on true
        left join lateral (
          select event.workflow_instance_id,event.workflow_retention_expires_at
          from ops.outbox event
          where event.event_type='workflow_start_requested'
            and event.references_payload->>'run_id'=run.run_id
            and event.workflow_attempt=run.active_attempt
          order by event.created_at desc limit 1
        ) workflow on true
        where run.run_id=$1 and run.active_attempt=$2
      `, [runId, attempt]), 'RUN_ID_NOT_UNIQUE', runId);
      if (!run) return null;
      invariant(run.workflow_retention_expires_at, 'WORKFLOW_RETENTION_EVIDENCE_MISSING', runId);
      return runWithScopes(run);
    },

    async ensureInitialPageJob({ runId, attempt, admittedAt }) {
      const run = await store.loadRunForWorkflow({ runId, attempt });
      invariant(run && run.terminal_at === null, 'RUN_ATTEMPT_FENCE_REJECTED', runId);
      invariant(Date.parse(admittedAt) < Date.parse(run.deadline_at), 'RUN_DEADLINE_ADMISSION_FENCE_REJECTED', runId);
      const jobIds = [];
      let created = 0;
      for (const scopeId of run.scope_ids) {
        const jobId = await deterministicOpaqueId('job_page', { runId, scopeId, attempt });
        const eventId = await deterministicOpaqueId('event_page', { runId, scopeId, attempt });
        const references = completeReferences({ run_id: runId, job_id: jobId, cursor_ref_id: `cursor_initial_${jobId}` });
        const jobResult = rows(await query('ensure-initial-page-job', `
          insert into ingest.jobs(
            job_id,run_id,source_id,job_type,origin_id,target_class,state,
            idempotency_key,identity_payload,active_run_attempt,attempt_count,
            maximum_delivery_attempts,lease_owner,lease_epoch,lease_expires_at,
            retry_policy_version,first_attempt_at,next_eligible_at,outbox_event_id,
            created_at,updated_at
          ) values ($1,$2,$3,'harvest_page',$4,'pagination_cursor','pending',$5,$6::jsonb,
                    $7,0,6,null,1,null,'retry.v1',null,null,$8,$9::timestamptz,$9::timestamptz)
          on conflict (job_type,idempotency_key) do nothing returning *
        `, [jobId, runId, run.source_id, `origin:${run.endpoint_id}`,
          `page:${runId}:${scopeId}:${attempt}`,
          JSON.stringify({ cursor_sha256: null, scope_id: scopeId, scheduled_slot: run.scheduled_slot }),
          attempt, eventId, admittedAt]));
        const job = jobResult[0] ?? exactOne(await query('verify-initial-page-job', `
          select * from ingest.jobs where job_type='harvest_page' and idempotency_key=$1
        `, [`page:${runId}:${scopeId}:${attempt}`]), 'INITIAL_PAGE_JOB_MISSING', jobId);
        invariant(job.job_id === jobId && job.run_id === runId && Number(job.active_run_attempt) === attempt && job.outbox_event_id === eventId, 'INITIAL_PAGE_JOB_IDEMPOTENCY_CONFLICT', jobId);
        await query('ensure-initial-page-outbox', `
          insert into ops.outbox(
            event_id,event_type,producer,idempotency_key,state,references_payload,trace_id,
            attempt_count,maximum_delivery_attempts,lease_owner,lease_epoch,lease_expires_at,
            first_attempt_at,next_eligible_at,transport_retention_expires_at,send_outcome,
            safe_detail_code,created_at,updated_at,published_at,workflow_instance_id,
            workflow_attempt,workflow_version,workflow_retention_expires_at,run_deadline_at
          ) values ($1,'harvest_page_requested','workflow',$2,'pending',$3::jsonb,$4,
                    0,6,null,0,null,null,null,null,'not_started',null,$5::timestamptz,
                    $5::timestamptz,null,null,null,null,null,null)
          on conflict (event_id) do nothing
        `, [eventId, `event:harvest_page_requested:${jobId}`, JSON.stringify(references), run.trace_id, admittedAt]);
        const outbox = exactOne(await query('verify-initial-page-outbox', `select * from ops.outbox where event_id=$1`, [eventId]), 'INITIAL_PAGE_OUTBOX_MISSING', eventId);
        invariant(outbox.event_type === 'harvest_page_requested' && outbox.references_payload.run_id === runId && outbox.references_payload.job_id === jobId, 'INITIAL_PAGE_OUTBOX_IDEMPOTENCY_CONFLICT', eventId);
        jobIds.push(jobId);
        created += jobResult.length;
      }
      if (run.state === 'starting') {
        await query('advance-run-to-enumerating', `
          update ingest.harvest_runs set state='enumerating',updated_at=$3::timestamptz
          where run_id=$1 and active_attempt=$2 and state='starting' and terminal_at is null
        `, [runId, attempt, admittedAt]);
      }
      return { created: created > 0, created_count: created, job_ids: jobIds };
    },

    async readEnumerationBarrier({ runId, attempt, checkedAt }) {
      const run = exactOne(await query('read-enumeration-run', `
        select run.*, scope_set.expected_scope_count, scope_set.state as scope_set_state
        from ingest.harvest_runs run
        join ingest.harvest_run_scope_sets scope_set on scope_set.run_id=run.run_id
        where run.run_id=$1 and run.active_attempt=$2
      `, [runId, attempt]), 'RUN_ATTEMPT_FENCE_REJECTED', runId);
      const expected = rows(await query('read-enumeration-scopes', `
        select run_scope.scope_id,run_scope.enumeration_seal_id,run_scope.state,
               seal.source_id,seal.status,seal.pages_discovered,seal.pages_committed,
               seal.items_discovered,seal.discoveries_committed,seal.page_dead_letter_count,
               seal.cursor_expired,seal.population_sha256,seal.completeness_evidence_reference_id,
               seal.sealed_at
        from ingest.harvest_run_scopes run_scope
        left join ingest.enumeration_seals seal
          on seal.enumeration_seal_id=run_scope.enumeration_seal_id
        where run_scope.run_id=$1 and run_scope.required_for_publication
        order by run_scope.ordinal
      `, [runId]));
      invariant(expected.length === Number(run.expected_scope_count), 'ENUMERATION_EXPECTED_SCOPE_CARDINALITY_DRIFT', runId);
      const seals = expected.filter(row => row.enumeration_seal_id && row.status === 'sealed').map(row => Object.freeze({
        contract_version: 'ingestion.v1.0.0', record_kind: 'enumeration_seal',
        enumeration_seal_id: row.enumeration_seal_id, run_id: runId,
        source_id: row.source_id, scope_id: row.scope_id, status: row.status,
        pages_discovered: Number(row.pages_discovered), pages_committed: Number(row.pages_committed),
        items_discovered: Number(row.items_discovered), discoveries_committed: Number(row.discoveries_committed),
        page_dead_letter_count: Number(row.page_dead_letter_count), cursor_expired: row.cursor_expired,
        population_digest: row.population_sha256,
        completeness_evidence_ref_id: row.completeness_evidence_reference_id,
        sealed_at: row.sealed_at
      }));
      const missingScopeIds = expected.filter(row => row.status !== 'sealed').map(row => row.scope_id);
      const sealed = run.scope_set_state === 'sealed' && seals.length === expected.length && missingScopeIds.length === 0;
      return Object.freeze({
        status: sealed ? 'sealed' : run.scope_set_state === 'failed' ? 'failed' : 'open',
        run_id: runId, seals, missing_scope_ids: missingScopeIds,
        duplicate_scope_ids: [], foreign_scope_ids: [], checked_at: checkedAt,
        sealed_at: sealed ? seals.map(item => item.sealed_at).sort().at(-1) : null
      });
    },

    async commitCheckpointAndNormalizationOutbox({ runId, attempt, enumerationSealIds, normalizerVersion = '1.0.0' }) {
      const run = exactOne(await query('load-checkpoint-run', `
        select * from ingest.harvest_runs where run_id=$1 and active_attempt=$2 and terminal_at is null for update
      `, [runId, attempt]), 'RUN_ATTEMPT_FENCE_REJECTED', runId);
      const scopes = rows(await query('load-checkpoint-scopes', `
        select run_scope.*,seal.population_sha256,seal.sealed_at,
               prior.position_payload as prior_position_payload
        from ingest.harvest_run_scopes run_scope
        join ingest.enumeration_seals seal on seal.enumeration_seal_id=run_scope.enumeration_seal_id
        left join ingest.checkpoints prior on prior.checkpoint_id=run_scope.expected_prior_checkpoint_id
        where run_scope.run_id=$1 and run_scope.required_for_publication
        order by run_scope.ordinal for update of run_scope
      `, [runId]));
      const actualSealIds = scopes.map(row => row.enumeration_seal_id).sort();
      invariant(canonicalJson(actualSealIds) === canonicalJson([...enumerationSealIds].sort()) && scopes.every(row => row.state === 'sealed' || row.state === 'checkpoint_committed'), 'CHECKPOINT_BARRIER_REJECTED', runId);
      const digest = exactOne(await query('compute-normalization-manifest-digest', `
        select encode(sha256(convert_to(coalesce(jsonb_agg(
          jsonb_build_object('capture_reference_id',required.capture_reference_id,
            'capture_sha256',required.raw_sha256,'normalizer_version',$2)
          order by required.raw_sha256,required.capture_reference_id
        ),'[]'::jsonb)::text,'UTF8')),'hex') as manifest_sha256,
        coalesce(max(required.recorded_at),$3::timestamptz) as sealed_at
        from (
          select distinct capture.capture_reference_id,capture.raw_sha256,capture.recorded_at
          from ingest.discoveries discovery
          join ingest.capture_references capture on capture.capture_reference_id=discovery.capture_reference_id
          where discovery.run_id=$1 and capture.r2_conditional_write_confirmed
            and capture.classification in ('catalog_metadata','documentation')
        ) required
      `, [runId, normalizerVersion, scopes.map(row => row.sealed_at).sort().at(-1)]), 'NORMALIZATION_MANIFEST_DIGEST_MISSING', runId);
      await query('seal-normalization-manifest', `
        select ingest.seal_run_normalization_manifest($1,$2,$3,$4::timestamptz)
      `, [runId, normalizerVersion, digest.manifest_sha256, digest.sealed_at]);
      const checkpointSet = [];
      for (const scope of scopes) {
        if (scope.state === 'checkpoint_committed') {
          const committed = exactOne(await query('read-committed-checkpoint', `select * from ingest.checkpoints where checkpoint_id=$1`, [scope.committed_checkpoint_id]), 'COMMITTED_CHECKPOINT_MISSING', scope.scope_id);
          checkpointSet.push({
            scope_id: scope.scope_id, checkpoint_id: committed.checkpoint_id,
            checkpoint_sha256: committed.checkpoint_sha256,
            enumeration_seal_id: committed.enumeration_seal_id,
            expected_prior_checkpoint_id: committed.prior_checkpoint_id,
            expected_prior_checkpoint_sha256: committed.prior_checkpoint_sha256,
            strategy: committed.strategy, position_payload: committed.position_payload
          });
          continue;
        }
        const checkpointId = await deterministicOpaqueId('checkpoint', { runId, scopeId: scope.scope_id, enumerationSealId: scope.enumeration_seal_id });
        const priorSequence = Number(scope.prior_position_payload?.full_enumeration_sequence ?? 0);
        const positionPayload = {
          publisher_modified_at: null, native_id: null, opaque_cursor_ref_id: null,
          full_enumeration_sequence: priorSequence + 1, position_digest: scope.population_sha256
        };
        const checkpointSha256 = await sha256Hex(canonicalJson({
          checkpointId, sourceId: scope.source_id, scopeId: scope.scope_id,
          configurationRevision: Number(run.source_configuration_revision), position: positionPayload,
          priorCheckpointId: scope.expected_prior_checkpoint_id,
          priorCheckpointDigest: scope.expected_prior_checkpoint_sha256,
          enumerationSealId: scope.enumeration_seal_id
        }));
        checkpointSet.push({
          scope_id: scope.scope_id, checkpoint_id: checkpointId, checkpoint_sha256: checkpointSha256,
          enumeration_seal_id: scope.enumeration_seal_id,
          expected_prior_checkpoint_id: scope.expected_prior_checkpoint_id,
          expected_prior_checkpoint_sha256: scope.expected_prior_checkpoint_sha256,
          strategy: 'full_snapshot', position_payload: positionPayload
        });
      }
      const receipt = exactOne(await query('commit-all-scope-checkpoints', `
        select ingest.commit_all_scope_checkpoints_and_normalization_outbox(
          $1,$2::jsonb,$3,$4::timestamptz
        ) as value
      `, [runId, JSON.stringify(checkpointSet), run.trace_id, digest.sealed_at]), 'CHECKPOINT_COMMIT_RECEIPT_MISSING', runId).value;
      if (run.state === 'enumerating') {
        await query('advance-run-enumerated', `update ingest.harvest_runs set state='enumerated' where run_id=$1 and state='enumerating'`, [runId]);
      }
      await query('advance-run-normalizing', `update ingest.harvest_runs set state='normalizing' where run_id=$1 and state='enumerated'`, [runId]);
      return Object.freeze({
        ...receipt, checkpoint_set_id: run.scope_set_id,
        normalization_job_count: Number(receipt.required_capture_count), checkpoints: checkpointSet
      });
    },

    async readNormalizationBarrier({ runId, attempt, checkedAt }) {
      const evidence = exactOne(await query('read-normalization-barrier', `
        select run.run_id,run.scheduled_slot,run.scope_set_id,run_scope_set.state as scope_set_state,
          manifest.state as manifest_state,manifest.required_capture_count,
          count(requirement.*)::integer as requirement_count,
          count(requirement.*) filter (where job.state='succeeded')::integer as succeeded_count,
          count(requirement.*) filter (where job.state in ('succeeded','quarantined','dead'))::integer as terminal_count,
          count(requirement.*) filter (where job.state in ('quarantined','dead'))::integer as required_dead_letter_count,
          max(job.updated_at) as last_job_at
        from ingest.harvest_runs run
        join ingest.harvest_run_scope_sets run_scope_set on run_scope_set.run_id=run.run_id
        left join ingest.normalization_manifests manifest on manifest.run_id=run.run_id
        left join ingest.normalization_job_requirements requirement on requirement.run_id=run.run_id
        left join ingest.jobs job on job.job_id=requirement.job_id
        where run.run_id=$1 and run.active_attempt=$2
        group by run.run_id,run.scheduled_slot,run.scope_set_id,run_scope_set.state,
                 manifest.state,manifest.required_capture_count
      `, [runId, attempt]), 'RUN_ATTEMPT_FENCE_REJECTED', runId);
      const required = Number(evidence.required_capture_count ?? 0);
      const complete = evidence.scope_set_state === 'checkpoint_committed' && evidence.manifest_state === 'sealed'
        && Number(evidence.requirement_count) === required && Number(evidence.succeeded_count) === required;
      return Object.freeze({
        status: complete ? 'complete' : 'pending', run_id: runId,
        observed_at: evidence.last_job_at ?? checkedAt,
        checked_at: checkedAt,
        observed_revision_count: Number(evidence.succeeded_count),
        normalization_terminal_count: Number(evidence.terminal_count),
        required_dead_letter_count: Number(evidence.required_dead_letter_count),
        membership_checkpoint_committed: evidence.scope_set_state === 'checkpoint_committed',
        w1_revision_manifest_sealed: evidence.manifest_state === 'sealed',
        optional_degradations: []
      });
    },

    async requestProjection({ runId, attempt, optionalDegradations }) {
      const barrier = await store.readNormalizationBarrier({ runId, attempt, checkedAt: new Date().toISOString() });
      invariant(barrier.status === 'complete' && barrier.required_dead_letter_count === 0, 'PROJECTION_NORMALIZATION_BARRIER_INCOMPLETE', runId);
      invariant(Array.isArray(optionalDegradations), 'OPTIONAL_DEGRADATIONS_INVALID', runId);
      const run = exactOne(await query('load-projection-run', `select * from ingest.harvest_runs where run_id=$1 and active_attempt=$2 and terminal_at is null for update`, [runId, attempt]), 'RUN_ATTEMPT_FENCE_REJECTED', runId);
      const jobId = await deterministicOpaqueId('job_projection', { runId, attempt });
      const eventId = await deterministicOpaqueId('event_projection', { runId, attempt });
      const references = completeReferences({ run_id: runId, job_id: jobId });
      await query('ensure-projection-job', `
        insert into ingest.jobs(job_id,run_id,source_id,job_type,origin_id,target_class,state,
          idempotency_key,identity_payload,active_run_attempt,attempt_count,maximum_delivery_attempts,
          lease_owner,lease_epoch,lease_expires_at,retry_policy_version,first_attempt_at,
          next_eligible_at,outbox_event_id,created_at,updated_at)
        values ($1,$2,$3,'project_index',$4,'collection','pending',$5,$6::jsonb,$7,0,5,
          null,1,null,'retry.v1',null,null,$8,clock_timestamp(),clock_timestamp())
        on conflict (job_type,idempotency_key) do nothing
      `, [jobId, runId, run.source_id, `origin:${run.endpoint_id}`, `projection:${runId}:${attempt}`,
        JSON.stringify({ projection_version: run.workflow_version, optional_degradations: optionalDegradations }), attempt, eventId]);
      const job = exactOne(await query('verify-projection-job', `select * from ingest.jobs where job_type='project_index' and idempotency_key=$1`, [`projection:${runId}:${attempt}`]), 'PROJECTION_JOB_MISSING', jobId);
      invariant(job.job_id === jobId && job.outbox_event_id === eventId, 'PROJECTION_JOB_IDEMPOTENCY_CONFLICT', jobId);
      await query('ensure-projection-outbox', `
        insert into ops.outbox(event_id,event_type,producer,idempotency_key,state,references_payload,
          trace_id,attempt_count,maximum_delivery_attempts,lease_owner,lease_epoch,lease_expires_at,
          first_attempt_at,next_eligible_at,transport_retention_expires_at,send_outcome,safe_detail_code,
          created_at,updated_at,published_at,workflow_instance_id,workflow_attempt,workflow_version,
          workflow_retention_expires_at,run_deadline_at)
        values ($1,'projection_requested','workflow',$2,'pending',$3::jsonb,$4,0,5,null,0,null,
          null,null,null,'not_started',null,clock_timestamp(),clock_timestamp(),null,null,null,null,null,null)
        on conflict (event_id) do nothing
      `, [eventId, `event:projection_requested:${jobId}`, JSON.stringify(references), run.trace_id]);
      if (run.state === 'normalizing') await query('advance-run-projecting', `update ingest.harvest_runs set state='projecting' where run_id=$1 and state='normalizing'`, [runId]);
      return { event_id: eventId };
    },

    async readProjectionBarrier({ runId, attempt, checkedAt }) {
      const row = optionalOne(await query('read-projection-barrier', `
        select barrier_payload,recorded_at from ops.run_publication_barriers
        where run_id=$1 and attempt=$2
      `, [runId, attempt]), 'PROJECTION_BARRIER_DUPLICATE', runId);
      if (!row) return Object.freeze({ status: 'pending', checked_at: checkedAt, observed_at: checkedAt });
      invariant(row.barrier_payload?.run_id === runId, 'PROJECTION_BARRIER_LINEAGE_REJECTED', runId);
      return Object.freeze({ ...row.barrier_payload, checked_at: checkedAt });
    },

    async recordCoverageAndCompleteRun({ runId, attempt, enumeration, normalization, projection, outcome }) {
      invariant(['succeeded', 'succeeded_with_optional_degradation'].includes(outcome), 'RUN_COMPLETION_OUTCOME_INVALID', outcome);
      const run = exactOne(await query('load-run-for-completion', `select * from ingest.harvest_runs where run_id=$1 and active_attempt=$2 for update`, [runId, attempt]), 'RUN_ATTEMPT_FENCE_REJECTED', runId);
      const storedProjection = exactOne(await query('load-stored-publication-barrier', `select barrier_payload from ops.run_publication_barriers where run_id=$1 and attempt=$2`, [runId, attempt]), 'PUBLICATION_BARRIER_EVIDENCE_MISSING', runId).barrier_payload;
      invariant(canonicalJson(storedProjection) === canonicalJson(Object.fromEntries(Object.entries(projection).filter(([key]) => key !== 'checked_at'))), 'PUBLICATION_BARRIER_EVIDENCE_MISMATCH', runId);
      invariant(enumeration.status === 'sealed' && ['complete', 'complete_with_optional_degradation'].includes(normalization.status), 'RUN_COMPLETION_BARRIER_REJECTED', runId);
      invariant(storedProjection.run_outcome === outcome && storedProjection.coverage_reconciled === true && storedProjection.visibility_verified === true && storedProjection.active_publication_id === storedProjection.candidate_publication_id, 'RUN_COMPLETION_BARRIER_REJECTED', runId);
      if (run.terminal_at !== null) {
        invariant(run.state === outcome && run.candidate_publication_id === storedProjection.candidate_publication_id, 'RUN_TERMINAL_STEP_LINEAGE_MISMATCH', runId);
        return { state: run.state, recorded_at: run.terminal_at, publication_id: run.candidate_publication_id };
      }
      invariant(run.state === 'projecting', 'RUN_COMPLETION_STATE_REJECTED', runId);
      await query('advance-run-published', `
        update ingest.harvest_runs set state='published',candidate_publication_id=$3,updated_at=$4::timestamptz
        where run_id=$1 and active_attempt=$2 and state='projecting' and terminal_at is null
      `, [runId, attempt, storedProjection.candidate_publication_id, storedProjection.evaluated_at]);
      const completed = exactOne(await query('complete-run', `
        update ingest.harvest_runs set state=$3,terminal_at=$4::timestamptz,updated_at=$4::timestamptz
        where run_id=$1 and active_attempt=$2 and state='published' returning *
      `, [runId, attempt, outcome, storedProjection.evaluated_at]), 'RUN_COMPLETION_CAS_REJECTED', runId);
      await query('complete-workflow-mapping', `
        update ingest.workflow_attempt_mappings set platform_state='complete',is_active=false,
          terminal_at=$3::timestamptz,last_reconciled_at=$3::timestamptz
        where run_id=$1 and attempt=$2 and is_active
      `, [runId, attempt, storedProjection.evaluated_at]);
      return { state: completed.state, recorded_at: completed.terminal_at, publication_id: completed.candidate_publication_id };
    },

    async markRunPartialUnpublished({ runId, attempt, stage, barrier }) {
      const run = exactOne(await query('load-run-for-partial', `select * from ingest.harvest_runs where run_id=$1 and active_attempt=$2 for update`, [runId, attempt]), 'RUN_ATTEMPT_FENCE_REJECTED', runId);
      const terminalAt = barrier.decision_at ?? barrier.evaluated_at ?? barrier.sealed_at ?? barrier.observed_at;
      invariant(typeof terminalAt === 'string', 'PARTIAL_RUN_DECISION_TIME_MISSING', runId);
      const auditEventId = await deterministicOpaqueId('audit', { kind: 'partial_unpublished', runId, attempt, stage, terminalAt, barrier });
      if (run.terminal_at !== null) {
        invariant(run.state === 'partial_unpublished', 'RUN_TERMINAL_STEP_LINEAGE_MISMATCH', runId);
        const receipt = exactOne(await query('load-partial-run-receipt', `select details from ops.audit_events where audit_event_id=$1`, [auditEventId]), 'RUN_TERMINAL_STEP_LINEAGE_MISMATCH', runId);
        invariant(receipt.details.barrier_sha256 === await sha256Hex(canonicalJson(barrier)), 'RUN_TERMINAL_STEP_LINEAGE_MISMATCH', runId);
        return { ...run, recorded_at: run.terminal_at, partial_stage: stage };
      }
      const partial = exactOne(await query('mark-run-partial', `
        update ingest.harvest_runs set state='partial_unpublished',terminal_at=$3::timestamptz,updated_at=$3::timestamptz
        where run_id=$1 and active_attempt=$2 and terminal_at is null returning *
      `, [runId, attempt, terminalAt]), 'RUN_PARTIAL_CAS_REJECTED', runId);
      await query('close-partial-workflow-mapping', `
        update ingest.workflow_attempt_mappings set platform_state='complete',is_active=false,
          terminal_at=$3::timestamptz,last_reconciled_at=$3::timestamptz
        where run_id=$1 and attempt=$2 and is_active
      `, [runId, attempt, terminalAt]);
      await store.appendAudit({ auditEventId, action: 'workflow_control_failed', runId, reasonCode: `PARTIAL_${stage.toUpperCase()}`, barrier_sha256: await sha256Hex(canonicalJson(barrier)), stage, recordedAt: terminalAt });
      return { ...partial, recorded_at: partial.terminal_at, partial_stage: stage };
    },

    async prepareEventDelivery({ consumerName, eventId, eventType, messageIdempotencyKey, stage,
      sourceId, runId, jobId, runAttempt, leaseEpoch, transportAttempt, now, leaseExpiresAt,
      originId, originCapacity, originRefillPerSecond, targetClass, retryPolicyVersion,
      deadLetterQueueName }) {
      invariant(EVENT_BY_STAGE[stage] === eventType && STAGE_POLICIES[stage], 'QUEUE_STAGE_JOB_TYPE_MISMATCH', eventId);
      invariant(DLQ_BY_STAGE[stage] === deadLetterQueueName, 'QUEUE_DLQ_STAGE_MISMATCH', eventId);
      const prior = optionalOne(await query('load-processed-event-before-delivery', `
        select * from ops.processed_event_keys where consumer_name=$1 and event_id=$2
      `, [consumerName, eventId]), 'PROCESSED_EVENT_KEY_DUPLICATE', eventId);
      if (prior) {
        invariant(prior.source_id === sourceId && prior.run_id === runId && prior.job_id === jobId
          && prior.event_type === eventType && prior.message_idempotency_key === messageIdempotencyKey
          && Number(prior.run_attempt) === runAttempt && Number(prior.lease_epoch) === leaseEpoch
          && prior.origin_id === originId && prior.target_class === targetClass
          && prior.retry_policy_version === retryPolicyVersion && prior.business_effect_sha256,
        'PROCESSED_EVENT_IDEMPOTENCY_COLLISION', eventId);
        return { decision: 'duplicate' };
      }
      const authority = optionalOne(await query('load-delivery-authority', `
        select job.*,run.terminal_at as run_terminal_at,run.active_attempt as run_active_attempt,
          run.trace_id,source.state as source_state,event.event_type,event.idempotency_key as message_idempotency_key,
          event.state as outbox_state,event.references_payload
        from ingest.jobs job
        join ingest.harvest_runs run on run.run_id=job.run_id
        join registry.sources source on source.source_id=job.source_id
        join ops.outbox event on event.event_id=$1
        where job.job_id=$2 for update of job,run,source,event
      `, [eventId, jobId]), 'DELIVERY_AUTHORITY_DUPLICATE', eventId);
      if (!authority || authority.run_id !== runId || authority.source_id !== sourceId
        || Number(authority.active_run_attempt) !== runAttempt || Number(authority.run_active_attempt) !== runAttempt
        || authority.run_terminal_at !== null) return { decision: 'suppressed', reason: 'stale_or_terminal_run' };
      if (Number(authority.lease_epoch) !== leaseEpoch) return { decision: 'suppressed', reason: 'stale_job_fence' };
      invariant(authority.job_type === stage && authority.event_type === eventType
        && authority.message_idempotency_key === messageIdempotencyKey
        && authority.references_payload.run_id === runId && authority.references_payload.job_id === jobId
        && authority.outbox_state === 'published', 'QUEUE_EVENT_AUTHORITY_MISMATCH', eventId);
      invariant(authority.target_class === targetClass && authority.origin_id === originId
        && authority.retry_policy_version === retryPolicyVersion, 'QUEUE_ROUTING_AUTHORITY_MISMATCH', eventId);
      invariant(Number(authority.maximum_delivery_attempts) === STAGE_POLICIES[stage].maximumDeliveryAttempts, 'JOB_RETRY_POLICY_DRIFT', jobId);
      if (authority.source_state !== 'active') return { decision: 'suppressed', reason: 'source_not_active' };
      if (TERMINAL_JOB_STATES.includes(authority.state)) return { decision: 'suppressed', reason: 'terminal_job' };
      if (authority.state === 'retry_wait' && authority.next_eligible_at && Date.parse(authority.next_eligible_at) > Date.parse(now)) {
        return { decision: 'defer', reason: 'retry_not_due', retry_at: authority.next_eligible_at };
      }
      if (authority.state === 'leased' && authority.lease_expires_at && Date.parse(authority.lease_expires_at) > Date.parse(now)) {
        return { decision: 'defer', reason: 'lease_active', retry_at: authority.lease_expires_at };
      }
      const logicalAttempt = Number(authority.attempt_count) + 1;
      invariant(logicalAttempt <= Number(authority.maximum_delivery_attempts), 'JOB_RETRY_BUDGET_EXHAUSTED_WITHOUT_TERMINAL', jobId);
      const permit = await store.acquireOriginPermit({ originId, now, requestedTokens: 1, capacity: originCapacity, refillPerSecond: originRefillPerSecond });
      if (authority.state === 'leased') {
        await query('recover-expired-job-before-delivery', `
          update ingest.jobs set state='pending',lease_owner=null,lease_expires_at=null
          where job_id=$1 and state='leased' and lease_expires_at <= $2::timestamptz and lease_epoch=$3
        `, [jobId, now, leaseEpoch]);
      } else if (authority.state === 'retry_wait') {
        await query('admit-retry-job-before-delivery', `
          update ingest.jobs set state='pending',next_eligible_at=null
          where job_id=$1 and state='retry_wait' and lease_epoch=$2
            and coalesce(next_eligible_at,'-infinity'::timestamptz) <= $3::timestamptz
        `, [jobId, leaseEpoch, now]);
      }
      const leasedJob = exactOne(await query('lease-job-for-delivery', `
        update ingest.jobs set state='leased',lease_owner=$4,lease_expires_at=$5::timestamptz,
          attempt_count=$6,first_attempt_at=coalesce(first_attempt_at,$7::timestamptz),updated_at=$7::timestamptz
        where job_id=$1 and run_id=$2 and source_id=$3 and state='pending'
          and lease_epoch=$8 and attempt_count=$9 returning *, $10::text as trace_id
      `, [jobId, runId, sourceId, eventId, leaseExpiresAt, logicalAttempt, now, leaseEpoch,
        logicalAttempt - 1, authority.trace_id]), 'JOB_LEASE_FENCE_REJECTED', jobId);
      await insertAttemptStarted({ job: leasedJob, eventId, startedAt: now });
      if (!permit.allowed) {
        const failure = {
          failure_type: 'rate_limited', retry_class: 'transient', target_class: targetClass,
          safe_detail_code: permit.reason === 'circuit_open' ? 'ORIGIN_CIRCUIT_OPEN' : 'ORIGIN_RATE_LIMITED',
          http_status: null, observed_at: now
        };
        if (logicalAttempt >= Number(leasedJob.maximum_delivery_attempts)) {
          const disposition = { harvest_page: 'fail_enumeration', normalize_record: 'quarantine', enrich_schema: 'quarantine', access_check: 'typed_observation', project_index: 'projection_rejected' }[stage];
          const deadLetterId = await deterministicOpaqueId('deadletter', { queueName: deadLetterQueueName, originalEventId: eventId });
          await terminalizeJob({ jobId, eventId, attempt: logicalAttempt, leaseToken: jobLeaseToken(leasedJob), disposition,
            failure, retryPolicyVersion, startedAt: now, finishedAt: now, durableDeadLetterId: deadLetterId });
          await store.persistDurableDeadLetter({
            deadLetterId, queueName: deadLetterQueueName, originalEventId: eventId, sourceId,
            runId, jobId, failure, transportDeliveryAttempts: transportAttempt,
            databaseAttempts: logicalAttempt, retryPolicyVersion,
            messageReferences: authority.references_payload, replayState: 'not_requested',
            persistedAt: now, sinkTransactionCommitted: true
          });
          return { decision: 'ack_exhausted', reason: permit.reason, logical_attempt: logicalAttempt };
        }
        await insertAttemptOutcome({ job: leasedJob, eventId, deliveryAttempt: logicalAttempt,
          retryPolicyVersion, startedAt: now, finishedAt: now, failure,
          computedDelaySeconds: Math.max(0, Math.ceil((Date.parse(permit.retry_at) - Date.parse(now)) / 1000)),
          nextEligibleAt: permit.retry_at, outcome: 'retry_scheduled', databaseTransactionCommitted: true,
          transportAction: 'ack_reledgered_after_commit' });
        const nextEpoch = leaseEpoch + 1;
        const delayedEventId = await deterministicOpaqueId('event_delayed', { eventId, logicalAttempt, nextEpoch });
        const delayedIdempotencyKey = `event:${eventType}:${eventId}:${logicalAttempt}`;
        const retryJob = exactOne(await query('reledger-origin-permit-retry', `
          update ingest.jobs set state='retry_wait',lease_owner=null,lease_expires_at=null,
            next_eligible_at=$2::timestamptz,lease_epoch=lease_epoch+1,
            transport_generation=transport_generation+1,last_transport_event_id=$3,
            transport_retention_expires_at=null,updated_at=$4::timestamptz
          where job_id=$1 and state='leased' and lease_owner=$5 and lease_epoch=$6 returning *
        `, [jobId, permit.retry_at, delayedEventId, now, eventId, leaseEpoch]), 'JOB_LEASE_FENCE_REJECTED', jobId);
        await query('insert-origin-permit-delayed-outbox', `
          insert into ops.outbox(event_id,event_type,producer,idempotency_key,state,references_payload,
            trace_id,attempt_count,maximum_delivery_attempts,lease_owner,lease_epoch,lease_expires_at,
            first_attempt_at,next_eligible_at,transport_retention_expires_at,send_outcome,safe_detail_code,
            created_at,updated_at,published_at,workflow_instance_id,workflow_attempt,workflow_version,
            workflow_retention_expires_at,run_deadline_at)
          values ($1,$2,$3,$4,'retry_wait',$5::jsonb,$6,0,$7,null,0,null,null,$8::timestamptz,
            null,'not_started',null,$9::timestamptz,$9::timestamptz,null,null,null,null,null,null)
          on conflict (event_id) do nothing
        `, [delayedEventId, eventType, PRODUCER_BY_CONSUMER[consumerName], delayedIdempotencyKey,
          JSON.stringify(completeReferences(authority.references_payload)), authority.trace_id,
          authority.maximum_delivery_attempts, permit.retry_at, now]);
        return { decision: 'ack_reledgered', reason: permit.reason, retry_at: permit.retry_at,
          logical_attempt: logicalAttempt, delayed_event_id: delayedEventId, lease_epoch: Number(retryJob.lease_epoch) };
      }
      return { decision: 'process', lease_token: jobLeaseToken(leasedJob), lease_epoch: leaseEpoch, logical_attempt: logicalAttempt };
    },

    async processEventOnce({ consumerName, eventId, effectIdempotencyKey, sourceId, runId, jobId,
      eventType, messageIdempotencyKey, runAttempt, leaseEpoch, originId, targetClass,
      leaseToken, logicalAttempt, retryPolicyVersion, startedAt, committedAt, apply }) {
      const prior = optionalOne(await query('load-processed-event', `
        select * from ops.processed_event_keys where consumer_name=$1 and event_id=$2
      `, [consumerName, eventId]), 'PROCESSED_EVENT_KEY_DUPLICATE', eventId);
      if (prior) {
        invariant(prior.effect_idempotency_key === effectIdempotencyKey && prior.source_id === sourceId
          && prior.run_id === runId && prior.job_id === jobId && prior.event_type === eventType
          && prior.message_idempotency_key === messageIdempotencyKey && Number(prior.run_attempt) === runAttempt
          && Number(prior.lease_epoch) === leaseEpoch && prior.origin_id === originId
          && prior.target_class === targetClass && prior.retry_policy_version === retryPolicyVersion,
        'PROCESSED_EVENT_IDEMPOTENCY_COLLISION', eventId);
        return { duplicate: true, business_effect_digest: prior.business_effect_sha256 };
      }
      const lease = parseJobLease(leaseToken, jobId);
      const job = await loadJob(jobId, { lock: true });
      invariant(job && job.run_id === runId && job.source_id === sourceId && job.state === 'leased'
        && job.lease_owner === lease.ownerId && Number(job.lease_epoch) === lease.leaseEpoch
        && Number(job.lease_epoch) === leaseEpoch && Number(job.attempt_count) === logicalAttempt
        && Number(job.active_run_attempt) === runAttempt && job.run_terminal_at === null
        && Date.parse(job.lease_expires_at) > Date.parse(committedAt), 'JOB_LEASE_FENCE_REJECTED', jobId);
      const result = await apply();
      const digest = result?.businessEffectDigest ?? await sha256Hex(canonicalJson(result ?? { eventId, effectIdempotencyKey }));
      invariant(/^[a-f0-9]{64}$/.test(digest), 'BUSINESS_EFFECT_DIGEST_INVALID', eventId);
      const effectKind = EFFECT_KIND_BY_STAGE[job.job_type];
      invariant(effectKind, 'BUSINESS_EFFECT_KIND_UNKNOWN', job.job_type);
      const effectReferences = completeReferences({ run_id: runId, job_id: jobId });
      await query('record-business-effect-receipt', `
        insert into ops.business_effect_receipts(
          consumer_name,event_id,effect_idempotency_key,effect_kind,effect_sha256,effect_references,recorded_at
        ) values ($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz)
        on conflict (consumer_name,event_id) do nothing
      `, [consumerName, eventId, effectIdempotencyKey, effectKind, digest, JSON.stringify(effectReferences), committedAt]);
      const receipt = exactOne(await query('verify-business-effect-receipt', `
        select * from ops.business_effect_receipts where consumer_name=$1 and event_id=$2
      `, [consumerName, eventId]), 'BUSINESS_EFFECT_RECEIPT_MISSING', eventId);
      invariant(receipt.effect_idempotency_key === effectIdempotencyKey && receipt.effect_sha256 === digest && receipt.effect_kind === effectKind, 'BUSINESS_EFFECT_IDEMPOTENCY_CONFLICT', eventId);
      const downstreamIds = [];
      for (const downstream of result?.downstreamOutbox ?? []) {
        invariant(typeof downstream.event_id === 'string' && EVENT_BY_STAGE[downstream.stage ?? job.job_type] !== undefined || typeof downstream.event_type === 'string', 'DOWNSTREAM_OUTBOX_EVENT_INVALID', eventId);
        const downstreamType = downstream.event_type ?? EVENT_BY_STAGE[downstream.stage];
        const downstreamReferences = completeReferences(downstream.references ?? { run_id: runId, job_id: jobId });
        await query('insert-downstream-outbox', `
          insert into ops.outbox(event_id,event_type,producer,idempotency_key,state,references_payload,
            trace_id,attempt_count,maximum_delivery_attempts,lease_owner,lease_epoch,lease_expires_at,
            first_attempt_at,next_eligible_at,transport_retention_expires_at,send_outcome,safe_detail_code,
            created_at,updated_at,published_at,workflow_instance_id,workflow_attempt,workflow_version,
            workflow_retention_expires_at,run_deadline_at)
          values ($1,$2,$3,$4,'pending',$5::jsonb,$6,0,$7,null,0,null,null,$8::timestamptz,
            null,'not_started',null,$9::timestamptz,$9::timestamptz,null,null,null,null,null,null)
          on conflict (event_id) do nothing
        `, [downstream.event_id, downstreamType, PRODUCER_BY_CONSUMER[consumerName],
          downstream.idempotency_key ?? `event:${downstreamType}:${downstream.event_id}`,
          JSON.stringify(downstreamReferences), job.trace_id,
          downstream.maximum_delivery_attempts ?? STAGE_POLICIES[downstream.stage ?? job.job_type]?.maximumDeliveryAttempts ?? 5,
          downstream.next_eligible_at ?? null, committedAt]);
        downstreamIds.push(downstream.event_id);
      }
      await query('record-processed-event-key', `
        insert into ops.processed_event_keys(
          consumer_name,event_id,effect_idempotency_key,source_id,run_id,job_id,event_type,
          message_idempotency_key,run_attempt,lease_epoch,origin_id,target_class,retry_policy_version,
          business_effect_sha256,transaction_committed_at,retain_until
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
          $15::timestamptz,$15::timestamptz+interval '90 days')
      `, [consumerName, eventId, effectIdempotencyKey, sourceId, runId, jobId, eventType,
        messageIdempotencyKey, runAttempt, leaseEpoch, originId, targetClass, retryPolicyVersion,
        digest, committedAt]);
      await query('record-processed-event-history', `
        insert into ops.processed_event_history(
          consumer_name,event_id,effect_idempotency_key,source_id,run_id,job_id,event_type,
          message_idempotency_key,run_attempt,lease_epoch,origin_id,target_class,retry_policy_version,
          business_effect_sha256,downstream_outbox_event_ids,transaction_committed_at,trace_id
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::text[],$16::timestamptz,$17)
      `, [consumerName, eventId, effectIdempotencyKey, sourceId, runId, jobId, eventType,
        messageIdempotencyKey, runAttempt, leaseEpoch, originId, targetClass, retryPolicyVersion,
        digest, downstreamIds, committedAt, job.trace_id]);
      await insertAttemptOutcome({ job, eventId, deliveryAttempt: logicalAttempt, retryPolicyVersion,
        startedAt, finishedAt: committedAt, outcome: 'committed', databaseTransactionCommitted: true,
        transportAction: 'ack_after_commit' });
      const updated = exactOne(await query('complete-processed-job', `
        update ingest.jobs set state='succeeded',lease_owner=null,lease_expires_at=null,
          next_eligible_at=null,updated_at=$5::timestamptz
        where job_id=$1 and state='leased' and lease_owner=$2 and lease_epoch=$3 and attempt_count=$4
        returning *
      `, [jobId, lease.ownerId, lease.leaseEpoch, logicalAttempt, committedAt]), 'JOB_LEASE_FENCE_REJECTED', jobId);
      invariant(updated.state === 'succeeded', 'JOB_COMMIT_STATE_INVALID', jobId);
      if (job.job_type === 'normalize_record') {
        const captureSha256 = job.identity_payload?.capture_sha256;
        const normalizerVersion = job.identity_payload?.normalizer_version;
        invariant(/^[a-f0-9]{64}$/.test(captureSha256 ?? '') && typeof normalizerVersion === 'string', 'NORMALIZATION_SUCCESS_IDENTITY_MISSING', jobId);
        await query('record-normalization-success-artifact', `
          insert into ingest.normalization_success_artifacts(
            capture_sha256,normalizer_version,job_id,result_sha256,recorded_at
          ) values ($1,$2,$3,$4,$5::timestamptz)
          on conflict (capture_sha256,normalizer_version) do nothing
        `, [captureSha256, normalizerVersion, jobId, digest, committedAt]);
        const artifact = exactOne(await query('verify-normalization-success-artifact', `
          select * from ingest.normalization_success_artifacts
          where capture_sha256=$1 and normalizer_version=$2
        `, [captureSha256, normalizerVersion]), 'NORMALIZATION_SUCCESS_ARTIFACT_MISSING', jobId);
        invariant(artifact.job_id === jobId && artifact.result_sha256 === digest,
          'NORMALIZATION_SUCCESS_ARTIFACT_CONFLICT', jobId);
      }
      return { duplicate: false, business_effect_digest: digest };
    },

    async recordAttemptFailure(input) {
      const lease = input.leaseToken ? parseJobLease(input.leaseToken, input.jobId) : null;
      const job = await loadJob(input.jobId, { lock: true });
      invariant(job && job.state === 'leased' && Number(job.attempt_count) === input.attempt
        && (!lease || (job.lease_owner === lease.ownerId && Number(job.lease_epoch) === lease.leaseEpoch)),
      'JOB_LEASE_FENCE_REJECTED', input.jobId);
      await insertAttemptOutcome({ job, eventId: input.eventId, deliveryAttempt: input.attempt,
        retryPolicyVersion: input.retryPolicyVersion,
        startedAt: input.startedAt ?? input.failure.observed_at,
        finishedAt: input.finishedAt ?? input.failure.observed_at,
        failure: input.failure, retryAfterSeconds: input.retryAfterSeconds,
        computedDelaySeconds: input.computedDelaySeconds, nextEligibleAt: input.nextEligibleAt,
        outcome: 'rolled_back', databaseTransactionCommitted: false,
        transportAction: 'retry_after_rollback' });
      await query('mark-job-retry-after-failure', `
        update ingest.jobs set state='retry_wait',lease_owner=null,lease_expires_at=null,
          next_eligible_at=$3::timestamptz,updated_at=$4::timestamptz
        where job_id=$1 and state='leased' and attempt_count=$2
      `, [input.jobId, input.attempt, input.nextEligibleAt, input.finishedAt ?? input.failure.observed_at]);
      return { recorded: true };
    },

    async recordTerminalOutcome(input) {
      return terminalizeJob({
        jobId: input.jobId, eventId: input.eventId, attempt: input.attempt,
        leaseToken: input.leaseToken ?? null, disposition: input.disposition,
        failure: input.failure, retryPolicyVersion: input.retryPolicyVersion,
        startedAt: input.startedAt ?? input.failure.observed_at,
        finishedAt: input.finishedAt ?? input.failure.observed_at,
        durableDeadLetterId: input.durableDeadLetterId ?? null
      });
    },

    async recordTransportLossAttempt({ eventId, runId, jobId, observedAt, failure, durableDeadLetterId }) {
      let job = await loadJob(jobId, { lock: true });
      invariant(job && job.run_id === runId && !TERMINAL_JOB_STATES.includes(job.state), 'DLQ_RECOVERY_JOB_FENCE_REJECTED', jobId);
      if (job.state === 'leased') {
        invariant(Date.parse(job.lease_expires_at) <= Date.parse(observedAt), 'DLQ_RECOVERY_ACTIVE_LEASE_REJECTED', jobId);
        await query('recover-job-for-transport-loss', `update ingest.jobs set state='pending',lease_owner=null,lease_expires_at=null where job_id=$1 and state='leased'`, [jobId]);
      } else if (job.state === 'retry_wait') {
        await query('admit-job-for-transport-loss', `update ingest.jobs set state='pending',next_eligible_at=null where job_id=$1 and state='retry_wait'`, [jobId]);
      }
      const logicalAttempt = Math.max(1, Number(job.attempt_count));
      const priorAttemptCount = logicalAttempt === Number(job.attempt_count) ? logicalAttempt - 1 : Number(job.attempt_count);
      job = exactOne(await query('lease-job-for-transport-loss', `
        update ingest.jobs set state='leased',lease_owner=$2,lease_expires_at=$3::timestamptz+interval '5 minutes',
          attempt_count=$4,first_attempt_at=coalesce(first_attempt_at,$3::timestamptz),updated_at=$3::timestamptz
        where job_id=$1 and state='pending' and attempt_count=$5 returning *, $6::text as trace_id
      `, [jobId, eventId, observedAt, logicalAttempt, priorAttemptCount, job.trace_id]), 'DLQ_RECOVERY_JOB_FENCE_REJECTED', jobId);
      await insertAttemptStarted({ job, eventId, startedAt: observedAt });
      const disposition = job.job_type === 'normalize_record' || job.job_type === 'enrich_schema' ? 'quarantine'
        : job.job_type === 'access_check' ? 'typed_observation'
          : job.job_type === 'harvest_page' ? 'fail_enumeration' : 'projection_rejected';
      await terminalizeJob({ jobId, eventId, attempt: logicalAttempt, leaseToken: jobLeaseToken(job), disposition,
        failure, retryPolicyVersion: job.retry_policy_version, startedAt: observedAt, finishedAt: observedAt,
        durableDeadLetterId });
      return { recorded: true };
    },

    async reledgerRetry(input) {
      const lease = input.leaseToken ? parseJobLease(input.leaseToken, input.jobId) : null;
      const job = await loadJob(input.jobId, { lock: true });
      invariant(job && job.state === 'leased' && Number(job.attempt_count) === input.attempt
        && (!lease || (job.lease_owner === lease.ownerId && Number(job.lease_epoch) === lease.leaseEpoch)),
      'JOB_LEASE_FENCE_REJECTED', input.jobId);
      await insertAttemptOutcome({ job, eventId: input.eventId, deliveryAttempt: input.attempt,
        retryPolicyVersion: input.retryPolicyVersion,
        startedAt: input.startedAt ?? input.failure.observed_at,
        finishedAt: input.finishedAt ?? input.failure.observed_at,
        failure: input.failure, retryAfterSeconds: input.retryAfterSeconds,
        computedDelaySeconds: input.computedDelaySeconds, nextEligibleAt: input.nextEligibleAt,
        outcome: 'retry_scheduled', databaseTransactionCommitted: true,
        transportAction: 'ack_reledgered_after_commit' });
      const nextEpoch = Number(job.lease_epoch) + 1;
      const eventId = await deterministicOpaqueId('event_delayed', { originalEventId: input.eventId, attempt: input.attempt, nextEpoch });
      const updated = exactOne(await query('reledger-job-retry', `
        update ingest.jobs set state='retry_wait',lease_owner=null,lease_expires_at=null,
          next_eligible_at=$3::timestamptz,lease_epoch=$4,transport_generation=transport_generation+1,
          last_transport_event_id=$5,transport_retention_expires_at=null,updated_at=$6::timestamptz
        where job_id=$1 and state='leased' and attempt_count=$2 returning *
      `, [input.jobId, input.attempt, input.nextEligibleAt, nextEpoch, eventId, input.finishedAt ?? input.failure.observed_at]), 'JOB_LEASE_FENCE_REJECTED', input.jobId);
      await query('insert-reledgered-outbox', `
        insert into ops.outbox(event_id,event_type,producer,idempotency_key,state,references_payload,
          trace_id,attempt_count,maximum_delivery_attempts,lease_owner,lease_epoch,lease_expires_at,
          first_attempt_at,next_eligible_at,transport_retention_expires_at,send_outcome,safe_detail_code,
          created_at,updated_at,published_at,workflow_instance_id,workflow_attempt,workflow_version,
          workflow_retention_expires_at,run_deadline_at)
        values ($1,$2,$3,$4,'retry_wait',$5::jsonb,$6,0,$7,null,0,null,null,$8::timestamptz,
          null,'not_started',null,$9::timestamptz,$9::timestamptz,null,null,null,null,null,null)
        on conflict (event_id) do nothing
      `, [eventId, EVENT_BY_STAGE[job.job_type], PRODUCER_BY_CONSUMER[`${job.job_type}_consumer`],
        input.delayedOutboxIdempotencyKey, JSON.stringify(completeReferences(job.identity_payload?.message_references ?? {
          run_id: job.run_id, job_id: job.job_id
        })), job.trace_id, job.maximum_delivery_attempts, input.nextEligibleAt,
        input.finishedAt ?? input.failure.observed_at]);
      return { event_id: eventId, lease_epoch: Number(updated.lease_epoch) };
    },

    async listExpiredQueueDeliveries({ now, limit }) {
      return rows(await query('list-expired-queue-deliveries', `
        select job.* from ingest.jobs job
        join ingest.harvest_runs run on run.run_id=job.run_id
        where job.state in ('pending','retry_wait','leased')
          and run.terminal_at is null and run.active_attempt=job.active_run_attempt
          and job.transport_retention_expires_at is not null
          and job.transport_retention_expires_at <= $1::timestamptz
          and coalesce(job.next_eligible_at,'-infinity'::timestamptz) <= $1::timestamptz
          and (job.state <> 'leased' or job.lease_expires_at <= $1::timestamptz)
        order by job.transport_retention_expires_at,job.job_id
        limit $2::integer
      `, [now, limit])).map(job => Object.freeze({
        ...job,
        delivery_fence: { run_attempt: Number(job.active_run_attempt), lease_epoch: Number(job.lease_epoch) },
        transport_generation: Number(job.transport_generation)
      }));
    },

    async reledgerExpiredQueueDelivery({ jobId, runId, priorLeaseEpoch, recoveredAt, newTransportExpiresAt, recoveryEventId }) {
      let job = await loadJob(jobId, { lock: true });
      invariant(job && job.run_id === runId && job.run_terminal_at === null
        && Number(job.run_active_attempt) === Number(job.active_run_attempt)
        && Number(job.lease_epoch) === priorLeaseEpoch,
      'QUEUE_RECOVERY_RUN_FENCE_REJECTED', jobId);
      const existing = optionalOne(await query('load-queue-recovery-event', `select * from ops.outbox where event_id=$1`, [recoveryEventId]), 'QUEUE_RECOVERY_EVENT_DUPLICATE', recoveryEventId);
      if (existing) {
        invariant(existing.references_payload.run_id === runId && existing.references_payload.job_id === jobId, 'QUEUE_RECOVERY_EVENT_CONFLICT', recoveryEventId);
        return { created: false, event_id: recoveryEventId, lease_epoch: Number(job.lease_epoch) };
      }
      if (job.state === 'leased') {
        invariant(Date.parse(job.lease_expires_at) <= Date.parse(recoveredAt), 'QUEUE_RECOVERY_ACTIVE_LEASE_REJECTED', jobId);
        await query('recover-expired-queue-job', `
          update ingest.jobs set state='pending',lease_owner=null,lease_expires_at=null
          where job_id=$1 and state='leased' and lease_epoch=$2
        `, [jobId, priorLeaseEpoch]);
      } else if (job.state === 'retry_wait') {
        await query('recover-retry-wait-queue-job', `
          update ingest.jobs set state='pending',next_eligible_at=null where job_id=$1 and state='retry_wait' and lease_epoch=$2
        `, [jobId, priorLeaseEpoch]);
      }
      const original = exactOne(await query('load-queue-recovery-references', `
        select references_payload from ops.outbox where event_id=coalesce($1,(select outbox_event_id from ingest.jobs where job_id=$2))
      `, [job.last_transport_event_id, jobId]), 'QUEUE_RECOVERY_ORIGINAL_EVENT_MISSING', jobId);
      const nextEpoch = priorLeaseEpoch + 1;
      job = exactOne(await query('advance-queue-recovery-fence', `
        update ingest.jobs set state='pending',lease_owner=null,lease_expires_at=null,
          next_eligible_at=null,lease_epoch=$3,transport_generation=transport_generation+1,
          last_transport_event_id=$4,transport_retention_expires_at=$5::timestamptz,
          updated_at=$6::timestamptz
        where job_id=$1 and run_id=$2 and state='pending' and lease_epoch=$7 returning *, $8::text as trace_id
      `, [jobId, runId, nextEpoch, recoveryEventId, newTransportExpiresAt, recoveredAt, priorLeaseEpoch, job.trace_id]), 'QUEUE_RECOVERY_STALE_FENCE', jobId);
      await query('insert-queue-recovery-event', `
        insert into ops.outbox(event_id,event_type,producer,idempotency_key,state,references_payload,
          trace_id,attempt_count,maximum_delivery_attempts,lease_owner,lease_epoch,lease_expires_at,
          first_attempt_at,next_eligible_at,transport_retention_expires_at,send_outcome,safe_detail_code,
          created_at,updated_at,published_at,workflow_instance_id,workflow_attempt,workflow_version,
          workflow_retention_expires_at,run_deadline_at)
        values ($1,$2,'ops',$3,'pending',$4::jsonb,$5,0,$6,null,0,null,null,null,$7::timestamptz,
          'not_started',null,$8::timestamptz,$8::timestamptz,null,null,null,null,null,null)
      `, [recoveryEventId, EVENT_BY_STAGE[job.job_type],
        `event:${EVENT_BY_STAGE[job.job_type]}:${jobId}:g${job.transport_generation}`,
        JSON.stringify(completeReferences(original.references_payload)), job.trace_id,
        job.maximum_delivery_attempts, newTransportExpiresAt, recoveredAt]);
      return { created: true, event_id: recoveryEventId, lease_epoch: nextEpoch };
    },

    async persistDurableDeadLetter(input) {
      invariant(input.sinkTransactionCommitted === true, 'DEAD_LETTER_REQUIRES_COMMITTED_TRANSACTION', input.deadLetterId);
      const prior = optionalOne(await query('load-dead-letter-before-insert', `
        select * from ops.durable_dead_letters where dead_letter_id=$1 or (queue_name=$2 and original_event_id=$3)
      `, [input.deadLetterId, input.queueName, input.originalEventId]), 'DEAD_LETTER_LINEAGE_DUPLICATE', input.deadLetterId);
      if (prior) {
        invariant(prior.dead_letter_id === input.deadLetterId && prior.queue_name === input.queueName
          && prior.original_event_id === input.originalEventId && prior.source_id === input.sourceId
          && prior.run_id === input.runId && prior.job_id === input.jobId
          && canonicalJson(prior.failure_payload) === canonicalJson(input.failure)
          && Number(prior.transport_delivery_attempts) === input.transportDeliveryAttempts
          && Number(prior.database_attempts) === input.databaseAttempts
          && prior.retry_policy_version === input.retryPolicyVersion,
        'DEAD_LETTER_IDEMPOTENCY_CONFLICT', input.deadLetterId);
        return { created: false };
      }
      const attempts = input.attemptIds ?? rows(await query('load-dead-letter-attempt-ids', `
        select key.attempt_id,key.delivery_attempt
        from ingest.job_attempt_keys key
        where key.job_id=$1 and exists (
          select 1 from ingest.job_attempts attempt
          where attempt.attempt_id=key.attempt_id and attempt.job_id=key.job_id
        ) order by key.delivery_attempt
      `, [input.jobId])).map(row => row.attempt_id);
      invariant(attempts.length === input.databaseAttempts, 'DEAD_LETTER_ATTEMPT_CARDINALITY_MISMATCH', input.deadLetterId);
      await query('insert-durable-dead-letter', `
        insert into ops.durable_dead_letters(
          contract_version,record_kind,dead_letter_id,queue_name,original_event_id,source_id,
          run_id,job_id,failure_payload,transport_delivery_attempts,database_attempts,
          retry_policy_version,message_references,attempt_ids,replay_state,persisted_at,
          sink_transaction_committed,retain_until
        ) values ('ingestion.v1.0.0','durable_dead_letter',$1,$2,$3,$4,$5,$6,$7::jsonb,
          $8,$9,$10,$11::jsonb,$12::text[],$13,$14::timestamptz,true,$14::timestamptz+interval '90 days')
      `, [input.deadLetterId, input.queueName, input.originalEventId, input.sourceId,
        input.runId, input.jobId, JSON.stringify(input.failure), input.transportDeliveryAttempts,
        input.databaseAttempts, input.retryPolicyVersion,
        JSON.stringify(completeReferences(input.messageReferences)), attempts,
        input.replayState, input.persistedAt]);
      return { created: true };
    },

    async getDeadLetter({ deadLetterId }) {
      return optionalOne(await query('get-dead-letter', `select * from ops.durable_dead_letters where dead_letter_id=$1`, [deadLetterId]), 'DEAD_LETTER_ID_NOT_UNIQUE', deadLetterId);
    },

    async getDeadLetterByOriginalEvent({ originalEventId, queueName = null }) {
      return optionalOne(await query('get-dead-letter-by-event', `
        select * from ops.durable_dead_letters
        where original_event_id=$1 and ($2::text is null or queue_name=$2)
      `, [originalEventId, queueName]), 'DEAD_LETTER_EVENT_NOT_UNIQUE', originalEventId);
    },

    async loadDeadLetterEvidence({ originalEventId }) {
      const evidence = optionalOne(await query('load-dead-letter-evidence', `
        select job.source_id,job.run_id,job.job_id,terminal.failure_payload as failure,
          job.attempt_count as database_attempts,job.retry_policy_version,event.references_payload as message_references,
          array(select key.attempt_id from ingest.job_attempt_keys key
                where key.job_id=job.job_id and exists (
                  select 1 from ingest.job_attempts recorded
                  where recorded.attempt_id=key.attempt_id and recorded.job_id=key.job_id
                ) order by key.delivery_attempt) as attempt_ids
        from ingest.job_attempts terminal
        join ingest.jobs job on job.job_id=terminal.job_id
        join ops.outbox event on event.event_id=terminal.original_event_id
        where terminal.original_event_id=$1 and terminal.failure_payload is not null
          and terminal.outcome='dead_lettered'
        order by terminal.recorded_at desc limit 1
      `, [originalEventId]), 'DEAD_LETTER_EVIDENCE_DUPLICATE', originalEventId);
      return evidence;
    },

    async recordDeadLetterTransportExhaustionObservation(input) {
      invariant(input.transportDeliveryAttempts === 6, 'DLQ_TRANSPORT_EXHAUSTION_ATTEMPT_COUNT_INVALID', String(input.transportDeliveryAttempts));
      const result = exactOne(await query('admit-dlq-transport-exhaustion', `
        select ops.admit_dlq_transport_exhaustion(
          $1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9::timestamptz
        ) as created
      `, [input.originalEventId, input.queueName, input.sourceId, input.runId, input.jobId,
        input.observedAt, input.evidenceRefId, input.auditEventId, input.observedAt]),
      'DLQ_TRANSPORT_EXHAUSTION_RECEIPT_MISSING', input.originalEventId);
      return { created: result.created };
    },

    async listDeadLetterRecoveryCandidates({ now, limit }) {
      const candidates = rows(await query('list-dead-letter-recovery-candidates', `
        with terminal as (
          select terminal.original_event_id,
            case job.job_type when 'harvest_page' then 'harvest-page-dlq'
              when 'normalize_record' then 'normalize-record-dlq'
              when 'enrich_schema' then 'enrich-schema-dlq'
              when 'access_check' then 'access-check-dlq'
              when 'project_index' then 'project-index-dlq' end as queue_name,
            job.source_id,job.run_id,job.job_id,
            greatest(1,job.attempt_count)::integer as transport_delivery_attempts,
            false as requires_synthetic_attempt,terminal.failure_payload as failure,
            jsonb_build_object('run_id',job.run_id,'job_id',job.job_id,
              'outbox_event_id',terminal.original_event_id,'attempt_id',terminal.attempt_id) as evidence_refs,
            terminal.recorded_at as candidate_at
          from ingest.jobs job
          join lateral (
            select * from ingest.job_attempts attempt
            where attempt.job_id=job.job_id and attempt.outcome='dead_lettered'
              and attempt.durable_dead_letter_id is not null
            order by attempt.recorded_at desc limit 1
          ) terminal on true
          where job.state in ('succeeded','quarantined','dead')
            and not exists (select 1 from ops.durable_dead_letters dead
                            where dead.original_event_id=terminal.original_event_id)
        ), transport as (
          select observation.original_event_id,observation.queue_name,observation.source_id,
            observation.run_id,observation.job_id,observation.transport_delivery_attempts,
            true as requires_synthetic_attempt,
            jsonb_build_object('failure_type','internal_failure','retry_class','transient',
              'target_class',job.target_class,'safe_detail_code','DLQ_SINK_TRANSPORT_EXHAUSTED',
              'http_status',null,'observed_at',observation.observed_at) as failure,
            jsonb_build_object('run_id',job.run_id,'job_id',job.job_id,
              'outbox_event_id',observation.original_event_id,'attempt_id',null,
              'transport_exhaustion_evidence_ref_id',observation.evidence_reference_id) as evidence_refs,
            observation.observed_at as candidate_at
          from ops.dlq_transport_exhaustion_observations observation
          join ingest.jobs job on job.job_id=observation.job_id
          where observation.reconstructed_dead_letter_id is null
            and job.state in ('pending','retry_wait','leased')
            and not exists (select 1 from ops.durable_dead_letters dead
                            where dead.original_event_id=observation.original_event_id)
        )
        select * from (select * from terminal union all select * from transport) candidate
        where candidate_at <= $1::timestamptz
        order by candidate_at,original_event_id limit $2::integer
      `, [now, limit]));
      return candidates.map(Object.freeze);
    },

    async markDeadLetterSinkCommitted({ deadLetterId, persistedAt }) {
      const dead = exactOne(await query('load-dead-letter-for-commit', `
        select * from ops.durable_dead_letters where dead_letter_id=$1 and sink_transaction_committed
      `, [deadLetterId]), 'DEAD_LETTER_NOT_FOUND', deadLetterId);
      const exists = optionalOne(await query('load-dead-letter-commit-receipt', `
        select dead_letter_event_id from ops.dead_letter_events
        where dead_letter_id=$1 and action='persisted' and recorded_at=$2::timestamptz
        limit 1
      `, [deadLetterId, persistedAt]), 'DEAD_LETTER_COMMIT_RECEIPT_DUPLICATE', deadLetterId);
      if (!exists) {
        await query('record-dead-letter-commit-receipt', `
          insert into ops.dead_letter_events(dead_letter_id,queue_name,action,audit_event_id,recorded_at,trace_id)
          values ($1,$2,'persisted',$3,$4::timestamptz,$5)
        `, [deadLetterId, dead.queue_name,
          await deterministicOpaqueId('audit', { deadLetterId, persistedAt, action: 'persisted' }),
          persistedAt, traceFor('trace_dead_letter', deadLetterId)]);
      }
      return dead;
    },

    async createReplay(input) {
      const existing = optionalOne(await query('load-replay', `select * from ops.replay_lineage where replay_id=$1`, [input.replayId]), 'REPLAY_ID_NOT_UNIQUE', input.replayId);
      if (existing) {
        invariant(existing.original_dead_letter_id === input.originalDeadLetterId
          && existing.original_event_id === input.originalEventId
          && existing.original_run_id === input.originalRunId
          && existing.new_run_id === input.newRunId && existing.new_event_id === input.newEventId,
        'REPLAY_IDEMPOTENCY_CONFLICT', input.replayId);
        return { created: false };
      }
      const original = exactOne(await query('load-replay-authority', `
        select dead.*,run.plan_id,run.source_id as run_source_id,run.endpoint_id,
          run.source_configuration_revision,run.workflow_version,run.deadline_at,run.scheduled_slot,
          run.optional_degradation_policy,run.barrier_policy,run.last_known_good_publication_id,
          run.state as run_state,run.terminal_at,
          workflow.workflow_retention_expires_at
        from ops.durable_dead_letters dead
        join ingest.harvest_runs run on run.run_id=dead.run_id
        join lateral (
          select workflow_retention_expires_at from ops.outbox event
          where event.event_type='workflow_start_requested'
            and event.references_payload->>'run_id'=run.run_id
          order by event.created_at desc limit 1
        ) workflow on true
        where dead.dead_letter_id=$1 for update of dead,run
      `, [input.originalDeadLetterId]), 'REPLAY_ORIGINAL_LINEAGE_FENCE_REJECTED', input.originalDeadLetterId);
      invariant(original.sink_transaction_committed && original.original_event_id === input.originalEventId
        && original.run_id === input.originalRunId && original.retry_policy_version === input.originalRetryPolicyVersion
        && original.terminal_at !== null && TERMINAL_RUN_STATES.includes(original.run_state)
        && input.newRunId !== input.originalRunId && input.newEventId !== input.originalEventId,
      'REPLAY_ORIGINAL_LINEAGE_FENCE_REJECTED', input.originalDeadLetterId);
      const audit = optionalOne(await query('load-replay-audit-authority', `
        select audit_event_id from ops.audit_events
        where audit_event_id=$1 and action='replay' and object_type='durable_dead_letter'
          and object_id=$2 and decision in ('requested','allowed') and occurred_at <= $3::timestamptz
        limit 1
      `, [input.requestedByAuditEventId, input.originalDeadLetterId, input.requestedAt]), 'REPLAY_AUDIT_DUPLICATE', input.requestedByAuditEventId);
      invariant(audit, 'REPLAY_AUDIT_AUTHORITY_MISSING', input.requestedByAuditEventId);
      const retentionMs = Math.max(1, Date.parse(original.workflow_retention_expires_at) - Date.parse(original.scheduled_slot));
      const deadlineMs = Math.max(1, Date.parse(original.deadline_at) - Date.parse(original.scheduled_slot));
      const retentionExpiresAt = new Date(Date.parse(input.requestedAt) + retentionMs).toISOString();
      const deadlineAt = new Date(Date.parse(input.requestedAt) + deadlineMs).toISOString();
      const workflowInstanceId = `harvest-${input.newRunId}-1`;
      await query('insert-replay-run', `
        insert into ingest.harvest_runs(
          run_id,plan_id,source_id,endpoint_id,source_configuration_revision,scheduled_slot,mode,
          run_idempotency_key,trace_id,state,active_attempt,workflow_version,deadline_at,
          optional_degradation_policy,barrier_policy,replay_of_run_id,enumeration_seal_id,
          candidate_publication_id,last_known_good_publication_id,state_changed_at,terminal_at,
          created_at,updated_at
        ) values ($1,$2,$3,$4,$5,$6::timestamptz,'operator_replay',$7,$8,'scheduled',1,$9,
          $10::timestamptz,$11::jsonb,$12::jsonb,$13,null,null,$14,$6::timestamptz,null,$6::timestamptz,$6::timestamptz)
      `, [input.newRunId, original.plan_id, original.run_source_id, original.endpoint_id,
        original.source_configuration_revision, input.requestedAt,
        `run:${original.endpoint_id}:${input.requestedAt}:operator_replay:r${original.source_configuration_revision}`,
        traceFor('trace_replay', input.replayId), original.workflow_version, deadlineAt,
        JSON.stringify(original.optional_degradation_policy), JSON.stringify(original.barrier_policy),
        input.originalRunId, original.last_known_good_publication_id]);
      await query('insert-replay-workflow-event', `
        insert into ops.outbox(event_id,event_type,producer,idempotency_key,state,references_payload,
          trace_id,attempt_count,maximum_delivery_attempts,lease_owner,lease_epoch,lease_expires_at,
          first_attempt_at,next_eligible_at,transport_retention_expires_at,send_outcome,safe_detail_code,
          created_at,updated_at,published_at,workflow_instance_id,workflow_attempt,workflow_version,
          workflow_retention_expires_at,run_deadline_at)
        values ($1,'workflow_start_requested','ops',$2,'pending',$3::jsonb,$4,0,6,null,0,null,
          null,null,null,'not_started',null,$5::timestamptz,$5::timestamptz,null,$6,1,$7,$8::timestamptz,$9::timestamptz)
      `, [input.newEventId, `event:workflow_start_requested:${input.replayId}`,
        JSON.stringify({ run_id: input.newRunId }), traceFor('trace_replay', input.replayId),
        input.requestedAt, workflowInstanceId, original.workflow_version, retentionExpiresAt, deadlineAt]);
      await query('request-dead-letter-replay-state', `
        update ops.durable_dead_letters set replay_state='requested'
        where dead_letter_id=$1 and replay_state='not_requested'
      `, [input.originalDeadLetterId]);
      await query('insert-replay-lineage', `
        insert into ops.replay_lineage(
          contract_version,record_kind,replay_id,original_dead_letter_id,original_event_id,
          original_run_id,new_run_id,new_event_id,original_retry_policy_version,
          replay_policy_version,requested_by_audit_event_id,requested_at
        ) values ('ingestion.v1.0.0','replay_lineage',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz)
      `, [input.replayId, input.originalDeadLetterId, input.originalEventId,
        input.originalRunId, input.newRunId, input.newEventId,
        input.originalRetryPolicyVersion, input.replayPolicyVersion,
        input.requestedByAuditEventId, input.requestedAt]);
      await query('complete-dead-letter-replay-state', `update ops.durable_dead_letters set replay_state='replayed' where dead_letter_id=$1 and replay_state='requested'`, [input.originalDeadLetterId]);
      return { created: true };
    },

    async requestSourcePause({ sourceId, auditEventId, requestedAt, reasonCode }) {
      invariant(typeof auditEventId === 'string' && typeof reasonCode === 'string', 'SOURCE_PAUSE_EVIDENCE_INVALID', sourceId);
      const row = exactOne(await query('request-source-pause', `
        select (registry.request_source_pause($1,$2::timestamptz)).*
      `, [sourceId, requestedAt]), 'SOURCE_PAUSE_RESULT_MISSING', sourceId);
      return row;
    },

    async drainSource({ sourceId, reledger, now, leaseAbandonmentGraceMs = 5 * 60 * 1000 }) {
      let source = exactOne(await query('load-source-for-drain', `select * from registry.sources where source_id=$1 for update`, [sourceId]), 'SOURCE_NOT_FOUND', sourceId);
      invariant(['pause_requested', 'draining', 'paused'].includes(source.state), 'SOURCE_DRAIN_STATE_INVALID', sourceId);
      if (source.state === 'paused') return { state: 'paused', in_flight_work_count: 0, durably_reledgered_work_count: 0 };
      if (source.state === 'pause_requested') {
        source = exactOne(await query('start-source-drain', `select (registry.set_source_drain_state($1,'draining',$2::timestamptz)).*`, [sourceId, now]), 'SOURCE_DRAIN_RESULT_MISSING', sourceId);
      }
      const active = rows(await query('load-source-drain-work', `
        select * from ingest.jobs where source_id=$1 and state in ('pending','retry_wait','leased')
        order by job_id for update
      `, [sourceId]));
      const abandonmentBefore = new Date(Date.parse(now) - leaseAbandonmentGraceMs).toISOString();
      const liveLeases = active.filter(job => job.state === 'leased' && Date.parse(job.lease_expires_at) > Date.parse(abandonmentBefore));
      const abandoned = active.filter(job => job.state === 'leased' && Date.parse(job.lease_expires_at) <= Date.parse(abandonmentBefore));
      let reledgered = 0;
      if (reledger) {
        for (const job of abandoned) {
          const recovered = rows(await query('reledger-abandoned-source-job', `
            update ingest.jobs set state='pending',lease_owner=null,lease_expires_at=null,
              lease_epoch=lease_epoch+1,transport_generation=transport_generation+1,
              next_eligible_at=null,updated_at=$3::timestamptz
            where job_id=$1 and state='leased' and lease_epoch=$2 returning job_id
          `, [job.job_id, job.lease_epoch, now]));
          reledgered += recovered.length;
        }
        // Pending and retry-wait rows are already durable PostgreSQL work. They
        // deliberately remain undispatched while the source fetch gate is shut.
        reledgered += active.filter(job => job.state !== 'leased').length;
      }
      const unresolved = liveLeases.length + (reledger ? 0 : active.filter(job => job.state !== 'leased').length + abandoned.length);
      if (unresolved === 0) {
        source = exactOne(await query('complete-source-drain', `select (registry.set_source_drain_state($1,'paused',$2::timestamptz)).*`, [sourceId, now]), 'SOURCE_DRAIN_RESULT_MISSING', sourceId);
      }
      return { state: source.state, in_flight_work_count: unresolved, durably_reledgered_work_count: reledgered };
    },

    async resumeSource({ sourceId, auditEventId, resumedAt, configurationRevision, remediationEvidenceRefId, connectorVersion }) {
      const source = exactOne(await query('load-source-for-resume', `select * from registry.sources where source_id=$1 for update`, [sourceId]), 'SOURCE_NOT_FOUND', sourceId);
      invariant(source.state === 'paused' && Number(source.current_revision_number) === configurationRevision, 'SOURCE_RESUME_STATE_CONFIGURATION_FENCE_REJECTED', sourceId);
      invariant(typeof auditEventId === 'string' && auditEventId.length > 0, 'SOURCE_RESUME_EVIDENCE_INVALID', sourceId);
      if (remediationEvidenceRefId !== null || connectorVersion !== null) {
        invariant(typeof remediationEvidenceRefId === 'string' && remediationEvidenceRefId.length > 0
          && typeof connectorVersion === 'string' && connectorVersion.length > 0,
        'SOURCE_RESUME_REMEDIATION_EVIDENCE_INCOMPLETE', sourceId);
      }
      const resumed = exactOne(await query('resume-source', `
        select (registry.resume_source($1,$2,$3::timestamptz)).*
      `, [sourceId, configurationRevision, resumedAt]), 'SOURCE_RESUME_RESULT_MISSING', sourceId);
      const jobs = rows(await query('load-source-resume-jobs', `
        select job.*,run.trace_id from ingest.jobs job
        join ingest.harvest_runs run on run.run_id=job.run_id
        where job.source_id=$1 and job.state in ('pending','retry_wait') and run.terminal_at is null
        order by job.job_id for update of job
      `, [sourceId]));
      for (const job of jobs) {
        const original = exactOne(await query('load-source-resume-references', `
          select references_payload from ops.outbox
          where event_id=coalesce($1,$2) limit 1
        `, [job.last_transport_event_id, job.outbox_event_id]), 'SOURCE_RESUME_EVENT_EVIDENCE_MISSING', job.job_id);
        if (job.state === 'retry_wait') await query('admit-source-resume-job', `update ingest.jobs set state='pending',next_eligible_at=null where job_id=$1 and state='retry_wait'`, [job.job_id]);
        const nextGeneration = Number(job.transport_generation) + 1;
        const nextEpoch = Number(job.lease_epoch) + 1;
        const eventId = await deterministicOpaqueId('event_resume', { sourceId, jobId: job.job_id, nextGeneration, nextEpoch });
        await query('advance-source-resume-job', `
          update ingest.jobs set lease_epoch=$2,transport_generation=$3,last_transport_event_id=$4,
            transport_retention_expires_at=null,updated_at=$5::timestamptz
          where job_id=$1 and state='pending'
        `, [job.job_id, nextEpoch, nextGeneration, eventId, resumedAt]);
        await query('insert-source-resume-outbox', `
          insert into ops.outbox(event_id,event_type,producer,idempotency_key,state,references_payload,
            trace_id,attempt_count,maximum_delivery_attempts,lease_owner,lease_epoch,lease_expires_at,
            first_attempt_at,next_eligible_at,transport_retention_expires_at,send_outcome,safe_detail_code,
            created_at,updated_at,published_at,workflow_instance_id,workflow_attempt,workflow_version,
            workflow_retention_expires_at,run_deadline_at)
          values ($1,$2,'ops',$3,'pending',$4::jsonb,$5,0,$6,null,0,null,null,null,null,
            'not_started',null,$7::timestamptz,$7::timestamptz,null,null,null,null,null,null)
          on conflict (event_id) do nothing
        `, [eventId, EVENT_BY_STAGE[job.job_type], `event:${EVENT_BY_STAGE[job.job_type]}:${sourceId}:${job.job_id}:g${nextGeneration}`,
          JSON.stringify(completeReferences(original.references_payload)), job.trace_id,
          job.maximum_delivery_attempts, resumedAt]);
      }
      return resumed;
    },

    async canSourceFetch({ sourceId }) {
      const row = exactOne(await query('can-source-fetch', `select registry.can_source_fetch($1) as allowed`, [sourceId]), 'SOURCE_FETCH_GATE_RESULT_MISSING', sourceId);
      return row.allowed === true;
    },

    async consumeOriginTokens({ originId, now, requestedTokens, capacity, refillPerSecond }) {
      invariant(Number.isFinite(requestedTokens) && requestedTokens > 0 && Number.isFinite(capacity) && capacity > 0 && Number.isFinite(refillPerSecond) && refillPerSecond > 0, 'ORIGIN_TOKEN_POLICY_INVALID', originId);
      await query('ensure-origin-control', `
        insert into ops.origin_controls(origin_id,capacity,available_tokens,refill_per_second,last_refill_at,
          circuit_state,consecutive_failures,next_probe_at,probe_in_flight,last_success_at,updated_at)
        values ($1,$2,$2,$3,$4::timestamptz,'closed',0,null,false,null,$4::timestamptz)
        on conflict (origin_id) do nothing
      `, [originId, capacity, refillPerSecond, now]);
      const control = exactOne(await query('lock-origin-control-for-tokens', `select * from ops.origin_controls where origin_id=$1 for update`, [originId]), 'ORIGIN_CONTROL_MISSING', originId);
      invariant(Number(control.capacity) === capacity && Number(control.refill_per_second) === refillPerSecond, 'ORIGIN_RATE_POLICY_DRIFT', originId);
      const elapsedSeconds = Math.max(0, (Date.parse(now) - Date.parse(control.last_refill_at)) / 1000);
      const replenished = Math.min(capacity, Number(control.available_tokens) + elapsedSeconds * refillPerSecond);
      const allowed = replenished >= requestedTokens;
      const remaining = allowed ? replenished - requestedTokens : replenished;
      const retryAt = allowed ? null : new Date(Date.parse(now) + Math.ceil((requestedTokens - replenished) / refillPerSecond) * 1000).toISOString();
      await query('consume-origin-tokens', `
        update ops.origin_controls set available_tokens=$2,last_refill_at=$3::timestamptz,updated_at=$3::timestamptz
        where origin_id=$1
      `, [originId, remaining, now]);
      return { allowed, remaining_tokens: remaining, retry_at: retryAt };
    },

    async acquireOriginPermit({ originId, now, requestedTokens, capacity, refillPerSecond }) {
      await query('ensure-origin-control-for-permit', `
        insert into ops.origin_controls(origin_id,capacity,available_tokens,refill_per_second,last_refill_at,
          circuit_state,consecutive_failures,next_probe_at,probe_in_flight,last_success_at,updated_at)
        values ($1,$2,$2,$3,$4::timestamptz,'closed',0,null,false,null,$4::timestamptz)
        on conflict (origin_id) do nothing
      `, [originId, capacity, refillPerSecond, now]);
      let circuit = exactOne(await query('lock-origin-control-for-permit', `select * from ops.origin_controls where origin_id=$1 for update`, [originId]), 'ORIGIN_CONTROL_MISSING', originId);
      if (circuit.circuit_state === 'open' && Date.parse(circuit.next_probe_at) > Date.parse(now)) {
        return { allowed: false, reason: 'circuit_open', retry_at: circuit.next_probe_at, circuit_state: 'open' };
      }
      if (circuit.circuit_state === 'half_open' && circuit.probe_in_flight) {
        return { allowed: false, reason: 'half_open_probe_in_flight', retry_at: circuit.next_probe_at, circuit_state: 'half_open' };
      }
      const bucket = await store.consumeOriginTokens({ originId, now, requestedTokens, capacity, refillPerSecond });
      if (!bucket.allowed) return { ...bucket, reason: 'token_bucket_empty', circuit_state: circuit.circuit_state };
      if (circuit.circuit_state === 'open') {
        circuit = exactOne(await query('open-origin-half-open-probe', `
          update ops.origin_controls set circuit_state='half_open',probe_in_flight=true,updated_at=$2::timestamptz
          where origin_id=$1 and circuit_state='open' and not probe_in_flight returning *
        `, [originId, now]), 'ORIGIN_HALF_OPEN_PROBE_FENCE_REJECTED', originId);
      }
      return { ...bucket, reason: null, circuit_state: circuit.circuit_state };
    },

    async recordCircuitFailure({ originId, observedAt, threshold, nextProbeAt = null }) {
      invariant(Number.isInteger(threshold) && threshold > 0, 'ORIGIN_CIRCUIT_THRESHOLD_INVALID', originId);
      const current = await store.loadCircuit({ originId });
      const previousState = current.state;
      const failures = Number(current.failure_count) + 1;
      const opens = failures >= threshold || previousState === 'half_open';
      const nextState = opens ? 'open' : previousState;
      const probeAt = opens ? (nextProbeAt ?? new Date(Date.parse(observedAt) + 60_000).toISOString()) : current.next_probe_at;
      const updated = exactOne(await query('record-origin-circuit-failure', `
        update ops.origin_controls set circuit_state=$2,consecutive_failures=$3,
          next_probe_at=$4::timestamptz,probe_in_flight=false,updated_at=$5::timestamptz
        where origin_id=$1 returning *
      `, [originId, nextState, failures, probeAt, observedAt]), 'ORIGIN_CONTROL_MISSING', originId);
      return { state: updated.circuit_state, failure_count: Number(updated.consecutive_failures),
        next_probe_at: updated.next_probe_at, previous_state: previousState };
    },

    async recordCircuitSuccess({ originId, observedAt }) {
      const current = await store.loadCircuit({ originId });
      const updated = exactOne(await query('record-origin-circuit-success', `
        update ops.origin_controls set circuit_state='closed',consecutive_failures=0,
          next_probe_at=null,probe_in_flight=false,last_success_at=$2::timestamptz,updated_at=$2::timestamptz
        where origin_id=$1 returning *
      `, [originId, observedAt]), 'ORIGIN_CONTROL_MISSING', originId);
      return { state: updated.circuit_state, failure_count: 0, next_probe_at: null,
        last_success_at: updated.last_success_at, previous_state: current.state };
    },

    async loadCircuit({ originId }) {
      const row = optionalOne(await query('load-origin-circuit', `select * from ops.origin_controls where origin_id=$1`, [originId]), 'ORIGIN_CONTROL_DUPLICATE', originId);
      if (!row) return { state: 'closed', failure_count: 0, next_probe_at: null };
      return { state: row.circuit_state, failure_count: Number(row.consecutive_failures),
        next_probe_at: row.next_probe_at, probe_in_flight: row.probe_in_flight,
        last_success_at: row.last_success_at };
    },

    async listGcDependencies({ partitionId, now = new Date().toISOString(), lockForUpdate = false }) {
      const partition = exactOne(await query('load-gc-partition', `
        select registry.*,archive.archive_manifest_id,archive.row_count,archive.archive_locator,
          archive.archive_object_sha256,archive.archive_state,archive.restore_tested_at,
          archive.logical_sha256,archive.policy_version,archive.operator_id,
          archive.archive_access_controlled,archive.archive_access_evidence_reference_id,
          archive.backup_pitr_compatible,archive.backup_pitr_evidence_reference_id,
          archive.legal_policy_approved,archive.legal_policy_evidence_reference_id,
          policy.minimum_online_days,policy.workflow_retention_days,
          policy.reconciliation_grace_days,policy.queue_redelivery_days,
          policy.dlq_replay_days,policy.operator_replay_days,policy.rollback_days,policy.audit_days,
          proof.no_active_work,proof.no_unexpired_idempotency,
          proof.no_workflow_or_replay_dependency,proof.no_publication_or_rollback_dependency,
          proof.no_evidence_or_review_dependency,proof.archive_checksum_verified,
          proof.archive_restore_verified,proof.backup_pitr_compatible,proof.legal_policy_approved,
          proof.evidence_payload,proof.checked_at
        from ops.partition_registry registry
        join ops.correctness_ledger_registry ledger on ledger.ledger_name=registry.ledger_name
        join ops.retention_policies policy on policy.policy_id=ledger.retention_policy_id and policy.active
        left join lateral (
          select * from ops.archive_manifests archive
          where archive.partition_relation=registry.partition_relation
          order by archive.archived_at desc limit 1
        ) archive on true
        left join lateral (
          select * from ops.gc_dependency_proofs proof
          where proof.partition_relation=registry.partition_relation
          order by proof.checked_at desc limit 1
        ) proof on true
        where registry.partition_relation=$1
        ${lockForUpdate ? 'for update of registry' : ''}
      `, [partitionId]), 'GC_PARTITION_NOT_FOUND', partitionId);
      const counts = exactOne(await query('compute-gc-live-dependencies', `
        select
          (select count(*)::integer from ingest.harvest_runs where terminal_at is null) as active_run_count,
          (select count(*)::integer from ingest.jobs where state='leased' and lease_expires_at > $1::timestamptz) as active_lease_count,
          (select count(*)::integer from ops.outbox where state in ('pending','retry_wait','leased')) as pending_outbox_count,
          (select count(*)::integer from ingest.workflow_attempt_mappings where is_active) as nonterminal_workflow_count,
          (select count(*)::integer from ops.durable_dead_letters where replay_state in ('not_requested','requested')) as open_dead_letter_count,
          (select count(*)::integer from ops.replay_lineage replay join ingest.harvest_runs run on run.run_id=replay.new_run_id where run.terminal_at is null) as active_replay_count,
          ((select count(*) from ops.processed_event_keys where retain_until > $1::timestamptz)
           +(select count(*) from ops.outbox where state in ('pending','retry_wait','leased')))::integer as unexpired_idempotency_key_count,
          (select count(*)::integer from registry.source_terms_reviews where decision='review_required') as pending_review_reference_count,
          0::integer as audit_dependency_count
      `, [now]), 'GC_DEPENDENCY_COUNTS_MISSING', partitionId);
      const archiveVerified = ['checksum_verified', 'restore_verified'].includes(partition.archive_state);
      const restoreVerified = partition.archive_state === 'restore_verified' && partition.restore_tested_at !== null;
      const onlineRetentionDays = Math.floor((Date.parse(now) - Date.parse(partition.upper_bound)) / 86_400_000);
      const maximumRecoveryHorizonDays = Math.max(
        Number(partition.workflow_retention_days) + Number(partition.reconciliation_grace_days),
        Number(partition.queue_redelivery_days), Number(partition.dlq_replay_days),
        Number(partition.operator_replay_days), Number(partition.rollback_days)
      );
      const dependencies = {
        ...counts,
        // No relation in the 0001-0003 control-plane schema can hold these
        // references. Later migrations must extend this query when they add a
        // concrete referencing relation; the maintenance function independently
        // re-checks every currently registered correctness ledger.
        retained_publication_reference_count: 0,
        rollback_reference_count: 0,
        evidence_lineage_reference_count: 0,
        archive_checksum_verified: archiveVerified,
        archive_access_controlled: partition.archive_access_controlled === true && typeof partition.archive_access_evidence_reference_id === 'string',
        archive_restore_tested: restoreVerified,
        backup_pitr_compatible: partition.backup_pitr_compatible === true,
        legal_policy_approved: partition.legal_policy_approved === true,
        replay_horizon_expired: partition.replay_horizon_expires_at !== null && Date.parse(partition.replay_horizon_expires_at) <= Date.parse(now),
        workflow_retention_grace_expired: partition.workflow_retention_grace_expires_at !== null && Date.parse(partition.workflow_retention_grace_expires_at) <= Date.parse(now),
        rollback_window_expired: partition.rollback_window_expires_at !== null && Date.parse(partition.rollback_window_expires_at) <= Date.parse(now),
        online_retention_days: onlineRetentionDays,
        maximum_recovery_horizon_days: maximumRecoveryHorizonDays,
        publication_security_receipt_retention_days: Number(partition.audit_days),
        retention_policy_version: partition.policy_version ?? null
      };
      return {
        partition: {
          partition_id: partition.partition_relation,
          lower_watermark: partition.lower_bound,
          upper_watermark: partition.upper_bound,
          row_count: Number(partition.row_count ?? 0),
          archive_locator: partition.archive_locator,
          archive_sha256: partition.archive_object_sha256,
          state: partition.state,
          retention_deadline: partition.retention_deadline
        },
        dependencies
      };
    },

    async recordGcProof(proof) {
      invariant(proof.eligible === true && Array.isArray(proof.blockers) && proof.blockers.length === 0, 'GC_DEPENDENCY_PROOF_BLOCKED', proof.partition_id);
      const dependencies = proof.dependencies;
      const archive = exactOne(await query('load-gc-proof-archive', `
        select * from ops.archive_manifests
        where partition_relation=$1 and archive_state='restore_verified'
        order by archived_at desc limit 1
      `, [proof.partition_id]), 'GC_RESTORE_VERIFIED_ARCHIVE_MISSING', proof.partition_id);
      invariant(archive.archive_object_sha256 === proof.archive_sha256 && Number(archive.row_count) === proof.row_count, 'GC_ARCHIVE_PROOF_MISMATCH', proof.partition_id);
      const audit = exactOne(await query('load-gc-proof-audit', `
        select * from ops.audit_events
        where action='correctness_ledger_gc' and object_type='partition' and object_id=$1
          and decision in ('allowed','completed') and details->>'proof_digest'=$2
          and occurred_at <= $3::timestamptz
        order by occurred_at desc limit 1
      `, [proof.partition_id, proof.proof_digest, proof.evaluated_at]), 'GC_AUDIT_AUTHORITY_MISSING', proof.partition_id);
      await query('record-gc-proof', `
        insert into ops.gc_dependency_proofs(
          dependency_proof_id,proof_digest,partition_relation,no_active_work,no_unexpired_idempotency,
          no_workflow_or_replay_dependency,no_publication_or_rollback_dependency,
          no_evidence_or_review_dependency,archive_checksum_verified,archive_restore_verified,
          backup_pitr_compatible,legal_policy_approved,evidence_payload,checked_by,checked_at
        ) values ($1,$1,$2,true,true,true,true,true,true,true,true,true,$3::jsonb,
          'ushso-ingestion-control-store',$4::timestamptz)
        on conflict (dependency_proof_id) do nothing
      `, [proof.proof_digest, proof.partition_id, JSON.stringify(proof), proof.evaluated_at]);
      const receipt = exactOne(await query('verify-gc-proof', `
        select * from ops.gc_dependency_proofs where dependency_proof_id=$1
      `, [proof.proof_digest]), 'GC_PROOF_NOT_FOUND', proof.proof_digest);
      invariant(receipt.partition_relation === proof.partition_id, 'GC_PROOF_IDEMPOTENCY_CONFLICT', proof.proof_digest);
      const watermarkId = await deterministicOpaqueId('gc_watermark', { partitionId: proof.partition_id, proofDigest: proof.proof_digest });
      await query('record-gc-watermark', `
        insert into ops.gc_watermarks(
          gc_watermark_id,partition_relation,lower_bound,upper_bound,row_count,logical_sha256,
          policy_version,archive_manifest_id,dependency_proof_id,operator_id,audit_event_id,
          approved_at,executed_at
        ) values ($1,$2,$3::timestamptz,$4::timestamptz,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,null)
        on conflict (partition_relation) do nothing
      `, [watermarkId, proof.partition_id, proof.lower_watermark, proof.upper_watermark,
        proof.row_count, archive.logical_sha256, archive.policy_version, archive.archive_manifest_id,
        proof.proof_digest, archive.operator_id, audit.audit_event_id, proof.evaluated_at]);
      const watermark = exactOne(await query('verify-gc-watermark', `select * from ops.gc_watermarks where partition_relation=$1`, [proof.partition_id]), 'GC_WATERMARK_MISSING', proof.partition_id);
      invariant(watermark.dependency_proof_id === proof.proof_digest && watermark.archive_manifest_id === archive.archive_manifest_id, 'GC_WATERMARK_IDEMPOTENCY_CONFLICT', proof.partition_id);
      return { recorded: true };
    },

    async deleteGcPartition({ partitionId, proofDigest, deletedAt }) {
      const proof = exactOne(await query('verify-gc-delete-proof', `
        select proof.*,partition.state,partition.retention_deadline
        from ops.gc_dependency_proofs proof
        join ops.partition_registry partition on partition.partition_relation=proof.partition_relation
        where proof.dependency_proof_id=$1 and proof.partition_relation=$2
        for update of partition
      `, [proofDigest, partitionId]), 'GC_PROOF_NOT_FOUND', proofDigest);
      invariant(proof.state === 'archived_verified' && Date.parse(proof.retention_deadline) <= Date.parse(deletedAt), 'GC_PARTITION_NOT_DELETABLE', partitionId);
      try {
        invariant(/^(ingest|ops)\.[a-z][a-z0-9_]{2,127}$/.test(partitionId), 'GC_PARTITION_IDENTIFIER_INVALID', partitionId);
        const functionName = partitionId.startsWith('ingest.')
          ? 'ingest.delete_verified_ingest_partition'
          : 'ops.delete_verified_ops_partition';
        const result = exactOne(await query('delete-gc-partition', `
          select ${functionName}($1,$2,$3::timestamptz) as deleted_count
        `, [partitionId, proofDigest, deletedAt]), 'GC_PARTITION_DELETE_RECEIPT_MISSING', partitionId);
        return { deleted_count: Number(result.deleted_count) };
      } catch (error) {
        if (error?.sqlState === '42501' || error?.code === 'POSTGRES_42501') {
          const denied = new Error('GC_PARTITION_DELETE_CAPABILITY_MISSING');
          denied.code = 'GC_PARTITION_DELETE_CAPABILITY_MISSING';
          denied.detail = partitionId;
          throw denied;
        }
        throw error;
      }
    },

    async appendAudit(event) {
      invariant(typeof event.auditEventId === 'string' && typeof event.action === 'string' && typeof event.recordedAt === 'string', 'AUDIT_EVENT_INVALID');
      const [objectType, objectId] = auditObject(event);
      const traceId = event.traceId ?? traceFor('trace_audit', event.auditEventId);
      const decision = event.action.includes('requested') || ['pause', 'replay'].includes(event.action) ? 'requested' : 'completed';
      const actorType = event.operatorId ? 'maintenance_identity' : 'system_reconciler';
      await query('append-audit', `
        insert into ops.audit_events(
          audit_event_id,action,actor_id,actor_type,object_type,object_id,
          decision,details,trace_id,occurred_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::timestamptz)
        on conflict (audit_event_id,occurred_at) do nothing
      `, [event.auditEventId, event.action, event.operatorId ?? 'ushso-ingestion-control-store',
        actorType, objectType, objectId, decision, JSON.stringify(auditDetails(event)), traceId, event.recordedAt]);
      const receipt = exactOne(await query('verify-audit', `
        select * from ops.audit_events where audit_event_id=$1 and occurred_at=$2::timestamptz
      `, [event.auditEventId, event.recordedAt]), 'AUDIT_EVENT_RECEIPT_MISSING', event.auditEventId);
      invariant(receipt.action === event.action && receipt.object_type === objectType && receipt.object_id === objectId, 'AUDIT_EVENT_IDEMPOTENCY_CONFLICT', event.auditEventId);
      return { recorded: true };
    },

    async close() {
      if (closed) return;
      closed = true;
      try { await client.end(); }
      catch (error) { throw wrapDatabaseError(error, 'close'); }
    }
  };

  return Object.freeze(store);
}

/**
 * Build the production PostgreSQL port. Every call opens a new pg.Client;
 * request/workflow state is never retained at module scope.
 */
export function createPostgresControlStoreFactory({
  connectionString,
  Client = PgClient,
  applicationName = 'ushso-ingestion',
  logger = createNullLogger()
}) {
  const resolvedConnectionString = assertConnectionString(connectionString);
  invariant(typeof Client === 'function', 'POSTGRES_CLIENT_CONSTRUCTOR_MISSING');
  invariant(typeof applicationName === 'string' && /^[A-Za-z0-9._-]{3,64}$/.test(applicationName), 'POSTGRES_APPLICATION_NAME_INVALID');
  invariant(logger && typeof logger.emit === 'function', 'POSTGRES_LOGGER_INVALID');
  return async function openDatabase() {
    const client = new Client({ connectionString: resolvedConnectionString, application_name: applicationName });
    try {
      await client.connect();
      return createStore(client, { logger });
    } catch (error) {
      try { await client.end(); } catch { /* best-effort cleanup of a failed connect */ }
      throw wrapDatabaseError(error, 'connect');
    }
  };
}

export function createHyperdriveOpenDatabase({ hyperdrive, Client = PgClient, applicationName, logger } = {}) {
  invariant(hyperdrive && typeof hyperdrive.connectionString === 'string', 'HYPERDRIVE_BINDING_MISSING');
  return createPostgresControlStoreFactory({
    connectionString: hyperdrive.connectionString,
    Client,
    applicationName: applicationName ?? 'ushso-ingestion',
    logger: logger ?? createNullLogger()
  });
}
