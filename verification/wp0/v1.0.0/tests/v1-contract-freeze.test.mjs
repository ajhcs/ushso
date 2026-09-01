import assert from 'node:assert/strict'
import test from 'node:test'

test('existing v1 contracts remain byte-for-byte frozen', async () => {
  const { result } = await import('../tools/v1-contract-freeze.mjs')
  assert.equal(result.receipt_present, true)
  assert.equal(result.ok, true)
  assert.equal(result.snapshot.roots.length, 2)
  assert.ok(result.snapshot.file_count > 0)
})
