export type CatalogMode = 'baseline' | 'research-candidate'

export interface CatalogDescriptor {
  mode: CatalogMode
  isCandidate: boolean
  corpusVersion: string
  generation: string
  recordCount: number
  apiPath: string
  displayLabel: string
}

const mode: CatalogMode = import.meta.env.VITE_CATALOG_MODE === 'research-candidate'
  ? 'research-candidate'
  : 'baseline'

export const ACTIVE_CATALOG: CatalogDescriptor = mode === 'research-candidate'
  ? {
      mode,
      isCandidate: true,
      corpusVersion: '1.3.0-candidate',
      generation: 'candidate-2026-09-17-corr3-v1.3.0',
      recordCount: 3436,
      apiPath: '/api/candidate/discover',
      displayLabel: 'research candidate catalog',
    }
  : {
      mode,
      isCandidate: false,
      corpusVersion: '1.2.0',
      generation: 'live-2026-09-03-85b50522b420',
      recordCount: 3434,
      apiPath: '/api/discover',
      displayLabel: 'published baseline catalog',
    }

export function isResearchCandidateMode() {
  return ACTIVE_CATALOG.isCandidate
}
