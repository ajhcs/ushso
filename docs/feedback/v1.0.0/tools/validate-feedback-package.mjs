import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(root, '../../..')
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
const reconciliation = JSON.parse(await readFile(resolve(root, 'reconciliation.json'), 'utf8'))

const allowedStatuses = new Set(['accepted', 'planned', 'implemented', 'verified', 'rejected'])
const allowedDispositions = new Set(['accepted', 'rejected'])
const sourceById = new Map()
const errors = []

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function paragraphs(text) {
  return text
    .split(/\n[\t ]*\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

for (const source of manifest.sources) {
  const bytes = await readFile(resolve(root, source.file))
  const text = bytes.toString('utf8')
  const actual = {
    ...source,
    actual_sha256: sha256(bytes),
    actual_byte_count: bytes.byteLength,
    actual_line_count: text.split('\n').length,
    actual_logical_paragraph_count: paragraphs(text).length,
    bytes,
    text,
    paragraphs: paragraphs(text),
  }
  sourceById.set(source.source_id, actual)
  if (actual.actual_sha256 !== source.sha256) errors.push(`${source.source_id}: SHA-256 mismatch`)
  if (actual.actual_byte_count !== source.byte_count) errors.push(`${source.source_id}: byte count mismatch`)
  if (actual.actual_line_count !== source.line_count) errors.push(`${source.source_id}: line count mismatch`)
  if (actual.actual_logical_paragraph_count !== source.logical_paragraph_count) {
    errors.push(`${source.source_id}: logical paragraph count mismatch`)
  }
}

const requirementIds = new Set()
for (const requirement of reconciliation.requirements) {
  if (requirementIds.has(requirement.requirement_id)) errors.push(`duplicate requirement ${requirement.requirement_id}`)
  requirementIds.add(requirement.requirement_id)
  if (!allowedStatuses.has(requirement.status)) errors.push(`${requirement.requirement_id}: invalid status`)
  for (const field of ['owner', 'acceptance_test', 'receipt_target']) {
    if (typeof requirement[field] !== 'string' || requirement[field].length === 0) {
      errors.push(`${requirement.requirement_id}: missing ${field}`)
    }
  }
  if (requirement.status === 'rejected' && (!requirement.rejection_rationale || !requirement.product_owner_approval)) {
    errors.push(`${requirement.requirement_id}: rejected status requires rationale and product-owner approval`)
  }
  if (['implemented', 'verified'].includes(requirement.status) && (!Array.isArray(requirement.evidence) || requirement.evidence.length === 0)) {
    errors.push(`${requirement.requirement_id}: ${requirement.status} status requires evidence`)
  }
  for (const evidence of requirement.evidence ?? []) {
    if (typeof evidence !== 'string' || evidence.length === 0) {
      errors.push(`${requirement.requirement_id}: invalid evidence path`)
      continue
    }
    const absolute = resolve(repositoryRoot, evidence)
    const repositoryRelative = relative(repositoryRoot, absolute)
    if (repositoryRelative.startsWith('..') || isAbsolute(repositoryRelative)) {
      errors.push(`${requirement.requirement_id}: evidence escapes repository: ${evidence}`)
      continue
    }
    try {
      await access(absolute)
    } catch {
      errors.push(`${requirement.requirement_id}: evidence does not exist: ${evidence}`)
    }
  }
}

const covered = new Map([...sourceById].map(([id, source]) => [id, new Set(source.paragraphs.map((_, index) => index + 1))]))
const referencedRequirements = new Set()
const topicIds = new Set()
const markerPositions = new Map()
const bytePositions = new Map()

for (const topic of reconciliation.topics) {
  if (topicIds.has(topic.topic_id)) errors.push(`duplicate topic ${topic.topic_id}`)
  topicIds.add(topic.topic_id)
  const source = sourceById.get(topic.source_id)
  if (!source) {
    errors.push(`${topic.topic_id}: unknown source ${topic.source_id}`)
    continue
  }
  if (!allowedDispositions.has(topic.disposition)) errors.push(`${topic.topic_id}: invalid disposition`)
  if (topic.paragraph_start < 1 || topic.paragraph_end < topic.paragraph_start || topic.paragraph_end > source.paragraphs.length) {
    errors.push(`${topic.topic_id}: invalid paragraph range`)
  } else {
    for (let index = topic.paragraph_start; index <= topic.paragraph_end; index += 1) {
      covered.get(topic.source_id).delete(index)
    }
  }
  if (!Number.isInteger(topic.byte_start) || !Number.isInteger(topic.byte_end) || topic.byte_start < 0 || topic.byte_end <= topic.byte_start || topic.byte_end > source.bytes.byteLength) {
    errors.push(`${topic.topic_id}: invalid byte range`)
  }
  const markerBytes = Buffer.from(topic.start_marker, 'utf8')
  const markerIndex = source.bytes.indexOf(markerBytes)
  if (markerIndex === -1) errors.push(`${topic.topic_id}: start marker not found`)
  if (source.bytes.indexOf(markerBytes, markerIndex + 1) !== -1) errors.push(`${topic.topic_id}: start marker is not unique`)
  if (markerIndex !== -1 && (markerIndex < topic.byte_start || markerIndex >= topic.byte_end)) {
    errors.push(`${topic.topic_id}: start marker is outside its byte range`)
  }
  const priorMarker = markerPositions.get(topic.source_id) ?? -1
  if (markerIndex !== -1 && markerIndex <= priorMarker) errors.push(`${topic.topic_id}: topic markers are out of source order`)
  markerPositions.set(topic.source_id, markerIndex)
  const priorByteEnd = bytePositions.get(topic.source_id) ?? 0
  if (topic.byte_start < priorByteEnd) errors.push(`${topic.topic_id}: byte range overlaps the prior topic`)
  if (topic.byte_start > priorByteEnd) {
    const gap = source.bytes.subarray(priorByteEnd, topic.byte_start).toString('utf8')
    if (!/^\s*$/u.test(gap)) errors.push(`${topic.topic_id}: non-whitespace byte gap before topic`)
  }
  bytePositions.set(topic.source_id, topic.byte_end)
  if (!Array.isArray(topic.requirement_ids) || topic.requirement_ids.length === 0) {
    errors.push(`${topic.topic_id}: no requirement mapping`)
  }
  for (const requirementId of topic.requirement_ids ?? []) {
    if (!requirementIds.has(requirementId)) errors.push(`${topic.topic_id}: unknown requirement ${requirementId}`)
    referencedRequirements.add(requirementId)
  }
  if (topic.disposition === 'rejected' && (!topic.rationale || !topic.product_owner_approval)) {
    errors.push(`${topic.topic_id}: rejection requires rationale and product-owner approval`)
  }
}

for (const item of reconciliation.non_requirement_paragraphs) {
  const source = sourceById.get(item.source_id)
  if (!source || item.paragraph < 1 || item.paragraph > source.paragraphs.length || !item.rationale) {
    errors.push(`invalid non-requirement paragraph entry for ${item.source_id ?? 'unknown source'}`)
  } else {
    covered.get(item.source_id).delete(item.paragraph)
  }
}

for (const [sourceId, missing] of covered) {
  if (missing.size > 0) errors.push(`${sourceId}: unreconciled paragraphs ${[...missing].join(', ')}`)
}
for (const [sourceId, source] of sourceById) {
  const finalByte = bytePositions.get(sourceId) ?? 0
  if (finalByte < source.bytes.byteLength) {
    const tail = source.bytes.subarray(finalByte).toString('utf8')
    if (!/^\s*$/u.test(tail)) errors.push(`${sourceId}: non-whitespace bytes remain unreconciled`)
  }
}
for (const requirementId of requirementIds) {
  if (!referencedRequirements.has(requirementId)) errors.push(`${requirementId}: not referenced by a source topic`)
}

const result = {
  schema_version: 'ushso-tester-feedback-validation.v1.0.0',
  ok: errors.length === 0,
  package_version: manifest.package_version,
  verified_source_hashes: Object.fromEntries([...sourceById].map(([id, source]) => [id, source.actual_sha256])),
  logical_paragraphs_reconciled: [...sourceById.values()].reduce((sum, source) => sum + source.paragraphs.length, 0),
  topics_reconciled: reconciliation.topics.length,
  requirements_tracked: reconciliation.requirements.length,
  requirement_status_counts: Object.fromEntries([...allowedStatuses].map((status) => [status, reconciliation.requirements.filter((requirement) => requirement.status === status).length])),
  rejected_topics: reconciliation.rejected_topics.length,
  errors,
}

export { result }

if (process.argv.includes('--write-receipt')) {
  const receipt = {
    ...result,
    verified_at: new Date().toISOString(),
    validator: 'tools/validate-feedback-package.mjs',
  }
  await mkdir(resolve(root, 'validation'), { recursive: true })
  await writeFile(resolve(root, 'validation/validation-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
}

console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exitCode = 1
