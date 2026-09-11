import { describe, expect, it } from 'vitest'
import generatedExample from '../data/generatedAgentsResponseExample.json'

describe('agents response example', () => {
  it('is generated from the production v1.2 corpus and preserves the reviewed leading record', () => {
    expect(generatedExample.corpus).toMatchObject({
      corpus_version: '1.2.0',
      record_count: 3434,
      generation: 'live-2026-09-03-85b50522b420',
    })
    expect(generatedExample.query.question).toBe('CMS HCRIS hospital cost reports by state')
    expect(generatedExample.results[0]).toMatchObject({
      rank: 1,
      record_id: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17',
      match_state: 'contextual',
      record: {
        title: 'Hospital Provider Cost Report',
        authoritative_url: 'https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report',
      },
    })
    expect(generatedExample.ranking.ordered_ids[0]).toBe(generatedExample.results[0].record_id)
  })
})
