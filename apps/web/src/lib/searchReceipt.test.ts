import { describe, expect, it } from 'vitest'
import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import { createSearchReceipt, SEARCH_RECEIPT_VERSION, searchReceiptFilename, serializeSearchReceipt } from './searchReceipt'

describe('search receipts', () => {
  it('preserves the displayed order, source locators, question, and immutable catalog pin', async () => {
    const result = await loadAcceptedDiscoveryFixture()
    assertDiscoveryResult(result)
    const displayedIds = result.results.map((item) => item.record_id).reverse()
    const receipt = createSearchReceipt(result, { displayedIds, createdAt: '2026-09-06T12:00:00.000Z' })

    expect(receipt.manifest_version).toBe(SEARCH_RECEIPT_VERSION)
    expect(receipt.displayed_ordered_ids).toEqual(displayedIds)
    expect(receipt.question).toBe(result.query.question)
    expect(receipt.catalog_generation).toContain(result.corpus.corpus_version)
    expect(receipt.citations.map((source) => source.record_id)).toEqual(displayedIds)
    expect(receipt.citations.every((source) => source.title.length > 0)).toBe(true)
    expect(JSON.parse(serializeSearchReceipt(receipt))).toEqual(receipt)
    expect(searchReceiptFilename(receipt)).toMatch(/^ushso-search-receipt-2026-09-06-/)
  })

  it('rejects duplicate or non-response displayed IDs', async () => {
    const result = await loadAcceptedDiscoveryFixture()
    assertDiscoveryResult(result)
    const id = result.results[0].record_id
    expect(() => createSearchReceipt(result, { displayedIds: [id, id] })).toThrow(/unique/)
    expect(() => createSearchReceipt(result, { displayedIds: ['not-returned'] })).toThrow(/not present/)
  })
})
