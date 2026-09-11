import { describe, expect, it } from 'vitest'
import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import { adaptDiscoveryResponse } from '../lib/catalogAdapter'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import { sourceGroupsFromResponse } from './SourcesPage'

describe('source inventory facet presentation', () => {
  it('uses the captured source name while retaining the canonical source ID and count', async () => {
    const response = await loadAcceptedDiscoveryFixture()
    assertDiscoveryResult(response)
    const catalog = adaptDiscoveryResponse(response)
    const record = catalog.records[0]
    const sourceId = record.canonicalResult.record.identity.source.source_id
    const sourceResponse = structuredClone(response)
    sourceResponse.facets = {
      count_basis: 'records',
      collection_scope: 'all_matching_records_before_pagination',
      approximate: false,
      sections: [{
        id: 'source',
        label: 'Source',
        options: [{ value: sourceId, label: record.canonicalResult.record.identity.source.name, count: 7 }],
      }],
    }

    const groups = sourceGroupsFromResponse(sourceResponse, [record])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      id: sourceId,
      label: record.canonicalResult.record.identity.source.name,
      count: 7,
    })
    expect(groups[0].examples.map((item) => item.id)).toEqual([record.id])
  })

  it('does not re-resolve a raw complete-response label from a conflicting page record', async () => {
    const response = await loadAcceptedDiscoveryFixture()
    assertDiscoveryResult(response)
    const catalog = adaptDiscoveryResponse(response)
    const record = structuredClone(catalog.records[0])
    record.canonicalResult.record.identity.source.name = 'Conflicting current-page source label'
    const sourceId = record.canonicalResult.record.identity.source.source_id
    const sourceResponse = structuredClone(response)
    sourceResponse.facets = {
      count_basis: 'records',
      collection_scope: 'all_matching_records_before_pagination',
      approximate: false,
      sections: [{
        id: 'source',
        label: 'Source',
        options: [{ value: sourceId, label: sourceId, count: 7 }],
      }],
    }

    const groups = sourceGroupsFromResponse(sourceResponse, [record])
    expect(groups[0]).toMatchObject({ id: sourceId, label: 'Cms hcris', count: 7 })
    expect(groups[0].label).not.toBe('Conflicting current-page source label')
  })
})
