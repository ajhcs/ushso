import assert from 'node:assert/strict'
import test from 'node:test'

test('exact tester sources and every logical paragraph reconcile', async () => {
  const { result: receipt } = await import('../tools/validate-feedback-package.mjs')
  assert.equal(receipt.ok, true)
  assert.equal(receipt.logical_paragraphs_reconciled, 156)
  assert.equal(receipt.topics_reconciled, 21)
  assert.equal(receipt.requirements_tracked, 14)
  assert.equal(receipt.requirement_status_counts.implemented, 11)
  assert.equal(receipt.requirement_status_counts.planned, 3)
  assert.equal(receipt.requirement_status_counts.verified, 0)
  assert.equal(receipt.rejected_topics, 0)
})
