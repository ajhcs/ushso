import { describe, it, expect } from 'vitest'
import { assessmentGeneration, readSearchAssessment } from './searchAssessment'
import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
const fixture = () => ({ version: 'ushso.search-assessment.v1', record_id: 'record', question: 'maternal mortality', generation: 'generation', ranking_version: 'ranking-version', relevance: 'High', reasons: ['Matched outcome'] })
const read = (v: unknown) => readSearchAssessment(v, 'record', 'maternal mortality', 'generation')
describe('originating search assessment', () => {
  it('binds a direct dereference manifest to the same search generation without inventing publication identity', async () => {
    const result = await loadAcceptedDiscoveryFixture(); assertDiscoveryResult(result)
    result.corpus.manifest_sha256 = 'a'.repeat(64); delete result.corpus.generation; delete result.pagination
    expect(assessmentGeneration(result)).toBe('a'.repeat(64))
    delete result.corpus.manifest_sha256
    expect(assessmentGeneration(result)).toBe(`${result.corpus.corpus_id}@${result.corpus.corpus_version}`)
  })
  it('preserves the actual question, generation, ranking version and reasons', () => expect(read(fixture())).toEqual(fixture()))
  it('does not manufacture a rating for a direct or unbound lookup', () => { expect(read(null)).toBeNull(); expect(read({})).toBeNull() })
  it('rejects mismatched question, record, generation and unknown version', () => { for (const key of ['question', 'record_id', 'generation', 'version']) expect(read({ ...fixture(), [key]: 'wrong' })).toBeNull() })
  it('rejects malformed or unbounded ranking and explanation values', () => { for (const patch of [{ ranking_version: '' }, { relevance: 'Browse' }, { reasons: [{}] }, { reasons: ['x'.repeat(6001)] }]) expect(read({ ...fixture(), ...patch })).toBeNull() })
})
