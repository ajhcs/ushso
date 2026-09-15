export const CITATION_FORMAT = 'ushso.source-citation.v1'
export const NOT_CAPTURED = 'not captured'

export interface SourceCitationInput {
  record_id: string
  title: string
  publisher?: string | null
  product?: string | null
  release?: string | null
  locator?: string | null
  observed_at?: string | null
  accessed_at?: string | null
  doi?: string | null
  authors?: string[] | null
  year?: string | null
  license?: string | null
  ushso_generation?: string | null
}

export interface SourceCitation {
  format: typeof CITATION_FORMAT
  record_id: string
  publisher: string
  product: string
  release: string
  locator: string
  observed_at: string
  accessed_at: string
  doi: string
  authors: string
  year: string
  license: string
  ushso_verification: string
  invented_fields: string[]
}

function captured(value: string | null | undefined) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : NOT_CAPTURED
}

function escapeBibtex(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('{', '\\{')
    .replaceAll('}', '\\}')
    .replaceAll('&', '\\&')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
}

function escapeRis(value: string) {
  return value.replaceAll('\r', ' ').replaceAll('\n', ' ')
}

export function buildSourceCitation(input: SourceCitationInput): SourceCitation {
  return {
    format: CITATION_FORMAT,
    record_id: input.record_id,
    publisher: captured(input.publisher),
    product: captured(input.product ?? input.title),
    release: captured(input.release),
    locator: captured(input.locator),
    observed_at: captured(input.observed_at),
    accessed_at: captured(input.accessed_at),
    doi: captured(input.doi),
    authors: Array.isArray(input.authors) && input.authors.length > 0 ? input.authors.join('; ') : NOT_CAPTURED,
    year: captured(input.year),
    license: captured(input.license),
    ushso_verification: input.ushso_generation
      ? `USHSO catalog verification for generation ${input.ushso_generation}; not a publisher endorsement.`
      : 'USHSO catalog verification not captured; not a publisher endorsement.',
    invented_fields: [],
  }
}

export function formatPlainTextCitation(citation: SourceCitation) {
  return [
    citation.product,
    citation.publisher === NOT_CAPTURED ? null : citation.publisher,
    citation.release === NOT_CAPTURED ? null : `Release ${citation.release}`,
    citation.year === NOT_CAPTURED ? 'Year not captured' : citation.year,
    citation.locator === NOT_CAPTURED ? 'Locator not captured' : citation.locator,
    citation.doi === NOT_CAPTURED ? 'DOI not captured' : `DOI ${citation.doi}`,
    citation.authors === NOT_CAPTURED ? 'Authors not captured' : `Authors: ${citation.authors}`,
    citation.license === NOT_CAPTURED ? 'License not captured' : `License: ${citation.license}`,
    `Observed ${citation.observed_at}; accessed ${citation.accessed_at}.`,
    citation.ushso_verification,
  ].filter(Boolean).join('. ')
}

export function formatBibTeX(citation: SourceCitation) {
  const key = citation.record_id.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 80)
  return [
    `@misc{${key},`,
    `  title = {${escapeBibtex(citation.product)}}`,
    citation.publisher === NOT_CAPTURED ? '  publisher = {not captured}' : `  publisher = {${escapeBibtex(citation.publisher)}}`,
    citation.year === NOT_CAPTURED ? '  year = {not captured}' : `  year = {${escapeBibtex(citation.year)}}`,
    citation.authors === NOT_CAPTURED ? '  author = {not captured}' : `  author = {${escapeBibtex(citation.authors)}}`,
    citation.doi === NOT_CAPTURED ? '  doi = {not captured}' : `  doi = {${escapeBibtex(citation.doi)}}`,
    citation.locator === NOT_CAPTURED ? '  url = {not captured}' : `  url = {${escapeBibtex(citation.locator)}}`,
    `  note = {${escapeBibtex(citation.ushso_verification)}}`,
    '}',
  ].join('\n')
}

export function formatRIS(citation: SourceCitation) {
  return [
    'TY  - DATA',
    `TI  - ${escapeRis(citation.product)}`,
    `PB  - ${escapeRis(citation.publisher)}`,
    `PY  - ${escapeRis(citation.year)}`,
    `AU  - ${escapeRis(citation.authors)}`,
    `DO  - ${escapeRis(citation.doi)}`,
    `UR  - ${escapeRis(citation.locator)}`,
    `N1  - ${escapeRis(citation.ushso_verification)}`,
    'ER  -',
  ].join('\n')
}
