// Catalog build-mode single source of truth.
// Baseline is the approved production default: corpus v1.2.0, 3434 records,
// served at /api/discover. Candidate is an explicit research preview:
// additive v1.3.0-candidate, 3436 rows, served at /api/candidate/discover.
// Ordinary production builds select baseline. Candidate builds require an
// explicit mode via apps/web/.env.candidate plus vite mode candidate, or
// via VITE_CATALOG_MODE equals candidate. All catalog surfaces derive here.
import baselineCorpusJson from '../../../../packages/retrieval/versions/v1.2.0/corpus/corpus.json'
import { CANDIDATE_ADDITIVE_RECORD_COUNT, CANDIDATE_BASELINE_RECORD_COUNT, CANDIDATE_CORPUS_VERSION, CANDIDATE_ENTRIES, CANDIDATE_GENERATION, CANDIDATE_PARENT_GENERATION, CANDIDATE_RECORD_COUNT, candidateEntryForRecordId, isCandidateRecordId } from './candidateCatalog'

export type CatalogMode = 'baseline' | 'candidate'

export const BASELINE_DISCOVERY_API_PATH = '/api/discover'
export const CANDIDATE_DISCOVERY_API_PATH = '/api/candidate/discover'

interface ModeEnv {
  VITE_CATALOG_MODE?: unknown
  VITE_DISCOVERY_API_PATH?: unknown
}

export function resolveCatalogMode(env: ModeEnv): CatalogMode {
  const raw = typeof env.VITE_CATALOG_MODE === 'string' ? env.VITE_CATALOG_MODE : undefined
  const path = typeof env.VITE_DISCOVERY_API_PATH === 'string' ? env.VITE_DISCOVERY_API_PATH : undefined
  if (raw === 'candidate' || raw === 'baseline') {
    const expected = raw === 'candidate' ? CANDIDATE_DISCOVERY_API_PATH : BASELINE_DISCOVERY_API_PATH
    if (path !== undefined && path !== '' && path !== expected) {
      throw new Error('CATALOG_MODE_MISMATCH: VITE_CATALOG_MODE is ' + raw + ' but VITE_DISCOVERY_API_PATH is ' + path + ' expected ' + expected)
    }
    return raw
  }
  if (raw !== undefined && raw !== '') {
    throw new Error('CATALOG_MODE_UNKNOWN: VITE_CATALOG_MODE is ' + String(raw))
  }
  if (path === undefined || path === '' || path === BASELINE_DISCOVERY_API_PATH) {
    return 'baseline'
  }
  if (path === CANDIDATE_DISCOVERY_API_PATH) {
    return 'candidate'
  }
  throw new Error('CATALOG_MODE_UNKNOWN_API_PATH: VITE_DISCOVERY_API_PATH is ' + String(path))
}

export function discoveryApiPathForMode(mode: CatalogMode): string {
  return mode === 'candidate' ? CANDIDATE_DISCOVERY_API_PATH : BASELINE_DISCOVERY_API_PATH
}

export const CATALOG_MODE: CatalogMode = resolveCatalogMode(import.meta.env as ModeEnv)
export const IS_CANDIDATE_MODE: boolean = CATALOG_MODE === 'candidate'
export const DISCOVERY_API_PATH: string = discoveryApiPathForMode(CATALOG_MODE)

// Sibling read routes share the discovery path prefix (/api or /api/candidate).
// All three are derived here so docs pages cannot pin one mode while serving another.
export function catalogApiPathForMode(mode: CatalogMode): string {
  return discoveryApiPathForMode(mode).replace(/\/discover$/, '/catalog')
}
export function datasetApiPathPrefixForMode(mode: CatalogMode): string {
  return discoveryApiPathForMode(mode).replace(/\/discover$/, '/datasets')
}
export const CATALOG_API_PATH: string = catalogApiPathForMode(CATALOG_MODE)
export const DATASET_API_PATH_PREFIX: string = datasetApiPathPrefixForMode(CATALOG_MODE)

type BaselineCorpus = {
  corpus_id: string
  corpus_version: string
  record_count: number
  publication: { generation: string }
}

const baselineCorpus = baselineCorpusJson as unknown as BaselineCorpus

export const BASELINE_CORPUS_VERSION: string = baselineCorpus.corpus_version
export const BASELINE_GENERATION: string = baselineCorpus.publication.generation
export const BASELINE_RECORD_COUNT: number = baselineCorpus.record_count
export { CANDIDATE_ADDITIVE_RECORD_COUNT, CANDIDATE_BASELINE_RECORD_COUNT, CANDIDATE_CORPUS_VERSION, CANDIDATE_GENERATION, CANDIDATE_PARENT_GENERATION, CANDIDATE_RECORD_COUNT }

export const CATALOG_VERSION: string = IS_CANDIDATE_MODE ? CANDIDATE_CORPUS_VERSION : BASELINE_CORPUS_VERSION
export const CATALOG_GENERATION: string = IS_CANDIDATE_MODE ? CANDIDATE_GENERATION : BASELINE_GENERATION
export const CATALOG_RECORD_COUNT: number = IS_CANDIDATE_MODE ? CANDIDATE_RECORD_COUNT : BASELINE_RECORD_COUNT

export { CANDIDATE_ENTRIES, candidateEntryForRecordId, isCandidateRecordId }
