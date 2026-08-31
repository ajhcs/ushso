import assert from 'node:assert/strict'
import test from 'node:test'

test('all WP0 decisions are complete, linked, mapped, and byte-pinned', async () => {
  const { result } = await import('../tools/validate-adrs.mjs')
  assert.equal(result.receipt_present, true)
  assert.equal(result.ok, true)
  assert.equal(result.accepted_adrs, 6)
  assert.equal(result.files_audited, 7)
})
