import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTechnicalEvidence as buildInventory } from './ci-inventory.mjs'
import { createDraft, sha256, pinFiles, listFiles, runSuccessorCli } from '../../../../successor-support.mjs'

export const packageId = '@ushso/ci-verification-successor-v1-1@1.1.0'
export const predecessorSha256 = '6e27725cf531e1ced3d546503176af8ae4157366e97594c49ca5c9d2c18215cd'

export async function assertPredecessorPreserved() {
  const bytes = await readFile(new URL('../../v1.0.0/receipts/ci-integration.json', import.meta.url))
  assert.equal(sha256(bytes), predecessorSha256, 'CI_PREDECESSOR_CHANGED')
}

export function assertCurrentEvidence(stored, current) {
  assert.deepEqual(stored, current, 'CI_SUCCESSOR_EVIDENCE_STALE')
}

export async function buildTechnicalEvidence() {
  await assertPredecessorPreserved()
  return {
    status: 'PASS',
    predecessor: { path: 'verification/testing/ci/v1.0.0/receipts/ci-integration.json', sha256: predecessorSha256 },
    inventory: await buildInventory(),
    implementation_files: await pinFiles(fileURLToPath(new URL('../../../../../', import.meta.url)), [
      'verification/successor-support.mjs',
      ...await listFiles(fileURLToPath(new URL('../../../../../', import.meta.url)), 'verification/testing/ci/v1.1.0'),
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
