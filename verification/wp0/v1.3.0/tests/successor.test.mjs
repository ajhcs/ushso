import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildTechnicalEvidence, validateHistoricalLanes, validatePreviousSuccessor, historicalMapping, packageId } from '../tools/verify.mjs';
import { createDraft, issueApprovedReceipt, validateApproval, approvalStatement, sha256, runSuccessorCli } from '../../../successor-support.mjs';

test('all original historical checks and current production checks pass without approval', async () => {
  const result = await buildTechnicalEvidence();
  assert.equal(result.status, 'PASS');
  assert.equal(result.historical.production.records, 157);
  assert.equal(result.historical.historical_evaluation.records, 143);
  assert.equal(result.active.corpus.record_count, 3434);
  assert.equal(result.active.searchable_records, 3430);
  assert.equal(result.unaffected_prerequisites.length, 8);
  assert.equal(result.previous_successor_receipt.package_id, '@ushso/wp0-verification-v1.2.0@1.2.0');
  assert.equal((await validatePreviousSuccessor()).status, 'approved_scoped_attestation');
  assert.ok(result.product_boundary.test_summary.tests > 0);
  for (const required of ['verification/wp0/v1.0.0/tools/validate-production-baseline.mjs', 'verification/wp8/v1.2.0/tools/development-validation.mjs', 'evaluation/harness/v2.1.0/tools/normalized-dcg.mjs', 'tests/product-boundary.test.mjs']) {
    assert.ok(result.implementation_files.some(file => file.path === required), `unsealed verification dependency ${required}`);
  }
  const draft = createDraft(packageId, result);
  assert.equal(draft.status, 'pending_authorized_review');
  assert.equal(draft.approval, null);
  assert.equal(draft.release_gate_pass, false);
  assert.throws(() => issueApprovedReceipt(draft, null, null), /SUCCESSOR_APPROVAL_PENDING/);
});
test('CLI rejects ambiguous flags and never issues a receipt for missing or explicit pending approval', async () => {
  const scratch = await fs.mkdtemp('/mnt/d/tmp/plumbob/ushso-successor-cli-test-');
  const oldExitCode = process.exitCode;
  const options = { packageId: 'unit-fixture-only', packageRoot: scratch, buildTechnicalEvidence: async () => ({ status: 'PASS', fixture: true }) };
  try {
    for (const args of [['--validate', '--output', 'ignored'], ['--draft', '--output', 'a', '--output', 'b'], ['--validate', '--approval', 'a', '--approval', 'b'], ['--draft', '--validate']]) {
      await assert.rejects(runSuccessorCli({ ...options, args }), /SUCCESSOR_(?:OUTPUT_ONLY|DUPLICATE_ARGUMENT|EXACTLY_ONE_MODE)/);
    }
    await runSuccessorCli({ ...options, args: ['--issue'] });
    assert.equal(process.exitCode, 2);
    await fs.mkdir(path.join(scratch, 'approvals'));
    await fs.writeFile(path.join(scratch, 'approvals/approval.json'), JSON.stringify({ status: 'pending_authorized_review' }));
    process.exitCode = oldExitCode;
    await runSuccessorCli({ ...options, args: ['--validate'] });
    assert.equal(process.exitCode, 2);
    await assert.rejects(fs.access(path.join(scratch, 'receipts/approved.json')), { code: 'ENOENT' });
  } finally {
    process.exitCode = oldExitCode;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
test('historical path remapping cannot substitute current algorithms', async () => {
  await assert.rejects(validateHistoricalLanes({ mapping: { ...historicalMapping, 'packages/retrieval/tools/query-schema.mjs': 'packages/retrieval/tools/query-schema.mjs' } }), /WP0_HISTORICAL_MAPPING_CHANGED/);
});
for (const id of [packageId, '@ushso/wp11-verification-v1.2.0@1.2.0', '@ushso/ci-verification-successor-v1-2@1.2.0']) {
  test(`${id}: shared approval boundary refuses missing, stale, wrong-scope and tampered evidence`, () => {
    const draft = createDraft(id, { status: 'PASS', fixture: 'unit-test-only; no real authority' });
    const reviewerId = 'codex:01a07447-eb7a-7b01-9e2e-aec860f57763';
    const evidence = Buffer.from(`TEST FIXTURE ONLY: ${reviewerId}\n${approvalStatement(draft)}`);
    const approval = { schema_version: 'ushso-successor-approval.v1.0.0', status: 'approved', package_id: id,
      subject_sha256: draft.subject_sha256, reviewer: { id: reviewerId, role: 'authorized_release_reviewer' },
      recorded_at: '2026-09-06T00:00:00Z', evidence_sha256: sha256(evidence), attestation: approvalStatement(draft) };
    assert.equal(validateApproval(draft, approval, evidence), true);
    const scoped = issueApprovedReceipt(draft, approval, evidence);
    assert.equal(scoped.release_gate_pass, false);
    assert.equal(scoped.production_eligibility, false);
    assert.throws(() => validateApproval(draft, null, evidence), /APPROVAL_PENDING/);
    assert.throws(() => validateApproval(draft, { ...approval, subject_sha256: '0'.repeat(64) }, evidence), /STALE_SUBJECT/);
    assert.throws(() => validateApproval(draft, { ...approval, package_id: 'different' }, evidence), /WRONG_PACKAGE/);
    assert.throws(() => validateApproval(draft, { ...approval, reviewer: { id: '', role: 'unauthorized' } }, evidence), /REVIEWER_REQUIRED/);
    assert.throws(() => validateApproval(draft, { ...approval, attestation: 'approve everything' }, evidence), /APPROVAL_SCOPE/);
    assert.throws(() => validateApproval(draft, approval, Buffer.from('changed')), /EVIDENCE_HASH/);
    assert.throws(() => validateApproval({ ...draft, release_gate_pass: true }, approval, evidence), /DRAFT_TAMPERED/);
    assert.throws(() => createDraft(id, { status: 'FAIL' }), /TECHNICAL_CHECKS_NOT_PASS/);
  });
}
