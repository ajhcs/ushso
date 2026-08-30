import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import { adaptDiscoveryResponse } from '../lib/catalogAdapter'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import { ResultCard } from './ResultCard'

const acceptedResponse = await loadAcceptedDiscoveryFixture()
assertDiscoveryResult(acceptedResponse)

describe('result verification presentation', () => {
  it('shows live verification date and first-party evidence without internal match rationale', () => {
    const result = adaptDiscoveryResponse(acceptedResponse).records[0]
    const markup = renderToStaticMarkup(createElement(
      MemoryRouter,
      {},
      createElement(ResultCard, { result, displayRank: 1 }),
    ))

    expect(markup).toContain('Live verified')
    expect(markup).toContain('Evidence source')
    expect(markup).toContain(`dateTime="${result.verification.metadataObservedAt}"`)
    expect(markup).toContain('What the fields tell you:')
    expect(markup).not.toContain('Why it matched')
    expect(markup).not.toContain(result.canonicalResult.relevance.why_relevant[0] ?? '__missing__')
  })
})
