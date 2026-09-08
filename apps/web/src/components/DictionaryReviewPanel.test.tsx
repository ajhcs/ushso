import { afterEach, describe, expect, it, vi } from 'vitest'
import { dictionaryFieldDescription, dictionaryFieldUnit, readReviewPage } from './DictionaryReviewPanel'
const result = () => ({ record_id: 'record-a', generation: 'g1', review_status: 'pending_owner_review', publication_authorized: false, variables: [{ name: 'FIELD', description: null, unit: null }], variable_count: 2, next_cursor: 'cursor-next', warnings: ['Review only.'] })
afterEach(() => vi.unstubAllGlobals())
describe('bounded review dictionary client', () => {
  it('retains null definition and units and sends exact generation and cursor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: result() })))
    vi.stubGlobal('fetch', fetchMock)
    const page = await readReviewPage('record-a', 'g1', 'cursor-first')
    expect(page.variables[0].description).toBeNull(); expect(page.variables[0].unit).toBeNull()
    const url = new URL(fetchMock.mock.calls[0][0], 'http://local.test')
    expect(url.searchParams.get('generation')).toBe('g1'); expect(url.searchParams.get('cursor')).toBe('cursor-first')
  })
  it('rejects wrong identity, generation and promotion boundary', async () => {
    for (const change of [{ record_id: 'record-b' }, { generation: 'g2' }, { publication_authorized: true }, { review_status: 'approved' }, { variables: [{}] }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: { ...result(), ...change } }))))
      await expect(readReviewPage('record-a', 'g1', null)).rejects.toThrow('dictionary_response_identity_or_boundary')
    }
  })
  it('preserves typed restart and unavailable outcomes', async () => {
    for (const [status, code] of [[410, 'cursor_restart_required'], [404, 'dictionary_review_disabled']] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code } }), { status })))
      await expect(readReviewPage('record-a', null, null)).rejects.toThrow(code)
    }
  })
  it('rejects response overflow rather than buffering an unbounded dictionary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(' '.repeat(128 * 1024 + 1))))
    await expect(readReviewPage('record-a', null, null)).rejects.toThrow('dictionary_response_limit')
  })
  it('preserves bounded supplement identity without pretending it is a full definition', async () => {
    const value = result(), supplement = { field_sha256: 'a'.repeat(64), total_bytes: 100000, fragment_count: 4 }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: { ...value, variables: [{ ...value.variables[0], supplement }] } }))))
    expect((await readReviewPage('record-a', null, null)).variables[0].supplement).toEqual(supplement)
  })
  it('does not claim missing capture when only the supplement summary omits definition or unit', () => {
    const supplement = { field_sha256: 'b'.repeat(64), total_bytes: 90000, fragment_count: 3 }
    const omitted = { name: 'GLYPH', supplement }
    expect(dictionaryFieldDescription(omitted)).toBe('Definition omitted from this summary.')
    expect(dictionaryFieldUnit(omitted)).toBe('Omitted from this summary')
    expect(dictionaryFieldDescription(omitted)).not.toMatch(/not captured/i)
    expect(dictionaryFieldDescription({ name: 'PLAIN', description: null })).toBe('No normalized definition captured.')
    expect(dictionaryFieldDescription({ name: 'NULLISH', description: null, supplement })).toBe('No normalized definition captured.')
    expect(dictionaryFieldUnit({ name: 'NULLISH', unit: null, supplement })).toBe('Unknown')
    expect(dictionaryFieldDescription({ name: 'KEEP', description: 'exact publisher text', supplement })).toBe('exact publisher text')
    expect(dictionaryFieldUnit({ name: 'KEEP', unit: 'mg', supplement })).toBe('mg')
  })
})
