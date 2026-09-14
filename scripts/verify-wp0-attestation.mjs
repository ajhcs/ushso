import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildTechnicalEvidence,
  packageId,
  repoRoot,
} from '../verification/wp0/v1.4.0/tools/verify.mjs'
import {
  createDraft,
  sha256,
  validateApproval,
} from '../verification/successor-support.mjs'

const SHA256 = /^[a-f0-9]{64}$/u

export const HISTORICAL_WP0_V1_4 = Object.freeze({
  package_id: packageId,
  subject_sha256: '0098ee424bc58120f48167c580b7db19b556d0aee42929d1da56664f78993cb5',
  files: Object.freeze({
    approval: Object.freeze({
      path: 'verification/wp0/v1.4.0/approvals/approval.json',
      sha256: 'd1636ed70d3cff146666a54ea5f9e493e94386649d827c1a424504c244759c05',
    }),
    evidence: Object.freeze({
      path: 'verification/wp0/v1.4.0/approvals/evidence.txt',
      sha256: '1aed5b57042a3a3609666b7678d6d9e6d17d607850dce4ecc90b99320b25ea42',
    }),
    receipt: Object.freeze({
      path: 'verification/wp0/v1.4.0/receipts/approved.json',
      sha256: '15b79d25a52487597236c545b4f9e27be05203850b6e5076b671d6104390a5b8',
    }),
  }),
})

function parseJson(bytes, label) {
  assert.ok(bytes && bytes.length > 0, 'WP0_HISTORICAL_MISSING_' + label)
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8'))
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'WP0_HISTORICAL_' + label + '_SHAPE')
    return value
  } catch (error) {
    if (error.name === 'AssertionError') throw error
    throw new Error('WP0_HISTORICAL_' + label + '_MALFORMED: ' + error.message, { cause: error })
  }
}

function assertHexSubject(value, label) {
  assert.equal(typeof value, 'string', 'WP0_HISTORICAL_' + label + '_TYPE')
  assert.match(value, SHA256, 'WP0_HISTORICAL_' + label + '_FORMAT')
}

function expectedPins(expected) {
  const pins = expected?.files ?? HISTORICAL_WP0_V1_4.files
  for (const name of ['approval', 'evidence', 'receipt']) {
    assertHexSubject(pins[name]?.sha256, name.toUpperCase() + '_PIN')
  }
  return pins
}

/**
 * Validate immutable historical proof from supplied bytes.
 *
 * The function is deliberately byte-oriented so callers and tests cannot
 * replace a historical file with a newly generated equivalent JSON object.
 * It only validates an in-memory approved receipt; it never writes a receipt.
 */
export function validateHistoricalProof({ approvalBytes, evidenceBytes, receiptBytes, expected = HISTORICAL_WP0_V1_4 } = {}) {
  const pins = expectedPins(expected)
  const expectedPackageId = expected.package_id ?? packageId
  const expectedSubject = expected.subject_sha256
  assertHexSubject(expectedSubject, 'EXPECTED_SUBJECT')

  const bytesByName = { approval: approvalBytes, evidence: evidenceBytes, receipt: receiptBytes }
  for (const name of ['approval', 'evidence', 'receipt']) {
    const bytes = bytesByName[name]
    assert.ok(bytes && bytes.length > 0, 'WP0_HISTORICAL_MISSING_' + name.toUpperCase())
    assert.equal(sha256(bytes), pins[name].sha256, 'WP0_HISTORICAL_' + name.toUpperCase() + '_CHANGED')
  }

  const approval = parseJson(approvalBytes, 'APPROVAL')
  const receipt = parseJson(receiptBytes, 'RECEIPT')
  assert.equal(approval.schema_version, 'ushso-successor-approval.v1.0.0', 'WP0_HISTORICAL_APPROVAL_SCHEMA')
  assert.equal(approval.status, 'approved', 'WP0_HISTORICAL_APPROVAL_STATUS')
  assert.equal(approval.package_id, expectedPackageId, 'WP0_HISTORICAL_APPROVAL_PACKAGE')
  assert.equal(approval.subject_sha256, expectedSubject, 'WP0_HISTORICAL_APPROVAL_SUBJECT')

  assert.equal(receipt.schema_version, 'ushso-successor-attestation.v1.0.0', 'WP0_HISTORICAL_RECEIPT_SCHEMA')
  assert.equal(receipt.package_id, expectedPackageId, 'WP0_HISTORICAL_RECEIPT_PACKAGE')
  assert.equal(receipt.status, 'approved_scoped_attestation', 'WP0_HISTORICAL_RECEIPT_STATUS')
  assert.equal(receipt.technical_status, 'PASS', 'WP0_HISTORICAL_RECEIPT_TECHNICAL_STATUS')
  assert.ok(receipt.technical_evidence && typeof receipt.technical_evidence === 'object', 'WP0_HISTORICAL_RECEIPT_TECHNICAL_EVIDENCE')
  assert.equal(receipt.subject_sha256, expectedSubject, 'WP0_HISTORICAL_RECEIPT_SUBJECT')
  assert.equal(receipt.release_gate_pass, false, 'WP0_HISTORICAL_RECEIPT_RELEASE_OVERCLAIM')
  assert.equal(receipt.release_ready, false, 'WP0_HISTORICAL_RECEIPT_RELEASE_READY_OVERCLAIM')
  assert.equal(receipt.production_eligibility, false, 'WP0_HISTORICAL_RECEIPT_PRODUCTION_OVERCLAIM')
  assert.ok(receipt.approval && typeof receipt.approval === 'object', 'WP0_HISTORICAL_RECEIPT_APPROVAL')

  // approval.json is the historical identity pointer; approved.json carries
  // the complete approval needed by the shared successor validator.
  for (const field of ['schema_version', 'status', 'package_id', 'subject_sha256']) {
    assert.equal(receipt.approval[field], approval[field], 'WP0_HISTORICAL_APPROVAL_POINTER_' + field)
  }
  assert.equal(receipt.approval.evidence_sha256, sha256(evidenceBytes), 'WP0_HISTORICAL_EVIDENCE_HASH')

  const historicalDraft = createDraft(expectedPackageId, receipt.technical_evidence)
  assert.equal(historicalDraft.subject_sha256, expectedSubject, 'WP0_HISTORICAL_RECOMPUTED_SUBJECT')
  assert.equal(historicalDraft.status, 'pending_authorized_review', 'WP0_HISTORICAL_DRAFT_STATUS')
  assert.equal(historicalDraft.approval, null, 'WP0_HISTORICAL_DRAFT_APPROVAL')
  assert.equal(historicalDraft.release_gate_pass, false, 'WP0_HISTORICAL_DRAFT_RELEASE_OVERCLAIM')
  assert.equal(historicalDraft.release_ready, false, 'WP0_HISTORICAL_DRAFT_RELEASE_READY_OVERCLAIM')
  assert.equal(historicalDraft.production_eligibility, false, 'WP0_HISTORICAL_DRAFT_PRODUCTION_OVERCLAIM')
  validateApproval(historicalDraft, receipt.approval, Buffer.from(evidenceBytes))
  assert.deepEqual(
    { ...receipt, status: historicalDraft.status, approval: null },
    historicalDraft,
    'WP0_HISTORICAL_RECEIPT_DRAFT_MISMATCH',
  )

  return {
    package_id: expectedPackageId,
    subject_sha256: expectedSubject,
    approval_status: 'approved_original_subject_only',
    receipt_status: receipt.status,
    reviewer: receipt.approval.reviewer,
    recorded_at: receipt.approval.recorded_at,
    evidence_sha256: receipt.approval.evidence_sha256,
    files: Object.fromEntries(Object.entries(pins).map(([name, pin]) => [name, { path: pin.path, sha256: pin.sha256 }])),
  }
}

export async function readHistoricalProof(root = repoRoot) {
  const pins = HISTORICAL_WP0_V1_4.files
  const [approvalBytes, evidenceBytes, receiptBytes] = await Promise.all([
    readFile(path.resolve(root, pins.approval.path)),
    readFile(path.resolve(root, pins.evidence.path)),
    readFile(path.resolve(root, pins.receipt.path)),
  ])
  return validateHistoricalProof({ approvalBytes, evidenceBytes, receiptBytes })
}

export async function buildCurrentDraft({ technicalEvidenceBuilder = buildTechnicalEvidence } = {}) {
  const technicalEvidence = await technicalEvidenceBuilder()
  const draft = createDraft(packageId, technicalEvidence)
  assert.equal(draft.status, 'pending_authorized_review', 'WP0_CURRENT_DRAFT_STATUS')
  assert.equal(draft.technical_status, 'PASS', 'WP0_CURRENT_DRAFT_TECHNICAL_STATUS')
  assert.equal(draft.approval, null, 'WP0_CURRENT_DRAFT_APPROVAL')
  assert.equal(draft.release_gate_pass, false, 'WP0_CURRENT_DRAFT_RELEASE_OVERCLAIM')
  assert.equal(draft.release_ready, false, 'WP0_CURRENT_DRAFT_RELEASE_READY_OVERCLAIM')
  assert.equal(draft.production_eligibility, false, 'WP0_CURRENT_DRAFT_PRODUCTION_OVERCLAIM')
  assert.notEqual(draft.subject_sha256, HISTORICAL_WP0_V1_4.subject_sha256, 'WP0_CURRENT_DRAFT_REUSED_HISTORICAL_SUBJECT')
  assert.ok(
    draft.technical_evidence.implementation_files?.some(file => file.path === 'scripts/verify-wp0-attestation.mjs'),
    'WP0_CURRENT_VERIFIER_NOT_IN_IMPLEMENTATION_INVENTORY',
  )
  return draft
}

export async function verifyWp0Attestation({ root = repoRoot, technicalEvidenceBuilder = buildTechnicalEvidence } = {}) {
  const historical = await readHistoricalProof(root)
  const currentDraft = await buildCurrentDraft({ technicalEvidenceBuilder })
  return {
    schema_version: 'ushso.wp0-ci-attestation.v1.0.0',
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
    },
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.slice(2).length, 0, 'WP0_ATTESTATION_ARGUMENTS_UNSUPPORTED')
    process.stdout.write(JSON.stringify(await verifyWp0Attestation(), null, 2) + '\n')
  } catch (error) {
    process.stderr.write('WP0 current CI attestation failed closed: ' + error.message + '\n')
    process.exitCode = 1
  }
}
