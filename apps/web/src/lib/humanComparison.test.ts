import { describe, expect, it } from 'vitest'
import {
  HCRIS_HOSPITAL_COST_REPORT_ID,
  HOSPITAL_MRF_EXAMPLE_ID,
  PAYER_MRF_EXAMPLE_ID,
  PHC4_PUBLIC_FINANCIAL_REPORTS_ID,
  PRICE_TYPE_LABELS,
  compareHumanSources,
  plannerCompilationImplied,
  whyPairMayNotJoin,
} from './humanComparison'

describe('human comparison evidence', () => {
  it('keeps unknown and incomparable dimensions explicit without a numeric quality score', () => {
    const result = compareHumanSources([
      { record_id: HCRIS_HOSPITAL_COST_REPORT_ID, title: 'HCRIS' },
      { record_id: PHC4_PUBLIC_FINANCIAL_REPORTS_ID, title: 'PHC4' },
    ])
    expect(result.ranking_performed).toBe(false)
    expect(result.source_values_compared).toBe(false)
    expect(result.overall_quality_score).toBeNull()
    const grain = result.dimensions.find((row) => row.dimension === 'grain')
    const schema = result.dimensions.find((row) => row.dimension === 'variables_schema')
    const access = result.dimensions.find((row) => row.dimension === 'access')
    expect(grain?.state).toBe('incomparable')
    expect(schema?.state).toBe('incomparable')
    expect(access?.state).toBe('incomparable')
    expect(grain?.explanation).toMatch(/reporting definitions/i)
    expect(result.caveats.some((caveat) => /not PHC4/i.test(caveat))).toBe(true)
    const unknown = compareHumanSources([
      { record_id: 'obs:asset:unreviewed-example', title: 'Unknown A' },
      { record_id: 'obs:asset:unreviewed-other', title: 'Unknown B' },
    ])
    expect(unknown.dimensions.every((row) => row.state === 'unknown')).toBe(true)
    expect(unknown.dimensions.every((row) => row.explanation.includes('unknown'))).toBe(true)
  })

  it('does not let a beginner mistake negotiated rates for patient bills', () => {
    const result = compareHumanSources([
      { record_id: HOSPITAL_MRF_EXAMPLE_ID, title: 'Hospital MRF' },
      { record_id: PAYER_MRF_EXAMPLE_ID, title: 'Payer MRF' },
    ])
    expect(result.caveats).toContain(PRICE_TYPE_LABELS.negotiated_rate)
    expect(result.caveats.some((caveat) => /not a patient bill/i.test(caveat))).toBe(true)
    expect(whyPairMayNotJoin(HOSPITAL_MRF_EXAMPLE_ID, PAYER_MRF_EXAMPLE_ID)).toMatch(/not patient bills/i)
    expect(whyPairMayNotJoin(HCRIS_HOSPITAL_COST_REPORT_ID, PHC4_PUBLIC_FINANCIAL_REPORTS_ID)).toMatch(/not a confirmed merge/i)
  })

  it('keeps HCRIS and PHC4 overlay wording identical to the compare_assets registry overlay', async () => {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
    const overlay = await readFile(`${repositoryRoot}packages/registry/comparison-dimensions.mjs`, 'utf8')
    const human = await readFile(`${repositoryRoot}apps/web/src/lib/humanComparison.ts`, 'utf8')
    expect(human).not.toContain("from '../../../../packages/registry/comparison-dimensions.mjs'")
    for (const phrase of [
      'Not Pennsylvania PHC4 financial-statement reporting.',
      'Not CMS HCRIS Worksheet G-3 cost-report definitions.',
      'No automatic CCN=NPI or HCRIS-to-PHC4 identity merge.',
      'HCRIS Worksheet G-3 cost-report definitions are not PHC4 public financial-statement definitions.',
      'Envelope construction is not comparison completeness.',
    ]) {
      expect(overlay).toContain(phrase)
      expect(human).toContain(phrase)
    }
  })

  it('does not imply plan compilation from comparison or export', async () => {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
    const compare = await readFile(`${repositoryRoot}apps/web/src/pages/ComparePage.tsx`, 'utf8')
    const workspace = await readFile(`${repositoryRoot}apps/web/src/pages/WorkspacePage.tsx`, 'utf8')
    const plan = await readFile(`${repositoryRoot}apps/web/src/pages/PlanPage.tsx`, 'utf8')
    expect(plannerCompilationImplied(compare)).toBe(false)
    expect(plannerCompilationImplied(workspace)).toBe(false)
    expect(compare).toContain('does not compile a research plan')
    expect(workspace).toContain('does not compile a research plan')
    expect(plan).toContain('Plan compilation is not available yet.')
    expect(plan).toContain('Adding plan fields does not enable plan_research')
  })
})
