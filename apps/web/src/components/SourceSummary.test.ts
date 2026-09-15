import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import { adaptDiscoveryResponse } from '../lib/catalogAdapter'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import { SourceSummary, nextSourceAction } from './SourceSummary'

const acceptedResponse = await loadAcceptedDiscoveryFixture()
assertDiscoveryResult(acceptedResponse)

describe('source summary next action', () => {
  it('gives every adapted record a next action without hard-coding HCRIS', () => {
    const records = adaptDiscoveryResponse(acceptedResponse).records
    expect(records.length).toBeGreaterThan(1)
    for (const result of records) {
      const action = nextSourceAction(result)
      expect(action.label.length).toBeGreaterThan(20)
      const markup = renderToStaticMarkup(createElement(SourceSummary, { dataset: result }))
      expect(markup).toContain('Clear source action')
      expect(markup).toContain('not proven payload or browser access')
      expect(markup).not.toContain('CMS Hospital Provider Cost Report landing page')
    }
  })
})
