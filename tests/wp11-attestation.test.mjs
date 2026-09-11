import assert from 'node:assert/strict'
import { execFile as execFileCallback, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { verificationTempRoot } from '../scripts/verification-temp-root.mjs'
import {
  assertSuccessfulChildExecution,
  discoverVerificationSuites,
  parseNodeTestCount,
  runPackageSuites,
  usesReviewedWp11CurrentAttestation,
} from '../scripts/run-contract-suites.mjs'
import {
  HISTORICAL_WP11_V1_3,
  ORIGINAL_PR085_PACKAGE_SNAPSHOT,
  REVIEWED_PR003_PACKAGE_SNAPSHOT,
  REVIEWED_WP11_ROUTE,
  WP11_PACKAGE_ID,
  WP11_WRAPPER_PACKAGE_ID,
  buildCurrentWp11Draft,
  repoRoot,
  validateHistoricalWp11Proof,
  verifyWp11Attestation,
} from '../scripts/verify-wp11-attestation.mjs'
import { sha256 } from '../verification/successor-support.mjs'
import { packageId } from '../verification/wp11/v1.3.0/tools/verify.mjs'
const execFile = promisify(execFileCallback)

async function historicalBytes() {
  const names = HISTORICAL_WP11_V1_3.files
  return {
    approvalBytes: await readFile(names.approval.path),
    evidenceBytes: await readFile(names.evidence.path),
    receiptBytes: await readFile(names.receipt.path),
    predecessorManifestBytes: await readFile(HISTORICAL_WP11_V1_3.predecessor_manifest.path),
    predecessorReceiptBytes: await readFile(HISTORICAL_WP11_V1_3.predecessor_receipt.path),
    previousSuccessorBytes: await readFile(HISTORICAL_WP11_V1_3.previous_successor.path),
  }
}

async function readGitBytes(commit, relativePath) {
  const { stdout } = await execFile('git', ['show', `${commit}:${relativePath}`], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 2_000_000,
  })
  return stdout
}

async function hashPinned(relativePath) {
  const bytes = await readFile(path.resolve(repoRoot, relativePath))
  return { bytes: bytes.length, sha256: sha256(bytes) }
}

test('current WP11 verifier keeps historical proof, technical draft and wrapper subject separate', async () => {
  const result = await verifyWp11Attestation()
  assert.equal(result.status, 'PASS')
  assert.equal(result.package_id, WP11_PACKAGE_ID)
  assert.equal(result.wrapper_package_id, WP11_WRAPPER_PACKAGE_ID)
  assert.equal(result.historical.package_id, HISTORICAL_WP11_V1_3.package_id)
  assert.equal(result.historical.subject_sha256, HISTORICAL_WP11_V1_3.subject_sha256)
  assert.equal(result.current.package_id, WP11_PACKAGE_ID)
  assert.equal(result.current.subject_kind, 'wp11-technical-draft')
  assert.equal(result.current.status, 'pending_authorized_review')
  assert.equal(result.current.approval, null)
  assert.equal(result.current.release_gate_pass, false)
  assert.equal(result.current.release_ready, false)
  assert.equal(result.current.production_eligibility, false)
  assert.equal(result.current.planner_runtime_status, 'disabled')
  assert.notEqual(result.current.subject_sha256, result.historical.subject_sha256)
  assert.equal(result.wrapper.package_id, WP11_WRAPPER_PACKAGE_ID)
  assert.equal(result.wrapper.subject_kind, 'wp11-current-attestation-adapter')
  assert.equal(result.wrapper.status, 'pending_authorized_review')
  assert.equal(result.wrapper.approval, null)
  assert.notEqual(result.wrapper.subject_sha256, result.historical.subject_sha256)
  assert.notEqual(result.wrapper.subject_sha256, result.current.subject_sha256)
  assert.equal(result.boundaries.historical_approval_reused, false)
  assert.equal(result.boundaries.historical_approval_applied_to_current_technical_subject, false)
  assert.equal(result.boundaries.historical_approval_applied_to_wrapper_subject, false)
  assert.equal(result.boundaries.current_approval_issued, false)
  assert.equal(result.boundaries.writes_approval_artifacts, false)
  const actualPackage = await hashPinned('package.json')
  const reviewedTransition = actualPackage.sha256 === REVIEWED_PR003_PACKAGE_SNAPSHOT.sha256
  const expectedPackage = reviewedTransition ? REVIEWED_PR003_PACKAGE_SNAPSHOT : ORIGINAL_PR085_PACKAGE_SNAPSHOT
  assert.deepEqual(actualPackage, { bytes: expectedPackage.bytes, sha256: expectedPackage.sha256 })
  const provenance = result.historical.input_bindings.package_provenance
  assert.equal(provenance.state, reviewedTransition ? 'reviewed_pr003_current' : 'original_pr085_git_snapshot')
  assert.equal(provenance.location, 'external')
  assert.equal(provenance.git_commit, expectedPackage.git_commit)
  assert.equal(provenance.git_path, expectedPackage.git_path)
  assert.equal(provenance.sha256, actualPackage.sha256)
  assert.equal(provenance.bytes, actualPackage.bytes)
  assert.equal(result.historical.input_bindings.lock_state, 'pr085_ci_v14')
  assert.equal(provenance.reviewed_pr003_transition, reviewedTransition)
  if (reviewedTransition) assert.deepEqual(provenance.original_pr085_snapshot, ORIGINAL_PR085_PACKAGE_SNAPSHOT)
})

test('historical WP11 proof fails closed for missing and altered immutable bytes', async () => {
  const fixture = await historicalBytes()
  await validateHistoricalWp11Proof(fixture)
  const labels = {
    approval: 'APPROVAL',
    evidence: 'EVIDENCE',
    receipt: 'RECEIPT',
    predecessorManifest: 'PREDECESSOR_MANIFEST',
    predecessorReceipt: 'PREDECESSOR_RECEIPT',
    previousSuccessor: 'PREVIOUS_SUCCESSOR',
  }
  for (const name of Object.keys(labels)) {
    const missing = { ...fixture, [name + 'Bytes']: null }
    await assert.rejects(validateHistoricalWp11Proof(missing), new RegExp(`WP11_HISTORICAL_MISSING_${labels[name]}`))
    const altered = { ...fixture, [name + 'Bytes']: Buffer.concat([fixture[name + 'Bytes'], Buffer.from('tamper')]) }
    await assert.rejects(validateHistoricalWp11Proof(altered), new RegExp(`WP11_HISTORICAL_${labels[name]}_CHANGED`))
  }
})

test('package provenance keeps the original PR085 Git snapshot and names the PR003 transition separately', async () => {
  const fixture = await historicalBytes()
  const originalBytes = await readGitBytes(ORIGINAL_PR085_PACKAGE_SNAPSHOT.git_commit, ORIGINAL_PR085_PACKAGE_SNAPSHOT.git_path)
  assert.equal(originalBytes.length, ORIGINAL_PR085_PACKAGE_SNAPSHOT.bytes)
  assert.equal(sha256(originalBytes), ORIGINAL_PR085_PACKAGE_SNAPSHOT.sha256)

  const readOriginalPackage = async (root, relativePath) => relativePath === 'package.json'
    ? originalBytes
    : readFile(path.resolve(root, relativePath))
  const legacy = await validateHistoricalWp11Proof({ ...fixture, readCurrentFile: readOriginalPackage })
  assert.equal(legacy.input_bindings.package_provenance.state, 'original_pr085_git_snapshot')
  assert.equal(legacy.input_bindings.package_provenance.git_commit, ORIGINAL_PR085_PACKAGE_SNAPSHOT.git_commit)

  const reviewedBytes = await readGitBytes(REVIEWED_PR003_PACKAGE_SNAPSHOT.git_commit, REVIEWED_PR003_PACKAGE_SNAPSHOT.git_path)
  assert.equal(reviewedBytes.length, REVIEWED_PR003_PACKAGE_SNAPSHOT.bytes)
  assert.equal(sha256(reviewedBytes), REVIEWED_PR003_PACKAGE_SNAPSHOT.sha256)
  const readReviewedPackage = async (root, relativePath) => relativePath === 'package.json'
    ? reviewedBytes
    : readFile(path.resolve(root, relativePath))
  const transition = await validateHistoricalWp11Proof({ ...fixture, readCurrentFile: readReviewedPackage })
  assert.equal(transition.input_bindings.package_provenance.state, 'reviewed_pr003_current')
  assert.equal(transition.input_bindings.package_provenance.git_commit, REVIEWED_PR003_PACKAGE_SNAPSHOT.git_commit)
  assert.equal(transition.input_bindings.package_provenance.original_pr085_snapshot.sha256, ORIGINAL_PR085_PACKAGE_SNAPSHOT.sha256)
  assert.equal(transition.input_bindings.package_provenance.reviewed_pr003_transition, true)
  assert.equal(transition.input_bindings.drifted.some((item) => item.path === 'package.json' && item.reason === 'reviewed_pr003_package_transition'), true)

  const tampered = Buffer.from(reviewedBytes)
  tampered[tampered.length - 1] ^= 1
  const readTampered = async (root, relativePath) => relativePath === 'package.json'
    ? tampered
    : readFile(path.resolve(root, relativePath))
  await assert.rejects(
    validateHistoricalWp11Proof({ ...fixture, readCurrentFile: readTampered }),
    /WP11_CURRENT_PACKAGE_UNREVIEWED_DRIFT/u,
  )
})

test('current technical failure and approval overclaim cannot be represented as a pending draft', async () => {
  await assert.rejects(
    buildCurrentWp11Draft({
      technicalEvidenceBuilder: async () => ({ status: 'FAIL', implementation_files: [] }),
      validateCurrent: null,
    }),
    /SUCCESSOR_TECHNICAL_CHECKS_NOT_PASS/,
  )
  await assert.rejects(
    buildCurrentWp11Draft({
      technicalEvidenceBuilder: async () => ({
        status: 'PASS',
        schema_version: 'ushso-wp11-technical-evidence.v1.3.0',
        approved: true,
        approval_status: 'approved',
        publication_authorized: false,
        deployment_authorized: false,
        planner_runtime_status: 'disabled',
        coverage_copy_status: 'historical_reference_owner_approval_pending',
        work_package_acceptance_status: 'blocked_external_dependencies_and_human_studies',
        technical_foundation_status: 'pass',
      }),
      validateCurrent: async () => ({ status: 'technical_evidence_valid', approval_status: 'pending_authorized_review' }),
    }),
    /WP11_CURRENT_EVIDENCE_APPROVAL/,
  )
  const fixtureDraft = await buildCurrentWp11Draft({
    technicalEvidenceBuilder: async () => ({
      status: 'PASS',
      fixture: 'current-only',
      implementation_files: [{ path: 'scripts/verify-wp11-attestation.mjs', sha256: 'fixture' }],
    }),
    validateCurrent: null,
  })
  assert.equal(fixtureDraft.status, 'pending_authorized_review')
  assert.equal(fixtureDraft.approval, null)
  assert.equal(fixtureDraft.release_gate_pass, false)
  assert.notEqual(fixtureDraft.subject_sha256, HISTORICAL_WP11_V1_3.subject_sha256)
  assert.equal(fixtureDraft.package_id, WP11_PACKAGE_ID)
})

test('only the exact WP11 v1.3 validate descriptor selects the current route', () => {
  const descriptor = {
    alias: 'wp11',
    path: 'verification/wp11/v1.3.0',
    version: '1.3.0',
    name: '@ushso/wp11-verification-v1.3.0',
    scripts: { validate: 'node tools/verify.mjs --validate' },
  }
  assert.equal(usesReviewedWp11CurrentAttestation(descriptor, 'validate'), true)
  assert.equal(usesReviewedWp11CurrentAttestation(descriptor, 'test'), false)
  for (const changed of [
    { alias: 'wp0' },
    { path: 'verification/wp11/v1.4.0' },
    { version: '1.4.0' },
    { name: '@ushso/wp11-verification-v1.2.0' },
    { scripts: { validate: 'node tools/verify.mjs --issue' } },
    { scripts: { validate: 'node tools/verify.mjs --draft' } },
  ]) {
    assert.equal(usesReviewedWp11CurrentAttestation({ ...descriptor, ...changed }, 'validate'), false, JSON.stringify(changed))
  }
  assert.equal(REVIEWED_WP11_ROUTE.package_id, packageId)
})

test('actual WP11 runner executes the four-test suite and routes only validate through the adapter', async () => {
  const before = {
    approval: await hashPinned(HISTORICAL_WP11_V1_3.files.approval.path),
    evidence: await hashPinned(HISTORICAL_WP11_V1_3.files.evidence.path),
    receipt: await hashPinned(HISTORICAL_WP11_V1_3.files.receipt.path),
    predecessorManifest: await hashPinned(HISTORICAL_WP11_V1_3.predecessor_manifest.path),
    predecessorReceipt: await hashPinned(HISTORICAL_WP11_V1_3.predecessor_receipt.path),
    previousSuccessor: await hashPinned(HISTORICAL_WP11_V1_3.previous_successor.path),
  }
  const suite = (await discoverVerificationSuites()).find((item) => item.alias === 'wp11')
  assert.ok(suite)
  assert.equal(suite.path, 'verification/wp11/v1.3.0')
  assert.equal(suite.version, '1.3.0')
  assert.equal(suite.name, '@ushso/wp11-verification-v1.3.0')
  assert.equal(suite.scripts.validate, 'node tools/verify.mjs --validate')
  const result = await runPackageSuites([suite])
  assert.equal(result.ok, true, result.failures.join('\n'))
  assert.deepEqual(result.results[0].executions.map((item) => item.script), ['test', 'validate'])
  assert.equal(result.results[0].executions[0].parsed_test_count, 4)
  assert.equal(result.results[0].executions[1].verification, 'wp11-current-attestation')
  const after = {
    approval: await hashPinned(HISTORICAL_WP11_V1_3.files.approval.path),
    evidence: await hashPinned(HISTORICAL_WP11_V1_3.files.evidence.path),
    receipt: await hashPinned(HISTORICAL_WP11_V1_3.files.receipt.path),
    predecessorManifest: await hashPinned(HISTORICAL_WP11_V1_3.predecessor_manifest.path),
    predecessorReceipt: await hashPinned(HISTORICAL_WP11_V1_3.predecessor_receipt.path),
    previousSuccessor: await hashPinned(HISTORICAL_WP11_V1_3.previous_successor.path),
  }
  assert.deepEqual(after, before)
})

async function createRunnerFixture({ alias, name, version, scripts, files = {} }) {
  const root = await mkdtemp(path.join(await verificationTempRoot(), 'ushso-pr085-wp11-runner-'))
  await mkdir(path.join(root, 'tests'), { recursive: true })
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name, version, private: true, scripts }, null, 2) + '\n')
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(root, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, contents)
  }
  return {
    root,
    descriptor: {
      alias,
      path: root,
      version,
      name,
      scripts,
      required_scripts: Object.keys(scripts),
      movingTreeAttestation: false,
    },
  }
}

test('real runner subprocesses reject future, wrong-package, altered-command and nonmatching-path descriptors and retain failure semantics', async () => {
  const passTest = "import test from 'node:test'\ntest('fixture test', () => {})\n"
  const future = await createRunnerFixture({
    alias: 'wp11',
    name: '@ushso/wp11-verification-v1.4.0',
    version: '1.4.0',
    scripts: { test: 'node --test tests/pass.test.mjs', validate: 'node -e "process.exit(17)"' },
    files: { 'tests/pass.test.mjs': passTest },
  })
  const wrongPackage = await createRunnerFixture({
    alias: 'wp11',
    name: '@ushso/wp11-verification-other',
    version: '1.3.0',
    scripts: { validate: 'node tools/verify.mjs --validate' },
    files: { 'tools/verify.mjs': 'process.exit(19)\n' },
  })
  const alteredCommand = await createRunnerFixture({
    alias: 'wp11',
    name: '@ushso/wp11-verification-v1.3.0',
    version: '1.3.0',
    scripts: { validate: 'node -e "process.exit(23)"' },
  })
  const nonmatchingPath = await createRunnerFixture({
    alias: 'wp11',
    name: '@ushso/wp11-verification-v1.3.0',
    version: '1.3.0',
    scripts: { validate: 'node tools/verify.mjs --validate' },
    files: { 'tools/verify.mjs': 'process.exit(29)\n' },
  })
  const errorChild = await mkdtemp(path.join(await verificationTempRoot(), 'ushso-pr085-wp11-error-'))
  const errorPath = path.join(errorChild, 'error.mjs')
  await writeFile(errorPath, "throw new Error('fixture verifier error')\n")
  const timeoutChild = await mkdtemp(path.join(await verificationTempRoot(), 'ushso-pr085-wp11-timeout-'))
  const timeoutPath = path.join(timeoutChild, 'timeout.mjs')
  await writeFile(timeoutPath, 'setTimeout(() => {}, 1000)\n')
  const zero = await createRunnerFixture({
    alias: 'zero-test',
    name: '@ushso/pr085-wp11-zero-fixture',
    version: '1.0.0',
    scripts: { test: 'node --test' },
  })
  const currentDescriptor = {
    alias: 'wp11',
    path: 'verification/wp11/v1.3.0',
    version: '1.3.0',
    name: '@ushso/wp11-verification-v1.3.0',
    scripts: { validate: 'node tools/verify.mjs --validate' },
    required_scripts: ['validate'],
  }
  try {
    const futureResult = await runPackageSuites([future.descriptor])
    assert.equal(futureResult.ok, false)
    assert.equal(futureResult.results[0].executions[0].status, 'PASS')
    assert.ok(futureResult.results[0].executions[0].parsed_test_count > 0)
    assert.equal(futureResult.results[0].executions[1].status, 'FAIL')
    assert.match(futureResult.results[0].executions[1].error, /exit 17/)
    assert.equal(futureResult.results[0].executions[1].verification, undefined)

    const wrongPackageResult = await runPackageSuites([wrongPackage.descriptor])
    assert.equal(wrongPackageResult.ok, false)
    assert.equal(wrongPackageResult.results[0].executions[0].status, 'FAIL')
    assert.match(wrongPackageResult.results[0].executions[0].error, /exit 19/)
    assert.equal(wrongPackageResult.results[0].executions[0].verification, undefined)

    const alteredResult = await runPackageSuites([alteredCommand.descriptor])
    assert.equal(alteredResult.ok, false)
    assert.equal(alteredResult.results[0].executions[0].status, 'FAIL')
    assert.match(alteredResult.results[0].executions[0].error, /exit 23/)
    assert.equal(alteredResult.results[0].executions[0].verification, undefined)

    const pathResult = await runPackageSuites([nonmatchingPath.descriptor])
    assert.equal(pathResult.ok, false)
    assert.equal(pathResult.results[0].executions[0].status, 'FAIL')
    assert.match(pathResult.results[0].executions[0].error, /exit 29/)
    assert.equal(pathResult.results[0].executions[0].verification, undefined)

    const errorResult = await runPackageSuites([currentDescriptor], { currentWp11AttestationVerifierPath: errorPath })
    assert.equal(errorResult.ok, false)
    assert.equal(errorResult.results[0].executions[0].status, 'FAIL')
    assert.match(errorResult.results[0].executions[0].error, /exit 1/)

    const timeoutResult = await runPackageSuites([currentDescriptor], { currentWp11AttestationVerifierPath: timeoutPath, childTimeoutMs: 50 })
    assert.equal(timeoutResult.ok, false)
    assert.equal(timeoutResult.results[0].executions[0].status, 'FAIL')
    assert.match(timeoutResult.results[0].executions[0].error, /SIGTERM|timed out/u)

    const zeroResult = await runPackageSuites([zero.descriptor])
    assert.equal(zeroResult.ok, false)
    assert.equal(zeroResult.results[0].executions[0].status, 'FAIL')
    assert.equal(zeroResult.results[0].executions[0].parsed_test_count, 0)
    assert.match(zeroResult.failures[0], /zero parsed tests/)
  } finally {
    await Promise.all([
      rm(future.root, { recursive: true, force: true }),
      rm(wrongPackage.root, { recursive: true, force: true }),
      rm(alteredCommand.root, { recursive: true, force: true }),
      rm(nonmatchingPath.root, { recursive: true, force: true }),
      rm(zero.root, { recursive: true, force: true }),
      rm(errorChild, { recursive: true, force: true }),
      rm(timeoutChild, { recursive: true, force: true }),
    ])
  }
})

test('direct WP11 successor validate and issue remain strict and do not mutate sealed proof', async () => {
  const before = {
    approval: await hashPinned(HISTORICAL_WP11_V1_3.files.approval.path),
    evidence: await hashPinned(HISTORICAL_WP11_V1_3.files.evidence.path),
    receipt: await hashPinned(HISTORICAL_WP11_V1_3.files.receipt.path),
  }
  const validate = spawnSync(process.execPath, ['verification/wp11/v1.3.0/tools/verify.mjs', '--validate'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, USHSO_ALLOW_RECEIPT_WRITES: '0' },
  })
  assert.equal(validate.status, 1)
  assert.match(`${validate.stdout}\n${validate.stderr}`, /SUCCESSOR_APPROVAL_STALE_SUBJECT/)
  const issue = spawnSync(process.execPath, ['verification/wp11/v1.3.0/tools/verify.mjs', '--issue'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, USHSO_ALLOW_RECEIPT_WRITES: '0' },
  })
  assert.notEqual(issue.status, 0)
  assert.match(`${issue.stdout}\n${issue.stderr}`, /SUCCESSOR_APPROVAL_STALE_SUBJECT/)
  const after = {
    approval: await hashPinned(HISTORICAL_WP11_V1_3.files.approval.path),
    evidence: await hashPinned(HISTORICAL_WP11_V1_3.files.evidence.path),
    receipt: await hashPinned(HISTORICAL_WP11_V1_3.files.receipt.path),
  }
  assert.deepEqual(after, before)
})

test('child execution helper and parser retain explicit failure semantics', () => {
  assert.throws(() => assertSuccessfulChildExecution({ status: 7, signal: null, error: null }, 'fixture'), /exit 7/)
  assert.throws(() => assertSuccessfulChildExecution({ status: null, signal: null, error: null }, 'fixture'), /no numeric exit status/)
  assert.throws(() => assertSuccessfulChildExecution({ status: 0, signal: 'SIGTERM', error: null }, 'fixture'), /SIGTERM/)
  assert.throws(() => assertSuccessfulChildExecution({ status: null, signal: null, error: { message: 'ENOENT', code: 'ENOENT' } }, 'fixture'), /ENOENT/)
  assert.equal(parseNodeTestCount('# tests 0\n# pass 0\n'), 0)
  assert.equal(parseNodeTestCount('child produced no test summary'), 0)
})
