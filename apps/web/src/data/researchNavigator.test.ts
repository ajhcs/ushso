import { describe, expect, it } from 'vitest'
import { ACTIVE_CATALOG } from './catalogDescriptor'
import { buildPriorityResearchPacket, findPriorityResearchQuestion, PRIORITY_RESEARCH_QUESTIONS, RESEARCH_SOURCE_PROFILES, validatePriorityResearchNavigator } from './researchNavigator'

describe('frozen priority research navigator', () => {
  it('covers exactly 20 questions and at least eight named source families', () => {
    expect(validatePriorityResearchNavigator()).toBe(true)
    expect(PRIORITY_RESEARCH_QUESTIONS).toHaveLength(20)
    expect(new Set(PRIORITY_RESEARCH_QUESTIONS.flatMap((question) => question.familyIds)).size).toBeGreaterThanOrEqual(8)
    expect(new Set(PRIORITY_RESEARCH_QUESTIONS.map((question) => question.id)).size).toBe(20)
  })

  it('binds every source profile dimension to an evidence state and reference', () => {
    expect(RESEARCH_SOURCE_PROFILES.length).toBeGreaterThanOrEqual(20)
    for (const profile of RESEARCH_SOURCE_PROFILES) {
      expect(profile.publisher).not.toBe('')
      expect(profile.product).not.toBe('')
      expect(profile.officialDiscoveryUrl).toMatch(/^https:\/\//)
      expect(profile.facts.map((item) => item.label)).toEqual(expect.arrayContaining([
        'Population / entity', 'Geography', 'Period', 'Grain', 'Cadence', 'Variables / dictionary', 'Access / cost / account', 'IDs / joins',
      ]))
      for (const item of profile.facts) {
        expect(item.value).not.toBe('')
        expect(item.state).toBeTruthy()
        expect(item.evidenceRefs.length).toBeGreaterThan(0)
      }
    }
  })

  it('matches representative search language without inventing a result for unrelated text', () => {
    expect(findPriorityResearchQuestion('CMS HCRIS hospital cost reports')?.id).toBe('hospital-finance-hcris')
    expect(findPriorityResearchQuestion('Where can I find quarterly provisional infant mortality?')?.id).toBe('infant-mortality')
    expect(findPriorityResearchQuestion('NPPES provider identity')?.id).toBe('nppes-provider-identity')
    for (const question of PRIORITY_RESEARCH_QUESTIONS) {
      expect(findPriorityResearchQuestion(question.question)?.id).toBe(question.id)
    }
    expect(findPriorityResearchQuestion('a source about unrelated astronomy')).toBeNull()
  })

  it('creates a packet from the same data rendered in the brief', () => {
    const question = PRIORITY_RESEARCH_QUESTIONS.find((item) => item.id === 'svi-social-vulnerability')!
    const packet = buildPriorityResearchPacket(question)
    expect(packet.contractVersion).toBe('ushso-priority-research-evidence-packet.v1.0.0')
    expect(packet.questionSetVersion).toBe('priority-questions-v1.0.0')
    expect(packet.catalog.mode).toBe(ACTIVE_CATALOG.mode)
    expect(packet.sources[0].coverage).toBe('named_gap')
    expect(packet.sources[0].facts.find((item) => item.label === 'Name collision')?.state).toBe('conflicting')
    expect(JSON.stringify(packet)).not.toMatch(/api[_-]?key|access[_-]?token|authorization:\s*bearer/i)
  })
})
