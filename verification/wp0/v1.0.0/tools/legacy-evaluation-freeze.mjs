import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../../..')
const roots = ['evaluation/benchmark/v0.1.0', 'evaluation/harness/v1.0.0', 'evaluation/baseline/v0.1.0']

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

const files = []
for (const root of roots) {
  for (const path of await walk(resolve(repositoryRoot, root))) {
    const bytes = await readFile(path)
    files.push({
      path: relative(repositoryRoot, path).replaceAll('\\', '/'),
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
}
files.sort((left, right) => left.path.localeCompare(right.path))
const snapshot = {
  schema_version: 'ushso-legacy-evaluation-freeze.v1.0.0',
  policy: 'historical evaluation artifacts are immutable reference evidence; corrections use external errata or versioned successors',
  roots,
  file_count: files.length,
  total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  content_digest_sha256: createHash('sha256').update(`${JSON.stringify(files)}\n`).digest('hex'),
  files,
}

const receiptPath = resolve(packageRoot, 'receipts/legacy-evaluation-freeze.json')
let expected = null
try {
  expected = JSON.parse(await readFile(receiptPath, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const errors = expected && JSON.stringify(expected) !== JSON.stringify(snapshot)
  ? ['historical evaluation bytes changed']
  : []

if (process.argv.includes('--write-receipt')) {
  if (expected && errors.length > 0) throw new Error(errors[0])
  await mkdir(dirname(receiptPath), { recursive: true })
  await writeFile(receiptPath, `${JSON.stringify(snapshot, null, 2)}\n`)
}

const result = {
  schema_version: 'ushso-legacy-evaluation-freeze-validation.v1.0.0',
  ok: errors.length === 0,
  receipt_present: expected !== null,
  file_count: files.length,
  content_digest_sha256: snapshot.content_digest_sha256,
  errors,
}

export { result }
console.log(JSON.stringify(result, null, 2))
if (!result.ok || (!expected && !process.argv.includes('--write-receipt'))) process.exitCode = 1
