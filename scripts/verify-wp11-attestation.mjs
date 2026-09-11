import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createDraft,
  pinFiles,
  sha256,
  validateApproval,
} from '../verification/successor-support.mjs'
import {
  HISTORICAL_PREIMAGE_INVENTORY_PATH,
  HISTORICAL_PREIMAGE_READER_PATH,
  HISTORICAL_WP11_SOURCE_COMMIT,
  HISTORICAL_WP11_SUBJECT_SHA256,
  SEALED_WP11_FILE_COUNT,
  SEALED_WP11_RECEIPT_SHA256,
  SEALED_WP11_TOTAL_BYTES,
  readHistoricalPreimageSnapshot,
} from '../verification/research-program/ci-attestation/wp11-v1.3.0/historical-preimage-reader.mjs'
import {
  buildTechnicalEvidence,
  validateCandidateEvidence,
} from '../verification/wp11/v1.3.0/tools/technical-evidence.mjs'
import { packageId } from '../verification/wp11/v1.3.0/tools/verify.mjs'

const SHA256 = /^[a-f0-9]{64}$/u
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const WP11_PACKAGE_ID = packageId
export const WP11_WRAPPER_PACKAGE_ID = '@ushso/wp11-current-attestation-adapter-v1.3.0@1.3.0'

export const REVIEWED_WP11_ROUTE = Object.freeze({
  alias: 'wp11',
  path: 'verification/wp11/v1.3.0',
  version: '1.3.0',
  name: '@ushso/wp11-verification-v1.3.0',
  package_id: WP11_PACKAGE_ID,
  validateCommand: 'node tools/verify.mjs --validate',
})

export const ORIGINAL_PR085_PACKAGE_SNAPSHOT = Object.freeze({
  git_commit: '4f90157108a92ce9541c340d5536eac31f24a1d8',
  git_path: 'package.json',
  bytes: 3555,
  sha256: '25874c7d9464210794bd7a1467b117ef5fc71808fdf5e34726ea65181744561c',
})

export const REVIEWED_PR003_PACKAGE_SNAPSHOT = Object.freeze({
  git_commit: 'bf46d92b0e4fc91457bd3eb78aa1742ae84038f2',
  git_path: 'package.json',
  bytes: 3666,
  sha256: 'b6c3469c7b10ecb90114199c18c3ebb293d801b8c8a3521cb25ded2fdba8d05e',
})

export const ALLOWED_PACKAGE_LOCK = Object.freeze({
  historical: Object.freeze({
    bytes: 134190,
    sha256: 'af2070ae111bc67c397b07e33b44c1fbd15bba31b63210990068943998e1bc28',
  }),
  pr085_ci_v14: Object.freeze({
    bytes: 134511,
    sha256: '37e4a9ec1fba9ab254aa7a596e1a0e3f73919cf5358717dc6e06e0478be6b20c',
  }),
})

export const WP11_WRAPPER_IMPLEMENTATION_FILES = Object.freeze([
  'scripts/verify-wp11-attestation.mjs',
  'scripts/run-contract-suites.mjs',
  'tests/wp11-attestation.test.mjs',
  HISTORICAL_PREIMAGE_READER_PATH,
  HISTORICAL_PREIMAGE_INVENTORY_PATH,
  'verification/research-program/ci-attestation/wp11-v1.3.0/policy.json',
])

export const WP11_POLICY_PATH = 'verification/research-program/ci-attestation/wp11-v1.3.0/policy.json'

export const WP11_BUILDER_UNPINNED_READS = Object.freeze([
  'worker/index.mjs',
  'packages/coverage/accounting/v1.0.0/artifacts/public-coverage-view.json',
  'verification/external-authorization/v1.0.0/register.json',
  'packages/retrieval/corpus/records.jsonl',
])

export const PR005_941C9CD_CHANGED_INPUTS = Object.freeze([
  'apps/web/src/components/ResultCard.test.ts',
  'apps/web/src/components/ResultCard.tsx',
  'apps/web/src/lib/catalogAdapter.test.ts',
  'apps/web/src/lib/catalogAdapter.ts',
  'apps/web/src/lib/researcherGuidance.test.tsx',
  'apps/web/src/lib/researcherGuidance.ts',
  'apps/web/src/pages/DatasetDetailsPage.test.tsx',
  'apps/web/src/pages/DatasetDetailsPage.tsx',
  'apps/web/src/types/catalog.ts',
  'apps/web/src/types/discovery.ts',
  'package-lock.json',
  'package.json',
  'packages/retrieval/tools/retrieval-core-v1.2.mjs',
])

export const HISTORICAL_WP11_V1_3 = Object.freeze({
  package_id: WP11_PACKAGE_ID,
  subject_sha256: '294d8b40bb5a2dbe1f55cdfde4a60205de75ee1ffe48e0108eae69aea2db0f98',
  source_commit: '30fa0c59ecd4d3d1dd1f56cd8422c6c470e45cb0',
  files: Object.freeze({
    approval: Object.freeze({
      path: 'verification/wp11/v1.3.0/approvals/approval.json',
      bytes: 674,
      sha256: 'c571ce5183f7a384db60d7f23dd605bcd51545e7ac38347a7b0766c67372e3d1',
    }),
    evidence: Object.freeze({
      path: 'verification/wp11/v1.3.0/approvals/evidence.txt',
      bytes: 764,
      sha256: 'b77cf81e309d88b52bd1ed9502f39459697c0dffa16d0c87d2889c5d5ae59422',
    }),
    receipt: Object.freeze({
      path: 'verification/wp11/v1.3.0/receipts/approved.json',
      bytes: 32419,
      sha256: 'e596e1b18a0251f611990c9752e1d12fb36cd05dab16bf55cf96e8d1fc431f9d',
    }),
  }),
  predecessor_manifest: Object.freeze({
    path: 'verification/wp11/v1.0.0/receipts/implementation-file-manifest.json',
    bytes: 7068,
    sha256: 'd388972dca800318aa8ad31ddca2975c0eb3d2761fdb28e82aa7545cb76576aa',
  }),
  predecessor_receipt: Object.freeze({
    path: 'verification/wp11/v1.0.0/receipts/wp11-verification.json',
    bytes: 6833,
    sha256: '0e75b70dc65c3b05a324d34cbe55bb90d6a7f5b7f90bc810a0770a3a44dabf60',
  }),
  previous_successor: Object.freeze({
    path: 'verification/wp11/v1.2.0/receipts/approved.json',
    bytes: 32420,
    sha256: '6ff262f67687cf4166af21e7e2e2ba610158f765516e2d597b77670ac2c3a3f5',
    package_id: '@ushso/wp11-verification-v1.2.0@1.2.0',
  }),
})

function parseJson(bytes, label) {
  assert.ok(bytes && bytes.length > 0, `WP11_HISTORICAL_MISSING_${label}`)
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8'))
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), `WP11_HISTORICAL_${label}_SHAPE`)
    return value
  } catch (error) {
    if (error.name === 'AssertionError') throw error
    throw new Error(`WP11_HISTORICAL_${label}_MALFORMED: ${error.message}`, { cause: error })
  }
}

function assertHash(value, label) {
  assert.equal(typeof value, 'string', `WP11_HISTORICAL_${label}_TYPE`)
  assert.match(value, SHA256, `WP11_HISTORICAL_${label}_FORMAT`)
}

function safeRelativePath(value, label) {
  assert.equal(typeof value, 'string', `WP11_HISTORICAL_${label}_PATH_TYPE`)
  assert.ok(value.length > 0 && !path.isAbsolute(value) && !value.split('/').includes('..'), `WP11_HISTORICAL_${label}_PATH_UNSAFE`)
  return value
}

function verifyPin(pin, bytes, label) {
  assertHash(pin?.sha256, `${label}_HASH`)
  assert.equal(sha256(bytes), pin.sha256, `WP11_HISTORICAL_${label}_CHANGED`)
  assert.equal(Number.isInteger(pin.bytes), true, `WP11_HISTORICAL_${label}_BYTES_TYPE`)
  assert.equal(bytes.length, pin.bytes, `WP11_HISTORICAL_${label}_BYTES`)
}

async function readCurrent(root, relativePath) {
  return readFile(path.resolve(root, relativePath))
}

function lockStateFor(bytes) {
  const digest = sha256(bytes)
  if (digest === ALLOWED_PACKAGE_LOCK.historical.sha256 && bytes.length === ALLOWED_PACKAGE_LOCK.historical.bytes) {
    return 'historical'
  }
  if (digest === ALLOWED_PACKAGE_LOCK.pr085_ci_v14.sha256 && bytes.length === ALLOWED_PACKAGE_LOCK.pr085_ci_v14.bytes) {
    return 'pr085_ci_v14'
  }
  throw new Error('WP11_CURRENT_LOCK_UNREVIEWED_DRIFT')
}

function packageProvenanceFor(bytes) {
  const digest = sha256(bytes)
  if (digest === ORIGINAL_PR085_PACKAGE_SNAPSHOT.sha256 && bytes.length === ORIGINAL_PR085_PACKAGE_SNAPSHOT.bytes) {
    return {
      state: 'original_pr085_git_snapshot',
      location: 'external',
      git_commit: ORIGINAL_PR085_PACKAGE_SNAPSHOT.git_commit,
      git_path: ORIGINAL_PR085_PACKAGE_SNAPSHOT.git_path,
      bytes: ORIGINAL_PR085_PACKAGE_SNAPSHOT.bytes,
      sha256: ORIGINAL_PR085_PACKAGE_SNAPSHOT.sha256,
      reviewed_pr003_transition: false,
    }
  }
  if (digest === REVIEWED_PR003_PACKAGE_SNAPSHOT.sha256 && bytes.length === REVIEWED_PR003_PACKAGE_SNAPSHOT.bytes) {
    return {
      state: 'reviewed_pr003_current',
      location: 'external',
      git_commit: REVIEWED_PR003_PACKAGE_SNAPSHOT.git_commit,
      git_path: REVIEWED_PR003_PACKAGE_SNAPSHOT.git_path,
      bytes: REVIEWED_PR003_PACKAGE_SNAPSHOT.bytes,
      sha256: REVIEWED_PR003_PACKAGE_SNAPSHOT.sha256,
      reviewed_pr003_transition: true,
      original_pr085_snapshot: { ...ORIGINAL_PR085_PACKAGE_SNAPSHOT },
    }
  }
  throw new Error('WP11_CURRENT_PACKAGE_UNREVIEWED_DRIFT')
}

function assertDisabledCurrentFeatures(evidence) {
  assert.equal(evidence.schema_version, 'ushso-wp11-technical-evidence.v1.3.0', 'WP11_CURRENT_EVIDENCE_SCHEMA')
  assert.equal(evidence.status, 'PASS', 'WP11_CURRENT_TECHNICAL_STATUS')
  assert.equal(evidence.approval_status, 'pending_authorized_review', 'WP11_CURRENT_EVIDENCE_APPROVAL_STATUS')
  assert.equal(evidence.approved, false, 'WP11_CURRENT_EVIDENCE_APPROVAL_OVERCLAIM')
  assert.equal(evidence.publication_authorized, false, 'WP11_CURRENT_PUBLICATION_OVERCLAIM')
  assert.equal(evidence.deployment_authorized, false, 'WP11_CURRENT_DEPLOYMENT_OVERCLAIM')
  assert.equal(evidence.planner_runtime_status, 'disabled', 'WP11_CURRENT_PLANNER_ENABLED')
  assert.equal(evidence.coverage_copy_status, 'historical_reference_owner_approval_pending', 'WP11_CURRENT_COVERAGE_STATUS')
  assert.equal(evidence.work_package_acceptance_status, 'blocked_external_dependencies_and_human_studies', 'WP11_CURRENT_ACCEPTANCE_OVERCLAIM')
  assert.equal(evidence.technical_foundation_status, 'pass', 'WP11_CURRENT_FOUNDATION_STATUS')
}

/**
 * Prove the sealed 154 historical input pins from retained snapshot bytes.
 * Current tree bytes are never substituted into this proof.
 */
export async function validateHistoricalInputBindings({
  root = repoRoot,
  receipt,
  expected = HISTORICAL_WP11_V1_3,
  snapshot,
} = {}) {
  const files = receipt?.technical_evidence?.files
  assert.ok(Array.isArray(files) && files.length > 0, 'WP11_HISTORICAL_INPUT_PINS_MISSING')
  assert.equal(files.length, SEALED_WP11_FILE_COUNT, 'WP11_HISTORICAL_INPUT_COUNT')
  const retained = snapshot ?? await readHistoricalPreimageSnapshot({ root })
  assert.equal(retained.status, 'PASS', 'WP11_SNAPSHOT_STATUS')
  assert.equal(retained.subject_sha256, expected.subject_sha256, 'WP11_SNAPSHOT_SUBJECT')
  assert.equal(retained.subject_sha256, HISTORICAL_WP11_SUBJECT_SHA256, 'WP11_SNAPSHOT_SUBJECT')
  assert.equal(retained.source_commit, expected.source_commit, 'WP11_SNAPSHOT_SOURCE_COMMIT')
  assert.equal(retained.source_commit, HISTORICAL_WP11_SOURCE_COMMIT, 'WP11_SNAPSHOT_SOURCE_COMMIT')
  assert.equal(retained.receipt_sha256, SEALED_WP11_RECEIPT_SHA256, 'WP11_SNAPSHOT_RECEIPT_HASH')
  assert.equal(retained.file_count, SEALED_WP11_FILE_COUNT, 'WP11_SNAPSHOT_FILE_COUNT')
  assert.equal(retained.total_bytes, SEALED_WP11_TOTAL_BYTES, 'WP11_SNAPSHOT_TOTAL_BYTES')
  assert.equal(retained.git_required, false, 'WP11_SNAPSHOT_GIT_REQUIRED')
  assert.equal(retained.execute_retained_sources, false, 'WP11_SNAPSHOT_EXECUTE_RETAINED_SOURCES')

  const snapshotByPath = new Map(retained.files.map((pin) => [pin.path, pin]))
  const seen = new Set()
  let totalBytes = 0
  for (const pin of files) {
    const relativePath = safeRelativePath(pin.path, 'INPUT')
    assert.ok(!seen.has(relativePath), 'WP11_HISTORICAL_DUPLICATE_INPUT_PIN')
    seen.add(relativePath)
    const retainedPin = snapshotByPath.get(relativePath)
    assert.ok(retainedPin, 'WP11_SNAPSHOT_INPUT_MISSING')
    assertHash(pin.sha256, `${relativePath}_HISTORICAL_HASH`)
    assert.equal(Number.isInteger(pin.bytes), true, `WP11_HISTORICAL_INPUT_${relativePath}_BYTES_TYPE`)
    assert.equal(retainedPin.sha256, pin.sha256, `WP11_HISTORICAL_INPUT_${relativePath}_CHANGED`)
    assert.equal(retainedPin.bytes, pin.bytes, `WP11_HISTORICAL_INPUT_${relativePath}_BYTES`)
    const bytes = retained.bytesByPath.get(relativePath)
    assert.ok(bytes && bytes.length === pin.bytes, `WP11_SNAPSHOT_${relativePath}_EMPTY`)
    assert.equal(sha256(bytes), pin.sha256, `WP11_SNAPSHOT_${relativePath}_SUBSTITUTED`)
    totalBytes += bytes.length
  }
  assert.equal(seen.size, SEALED_WP11_FILE_COUNT, 'WP11_HISTORICAL_INPUT_COUNT')
  assert.equal(snapshotByPath.size, SEALED_WP11_FILE_COUNT, 'WP11_SNAPSHOT_EXTRA_INPUT')
  for (const relativePath of snapshotByPath.keys()) {
    assert.ok(seen.has(relativePath), 'WP11_SNAPSHOT_UNSEALED_PATH')
  }
  assert.equal(totalBytes, SEALED_WP11_TOTAL_BYTES, 'WP11_SNAPSHOT_TOTAL_BYTES')
  return {
    status: 'PASS',
    source: retained.source,
    source_commit: retained.source_commit,
    historical_file_count: SEALED_WP11_FILE_COUNT,
    total_bytes: SEALED_WP11_TOTAL_BYTES,
    unchanged_count: SEALED_WP11_FILE_COUNT,
    unique_blob_count: retained.unique_blob_count,
    git_required: false,
    execute_retained_sources: false,
    receipt_sha256: retained.receipt_sha256,
    subject_sha256: retained.subject_sha256,
    snapshot_dir: retained.snapshot_dir,
    inventory_path: retained.inventory_path,
  }
}

function currentInputRole(relativePath, bytes) {
  if (relativePath === 'package.json') {
    try {
      const provenance = packageProvenanceFor(bytes)
      return provenance.reviewed_pr003_transition ? 'reviewed_pr003_package_transition' : 'original_pr085_git_snapshot'
    } catch {
      return 'unreviewed_package_json'
    }
  }
  if (relativePath === 'package-lock.json') {
    try {
      const lockState = lockStateFor(bytes)
      return lockState === 'pr085_ci_v14' ? 'pr085_ci_v14_workspace_lock' : 'historical_package_lock'
    } catch {
      return 'unreviewed_package_lock'
    }
  }
  return 'current_unapproved_input_change'
}

/**
 * Compare every sealed historical input against current candidate bytes and
 * report the complete changed set. This is not historical approval, current
 * approval, or combined-candidate acceptance.
 */
export async function reportCurrentVersusHistoricalInputs({
  root = repoRoot,
  snapshot,
  readCurrentFile = readCurrent,
  currentSource = 'current_tree',
} = {}) {
  const retained = snapshot ?? await readHistoricalPreimageSnapshot({ root })
  assert.equal(retained.file_count, SEALED_WP11_FILE_COUNT, 'WP11_SNAPSHOT_FILE_COUNT')
  const changed = []
  let unchangedCount = 0
  for (const pin of retained.files) {
    const relativePath = safeRelativePath(pin.path, 'CURRENT_INPUT')
    const bytes = await readCurrentFile(root, relativePath)
    assert.ok(bytes && bytes.length > 0, `WP11_CURRENT_${relativePath}_EMPTY`)
    const currentSha256 = sha256(bytes)
    if (currentSha256 === pin.sha256 && bytes.length === pin.bytes) {
      unchangedCount += 1
      continue
    }
    changed.push({
      path: relativePath,
      historical_bytes: pin.bytes,
      historical_sha256: pin.sha256,
      historical_source: 'retained_historical_preimage_snapshot',
      current_bytes: bytes.length,
      current_sha256: currentSha256,
      current_source: currentSource,
      role: currentInputRole(relativePath, bytes),
    })
  }
  changed.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  assert.equal(unchangedCount + changed.length, SEALED_WP11_FILE_COUNT, 'WP11_CURRENT_DIFF_COUNT')
  const unreviewed = changed.filter((item) => item.role === 'unreviewed_package_json' || item.role === 'unreviewed_package_lock')
  if (unreviewed.length > 0) {
    const error = new Error(`WP11_CURRENT_INPUT_UNREVIEWED_DRIFT:${unreviewed.map((item) => item.path).join(',')}`)
    error.changed = changed
    throw error
  }
  return {
    status: 'PASS',
    compared_file_count: SEALED_WP11_FILE_COUNT,
    changed_count: changed.length,
    unchanged_count: unchangedCount,
    changed,
    approval: null,
    current_approval_issued: false,
    historical_approval_transferred: false,
    combined_acceptance: false,
    release_qualified: false,
  }
}

export function builderCoverageLimits() {
  return {
    historical_inventory_file_count: SEALED_WP11_FILE_COUNT,
    unpinned_legacy_builder_reads: WP11_BUILDER_UNPINNED_READS.map((path) => ({
      path,
      in_sealed_inventory: false,
    })),
    note: 'The existing WP11 v1.3 technical builder reads these paths without listing them in technical_evidence.files. This assignment does not expand historical package scope, does not treat those reads as sealed historical pins, and does not imply full release qualification.',
  }
}

export async function assertCurrentWrapperPolicy({
  root = repoRoot,
  implementationFiles,
  policy,
} = {}) {
  const policyBytes = policy
    ? Buffer.from(JSON.stringify(policy))
    : await readFile(path.resolve(root, WP11_POLICY_PATH))
  const parsed = policy ?? parseJson(policyBytes, 'POLICY')
  const snapshotPin = parsed.historical_preimage_snapshot
  const readerPin = parsed.historical_preimage_reader
  assert.ok(snapshotPin && typeof snapshotPin === 'object', 'WP11_WRAPPER_SNAPSHOT_BINDING_MISSING')
  assert.ok(readerPin && typeof readerPin === 'object', 'WP11_WRAPPER_READER_BINDING_MISSING')
  const inventory = implementationFiles.find((file) => file.path === HISTORICAL_PREIMAGE_INVENTORY_PATH)
  const reader = implementationFiles.find((file) => file.path === HISTORICAL_PREIMAGE_READER_PATH)
  assert.ok(inventory, 'WP11_WRAPPER_SNAPSHOT_BINDING_MISSING')
  assert.ok(reader, 'WP11_WRAPPER_READER_BINDING_MISSING')
  assert.equal(snapshotPin.path, HISTORICAL_PREIMAGE_INVENTORY_PATH, 'WP11_WRAPPER_POLICY_STALE_SNAPSHOT')
  assert.equal(snapshotPin.sha256, inventory.sha256, 'WP11_WRAPPER_POLICY_STALE_SNAPSHOT')
  assert.equal(snapshotPin.bytes, inventory.bytes, 'WP11_WRAPPER_POLICY_STALE_SNAPSHOT')
  assert.equal(snapshotPin.file_count, SEALED_WP11_FILE_COUNT, 'WP11_WRAPPER_POLICY_STALE_SNAPSHOT')
  assert.equal(snapshotPin.total_bytes, SEALED_WP11_TOTAL_BYTES, 'WP11_WRAPPER_POLICY_STALE_SNAPSHOT')
  assert.equal(snapshotPin.execute_retained_sources, false, 'WP11_WRAPPER_POLICY_EXECUTE_RETAINED_SOURCES')
  assert.equal(readerPin.path, HISTORICAL_PREIMAGE_READER_PATH, 'WP11_WRAPPER_POLICY_STALE_READER')
  assert.equal(readerPin.sha256, reader.sha256, 'WP11_WRAPPER_POLICY_STALE_READER')
  assert.equal(readerPin.bytes, reader.bytes, 'WP11_WRAPPER_POLICY_STALE_READER')
  const declared = parsed.wrapper_implementation_files
  assert.ok(Array.isArray(declared), 'WP11_WRAPPER_POLICY_BINDINGS_MISSING')
  for (const name of WP11_WRAPPER_IMPLEMENTATION_FILES) {
    assert.ok(declared.includes(name), 'WP11_WRAPPER_POLICY_STALE_BINDINGS')
    assert.ok(implementationFiles.some((file) => file.path === name), 'WP11_WRAPPER_FILE_MISSING')
  }
  return parsed
}

/**
 * Validate immutable WP11 v1.3 approval, evidence, approved receipt and
 * required predecessor proof from supplied bytes. Never writes a receipt and
 * never applies the historical approval to a current subject.
 */
export async function validateHistoricalWp11Proof({
  approvalBytes,
  evidenceBytes,
  receiptBytes,
  predecessorManifestBytes,
  predecessorReceiptBytes,
  previousSuccessorBytes,
  expected = HISTORICAL_WP11_V1_3,
  root = repoRoot,
  snapshot,
} = {}) {
  const files = expected.files ?? HISTORICAL_WP11_V1_3.files
  const bytesByName = { approval: approvalBytes, evidence: evidenceBytes, receipt: receiptBytes }
  for (const name of ['approval', 'evidence', 'receipt']) {
    const bytes = bytesByName[name]
    assert.ok(bytes && bytes.length > 0, `WP11_HISTORICAL_MISSING_${name.toUpperCase()}`)
    verifyPin(files[name], bytes, name.toUpperCase())
  }

  const approval = parseJson(approvalBytes, 'APPROVAL')
  const receipt = parseJson(receiptBytes, 'RECEIPT')
  assert.equal(approval.schema_version, 'ushso-successor-approval.v1.0.0', 'WP11_HISTORICAL_APPROVAL_SCHEMA')
  assert.equal(approval.status, 'approved', 'WP11_HISTORICAL_APPROVAL_STATUS')
  assert.equal(approval.package_id, expected.package_id, 'WP11_HISTORICAL_APPROVAL_PACKAGE')
  assert.equal(approval.subject_sha256, expected.subject_sha256, 'WP11_HISTORICAL_APPROVAL_SUBJECT')
  assert.equal(receipt.schema_version, 'ushso-successor-attestation.v1.0.0', 'WP11_HISTORICAL_RECEIPT_SCHEMA')
  assert.equal(receipt.package_id, expected.package_id, 'WP11_HISTORICAL_RECEIPT_PACKAGE')
  assert.equal(receipt.status, 'approved_scoped_attestation', 'WP11_HISTORICAL_RECEIPT_STATUS')
  assert.equal(receipt.technical_status, 'PASS', 'WP11_HISTORICAL_RECEIPT_TECHNICAL_STATUS')
  assert.equal(receipt.subject_sha256, expected.subject_sha256, 'WP11_HISTORICAL_RECEIPT_SUBJECT')
  for (const field of ['release_gate_pass', 'release_ready', 'production_eligibility']) {
    assert.equal(receipt[field], false, `WP11_HISTORICAL_RECEIPT_${field.toUpperCase()}_OVERCLAIM`)
  }
  assert.ok(receipt.technical_evidence && typeof receipt.technical_evidence === 'object', 'WP11_HISTORICAL_RECEIPT_TECHNICAL_EVIDENCE')
  assert.ok(receipt.approval && typeof receipt.approval === 'object', 'WP11_HISTORICAL_RECEIPT_APPROVAL')
  for (const field of ['schema_version', 'status', 'package_id', 'subject_sha256', 'reviewer', 'recorded_at', 'evidence_sha256', 'attestation']) {
    assert.deepEqual(receipt.approval[field], approval[field], `WP11_HISTORICAL_APPROVAL_POINTER_${field}`)
  }
  assert.equal(receipt.approval.evidence_sha256, sha256(evidenceBytes), 'WP11_HISTORICAL_EVIDENCE_HASH')

  const historicalDraft = createDraft(expected.package_id, receipt.technical_evidence)
  assert.equal(historicalDraft.subject_sha256, expected.subject_sha256, 'WP11_HISTORICAL_RECOMPUTED_SUBJECT')
  validateApproval(historicalDraft, receipt.approval, Buffer.from(evidenceBytes))
  assert.deepEqual(
    { ...receipt, status: historicalDraft.status, approval: null },
    historicalDraft,
    'WP11_HISTORICAL_RECEIPT_DRAFT_MISMATCH',
  )

  assert.ok(predecessorManifestBytes && predecessorManifestBytes.length > 0, 'WP11_HISTORICAL_MISSING_PREDECESSOR_MANIFEST')
  assert.ok(predecessorReceiptBytes && predecessorReceiptBytes.length > 0, 'WP11_HISTORICAL_MISSING_PREDECESSOR_RECEIPT')
  assert.ok(previousSuccessorBytes && previousSuccessorBytes.length > 0, 'WP11_HISTORICAL_MISSING_PREVIOUS_SUCCESSOR')
  verifyPin(expected.predecessor_manifest, predecessorManifestBytes, 'PREDECESSOR_MANIFEST')
  verifyPin(expected.predecessor_receipt, predecessorReceiptBytes, 'PREDECESSOR_RECEIPT')
  verifyPin(expected.previous_successor, previousSuccessorBytes, 'PREVIOUS_SUCCESSOR')

  const predecessorManifest = parseJson(predecessorManifestBytes, 'PREDECESSOR_MANIFEST')
  const predecessorReceipt = parseJson(predecessorReceiptBytes, 'PREDECESSOR_RECEIPT')
  const previousSuccessor = parseJson(previousSuccessorBytes, 'PREVIOUS_SUCCESSOR')
  assert.equal(predecessorManifest.schema_version, 'ushso-wp11-implementation-file-manifest.v1.0.0', 'WP11_HISTORICAL_PREDECESSOR_MANIFEST_SCHEMA')
  assert.equal(predecessorReceipt.schema_version, 'ushso-wp11-verification-receipt.v1.0.0', 'WP11_HISTORICAL_PREDECESSOR_RECEIPT_SCHEMA')
  assert.equal(predecessorReceipt.technical_foundation_status, 'pass', 'WP11_HISTORICAL_PREDECESSOR_RECEIPT_STATUS')
  assert.equal(predecessorReceipt.planner_runtime_status, 'disabled', 'WP11_HISTORICAL_PREDECESSOR_PLANNER_ENABLED')
  assert.equal(previousSuccessor.package_id, expected.previous_successor.package_id, 'WP11_HISTORICAL_PREVIOUS_SUCCESSOR_PACKAGE')
  assert.equal(previousSuccessor.status, 'approved_scoped_attestation', 'WP11_HISTORICAL_PREVIOUS_SUCCESSOR_STATUS')
  assert.equal(previousSuccessor.release_gate_pass, false, 'WP11_HISTORICAL_PREVIOUS_SUCCESSOR_RELEASE_OVERCLAIM')
  assert.equal(previousSuccessor.production_eligibility, false, 'WP11_HISTORICAL_PREVIOUS_SUCCESSOR_PRODUCTION_OVERCLAIM')
  assert.equal(receipt.technical_evidence.predecessor_manifest_sha256, expected.predecessor_manifest.sha256, 'WP11_HISTORICAL_RECEIPT_PREDECESSOR_MANIFEST_HASH')
  assert.equal(receipt.technical_evidence.predecessor_receipt_sha256, expected.predecessor_receipt.sha256, 'WP11_HISTORICAL_RECEIPT_PREDECESSOR_RECEIPT_HASH')
  assert.equal(receipt.technical_evidence.previous_successor_receipt?.path, expected.previous_successor.path, 'WP11_HISTORICAL_RECEIPT_PREVIOUS_PATH')
  assert.equal(receipt.technical_evidence.previous_successor_receipt?.sha256, expected.previous_successor.sha256, 'WP11_HISTORICAL_RECEIPT_PREVIOUS_HASH')

  const inputBindings = await validateHistoricalInputBindings({ root, receipt, expected, snapshot })
  return {
    package_id: expected.package_id,
    subject_sha256: expected.subject_sha256,
    approval_status: 'approved_original_subject_only',
    receipt_status: receipt.status,
    reviewer: receipt.approval.reviewer,
    recorded_at: receipt.approval.recorded_at,
    evidence_sha256: receipt.approval.evidence_sha256,
    source_commit: expected.source_commit,
    files: Object.fromEntries(Object.entries(files).map(([name, pin]) => [name, { path: pin.path, bytes: pin.bytes, sha256: pin.sha256 }])),
    predecessor_manifest: { ...expected.predecessor_manifest },
    predecessor_receipt: { ...expected.predecessor_receipt },
    previous_successor: { path: expected.previous_successor.path, bytes: expected.previous_successor.bytes, sha256: expected.previous_successor.sha256, package_id: expected.previous_successor.package_id },
    input_bindings: inputBindings,
  }
}

export async function readHistoricalWp11Proof(root = repoRoot) {
  const pins = HISTORICAL_WP11_V1_3.files
  const [approvalBytes, evidenceBytes, receiptBytes, predecessorManifestBytes, predecessorReceiptBytes, previousSuccessorBytes] = await Promise.all([
    readFile(path.resolve(root, pins.approval.path)),
    readFile(path.resolve(root, pins.evidence.path)),
    readFile(path.resolve(root, pins.receipt.path)),
    readFile(path.resolve(root, HISTORICAL_WP11_V1_3.predecessor_manifest.path)),
    readFile(path.resolve(root, HISTORICAL_WP11_V1_3.predecessor_receipt.path)),
    readFile(path.resolve(root, HISTORICAL_WP11_V1_3.previous_successor.path)),
  ])
  return validateHistoricalWp11Proof({
    approvalBytes,
    evidenceBytes,
    receiptBytes,
    predecessorManifestBytes,
    predecessorReceiptBytes,
    previousSuccessorBytes,
    root,
  })
}

export async function buildCurrentWp11Draft({
  technicalEvidenceBuilder = buildTechnicalEvidence,
  validateCurrent = validateCandidateEvidence,
  root = repoRoot,
} = {}) {
  const technicalEvidence = await technicalEvidenceBuilder({ repoRoot: root })
  if (validateCurrent) {
    const validation = await validateCurrent(technicalEvidence, { repoRoot: root })
    assert.equal(validation.status, 'technical_evidence_valid', 'WP11_CURRENT_EVIDENCE_INVALID')
    assert.equal(validation.approval_status, 'pending_authorized_review', 'WP11_CURRENT_EVIDENCE_APPROVAL_OVERCLAIM')
    assertDisabledCurrentFeatures(technicalEvidence)
  }
  const draft = createDraft(WP11_PACKAGE_ID, technicalEvidence)
  assert.equal(draft.status, 'pending_authorized_review', 'WP11_CURRENT_DRAFT_STATUS')
  assert.equal(draft.technical_status, 'PASS', 'WP11_CURRENT_DRAFT_TECHNICAL_STATUS')
  assert.equal(draft.approval, null, 'WP11_CURRENT_DRAFT_APPROVAL')
  assert.equal(draft.release_gate_pass, false, 'WP11_CURRENT_DRAFT_RELEASE_OVERCLAIM')
  assert.equal(draft.release_ready, false, 'WP11_CURRENT_DRAFT_RELEASE_READY_OVERCLAIM')
  assert.equal(draft.production_eligibility, false, 'WP11_CURRENT_DRAFT_PRODUCTION_OVERCLAIM')
  assert.notEqual(draft.subject_sha256, HISTORICAL_WP11_V1_3.subject_sha256, 'WP11_CURRENT_DRAFT_REUSED_HISTORICAL_SUBJECT')
  return draft
}

export async function bindWrapperImplementation({
  root = repoRoot,
  implementationFileNames = WP11_WRAPPER_IMPLEMENTATION_FILES,
  policy,
} = {}) {
  const implementationFiles = await pinFiles(root, implementationFileNames)
  assert.equal(implementationFiles.length, new Set(implementationFileNames).size, 'WP11_WRAPPER_FILE_COUNT')
  for (const file of implementationFiles) {
    assert.ok(file.bytes > 0, `WP11_WRAPPER_${file.path}_EMPTY`)
    assertHash(file.sha256, `WRAPPER_${file.path}`)
  }
  await assertCurrentWrapperPolicy({ root, implementationFiles, policy })
  const technicalEvidence = {
    status: 'PASS',
    schema_version: 'ushso.wp11-current-attestation-adapter.v1.3.0',
    work_package: 'WP11',
    route: { ...REVIEWED_WP11_ROUTE },
    historical_package_id: WP11_PACKAGE_ID,
    historical_subject_sha256: HISTORICAL_WP11_V1_3.subject_sha256,
    implementation_files: implementationFiles,
    historical_preimage_snapshot: {
      path: HISTORICAL_PREIMAGE_INVENTORY_PATH,
      file_count: SEALED_WP11_FILE_COUNT,
      total_bytes: SEALED_WP11_TOTAL_BYTES,
      source_commit: HISTORICAL_WP11_SOURCE_COMMIT,
      receipt_sha256: SEALED_WP11_RECEIPT_SHA256,
      execute_retained_sources: false,
    },
    historical_preimage_reader: {
      path: HISTORICAL_PREIMAGE_READER_PATH,
    },
    writes_approval_artifacts: false,
    accepts_issue_option: false,
    historical_approval_applied: false,
    current_approval_issued: false,
    release_gate_pass: false,
    release_ready: false,
    production_eligibility: false,
  }
  const draft = createDraft(WP11_WRAPPER_PACKAGE_ID, technicalEvidence)
  assert.equal(draft.status, 'pending_authorized_review', 'WP11_WRAPPER_DRAFT_STATUS')
  assert.equal(draft.approval, null, 'WP11_WRAPPER_DRAFT_APPROVAL')
  assert.equal(draft.release_gate_pass, false, 'WP11_WRAPPER_RELEASE_OVERCLAIM')
  assert.notEqual(draft.subject_sha256, HISTORICAL_WP11_V1_3.subject_sha256, 'WP11_WRAPPER_REUSED_HISTORICAL_SUBJECT')
  return draft
}

function assertHistoricalApprovalRejected(draft, approval, evidenceBytes, expectedCode) {
  assert.throws(
    () => validateApproval(draft, approval, evidenceBytes),
    new RegExp(expectedCode),
  )
}

export async function verifyWp11Attestation({
  root = repoRoot,
  technicalEvidenceBuilder = buildTechnicalEvidence,
  validateCurrent = validateCandidateEvidence,
  readCurrentFile = readCurrent,
} = {}) {
  const historical = await readHistoricalWp11Proof(root)
  const currentDraft = await buildCurrentWp11Draft({ technicalEvidenceBuilder, validateCurrent, root })
  const wrapperDraft = await bindWrapperImplementation({ root })
  assert.notEqual(wrapperDraft.subject_sha256, currentDraft.subject_sha256, 'WP11_WRAPPER_REUSED_TECHNICAL_SUBJECT')
  const currentVersusHistorical = await reportCurrentVersusHistoricalInputs({
    root,
    readCurrentFile,
    currentSource: 'current_tree',
  })

  const approvalBytes = await readFile(path.resolve(root, HISTORICAL_WP11_V1_3.files.approval.path))
  const evidenceBytes = await readFile(path.resolve(root, HISTORICAL_WP11_V1_3.files.evidence.path))
  const approval = JSON.parse(Buffer.from(approvalBytes).toString('utf8'))
  assertHistoricalApprovalRejected(currentDraft, approval, evidenceBytes, 'SUCCESSOR_APPROVAL_STALE_SUBJECT')
  assertHistoricalApprovalRejected(wrapperDraft, approval, evidenceBytes, 'SUCCESSOR_APPROVAL_WRONG_PACKAGE')

  return {
    schema_version: 'ushso.wp11-v13-attestation.v1.0.0',
    status: 'PASS',
    package_id: WP11_PACKAGE_ID,
    wrapper_package_id: WP11_WRAPPER_PACKAGE_ID,
    historical,
    current: {
      subject_kind: 'wp11-technical-draft',
      package_id: WP11_PACKAGE_ID,
      subject_sha256: currentDraft.subject_sha256,
      technical_status: currentDraft.technical_status,
      status: currentDraft.status,
      approval: null,
      approval_status: 'absent_for_current_subject',
      release_gate_pass: false,
      release_ready: false,
      production_eligibility: false,
      planner_runtime_status: currentDraft.technical_evidence.planner_runtime_status ?? 'disabled',
      file_count: currentDraft.technical_evidence.files?.length ?? 0,
    },
    wrapper: {
      subject_kind: 'wp11-current-attestation-adapter',
      package_id: WP11_WRAPPER_PACKAGE_ID,
      subject_sha256: wrapperDraft.subject_sha256,
      technical_status: wrapperDraft.technical_status,
      status: wrapperDraft.status,
      approval: null,
      approval_status: 'absent_for_current_subject',
      release_gate_pass: false,
      release_ready: false,
      production_eligibility: false,
      implementation_files: wrapperDraft.technical_evidence.implementation_files,
      historical_preimage_snapshot: wrapperDraft.technical_evidence.historical_preimage_snapshot,
      historical_preimage_reader: wrapperDraft.technical_evidence.historical_preimage_reader,
    },
    current_versus_historical: currentVersusHistorical,
    builder_coverage_limits: builderCoverageLimits(),
    boundaries: {
      historical_approval_reused: false,
      historical_receipt_overwritten: false,
      historical_approval_applied_to_current_technical_subject: false,
      historical_approval_applied_to_wrapper_subject: false,
      current_approval_issued: false,
      current_release_qualified: false,
      production_authorized: false,
      writes_approval_artifacts: false,
      combined_acceptance: false,
    },
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.slice(2).length, 0, 'WP11_ATTESTATION_ARGUMENTS_UNSUPPORTED')
    process.stdout.write(JSON.stringify(await verifyWp11Attestation(), null, 2) + '\n')
  } catch (error) {
    process.stderr.write('WP11 current attestation failed closed: ' + error.message + '\n')
    process.exitCode = 1
  }
}
