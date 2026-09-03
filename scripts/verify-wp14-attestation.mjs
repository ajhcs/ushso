#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildImplementationManifest } from '../verification/wp14/v1.0.0/src/package-integrity.mjs'
import { loadPolicy } from '../verification/wp14/v1.0.0/src/rehearsal.mjs'
import { validateCandidate } from '../verification/wp14/v1.0.0/src/release-state-machine.mjs'
import {
  canonicalJson,
  readJson,
  repoPath,
  verifyCanonicalDigest,
} from '../verification/wp14/v1.0.0/src/common.mjs'
import {
  SUCCESSOR_POLICY_PATH,
  verifySuccessorAttestation,
} from '../verification/wp14/v1.1.0/src/successor-attestation.mjs'

export const WP14_ATTESTED_COMMIT = 'f6edbb0b31530cdcf3391e8bddf85015d5d30265'
export const WP14_ATTESTED_TREE = '956320f2ce36a195250b55d627c174a3c2a2eefc'

function resolveCurrentHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoPath(''),
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`cannot resolve current Git HEAD: ${(result.stderr || '').trim()}`)
  return result.stdout.trim()
}

function check(checks, id, condition, details = null) {
  checks.push({ id, status: condition ? 'pass' : 'fail', details })
}

export function verifyLegacyWp14Attestation() {
  const checks = []
  const failures = []
  const currentHead = resolveCurrentHead()
  const pin = readJson(repoPath('verification/wp14/v1.0.0/policy/repository-base-pin.v1.0.0.json'))
  const candidate = readJson(repoPath('verification/wp14/v1.0.0/receipts/candidate-envelope.json'))
  const rehearsal = readJson(repoPath('verification/wp14/v1.0.0/receipts/zero-traffic-dry-run.json'))
  const manifest = readJson(repoPath('verification/wp14/v1.0.0/receipts/implementation-file-manifest.json'))
  const verification = readJson(repoPath('verification/wp14/v1.0.0/receipts/wp14-verification.json'))

  const record = (id, condition, details = null) => {
    check(checks, id, condition, details)
    if (!condition) failures.push({ id, details })
  }

  record('attestation-pin-commit', pin.head_commit === WP14_ATTESTED_COMMIT, { expected: WP14_ATTESTED_COMMIT, actual: pin.head_commit })
  record('attestation-pin-tree', pin.head_tree_oid === WP14_ATTESTED_TREE, { expected: WP14_ATTESTED_TREE, actual: pin.head_tree_oid })
  record('candidate-attests-implementation', candidate.git?.head_commit === WP14_ATTESTED_COMMIT, { expected: WP14_ATTESTED_COMMIT, actual: candidate.git?.head_commit })
  record('candidate-attests-base-tree', candidate.git?.head_tree_oid === WP14_ATTESTED_TREE, { expected: WP14_ATTESTED_TREE, actual: candidate.git?.head_tree_oid })
  record('rehearsal-attests-implementation', rehearsal.git_head_commit === WP14_ATTESTED_COMMIT, { expected: WP14_ATTESTED_COMMIT, actual: rehearsal.git_head_commit })
  record('verification-attests-implementation', verification.exact_candidate?.git_head_commit === WP14_ATTESTED_COMMIT, { expected: WP14_ATTESTED_COMMIT, actual: verification.exact_candidate?.git_head_commit })
  record('attestation-is-not-production-claim', candidate.production_eligibility === false && verification.exact_candidate?.production_eligibility === false)
  record('attestation-release-gate-unresolved', candidate.release_gate?.receipt_sha256 === null && verification.release_gate?.exact_candidate_run_performed === false)
  record('candidate-envelope-digest', verifyCanonicalDigest(candidate, 'candidate_digest_sha256').ok, verifyCanonicalDigest(candidate, 'candidate_digest_sha256'))
  record('rehearsal-digest', verifyCanonicalDigest(rehearsal, 'receipt_sha256').ok, verifyCanonicalDigest(rehearsal, 'receipt_sha256'))
  record('implementation-manifest-digest', verifyCanonicalDigest(manifest, 'manifest_sha256').ok, verifyCanonicalDigest(manifest, 'manifest_sha256'))
  record('verification-receipt-digest', verifyCanonicalDigest(verification, 'receipt_sha256').ok, verifyCanonicalDigest(verification, 'receipt_sha256'))
  record('cross-receipt-candidate-binding', rehearsal.candidate_digest_sha256 === candidate.candidate_digest_sha256 && verification.exact_candidate?.candidate_digest_sha256 === candidate.candidate_digest_sha256)
  record('candidate-contract', validateCandidate(candidate, loadPolicy()) === true)

  let currentManifest
  try {
    currentManifest = buildImplementationManifest()
    record('implementation-files-unchanged-since-attestation', canonicalJson(currentManifest) === canonicalJson(manifest))
  } catch (error) {
    record('implementation-files-unchanged-since-attestation', false, error.message)
  }

  return {
    schema_version: 'ushso-wp14-attestation-verification.v1.0.0',
    status: failures.length === 0 ? 'PASS_ATTESTATION_BOUND_TO_F6EDBB0' : 'FAIL',
    attested_commit: WP14_ATTESTED_COMMIT,
    attested_tree: WP14_ATTESTED_TREE,
    current_checkout_commit: currentHead,
    moving_checkout: currentHead !== WP14_ATTESTED_COMMIT,
    check_count: checks.length,
    passed: checks.filter((item) => item.status === 'pass').length,
    failed: failures.length,
    checks,
    failures,
  }
}

export function verifyWp14Attestation() {
  if (existsSync(repoPath(SUCCESSOR_POLICY_PATH))) return verifySuccessorAttestation()
  return verifyLegacyWp14Attestation()
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = verifyWp14Attestation()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (result.failed > 0) process.exitCode = 1
  } catch (error) {
    process.stderr.write(`WP14 attestation verification failed closed: ${error.message}\n`)
    process.exitCode = 1
  }
}
