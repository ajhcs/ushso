import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FinalHoldoutGuardV2,
  InMemoryFinalHoldoutUseLedger,
  PostgresFinalHoldoutUseLedger,
} from '../../../../packages/search/final-holdout-guard-v2.mjs';
import { canonicalSha256 } from '../../../../contracts/tooling/v1.0.0/src/digests.mjs';

const hashes = {
  package: 'a'.repeat(64),
  ranking: 'b'.repeat(64),
  evaluator: 'c'.repeat(64),
  metric: 'd'.repeat(64),
  benchmark: 'e'.repeat(64),
};
const EVALUATOR_ACTOR = 'actor:final-gate-runner';

function authorizationVerification({ packageMetadata, candidate, authorization }) {
  const material = {
    verification_version: 'ushso-final-holdout-authorization-verification.v1',
    verification_kind: 'authorization_and_custody',
    verified: true,
    authorization_id: authorization.authorization_id,
    package_content_digest: structuredClone(packageMetadata.package_content_digest),
    custodian_actor_id: packageMetadata.custodian_actor_id,
    authorized_evaluator_id: authorization.authorized_evaluator_id,
    candidate_id: candidate.candidate_id,
    ranking_fingerprint_sha256: candidate.ranking_fingerprint_sha256,
    evaluator_freeze_receipt_sha256: candidate.evaluator_freeze_receipt_sha256,
    metric_contract_sha256: candidate.metric_contract_sha256,
    benchmark_pin_sha256: candidate.benchmark_pin_sha256,
    authorization_expires_at: authorization.expires_at,
    independent_custody_attested: true,
    never_exposed_attested: true,
    ordinary_test_access_forbidden_attested: true,
    aggregate_only_terminal_contract_attested: true,
  };
  return { ...material, verification_receipt_digest: canonicalSha256(material) };
}

function terminalVerification({ lease, terminalMaterial, evaluatorActorId }) {
  const material = {
    verification_version: 'ushso-final-holdout-terminal-verification.v1',
    verification_kind: 'authenticated_terminal_receipt',
    verified: true,
    lease_digest: structuredClone(lease.lease_digest),
    authenticated_evaluator_id: evaluatorActorId,
    terminal_material_digest: canonicalSha256(terminalMaterial),
    aggregate_only_execution_attested: true,
  };
  return { ...material, verification_receipt_digest: canonicalSha256(material) };
}

function syntheticInputs() {
  return {
    packageMetadata: {
      metadata_version: 'ushso-final-holdout-package-metadata.v1',
      package_id: 'holdout:synthetic-unexposed-v1',
      package_content_digest: { digest_type: 'package_sha256', algorithm: 'sha256', value: hashes.package },
      item_count: 20,
      custodian_actor_id: 'actor:independent-evaluation-owner',
      custodian_independent_from_evaluator: true,
      sealed_at: '2026-09-01T00:00:00Z',
      provenance_ref: 'receipt:synthetic-independent-custody',
      prior_exposure: 'never_published_never_evaluated',
      ordinary_test_access: false,
      aggregate_only_output: true,
      single_use: true,
    },
    candidate: {
      candidate_id: 'candidate:synthetic-ranking-v1',
      ranking_fingerprint_sha256: hashes.ranking,
      ranking_frozen_at: '2026-09-02T00:00:00Z',
      ranking_tuned: true,
      ranking_frozen: true,
      release_candidate: true,
      evaluator_freeze_receipt_sha256: hashes.evaluator,
      metric_contract_sha256: hashes.metric,
      benchmark_pin_sha256: hashes.benchmark,
    },
    authorization: {
      authorization_version: 'ushso-final-holdout-authorization.v1',
      authorization_id: 'authorization:synthetic-final-gate-v1',
      scope: 'final_retrieval_gate_once',
      authorized_by_actor_id: 'actor:independent-evaluation-owner',
      authorized_evaluator_id: 'actor:final-gate-runner',
      package_id: 'holdout:synthetic-unexposed-v1',
      package_content_digest: { digest_type: 'package_sha256', algorithm: 'sha256', value: hashes.package },
      candidate_id: 'candidate:synthetic-ranking-v1',
      ranking_fingerprint_sha256: hashes.ranking,
      evaluator_freeze_receipt_sha256: hashes.evaluator,
      metric_contract_sha256: hashes.metric,
      benchmark_pin_sha256: hashes.benchmark,
      granted_at: '2026-09-03T00:00:00Z',
      expires_at: '2026-09-04T00:00:00Z',
      external_authorized: true,
    },
    observedAt: '2026-09-03T01:00:00Z',
  };
}

function rehearsal() {
  const ledger = new InMemoryFinalHoldoutUseLedger();
  return {
    ledger,
    guard: new FinalHoldoutGuardV2({
      ledger,
      mode: 'offline_rehearsal',
      clock: () => '2026-09-03T01:10:00Z',
    }),
  };
}

test('single-use final-gate lease emits only an aggregate terminal receipt', async () => {
  const { ledger, guard } = rehearsal();
  const lease = await guard.issueSingleUseLease(syntheticInputs());
  assert.equal(lease.item_count, 20);
  assert.equal(lease.package_contents_included, false);
  assert.equal(lease.ordinary_test_access, false);
  assert.equal(JSON.stringify(lease).includes('items'), false);

  const receipt = await guard.recordAggregateResult({
    lease,
    completedAt: '2026-09-03T01:05:00Z',
    aggregateResult: {
      aggregate_result_version: 'ushso-final-holdout-aggregate.v1',
      total_items: 20,
      pass_count: 18,
      fail_count: 2,
      metrics: { top_5_recall: 0.9, ndcg_at_10: 0.87 },
      threshold_status: 'PASS',
      no_per_item_output: true,
    },
    evaluatorActorId: EVALUATOR_ACTOR,
  });
  assert.equal(receipt.aggregate_only_output_contract, true);
  assert.equal(receipt.guard_receipt_contains_per_item_data, false);
  assert.equal(receipt.external_per_item_side_outputs_proven_absent, false);
  assert.equal(receipt.verification_state, 'offline_rehearsal_unverified');
  assert.equal(ledger.snapshot()[0].terminal_receipt.receipt_digest.value, receipt.receipt_digest.value);
  await assert.rejects(() => guard.recordAggregateResult({
    lease,
    completedAt: '2026-09-03T01:06:00Z',
    aggregateResult: receipt.aggregate_result,
    evaluatorActorId: EVALUATOR_ACTOR,
  }), /FINAL_HOLDOUT_TERMINAL_RECEIPT_ALREADY_RECORDED/);
});

test('an exposed or ordinarily accessible package can never receive a lease', async () => {
  for (const mutate of [
    input => { input.packageMetadata.prior_exposure = 'published_or_previously_evaluated'; },
    input => { input.packageMetadata.ordinary_test_access = true; },
    input => { input.packageMetadata.item_count = 19; },
  ]) {
    const inputs = syntheticInputs();
    mutate(inputs);
    const { guard } = rehearsal();
    await assert.rejects(() => guard.issueSingleUseLease(inputs), /FINAL_HOLDOUT_/);
  }
});

test('independent authorization and a tuned, frozen candidate are mandatory', async () => {
  {
    const inputs = syntheticInputs();
    inputs.authorization.authorized_evaluator_id = inputs.authorization.authorized_by_actor_id;
    const { guard } = rehearsal();
    await assert.rejects(() => guard.issueSingleUseLease(inputs), /FINAL_HOLDOUT_AUTHORIZATION_NOT_INDEPENDENT/);
  }
  {
    const inputs = syntheticInputs();
    inputs.candidate.ranking_tuned = false;
    const { guard } = rehearsal();
    await assert.rejects(() => guard.issueSingleUseLease(inputs), /FINAL_HOLDOUT_CANDIDATE_NOT_FROZEN/);
  }
  {
    const inputs = syntheticInputs();
    inputs.authorization.metric_contract_sha256 = 'f'.repeat(64);
    const { guard } = rehearsal();
    await assert.rejects(() => guard.issueSingleUseLease(inputs), /FINAL_HOLDOUT_AUTHORIZATION_CANDIDATE_MISMATCH/);
  }
});

test('lease tampering and per-item output shapes fail closed', async () => {
  const { guard } = rehearsal();
  const lease = await guard.issueSingleUseLease(syntheticInputs());
  await assert.rejects(() => guard.recordAggregateResult({
    lease: { ...lease, candidate_id: 'candidate:tampered' },
    completedAt: '2026-09-03T01:05:00Z',
    aggregateResult: {
      aggregate_result_version: 'ushso-final-holdout-aggregate.v1', total_items: 20,
      pass_count: 20, fail_count: 0, metrics: { top_5_recall: 1 }, threshold_status: 'PASS',
      no_per_item_output: true,
    },
    evaluatorActorId: EVALUATOR_ACTOR,
  }), /FINAL_HOLDOUT_LEASE_DIGEST_MISMATCH/);
  await assert.rejects(() => guard.recordAggregateResult({
    lease,
    completedAt: '2026-09-03T01:05:00Z',
    aggregateResult: {
      aggregate_result_version: 'ushso-final-holdout-aggregate.v1', total_items: 20,
      pass_count: 20, fail_count: 0, metrics: { top_5_recall: 1 }, threshold_status: 'PASS',
      no_per_item_output: true, per_item_results: [],
    },
    evaluatorActorId: EVALUATOR_ACTOR,
  }), /FINAL_HOLDOUT_FIELDS_INVALID/);
  await assert.rejects(() => guard.recordAggregateResult({
    lease,
    completedAt: '2026-09-03T01:05:00Z',
    evaluatorActorId: 'actor:wrong-evaluator',
    aggregateResult: {
      aggregate_result_version: 'ushso-final-holdout-aggregate.v1', total_items: 20,
      pass_count: 20, fail_count: 0, metrics: { top_5_recall: 1 }, threshold_status: 'PASS',
      no_per_item_output: true,
    },
  }), /FINAL_HOLDOUT_EVALUATOR_ACTOR_MISMATCH/);
  await assert.rejects(() => guard.recordTerminalFailure({
    lease,
    failureCode: 'EVALUATOR_PROCESS_FAILED',
    completedAt: '2026-09-03T01:05:00Z',
    evaluatorActorId: 'actor:wrong-evaluator',
  }), /FINAL_HOLDOUT_EVALUATOR_ACTOR_MISMATCH/);
  await assert.rejects(() => guard.recordAggregateResult({
    lease,
    completedAt: '2026-09-04T00:00:00Z',
    evaluatorActorId: EVALUATOR_ACTOR,
    aggregateResult: {
      aggregate_result_version: 'ushso-final-holdout-aggregate.v1', total_items: 20,
      pass_count: 20, fail_count: 0, metrics: { top_5_recall: 1 }, threshold_status: 'PASS',
      no_per_item_output: true,
    },
  }), /FINAL_HOLDOUT_LEASE_INVALID/);

  const expiredClockLedger = new InMemoryFinalHoldoutUseLedger();
  const expiredClockGuard = new FinalHoldoutGuardV2({
    ledger: expiredClockLedger,
    mode: 'offline_rehearsal',
    clock: () => '2026-09-04T00:00:01Z',
  });
  const backdatedLease = await expiredClockGuard.issueSingleUseLease(syntheticInputs());
  await assert.rejects(() => expiredClockGuard.recordTerminalFailure({
    lease: backdatedLease,
    failureCode: 'BACKDATED_AFTER_EXPIRY',
    completedAt: '2026-09-03T01:05:00Z',
    evaluatorActorId: EVALUATOR_ACTOR,
  }), /FINAL_HOLDOUT_LEASE_INVALID/);
});

test('failed execution still consumes the package and production refuses an in-memory ledger', async () => {
  const { ledger, guard } = rehearsal();
  const inputs = syntheticInputs();
  const lease = await guard.issueSingleUseLease(inputs);
  const failure = await guard.recordTerminalFailure({ lease, failureCode: 'EVALUATOR_PROCESS_FAILED', completedAt: '2026-09-03T01:05:00Z', evaluatorActorId: EVALUATOR_ACTOR });
  assert.equal(failure.aggregate_result.threshold_status, 'ERROR');
  await assert.rejects(() => guard.issueSingleUseLease(inputs), /FINAL_HOLDOUT_ALREADY_CONSUMED/);
  assert.throws(
    () => new FinalHoldoutGuardV2({ ledger: new InMemoryFinalHoldoutUseLedger(), mode: 'production' }),
    /FINAL_HOLDOUT_DURABLE_LEDGER_REQUIRED/,
  );
  assert.equal(ledger.snapshot().length, 1);
});

test('production guard uses atomic PostgreSQL lease and terminal-receipt functions', async () => {
  const calls = [];
  const ledger = new PostgresFinalHoldoutUseLedger({
    query: async request => {
      calls.push(request);
      if (request.name === 'ushso_consume_final_holdout_lease_v1') {
        const consumedLease = JSON.parse(request.values[0]);
        return { rows: [{
          accepted: true,
          package_content_sha256: consumedLease.package_content_digest.value,
          lease_sha256: consumedLease.lease_digest.value,
        }] };
      }
      const terminalReceipt = JSON.parse(request.values[2]);
      return { rows: [{
        accepted: true,
        package_content_sha256: request.values[0],
        lease_sha256: request.values[1],
        terminal_receipt_sha256: terminalReceipt.receipt_digest.value,
      }] };
    },
  });
  assert.throws(
    () => new FinalHoldoutGuardV2({ ledger, mode: 'production' }),
    /FINAL_HOLDOUT_AUTHORIZATION_VERIFIER_REQUIRED/,
  );
  const guard = new FinalHoldoutGuardV2({
    ledger,
    mode: 'production',
    verifyAuthorizationAndCustody: async input => authorizationVerification(input),
    verifyTerminalExecution: async input => terminalVerification(input),
    clock: () => '2026-09-03T01:05:00Z',
  });
  const lease = await guard.issueSingleUseLease(syntheticInputs());
  const receipt = await guard.recordTerminalFailure({
    lease,
    failureCode: 'AUTHORIZED_RUN_FAILED',
    completedAt: '2026-09-03T01:05:00Z',
    evaluatorActorId: EVALUATOR_ACTOR,
  });
  assert.equal(receipt.verification_state, 'verified_production_receipts');
  assert.equal(receipt.authorization_verification_receipt_digest.digest_type, 'canonical_json_sha256');
  assert.equal(receipt.terminal_verification_receipt_digest.digest_type, 'canonical_json_sha256');
  assert.deepEqual(calls.map(call => call.name), [
    'ushso_consume_final_holdout_lease_v1',
    'ushso_complete_final_holdout_lease_v1',
  ]);
  assert.match(calls[0].text, /consume_final_holdout_lease/);
  assert.match(calls[1].text, /complete_final_holdout_lease/);
  assert.equal(calls[0].values.length, 1);
  assert.equal(calls[1].values.length, 3);

  const acceptedConsume = {
    accepted: true,
    package_content_sha256: lease.package_content_digest.value,
    lease_sha256: lease.lease_digest.value,
  };
  const acceptedComplete = {
    ...acceptedConsume,
    terminal_receipt_sha256: receipt.receipt_digest.value,
  };
  for (const rows of [
    [],
    [{ ...acceptedConsume, accepted: false }],
    [{ ...acceptedConsume, package_content_sha256: 'f'.repeat(64) }],
    [acceptedConsume, acceptedConsume],
  ]) {
    const invalidLedger = new PostgresFinalHoldoutUseLedger({ query: async () => ({ rows }) });
    await assert.rejects(
      () => invalidLedger.consume(lease),
      /FINAL_HOLDOUT_POSTGRES_ACCEPTANCE_INVALID/,
    );
  }
  for (const rows of [
    [],
    [{ ...acceptedComplete, accepted: false }],
    [{ ...acceptedComplete, terminal_receipt_sha256: 'f'.repeat(64) }],
    [acceptedComplete, acceptedComplete],
  ]) {
    const invalidLedger = new PostgresFinalHoldoutUseLedger({ query: async () => ({ rows }) });
    await assert.rejects(
      () => invalidLedger.complete(
        lease.package_content_digest.value,
        lease.lease_digest.value,
        receipt,
      ),
      /FINAL_HOLDOUT_POSTGRES_ACCEPTANCE_INVALID/,
    );
  }

  const forgedGuard = new FinalHoldoutGuardV2({
    ledger: new PostgresFinalHoldoutUseLedger({ query: async request => {
      const candidateLease = JSON.parse(request.values[0]);
      return { rows: [{
        accepted: true,
        package_content_sha256: candidateLease.package_content_digest.value,
        lease_sha256: candidateLease.lease_digest.value,
      }] };
    } }),
    mode: 'production',
    verifyAuthorizationAndCustody: async input => {
      const forged = authorizationVerification(input);
      forged.metric_contract_sha256 = 'f'.repeat(64);
      return forged;
    },
    verifyTerminalExecution: async input => terminalVerification(input),
    clock: () => '2026-09-03T01:05:00Z',
  });
  await assert.rejects(
    () => forgedGuard.issueSingleUseLease(syntheticInputs()),
    /FINAL_HOLDOUT_AUTHORIZATION_VERIFICATION_DIGEST_MISMATCH/,
  );
});
