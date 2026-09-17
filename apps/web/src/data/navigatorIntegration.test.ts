import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

async function navigator(mode: 'baseline' | 'candidate') {
  vi.resetModules()
  vi.stubEnv('VITE_CATALOG_MODE', mode)
  vi.stubEnv('VITE_DISCOVERY_API_PATH', mode === 'candidate' ? '/api/candidate/discover' : '/api/discover')
  return import('./researchNavigator')
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

const records = [1, 2, 3].flatMap(n => readFileSync(new URL(`../../../../packages/retrieval/versions/v1.2.0/corpus/records-000${n}.jsonl`, import.meta.url), 'utf8').trim().split('\n').map(line => JSON.parse(line)))

describe('integrated navigator evidence and catalog modes', () => {
  it.each(['baseline', 'candidate'] as const)('agrees with API configuration and indexed membership in %s', async mode => {
    const nav = await navigator(mode)
    const { ACTIVE_CATALOG, DISCOVERY_API_PATH } = await import('./catalogMode')
    expect(ACTIVE_CATALOG.apiPath).toBe(DISCOVERY_API_PATH)
    const question = nav.PRIORITY_RESEARCH_QUESTIONS.find(q => q.id === 'hrsa-workforce')!
    const packet = nav.buildPriorityResearchPacket(question)
    expect(packet.catalog.mode).toBe(mode)
    expect(packet.catalog.recordCount).toBe(mode === 'candidate' ? 3436 : 3434)
    expect(packet.sources[0].coverage).toBe(mode === 'candidate' ? 'indexed' : 'named_gap')
    expect(Boolean(packet.sources[0].catalogRecordId)).toBe(mode === 'candidate')
    expect(packet.sources[0].facts.some(f => f.state === 'successfully_tested')).toBe(false)
  })

  it('binds indexed profiles to actual retained records and evidence IDs', async () => {
    const nav = await navigator('baseline')
    for (const profile of nav.RESEARCH_SOURCE_PROFILES.filter(p => p.coverage === 'indexed')) {
      const record = records.find(r => r.record_id === profile.catalogRecordId)
      expect(record, profile.id).toBeDefined()
      for (const ref of profile.evidenceRefs) {
        const evidenceId = ref.split('#')[1]
        expect(record.evidence.some((e: { evidence_id: string }) => e.evidence_id === evidenceId), ref).toBe(true)
      }
    }
  })

  it('preserves product-specific scope and documented cadence without claiming payload tests', async () => {
    const nav = await navigator('baseline')
    const brfss = nav.sourceProfileForId('cdc-brfss')!
    const brfssRecord = records.find(r => r.record_id === brfss.catalogRecordId)
    expect(brfssRecord.description).toMatch(/Nationwide estimates are not available/)
    expect(brfss.facts.find(f => f.label === 'Geography')?.value).toMatch(/nationwide estimates are not available/)
    const maternal = nav.sourceProfileForId('cdc-maternal')!
    const maternalRecord = records.find(r => r.record_id === maternal.catalogRecordId)
    expect(maternalRecord.description).toMatch(/quarter/i)
    expect(maternal.facts.find(f => f.label === 'Cadence')?.state).toBe('publisher_documented')
    expect(maternal.facts.find(f => f.label === 'Grain')?.value).not.toMatch(/state and facility/)
    const sahie = nav.sourceProfileForId('census-sahie')!
    expect(records.find(r => r.record_id === sahie.catalogRecordId).description).toMatch(/all counties in the U.S./)
    expect(sahie.facts.find(f => f.label === 'Geography')?.state).toBe('publisher_documented')
    for (const profile of [brfss, maternal, sahie]) expect(profile.facts.some(f => f.state === 'successfully_tested')).toBe(false)
  })
})
