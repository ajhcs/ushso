import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../../..')
const ledgerPath = resolve(packageRoot, 'ledger.json')
const feedbackPath = resolve(repositoryRoot, 'docs/feedback/v1.0.0/reconciliation.json')
const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'))
const feedback = JSON.parse(await readFile(feedbackPath, 'utf8'))

const errors = []
const expectedPrefixes = new Map([
  ['WP', 15],
  ['T22.', 8],
  ['G23.', 9],
  ['M24.', 7],
  ['DOD-', 18],
])
const allowedStatuses = new Set(ledger.status_vocabulary)
const ids = new Set()

for (const control of ledger.controls) {
  if (ids.has(control.id)) errors.push(`duplicate control ${control.id}`)
  ids.add(control.id)
  for (const field of ['source', 'title', 'owner']) {
    if (typeof control[field] !== 'string' || control[field].trim() === '') errors.push(`${control.id}: missing ${field}`)
  }
  if (!allowedStatuses.has(control.status)) errors.push(`${control.id}: unknown status ${control.status}`)
  if (!Array.isArray(control.test_ids) || control.test_ids.length === 0) errors.push(`${control.id}: missing test IDs`)
  if (!Array.isArray(control.receipt_targets) || control.receipt_targets.length === 0) errors.push(`${control.id}: missing receipt targets`)
  if (control.status === 'verified' && (!Array.isArray(control.evidence) || control.evidence.length === 0)) {
    errors.push(`${control.id}: verified without evidence`)
  }
  if (control.status === 'pending_external_authorization' && (!Array.isArray(control.external_authorization) || control.external_authorization.length === 0)) {
    errors.push(`${control.id}: external status without an exact authorization boundary`)
  }
  if (control.status === 'rejected' && (!control.rationale || !control.product_owner_approval)) {
    errors.push(`${control.id}: rejection lacks rationale or product-owner approval`)
  }
}

for (const [prefix, count] of expectedPrefixes) {
  const actual = [...ids].filter((id) => id.startsWith(prefix)).length
  if (actual !== count) errors.push(`${prefix}: expected ${count} controls, received ${actual}`)
}

const requiredWpIds = Array.from({ length: 15 }, (_, index) => `WP${index}`)
for (const id of requiredWpIds) if (!ids.has(id)) errors.push(`missing ${id}`)

assert.equal(ledger.product_boundary.recommend_explain_compile_only, true)
for (const [key, value] of Object.entries(ledger.product_boundary)) {
  if (key !== 'recommend_explain_compile_only' && value !== false) errors.push(`product boundary ${key} must remain false`)
}

const feedbackIds = feedback.requirements.map((item) => item.requirement_id)
if (feedbackIds.length !== 14 || new Set(feedbackIds).size !== 14) errors.push('tester requirement ledger must expose 14 unique IDs')
for (const requirement of feedback.requirements) {
  for (const field of ['owner', 'status', 'acceptance_test', 'receipt_target']) {
    if (!requirement[field]) errors.push(`${requirement.requirement_id}: feedback requirement missing ${field}`)
  }
}

const result = {
  schema_version: 'ushso-program-ledger-validation.v1.0.0',
  ok: errors.length === 0,
  controls: ledger.controls.length,
  work_packages: requiredWpIds.length,
  test_strategy_sections: 8,
  quality_gates: 9,
  migration_stages: 7,
  definition_of_done_items: 18,
  tester_requirements: feedbackIds.length,
  status_counts: Object.fromEntries(ledger.status_vocabulary.map((status) => [status, ledger.controls.filter((control) => control.status === status).length])),
  errors,
}

export { result }

if (process.argv.includes('--write-receipt')) {
  const receiptPath = resolve(packageRoot, 'validation/validation-receipt.json')
  await mkdir(dirname(receiptPath), { recursive: true })
  await writeFile(receiptPath, `${JSON.stringify({ ...result, verified_at: new Date().toISOString(), validator: 'tools/validate-ledger.mjs' }, null, 2)}\n`)
}

console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exitCode = 1
