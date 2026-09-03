import assert from 'node:assert/strict'
import test from 'node:test'

test('historical benchmark, evaluator, and baseline bytes remain frozen', async () => {
  const { result } = await import('../tools/legacy-evaluation-freeze.mjs')
  assert.equal(result.receipt_present, true)
  assert.equal(result.ok, true)
  assert.ok(result.file_count > 0)
})
