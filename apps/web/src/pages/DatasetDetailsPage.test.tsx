import { describe, expect, it } from 'vitest'
import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import type { ObservatoryRecord } from '../types/discovery'
import { sourceGuidance } from './DatasetDetailsPage'

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

  it('does not inherit guidance from an acronym or title match', () => {
    expect(sourceGuidance(recordWith('obs:unreviewed:nhis-teen', 'NHIS–Teen Restricted Use File'))).toBeNull()
    expect(sourceGuidance(recordWith('obs:unreviewed:nhis-footnotes', 'DQS NHIS Adult Summary Statistics Footnotes'))).toBeNull()
    expect(sourceGuidance(recordWith('obs:unreviewed:nhis-synthetic', 'NCHS Synthetic Linked 2018 NHIS-HUD-CMS Data'))).toBeNull()
    expect(sourceGuidance(recordWith('obs:unreviewed:hcris', 'HCRIS source extract'))).toBeNull()
  })
})
