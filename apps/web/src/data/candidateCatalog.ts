// Correction-3 candidate catalog constants (v1.3.0-candidate).
// Baseline constants on individual pages still describe the frozen baseline;
// these constants describe the additive candidate served by the app build.
export const CANDIDATE_CORPUS_VERSION = '1.3.0-candidate'
export const CANDIDATE_GENERATION = 'candidate-2026-09-17-corr3-v1.3.0'
export const CANDIDATE_PARENT_GENERATION = 'live-2026-09-03-85b50522b420'
export const CANDIDATE_RECORD_COUNT = 3436
export const CANDIDATE_BASELINE_RECORD_COUNT = 3434
export const CANDIDATE_ADDITIVE_RECORD_COUNT = 2

export interface CandidateEntry {
  recordId: string
  routeId: string
  title: string
  publisher: string
  packetUrl: string
  packetFilename: string
}

export const CANDIDATE_ENTRIES: CandidateEntry[] = [
  {
    recordId: 'obs:asset:candidate-ahrf-documentation-v1',
    routeId: 'candidate-ahrf-documentation-v1',
    title: 'HRSA Area Health Resources Files (AHRF)',
    publisher: 'Health Resources and Services Administration',
    packetUrl: '/corpus-candidate-v1.3.0/evidence-packets/hrsa-ahrf-evidence-packet.json',
    packetFilename: 'corr3-candidate-hrsa-ahrf-v1.json',
  },
  {
    recordId: 'obs:asset:candidate-sheps-closures-documentation-v1',
    routeId: 'candidate-sheps-closures-documentation-v1',
    title: 'Rural hospital closure tracking (Sheps Center)',
    publisher: 'Cecil G. Sheps Center for Health Services Research, University of North Carolina',
    packetUrl: '/corpus-candidate-v1.3.0/evidence-packets/rural-hospital-closure-evidence-packet.json',
    packetFilename: 'corr3-candidate-rural-hospital-closure-v1.json',
  },
]

export function isCandidateRecordId(recordId: string): boolean {
  return recordId.replace(/^obs:asset:/, '').startsWith('candidate-')
}

export function candidateEntryForRecordId(recordId: string): CandidateEntry | null {
  const needle = recordId.replace(/^obs:asset:/, '')
  return CANDIDATE_ENTRIES.find((entry) => entry.recordId === recordId || entry.routeId === needle) ?? null
}
