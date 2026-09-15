import { describe, expect, it } from 'vitest'
import { LAST_GOOD_GENERATION_ID, buildResearchExport, parseImportedPacket, validateResearchExport } from './researchExport'
import { NOT_CAPTURED } from './citations'

const items = [
  {
    record_id: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17',
    title: 'Hospital Provider Cost Report',
    source_name: 'CMS',
    details_path: '/datasets/obs%3Aasset%3Acms-data-catalog%3Adata.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17',
    generation: LAST_GOOD_GENERATION_ID,
    added_at: '2026-09-03T22:22:33.908Z',
    notes: 'do not upload this note',
  },
  {
    record_id: 'obs:asset:pa-phc4-public-financial-reports',
    title: 'PHC4 Public Hospital Financial Reports',
    source_name: 'PHC4',
    details_path: '/datasets/obs%3Aasset%3Apa-phc4-public-financial-reports',
    generation: LAST_GOOD_GENERATION_ID,
    added_at: '2026-09-03T22:22:33.908Z',
    notes: 'private PHC4 note',
  },
]

describe('research packet export', () => {
  it('excludes credentials and defaults to source evidence without question or notes', () => {
    const packet = buildResearchExport(items, { question: 'secret research question' })
    const validated = validateResearchExport(packet)
    expect(validated.valid).toBe(true)
    expect(packet.credentials).toBeNull()
    expect(packet.question).toBeNull()
    expect(packet.sources.every((source) => source.notes === null)).toBe(true)
    expect(packet.sources[0].citation.doi).toBe(NOT_CAPTURED)
    expect(packet.recipes.every((recipe) => recipe.secrets === null)).toBe(true)
    expect(JSON.stringify(packet)).not.toMatch(/authorization|api_key|signed_url|do not upload this note|secret research question/i)
    expect(packet.source_order).toEqual(items.map((item) => item.record_id))
  })

  it('includes question and notes only with explicit choice and preserves order on re-import', () => {
    const packet = buildResearchExport(items, { include_question: true, include_notes: true, question: 'Compare HCRIS and PHC4 definitions' })
    expect(packet.question).toBe('Compare HCRIS and PHC4 definitions')
    expect(packet.sources[0].notes).toBe('do not upload this note')
    const imported = parseImportedPacket(JSON.stringify(packet))
    expect(imported.valid).toBe(true)
    expect(imported.silent_search_rerun).toBe(false)
    expect(imported.packet.source_order).toEqual(packet.source_order)
    expect(imported.packet.generation).toBe(packet.generation)
    expect(imported.readable_summary).toContain('Hospital Provider Cost Report')
    expect(imported.readable_summary).toContain('USHSO verification is separate')
  })

  it('types a retired generation instead of silently re-running a different search', () => {
    const retired = buildResearchExport([{ ...items[0], generation: 'live-2026-08-01-old' }])
    expect(retired.generation_state).toBe('retired')
    expect(retired.limitations.some((line) => /must not silently re-run a different search/.test(line))).toBe(true)
    const imported = parseImportedPacket(JSON.stringify(retired))
    expect(imported.retired).toBe(true)
    expect(imported.silent_search_rerun).toBe(false)
  })
})
