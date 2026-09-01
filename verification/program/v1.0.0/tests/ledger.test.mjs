import assert from 'node:assert/strict'
import test from 'node:test'

test('program ledger inventories every tracked control family and preserves the product boundary', async () => {
  const { result } = await import('../tools/validate-ledger.mjs')
  assert.equal(result.ok, true)
  assert.equal(result.work_packages, 15)
  assert.equal(result.test_strategy_sections, 8)
  assert.equal(result.quality_gates, 9)
  assert.equal(result.migration_stages, 7)
  assert.equal(result.definition_of_done_items, 18)
  assert.equal(result.tester_requirements, 14)
})
