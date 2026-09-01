import assert from 'node:assert/strict'
import test from 'node:test'

test('immutable v1 dependency pins resolve through exact-byte compatibility materialization', async () => {
  const { result } = await import('../scripts/materialize-v1-contract-compatibility.mjs')
  assert.equal(result.ok, true)
  assert.equal(result.mappings.length, 1)
  assert.equal(result.mappings[0].source_hash, result.mappings[0].target_hash)
})
