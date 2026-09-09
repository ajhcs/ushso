import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTechnicalEvidence as buildInventory } from './ci-inventory.mjs'
import { createDraft, sha256, pinFiles, listFiles, runSuccessorCli } from '../../../../successor-support.mjs'

export const packageId = '@ushso/ci-verification-successor-v1-3@1.3.0'
export const predecessorSha256 = '6e27725cf531e1ced3d546503176af8ae4157366e97594c49ca5c9d2c18215cd'
export const previousSuccessorPath = 'verification/testing/ci/v1.2.0/receipts/approved.json'
export const previousSuccessorSha256 = 'd5f7b2d29cb6790a4b390f62a988746d8a9de6b36642c9d793179178f7d938e2'

export async function assertPredecessorPreserved() {
  const bytes = await readFile(new URL('../../v1.0.0/receipts/ci-integration.json', import.meta.url))
  assert.equal(sha256(bytes), predecessorSha256, 'CI_PREDECESSOR_CHANGED')
}

export async function assertPreviousSuccessorPreserved() {
  const bytes = await readFile(new URL('../../v1.2.0/receipts/approved.json', import.meta.url))
  assert.equal(sha256(bytes), previousSuccessorSha256, 'CI_PREVIOUS_SUCCESSOR_CHANGED')
  const receipt = JSON.parse(bytes.toString('utf8'))
  assert.equal(receipt.package_id, '@ushso/ci-verification-successor-v1-2@1.2.0', 'CI_PREVIOUS_SUCCESSOR_WRONG_PACKAGE')
  assert.equal(receipt.status, 'approved_scoped_attestation', 'CI_PREVIOUS_SUCCESSOR_NOT_RECEIPT')
  assert.equal(receipt.release_gate_pass, false, 'CI_PREVIOUS_SUCCESSOR_RELEASE_OVERCLAIM')
  assert.equal(receipt.production_eligibility, false, 'CI_PREVIOUS_SUCCESSOR_PRODUCTION_OVERCLAIM')
  return { path: previousSuccessorPath, sha256: previousSuccessorSha256, package_id: receipt.package_id, status: receipt.status }
}

export function assertCurrentEvidence(stored, current) {
  assert.deepEqual(stored, current, 'CI_SUCCESSOR_EVIDENCE_STALE')
}

export async function buildTechnicalEvidence() {
  await assertPredecessorPreserved()
  const previousSuccessor = await assertPreviousSuccessorPreserved()
  return {
    status: 'PASS',
    predecessor: { path: 'verification/testing/ci/v1.0.0/receipts/ci-integration.json', sha256: predecessorSha256 },
    previous_successor_receipt: previousSuccessor,
    inventory: await buildInventory(),
    implementation_files: await pinFiles(fileURLToPath(new URL('../../../../../', import.meta.url)), [
      'verification/successor-support.mjs',
      ...await listFiles(fileURLToPath(new URL('../../../../../', import.meta.url)), 'verification/testing/ci/v1.3.0'),
    ]),
    evidence_scope: 'structural CI inventory; discovered suites have not been executed by this builder',
  }
}

export async function buildDraft() {
  return createDraft(packageId, await buildTechnicalEvidence())
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSuccessorCli({ packageId, packageRoot: fileURLToPath(new URL('../', import.meta.url)), buildTechnicalEvidence })
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
