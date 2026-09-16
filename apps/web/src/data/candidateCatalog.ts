// Candidate catalog entries and manifest-derived facts.
// Counts and versions derive from the published corpus manifests so the
// candidate preview cannot silently drift from its evidence packet.
import baselineCorpusJson from '../../../../packages/retrieval/versions/v1.2.0/corpus/corpus.json'
import candidateCorpusJson from '../../../../packages/retrieval/versions/v1.3.0/corpus/corpus.json'

type BaselineCorpus = { corpus_version: string; record_count: number; publication: { generation: string } }
type CandidateCorpus = { corpus_version: string; record_count: number; publication: { generation: string; parent_generation?: string; candidate_additive_records?: number }; baseline?: { corpus_version: string; generation: string; record_count: number } }

const baselineCorpus = baselineCorpusJson as unknown as BaselineCorpus
const candidateCorpus = candidateCorpusJson as unknown as CandidateCorpus

export const CANDIDATE_CORPUS_VERSION = candidateCorpus.corpus_version
export const CANDIDATE_GENERATION = candidateCorpus.publication.generation
export const CANDIDATE_PARENT_GENERATION = candidateCorpus.publication.parent_generation || (candidateCorpus.baseline ? candidateCorpus.baseline.generation : baselineCorpus.publication.generation)
export const CANDIDATE_RECORD_COUNT = candidateCorpus.record_count
export const CANDIDATE_BASELINE_RECORD_COUNT = candidateCorpus.baseline ? candidateCorpus.baseline.record_count : baselineCorpus.record_count
export const CANDIDATE_ADDITIVE_RECORD_COUNT = candidateCorpus.publication.candidate_additive_records || (CANDIDATE_RECORD_COUNT - CANDIDATE_BASELINE_RECORD_COUNT)

if (CANDIDATE_RECORD_COUNT !== CANDIDATE_BASELINE_RECORD_COUNT + CANDIDATE_ADDITIVE_RECORD_COUNT) {
  throw new Error('CANDIDATE_MANIFEST_MISMATCH: record arithmetic does not match the candidate manifest')
}
if (CANDIDATE_BASELINE_RECORD_COUNT !== baselineCorpus.record_count) {
  throw new Error('CANDIDATE_BASELINE_DRIFT: candidate parent count does not match the frozen baseline manifest')
}

export interface CandidateEntry {
  recordId: string
  routeId: string
  title: string
  publisher: string
  packetUrl: string
  packetFilename: string
  whatItIs: string
  whyItHelps: string
  whatIsDocumented: string
  whatWasChecked: string
  nextSteps: string
}

export const CANDIDATE_ENTRIES: CandidateEntry[] = [
  {
    recordId: 'obs:asset:candidate-ahrf-documentation-v1',
    routeId: 'candidate-ahrf-documentation-v1',
    title: 'HRSA Area Health Resources Files (AHRF)',
    publisher: 'Health Resources and Services Administration',
    packetUrl: '/corpus-candidate-v1.3.0/evidence-packets/hrsa-ahrf-evidence-packet.json',
    packetFilename: 'corr3-candidate-hrsa-ahrf-v1.json',
    whatItIs: 'Publisher documentation for HRSA Area Health Resources Files county workforce and resources files.',
    whyItHelps: 'Adds county workforce context missing from the baseline snapshot for questions about local health workforce and resources.',
    whatIsDocumented: 'The HRSA documentation page and access steps are documented. Coverage scope, reporting period, grain, and variable list are unknown and not inferred.',
    whatWasChecked: 'USHSO made no live request, retrieved no payload, and did not verify the locator. Access steps are documented but not executed.',
    nextSteps: 'Open the publisher documentation page, identify the exact dated file, and follow HRSA terms before citing or retrieving data.'
  },
  {
    recordId: 'obs:asset:candidate-sheps-closures-documentation-v1',
    routeId: 'candidate-sheps-closures-documentation-v1',
    title: 'Rural hospital closure tracking (Sheps Center)',
    publisher: 'Cecil G Sheps Center for Health Services Research University of North Carolina',
    packetUrl: '/corpus-candidate-v1.3.0/evidence-packets/rural-hospital-closure-evidence-packet.json',
    packetFilename: 'corr3-candidate-rural-hospital-closure-v1.json',
    whatItIs: 'Nongovernmental national list and methodology for documenting rural hospital closures from the Sheps Center.',
    whyItHelps: 'Documents rural closures with methodology where CMS enrollment files are not a substitute.',
    whatIsDocumented: 'The Sheps closure page and methodology are documented. Variable list and payload are unknown and not inferred.',
    whatWasChecked: 'USHSO made no live request, retrieved no payload, and did not verify the locator. Access steps are documented but not executed.',
    nextSteps: 'Open the Sheps closure page and identify the exact dated closure list before citing it.'
  }
]

if (CANDIDATE_ENTRIES.length !== CANDIDATE_ADDITIVE_RECORD_COUNT) {
  throw new Error('CANDIDATE_ENTRIES_MISMATCH: entry list does not match the manifest additive count')
}

export function isCandidateRecordId(recordId: string): boolean {
  return recordId.replace(/^obs:asset:/, '').startsWith('candidate-')
}

export function candidateEntryForRecordId(recordId: string): CandidateEntry | null {
  const needle = recordId.replace(/^obs:asset:/, '')
  return CANDIDATE_ENTRIES.find(function (entry) { return entry.recordId === recordId || entry.routeId === needle }) || null
}
