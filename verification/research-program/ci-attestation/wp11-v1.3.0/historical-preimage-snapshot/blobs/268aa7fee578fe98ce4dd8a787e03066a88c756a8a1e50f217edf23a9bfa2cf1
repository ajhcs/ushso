import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResearcherDecisionSummary } from '../components/ResearcherDecisionSummary'
import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import { adaptDiscoveryResponse } from './catalogAdapter'
import { buildResearcherGuidance } from './researcherGuidance'

const response = await loadAcceptedDiscoveryFixture()
assertDiscoveryResult(response)
const dataset = adaptDiscoveryResponse(response).records[0]

describe('researcher decision guidance', () => {
  it('preserves every required Use Card field with evidence and unresolved truth', () => {
    const guidance = buildResearcherGuidance(dataset)
    expect(guidance.useCard.fields.map((field) => field.label)).toEqual([
      'Best for',
      'Not sufficient for',
      'Key analytic cautions',
      'Typical unit',
      'Known breaks in series',
      'Update frequency and expected lag',
      'Suppression and completeness',
      'Identifier stability over time',
      'Source-reported, derived, and proxy measures',
      'Compatible geography, time, and grain',
      'Join and crosswalk requirements',
    ])
    expect(guidance.useCard.fields.every((field) => field.values.length > 0 && field.evidenceIds.length > 0)).toBe(true)
    expect(guidance.reviewStatus).toBe('pending_external_researcher_review')
    expect(JSON.stringify(guidance)).not.toMatch(/analysis_result|market_share|financial_benchmark|computed_estimate/)
  })

  it('keeps access and retrieval explanatory, typed, and non-executing', () => {
    const guidance = buildResearcherGuidance(dataset)
    expect(guidance.accessPlan.typedFailures.every((failure) => failure.translateToNotFound === false)).toBe(true)
    expect(guidance.accessPlan.turnaround).toEqual({ category: 'unknown', statement: 'No evidenced turnaround category or point estimate is captured.' })
    expect(guidance.retrievalRecipe.promotionState).toBe('incomplete_exact_pins')
    expect(guidance.retrievalRecipe.missingPins).toEqual(['release_id', 'distribution_id', 'access_route_id'])
    expect(guidance.retrievalRecipe.steps.every((step) => step.executionAllowed === false)).toBe(true)
    expect(guidance.retrievalRecipe.boundary).toEqual({ executionAllowed: false, payloadAcquisitionClaimed: false, authorizationClaimed: false })
  })

  it('renders Use Card, Access Plan, Retrieval Recipe, evidence labels, and machine-readiness flags', () => {
    const markup = renderToStaticMarkup(createElement(ResearcherDecisionSummary, { dataset }))
    expect(markup).toContain('aria-labelledby="researcher-guidance-heading"')
    expect(markup).toContain('id="use-card-heading"')
    expect(markup).toContain('id="access-plan-heading"')
    expect(markup).toContain('id="retrieval-recipe-heading"')
    expect(markup).toContain('external review pending')
    expect(markup).toContain('Evidence:')
    expect(markup).toContain('Machine-readiness flags')
    expect(markup).toContain('Execution allowed: no')
    expect(markup.match(/<article class="guidance-card/g)).toHaveLength(3)
    expect(markup).toContain('<dl class="guidance-fields">')
    expect(markup).not.toContain('Run analysis')
  })

  it.each([
    'javascript:alert(1)',
    'https://data.cms.gov/source?api_key=secret',
    'https://127.0.0.1/source',
    'https:/api/contract',
  ])('never emits an unsafe retrieval route even if a caller bypasses the provider boundary: %s', (url) => {
    const unsafe = structuredClone(dataset)
    unsafe.canonicalResult.record.retrieval.instructions[0].url = url
    const guidance = buildResearcherGuidance(unsafe)
    const markup = renderToStaticMarkup(createElement(ResearcherDecisionSummary, { dataset: unsafe }))
    expect(guidance.retrievalRecipe.steps[0].url).toBeNull()
    expect(markup).not.toContain(url)
  })
})
