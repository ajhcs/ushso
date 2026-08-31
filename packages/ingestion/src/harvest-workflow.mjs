import { canonicalJson, invariant, parseTimestamp } from './common.mjs';
import { assertControlStore, withFreshDatabaseClient } from './ports.mjs';
import { createNullLogger } from './redaction.mjs';
import { workflowInstanceId } from './scheduler.mjs';

const STEP_OPTIONS = Object.freeze({ retries: Object.freeze({ limit: 3, delay: '5 seconds', backoff: 'exponential' }), timeout: '5 minutes' });
const OPTIONAL_DEGRADATION_STAGES = new Set(['schema_field_enrichment', 'supplementary_documentation', 'scheduled_access_reprobe', 'candidate_identity_scoring']);
const OPTIONAL_RESULT_STATES = new Set(['inherited', 'stale', 'unknown', 'quarantined']);

async function doDatabaseStep(step, name, openDatabase, operation) {
  return step.do(name, STEP_OPTIONS, () => withFreshDatabaseClient(openDatabase, async database => {
    assertControlStore(database);
    return operation(database);
  }));
}

function optionalDegradationsValid(items) {
  return Array.isArray(items) && items.every(item =>
    item && OPTIONAL_DEGRADATION_STAGES.has(item.stage) && typeof item.affected_id === 'string' &&
    OPTIONAL_RESULT_STATES.has(item.result_state) && typeof item.authorizing_policy_version === 'string'
  );
}

function enumerationSealComplete(state, run) {
  return state?.contract_version === 'ingestion.v1.0.0' && state.record_kind === 'enumeration_seal' && state.status === 'sealed' &&
    state.run_id === run.run_id && state.source_id === run.source_id && run.scope_ids.includes(state.scope_id) &&
    state.page_dead_letter_count === 0 && state.cursor_expired === false &&
    Number.isInteger(state.pages_discovered) && state.pages_discovered === state.pages_committed &&
    Number.isInteger(state.items_discovered) && state.items_discovered === state.discoveries_committed &&
    typeof state.population_digest === 'string' && /^[a-f0-9]{64}$/.test(state.population_digest) &&
    typeof state.completeness_evidence_ref_id === 'string' && typeof state.enumeration_seal_id === 'string' &&
    typeof state.sealed_at === 'string';
}

function enumerationComplete(observation, run) {
  if (observation?.status !== 'sealed' || !Array.isArray(observation.seals)) return false;
  const expectedScopes = [...run.scope_ids].sort();
  const observedScopes = observation.seals.map(seal => seal.scope_id).sort();
  return observation.seals.length === expectedScopes.length &&
    new Set(observedScopes).size === expectedScopes.length &&
    JSON.stringify(observedScopes) === JSON.stringify(expectedScopes) &&
    observation.seals.every(seal => enumerationSealComplete(seal, run));
}

function degradationAuthorizedBeforeRun(item, run) {
  return Array.isArray(run.optional_degradation_policy) && run.optional_degradation_policy.some(rule =>
    rule.stage === item.stage && rule.authorizing_policy_version === item.authorizing_policy_version
  );
}

function normalizationComplete(state, run) {
  return ['complete', 'complete_with_optional_degradation'].includes(state.status) && state.required_dead_letter_count === 0 &&
    (state.run_id === undefined || state.run_id === run.run_id) &&
    typeof state.observed_at === 'string' &&
    Number.isInteger(state.observed_revision_count) && state.observed_revision_count === state.normalization_terminal_count &&
    state.membership_checkpoint_committed === true && state.w1_revision_manifest_sealed === true &&
    optionalDegradationsValid(state.optional_degradations) && state.optional_degradations.every(item => degradationAuthorizedBeforeRun(item, run)) &&
    ((state.status === 'complete' && state.optional_degradations.length === 0) ||
      (state.status === 'complete_with_optional_degradation' && state.optional_degradations.length > 0));
}

function publicationComplete(state, normalization, run) {
  return state.status === undefined && state.contract_version === 'ingestion.v1.0.0' && state.record_kind === 'publication_barrier' &&
    state.run_id === run.run_id && state.last_known_good_publication_id === run.last_known_good_publication_id &&
    ['published', 'succeeded', 'succeeded_with_optional_degradation'].includes(state.run_outcome) &&
    state.enumerations_complete_and_sealed === true && state.membership_checkpoint_committed === true &&
    Number.isInteger(state.normalization_terminal_count) && state.normalization_terminal_count === state.observed_revision_count &&
    state.w1_revision_manifest_sealed === true && state.eligible_projection_count === state.projection_acknowledgement_count &&
    state.required_dead_letter_count === 0 && state.references_resolved === true && state.checksums_verified === true &&
    state.visibility_verified === true && state.coverage_reconciled === true && optionalDegradationsValid(state.optional_degradations) &&
    state.optional_degradations.every(item => degradationAuthorizedBeforeRun(item, run)) &&
    JSON.stringify(state.optional_degradations) === JSON.stringify(normalization.optional_degradations) &&
    typeof state.candidate_publication_id === 'string' && state.active_publication_id === state.candidate_publication_id &&
    typeof state.last_known_good_publication_id === 'string';
}

async function pollBarrier({ step, prefix, openDatabase, read, clock, maximumChecks, pollDelayMs, deadlineAt }) {
  const check = index => doDatabaseStep(step, `${prefix}.check.${index}`, openDatabase, database => read(database, clock()));
  let state = await check(0);
  for (let index = 1; state === null || ['pending', 'open', 'building'].includes(state.status); index += 1) {
    state ??= { status: 'pending' };
    const checkedAt = state.checked_at ?? state.evaluated_at;
    if (!checkedAt) return Object.freeze({ ...state, status: 'deadline', safe_detail_code: 'BARRIER_CHECK_CLOCK_MISSING', decision_at: deadlineAt });
    if (checkedAt && parseTimestamp(checkedAt) >= parseTimestamp(deadlineAt)) return Object.freeze({ ...state, status: 'deadline', decision_at: checkedAt });
    if (index > maximumChecks) return Object.freeze({ ...state, status: 'deadline', safe_detail_code: 'BARRIER_STEP_BUDGET_EXHAUSTED', decision_at: checkedAt ?? deadlineAt });
    await step.sleep(`${prefix}.wait.${index}`, `${Math.ceil(pollDelayMs / 1000)} seconds`);
    state = await check(index);
  }
  const terminalAt = state?.evaluated_at ?? state?.sealed_at ?? state?.observed_at;
  if (!terminalAt || parseTimestamp(terminalAt) > parseTimestamp(deadlineAt)) {
    return Object.freeze({ ...state, status: 'deadline', safe_detail_code: terminalAt ? 'BARRIER_TERMINAL_AFTER_DEADLINE' : 'BARRIER_TERMINAL_CLOCK_MISSING', decision_at: terminalAt ?? deadlineAt });
  }
  return state;
}

export function createHarvestWorkflow({ openDatabase, logger = createNullLogger(), configuration = {} }) {
  invariant(typeof openDatabase === 'function', 'OPEN_DATABASE_PORT_MISSING');
  invariant(typeof configuration.clock === 'function', 'OPERATIONAL_CLOCK_MISSING');

  function operationTime() {
    return new Date(parseTimestamp(configuration.clock())).toISOString();
  }

  return Object.freeze({
    async run(event, step) {
      const params = event.params ?? event.payload ?? event;
      const { runId, attempt, deadlineAt } = params;
      const barrierPolicy = params.barrierPolicy ?? {
        policyVersion: configuration.barrierPolicyVersion ?? 'barrier.v1',
        pollDelayMs: configuration.pollDelayMs ?? 60_000,
        maximumChecks: configuration.maximumBarrierChecks ?? 1600,
        workflowStepBudget: configuration.workflowStepBudget ?? 10_000
      };
      invariant(typeof barrierPolicy.policyVersion === 'string' && Number.isInteger(barrierPolicy.pollDelayMs) && barrierPolicy.pollDelayMs >= 1000 && Number.isInteger(barrierPolicy.maximumChecks) && barrierPolicy.maximumChecks >= 1 && Number.isInteger(barrierPolicy.workflowStepBudget) && barrierPolicy.workflowStepBudget >= 1024, 'WORKFLOW_BARRIER_POLICY_INVALID');
      invariant(barrierPolicy.maximumChecks * 6 + 8 <= barrierPolicy.workflowStepBudget, 'WORKFLOW_BARRIER_STEP_BUDGET_INVALID');
      invariant(event.instanceId === undefined || event.instanceId === workflowInstanceId(runId, attempt), 'WORKFLOW_INSTANCE_FENCE_MISMATCH');
      const run = await doDatabaseStep(step, '01.validate-run-attempt', openDatabase, database => database.loadRunForWorkflow({ runId, attempt }));
      invariant(run && run.run_id === runId && run.active_attempt === attempt && run.terminal_at === null, 'WORKFLOW_RUN_FENCE_REJECTED');
      invariant(deadlineAt === run.deadline_at, 'WORKFLOW_DEADLINE_FENCE_REJECTED');
      invariant(params.workflowVersion === undefined || params.workflowVersion === run.workflow_version, 'WORKFLOW_VERSION_FENCE_REJECTED');
      invariant(canonicalJson(barrierPolicy) === canonicalJson(run.barrier_policy), 'WORKFLOW_BARRIER_POLICY_FENCE_REJECTED');

      const admissionAt = operationTime();
      if (parseTimestamp(admissionAt) >= parseTimestamp(run.deadline_at)) {
        await doDatabaseStep(step, '02.reject-expired-run-admission', openDatabase, database => database.transaction('workflow-deadline-admission', transaction => transaction.markRunPartialUnpublished({
          runId, attempt, stage: 'workflow_admission',
          barrier: { status: 'deadline', decision_at: admissionAt, safe_detail_code: 'RUN_DEADLINE_EXPIRED_BEFORE_INITIAL_JOB' }
        })));
        return Object.freeze({ status: 'partial_unpublished', stage: 'workflow_admission' });
      }

      await doDatabaseStep(step, '02.ensure-initial-page-job', openDatabase, database => database.transaction('workflow-initial-page', transaction => transaction.ensureInitialPageJob({ runId, attempt, admittedAt: admissionAt })));

      const enumeration = await pollBarrier({
        step, prefix: '03.enumeration-barrier', openDatabase, clock: operationTime, maximumChecks: barrierPolicy.maximumChecks, pollDelayMs: barrierPolicy.pollDelayMs, deadlineAt,
        read: (database, checkedAt) => database.readEnumerationBarrier({ runId, attempt, checkedAt })
      });
      if (!enumerationComplete(enumeration, run)) {
        const outcome = await doDatabaseStep(step, '04.mark-partial-enumeration', openDatabase, database => database.transaction('workflow-partial-enumeration', transaction => transaction.markRunPartialUnpublished({ runId, attempt, stage: 'enumeration', barrier: enumeration })));
        logger.emit({ level: 'warn', event: 'workflow.partial_unpublished', timestamp: outcome.recorded_at, trace_id: run.trace_id, run_id: runId, workflow_instance_id: workflowInstanceId(runId, attempt), outcome: 'partial_unpublished' });
        return Object.freeze({ status: 'partial_unpublished', stage: 'enumeration' });
      }

      await doDatabaseStep(step, '05.commit-checkpoint-and-normalization-outbox', openDatabase, database => database.transaction('workflow-checkpoint-normalization', transaction => transaction.commitCheckpointAndNormalizationOutbox({
        runId, attempt,
        enumerationSealIds: enumeration.seals.map(seal => seal.enumeration_seal_id).sort()
      })));

      const normalization = await pollBarrier({
        step, prefix: '06.normalization-barrier', openDatabase, clock: operationTime, maximumChecks: barrierPolicy.maximumChecks, pollDelayMs: barrierPolicy.pollDelayMs, deadlineAt,
        read: (database, checkedAt) => database.readNormalizationBarrier({ runId, attempt, checkedAt })
      });
      if (!normalizationComplete(normalization, run)) {
        await doDatabaseStep(step, '07.mark-partial-normalization', openDatabase, database => database.transaction('workflow-partial-normalization', transaction => transaction.markRunPartialUnpublished({ runId, attempt, stage: 'normalization', barrier: normalization })));
        return Object.freeze({ status: 'partial_unpublished', stage: 'normalization' });
      }

      await doDatabaseStep(step, '08.request-projection', openDatabase, database => database.transaction('workflow-request-projection', transaction => transaction.requestProjection({ runId, attempt, optionalDegradations: normalization.optional_degradations ?? [] })));

      const projection = await pollBarrier({
        step, prefix: '09.projection-barrier', openDatabase, clock: operationTime, maximumChecks: barrierPolicy.maximumChecks, pollDelayMs: barrierPolicy.pollDelayMs, deadlineAt,
        read: (database, checkedAt) => database.readProjectionBarrier({ runId, attempt, checkedAt })
      });
      if (!publicationComplete(projection, normalization, run)) {
        await doDatabaseStep(step, '10.mark-partial-projection', openDatabase, database => database.transaction('workflow-partial-projection', transaction => transaction.markRunPartialUnpublished({ runId, attempt, stage: 'projection', barrier: projection })));
        return Object.freeze({ status: 'partial_unpublished', stage: 'projection' });
      }

      const completed = await doDatabaseStep(step, '11.record-coverage-and-complete-run', openDatabase, database => database.transaction('workflow-complete', transaction => transaction.recordCoverageAndCompleteRun({
        runId, attempt, enumeration, normalization, projection,
        outcome: normalization.status === 'complete_with_optional_degradation' ? 'succeeded_with_optional_degradation' : 'succeeded'
      })));
      logger.emit({ level: 'info', event: 'workflow.completed', timestamp: completed.recorded_at, trace_id: run.trace_id, run_id: runId, workflow_instance_id: workflowInstanceId(runId, attempt), outcome: completed.state });
      return Object.freeze({ status: completed.state, publicationId: completed.publication_id });
    }
  });
}
