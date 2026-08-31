import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInMemoryControlPlane, createOriginController, createRetentionGcService, createScheduler,
  createSourceControlService, createStructuredLogger, FaultInjector, redactStructuredEvent
} from '../src/index.mjs';
import { queueBody, seedQueueWork, SLOT, zeroGcDependencies } from './helpers.mjs';

const PLUS = milliseconds => new Date(Date.parse(SLOT) + milliseconds).toISOString();

test('pause drains or proves abandoned leases, then guarantees zero fetches until audited resume', async () => {
  const plane = createInMemoryControlPlane();
  const body = queueBody();
  seedQueueWork(plane, body);
  const sourceControl = createSourceControlService({ openDatabase: plane.openDatabase });
  await sourceControl.requestPause({ sourceId: body.source_id, auditEventId: 'audit_pause_fixture', requestedAt: SLOT, reasonCode: 'OPERATOR_PAUSE' });
  const paused = await sourceControl.drain({ sourceId: body.source_id, auditEventId: 'audit_drain_fixture', now: PLUS(1_000) });
  assert.equal(paused.state, 'paused');
  await assert.rejects(plane.recordFetch(body.source_id), /SOURCE_FETCH_BLOCKED/);
  await assert.rejects(sourceControl.assertFetchAllowed({ sourceId: body.source_id }), /SOURCE_FETCH_BLOCKED/);

  const scheduler = createScheduler({ openDatabase: plane.openDatabase });
  const scheduled = await scheduler.dispatchScheduledSlot({ scheduledTime: SLOT, now: PLUS(2_000) });
  assert.equal(scheduled.leased, 0);
  assert.equal(plane.inspect().fetchCountBySource.get(body.source_id) ?? 0, 0);

  const resumed = await sourceControl.resume({
    sourceId: body.source_id, auditEventId: 'audit_resume_fixture', resumedAt: PLUS(3_000),
    configurationRevision: 2, remediationEvidenceRefId: 'evidence_resume_fixture'
  });
  assert.equal(resumed.state, 'active');
  assert.ok([...plane.inspect().outbox.values()].some(event => event.event_id.startsWith('event_resume_')));
  await plane.recordFetch(body.source_id);
  assert.equal(plane.inspect().fetchCountBySource.get(body.source_id), 1);

  const leasedPlane = createInMemoryControlPlane();
  const leasedBody = queueBody({ eventId: 'event_leased_pause', jobId: 'job_leased_pause', runId: 'run_leased_pause' });
  seedQueueWork(leasedPlane, leasedBody, {
    state: 'leased'
  });
  // Seed the exact external lease after the generic job fixture.
  leasedPlane.seedJob({
    job_id: leasedBody.references.job_id, run_id: leasedBody.references.run_id, source_id: leasedBody.source_id,
    job_type: 'normalize_record', state: 'leased', active_run_attempt: 1, delivery_fence: leasedBody.delivery_fence,
    lease: { token: 'lease_external_fixture', epoch: 1, owner_id: leasedBody.event_id, expires_at: PLUS(10_000) },
    message_references: leasedBody.references
  });
  const leasedControl = createSourceControlService({ openDatabase: leasedPlane.openDatabase });
  await leasedControl.requestPause({ sourceId: leasedBody.source_id, auditEventId: 'audit_pause_leased', requestedAt: SLOT, reasonCode: 'OPERATOR_PAUSE' });
  const draining = await leasedControl.drain({ sourceId: leasedBody.source_id, auditEventId: 'audit_drain_leased', now: PLUS(2_000), leaseAbandonmentGraceMs: 5_000 });
  assert.equal(draining.state, 'draining');
  assert.equal(draining.in_flight_work_count, 1);
  const abandoned = await leasedControl.drain({ sourceId: leasedBody.source_id, auditEventId: 'audit_drain_abandoned', now: PLUS(16_000), leaseAbandonmentGraceMs: 5_000 });
  assert.equal(abandoned.state, 'paused');
  assert.ok(leasedPlane.inspect().jobs.get(leasedBody.references.job_id).lease_abandonment_proof);
  await assert.rejects(leasedPlane.recordFetch({ sourceId: leasedBody.source_id, jobId: leasedBody.references.job_id, leaseToken: 'lease_external_fixture', now: PLUS(16_000) }), /SOURCE_FETCH_BLOCKED|SOURCE_FETCH_JOB_FENCE_REJECTED/);
});

test('shared origin bucket and single half-open probe coordinate across controller instances', async () => {
  const plane = createInMemoryControlPlane();
  const configuration = { capacity: 2, refillPerSecond: 1, circuitThreshold: 1, circuitCooldownMs: 10_000 };
  const first = createOriginController({ openDatabase: plane.openDatabase, configuration });
  const second = createOriginController({ openDatabase: plane.openDatabase, configuration });
  assert.equal((await first.acquire({ originId: 'origin_shared', now: SLOT })).allowed, true);
  assert.equal((await second.acquire({ originId: 'origin_shared', now: SLOT })).allowed, true);
  const limited = await first.acquire({ originId: 'origin_shared', now: SLOT });
  assert.equal(limited.allowed, false);
  assert.equal(limited.reason, 'token_bucket_empty');
  assert.equal(limited.retryAt, PLUS(1_000));

  await first.failure({ originId: 'origin_shared', now: SLOT, failure: {
    failure_type: 'timeout', retry_class: 'transient', target_class: 'exact_item',
    safe_detail_code: 'UPSTREAM_TIMEOUT', observed_at: SLOT
  } });
  assert.equal((await second.acquire({ originId: 'origin_shared', now: PLUS(5_000) })).reason, 'circuit_open');
  const probe = await first.acquire({ originId: 'origin_shared', now: PLUS(10_000) });
  assert.equal(probe.allowed, true);
  assert.equal(probe.circuit_state, 'half_open');
  assert.equal((await second.acquire({ originId: 'origin_shared', now: PLUS(10_000) })).reason, 'half_open_probe_in_flight');
  await assert.rejects(first.success({ originId: 'origin_shared', now: PLUS(11_000) }), /CIRCUIT_CLOSE_AUDIT_REQUIRED/);
  const closed = await first.success({ originId: 'origin_shared', now: PLUS(11_000), auditEventId: 'audit_half_open_probe' });
  assert.equal(closed.state, 'closed');
  assert.ok(plane.inspect().audits.some(audit => audit.action === 'origin_circuit_closed'));
});

function gcPartition(id) {
  return {
    partition_id: id, lower_watermark: '2026-01-01T00:00:00.000Z', upper_watermark: '2026-02-01T00:00:00.000Z',
    row_count: 42, archive_locator: `r2://correctness-archive/${id}.jsonl`, archive_sha256: 'a'.repeat(64)
  };
}

test('GC rejects every correctness dependency and commits proof, audit, and delete atomically', async () => {
  const blockers = [
    'active_replay_count', 'unexpired_idempotency_key_count', 'nonterminal_workflow_count',
    'rollback_reference_count', 'evidence_lineage_reference_count', 'audit_dependency_count'
  ];
  const plane = createInMemoryControlPlane();
  const gc = createRetentionGcService({ openDatabase: plane.openDatabase });
  for (const [index, field] of blockers.entries()) {
    const partitionId = `partition_blocked_${index}`;
    plane.seedGcPartition(gcPartition(partitionId), zeroGcDependencies({ [field]: 1 }));
    const proof = await gc.evaluate({ partitionId, now: SLOT });
    assert.equal(proof.eligible, false);
    assert.ok(proof.blockers.some(blocker => blocker.startsWith(`${field}:`)));
  }

  const partitionId = 'partition_eligible';
  plane.seedGcPartition(gcPartition(partitionId), zeroGcDependencies());
  const { collect } = gc;
  const dryRun = await collect({ partitionId, auditEventId: 'audit_gc_dry', operatorId: 'operator_fixture', now: SLOT });
  assert.equal(dryRun.executed, false);
  assert.equal(plane.inspect().gcPartitions.get(partitionId).deleted, false);

  const faulted = new FaultInjector();
  const faultPlane = createInMemoryControlPlane({ faults: faulted });
  faultPlane.seedGcPartition(gcPartition('partition_fault'), zeroGcDependencies());
  const faultGc = createRetentionGcService({ openDatabase: faultPlane.openDatabase, faults: faulted });
  faulted.arm('gc.after_proof_before_delete');
  await assert.rejects(faultGc.collect({ partitionId: 'partition_fault', auditEventId: 'audit_gc_fault', operatorId: 'operator_fixture', now: SLOT, execute: true }), /INJECTED_FAULT/);
  assert.equal(faultPlane.inspect().gcPartitions.get('partition_fault').deleted, false);
  assert.equal(faultPlane.inspect().gcProofs.size, 0);
  assert.equal(faultPlane.inspect().audits.length, 0);

  const executed = await gc.collect({ partitionId, auditEventId: 'audit_gc_execute', operatorId: 'operator_fixture', now: SLOT, execute: true });
  assert.equal(executed.deletedCount, 42);
  const final = plane.inspect();
  assert.equal(final.gcPartitions.get(partitionId).deleted, true);
  assert.equal(final.gcProofs.get(executed.proof.proof_digest).eligible, true);
  assert.ok(final.audits.some(audit => audit.proofDigest === executed.proof.proof_digest));
});

test('structured observability strips unexpected payload fields, credentials, and signed URL components', () => {
  const redacted = redactStructuredEvent({
    level: 'warn', event: 'fixture.redaction', timestamp: SLOT,
    trace_id: 'Authorization: Bearer abc.def', safe_detail_code: 'https://catalog.example/path?sig=secret#fragment',
    raw_payload: [{ patient_name: 'Never Log' }], user_id: 'person_123', password: 'not-allowed'
  });
  assert.equal(redacted.trace_id, '[REDACTED]');
  assert.equal(redacted.safe_detail_code, 'https://catalog.example/path');
  assert.equal('raw_payload' in redacted, false);
  assert.equal('user_id' in redacted, false);
  assert.equal('password' in redacted, false);
  const events = [];
  const logger = createStructuredLogger(event => events.push(event));
  logger.emit({ level: 'info', event: 'fixture.allowed', source_id: 'source_fixture', count: 1, secret: 'secret://forbidden/value' });
  assert.deepEqual(events, [{ count: 1, event: 'fixture.allowed', level: 'info', source_id: 'source_fixture' }]);
});
