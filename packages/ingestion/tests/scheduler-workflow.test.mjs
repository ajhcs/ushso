import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFakeWorkflowPlatform, createFakeWorkflowStep, createHarvestWorkflow,
  createInMemoryControlPlane, createScheduler, createWorkflowStartReconciler, FaultInjector
} from '../src/index.mjs';
import { completeBarriers, createScheduledPlane, SLOT } from './helpers.mjs';
import { validateIngestionRecord } from '../../../contracts/ingestion/v1.0.0/tools/index.mjs';

async function reconcileStart(plane) {
  const reconciler = createWorkflowStartReconciler({ openDatabase: plane.openDatabase, workflowPlatform: createFakeWorkflowPlatform(), configuration: { clock: () => SLOT } });
  await reconciler.reconcile({ now: SLOT });
}

test('Workflow terminal barrier fixtures are valid authoritative ingestion records', async () => {
  const barriers = completeBarriers();
  assert.deepEqual(await validateIngestionRecord('enumeration-control.schema.json', barriers.enumeration), { valid: true, issues: [] });
  assert.deepEqual(await validateIngestionRecord('enumeration-control.schema.json', barriers.projection), { valid: true, issues: [] });
});

test('duplicate Cron delivery creates one logical run and deterministic Workflow identity', async () => {
  const { plane, scheduler, scheduled, runId } = await createScheduledPlane();
  const duplicate = await scheduler.dispatchScheduledSlot({ scheduledTime: SLOT, cron: '*/5 * * * *', traceId: 'trace_scheduler_duplicate' });
  const state = plane.inspect();
  assert.equal(state.runs.size, 1);
  assert.equal(state.outbox.size, 1);
  assert.equal(scheduled.runs[0].workflowInstanceId, `harvest-${runId}-1`);
  assert.equal(duplicate.created, 0);
});

test('a poison schedule group is quarantined without starving a healthy source', async () => {
  const plane = createInMemoryControlPlane();
  plane.seedSource({
    source_id: 'source_a_poison', endpoint_id: 'endpoint_a_poison', origin_id: 'origin_a_poison',
    scope_ids: ['scope_poison_a', 'scope_poison_b'], state: 'active', schedules: [
      { scope_id: 'scope_poison_a', mode: 'incremental', configuration_revision: 1, optional_degradation_policy: [], next_due_at: SLOT },
      { scope_id: 'scope_poison_b', mode: 'incremental', configuration_revision: 1, optional_degradation_policy: [{ stage: 'schema_field_enrichment', authorizing_policy_version: 'optional.v1' }], next_due_at: SLOT }
    ]
  });
  plane.seedSource({ source_id: 'source_z_healthy', endpoint_id: 'endpoint_z_healthy', origin_id: 'origin_z_healthy', scope_ids: ['scope_healthy'], state: 'active', next_due_at: SLOT });
  const scheduler = createScheduler({ openDatabase: plane.openDatabase });
  const result = await scheduler.dispatchScheduledSlot({ scheduledTime: SLOT, now: SLOT });
  assert.equal(result.created, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.runs.find(item => item.sourceId === 'source_a_poison').quarantined, true);
  assert.equal(result.runs.find(item => item.sourceId === 'source_z_healthy').created, true);
  assert.ok(plane.inspect().sources.get('source_a_poison').schedules.every(schedule => schedule.state === 'quarantined'));
  assert.equal(plane.inspect().runs.size, 1);
  assert.ok(plane.inspect().audits.some(event => event.action === 'schedule_dispatch_failed' && event.outcome === 'quarantined'));
  const duplicate = await scheduler.dispatchScheduledSlot({ scheduledTime: SLOT, now: SLOT });
  assert.equal(duplicate.leased, 0);
});

test('unknown Workflow create outcome reconciles the same retained instance exactly once', async () => {
  const { plane, runId } = await createScheduledPlane();
  const platform = createFakeWorkflowPlatform();
  platform.enqueueCreateBehavior('unknown_after_create');
  const reconciler = createWorkflowStartReconciler({ openDatabase: plane.openDatabase, workflowPlatform: platform, configuration: { clock: () => SLOT } });
  const result = await reconciler.reconcile({ now: SLOT });
  assert.equal(result[0].outcome, 'resolved');
  assert.equal(platform.instances.size, 1);
  const state = plane.inspect();
  assert.equal(state.workflowMappings.size, 1);
  assert.equal(state.outbox.get(`event_workflow_${runId}`).state, 'published');
  assert.equal((await reconciler.reconcile({ now: SLOT })).length, 0);
});

test('Workflow history at its exact retention boundary is not recreated and the run fails audibly', async () => {
  const retentionMs = 120_000;
  const { plane, runId } = await createScheduledPlane({ workflowRetentionMs: retentionMs });
  const platform = createFakeWorkflowPlatform();
  const reconciler = createWorkflowStartReconciler({ openDatabase: plane.openDatabase, workflowPlatform: platform, configuration: { clock: () => atBoundary } });
  const atBoundary = new Date(Date.parse(SLOT) + retentionMs).toISOString();
  const result = await reconciler.reconcile({ now: atBoundary });
  assert.equal(result[0].outcome, 'retention_expired');
  assert.equal(platform.instances.size, 0);
  const run = plane.inspect().runs.get(runId);
  assert.equal(run.state, 'failed');
  assert.equal(run.failure_code, 'WORKFLOW_HISTORY_RETENTION_EXPIRED');
});

test('Workflow commits only complete barriers and opens a fresh closed DB client for every step', async () => {
  const { plane, runId, run } = await createScheduledPlane();
  await reconcileStart(plane);
  const clientsBeforeWorkflow = plane.inspect().clientLifecycle.length;
  plane.seedBarriers(runId, completeBarriers());
  const workflow = createHarvestWorkflow({ openDatabase: plane.openDatabase, configuration: { clock: () => SLOT } });
  const step = createFakeWorkflowStep();
  const result = await workflow.run({ instanceId: `harvest-${runId}-1`, params: { runId, attempt: 1, deadlineAt: run.deadline_at } }, step);
  assert.deepEqual(result, { status: 'succeeded', publicationId: 'publication_fixture_complete' });
  assert.deepEqual(step.calls.map(call => call.name), [
    '01.validate-run-attempt', '02.ensure-initial-page-job', '03.enumeration-barrier.check.0',
    '05.commit-checkpoint-and-normalization-outbox', '06.normalization-barrier.check.0',
    '08.request-projection', '09.projection-barrier.check.0', '11.record-coverage-and-complete-run'
  ]);
  const state = plane.inspect();
  assert.equal(state.runs.get(runId).state, 'succeeded');
  const committedCheckpoints = [...state.checkpoints.values()].filter(checkpoint => checkpoint.proposed_by_run_id === runId);
  assert.equal(committedCheckpoints.length, 1);
  assert.ok(committedCheckpoints.every(checkpoint => checkpoint.downstream_outbox_committed === true));
  const workflowClients = state.clientLifecycle.slice(clientsBeforeWorkflow);
  assert.equal(workflowClients.length, step.calls.length);
  assert.ok(workflowClients.every(client => client.closed));
});

test('terminal Workflow step retry after commit-response loss returns the exact committed result', async () => {
  const faults = new FaultInjector();
  const { plane, runId, run } = await createScheduledPlane({ faults });
  await reconcileStart(plane);
  plane.seedBarriers(runId, completeBarriers());
  faults.arm('transaction.workflow-complete.after_commit_response');
  const calls = [];
  const step = {
    async do(name, options, callback) {
      calls.push(name);
      try { return await callback(); }
      catch (error) {
        if (name !== '11.record-coverage-and-complete-run' || error.code !== 'INJECTED_FAULT') throw error;
        calls.push(`${name}.retry`);
        return callback();
      }
    },
    async sleep() { throw new Error('UNEXPECTED_SLEEP'); }
  };
  const result = await createHarvestWorkflow({ openDatabase: plane.openDatabase, configuration: { clock: () => SLOT } }).run({ instanceId: `harvest-${runId}-1`, params: { runId, attempt: 1, deadlineAt: run.deadline_at } }, step);
  assert.deepEqual(result, { status: 'succeeded', publicationId: 'publication_fixture_complete' });
  assert.ok(calls.includes('11.record-coverage-and-complete-run.retry'));
  assert.equal(plane.inspect().runs.get(runId).state_history.filter(item => item.state === 'succeeded').length, 1);
});

test('incomplete enumeration becomes partial_unpublished and preserves last-known-good publication', async () => {
  const { plane, runId, run } = await createScheduledPlane();
  await reconcileStart(plane);
  plane.seedBarriers(runId, {
    enumeration: { status: 'failed', observed_at: '2026-08-30T00:05:00.000Z', sealed: false, enumeration_seal_id: null, required_dead_letter_count: 1 }
  });
  const workflow = createHarvestWorkflow({ openDatabase: plane.openDatabase, configuration: { clock: () => SLOT } });
  const result = await workflow.run({ instanceId: `harvest-${runId}-1`, params: { runId, attempt: 1, deadlineAt: run.deadline_at } }, createFakeWorkflowStep());
  assert.equal(result.status, 'partial_unpublished');
  const final = plane.inspect().runs.get(runId);
  assert.equal(final.publication_id, null);
  assert.equal(final.last_known_good_publication_id, 'publication_last_known_good');
  assert.equal(plane.inspect().checkpoints.size, 0);
});

test('checkpoint transaction fault rolls back both checkpoint and normalization outbox', async () => {
  const faults = new FaultInjector();
  const { plane, runId, run } = await createScheduledPlane({ faults });
  await reconcileStart(plane);
  plane.seedBarriers(runId, completeBarriers());
  faults.arm('transaction.workflow-checkpoint-normalization.before_commit');
  const workflow = createHarvestWorkflow({ openDatabase: plane.openDatabase, configuration: { clock: () => SLOT } });
  await assert.rejects(
    workflow.run({ instanceId: `harvest-${runId}-1`, params: { runId, attempt: 1, deadlineAt: run.deadline_at } }, createFakeWorkflowStep()),
    /INJECTED_FAULT/
  );
  const state = plane.inspect();
  assert.equal(state.checkpoints.size, 0);
  assert.equal([...state.outbox.values()].some(event => event.event_type === 'normalize_requested'), false);
});

test('Workflow fences deadline and configured step budget before side effects', async () => {
  const { plane, runId, run } = await createScheduledPlane();
  await reconcileStart(plane);
  const workflow = createHarvestWorkflow({ openDatabase: plane.openDatabase, configuration: { clock: () => SLOT } });
  await assert.rejects(workflow.run({
    instanceId: `harvest-${runId}-1`,
    params: { runId, attempt: 1, deadlineAt: run.deadline_at, barrierPolicy: { policyVersion: 'barrier.v1', pollDelayMs: 60_000, maximumChecks: 1666, workflowStepBudget: 10_000 } }
  }, createFakeWorkflowStep()), /WORKFLOW_BARRIER_STEP_BUDGET_INVALID/);
  await assert.rejects(workflow.run({
    instanceId: `harvest-${runId}-1`, params: { runId, attempt: 1, deadlineAt: '2026-08-31T00:00:00.001Z' }
  }, createFakeWorkflowStep()), /WORKFLOW_DEADLINE_FENCE_REJECTED/);
  assert.equal(plane.inspect().jobs.size, 0);
});

test('pending barriers durably sleep and resume, while terminal evidence after the deadline fails closed', async () => {
  {
    const { plane, runId, run } = await createScheduledPlane();
    await reconcileStart(plane);
    plane.seedBarriers(runId, { enumeration: { status: 'open' } });
    const calls = [];
    const sleeps = [];
    const step = {
      async do(name, options, callback) { calls.push(name); return callback(); },
      async sleep(name, duration) {
        sleeps.push({ name, duration });
        if (name === '03.enumeration-barrier.wait.1') plane.seedBarriers(runId, completeBarriers());
      }
    };
    const result = await createHarvestWorkflow({ openDatabase: plane.openDatabase, configuration: { clock: () => SLOT } }).run({ instanceId: `harvest-${runId}-1`, params: { runId, attempt: 1, deadlineAt: run.deadline_at } }, step);
    assert.deepEqual(result, { status: 'succeeded', publicationId: 'publication_fixture_complete' });
    assert.deepEqual(sleeps, [{ name: '03.enumeration-barrier.wait.1', duration: '60 seconds' }]);
    assert.ok(calls.includes('03.enumeration-barrier.check.1'));
  }
  {
    const { plane, runId, run } = await createScheduledPlane();
    await reconcileStart(plane);
    const barriers = completeBarriers();
    barriers.projection.evaluated_at = '2026-08-31T00:00:00.001Z';
    plane.seedBarriers(runId, barriers);
    const result = await createHarvestWorkflow({ openDatabase: plane.openDatabase, configuration: { clock: () => SLOT } }).run({ instanceId: `harvest-${runId}-1`, params: { runId, attempt: 1, deadlineAt: run.deadline_at } }, createFakeWorkflowStep());
    assert.deepEqual(result, { status: 'partial_unpublished', stage: 'projection' });
    assert.equal(plane.inspect().runs.get(runId).publication_id, null);
  }
});
