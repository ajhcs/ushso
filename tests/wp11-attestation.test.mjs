import assert from 'node:assert/strict'
import { execFile as execFileCallback, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
  ALLOWED_PACKAGE_LOCK,
  NAMED_PRE_PR005_FIXTURE_FILES,
  NAMED_PRE_PR005_FIXTURE_MANIFEST_PATH,
  NAMED_PRE_PR005_FIXTURE_SCHEMA,
  PR008_REVIEWED_CURRENT_LOCK,
  HISTORICAL_WP11_V1_3,
  ORIGINAL_PR085_PACKAGE_SNAPSHOT,
  PR005_941C9CD_CHANGED_INPUTS,
  PRE_PR005_CHANGED_INPUTS,
  REVIEWED_PR003_PACKAGE_SNAPSHOT,
  REVIEWED_WP11_ROUTE,
  WP11_BUILDER_UNPINNED_READS,
  WP11_PACKAGE_ID,
  WP11_WRAPPER_IMPLEMENTATION_FILES,
  WP11_WRAPPER_PACKAGE_ID,
  bindWrapperImplementation,
  buildCurrentWp11Draft,
  reportCurrentVersusHistoricalInputs,
  repoRoot,
  validateHistoricalWp11Proof,
  verifyWp11Attestation,
} from '../scripts/verify-wp11-attestation.mjs'
import {
  HISTORICAL_PREIMAGE_INVENTORY_PATH,
  HISTORICAL_PREIMAGE_READER_PATH,
  HISTORICAL_PREIMAGE_SNAPSHOT_DIR,
  HISTORICAL_WP11_SUBJECT_SHA256,
  SEALED_WP11_FILE_COUNT,
  SEALED_WP11_RECEIPT_PATH,
  SEALED_WP11_TOTAL_BYTES,
  readHistoricalPreimageSnapshot,
} from '../verification/research-program/ci-attestation/wp11-v1.3.0/historical-preimage-reader.mjs'
import { sha256 } from '../verification/successor-support.mjs'
import { packageId } from '../verification/wp11/v1.3.0/tools/verify.mjs'
const execFile = promisify(execFileCallback)

const CURRENT_WP11_BROAD_ROOTS = Object.freeze([
  'verification/wp11/v1.3.0',
  'apps/web/src',
  'packages/retrieval/tools',
  'packages/retrieval/schemas',
])
const CURRENT_WP11_EXPLICIT_FILES = Object.freeze([
  'verification/successor-support.mjs',
  'package.json',
  'package-lock.json',
])
const CURRENT_WP11_SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'receipts',
  'approvals',
  'drafts',
  'dist',
  '.wrangler',
])

async function independentlyListCurrentFiles(root, relative) {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (CURRENT_WP11_SKIP_DIRECTORIES.has(entry.name)) continue
    const child = path.posix.join(relative, entry.name)
    if (entry.isDirectory()) files.push(...await independentlyListCurrentFiles(root, child))
    else if (entry.isFile()) files.push(child)
    else throw new Error('WP11_INDEPENDENT_UNSUPPORTED_FILE_TYPE:' + child)
  }
  return files
}

async function independentlyReadCurrentTechnicalInventory(root = repoRoot) {
  const scope = JSON.parse(await readFile(path.join(root, 'verification/wp11/v1.3.0/scope-paths.json'), 'utf8'))
  assert.ok(Array.isArray(scope), 'WP11_INDEPENDENT_SCOPE_MISSING')
  const paths = new Set([...CURRENT_WP11_EXPLICIT_FILES, ...scope])
  for (const broadRoot of CURRENT_WP11_BROAD_ROOTS) {
    for (const relative of await independentlyListCurrentFiles(root, broadRoot)) paths.add(relative)
  }
  const files = []
  for (const relative of [...paths].sort()) {
    assert.ok(!path.isAbsolute(relative) && !relative.split('/').includes('..'), 'WP11_INDEPENDENT_UNSAFE_PATH:' + relative)
    const bytes = await readFile(path.join(root, relative))
    assert.ok(bytes.length > 0, 'WP11_INDEPENDENT_EMPTY:' + relative)
    files.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) })
  }
  return files
}

function normalizeCurrentTechnicalFiles(files) {
  return files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })).sort((left, right) => left.path.localeCompare(right.path))
}

function assertCurrentTechnicalInventoryMatches(draft, expected) {
  const actual = draft?.technical_evidence?.files
  assert.ok(Array.isArray(actual), 'WP11_CURRENT_TECHNICAL_FILES_MISSING')
  assert.equal(new Set(actual.map((file) => file.path)).size, actual.length, 'WP11_CURRENT_TECHNICAL_DUPLICATE_PATH')
  assert.deepEqual(normalizeCurrentTechnicalFiles(actual), normalizeCurrentTechnicalFiles(expected), 'WP11_CURRENT_TECHNICAL_INVENTORY_MISMATCH')
}

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

async function copySnapshotRoot() {
  const root = await mkdtemp(path.join(await verificationTempRoot(), 'ushso-pr086-wp11-snapshot-'))
  const snapshotDest = path.join(root, HISTORICAL_PREIMAGE_SNAPSHOT_DIR)
  const receiptDest = path.join(root, SEALED_WP11_RECEIPT_PATH)
  await mkdir(path.dirname(snapshotDest), { recursive: true })
  await mkdir(path.dirname(receiptDest), { recursive: true })
  await cp(path.join(repoRoot, HISTORICAL_PREIMAGE_SNAPSHOT_DIR), snapshotDest, { recursive: true })
  await cp(path.join(repoRoot, SEALED_WP11_RECEIPT_PATH), receiptDest)
  return root
}

async function readSnapshotInventory(root) {
  return JSON.parse(await readFile(path.join(root, HISTORICAL_PREIMAGE_SNAPSHOT_DIR, 'inventory.json'), 'utf8'))
}

async function writeSnapshotInventory(root, inventory) {
  await writeFile(
    path.join(root, HISTORICAL_PREIMAGE_SNAPSHOT_DIR, 'inventory.json'),
    JSON.stringify(inventory, null, 2) + '\n',
  )
}

function diffIdentity(item) {
  return {
    path: item.path,
    historical_bytes: item.historical_bytes,
    historical_sha256: item.historical_sha256,
    current_bytes: item.current_bytes,
    current_sha256: item.current_sha256,
  }
}

async function independentlyDiffAgainstSealedPins({
  readCurrentFile = async (_root, relativePath) => readFile(path.resolve(repoRoot, relativePath)),
} = {}) {
  const retained = await readHistoricalPreimageSnapshot()
  const changed = []
  let unchangedCount = 0
  for (const pin of retained.files) {
    const bytes = await readCurrentFile(repoRoot, pin.path)
    assert.ok(bytes && bytes.length > 0, `WP11_INDEPENDENT_CURRENT_EMPTY:${pin.path}`)
    const currentSha256 = sha256(bytes)
    if (currentSha256 === pin.sha256 && bytes.length === pin.bytes) {
      unchangedCount += 1
      continue
    }
    changed.push({
      path: pin.path,
      historical_bytes: pin.bytes,
      historical_sha256: pin.sha256,
      current_bytes: bytes.length,
      current_sha256: currentSha256,
    })
  }
  changed.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  assert.equal(unchangedCount + changed.length, SEALED_WP11_FILE_COUNT, 'WP11_INDEPENDENT_DIFF_COUNT')
  return { retained, changed, unchangedCount }
}

function assertCompleteIndependentDiff(report, independent) {
  assert.equal(report.compared_file_count, SEALED_WP11_FILE_COUNT)
  assert.equal(report.changed_count + report.unchanged_count, SEALED_WP11_FILE_COUNT)
  assert.equal(report.changed_count, independent.changed.length)
  assert.equal(report.unchanged_count, independent.unchangedCount)
  assert.deepEqual(report.changed.map(diffIdentity), independent.changed)
  assert.equal(report.approval, null)
  assert.equal(report.current_approval_issued, false)
  assert.equal(report.historical_approval_transferred, false)
  assert.equal(report.combined_acceptance, false)
  assert.equal(report.release_qualified, false)
  for (const item of report.changed) {
    assert.notEqual(item.historical_sha256, item.current_sha256)
    assert.equal(item.historical_source, 'retained_historical_preimage_snapshot')
    assert.ok(item.historical_bytes > 0 && item.current_bytes > 0)
    if (item.path === 'package.json') {
      assert.equal(item.role, 'reviewed_pr003_package_transition')
    } else if (item.path === 'package-lock.json') {
      assert.ok(['pr085_ci_v14_workspace_lock', 'pr008_workspace_lock_transition'].includes(item.role))
    } else {
      assert.equal(item.role, 'current_unapproved_input_change')
    }
  }
}

let namedPrePr005FixturePromise
async function readNamedPrePr005Fixture() {
  if (!namedPrePr005FixturePromise) {
    namedPrePr005FixturePromise = (async () => {
      const manifestBytes = await readFile(path.resolve(repoRoot, NAMED_PRE_PR005_FIXTURE_MANIFEST_PATH))
      assert.ok(manifestBytes.length > 0, 'WP11_NAMED_FIXTURE_MANIFEST_EMPTY')
      const manifest = JSON.parse(manifestBytes.toString('utf8'))
      assert.equal(manifest.schema_version, NAMED_PRE_PR005_FIXTURE_SCHEMA)
      assert.equal(manifest.fixture_id, 'pre-pr005-package-transitions')
      assert.equal(manifest.git_required, false)
      assert.equal(manifest.file_count, Object.keys(NAMED_PRE_PR005_FIXTURE_FILES).length)
      assert.equal(manifest.total_bytes, Object.values(NAMED_PRE_PR005_FIXTURE_FILES).reduce((sum, file) => sum + file.bytes, 0))
      assert.ok(Array.isArray(manifest.files))
      const result = new Map()
      const manifestDir = path.dirname(path.resolve(repoRoot, NAMED_PRE_PR005_FIXTURE_MANIFEST_PATH))
      for (const expected of Object.values(NAMED_PRE_PR005_FIXTURE_FILES)) {
        const entry = manifest.files.find((item) => item.path === expected.relative_path)
        assert.ok(entry, 'WP11_NAMED_FIXTURE_MISSING:' + expected.relative_path)
        assert.equal(entry.fixture_path, path.posix.basename(expected.path))
        assert.equal(entry.role, expected.role)
        assert.equal(entry.source_state, expected.source_state)
        assert.equal(entry.source_commit, expected.source_commit)
        assert.equal(entry.source_path, expected.source_path)
        assert.equal(entry.bytes, expected.bytes)
        assert.equal(entry.sha256, expected.sha256)
        const bytes = await readFile(path.join(manifestDir, entry.fixture_path))
        assert.equal(bytes.length, expected.bytes, 'WP11_NAMED_FIXTURE_BYTES:' + expected.relative_path)
        assert.equal(sha256(bytes), expected.sha256, 'WP11_NAMED_FIXTURE_HASH:' + expected.relative_path)
        result.set(expected.relative_path, bytes)
      }
      assert.equal(result.size, manifest.files.length)
      return result
    })()
  }
  return namedPrePr005FixturePromise
}
async function readNamedPrePr005CurrentFile(retained, _root, relativePath) {
  if (relativePath === 'package.json' || relativePath === 'package-lock.json') {
    const bytes = (await readNamedPrePr005Fixture()).get(relativePath)
    assert.ok(bytes, 'WP11_NAMED_FIXTURE_MISSING:' + relativePath)
    return bytes
  }
  const bytes = retained.bytesByPath.get(relativePath)
  assert.ok(bytes && bytes.length > 0, `WP11_PRE_PR005_FIXTURE_MISSING:${relativePath}`)
  return bytes
}

const BUILDER_FIXTURE_EXTRA_FILES = Object.freeze([
  ...WP11_BUILDER_UNPINNED_READS,
  'contracts/research-plan/v1.0.0/manifests/package-manifest.json',
  'packages/planner/planner-repository.mjs',
  'packages/planner/static-planner-repository.mjs',
  'packages/coverage/coverage-repository.mjs',
  'packages/coverage/static-coverage-repository.mjs',
  'evaluation/planner/v1.0.0/manifests/package-manifest.json',
  HISTORICAL_WP11_V1_3.predecessor_manifest.path,
  HISTORICAL_WP11_V1_3.predecessor_receipt.path,
  HISTORICAL_WP11_V1_3.previous_successor.path,
])

async function materializeMutableCurrentInputFixture(relativePath) {
  const retained = await readHistoricalPreimageSnapshot()
  const currentInventory = await independentlyReadCurrentTechnicalInventory()
  const root = await mkdtemp(path.join(await verificationTempRoot(), 'ushso-pr086-wp11-current-input-'))
  const paths = new Set(currentInventory.map((file) => file.path))
  for (const extra of BUILDER_FIXTURE_EXTRA_FILES) paths.add(extra)
  for (const item of paths) {
    const dest = path.join(root, item)
    await mkdir(path.dirname(dest), { recursive: true })
    await cp(path.join(repoRoot, item), dest)
  }
  return {
    root,
    relativePath,
    filePath: path.join(root, relativePath),
    retained,
    currentInventory,
  }
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
  assert.equal(result.historical.input_bindings.source, 'retained_historical_preimage_snapshot')
  assert.equal(result.historical.input_bindings.historical_file_count, SEALED_WP11_FILE_COUNT)
  assert.equal(result.historical.input_bindings.total_bytes, SEALED_WP11_TOTAL_BYTES)
  assert.equal(result.historical.input_bindings.unchanged_count, SEALED_WP11_FILE_COUNT)
  assert.equal(result.historical.input_bindings.git_required, false)
  assert.equal(result.historical.input_bindings.execute_retained_sources, false)
  assert.equal(result.historical.input_bindings.subject_sha256, HISTORICAL_WP11_SUBJECT_SHA256)
  assertCompleteIndependentDiff(result.current_versus_historical, await independentlyDiffAgainstSealedPins())
  assert.equal(result.builder_coverage_limits.unpinned_legacy_builder_reads.length, WP11_BUILDER_UNPINNED_READS.length)
  const actualPackage = await hashPinned('package.json')
  const reviewedTransition = actualPackage.sha256 === REVIEWED_PR003_PACKAGE_SNAPSHOT.sha256
  const expectedPackage = reviewedTransition ? REVIEWED_PR003_PACKAGE_SNAPSHOT : ORIGINAL_PR085_PACKAGE_SNAPSHOT
  assert.deepEqual(actualPackage, { bytes: expectedPackage.bytes, sha256: expectedPackage.sha256 })
  assert.notEqual(actualPackage.sha256, HISTORICAL_WP11_V1_3.files.receipt.sha256)
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

test('retained snapshot reconstitutes 154 sealed preimages without Git', async () => {
  const retained = await readHistoricalPreimageSnapshot()
  assert.equal(retained.status, 'PASS')
  assert.equal(retained.file_count, SEALED_WP11_FILE_COUNT)
  assert.equal(retained.total_bytes, SEALED_WP11_TOTAL_BYTES)
  assert.equal(retained.subject_sha256, HISTORICAL_WP11_SUBJECT_SHA256)
  assert.equal(retained.git_required, false)
  assert.equal(retained.execute_retained_sources, false)
  assert.equal(retained.files.length, SEALED_WP11_FILE_COUNT)
  let total = 0
  for (const pin of retained.files) {
    const bytes = retained.bytesByPath.get(pin.path)
    assert.equal(bytes.length, pin.bytes)
    assert.equal(sha256(bytes), pin.sha256)
    total += bytes.length
  }
  assert.equal(total, SEALED_WP11_TOTAL_BYTES)
  const fixture = await historicalBytes()
  const proof = await validateHistoricalWp11Proof({ ...fixture, snapshot: retained })
  assert.equal(proof.subject_sha256, HISTORICAL_WP11_SUBJECT_SHA256)
  assert.equal(proof.input_bindings.historical_file_count, SEALED_WP11_FILE_COUNT)
})

test('snapshot reader rejects missing, extra, tampered, substituted, incomplete, duplicate and unsafe inventory bytes', async () => {
  const targetPath = 'apps/web/src/components/ResultCard.test.ts'
  const substituted = await readGitBytes('941c9cd02a3a87c4239e6b75cdccbf4c8ec095e9', targetPath)
  assert.notEqual(sha256(substituted), '16226fad7dbbb87f6ca90541fcb33366b4104d8f7324e1f2373cff8446afe06d')

  const cases = []

  const missingRoot = await copySnapshotRoot()
  const missingInventory = await readSnapshotInventory(missingRoot)
  const missingEntry = missingInventory.files.find((item) => item.path === targetPath)
  await rm(path.join(missingRoot, HISTORICAL_PREIMAGE_SNAPSHOT_DIR, 'blobs', missingEntry.sha256))
  cases.push({ root: missingRoot, pattern: /WP11_SNAPSHOT_BLOB_MISSING/u })

  const extraRoot = await copySnapshotRoot()
  await writeFile(path.join(extraRoot, HISTORICAL_PREIMAGE_SNAPSHOT_DIR, 'blobs', 'ab'.repeat(32)), Buffer.from('extra-blob'))
  cases.push({ root: extraRoot, pattern: /WP11_SNAPSHOT_BLOB_EXTRA|WP11_SNAPSHOT_BLOB_NAME/u })

  const tamperRoot = await copySnapshotRoot()
  const tamperInventory = await readSnapshotInventory(tamperRoot)
  const tamperEntry = tamperInventory.files.find((item) => item.path === targetPath)
  const tamperPath = path.join(tamperRoot, HISTORICAL_PREIMAGE_SNAPSHOT_DIR, 'blobs', tamperEntry.sha256)
  const tamperBytes = Buffer.from(await readFile(tamperPath))
  tamperBytes[tamperBytes.length - 1] ^= 1
  await writeFile(tamperPath, tamperBytes)
  cases.push({ root: tamperRoot, pattern: /WP11_SNAPSHOT_BLOB_SUBSTITUTED|WP11_SNAPSHOT_BLOB_BYTES/u })

  const substitutedRoot = await copySnapshotRoot()
  const substitutedInventory = await readSnapshotInventory(substitutedRoot)
  const substitutedEntry = substitutedInventory.files.find((item) => item.path === targetPath)
  await writeFile(path.join(substitutedRoot, HISTORICAL_PREIMAGE_SNAPSHOT_DIR, 'blobs', substitutedEntry.sha256), substituted)
  cases.push({ root: substitutedRoot, pattern: /WP11_SNAPSHOT_BLOB_SUBSTITUTED|WP11_SNAPSHOT_BLOB_BYTES/u })

  const incompleteRoot = await copySnapshotRoot()
  const incompleteInventory = await readSnapshotInventory(incompleteRoot)
  incompleteInventory.files = incompleteInventory.files.filter((item) => item.path !== targetPath)
  incompleteInventory.file_count = incompleteInventory.files.length
  await writeSnapshotInventory(incompleteRoot, incompleteInventory)
  cases.push({ root: incompleteRoot, pattern: /WP11_SNAPSHOT_INVENTORY_INCOMPLETE|WP11_SNAPSHOT_INVENTORY_FILE_COUNT|WP11_SNAPSHOT_INVENTORY_MISSING_PATH/u })

  const duplicateRoot = await copySnapshotRoot()
  const duplicateInventory = await readSnapshotInventory(duplicateRoot)
  duplicateInventory.files[1] = { ...duplicateInventory.files[0] }
  await writeSnapshotInventory(duplicateRoot, duplicateInventory)
  cases.push({ root: duplicateRoot, pattern: /WP11_SNAPSHOT_DUPLICATE_PATH/u })

  const unsafeRoot = await copySnapshotRoot()
  const unsafeInventory = await readSnapshotInventory(unsafeRoot)
  unsafeInventory.files[0] = { ...unsafeInventory.files[0], path: '../etc/passwd' }
  await writeSnapshotInventory(unsafeRoot, unsafeInventory)
  cases.push({ root: unsafeRoot, pattern: /WP11_SNAPSHOT_INVENTORY_PATH_UNSAFE/u })

  try {
    for (const item of cases) {
      await assert.rejects(readHistoricalPreimageSnapshot({ root: item.root }), item.pattern)
      const fixture = await historicalBytes()
      await assert.rejects(validateHistoricalWp11Proof({ ...fixture, root: item.root }), item.pattern)
    }
  } finally {
    await Promise.all(cases.map((item) => rm(item.root, { recursive: true, force: true })))
  }
})

test('historical snapshot proof still passes when Git is unavailable', async () => {
  const script = path.join(await verificationTempRoot(), `ushso-pr086-wp11-offline-${process.pid}.mjs`)
  await writeFile(script, `import { readHistoricalPreimageSnapshot } from ${JSON.stringify(path.join(repoRoot, 'verification/research-program/ci-attestation/wp11-v1.3.0/historical-preimage-reader.mjs'))}
const retained = await readHistoricalPreimageSnapshot(${JSON.stringify({ root: repoRoot })})
if (retained.file_count !== ${SEALED_WP11_FILE_COUNT} || retained.total_bytes !== ${SEALED_WP11_TOTAL_BYTES} || retained.subject_sha256 !== '${HISTORICAL_WP11_SUBJECT_SHA256}') process.exit(2)
if (retained.git_required !== false) process.exit(3)
`)
  try {
    const result = spawnSync(process.execPath, [script], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: '/usr/bin:/bin',
        GIT_DIR: '/nonexistent',
        GIT_EXEC_PATH: '/nonexistent',
        GIT_CEILING_DIRECTORIES: '/',
      },
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  } finally {
    await rm(script, { force: true })
  }
})

test('current technical builder hashes actual current files and remains unapproved', async () => {
  const draft = await buildCurrentWp11Draft()
  assert.equal(draft.approval, null)
  assert.equal(draft.status, 'pending_authorized_review')
  assert.equal(draft.release_gate_pass, false)
  const expected = await independentlyReadCurrentTechnicalInventory()
  assert.ok(expected.length > SEALED_WP11_FILE_COUNT)
  assertCurrentTechnicalInventoryMatches(draft, expected)
  assert.notEqual(draft.subject_sha256, HISTORICAL_WP11_V1_3.subject_sha256)
  const resultCard = draft.technical_evidence.files.find((file) => file.path === 'apps/web/src/components/ResultCard.test.ts')
  assert.deepEqual(
    { bytes: resultCard.bytes, sha256: resultCard.sha256 },
    await hashPinned('apps/web/src/components/ResultCard.test.ts'),
  )
})

test('independent current inventory rejects additions, removals, duplicate records and byte or length drift', async () => {
  const fixture = await materializeMutableCurrentInputFixture('apps/web/src/components/ResultCard.test.ts')
  const expected = fixture.currentInventory
  const resultCardPath = fixture.filePath
  const resultCardBytes = await readFile(resultCardPath)
  const missingPath = path.join(fixture.root, 'apps/web/src/pages/SourcesPage.test.tsx')
  const extraPath = path.join(fixture.root, 'apps/web/src/__wp11_unexpected_current_file.txt')
  try {
    const baseline = await buildCurrentWp11Draft({ root: fixture.root })
    assertCurrentTechnicalInventoryMatches(baseline, expected)

    await rm(missingPath)
    const missing = await buildCurrentWp11Draft({ root: fixture.root, validateCurrent: null })
    assert.throws(() => assertCurrentTechnicalInventoryMatches(missing, expected), /WP11_CURRENT_TECHNICAL_INVENTORY_MISMATCH/u)
    await writeFile(missingPath, await readFile(path.join(repoRoot, 'apps/web/src/pages/SourcesPage.test.tsx')))

    await writeFile(extraPath, Buffer.from('unexpected current input\n'))
    const extra = await buildCurrentWp11Draft({ root: fixture.root, validateCurrent: null })
    assert.throws(() => assertCurrentTechnicalInventoryMatches(extra, expected), /WP11_CURRENT_TECHNICAL_INVENTORY_MISMATCH/u)
    await rm(extraPath)

    const duplicate = structuredClone(baseline)
    duplicate.technical_evidence.files.push({ ...duplicate.technical_evidence.files[0] })
    assert.throws(() => assertCurrentTechnicalInventoryMatches(duplicate, expected), /WP11_CURRENT_TECHNICAL_DUPLICATE_PATH/u)

    const tampered = Buffer.from(resultCardBytes)
    tampered[tampered.length - 1] ^= 1
    await writeFile(resultCardPath, tampered)
    const changedHash = await buildCurrentWp11Draft({ root: fixture.root, validateCurrent: null })
    assert.throws(() => assertCurrentTechnicalInventoryMatches(changedHash, expected), /WP11_CURRENT_TECHNICAL_INVENTORY_MISMATCH/u)

    const changedLength = Buffer.concat([resultCardBytes, Buffer.from('length-drift')])
    await writeFile(resultCardPath, changedLength)
    const changedBytes = await buildCurrentWp11Draft({ root: fixture.root, validateCurrent: null })
    assert.throws(() => assertCurrentTechnicalInventoryMatches(changedBytes, expected), /WP11_CURRENT_TECHNICAL_INVENTORY_MISMATCH/u)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('actual current-file change updates the pending technical subject while snapshot proof still passes', async () => {
  const relativePath = 'apps/web/src/components/ResultCard.test.ts'
  const fixture = await materializeMutableCurrentInputFixture(relativePath)
  const original = await readFile(fixture.filePath)
  const mutated = Buffer.from(original)
  mutated[mutated.length - 1] ^= 1
  const historicalPin = fixture.retained.files.find((pin) => pin.path === relativePath)
  assert.ok(historicalPin)
  const beforeCurrentSha256 = sha256(original)
  const afterCurrentSha256 = sha256(mutated)
  assert.notEqual(beforeCurrentSha256, afterCurrentSha256)
  const readFixtureFile = async (_root, itemPath) => readFile(path.join(fixture.root, itemPath))
  const before = await buildCurrentWp11Draft({ root: fixture.root })
  const historicalBefore = await validateHistoricalWp11Proof(await historicalBytes())
  const beforeReport = await reportCurrentVersusHistoricalInputs({
    snapshot: fixture.retained,
    readCurrentFile: readFixtureFile,
    currentSource: 'task_owned_current_input_fixture',
  })
  const beforeChanged = beforeReport.changed.find((item) => item.path === relativePath)
  if (beforeCurrentSha256 === historicalPin.sha256 && original.length === historicalPin.bytes) {
    assert.equal(beforeChanged, undefined)
  } else {
    assert.ok(beforeChanged)
    assert.equal(beforeChanged.historical_sha256, historicalPin.sha256)
    assert.equal(beforeChanged.historical_bytes, historicalPin.bytes)
    assert.equal(beforeChanged.current_sha256, beforeCurrentSha256)
    assert.equal(beforeChanged.current_bytes, original.length)
  }
  const beforeFile = before.technical_evidence.files.find((file) => file.path === relativePath)
  assert.equal(beforeFile.sha256, beforeCurrentSha256)
  try {
    await writeFile(fixture.filePath, mutated)
    const after = await buildCurrentWp11Draft({ root: fixture.root })
    assert.notEqual(after.subject_sha256, before.subject_sha256)
    assert.equal(after.approval, null)
    assert.equal(after.status, 'pending_authorized_review')
    const afterFile = after.technical_evidence.files.find((file) => file.path === relativePath)
    assert.equal(afterFile.sha256, afterCurrentSha256)
    assert.equal(afterFile.bytes, mutated.length)
    const historicalAfter = await validateHistoricalWp11Proof(await historicalBytes())
    assert.equal(historicalAfter.subject_sha256, historicalBefore.subject_sha256)
    const report = await reportCurrentVersusHistoricalInputs({
      snapshot: fixture.retained,
      readCurrentFile: readFixtureFile,
      currentSource: 'task_owned_current_input_fixture',
    })
    const independent = await independentlyDiffAgainstSealedPins({ readCurrentFile: readFixtureFile })
    assertCompleteIndependentDiff(report, independent)
    const changed = report.changed.find((item) => item.path === relativePath)
    assert.ok(changed)
    assert.equal(changed.historical_sha256, historicalPin.sha256)
    assert.equal(changed.historical_bytes, historicalPin.bytes)
    assert.equal(changed.historical_source, 'retained_historical_preimage_snapshot')
    assert.equal(changed.current_sha256, afterCurrentSha256)
    assert.equal(changed.current_bytes, mutated.length)
    assert.notEqual(changed.current_sha256, beforeCurrentSha256)
    assert.equal(changed.role, 'current_unapproved_input_change')
    assert.equal(report.approval, null)
    assert.equal(sha256(await readFile(path.join(repoRoot, relativePath))), beforeCurrentSha256)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('missing snapshot or reader bindings and stale policy pins fail closed', async () => {
  const policy = JSON.parse(await readFile(path.join(repoRoot, 'verification/research-program/ci-attestation/wp11-v1.3.0/policy.json'), 'utf8'))
  await assert.rejects(
    bindWrapperImplementation({
      implementationFileNames: WP11_WRAPPER_IMPLEMENTATION_FILES.filter((name) => name !== HISTORICAL_PREIMAGE_READER_PATH),
    }),
    /WP11_WRAPPER_READER_BINDING_MISSING/u,
  )
  await assert.rejects(
    bindWrapperImplementation({
      implementationFileNames: WP11_WRAPPER_IMPLEMENTATION_FILES.filter((name) => name !== HISTORICAL_PREIMAGE_INVENTORY_PATH),
    }),
    /WP11_WRAPPER_SNAPSHOT_BINDING_MISSING/u,
  )
  const staleSnapshot = structuredClone(policy)
  staleSnapshot.historical_preimage_snapshot.sha256 = '00'.repeat(32)
  await assert.rejects(bindWrapperImplementation({ policy: staleSnapshot }), /WP11_WRAPPER_POLICY_STALE_SNAPSHOT/u)
  const staleReader = structuredClone(policy)
  staleReader.historical_preimage_reader.sha256 = '11'.repeat(32)
  await assert.rejects(bindWrapperImplementation({ policy: staleReader }), /WP11_WRAPPER_POLICY_STALE_READER/u)
  const stalePr008Lock = structuredClone(policy)
  stalePr008Lock.reviewed_current_transitions.pr008_workspace_lock_transition.current_lock.sha256 = '00'.repeat(32)
  await assert.rejects(bindWrapperImplementation({ policy: stalePr008Lock }), /WP11_WRAPPER_POLICY_STALE_PR008_CURRENT_LOCK/u)
  const stalePr008Review = structuredClone(policy)
  stalePr008Review.reviewed_current_transitions.pr008_workspace_lock_transition.review_receipt.sha256 = '11'.repeat(32)
  await assert.rejects(bindWrapperImplementation({ policy: stalePr008Review }), /WP11_WRAPPER_POLICY_STALE_PR008_REVIEW_RECEIPT/u)
})

test('PR005-941c9cd comparison reports all 13 changed inputs and is not combined acceptance', async () => {
  const report = await reportCurrentVersusHistoricalInputs({
    readCurrentFile: async (_root, relativePath) => readGitBytes('941c9cd02a3a87c4239e6b75cdccbf4c8ec095e9', relativePath),
    currentSource: 'pr005_941c9cd_git_snapshot',
  })
  assert.equal(report.changed_count, 13)
  assert.equal(report.unchanged_count, SEALED_WP11_FILE_COUNT - 13)
  assert.deepEqual(report.changed.map((item) => item.path), [...PR005_941C9CD_CHANGED_INPUTS].sort())
  assert.equal(report.approval, null)
  assert.equal(report.combined_acceptance, false)
  assert.equal(report.current_approval_issued, false)
  const roles = Object.fromEntries(report.changed.map((item) => [item.path, item.role]))
  assert.equal(roles['package.json'], 'reviewed_pr003_package_transition')
  assert.equal(roles['package-lock.json'], 'pr085_ci_v14_workspace_lock')
  assert.equal(roles['apps/web/src/components/ResultCard.test.ts'], 'current_unapproved_input_change')
  for (const item of report.changed) {
    assert.notEqual(item.historical_sha256, item.current_sha256)
    assert.equal(item.historical_source, 'retained_historical_preimage_snapshot')
    assert.equal(item.current_source, 'pr005_941c9cd_git_snapshot')
    assert.ok(item.historical_bytes > 0 && item.current_bytes > 0)
  }
})

test('named pre-PR005 fixture comparison reports only the two package transitions', async () => {
  const retained = await readHistoricalPreimageSnapshot()
  const readCurrentFile = async (root, relativePath) => readNamedPrePr005CurrentFile(retained, root, relativePath)
  const report = await reportCurrentVersusHistoricalInputs({
    snapshot: retained,
    readCurrentFile,
    currentSource: 'pre_pr005_named_fixture',
  })
  const independent = await independentlyDiffAgainstSealedPins({ readCurrentFile })
  assertCompleteIndependentDiff(report, independent)
  assert.equal(report.changed_count, 2)
  assert.deepEqual(report.changed.map((item) => item.path).sort(), [...PRE_PR005_CHANGED_INPUTS].sort())
  assert.equal(report.changed.find((item) => item.path === 'package.json').role, 'reviewed_pr003_package_transition')
  assert.equal(report.changed.find((item) => item.path === 'package-lock.json').role, 'pr085_ci_v14_workspace_lock')
  for (const item of report.changed) {
    assert.equal(item.current_source, 'pre_pr005_named_fixture')
  }
})

test('the independently reviewed PR008 lock is one exact current transition and remains unapproved', async () => {
  const reviewedLock = await readGitBytes(PR008_REVIEWED_CURRENT_LOCK.source_commit, PR008_REVIEWED_CURRENT_LOCK.path)
  assert.deepEqual(
    { bytes: reviewedLock.length, sha256: sha256(reviewedLock) },
    { bytes: PR008_REVIEWED_CURRENT_LOCK.bytes, sha256: PR008_REVIEWED_CURRENT_LOCK.sha256 },
  )
  const retained = await readHistoricalPreimageSnapshot()
  const readCurrentFile = async (_root, relativePath) => relativePath === 'package-lock.json'
    ? reviewedLock
    : readFile(path.resolve(repoRoot, relativePath))
  const report = await reportCurrentVersusHistoricalInputs({
    snapshot: retained,
    readCurrentFile,
    currentSource: 'pr008_reviewed_current_lock_transition',
  })
  const independent = await independentlyDiffAgainstSealedPins({ readCurrentFile })
  assertCompleteIndependentDiff(report, independent)
  assert.equal(report.changed_count, independent.changed.length)
  assert.equal(report.changed.find((item) => item.path === 'package-lock.json').current_bytes, PR008_REVIEWED_CURRENT_LOCK.bytes)
  assert.equal(report.changed.find((item) => item.path === 'package-lock.json').current_sha256, PR008_REVIEWED_CURRENT_LOCK.sha256)
  assert.equal(report.changed.find((item) => item.path === 'package-lock.json').role, 'pr008_workspace_lock_transition')
  assert.equal(report.approval, null)
  assert.equal(report.combined_acceptance, false)

  const tampered = Buffer.from(reviewedLock)
  tampered[tampered.length - 1] ^= 1
  await assert.rejects(
    reportCurrentVersusHistoricalInputs({
      snapshot: retained,
      readCurrentFile: async (_root, relativePath) => relativePath === 'package-lock.json' ? tampered : readFile(path.resolve(repoRoot, relativePath)),
      currentSource: 'pr008_reviewed_current_lock_tampered',
    }),
    /WP11_CURRENT_INPUT_UNREVIEWED_DRIFT/u,
  )
})

test('corrected PR005 afb9056 comparison is a complete unapproved report, not combined acceptance', async () => {
  const readCurrentFile = async (_root, relativePath) => readGitBytes('afb90565456a429e73527f2bb99daf9cf174aa3c', relativePath)
  const report = await reportCurrentVersusHistoricalInputs({
    readCurrentFile,
    currentSource: 'pr005_afb9056_git_snapshot',
  })
  const independent = await independentlyDiffAgainstSealedPins({ readCurrentFile })
  assertCompleteIndependentDiff(report, independent)
  assert.equal(report.changed.some((item) => item.path === 'apps/web/src/components/ResultCard.test.ts'), true)
  for (const item of report.changed) {
    assert.equal(item.current_source, 'pr005_afb9056_git_snapshot')
  }
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
