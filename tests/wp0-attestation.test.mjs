import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { verificationTempRoot } from '../scripts/verification-temp-root.mjs'
import {
  assertSuccessfulChildExecution,
  discoverVerificationSuites,
  parseNodeTestCount,
  runPackageSuites,
  usesReviewedWp0CurrentAttestation,
} from '../scripts/run-contract-suites.mjs'
import {
  HISTORICAL_WP0_V1_4,
  buildCurrentDraft,
  validateHistoricalProof,
} from '../scripts/verify-wp0-attestation.mjs'
import {
  approvalStatement,
  createDraft,
  issueApprovedReceipt,
  runSuccessorCli,
  sha256,
} from '../verification/successor-support.mjs'
import { packageId } from '../verification/wp0/v1.4.0/tools/verify.mjs'

function historicalFixture() {
  const technicalEvidence = {
    status: 'PASS',
    fixture: 'historical-proof-only',
    implementation_files: [{ path: 'fixture/implementation.mjs', sha256: 'fixture' }],
  }
  const draft = createDraft(packageId, technicalEvidence)
  const evidenceBytes = Buffer.from(
    'FIXTURE ONLY; no release authority\n' + approvalStatement(draft) + '\nfixture:reviewer\n',
  )
  const approval = {
    schema_version: 'ushso-successor-approval.v1.0.0',
    status: 'approved',
    package_id: packageId,
    subject_sha256: draft.subject_sha256,
    reviewer: { id: 'fixture:reviewer', role: 'authorized_release_reviewer' },
    recorded_at: '2026-09-10T00:00:00Z',
    evidence_sha256: sha256(evidenceBytes),
    attestation: approvalStatement(draft),
  }
  const receipt = issueApprovedReceipt(draft, approval, evidenceBytes)
  const approvalBytes = Buffer.from(JSON.stringify({
    schema_version: approval.schema_version,
    status: approval.status,
    package_id: approval.package_id,
    subject_sha256: approval.subject_sha256,
  }) + '\n')
  const receiptBytes = Buffer.from(JSON.stringify(receipt) + '\n')
  const bytes = { approvalBytes, evidenceBytes, receiptBytes }
  const files = Object.fromEntries([
    ['approval', 'fixture/approval.json'],
    ['evidence', 'fixture/evidence.txt'],
    ['receipt', 'fixture/approved.json'],
  ].map(([name, filePath]) => [name, { path: filePath, sha256: sha256(bytes[name + 'Bytes']) }]))
  return {
    bytes,
    expected: {
      package_id: packageId,
      subject_sha256: draft.subject_sha256,
      files,
    },
  }
}

function expectedFor(bytes, fixture) {
  return {
    ...fixture.expected,
    files: Object.fromEntries(Object.entries(fixture.expected.files).map(([name, pin]) => [
      name,
      { ...pin, sha256: sha256(bytes[name + 'Bytes']) },
    ])),
  }
}

test('historical proof validates by bytes and shared successor subject rules', () => {
  const fixture = historicalFixture()
  const result = validateHistoricalProof({ ...fixture.bytes, expected: fixture.expected })
  assert.equal(result.package_id, packageId)
  assert.equal(result.subject_sha256, fixture.expected.subject_sha256)
  assert.equal(result.approval_status, 'approved_original_subject_only')
  assert.equal(result.receipt_status, 'approved_scoped_attestation')
})

test('historical proof fails for each missing or altered immutable input', () => {
  const fixture = historicalFixture()
  for (const name of ['approval', 'evidence', 'receipt']) {
    const missing = { ...fixture.bytes, [name + 'Bytes']: null }
    assert.throws(
      () => validateHistoricalProof({ ...missing, expected: fixture.expected }),
      new RegExp('WP0_HISTORICAL_MISSING_' + name.toUpperCase()),
    )
    const altered = { ...fixture.bytes, [name + 'Bytes']: Buffer.concat([fixture.bytes[name + 'Bytes'], Buffer.from('tamper')]) }
    assert.throws(
      () => validateHistoricalProof({ ...altered, expected: fixture.expected }),
      new RegExp('WP0_HISTORICAL_' + name.toUpperCase() + '_CHANGED'),
    )
  }
})

test('historical proof fails closed for malformed JSON and wrong or malformed subjects', () => {
  const fixture = historicalFixture()
  const malformedJson = { ...fixture.bytes, approvalBytes: Buffer.from('{') }
  assert.throws(
    () => validateHistoricalProof({ ...malformedJson, expected: expectedFor(malformedJson, fixture) }),
    /WP0_HISTORICAL_APPROVAL_MALFORMED/,
  )

  const pointer = JSON.parse(fixture.bytes.approvalBytes)
  for (const subject of ['f'.repeat(64), 'not-a-subject']) {
    const wrong = { ...fixture.bytes, approvalBytes: Buffer.from(JSON.stringify({ ...pointer, subject_sha256: subject }) + '\n') }
    assert.throws(
      () => validateHistoricalProof({ ...wrong, expected: expectedFor(wrong, fixture) }),
      /WP0_HISTORICAL_APPROVAL_SUBJECT/,
    )
  }
})

test('current technical failure cannot become a pending draft', async () => {
  await assert.rejects(
    buildCurrentDraft({
      technicalEvidenceBuilder: async () => ({ status: 'FAIL', implementation_files: [] }),
    }),
    /SUCCESSOR_TECHNICAL_CHECKS_NOT_PASS/,
  )
})

test('current draft remains pending and seals the verifier in its inventory', async () => {
  const draft = await buildCurrentDraft({
    technicalEvidenceBuilder: async () => ({
      status: 'PASS',
      fixture: 'current-only',
      implementation_files: [{ path: 'scripts/verify-wp0-attestation.mjs', sha256: 'fixture' }],
    }),
  })
  assert.equal(draft.status, 'pending_authorized_review')
  assert.equal(draft.approval, null)
  assert.equal(draft.release_gate_pass, false)
  assert.notEqual(draft.subject_sha256, HISTORICAL_WP0_V1_4.subject_sha256)
})

test('only the reviewed WP0 v1.4.0 validate descriptor selects the current route', () => {
  const descriptor = {
    alias: 'wp0',
    path: 'verification/wp0/v1.4.0',
    version: '1.4.0',
    scripts: { validate: 'node tools/verify.mjs --validate' },
  }
  assert.equal(usesReviewedWp0CurrentAttestation(descriptor, 'validate'), true)
  assert.equal(usesReviewedWp0CurrentAttestation(descriptor, 'test'), false)
  for (const changed of [
    { version: '1.5.0' },
    { path: 'verification/wp0/v1.5.0' },
    { alias: 'wp1' },
    { scripts: { validate: 'node tools/verify.mjs --issue' } },
  ]) {
    assert.equal(
      usesReviewedWp0CurrentAttestation({ ...descriptor, ...changed }, 'validate'),
      false,
      JSON.stringify(changed),
    )
  }
})

test('child failures, absent status, signals and zero test summaries fail closed', () => {
  assert.throws(() => assertSuccessfulChildExecution({ status: 7, signal: null, error: null }, 'fixture'), /exit 7/)
  assert.throws(() => assertSuccessfulChildExecution({ status: null, signal: null, error: null }, 'fixture'), /no numeric exit status/)
  assert.throws(() => assertSuccessfulChildExecution({ status: 0, signal: 'SIGTERM', error: null }, 'fixture'), /SIGTERM/)
  assert.equal(parseNodeTestCount('# tests 0\n# pass 0\n'), 0)
  assert.equal(parseNodeTestCount('child produced no test summary'), 0)
})

test('direct successor validation remains pending without issuing a receipt', async () => {
  const scratch = await mkdtemp(path.join(await verificationTempRoot(), 'ushso-pr085-direct-successor-'))
  const oldExitCode = process.exitCode
  try {
    const result = await runSuccessorCli({
      packageId,
      packageRoot: scratch,
      buildTechnicalEvidence: async () => ({ status: 'PASS', fixture: 'direct-successor-only' }),
      args: ['--validate'],
    })
    assert.equal(result.status, 'pending_authorized_review')
    assert.equal(process.exitCode, 2)
    const fs = await import('node:fs/promises')
    await assert.rejects(fs.access(path.join(scratch, 'receipts/approved.json')), { code: 'ENOENT' })
  } finally {
    process.exitCode = oldExitCode
    await rm(scratch, { recursive: true, force: true })
  }
})

test('actual WP0 runner keeps the test stage and reports a positive count before current validation', async () => {
  const suite = (await discoverVerificationSuites()).find(item => item.alias === 'wp0')
  assert.ok(suite)
  const result = await runPackageSuites([suite])
  assert.equal(result.ok, true, result.failures.join('\n'))
  assert.equal(result.package_count, 1)
  assert.deepEqual(result.results[0].executions.map(item => item.script), ['test', 'validate'])
  assert.ok(result.results[0].executions[0].parsed_test_count > 0)
  assert.equal(result.results[0].executions[1].verification, 'wp0-current-ci-attestation')
})

async function createRunnerFixture({ alias, name, version, scripts, files = {} }) {
  const root = await mkdtemp(path.join(await verificationTempRoot(), 'ushso-pr085-runner-fixture-'))
  await mkdir(path.join(root, 'tests'), { recursive: true })
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name, version, private: true, scripts }, null, 2) + '\n',
  )
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

test('actual runner retains future-version failures, child failures, and zero-test failures', async () => {
  const future = await createRunnerFixture({
    alias: 'wp0',
    name: '@ushso/pr085-future-wp0-fixture',
    version: '1.5.0',
    scripts: {
      test: 'node --test tests/pass.test.mjs',
      validate: 'node -e "process.exit(17)"',
    },
    files: {
      'tests/pass.test.mjs': "import test from 'node:test'\ntest('fixture test', () => {})\n",
    },
  })
  const zero = await createRunnerFixture({
    alias: 'zero-test',
    name: '@ushso/pr085-zero-test-fixture',
    version: '1.0.0',
    scripts: {
      test: 'node --test',
    },
  })
  const failingAttestationRoot = await mkdtemp(path.join(await verificationTempRoot(), 'ushso-pr085-attestation-fixture-'))
  const failingAttestationPath = path.join(failingAttestationRoot, 'failing-attestation.mjs')
  await writeFile(
    failingAttestationPath,
    "process.stderr.write('fixture current attestation failure\\n')\nprocess.exitCode = 23\n",
  )
  try {
    assert.equal(usesReviewedWp0CurrentAttestation(future.descriptor, 'validate'), false)
    const futureResult = await runPackageSuites([future.descriptor])
    assert.equal(futureResult.ok, false)
    assert.equal(futureResult.results[0].executions[0].status, 'PASS')
    assert.ok(futureResult.results[0].executions[0].parsed_test_count > 0)
    assert.equal(futureResult.results[0].executions[1].status, 'FAIL')
    assert.match(futureResult.results[0].executions[1].error, /exit 17/)
    assert.equal(futureResult.results[0].executions[1].verification, undefined)

    const zeroResult = await runPackageSuites([zero.descriptor])
    assert.equal(zeroResult.ok, false)
    assert.equal(zeroResult.results[0].executions[0].status, 'FAIL')
    assert.equal(zeroResult.results[0].executions[0].parsed_test_count, 0)
    assert.match(zeroResult.failures[0], /zero parsed tests/)

    const currentDescriptor = {
      alias: 'wp0',
      path: 'verification/wp0/v1.4.0',
      version: '1.4.0',
      scripts: { validate: 'node tools/verify.mjs --validate' },
      required_scripts: ['validate'],
    }
    const currentResult = await runPackageSuites([currentDescriptor], {
      currentAttestationVerifierPath: failingAttestationPath,
    })
    assert.equal(currentResult.ok, false)
    assert.equal(currentResult.results[0].executions[0].status, 'FAIL')
    assert.match(currentResult.results[0].executions[0].error, /exit 23/)
    assert.equal(currentResult.results[0].executions[0].verification, undefined)
  } finally {
    await Promise.all([
      rm(future.root, { recursive: true, force: true }),
      rm(zero.root, { recursive: true, force: true }),
      rm(failingAttestationRoot, { recursive: true, force: true }),
    ])
  }
})
