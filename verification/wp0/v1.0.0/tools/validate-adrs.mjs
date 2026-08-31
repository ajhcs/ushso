import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../../..')
const adrDirectory = resolve(repositoryRoot, 'docs/adr')
const adrFiles = [
  '0000-adr-policy-and-repository-shape.md',
  '0001-product-and-truth-boundary.md',
  '0002-contract-versioning-and-shared-semantics.md',
  '0003-identity-family-and-join-semantics.md',
  '0004-postgresql-cloudflare-and-immutable-publication.md',
  '0005-postgresql-search-backend-and-benchmark-escalation.md',
]
const requiredHeadings = [
  'Mapped requirements and tests',
  'Context',
  'Decision',
  'Alternatives considered',
  'Consequences',
  'Compatibility and rollout',
  'Implementation and verification',
]
const errors = []
const snapshots = []

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function linkExists(fromFile, link) {
  if (/^[a-z]+:/iu.test(link) || link.startsWith('#')) return true
  const target = link.split('#', 1)[0]
  if (!target) return true
  try {
    await access(resolve(dirname(fromFile), decodeURIComponent(target)))
    return true
  } catch {
    return false
  }
}

for (const file of adrFiles) {
  const path = resolve(adrDirectory, file)
  const bytes = await readFile(path)
  const text = bytes.toString('utf8')
  snapshots.push({ path: `docs/adr/${file}`, bytes: bytes.byteLength, sha256: sha256(bytes) })
  for (const field of ['Status', 'Decision date', 'Decision owners', 'Accountable approver role', 'Acceptance basis', 'Implementation state']) {
    if (!text.includes(`**${field}:**`)) errors.push(`${file}: missing ${field}`)
  }
  if (!/\*\*Status:\*\* Accepted(?:\r?\n|$)/u.test(text)) errors.push(`${file}: decision status is not Accepted`)
  if (!/\*\*Implementation state:\*\* `(not_started|in_progress|implemented|verified)`/u.test(text)) {
    errors.push(`${file}: invalid implementation state`)
  }
  for (const heading of requiredHeadings) {
    if (!text.includes(`## ${heading}`)) errors.push(`${file}: missing heading ${heading}`)
  }
  if (!/TST-[A-Z]+-\d{2}/u.test(text)) errors.push(`${file}: no tester requirement mapping`)
  if (!/verification\/.+\.json/u.test(text)) errors.push(`${file}: no verification receipt target`)
  if (!/external(?:ly)? authoriz/iu.test(text)) errors.push(`${file}: no external-authorization boundary`)

  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
    if (!await linkExists(path, match[1])) errors.push(`${file}: broken link ${match[1]}`)
  }
}

const indexPath = resolve(adrDirectory, 'README.md')
const indexBytes = await readFile(indexPath)
const indexText = indexBytes.toString('utf8')
snapshots.push({ path: 'docs/adr/README.md', bytes: indexBytes.byteLength, sha256: sha256(indexBytes) })
for (const file of adrFiles) {
  if (!indexText.includes(`](${file})`)) errors.push(`README.md: missing ${file}`)
}
for (const match of indexText.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
  if (!await linkExists(indexPath, match[1])) errors.push(`README.md: broken link ${match[1]}`)
}

snapshots.sort((left, right) => left.path.localeCompare(right.path))
const snapshot = {
  schema_version: 'ushso-wp0-adr-snapshot.v1.0.0',
  policy: 'accepted ADR decisions are append-only; material changes require a successor ADR',
  file_count: snapshots.length,
  content_digest_sha256: sha256(Buffer.from(`${JSON.stringify(snapshots)}\n`)),
  files: snapshots,
}

const receiptPath = resolve(packageRoot, 'receipts/adr-documentation-audit.json')
let expected = null
try {
  expected = JSON.parse(await readFile(receiptPath, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
if (expected && JSON.stringify(expected) !== JSON.stringify(snapshot)) errors.push('accepted ADR bytes differ from the WP0 receipt')

const result = {
  schema_version: 'ushso-wp0-adr-validation.v1.0.0',
  ok: errors.length === 0,
  accepted_adrs: adrFiles.length,
  files_audited: snapshots.length,
  receipt_present: expected !== null,
  content_digest_sha256: snapshot.content_digest_sha256,
  errors,
}

if (process.argv.includes('--write-receipt')) {
  const structuralErrors = errors.filter((error) => error !== 'accepted ADR bytes differ from the WP0 receipt')
  if (structuralErrors.length > 0) throw new Error(`refusing to write invalid ADR receipt: ${structuralErrors.join('; ')}`)
  await mkdir(dirname(receiptPath), { recursive: true })
  await writeFile(receiptPath, `${JSON.stringify(snapshot, null, 2)}\n`)
}

export { result }
console.log(JSON.stringify(result, null, 2))
if (!result.ok || (!expected && !process.argv.includes('--write-receipt'))) process.exitCode = 1
