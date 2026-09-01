import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const register = JSON.parse(await readFile(new URL('../register.json', import.meta.url), 'utf8'))
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))

async function jsonFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await jsonFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(path)
  }
  return files.sort()
}

function authorizationClaims(value, path = '$', claims = []) {
  if (!value || typeof value !== 'object') return claims
  if (Array.isArray(value)) {
    value.forEach((item, index) => authorizationClaims(item, `${path}[${index}]`, claims))
    return claims
  }

  for (const key of ['authorization_reference', 'external_authorization_id']) {
    const reference = value[key]
    if (typeof reference === 'string' && /^AUTH-\d{2}$/u.test(reference)) {
      claims.push({
        path,
        reference,
        authorized: value.authorized,
        statuses: [value.authorization_status, value.status].filter((status) => typeof status === 'string'),
      })
    }
  }
  for (const [key, child] of Object.entries(value)) authorizationClaims(child, `${path}.${key}`, claims)
  return claims
}

test('external actions remain explicitly unauthorized and prerequisite-bound', () => {
  const expectedIds = Array.from({ length: 17 }, (_, index) => `AUTH-${String(index + 1).padStart(2, '0')}`)
  assert.deepEqual(register.entries.map((entry) => entry.id), expectedIds)
  assert.equal(new Set(register.entries.map((entry) => entry.id)).size, expectedIds.length)
  assert.ok(register.entries.some((entry) => entry.id === 'AUTH-11' && entry.environment === 'production_foundation_no_traffic'))
  assert.ok(register.entries.some((entry) => entry.id === 'AUTH-12' && entry.environment === 'planner_governance'))
  assert.ok(register.entries.some((entry) => entry.id === 'AUTH-13' && entry.environment === 'retrieval_evaluation_governance'))
  assert.ok(register.entries.some((entry) => entry.id === 'AUTH-14' && entry.environment === 'identity_evaluation_governance'))
  assert.ok(register.entries.some((entry) => entry.id === 'AUTH-15' && entry.environment === 'coverage_product_governance'))
  assert.ok(register.entries.some((entry) => entry.id === 'AUTH-16' && entry.environment === 'researcher_usability_governance'))
  assert.ok(register.entries.some((entry) => entry.id === 'AUTH-17' && entry.environment === 'researcher_asset_review_governance'))
  for (const entry of register.entries) {
    assert.equal(entry.authorized, false, entry.id)
    assert.equal(entry.status, 'not_requested', entry.id)
    assert.ok(entry.required_before_request.length > 0, entry.id)
  }
})

test('verification artifacts cannot self-authorize external work', async () => {
  const entries = new Map(register.entries.map((entry) => [entry.id, entry]))
  const files = await jsonFiles(join(repositoryRoot, 'verification'))
  for (const file of files) {
    const document = JSON.parse(await readFile(file, 'utf8'))
    for (const claim of authorizationClaims(document)) {
      const entry = entries.get(claim.reference)
      assert.ok(entry, `${file}:${claim.path} references unknown ${claim.reference}`)
      const claimsAuthorization = claim.authorized === true
        || claim.statuses.some((status) => /^authorized(?:_|$)/u.test(status))
      if (claimsAuthorization) {
        assert.equal(entry.authorized, true, `${file}:${claim.path} claims ${claim.reference} authorization while the register denies it`)
        assert.match(entry.status, /^authorized(?:_|$)/u, `${claim.reference} register status does not record authorization`)
      }
    }
  }
})
