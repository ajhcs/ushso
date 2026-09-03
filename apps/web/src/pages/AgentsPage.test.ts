import { describe, expect, it } from 'vitest'
import responseFixtureJson from '../../../../packages/retrieval/fixtures/responses/q-hospital-ownership.json'
import generatedExample from '../data/generatedAgentsResponseExample.json'
import type { DiscoveryResult } from '../types/discovery'

describe('agents response example', () => {
  it('projects structured geography objects from an accepted response fixture', () => {
    const fixture = responseFixtureJson as unknown as DiscoveryResult
    const expected = {
      contract_version: fixture.contract_version,
      query: { interpretation: { geographies: fixture.query.interpretation.geographies } },
      result_count: fixture.result_count,
      results: fixture.results.slice(0, 1).map((result) => ({
        record_id: result.record_id,
        record: { authoritative_url: result.record.authoritative_url },
      })),
      warnings: fixture.warnings.slice(0, 1),
    }

    expect(generatedExample).toEqual(expected)
    expect(generatedExample.query.interpretation.geographies[0]).toMatchObject({
      id: 'US-PA',
      kind: 'geography',
      evidence: 'controlled_vocabulary',
    })
    expect(generatedExample.results[0]).toEqual({
      record_id: fixture.results[0].record_id,
      record: { authoritative_url: fixture.results[0].record.authoritative_url },
    })
  })
})
