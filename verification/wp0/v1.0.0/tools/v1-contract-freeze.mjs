import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../../..')
const contractRoots = ['contracts/core/v1.0.0', 'contracts/use-access/v1.0.0']

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesUnder(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

const files = []
for (const root of contractRoots) {
  for (const path of await filesUnder(resolve(repositoryRoot, root))) {
    const bytes = await readFile(path)
    files.push({
      path: relative(repositoryRoot, path).replaceAll('\\', '/'),
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
}
files.sort((left, right) => left.path.localeCompare(right.path))

const contentDigest = createHash('sha256')
  .update(`${JSON.stringify(files)}\n`)
  .digest('hex')

const snapshot = {
  schema_version: 'ushso-v1-contract-freeze.v1.0.0',
  policy: 'byte_for_byte_immutable; changes require a versioned successor contract',
  roots: contractRoots,
  file_count: files.length,
  total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  content_digest_sha256: contentDigest,
  files,
}

const receiptPath = resolve(packageRoot, 'receipts/v1-contract-freeze.json')
let expected = null
try {
  expected = JSON.parse(await readFile(receiptPath, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const errors = []
if (expected) {
  for (const field of ['schema_version', 'policy', 'file_count', 'total_bytes', 'content_digest_sha256']) {
    if (expected[field] !== snapshot[field]) errors.push(`${field} changed`)
  }
  if (JSON.stringify(expected.roots) !== JSON.stringify(snapshot.roots)) errors.push('contract roots changed')
  if (JSON.stringify(expected.files) !== JSON.stringify(snapshot.files)) errors.push('one or more v1 contract bytes changed')
}

const result = {
  schema_version: 'ushso-v1-contract-freeze-validation.v1.0.0',
  ok: errors.length === 0,
  snapshot,
  receipt_present: expected !== null,
  errors,
}

if (process.argv.includes('--write-receipt')) {
  if (expected && errors.length > 0) throw new Error(`refusing to replace a changed v1 freeze receipt: ${errors.join('; ')}`)
  await mkdir(dirname(receiptPath), { recursive: true })
  await writeFile(receiptPath, `${JSON.stringify(snapshot, null, 2)}\n`)
}

export { result }
console.log(JSON.stringify({ ...result, snapshot: { ...snapshot, files: `[${snapshot.file_count} pinned files]` } }, null, 2))
if (!result.ok || (!expected && !process.argv.includes('--write-receipt'))) process.exitCode = 1
