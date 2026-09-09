import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTechnicalEvidence, auditWorkspaceLock } from '../tools/ci-inventory.mjs'
import { assertCurrentEvidence, assertPredecessorPreserved, assertPreviousSuccessorPreserved, buildDraft } from '../tools/validate-package.mjs'

test('successor inventory retains structural discovery and workspace invariants', async () => {
  const result = await buildTechnicalEvidence()
  assert.equal(result.package_version, '1.3.0')
  assert.equal(result.package_lock.status, 'PASS')
  assert.ok(result.verification_suites.some(item => item.path === 'verification/testing/ci/v1.3.0'))
  assert.ok(result.contract_packages.every(item => item.node_test_file_count > 0))
  assert.ok(result.verification_suites.every(item => item.node_test_file_count > 0))
  assert.equal(result.external_requests, 0)
  assert.equal(result.external_mutations, 0)
  assert.equal(result.sealed_receipts_mutated, false)
})

test('version and hash drift are refused without editing stored evidence', () => {
  for (const changed of [{ version: '1.0.1', hash: 'a' }, { version: '1.1.0', hash: 'b' }]) {
    assert.throws(() => assertCurrentEvidence(changed, { version: '1.1.0', hash: 'a' }), /CI_SUCCESSOR_EVIDENCE_STALE/)
  }
})

test('missing workspace inventory fails lock consistency', async () => {
  await assert.rejects(auditWorkspaceLock({ workspacePackages: [] }), /workspace links differ|workspace link count/)
})

test('predecessor remains byte-identical and new evidence remains unapproved', async () => {
  await assertPredecessorPreserved()
  const previous = await assertPreviousSuccessorPreserved()
  assert.equal(previous.package_id, '@ushso/ci-verification-successor-v1-2@1.2.0')
  const draft = await buildDraft()
  assert.equal(draft.approval, null)
})
