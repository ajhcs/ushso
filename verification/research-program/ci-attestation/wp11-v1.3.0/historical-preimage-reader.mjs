import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHA256 = /^[a-f0-9]{64}$/u
const repoRootFromHere = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

export const HISTORICAL_PREIMAGE_SNAPSHOT_DIR =
  'verification/research-program/ci-attestation/wp11-v1.3.0/historical-preimage-snapshot'
export const HISTORICAL_PREIMAGE_INVENTORY_PATH = `${HISTORICAL_PREIMAGE_SNAPSHOT_DIR}/inventory.json`
export const HISTORICAL_PREIMAGE_READER_PATH =
  'verification/research-program/ci-attestation/wp11-v1.3.0/historical-preimage-reader.mjs'
export const SEALED_WP11_RECEIPT_PATH = 'verification/wp11/v1.3.0/receipts/approved.json'
export const SEALED_WP11_RECEIPT_BYTES = 32419
export const SEALED_WP11_RECEIPT_SHA256 =
  'e596e1b18a0251f611990c9752e1d12fb36cd05dab16bf55cf96e8d1fc431f9d'
export const HISTORICAL_WP11_SUBJECT_SHA256 =
  '294d8b40bb5a2dbe1f55cdfde4a60205de75ee1ffe48e0108eae69aea2db0f98'
export const HISTORICAL_WP11_SOURCE_COMMIT = '30fa0c59ecd4d3d1dd1f56cd8422c6c470e45cb0'
export const SEALED_WP11_FILE_COUNT = 154
export const SEALED_WP11_TOTAL_BYTES = 1_347_732
export const SNAPSHOT_SCHEMA_VERSION = 'ushso.wp11-historical-preimage-snapshot.v1'
export const MAX_INVENTORY_BYTES = 256 * 1024
export const MAX_RECEIPT_BYTES = 64 * 1024
export const MAX_BLOB_BYTES = 2 * 1024 * 1024

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertHash(value, code) {
  assert.equal(typeof value, 'string', code)
  assert.match(value, SHA256, code)
}

function safeRelativePath(value, code) {
  assert.equal(typeof value, 'string', code)
  assert.ok(value.length > 0 && value.length <= 1024, code)
  assert.ok(!path.isAbsolute(value), code)
  assert.ok(!value.includes('\0') && !value.includes('\\'), code)
  const parts = value.split('/')
  assert.ok(parts.every((part) => part.length > 0 && part !== '.' && part !== '..'), code)
  return value
}

function parseJsonObject(bytes, code) {
  assert.ok(bytes && bytes.length > 0, code)
  let value
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch (error) {
    throw new Error(`${code}: ${error.message}`, { cause: error })
  }
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), code)
  return value
}

async function assertContained(root, candidate, code) {
  const realRoot = await realpath(root)
  const realCandidate = await realpath(candidate)
  assert.ok(realCandidate === realRoot || realCandidate.startsWith(`${realRoot}${path.sep}`), code)
  return { realRoot, realCandidate }
}

function sealedPinKey(pin) {
  return `${pin.path}\n${pin.bytes}\n${pin.sha256}`
}

/**
 * Read the retained 154 historical WP11 preimages and match them against the
 * sealed approved receipt. Git and network are not used.
 */
export async function readHistoricalPreimageSnapshot({
  root = repoRootFromHere,
  snapshotDir = HISTORICAL_PREIMAGE_SNAPSHOT_DIR,
  receiptPath = SEALED_WP11_RECEIPT_PATH,
  receiptBytes,
} = {}) {
  const resolvedRoot = path.resolve(root)
  const resolvedSnapshot = path.resolve(resolvedRoot, snapshotDir)
  await assertContained(resolvedRoot, resolvedSnapshot, 'WP11_SNAPSHOT_PATH_ESCAPE')

  let sealedReceiptBytes = receiptBytes
  if (!sealedReceiptBytes) {
    const receiptFile = path.resolve(resolvedRoot, receiptPath)
    await assertContained(resolvedRoot, receiptFile, 'WP11_SNAPSHOT_RECEIPT_PATH_ESCAPE')
    const receiptStat = await stat(receiptFile)
    assert.ok(receiptStat.isFile(), 'WP11_SNAPSHOT_RECEIPT_NOT_FILE')
    assert.ok(receiptStat.size > 0 && receiptStat.size <= MAX_RECEIPT_BYTES, 'WP11_SNAPSHOT_RECEIPT_SIZE')
    sealedReceiptBytes = await readFile(receiptFile)
  }
  assert.ok(sealedReceiptBytes && sealedReceiptBytes.length > 0, 'WP11_SNAPSHOT_RECEIPT_MISSING')
  assert.ok(sealedReceiptBytes.length <= MAX_RECEIPT_BYTES, 'WP11_SNAPSHOT_RECEIPT_SIZE')
  assert.equal(sealedReceiptBytes.length, SEALED_WP11_RECEIPT_BYTES, 'WP11_SNAPSHOT_RECEIPT_BYTES')
  assert.equal(sha256(sealedReceiptBytes), SEALED_WP11_RECEIPT_SHA256, 'WP11_SNAPSHOT_RECEIPT_CHANGED')
  const receipt = parseJsonObject(sealedReceiptBytes, 'WP11_SNAPSHOT_RECEIPT_MALFORMED')
  assert.equal(receipt.subject_sha256, HISTORICAL_WP11_SUBJECT_SHA256, 'WP11_SNAPSHOT_RECEIPT_SUBJECT')
  const sealedFiles = receipt?.technical_evidence?.files
  assert.ok(Array.isArray(sealedFiles), 'WP11_SNAPSHOT_SEALED_FILES_MISSING')
  assert.equal(sealedFiles.length, SEALED_WP11_FILE_COUNT, 'WP11_SNAPSHOT_SEALED_FILE_COUNT')

  const inventoryPath = path.join(resolvedSnapshot, 'inventory.json')
  await assertContained(resolvedSnapshot, inventoryPath, 'WP11_SNAPSHOT_INVENTORY_PATH_ESCAPE')
  const inventoryStat = await stat(inventoryPath)
  assert.ok(inventoryStat.isFile(), 'WP11_SNAPSHOT_INVENTORY_NOT_FILE')
  assert.ok(inventoryStat.size > 0 && inventoryStat.size <= MAX_INVENTORY_BYTES, 'WP11_SNAPSHOT_INVENTORY_SIZE')
  const inventoryBytes = await readFile(inventoryPath)
  assert.equal(inventoryBytes.length, inventoryStat.size, 'WP11_SNAPSHOT_INVENTORY_SIZE')
  const inventory = parseJsonObject(inventoryBytes, 'WP11_SNAPSHOT_INVENTORY_MALFORMED')
  assert.equal(inventory.schema_version, SNAPSHOT_SCHEMA_VERSION, 'WP11_SNAPSHOT_INVENTORY_SCHEMA')
  assert.equal(inventory.source_commit, HISTORICAL_WP11_SOURCE_COMMIT, 'WP11_SNAPSHOT_SOURCE_COMMIT')
  assert.equal(inventory.receipt_sha256, SEALED_WP11_RECEIPT_SHA256, 'WP11_SNAPSHOT_INVENTORY_RECEIPT_HASH')
  assert.equal(inventory.receipt_bytes, SEALED_WP11_RECEIPT_BYTES, 'WP11_SNAPSHOT_INVENTORY_RECEIPT_BYTES')
  assert.equal(inventory.subject_sha256, HISTORICAL_WP11_SUBJECT_SHA256, 'WP11_SNAPSHOT_INVENTORY_SUBJECT')
  assert.equal(inventory.file_count, SEALED_WP11_FILE_COUNT, 'WP11_SNAPSHOT_INVENTORY_FILE_COUNT')
  assert.equal(inventory.total_bytes, SEALED_WP11_TOTAL_BYTES, 'WP11_SNAPSHOT_INVENTORY_TOTAL_BYTES')
  assert.equal(inventory.blob_directory, 'blobs', 'WP11_SNAPSHOT_BLOB_DIRECTORY')
  assert.equal(inventory.execute_retained_sources, false, 'WP11_SNAPSHOT_EXECUTE_RETAINED_SOURCES')
  assert.ok(Array.isArray(inventory.files), 'WP11_SNAPSHOT_INVENTORY_FILES_MISSING')
  assert.equal(inventory.files.length, SEALED_WP11_FILE_COUNT, 'WP11_SNAPSHOT_INVENTORY_INCOMPLETE')

  const sealedByPath = new Map()
  for (const pin of sealedFiles) {
    const relativePath = safeRelativePath(pin.path, 'WP11_SNAPSHOT_SEALED_PATH_UNSAFE')
    assert.ok(!sealedByPath.has(relativePath), 'WP11_SNAPSHOT_SEALED_DUPLICATE_PATH')
    assertHash(pin.sha256, 'WP11_SNAPSHOT_SEALED_HASH_FORMAT')
    assert.equal(Number.isInteger(pin.bytes) && pin.bytes > 0, true, 'WP11_SNAPSHOT_SEALED_BYTES_TYPE')
    sealedByPath.set(relativePath, { path: relativePath, bytes: pin.bytes, sha256: pin.sha256 })
  }

  const inventoryByPath = new Map()
  const expectedBlobNames = new Set()
  let totalBytes = 0
  for (const entry of inventory.files) {
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry), 'WP11_SNAPSHOT_INVENTORY_ENTRY_SHAPE')
    const relativePath = safeRelativePath(entry.path, 'WP11_SNAPSHOT_INVENTORY_PATH_UNSAFE')
    assert.ok(!inventoryByPath.has(relativePath), 'WP11_SNAPSHOT_DUPLICATE_PATH')
    assertHash(entry.sha256, 'WP11_SNAPSHOT_INVENTORY_HASH_FORMAT')
    assert.equal(Number.isInteger(entry.bytes) && entry.bytes > 0, true, 'WP11_SNAPSHOT_INVENTORY_BYTES_TYPE')
    assert.ok(entry.bytes <= MAX_BLOB_BYTES, 'WP11_SNAPSHOT_INVENTORY_BLOB_BOUND')
    const blob = safeRelativePath(entry.blob, 'WP11_SNAPSHOT_BLOB_PATH_UNSAFE')
    assert.equal(blob, `blobs/${entry.sha256}`, 'WP11_SNAPSHOT_BLOB_NAME')
    const sealed = sealedByPath.get(relativePath)
    assert.ok(sealed, 'WP11_SNAPSHOT_INVENTORY_EXTRA_PATH')
    assert.equal(entry.bytes, sealed.bytes, 'WP11_SNAPSHOT_INVENTORY_BYTES_MISMATCH')
    assert.equal(entry.sha256, sealed.sha256, 'WP11_SNAPSHOT_INVENTORY_HASH_MISMATCH')
    inventoryByPath.set(relativePath, { path: relativePath, bytes: entry.bytes, sha256: entry.sha256, blob })
    expectedBlobNames.add(entry.sha256)
    totalBytes += entry.bytes
  }
  assert.equal(inventoryByPath.size, SEALED_WP11_FILE_COUNT, 'WP11_SNAPSHOT_INVENTORY_INCOMPLETE')
  assert.equal(sealedByPath.size, SEALED_WP11_FILE_COUNT, 'WP11_SNAPSHOT_SEALED_INCOMPLETE')
  for (const relativePath of sealedByPath.keys()) {
    assert.ok(inventoryByPath.has(relativePath), 'WP11_SNAPSHOT_INVENTORY_MISSING_PATH')
  }
  assert.equal(totalBytes, SEALED_WP11_TOTAL_BYTES, 'WP11_SNAPSHOT_TOTAL_BYTES')
  assert.equal(expectedBlobNames.size, inventory.blob_count, 'WP11_SNAPSHOT_BLOB_COUNT')

  const blobsDir = path.join(resolvedSnapshot, 'blobs')
  await assertContained(resolvedSnapshot, blobsDir, 'WP11_SNAPSHOT_BLOBS_PATH_ESCAPE')
  const blobEntries = await readdir(blobsDir, { withFileTypes: true })
  const presentBlobNames = new Set()
  for (const entry of blobEntries) {
    assert.equal(entry.isFile(), true, 'WP11_SNAPSHOT_BLOB_NOT_FILE')
    assert.match(entry.name, SHA256, 'WP11_SNAPSHOT_BLOB_NAME')
    assert.ok(!presentBlobNames.has(entry.name), 'WP11_SNAPSHOT_DUPLICATE_BLOB')
    presentBlobNames.add(entry.name)
  }
  for (const name of expectedBlobNames) {
    assert.ok(presentBlobNames.has(name), 'WP11_SNAPSHOT_BLOB_MISSING')
  }
  for (const name of presentBlobNames) {
    assert.ok(expectedBlobNames.has(name), 'WP11_SNAPSHOT_BLOB_EXTRA')
  }

  const bytesByPath = new Map()
  const files = []
  for (const [relativePath, pin] of inventoryByPath) {
    const blobPath = path.join(blobsDir, pin.sha256)
    await assertContained(blobsDir, blobPath, 'WP11_SNAPSHOT_BLOB_PATH_ESCAPE')
    const blobStat = await stat(blobPath)
    assert.ok(blobStat.isFile(), 'WP11_SNAPSHOT_BLOB_NOT_FILE')
    assert.equal(blobStat.size, pin.bytes, 'WP11_SNAPSHOT_BLOB_BYTES')
    assert.ok(blobStat.size > 0 && blobStat.size <= MAX_BLOB_BYTES, 'WP11_SNAPSHOT_BLOB_BOUND')
    const bytes = await readFile(blobPath)
    assert.equal(bytes.length, pin.bytes, 'WP11_SNAPSHOT_BLOB_BYTES')
    assert.equal(sha256(bytes), pin.sha256, 'WP11_SNAPSHOT_BLOB_SUBSTITUTED')
    bytesByPath.set(relativePath, bytes)
    files.push({ path: relativePath, bytes: pin.bytes, sha256: pin.sha256 })
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const sealedKeys = [...sealedByPath.values()].map(sealedPinKey).sort()
  const snapshotKeys = files.map(sealedPinKey).sort()
  assert.deepEqual(snapshotKeys, sealedKeys, 'WP11_SNAPSHOT_SEALED_INVENTORY_MISMATCH')

  return {
    status: 'PASS',
    source: 'retained_historical_preimage_snapshot',
    source_commit: HISTORICAL_WP11_SOURCE_COMMIT,
    subject_sha256: HISTORICAL_WP11_SUBJECT_SHA256,
    receipt_path: SEALED_WP11_RECEIPT_PATH,
    receipt_bytes: SEALED_WP11_RECEIPT_BYTES,
    receipt_sha256: SEALED_WP11_RECEIPT_SHA256,
    snapshot_dir: snapshotDir,
    inventory_path: `${snapshotDir}/inventory.json`.replace(/\\/g, '/'),
    file_count: SEALED_WP11_FILE_COUNT,
    total_bytes: SEALED_WP11_TOTAL_BYTES,
    unique_blob_count: expectedBlobNames.size,
    git_required: false,
    execute_retained_sources: false,
    files,
    bytesByPath,
  }
}
