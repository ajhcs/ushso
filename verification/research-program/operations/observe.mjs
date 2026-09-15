#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestEvidence, REQUIRED_ELAPSED_DAYS, REQUIRED_SCHEDULED_CYCLES } from '../../../scripts/research-program/ingest-evidence.mjs';

export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export { REQUIRED_ELAPSED_DAYS, REQUIRED_SCHEDULED_CYCLES };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function freeze(value) {
  return Object.freeze(value);
}

function loadJson(relative) {
  return JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8'));
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

export function observeOperations({
  index = loadJson('verification/research-program/acceptance/index.json'),
  qualification = loadJson('verification/research-program/release/qualification.json'),
  deployment = loadJson('verification/research-program/release/deployment.json'),
  observation = undefined,
  ingestion = ingestEvidence(),
} = {}) {
  if (index.generation !== LAST_GOOD_GENERATION) fail('LAST_GOOD_GENERATION_CHANGED');
  if (observation !== undefined) {
    if (observation.generated_dates === true || observation.simulated_operation === true) fail('GENERATED_DATES_OR_SIMULATION_FORBIDDEN');
    for (const key of ['elapsed_observation_days', 'complete_scheduled_cycles']) {
      if (!Number.isSafeInteger(observation[key]) || observation[key] < 0) fail('INVALID_OBSERVATION_COUNT', key);
    }
    for (const key of ['generated_dates', 'simulated_operation', 'scheduler_created', 'scheduler_ran']) {
      if (typeof observation[key] !== 'boolean') fail('INVALID_OBSERVATION_FLAG', key);
    }
    fail('OBSERVATION_RECEIPTS_REQUIRED', 'Caller-supplied counters cannot attest elapsed days or cycles. Use validated receipts.');
  }
  const calculated = ingestion.observation;

  const requirements = (index.requirements ?? []).map((row) => {
    let result = row.result;
    let remaining = row.remaining_limitation;
    if (row.id === 'R15') {
      result = calculated.technical_success && calculated.deployed_product_observation ? 'observed' : 'fail';
      remaining = calculated.technical_success && calculated.deployed_product_observation
        ? 'Technical observation thresholds were calculated from validated receipts. Scientific approval and R15 acceptance remain separate.'
        : 'Two authorized scheduled cycles and 14 elapsed observation days remain absent, or observation was not on a reviewed deployed product. Creating a scheduled automation is not evidence that it ran. Generated dates do not count.';
    }
    if (row.id === 'R16') {
      result = qualification.r16?.result === 'fail' ? 'fail' : row.result;
      remaining = 'PR-082 rejected independent exact release qualification. PR-083 did not deploy. Production truth does not match an independently qualified artifact.';
    }
    return freeze({
      id: row.id,
      accepted: false,
      result,
      closed: false,
      reopened_by_refresh_recheck: row.result === 'fail' || result === 'fail' || result === 'unverified',
      old_passing_receipt_covers_changed_data: false,
      remaining_limitation: remaining,
      missing_witness_keeps_open: true,
    });
  });
  if (requirements.length !== 16) fail('REQUIREMENT_COUNT_NOT_16');
  if (requirements.some((row) => row.accepted === true || row.closed === true)) fail('REQUIREMENT_ACCEPTED_OR_CLOSED');
  if (requirements.every((row) => row.result === 'pass')) fail('HIDDEN_WAIVED_DEFICITS');

  return freeze({
    format: 'ushso.pr084-operations-observation.v1',
    generation: LAST_GOOD_GENERATION,
    observation: freeze({
      elapsed_observation_days: calculated.elapsed_observation_days,
      required_elapsed_days: REQUIRED_ELAPSED_DAYS,
      complete_scheduled_cycles: calculated.complete_scheduled_cycles,
      required_scheduled_cycles: REQUIRED_SCHEDULED_CYCLES,
      generated_dates: false,
      simulated_operation: false,
      scheduler_created: calculated.scheduler_created === true,
      scheduler_ran: calculated.scheduler_ran === true,
      scheduler_created_is_not_evidence_it_ran: calculated.scheduler_created_is_not_evidence_it_ran,
      missing_observation_time: calculated.missing_observation_time,
      missing_or_failed_cycle: calculated.missing_or_failed_cycle,
      technical_success: calculated.technical_success,
      scientific_approval: false,
      result: calculated.result,
    }),
    after_refresh_recheck: freeze({
      real_publication_updates_observed: false,
      silent_data_loss_checked_after_real_refresh: false,
      actual_budget_confirmed: false,
      actual_retention_behavior_confirmed: false,
      old_passing_receipt_cannot_cover_changed_data: true,
      note: 'No authorized scheduled refresh ran. The acceptance vector is rechecked against current frozen identities, not against invented refresh.',
    }),
    requirements,
    program_complete: false,
    hidden_waived_deficits: false,
    owner_scientific_decision_recorded: false,
    owner_release_decision_recorded: false,
    astra_grants_owner_authority: false,
    named_ongoing_responsibilities: freeze([
      'Keep R01-R16 unaccepted until current passing witnesses exist.',
      'Do not enable scheduler/harvest composition without authorization.',
      'Keep C-009-1 unresolved without actual account terms.',
      'Keep AUTH-05/07 unauthorized until explicitly requested and granted.',
    ]),
    production_changed: deployment.production?.changed === true,
    c0091: 'unresolved',
    http_200_is_completed_research_task: false,
    passing_schema_is_scientific_approval: false,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(observeOperations(), null, 2)}\n`);
}
