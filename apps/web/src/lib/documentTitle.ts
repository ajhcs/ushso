const SITE_NAME = 'USHSO'
const MAX_LABEL_LENGTH = 72

function concise(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length <= MAX_LABEL_LENGTH) return normalized
  return `${normalized.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`
}

export function documentTitle(label: string) {
  const value = concise(label)
  return value ? `${value} | ${SITE_NAME}` : SITE_NAME
}

export function searchDocumentTitle(question: string, state: 'loading' | 'ready' | 'error' = 'ready') {
  if (state === 'loading') return documentTitle(question.trim() ? `Searching: ${question}` : 'Loading data catalog')
  if (state === 'error') return documentTitle(question.trim() ? `Search unavailable: ${question}` : 'Catalog unavailable')
  return documentTitle(question.trim() ? question : 'Browse data catalog')
}

export function datasetDocumentTitle(name: string | null | undefined, state: 'loading' | 'ready' | 'not_found' | 'unavailable' | 'error' = 'ready') {
  if (state === 'loading') return documentTitle('Loading dataset')
  if (state === 'unavailable') return documentTitle('Dataset unavailable')
  if (state === 'not_found') return documentTitle('Dataset record not found')
  if (state === 'error') return documentTitle('Dataset error')
  return documentTitle(name?.trim() || 'Dataset')
}

export function setDocumentTitle(title: string) {
  document.title = title
}
