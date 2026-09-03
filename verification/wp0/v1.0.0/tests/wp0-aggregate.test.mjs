import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildAggregateReceipt,
  deriveVerificationStatus,
  validateStoredAggregateReceipt
} from '../tools/validate-wp0-aggregate.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const receiptPath = path.join(packageRoot, 'receipts/wp0-aggregate.json');
const storedReceipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
const aggregate = buildAggregateReceipt();

test('a final receipt is exact; a provisional receipt remains explicitly non-final while prerequisites move', async () => {
  const current = await aggregate;
  if (storedReceipt.provisional === false) {
    const validated = await validateStoredAggregateReceipt();
    assert.deepEqual(validated.receipt, current);
    assert.match(validated.receipt_sha256, /^[a-f0-9]{64}$/u);
    assert.equal(validated.receipt_bytes, (await fs.readFile(receiptPath)).length);
    return;
  }
  assert.equal(storedReceipt.verification_status, 'BLOCKED_STALE_PREREQUISITE');
  assert.equal(current.verification_status, 'BLOCKED_STALE_PREREQUISITE');
  assert.ok(storedReceipt.blockers.some(blocker => blocker.check_id === 'product-boundary-and-non-goals'));
  assert.equal(storedReceipt.retrieval_release_gate_status, 'FAIL_PRE_TUNING');
});

test('artifact integrity and retrieval release quality are never conflated', async () => {
  const receipt = await aggregate;
  const bridge = receipt.checks.find(check => check.check_id === 'evaluator-v2-pre-tuning-bridge');
  assert.equal(bridge.status, 'PASS');
  assert.equal(bridge.evidence.artifact_integrity_status, 'PASS');
  assert.equal(receipt.retrieval_release_gate_status, 'FAIL_PRE_TUNING');
  assert.equal(receipt.retrieval_release_gate_pass, false);
  assert.equal(bridge.evidence.consolidated_v2_algorithm_available, false);
});

test('any stale prerequisite blocks aggregate PASS while expected pre-tuning quality failure does not masquerade as artifact failure', async () => {
  const receipt = await aggregate;
  const allPass = receipt.checks.map(check => ({ ...check, status: 'PASS' }));
  assert.equal(deriveVerificationStatus(allPass), 'PASS');
  const stale = structuredClone(allPass);
  stale[0].status = 'BLOCKED_STALE_RECEIPT';
  assert.equal(deriveVerificationStatus(stale), 'BLOCKED_STALE_PREREQUISITE');
  assert.equal(receipt.verification_status, deriveVerificationStatus(receipt.checks));
  assert.equal(receipt.provisional, receipt.verification_status !== 'PASS');
});

test('the current provisional blocker, when present, is explicit and narrowly identified', async () => {
  const receipt = await aggregate;
  if (receipt.verification_status === 'PASS') {
    assert.deepEqual(receipt.blockers, []);
    assert.equal(receipt.seal_lifecycle.current_phase, 'final_wp14_seal');
    return;
  }
  assert.deepEqual(receipt.blockers.map(blocker => [blocker.check_id, blocker.status]), [
    ['product-boundary-and-non-goals', 'BLOCKED_STALE_RECEIPT']
  ]);
  assert.ok(receipt.blockers[0].errors.length > 0);
  assert.equal(receipt.seal_lifecycle.current_phase, 'provisional_rolling_scope');
  assert.equal(receipt.seal_lifecycle.final_seal_work_package, 'WP14');
  assert.match(receipt.seal_lifecycle.boundary_scope_policy, /never narrowed/u);
});

test('aggregate execution is local, read-only, and outside the analytics product boundary', async () => {
  const receipt = await aggregate;
  assert.deepEqual(receipt.execution_boundary, {
    external_requests: 0,
    deployments: 0,
    remote_writes: 0,
    paid_infrastructure_actions: 0,
    production_mutations: 0,
    source_payloads_accessed: 0,
    analyses_executed: 0,
    ranking_optimization_performed: false,
    identity_merges_performed: 0
  });
});
