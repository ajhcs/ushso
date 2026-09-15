import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  ATTEMPT_AXES,
  LAST_GOOD_GENERATION,
  calculateAttemptLedger,
  calculateObservation,
  ingestEvidence,
  validateReceipt,
} from '../../scripts/research-program/ingest-evidence.mjs';
import { materializeAttemptLedger } from '../../scripts/research-program/materialize-attempt-ledger.mjs';
import { observeOperations } from '../../verification/research-program/operations/observe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHA = "915be2e8ff28a86863cbd6c5cef36b7caf4239ef0e332ae6fe4fd764900c79a2";
const REF = "verification/research-program/evidence/payloads/fixture-validation.txt";
const HEAD = '31631bc18808e67b5f63472585707787a29e933b';

function receipt(kind, payload, extra = {}) {
  return {
    format: 'ushso.evidence-receipt.v1',
    receipt_id: extra.receipt_id ?? `receipt-${kind}`,
    kind,
    generation: LAST_GOOD_GENERATION,
    candidate_head: extra.candidate_head ?? HEAD,
    candidate_tree: extra.candidate_tree ?? '19a87a712a544465bea709e7c7addc18dcd72c39',
    recorded_at: extra.recorded_at ?? '2026-09-15T12:00:00Z',
    evidence_reference: REF,
    evidence_sha256: SHA,
    payload,
  };
}

const fixtureAuth = {
  id: 'AUTH-FIXTURE',
  authorized: true,
  environment: 'fixture',
  candidate_head: HEAD,
};

test('stale, duplicate, mismatched, incomplete, and accepted-flag receipts are rejected', () => {
  const good = receipt('attempt_axis', {
    record_id: 'obs:asset:cdc-socrata:235m-gsry-94053d5d5c02689f',
    axis: 'metadata',
    attempt_state: 'failed',
    eligibility: 'eligible',
    stop_reason: 'fixture stop',
    attempted_at: '2026-09-15T12:00:00Z',
  });
  validateReceipt(good, { repoRoot: ROOT, currentCandidateHead: HEAD });
  assert.throws(() => validateReceipt({ ...good, candidate_head: 'deadbeef' }, { repoRoot: ROOT, currentCandidateHead: HEAD }), { code: 'STALE_CANDIDATE_HEAD' });
  assert.throws(() => validateReceipt({ ...good, evidence_sha256: 'b'.repeat(64) }, { repoRoot: ROOT }), { code: 'EVIDENCE_SHA256_MISMATCH' });
  assert.throws(() => validateReceipt({ ...good, incomplete: true }, { repoRoot: ROOT }), { code: 'INCOMPLETE_RECEIPT' });
  assert.throws(() => validateReceipt({ ...good, accepted: true }, { repoRoot: ROOT }), { code: 'RECEIPT_CANNOT_SET_ACCEPTED' });
  assert.throws(() => validateReceipt({ ...good, scientific_approval: true }, { repoRoot: ROOT }), { code: 'RECEIPT_CANNOT_GRANT_SCIENTIFIC_APPROVAL' });
  const seen = new Set([good.receipt_id]);
  assert.throws(() => validateReceipt(good, { repoRoot: ROOT, seenIds: seen }), { code: 'DUPLICATE_RECEIPT_ID' });
});

test('caller-supplied observation counters remain rejected; empty receipts retain the failed snapshot', () => {
  const empty = { elapsed_observation_days: 14, complete_scheduled_cycles: 2, generated_dates: false, simulated_operation: false, scheduler_created: true, scheduler_ran: true };
  assert.throws(() => observeOperations({ observation: empty }), { code: 'OBSERVATION_RECEIPTS_REQUIRED' });
  const obs = observeOperations();
  assert.equal(obs.observation.elapsed_observation_days, 0);
  assert.equal(obs.observation.complete_scheduled_cycles, 0);
  assert.equal(obs.observation.result, 'unverified');
  assert.equal(obs.requirements.find((row) => row.id === 'R15').result, 'fail');
  assert.equal(obs.requirements.find((row) => row.id === 'R15').accepted, false);
  assert.equal(obs.program_complete, false);
});

test('validated receipts change calculated observation and attempt results without editing accepted', () => {
  const window = receipt('observation_window', {
    environment: 'staging',
    observation_started_at: '2026-09-01T00:00:00Z',
    observation_ended_at: '2026-09-16T00:00:00Z',
    generated_dates: false,
    simulated_operation: false,
    deployment: { deployment_id: 'dep-fixture', version_id: 'ver-fixture' },
    authorization: { id: 'AUTH-03', authorized: true, environment: 'staging', candidate_head: HEAD },
  }, { receipt_id: 'window-1' });
  const cycle = (id) => receipt('scheduled_cycle', {
    cycle_id: id,
    started_at: '2026-09-02T00:00:00Z',
    completed_at: '2026-09-02T06:00:00Z',
    scheduler_run_id: `run-${id}`,
    generated_dates: false,
    simulated_operation: false,
    complete: true,
    after_refresh: { examples_checked: true, schemas_checked: true, joins_checked: true, cross_surface_checked: true },
  }, { receipt_id: `cycle-${id}` });
  const register = { entries: [{ id: 'AUTH-03', authorized: true }] };
  const days = calculateObservation([
    validateReceipt(window, { repoRoot: ROOT, authorizationRegister: register }),
    validateReceipt(cycle('c1'), { repoRoot: ROOT }),
    validateReceipt(cycle('c2'), { repoRoot: ROOT }),
  ]);
  assert.equal(days.elapsed_observation_days, 15);
  assert.equal(days.complete_scheduled_cycles, 2);
  assert.equal(days.technical_success, true);
  assert.equal(days.scientific_approval, false);

  const fixtureWindow = receipt('observation_window', {
    environment: 'fixture',
    observation_started_at: '2026-09-01T00:00:00Z',
    observation_ended_at: '2026-09-16T00:00:00Z',
    generated_dates: false,
    simulated_operation: false,
    deployment: { deployment_id: 'dep-fixture', version_id: 'ver-fixture' },
    authorization: fixtureAuth,
  }, { receipt_id: 'window-fixture' });
  const fixtureDays = calculateObservation([validateReceipt(fixtureWindow, { repoRoot: ROOT })]);
  assert.equal(fixtureDays.elapsed_observation_days, 15);
  assert.equal(fixtureDays.technical_success, false);
  assert.equal(fixtureDays.fixture_observation_cannot_satisfy_r15, true);

  const ids = ['obs:asset:cdc-socrata:235m-gsry-94053d5d5c02689f', 'obs:asset:cdc-socrata:2g2d-yfx9-060a56b0e1f5e82b'];
  const attemptReceipts = [];
  let n = 0;
  for (const recordId of ids) {
    for (const axis of ATTEMPT_AXES) {
      n += 1;
      attemptReceipts.push(validateReceipt(receipt('attempt_axis', {
        record_id: recordId,
        axis,
        attempt_state: 'failed',
        eligibility: 'eligible',
        stop_reason: 'bounded fixture stop',
        attempted_at: '2026-09-15T12:00:00Z',
      }, { receipt_id: `attempt-${n}` }), { repoRoot: ROOT }));
    }
  }
  const ledger = calculateAttemptLedger(attemptReceipts, ids);
  assert.equal(ledger.combinations, 8);
  assert.equal(ledger.combinations_accounted, 8);
  assert.equal(ledger.source_run_dispositions.failed, 8);
  assert.equal(ledger.source_run_dispositions.not_attempted, 0);
  assert.equal(ledger.r03.result, 'unverified');
  assert.equal(ledger.r03.accepted, false);
  assert.equal(ledger.scientific_approval, false);

  const ingested = ingestEvidence({ receipts: attemptReceipts, baselineIds: ids, repoRoot: ROOT });
  assert.equal(ingested.attempts.receipts_applied, 8);
  assert.equal(ingested.accepted_flags_edited, false);
  assert.equal(ingested.scientific_approval, false);
});

test('observeOperations uses ingested observation and still never accepts R15', () => {
  const ingestion = {
    observation: {
      elapsed_observation_days: 15,
      complete_scheduled_cycles: 2,
      required_elapsed_days: 14,
      required_scheduled_cycles: 2,
      generated_dates: false,
      simulated_operation: false,
      scheduler_created: true,
      scheduler_ran: true,
      scheduler_created_is_not_evidence_it_ran: false,
      missing_observation_time: false,
      missing_or_failed_cycle: false,
      technical_success: true,
      deployed_product_observation: true,
      scientific_approval: false,
      result: 'observed',
    },
    accepted_flags_edited: false,
    scientific_approval: false,
  };
  const obs = observeOperations({ ingestion });
  assert.equal(obs.observation.elapsed_observation_days, 15);
  assert.equal(obs.observation.complete_scheduled_cycles, 2);
  assert.equal(obs.observation.technical_success, true);
  assert.equal(obs.observation.scientific_approval, false);
  assert.equal(obs.requirements.find((row) => row.id === 'R15').result, 'observed');
  assert.equal(obs.requirements.find((row) => row.id === 'R15').accepted, false);
  assert.equal(obs.program_complete, false);
});

test('frozen 3434 IDs seed 13736 not_attempted axes without promoting not_attempted to success', () => {
  const { ids, ledger, rows } = materializeAttemptLedger({ repoRoot: ROOT });
  assert.equal(ids.length, 3434);
  assert.equal(rows.length, 13736);
  assert.equal(ledger.combinations, 13736);
  assert.equal(ledger.combinations_accounted, 13736);
  assert.equal(ledger.source_run_dispositions.not_attempted, 13736);
  assert.equal(ledger.source_run_dispositions.succeeded, 0);
  assert.equal(ledger.not_attempted_is_not_success, true);
  assert.equal(ledger.success_total_counts_unattempted_work, false);
  assert.equal(ledger.silent_loss, false);
  assert.equal(ledger.identity_accounted, true);
  assert.equal(ledger.r01.accepted, false);
  assert.equal(ledger.r01.result, 'unverified');
  assert.equal(ledger.r03.accepted, false);
  assert.equal(ledger.r03.result, 'fail');
});
