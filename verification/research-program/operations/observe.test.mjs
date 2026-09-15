import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  LAST_GOOD_GENERATION,
  REQUIRED_ELAPSED_DAYS,
  REQUIRED_SCHEDULED_CYCLES,
  observeOperations,
} from './observe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('missing observation time and unrun cycles remain unverified; creating a scheduler is not evidence it ran', () => {
  const obs = observeOperations();
  assert.equal(obs.generation, LAST_GOOD_GENERATION);
  assert.equal(obs.observation.elapsed_observation_days, 0);
  assert.equal(obs.observation.required_elapsed_days, REQUIRED_ELAPSED_DAYS);
  assert.equal(obs.observation.complete_scheduled_cycles, 0);
  assert.equal(obs.observation.required_scheduled_cycles, REQUIRED_SCHEDULED_CYCLES);
  assert.equal(obs.observation.generated_dates, false);
  assert.equal(obs.observation.simulated_operation, false);
  assert.equal(obs.observation.scheduler_created, true);
  assert.equal(obs.observation.scheduler_ran, false);
  assert.equal(obs.observation.scheduler_created_is_not_evidence_it_ran, true);
  assert.equal(obs.observation.missing_observation_time, true);
  assert.equal(obs.observation.result, 'unverified');
  assert.throws(
    () => observeOperations({ observation: { elapsed_observation_days: 0, complete_scheduled_cycles: 0, generated_dates: true, simulated_operation: false, scheduler_created: true, scheduler_ran: false } }),
    { code: 'GENERATED_DATES_OR_SIMULATION_FORBIDDEN' },
  );
});

test('after-refresh recheck keeps R01-R16 unaccepted and does not declare completion', () => {
  const obs = observeOperations();
  assert.equal(obs.requirements.length, 16);
  assert.ok(obs.requirements.every((row) => row.accepted === false && row.closed === false && row.old_passing_receipt_covers_changed_data === false));
  assert.equal(obs.requirements.find((row) => row.id === 'R15').result, 'fail');
  assert.equal(obs.requirements.find((row) => row.id === 'R16').result, 'fail');
  assert.equal(obs.program_complete, false);
  assert.equal(obs.hidden_waived_deficits, false);
  assert.equal(obs.astra_grants_owner_authority, false);
  assert.equal(obs.owner_scientific_decision_recorded, false);
  assert.equal(obs.owner_release_decision_recorded, false);
  assert.equal(obs.c0091, 'unresolved');
  assert.equal(obs.production_changed, false);
  const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'verification/research-program/operations/observation.json'), 'utf8'));
  assert.equal(onDisk.program_complete, false);
  assert.equal(onDisk.observation.elapsed_observation_days, 0);
});

// Counters in these negative tests are synthetic input, not elapsed-time evidence.
test('the zero-observation snapshot rejects unsupported positive counts and malformed values', () => {
  const empty = {elapsed_observation_days: 0, complete_scheduled_cycles: 0,
    generated_dates: false, simulated_operation: false, scheduler_created: true, scheduler_ran: false};
  for (const patch of [{elapsed_observation_days: 14}, {complete_scheduled_cycles: 2}, {scheduler_ran: true}]) {
    assert.throws(() => observeOperations({observation: {...empty, ...patch}}), {code: 'OBSERVATION_RECEIPTS_REQUIRED'});
  }
  for (const value of [undefined, null, -1, NaN, Infinity, '14', 0.5]) {
    assert.throws(() => observeOperations({observation: {...empty, elapsed_observation_days: value}}), {code: 'INVALID_OBSERVATION_COUNT'});
    assert.throws(() => observeOperations({observation: {...empty, complete_scheduled_cycles: value}}), {code: 'INVALID_OBSERVATION_COUNT'});
  }
  assert.throws(() => observeOperations({observation: {...empty, scheduler_ran: 'false'}}), {code: 'INVALID_OBSERVATION_FLAG'});
});
