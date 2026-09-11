import { describe, expect, it } from 'vitest'
import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import { adaptDiscoveryResponse } from '../lib/catalogAdapter'
import { buildResearcherGuidance } from '../lib/researcherGuidance'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import type { ObservatoryRecord } from '../types/discovery'
import { freshnessPresentation, sourceGuidance } from './DatasetDetailsPage'

const acceptedResponse = await loadAcceptedDiscoveryFixture()
assertDiscoveryResult(acceptedResponse)
const template = acceptedResponse.results[0].record

function recordWith(recordId: string, title: string): ObservatoryRecord {
  const record = structuredClone(template)
  record.record_id = recordId
  record.title = title
  return record
}

describe('identity-bound research-use guidance', () => {
  it('returns guidance only for the reviewed CMS and NHIS production identities', () => {
    expect(sourceGuidance(recordWith('obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17', 'Hospital Provider Cost Report'))?.heading).toContain('CMS Hospital Provider Cost Report')
    expect(sourceGuidance(recordWith('obs:asset:cdc-socrata:25m4-6qqq-0c32f3a6fa05807f', 'NHIS Adult Summary Health Statistics'))?.heading).toBe('NHIS decision notes')
  })

  it('explains catalog-metadata freshness without treating it as payload access', () => {
    const dataset = adaptDiscoveryResponse(acceptedResponse).records[0]
    const freshness = freshnessPresentation(dataset)
    expect(freshness.payloadNote).toMatch(/not a payload-access check/)
    expect(freshness.lastSuccessful).toBe(dataset.verification.metadataObservedAt)
    expect(freshness.overdue).toBe(false)
  })

  it('keeps card, detail, and machine grain unresolved for the audited HCRIS-style fixture', () => {
    const dataset = adaptDiscoveryResponse(acceptedResponse).records[0]
    const typical = buildResearcherGuidance(dataset).useCard.fields.find((field) => field.label === 'Typical unit')
    const inferred = buildResearcherGuidance(dataset).useCard.fields.find((field) => field.label === 'Inferred unit tags (search aid only)')
    expect(dataset.canonicalResult.metadata?.dimensions.observation_grain?.state ?? 'unresolved').toBe('unresolved')
    expect(dataset.grain).toBe('Observation grain unresolved')
    expect(typical?.evidenceState).toBe('unresolved')
    expect(typical?.values).toEqual(['Observation grain is unresolved.'])
    expect(inferred?.evidenceState).toBe('inferred')
    expect(dataset.canonicalResult.record.unit_of_analysis.length).toBeGreaterThan(0)
  })

  it('does not inherit guidance from an acronym or title match', () => {
    expect(sourceGuidance(recordWith('obs:unreviewed:nhis-teen', 'NHIS–Teen Restricted Use File'))).toBeNull()
    expect(sourceGuidance(recordWith('obs:unreviewed:nhis-footnotes', 'DQS NHIS Adult Summary Statistics Footnotes'))).toBeNull()
    expect(sourceGuidance(recordWith('obs:unreviewed:nhis-synthetic', 'NCHS Synthetic Linked 2018 NHIS-HUD-CMS Data'))).toBeNull()
    expect(sourceGuidance(recordWith('obs:unreviewed:hcris', 'HCRIS source extract'))).toBeNull()
  })
})
