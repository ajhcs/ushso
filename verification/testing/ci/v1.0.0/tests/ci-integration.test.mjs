import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildCiIntegrationReceipt, receiptPath } from '../tools/ci-inventory.mjs'

test('stored CI integration receipt matches fail-closed package discovery', async () => {
  const expected = await buildCiIntegrationReceipt()
  const stored = JSON.parse(await readFile(receiptPath, 'utf8'))
  assert.deepEqual(stored, expected)
  assert.equal(stored.status, 'PASS')
  assert.ok(stored.contract_packages.some((item) => item.path === 'contracts/machine-toolkit/v1.0.0'))
  assert.ok(stored.contract_packages.every((item) => item.node_test_file_count > 0))
  assert.ok(stored.verification_suites.every((item) => item.node_test_file_count > 0))
  assert.equal(stored.live_source_requests, 'forbidden')
  assert.equal(stored.sealed_receipts_mutated, false)
  assert.equal(stored.external_requests, 0)
  assert.equal(stored.external_mutations, 0)
  assert.deepEqual(stored.package_lock, {
    status: 'PASS',
    lockfile_version: 3,
    root_workspace_patterns: stored.workspace_patterns,
    workspace_entry_count: stored.workspace_package_count,
    workspace_link_count: stored.workspace_package_count,
  })
})
