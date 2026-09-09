import { describe, expect, it } from 'vitest'
import { datasetDocumentTitle, documentTitle, searchDocumentTitle } from './documentTitle'

describe('route document titles', () => {
  it('creates distinct search, browse, dataset, loading, and error titles', () => {
    expect(searchDocumentTitle('maternal mortality')).toBe('maternal mortality | USHSO')
    expect(searchDocumentTitle('')).toBe('Browse data catalog | USHSO')
    expect(searchDocumentTitle('maternal mortality', 'loading')).toBe('Searching: maternal mortality | USHSO')
    expect(datasetDocumentTitle('National Health Interview Survey')).toBe('National Health Interview Survey | USHSO')
    expect(datasetDocumentTitle(null, 'unavailable')).toBe('Dataset unavailable | USHSO')
    expect(datasetDocumentTitle(null, 'not_found')).toBe('Dataset record not found | USHSO')
  })

  it('normalizes and bounds long labels', () => {
    expect(documentTitle('  About   the Observatory ')).toBe('About the Observatory | USHSO')
    expect(documentTitle('x'.repeat(100))).toMatch(/^x{71}… \| USHSO$/)
  })
})
