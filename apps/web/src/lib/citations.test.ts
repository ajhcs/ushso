import { describe, expect, it } from 'vitest'
import { NOT_CAPTURED, buildSourceCitation, formatBibTeX, formatPlainTextCitation, formatRIS } from './citations'

const hcris = {
  record_id: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17',
  title: 'Hospital Provider Cost Report',
  publisher: 'Centers for Medicare & Medicaid Services',
  product: 'Hospital Provider Cost Report',
  release: 'documentation landing page',
  locator: 'https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report',
  observed_at: '2026-09-03T22:22:33.908Z',
  accessed_at: '2026-09-15T01:00:00.000Z',
  ushso_generation: 'live-2026-09-03-85b50522b420',
}

describe('source citations', () => {
  it('does not invent authors, DOI, year or publisher endorsement', () => {
    const citation = buildSourceCitation(hcris)
    expect(citation.doi).toBe(NOT_CAPTURED)
    expect(citation.authors).toBe(NOT_CAPTURED)
    expect(citation.year).toBe(NOT_CAPTURED)
    expect(citation.license).toBe(NOT_CAPTURED)
    expect(citation.invented_fields).toEqual([])
    expect(citation.ushso_verification).toContain('not a publisher endorsement')
    const plain = formatPlainTextCitation(citation)
    expect(plain).toContain('DOI not captured')
    expect(plain).toContain('Authors not captured')
    expect(plain).toContain('Year not captured')
    expect(plain).not.toMatch(/doi:\s*10\./i)
    expect(plain).not.toContain('CMS authors')
  })

  it('preserves special characters in BibTeX and RIS', () => {
    const citation = buildSourceCitation({ ...hcris, product: 'Cost Report {G-3} 100% & notes_here' })
    const bibtex = formatBibTeX(citation)
    expect(bibtex).toContain('Cost Report \\{G-3\\} 100\\% \\& notes\\_here')
    expect(bibtex).toContain('doi = {not captured}')
    expect(bibtex).toContain('author = {not captured}')
    const ris = formatRIS(citation)
    expect(ris).toContain('TY  - DATA')
    expect(ris).toContain('DO  - not captured')
    expect(ris).toContain('AU  - not captured')
  })
})
