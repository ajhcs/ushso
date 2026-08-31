import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mappings = [
  {
    dependency_id: 'obs:dependency:retrieval-curated-assets:v1.0.0',
    source: 'packages/retrieval/fixtures/curated-assets.json',
    target: 'observatory/retrieval/v1.0.0/fixtures/curated-assets.json',
    byte_sha256: '920eac8ba08008daa3f59d746f0c78ab9c3160e55675925c9c665bfc136eed57',
  },
]

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

const errors = []
const results = []
for (const mapping of mappings) {
  const sourcePath = resolve(repositoryRoot, mapping.source)
  const targetPath = resolve(repositoryRoot, mapping.target)
  const sourceBytes = await readFile(sourcePath)
  const sourceHash = sha256(sourceBytes)
  if (sourceHash !== mapping.byte_sha256) errors.push(`${mapping.dependency_id}: source hash changed`)

  let targetBytes = null
  try {
    targetBytes = await readFile(targetPath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  if (process.argv.includes('--write')) {
    if (sourceHash !== mapping.byte_sha256) throw new Error(`refusing to materialize changed dependency ${mapping.dependency_id}`)
    if (targetBytes && !targetBytes.equals(sourceBytes)) throw new Error(`refusing to overwrite divergent compatibility target ${mapping.target}`)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, sourceBytes)
    targetBytes = sourceBytes
  }

  const targetHash = targetBytes ? sha256(targetBytes) : null
  if (!targetBytes) errors.push(`${mapping.dependency_id}: compatibility target missing`)
  else if (!targetBytes.equals(sourceBytes) || targetHash !== mapping.byte_sha256) {
    errors.push(`${mapping.dependency_id}: compatibility target bytes differ`)
  }
  results.push({ ...mapping, source_bytes: sourceBytes.byteLength, source_hash: sourceHash, target_hash: targetHash })
}

const result = {
  schema_version: 'ushso-v1-contract-compatibility.v1.0.0',
  ok: errors.length === 0,
  mappings: results,
  errors,
}

export { result }
console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exitCode = 1
