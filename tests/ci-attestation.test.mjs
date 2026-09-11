import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { verificationTempRoot } from '../scripts/verification-temp-root.mjs'

const execFile = promisify(execFileCallback)
import {
  assertSuccessfulChildExecution,
  discoverVerificationSuites,
  parseNodeTestCount,
  runPackageSuites,
  usesReviewedCiV14CurrentAttestation,
} from '../scripts/run-contract-suites.mjs'
import {
  HISTORICAL_CI_V1_3,
  REVIEWED_PR003_CURRENT_INPUTS,
  buildCurrentDraft,
  validateHistoricalCiProof,
  verifyCiAttestation,
} from '../scripts/verify-ci-attestation.mjs'
import { runSuccessorCli } from '../verification/successor-support.mjs'
import { packageId } from '../verification/testing/ci/v1.4.0/tools/validate-package.mjs'
import { repositoryRoot } from '../verification/testing/ci/v1.4.0/tools/ci-inventory.mjs'

async function historicalBytes() {
  const names = HISTORICAL_CI_V1_3.files
  return {
    approvalBytes: await readFile(names.approval.path),
    evidenceBytes: await readFile(names.evidence.path),
    receiptBytes: await readFile(names.receipt.path),
    predecessorBytes: await readFile(HISTORICAL_CI_V1_3.predecessor.path),
    previousSuccessorBytes: await readFile(HISTORICAL_CI_V1_3.previous_successor.path),
  }
}

test('current CI v1.4 verifier keeps historical proof separate from pending current draft', async () => {
  const result = await verifyCiAttestation()
  assert.equal(result.status, 'PASS')
  assert.equal(result.historical.package_id, HISTORICAL_CI_V1_3.package_id)
  assert.equal(result.historical.subject_sha256, HISTORICAL_CI_V1_3.subject_sha256)
  assert.equal(result.current.package_id, undefined)
  assert.equal(result.current.status, 'pending_authorized_review')
  assert.notEqual(result.current.subject_sha256, result.historical.subject_sha256)
  assert.equal(result.current.approval, null)
  assert.equal(result.current.release_gate_pass, false)
  assert.equal(result.current.release_ready, false)
  assert.equal(result.current.production_eligibility, false)
  assert.equal(result.boundaries.historical_approval_reused, false)
  assert.equal(result.boundaries.historical_receipt_overwritten, false)
  assert.equal(result.boundaries.current_approval_issued, false)
  assert.equal(result.boundaries.structural_inventory_only, true)
})

test('historical v1.3 proof fails closed for missing and altered immutable bytes', async () => {
  const fixture = await historicalBytes()
  await validateHistoricalCiProof(fixture)
  const labels = { approval: 'APPROVAL', evidence: 'EVIDENCE', receipt: 'RECEIPT', predecessor: 'PREDECESSOR', previousSuccessor: 'PREVIOUS_SUCCESSOR' }
  for (const name of Object.keys(labels)) {
    const missing = { ...fixture, [name + 'Bytes']: null }
    await assert.rejects(validateHistoricalCiProof(missing), new RegExp(`CI_HISTORICAL_MISSING_${labels[name]}`))
    const altered = { ...fixture, [name + 'Bytes']: Buffer.concat([fixture[name + 'Bytes'], Buffer.from('tamper')]) }
    await assert.rejects(validateHistoricalCiProof(altered), new RegExp(`CI_HISTORICAL_${labels[name]}_CHANGED`))
  }
})

async function readGitBytes(commit, relativePath) {
  const { stdout } = await execFile('git', ['show', `${commit}:${relativePath}`], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    maxBuffer: 2_000_000,
  })
  return stdout
}

test('historical proof accepts only the reviewed PR-003 input transition', async () => {
  const fixture = await historicalBytes()
  const legacy = await validateHistoricalCiProof(fixture)
  assert.equal(legacy.input_bindings.status, 'PASS')
  assert.equal(legacy.input_bindings.checked.filter((item) => item.reviewed_current_transition).length, 0)

  const reviewedBytes = new Map(await Promise.all(REVIEWED_PR003_CURRENT_INPUTS.map(async (item) => [
    item.path,
    await readGitBytes(item.source_commit, item.path),
  ])))
  const readReviewedCurrentFile = async (root, relativePath) => reviewedBytes.get(relativePath) ?? readFile(path.resolve(root, relativePath))
  const transition = await validateHistoricalCiProof({ ...fixture, readCurrentFile: readReviewedCurrentFile })
  const transitioned = transition.input_bindings.checked.filter((item) => item.reviewed_current_transition)
  assert.deepEqual(transitioned.map((item) => item.path).sort(), REVIEWED_PR003_CURRENT_INPUTS.map((item) => item.path).sort())
  for (const item of transitioned) {
    assert.equal(item.source_commit, REVIEWED_PR003_CURRENT_INPUTS.find((review) => review.path === item.path).source_commit)
    assert.equal(item.current_drift_allowed, true)
    assert.notEqual(item.current_sha256, item.historical_sha256)
  }
  assert.equal(transition.input_bindings.reviewed_current_inputs.length, 2)

  const tamperedPackage = Buffer.from(reviewedBytes.get('package.json'))
  tamperedPackage[tamperedPackage.length - 1] ^= 1
  const readTampered = async (root, relativePath) => relativePath === 'package.json' ? tamperedPackage : readReviewedCurrentFile(root, relativePath)
  await assert.rejects(
    validateHistoricalCiProof({ ...fixture, readCurrentFile: readTampered }),
    /CI_CURRENT_REVIEWED_PR003_ROOT-PACKAGE_CHANGED/u,
  )
})

test('current technical failure cannot be represented as a pending draft', async () => {
  await assert.rejects(
    buildCurrentDraft({ technicalEvidenceBuilder: async () => ({ status: 'FAIL', implementation_files: [] }) }),
    /SUCCESSOR_TECHNICAL_CHECKS_NOT_PASS/,
  )
  const fixtureDraft = await buildCurrentDraft({
    technicalEvidenceBuilder: async () => ({
      status: 'PASS',
      fixture: 'current-only',
      implementation_files: [{ path: 'scripts/verify-ci-attestation.mjs', sha256: 'fixture' }],
    }),
  })
  assert.equal(fixtureDraft.status, 'pending_authorized_review')
  assert.equal(fixtureDraft.approval, null)
  assert.equal(fixtureDraft.release_gate_pass, false)
  assert.notEqual(fixtureDraft.subject_sha256, HISTORICAL_CI_V1_3.subject_sha256)
})

test('only exact CI v1.4 validate descriptor selects the current route', () => {
  const descriptor = {
    alias: 'ci-verification',
    path: 'verification/testing/ci/v1.4.0',
    version: '1.4.0',
    scripts: { validate: 'node tools/validate-package.mjs --validate' },
  }
  assert.equal(usesReviewedCiV14CurrentAttestation(descriptor, 'validate'), true)
  assert.equal(usesReviewedCiV14CurrentAttestation(descriptor, 'test'), false)
  for (const changed of [
    { alias: 'wp0' },
    { path: 'verification/testing/ci/v1.5.0' },
    { version: '1.5.0' },
    { scripts: { validate: 'node tools/validate-package.mjs --issue' } },
  ]) {
    assert.equal(usesReviewedCiV14CurrentAttestation({ ...descriptor, ...changed }, 'validate'), false, JSON.stringify(changed))
  }
})

test('actual CI v1.4 runner executes test first and routes only validate through current verifier', async () => {
  const suite = (await discoverVerificationSuites()).find((item) => item.alias === 'ci-verification')
  assert.ok(suite)
  assert.equal(suite.path, 'verification/testing/ci/v1.4.0')
  const result = await runPackageSuites([suite])
  assert.equal(result.ok, true, result.failures.join('\n'))
  assert.deepEqual(result.results[0].executions.map((item) => item.script), ['test', 'validate'])
  assert.ok(result.results[0].executions[0].parsed_test_count > 0)
  assert.equal(result.results[0].executions[1].verification, 'ci-v14-current-attestation')
})

async function createRunnerFixture({ alias, name, version, scripts, files = {} }) {
  const root = await mkdtemp(path.join(await verificationTempRoot(), 'ushso-pr085-v14-runner-'))
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
      scripts,
      required_scripts: Object.keys(scripts),
      movingTreeAttestation: false,
    },
  }
}

test('real runner subprocesses retain nonzero, error, timeout, and zero-test failures', async () => {
  const passTest = "import test from 'node:test'\ntest('fixture test', () => {})\n"
  const future = await createRunnerFixture({
    alias: 'ci-verification',
    name: '@ushso/pr085-v14-future-ci-fixture',
    version: '1.5.0',
    scripts: { test: 'node --test tests/pass.test.mjs', validate: 'node -e "process.exit(17)"' },
    files: { 'tests/pass.test.mjs': passTest },
  })
  const errorChild = await mkdtemp(path.join(await verificationTempRoot(), 'ushso-pr085-v14-error-'))
  const errorPath = path.join(errorChild, 'error.mjs')
  await writeFile(errorPath, "throw new Error('fixture verifier error')\n")
  const timeoutChild = await mkdtemp(path.join(await verificationTempRoot(), 'ushso-pr085-v14-timeout-'))
  const timeoutPath = path.join(timeoutChild, 'timeout.mjs')
  await writeFile(timeoutPath, 'setTimeout(() => {}, 1000)\n')
  const zero = await createRunnerFixture({
    alias: 'zero-test',
    name: '@ushso/pr085-v14-zero-fixture',
    version: '1.0.0',
    scripts: { test: 'node --test' },
  })
  const currentDescriptor = {
    alias: 'ci-verification',
    path: 'verification/testing/ci/v1.4.0',
    version: '1.4.0',
    scripts: { validate: 'node tools/validate-package.mjs --validate' },
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

    const errorResult = await runPackageSuites([currentDescriptor], { currentCiAttestationVerifierPath: errorPath })
    assert.equal(errorResult.ok, false)
    assert.equal(errorResult.results[0].executions[0].status, 'FAIL')
    assert.match(errorResult.results[0].executions[0].error, /exit 1/)

    const timeoutResult = await runPackageSuites([currentDescriptor], { currentCiAttestationVerifierPath: timeoutPath, childTimeoutMs: 50 })
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
      rm(zero.root, { recursive: true, force: true }),
      rm(errorChild, { recursive: true, force: true }),
      rm(timeoutChild, { recursive: true, force: true }),
    ])
  }
})

test('direct successor v1.4 validation remains strict and cannot issue a receipt', async () => {
  const scratch = await mkdtemp(path.join(await verificationTempRoot(), 'ushso-pr085-v14-direct-'))
  const oldExitCode = process.exitCode
  try {
    const result = await runSuccessorCli({
      packageId,
      packageRoot: scratch,
      buildTechnicalEvidence: async () => ({ status: 'PASS', fixture: 'direct-v14-only' }),
      args: ['--validate'],
    })
    assert.equal(result.status, 'pending_authorized_review')
    assert.equal(process.exitCode, 2)
    await assert.rejects(readFile(path.join(scratch, 'receipts/approved.json')), { code: 'ENOENT' })
  } finally {
    process.exitCode = oldExitCode
    await rm(scratch, { recursive: true, force: true })
  }
})

test('child execution helper and parser retain explicit failure semantics', () => {
  assert.throws(() => assertSuccessfulChildExecution({ status: 7, signal: null, error: null }, 'fixture'), /exit 7/)
  assert.throws(() => assertSuccessfulChildExecution({ status: null, signal: null, error: null }, 'fixture'), /no numeric exit status/)
  assert.throws(() => assertSuccessfulChildExecution({ status: 0, signal: 'SIGTERM', error: null }, 'fixture'), /SIGTERM/)
  assert.throws(() => assertSuccessfulChildExecution({ status: null, signal: null, error: { message: 'ENOENT', code: 'ENOENT' } }, 'fixture'), /ENOENT/)
  assert.equal(parseNodeTestCount('# tests 0\n# pass 0\n'), 0)
  assert.equal(parseNodeTestCount('child produced no test summary'), 0)
})
