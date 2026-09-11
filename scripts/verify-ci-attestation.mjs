import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildTechnicalEvidence, packageId } from '../verification/testing/ci/v1.4.0/tools/validate-package.mjs'
import {
  EXTENDED_ROOT_TEST_SEQUENCE,
  ORIGINAL_ROOT_TEST_SEQUENCE,
  RESEARCH_PROGRAM_SCRIPT,
  ROOT_SCRIPT_CONTRACT,
  repositoryRoot,
  validateRootTestSequence,
} from '../verification/testing/ci/v1.4.0/tools/ci-inventory.mjs'
import {
  createDraft,
  sha256,
  validateApproval,
} from '../verification/successor-support.mjs'

const SHA256 = /^[a-f0-9]{64}$/u
const HISTORICAL_BASE_COMMIT = '30fa0c59ecd4d3d1dd1f56cd8422c6c470e45cb0'
const HISTORICAL_V1_3_PACKAGE_ID = '@ushso/ci-verification-successor-v1-3@1.3.0'
const REVIEWED_PR003_SOURCE_COMMIT = 'bf46d92b0e4fc91457bd3eb78aa1742ae84038f2'

/**
 * These are the two current inputs reviewed with PR-003. Their historical
 * pins remain immutable; the current bytes are separately pinned to the
 * exact reviewed PR-003 commit and validated against the bounded transition.
 */
export const REVIEWED_PR003_CURRENT_INPUTS = Object.freeze([
  Object.freeze({
    path: 'package.json',
    role: 'root-package',
    source_commit: REVIEWED_PR003_SOURCE_COMMIT,
    historical_bytes: 3555,
    historical_sha256: '25874c7d9464210794bd7a1467b117ef5fc71808fdf5e34726ea65181744561c',
    current_bytes: 3666,
    current_sha256: 'b6c3469c7b10ecb90114199c18c3ebb293d801b8c8a3521cb25ded2fdba8d05e',
  }),
  Object.freeze({
    path: 'tests/contract-package-inventory.test.mjs',
    role: 'root-inventory-test',
    source_commit: REVIEWED_PR003_SOURCE_COMMIT,
    historical_bytes: 7809,
    historical_sha256: '2bdf766d6c69875160330d8bdf44fbd8d21bbfec43a9b7671c9d233e3ddc4bfa',
    current_bytes: 7842,
    current_sha256: '5ab3deb8457c1a66fc313011bb0d96039c90f5ae35e1e08a9d34c9ab24d6c24b',
  }),
])

export const HISTORICAL_CI_V1_3 = Object.freeze({
  package_id: HISTORICAL_V1_3_PACKAGE_ID,
  subject_sha256: '11b8c7269bf293e67690d713a9e9748b977fb3197f039cb9966e5647d05d2ccb',
  source_commit: HISTORICAL_BASE_COMMIT,
  files: Object.freeze({
    approval: Object.freeze({
      path: 'verification/testing/ci/v1.3.0/approvals/approval.json',
      bytes: 686,
      sha256: '315d0aa83399238b8e127ca3affae9e4d409fb7834e6c3d3aba6434b41b07ae0',
    }),
    evidence: Object.freeze({
      path: 'verification/testing/ci/v1.3.0/approvals/evidence.txt',
      bytes: 770,
      sha256: 'a66da67cfee5c1dc4515aef9464afc222938ce27d3bc169da4393c211e8faa5e',
    }),
    receipt: Object.freeze({
      path: 'verification/testing/ci/v1.3.0/receipts/approved.json',
      bytes: 32976,
      sha256: '8013e0b4700d781a365540e046cd6ac15c8eb1999aca956b30c73591ad648d4b',
    }),
  }),
  predecessor: Object.freeze({
    path: 'verification/testing/ci/v1.0.0/receipts/ci-integration.json',
    bytes: 24148,
    sha256: '6e27725cf531e1ced3d546503176af8ae4157366e97594c49ca5c9d2c18215cd',
  }),
  previous_successor: Object.freeze({
    path: 'verification/testing/ci/v1.2.0/receipts/approved.json',
    bytes: 32440,
    sha256: 'd5f7b2d29cb6790a4b390f62a988746d8a9de6b36642c9d793179178f7d938e2',
  }),
  allowed_current_drift: Object.freeze([
    Object.freeze({ path: 'scripts/run-contract-suites.mjs', reason: 'current runner route is additive and separately inventoried' }),
    Object.freeze({ path: 'package-lock.json', reason: 'current v1.4 workspace link is additive and separately inventoried' }),
  ]),
})

function parseJson(bytes, label) {
  assert.ok(bytes && bytes.length > 0, `CI_HISTORICAL_MISSING_${label}`)
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8'))
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), `CI_HISTORICAL_${label}_SHAPE`)
    return value
  } catch (error) {
    if (error.name === 'AssertionError') throw error
    throw new Error(`CI_HISTORICAL_${label}_MALFORMED: ${error.message}`, { cause: error })
  }
}

function assertHash(value, label) {
  assert.equal(typeof value, 'string', `CI_HISTORICAL_${label}_TYPE`)
  assert.match(value, SHA256, `CI_HISTORICAL_${label}_FORMAT`)
}

function safeRelativePath(value, label) {
  assert.equal(typeof value, 'string', `CI_HISTORICAL_${label}_PATH_TYPE`)
  assert.ok(value.length > 0 && !path.isAbsolute(value) && !value.split('/').includes('..'), `CI_HISTORICAL_${label}_PATH_UNSAFE`)
  return value
}

function expectedHistoricalFiles(expected) {
  const files = expected?.files ?? HISTORICAL_CI_V1_3.files
  for (const name of ['approval', 'evidence', 'receipt']) assertHash(files[name]?.sha256, `${name.toUpperCase()}_PIN`)
  return files
}

function expectedDriftPaths(expected = HISTORICAL_CI_V1_3) {
  return new Set((expected?.allowed_current_drift ?? HISTORICAL_CI_V1_3.allowed_current_drift).map((item) => item.path))
}

const reviewedPr003InputsByPath = new Map(REVIEWED_PR003_CURRENT_INPUTS.map((item) => [item.path, item]))

function parseJsonValue(bytes, label) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch (error) {
    throw new Error(`CI_CURRENT_${label}_MALFORMED: ${error.message}`, { cause: error })
  }
}

function validateRootPackageTransition(bytes) {
  const rootPackage = parseJsonValue(bytes, 'PR003_PACKAGE')
  assert.equal(rootPackage.name, 'ushso', 'CI_CURRENT_PR003_PACKAGE_NAME')
  assert.equal(rootPackage.version, '0.1.0', 'CI_CURRENT_PR003_PACKAGE_VERSION')
  assert.equal(rootPackage.private, true, 'CI_CURRENT_PR003_PACKAGE_PRIVATE')
  assert.equal(rootPackage.license, 'Apache-2.0', 'CI_CURRENT_PR003_PACKAGE_LICENSE')
  assert.equal(rootPackage.type, 'module', 'CI_CURRENT_PR003_PACKAGE_TYPE')
  assert.equal(rootPackage.packageManager, 'npm@11.19.1', 'CI_CURRENT_PR003_PACKAGE_MANAGER')
  assert.deepEqual(rootPackage.engines, { node: '>=22.15.0', npm: '>=11.19.1 <12' }, 'CI_CURRENT_PR003_PACKAGE_ENGINES')
  assert.deepEqual(rootPackage.workspaces, [
    'apps/web',
    'packages/*',
    'packages/*/*/v*',
    'contracts/*/v*',
    'docs/feedback/v*',
    'evaluation/*/v*',
    'verification/*/v*',
    'verification/testing/*/v*',
  ], 'CI_CURRENT_PR003_PACKAGE_WORKSPACES')
  for (const [name, command] of Object.entries(ROOT_SCRIPT_CONTRACT)) {
    assert.equal(rootPackage.scripts?.[name], command, `CI_CURRENT_PR003_PACKAGE_SCRIPT_${name}`)
  }
  assert.equal(rootPackage.scripts?.['test:research-program'], RESEARCH_PROGRAM_SCRIPT, 'CI_CURRENT_PR003_RESEARCH_SCRIPT')
  const rootTest = validateRootTestSequence(rootPackage)
  assert.equal(rootTest.chain, 'pr003-root-chain', 'CI_CURRENT_PR003_ROOT_CHAIN')
  assert.deepEqual(rootTest.sequence, EXTENDED_ROOT_TEST_SEQUENCE, 'CI_CURRENT_PR003_ROOT_SEQUENCE')
  assert.equal(rootTest.research_program.stage_count, 1, 'CI_CURRENT_PR003_RESEARCH_STAGE_COUNT')
  return {
    chain: rootTest.chain,
    sequence: rootTest.sequence,
    registered_research_program: rootPackage.scripts['test:research-program'],
  }
}

function validateRootInventoryTestTransition(bytes) {
  const source = Buffer.from(bytes).toString('utf8')
  const expectedAssertion = `assert.equal(rootPackage.scripts.test, '${EXTENDED_ROOT_TEST_SEQUENCE.join(' && ')}')`
  assert.equal(source.includes(expectedAssertion), true, 'CI_CURRENT_PR003_INVENTORY_TEST_SEQUENCE_ASSERTION')
  assert.equal((source.match(/rootPackage\.scripts\.test, 'npm run test:retrieval && npm run test:web && npm run test:worker && npm run test:research-program && npm run test:evaluation && npm run validate:evaluation && npm run verify:research-navigator'/gu) ?? []).length, 1, 'CI_CURRENT_PR003_INVENTORY_TEST_SEQUENCE_ASSERTION_COUNT')
  assert.match(source, /rootPackage\.scripts\.test\.match\(\/npm run verify:research-navigator\/gu\)/u, 'CI_CURRENT_PR003_INVENTORY_TEST_AGGREGATE_ASSERTION')
  assert.match(source, /for \(const name of \['test:retrieval', 'test:web', 'test:worker', 'test:evaluation', 'validate:evaluation'\]/u, 'CI_CURRENT_PR003_INVENTORY_TEST_LEGACY_ASSERTIONS')
  return {
    sequence_assertion: expectedAssertion,
    aggregate_assertion: 'navigator aggregate count assertion',
    legacy_assertions: true,
  }
}

function validateReviewedPr003CurrentInput(review, bytes) {
  assertHash(review.current_sha256, `REVIEWED_PR003_${review.role.toUpperCase()}_HASH`)
  assert.equal(sha256(bytes), review.current_sha256, `CI_CURRENT_REVIEWED_PR003_${review.role.toUpperCase()}_CHANGED`)
  assert.equal(bytes.length, review.current_bytes, `CI_CURRENT_REVIEWED_PR003_${review.role.toUpperCase()}_BYTES`)
  const semantic = review.role === 'root-package'
    ? validateRootPackageTransition(bytes)
    : validateRootInventoryTestTransition(bytes)
  return {
    path: review.path,
    role: review.role,
    source_commit: review.source_commit,
    bytes: review.current_bytes,
    sha256: review.current_sha256,
    historical_bytes: review.historical_bytes,
    historical_sha256: review.historical_sha256,
    semantic,
  }
}

async function readCurrent(root, relativePath) {
  return readFile(path.resolve(root, relativePath))
}

function verifyPin(pin, bytes, label) {
  assertHash(pin?.sha256, `${label}_HASH`)
  assert.equal(sha256(bytes), pin.sha256, `CI_HISTORICAL_${label}_CHANGED`)
  assert.equal(Number.isInteger(pin.bytes), true, `CI_HISTORICAL_${label}_BYTES_TYPE`)
  assert.equal(bytes.length, pin.bytes, `CI_HISTORICAL_${label}_BYTES`)
}

/**
 * Check the approved v1.3 implementation and inventory input bindings against
 * the candidate bytes. The runner and lock are explicitly allowed to drift;
 * every other approved input must remain byte-identical.
 */
export async function validateHistoricalInputBindings({ root = repositoryRoot, receipt, expected = HISTORICAL_CI_V1_3, readCurrentFile = readCurrent } = {}) {
  assert.ok(receipt?.technical_evidence?.inventory, 'CI_HISTORICAL_INVENTORY_MISSING')
  const drift = expectedDriftPaths(expected)
  const pins = [
    ...(receipt.technical_evidence.implementation_files ?? []).map((pin) => ({ ...pin, source: 'implementation' })),
    ...(receipt.technical_evidence.inventory.inputs ?? []).map((pin) => ({ ...pin, sha256: pin.byte_sha256, source: 'inventory' })),
  ]
  assert.ok(pins.length > 0, 'CI_HISTORICAL_INPUT_PINS_MISSING')
  const seen = new Set()
  const checked = []
  const reviewedStates = new Map()
  for (const pin of pins) {
    const relativePath = safeRelativePath(pin.path, `${pin.source}_PIN`)
    const key = `${pin.source}:${relativePath}`
    assert.ok(!seen.has(key), `CI_HISTORICAL_DUPLICATE_${pin.source.toUpperCase()}_PIN`)
    seen.add(key)
    const bytes = await readCurrentFile(root, relativePath)
    const reviewed = reviewedPr003InputsByPath.get(relativePath)
    if (reviewed) {
      assert.equal(pin.sha256, reviewed.historical_sha256, `CI_HISTORICAL_${relativePath}_PIN_MISMATCH`)
      if (sha256(bytes) === pin.sha256) {
        if (relativePath === 'package.json') {
          const rootPackage = parseJsonValue(bytes, 'HISTORICAL_PACKAGE')
          validateRootTestSequence(rootPackage)
        }
        reviewedStates.set(relativePath, 'historical')
        checked.push({ path: relativePath, source: pin.source, historical_bytes: pin.bytes, historical_sha256: pin.sha256, current_bytes: bytes.length, current_sha256: sha256(bytes), current_drift_allowed: false, reviewed_current_transition: false })
      } else {
        reviewedStates.set(relativePath, 'reviewed_current')
        checked.push({ ...validateReviewedPr003CurrentInput(reviewed, bytes), source: pin.source, current_drift_allowed: true, reviewed_current_transition: true })
      }
    } else if (drift.has(relativePath)) {
      assertHash(pin.sha256, `${relativePath}_HISTORICAL_HASH`)
      assert.equal(bytes.length > 0, true, `CI_CURRENT_${relativePath}_EMPTY`)
      checked.push({ path: relativePath, source: pin.source, historical_bytes: pin.bytes, historical_sha256: pin.sha256, current_bytes: bytes.length, current_sha256: sha256(bytes), current_drift_allowed: true })
    } else {
      verifyPin(pin, bytes, `${pin.source.toUpperCase()}_${relativePath}`)
      checked.push({ path: relativePath, source: pin.source, historical_bytes: pin.bytes, historical_sha256: pin.sha256, current_bytes: bytes.length, current_sha256: sha256(bytes), current_drift_allowed: false })
    }
  }

  const reviewedPaths = REVIEWED_PR003_CURRENT_INPUTS.map((item) => item.path)
  for (const relativePath of reviewedPaths) {
    assert.equal(reviewedStates.has(relativePath), true, `CI_HISTORICAL_REVIEWED_PR003_${relativePath}_PIN_MISSING`)
  }
  const transitionStates = new Set(reviewedPaths.map((relativePath) => reviewedStates.get(relativePath)))
  assert.ok(transitionStates.size === 1, 'CI_CURRENT_REVIEWED_PR003_PARTIAL_TRANSITION')
  const transitionState = reviewedStates.get(reviewedPaths[0])
  return {
    status: 'PASS',
    source_commit: HISTORICAL_BASE_COMMIT,
    allowed_current_drift: [...drift].sort(),
    reviewed_current_inputs: REVIEWED_PR003_CURRENT_INPUTS.map((item) => ({ ...item })),
    reviewed_current_transition: transitionState === 'reviewed_current',
    reviewed_current_transition_state: transitionState,
    checked,
  }
}

/**
 * Validate the immutable v1.3 approval, receipt and predecessor chain from
 * byte buffers. No file is rewritten and the current v1.4 subject is never
 * approved by this function.
 */
export async function validateHistoricalCiProof({
  approvalBytes,
  evidenceBytes,
  receiptBytes,
  predecessorBytes,
  previousSuccessorBytes,
  expected = HISTORICAL_CI_V1_3,
  root = repositoryRoot,
  readCurrentFile = readCurrent,
} = {}) {
  const files = expectedHistoricalFiles(expected)
  const bytesByName = { approval: approvalBytes, evidence: evidenceBytes, receipt: receiptBytes }
  for (const name of ['approval', 'evidence', 'receipt']) {
    const bytes = bytesByName[name]
    assert.ok(bytes && bytes.length > 0, `CI_HISTORICAL_MISSING_${name.toUpperCase()}`)
    verifyPin(files[name], bytes, name.toUpperCase())
  }
  const approval = parseJson(approvalBytes, 'APPROVAL')
  const receipt = parseJson(receiptBytes, 'RECEIPT')
  assert.equal(approval.schema_version, 'ushso-successor-approval.v1.0.0', 'CI_HISTORICAL_APPROVAL_SCHEMA')
  assert.equal(approval.status, 'approved', 'CI_HISTORICAL_APPROVAL_STATUS')
  assert.equal(approval.package_id, expected.package_id, 'CI_HISTORICAL_APPROVAL_PACKAGE')
  assert.equal(approval.subject_sha256, expected.subject_sha256, 'CI_HISTORICAL_APPROVAL_SUBJECT')
  assert.equal(receipt.schema_version, 'ushso-successor-attestation.v1.0.0', 'CI_HISTORICAL_RECEIPT_SCHEMA')
  assert.equal(receipt.package_id, expected.package_id, 'CI_HISTORICAL_RECEIPT_PACKAGE')
  assert.equal(receipt.status, 'approved_scoped_attestation', 'CI_HISTORICAL_RECEIPT_STATUS')
  assert.equal(receipt.technical_status, 'PASS', 'CI_HISTORICAL_RECEIPT_TECHNICAL_STATUS')
  assert.equal(receipt.subject_sha256, expected.subject_sha256, 'CI_HISTORICAL_RECEIPT_SUBJECT')
  for (const field of ['release_gate_pass', 'release_ready', 'production_eligibility']) assert.equal(receipt[field], false, `CI_HISTORICAL_RECEIPT_${field.toUpperCase()}_OVERCLAIM`)
  assert.ok(receipt.technical_evidence && typeof receipt.technical_evidence === 'object', 'CI_HISTORICAL_RECEIPT_TECHNICAL_EVIDENCE')
  assert.ok(receipt.approval && typeof receipt.approval === 'object', 'CI_HISTORICAL_RECEIPT_APPROVAL')
  for (const field of ['schema_version', 'status', 'package_id', 'subject_sha256', 'reviewer', 'recorded_at', 'evidence_sha256', 'attestation']) {
    assert.deepEqual(receipt.approval[field], approval[field], `CI_HISTORICAL_APPROVAL_POINTER_${field}`)
  }
  assert.equal(receipt.approval.evidence_sha256, sha256(evidenceBytes), 'CI_HISTORICAL_EVIDENCE_HASH')

  const historicalDraft = createDraft(expected.package_id, receipt.technical_evidence)
  assert.equal(historicalDraft.subject_sha256, expected.subject_sha256, 'CI_HISTORICAL_RECOMPUTED_SUBJECT')
  validateApproval(historicalDraft, receipt.approval, Buffer.from(evidenceBytes))
  assert.deepEqual({ ...receipt, status: historicalDraft.status, approval: null }, historicalDraft, 'CI_HISTORICAL_RECEIPT_DRAFT_MISMATCH')

  const predecessorPin = expected.predecessor
  const previousPin = expected.previous_successor
  assert.ok(predecessorBytes && predecessorBytes.length > 0, 'CI_HISTORICAL_MISSING_PREDECESSOR')
  assert.ok(previousSuccessorBytes && previousSuccessorBytes.length > 0, 'CI_HISTORICAL_MISSING_PREVIOUS_SUCCESSOR')
  verifyPin(predecessorPin, predecessorBytes, 'PREDECESSOR')
  verifyPin(previousPin, previousSuccessorBytes, 'PREVIOUS_SUCCESSOR')
  const predecessor = parseJson(predecessorBytes, 'PREDECESSOR')
  const previousSuccessor = parseJson(previousSuccessorBytes, 'PREVIOUS_SUCCESSOR')
  assert.equal(predecessor.status, 'PASS', 'CI_HISTORICAL_PREDECESSOR_STATUS')
  assert.equal(previousSuccessor.package_id, '@ushso/ci-verification-successor-v1-2@1.2.0', 'CI_HISTORICAL_PREVIOUS_SUCCESSOR_PACKAGE')
  assert.equal(previousSuccessor.status, 'approved_scoped_attestation', 'CI_HISTORICAL_PREVIOUS_SUCCESSOR_STATUS')
  assert.equal(previousSuccessor.release_gate_pass, false, 'CI_HISTORICAL_PREVIOUS_SUCCESSOR_RELEASE_OVERCLAIM')
  assert.equal(previousSuccessor.production_eligibility, false, 'CI_HISTORICAL_PREVIOUS_SUCCESSOR_PRODUCTION_OVERCLAIM')
  assert.equal(receipt.technical_evidence.predecessor?.path, expected.predecessor.path, 'CI_HISTORICAL_RECEIPT_PREDECESSOR_PATH')
  assert.equal(receipt.technical_evidence.predecessor?.sha256, expected.predecessor.sha256, 'CI_HISTORICAL_RECEIPT_PREDECESSOR_HASH')
  assert.equal(receipt.technical_evidence.previous_successor_receipt?.path, expected.previous_successor.path, 'CI_HISTORICAL_RECEIPT_PREVIOUS_PATH')
  assert.equal(receipt.technical_evidence.previous_successor_receipt?.sha256, expected.previous_successor.sha256, 'CI_HISTORICAL_RECEIPT_PREVIOUS_HASH')
  assert.equal(receipt.technical_evidence.inventory?.package_version, '1.3.0', 'CI_HISTORICAL_INVENTORY_VERSION')
  assert.equal(receipt.technical_evidence.inventory?.receipt_version, 'ushso.ci-integration-receipt.v1.3', 'CI_HISTORICAL_INVENTORY_RECEIPT_VERSION')
  assert.equal(receipt.technical_evidence.inventory?.external_requests, 0, 'CI_HISTORICAL_INVENTORY_EXTERNAL_REQUESTS')
  assert.equal(receipt.technical_evidence.inventory?.external_mutations, 0, 'CI_HISTORICAL_INVENTORY_EXTERNAL_MUTATIONS')
  assert.equal(receipt.technical_evidence.inventory?.immutable, true, 'CI_HISTORICAL_INVENTORY_NOT_IMMUTABLE')

  const inputBindings = await validateHistoricalInputBindings({ root, receipt, expected, readCurrentFile })
  return {
    package_id: expected.package_id,
    subject_sha256: expected.subject_sha256,
    approval_status: 'approved_original_subject_only',
    receipt_status: receipt.status,
    reviewer: receipt.approval.reviewer,
    recorded_at: receipt.approval.recorded_at,
    evidence_sha256: receipt.approval.evidence_sha256,
    source_commit: expected.source_commit ?? HISTORICAL_BASE_COMMIT,
    files: Object.fromEntries(Object.entries(files).map(([name, pin]) => [name, { path: pin.path, bytes: pin.bytes, sha256: pin.sha256 }])),
    predecessor: { ...expected.predecessor },
    previous_successor: { ...expected.previous_successor },
    input_bindings: inputBindings,
  }
}

export async function readHistoricalCiProof(root = repositoryRoot) {
  const pins = HISTORICAL_CI_V1_3.files
  const [approvalBytes, evidenceBytes, receiptBytes, predecessorBytes, previousSuccessorBytes] = await Promise.all([
    readFile(path.resolve(root, pins.approval.path)),
    readFile(path.resolve(root, pins.evidence.path)),
    readFile(path.resolve(root, pins.receipt.path)),
    readFile(path.resolve(root, HISTORICAL_CI_V1_3.predecessor.path)),
    readFile(path.resolve(root, HISTORICAL_CI_V1_3.previous_successor.path)),
  ])
  return validateHistoricalCiProof({ approvalBytes, evidenceBytes, receiptBytes, predecessorBytes, previousSuccessorBytes, root })
}

export async function buildCurrentDraft({ technicalEvidenceBuilder = buildTechnicalEvidence } = {}) {
  const technicalEvidence = await technicalEvidenceBuilder()
  const draft = createDraft(packageId, technicalEvidence)
  assert.equal(draft.status, 'pending_authorized_review', 'CI_CURRENT_DRAFT_STATUS')
  assert.equal(draft.technical_status, 'PASS', 'CI_CURRENT_DRAFT_TECHNICAL_STATUS')
  assert.equal(draft.approval, null, 'CI_CURRENT_DRAFT_APPROVAL')
  assert.equal(draft.release_gate_pass, false, 'CI_CURRENT_DRAFT_RELEASE_OVERCLAIM')
  assert.equal(draft.release_ready, false, 'CI_CURRENT_DRAFT_RELEASE_READY_OVERCLAIM')
  assert.equal(draft.production_eligibility, false, 'CI_CURRENT_DRAFT_PRODUCTION_OVERCLAIM')
  assert.notEqual(draft.subject_sha256, HISTORICAL_CI_V1_3.subject_sha256, 'CI_CURRENT_DRAFT_REUSED_HISTORICAL_SUBJECT')
  assert.ok(draft.technical_evidence.implementation_files?.some((file) => file.path === 'scripts/verify-ci-attestation.mjs'), 'CI_CURRENT_VERIFIER_NOT_IN_IMPLEMENTATION_INVENTORY')
  return draft
}

export async function verifyCiAttestation({ root = repositoryRoot, technicalEvidenceBuilder = buildTechnicalEvidence } = {}) {
  const historical = await readHistoricalCiProof(root)
  const currentDraft = await buildCurrentDraft({ technicalEvidenceBuilder })
  return {
    schema_version: 'ushso.ci-v14-attestation.v1.0.0',
    status: 'PASS',
    package_id: packageId,
    historical,
    current: {
      subject_sha256: currentDraft.subject_sha256,
      technical_status: currentDraft.technical_status,
      status: currentDraft.status,
      approval: null,
      approval_status: 'absent_for_current_subject',
      release_gate_pass: false,
      release_ready: false,
      production_eligibility: false,
      implementation_file_count: currentDraft.technical_evidence.implementation_files.length,
      current_verifier_in_implementation_inventory: true,
    },
    boundaries: {
      historical_approval_reused: false,
      historical_receipt_overwritten: false,
      current_approval_issued: false,
      current_release_qualified: false,
      production_authorized: false,
      structural_inventory_only: true,
    },
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.slice(2).length, 0, 'CI_V14_ATTESTATION_ARGUMENTS_UNSUPPORTED')
    process.stdout.write(JSON.stringify(await verifyCiAttestation(), null, 2) + '\n')
  } catch (error) {
    process.stderr.write('CI v1.4 current attestation failed closed: ' + error.message + '\n')
    process.exitCode = 1
  }
}
