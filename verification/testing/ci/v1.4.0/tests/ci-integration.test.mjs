import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ORIGINAL_ROOT_TEST_SEQUENCE,
  EXTENDED_ROOT_TEST_SEQUENCE,
  RESEARCH_PROGRAM_SCRIPT,
  auditWorkspaceLock,
  buildTechnicalEvidence,
  validateRootTestSequence,
} from '../tools/ci-inventory.mjs'
import {
  assertCurrentEvidence,
  assertPredecessorPreserved,
  assertPreviousSuccessorPreserved,
  buildDraft,
} from '../tools/validate-package.mjs'

const originalRootScripts = {
  test: ORIGINAL_ROOT_TEST_SEQUENCE.join(' && '),
}
const extendedRootScripts = {
  test: EXTENDED_ROOT_TEST_SEQUENCE.join(' && '),
  'test:research-program': RESEARCH_PROGRAM_SCRIPT,
}

test('v1.4 inventory retains structural discovery and locked workspace invariants', async () => {
  const result = await buildTechnicalEvidence()
  assert.equal(result.package_version, '1.4.0')
  assert.equal(result.package_lock.status, 'PASS')
  assert.ok(result.verification_suites.some((item) => item.path === 'verification/testing/ci/v1.4.0'))
  assert.ok(result.contract_packages.every((item) => item.node_test_file_count > 0))
  assert.ok(result.verification_suites.every((item) => item.node_test_file_count > 0))
  const { readFile } = await import('node:fs/promises')
  const { createHash } = await import('node:crypto')
  const packageBytes = await readFile(new URL('../../../../../package.json', import.meta.url))
  const packageSha256 = createHash('sha256').update(packageBytes).digest('hex')
  const recognized = [
    { sha256: '25874c7d9464210794bd7a1467b117ef5fc71808fdf5e34726ea65181744561c', bytes: 3555, chain: 'original-root-chain', sequence: ORIGINAL_ROOT_TEST_SEQUENCE, declared: false },
    { sha256: 'b6c3469c7b10ecb90114199c18c3ebb293d801b8c8a3521cb25ded2fdba8d05e', bytes: 3666, chain: 'pr003-root-chain', sequence: EXTENDED_ROOT_TEST_SEQUENCE, declared: true },
  ].find((item) => item.sha256 === packageSha256 && item.bytes === packageBytes.length)
  assert.ok(recognized, 'current manifest must be one of the exact reviewed original or PR003 inputs')
  assert.equal(result.root_test_chain, recognized.chain)
  assert.deepEqual(result.root_test_sequence, recognized.sequence)
  assert.deepEqual(result.root_test_research_program, {
    declared: recognized.declared,
    command: recognized.declared ? RESEARCH_PROGRAM_SCRIPT : null,
    stage_count: recognized.declared ? 1 : 0,
  })
  assert.equal(result.external_requests, 0)
  assert.equal(result.external_mutations, 0)
  assert.equal(result.sealed_receipts_mutated, false)
})

test('root chain accepts the exact PR-003 extension and rejects structural drift', () => {
  assert.equal(validateRootTestSequence(originalRootScripts).chain, 'original-root-chain')
  assert.equal(validateRootTestSequence(extendedRootScripts).chain, 'pr003-root-chain')
  assert.deepEqual(validateRootTestSequence(extendedRootScripts).sequence, EXTENDED_ROOT_TEST_SEQUENCE)

  const missingRegistration = { scripts: { test: EXTENDED_ROOT_TEST_SEQUENCE.join(' && ') } }
  assert.throws(() => validateRootTestSequence(missingRegistration), /not registered/)
  const wrongRegistration = { scripts: { ...extendedRootScripts, 'test:research-program': 'node tools/other.mjs' } }
  assert.throws(() => validateRootTestSequence(wrongRegistration), /does not match registration/)
  const reordered = { scripts: { ...extendedRootScripts, test: EXTENDED_ROOT_TEST_SEQUENCE.slice().toSpliced(3, 2, 'npm run test:evaluation', 'npm run test:research-program').join(' && ') } }
  assert.throws(() => validateRootTestSequence(reordered), /immediately follow worker/)
  const duplicatedAggregate = { scripts: { ...originalRootScripts, test: `${originalRootScripts.test} && npm run verify:research-navigator` } }
  assert.throws(() => validateRootTestSequence(duplicatedAggregate), /aggregate exactly once/)
  const duplicatedResearch = { scripts: { ...extendedRootScripts, test: `${extendedRootScripts.test} && npm run test:research-program` } }
  assert.throws(() => validateRootTestSequence(duplicatedResearch), /run exactly once/)
})

test('version and hash drift are refused without editing stored evidence', () => {
  for (const changed of [{ version: '1.0.1', hash: 'a' }, { version: '1.1.0', hash: 'b' }]) {
    assert.throws(() => assertCurrentEvidence(changed, { version: '1.1.0', hash: 'a' }), /CI_SUCCESSOR_EVIDENCE_STALE/)
  }
})

test('missing workspace inventory fails lock consistency', async () => {
  await assert.rejects(auditWorkspaceLock({ workspacePackages: [] }), /workspace links differ|workspace link count/)
})

test('predecessor remains byte-identical and v1.4 evidence stays unapproved', async () => {
  await assertPredecessorPreserved()
  const previous = await assertPreviousSuccessorPreserved()
  assert.equal(previous.package_id, '@ushso/ci-verification-successor-v1-3@1.3.0')
  const draft = await buildDraft()
  assert.equal(draft.package_id, '@ushso/ci-verification-successor-v1-4@1.4.0')
  assert.equal(draft.approval, null)
  assert.equal(draft.status, 'pending_authorized_review')
  assert.equal(draft.release_gate_pass, false)
  assert.equal(draft.production_eligibility, false)
})
