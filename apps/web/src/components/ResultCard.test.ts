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

describe('result card six-region presentation contract', () => {
  it('shows exactly the six required scanning regions while keeping rich evidence one click down', () => {
    const result = adaptDiscoveryResponse(acceptedResponse).records[0]
    const markup = renderToStaticMarkup(createElement(
      MemoryRouter,
      {},
      createElement(ResultCard, { result, displayRank: 1 }),
    ))

    expect(markup.match(/data-result-region=/g)).toHaveLength(6)
    expect(markup).toContain(`aria-label="Result 1: ${result.title}"`)
    expect(markup).toContain('data-result-region="title"')
    expect(markup).toContain('data-result-region="description"')
    expect(markup).toContain('data-result-region="why-match"')
    expect(markup).toContain('data-result-region="geo-grain-time"')
    expect(markup).toContain('data-result-region="access-evidence"')
    expect(markup).toContain('data-result-region="details-action"')
    expect(markup).toContain('<aside class="result-card__summary" aria-label="Verification and access status">')
    expect(markup).toContain('<dl class="result-card__coverage" data-result-region="geo-grain-time">')
    expect(markup).toContain('Scoped metadata route checked')
    expect(markup).toContain('Access')
    expect(markup).toContain('Geography')
    expect(markup).toContain('Grain')
    expect(markup).toContain('Time')
    expect(markup).toContain('View evidence and access')
    expect(markup).not.toContain('Evidence source')
    expect(markup).not.toContain('What the fields tell you:')
    expect(markup).not.toContain('Relationship:')
    expect(markup).not.toContain('Relevance:')
    expect(markup).not.toContain('Variables documented')
    expect(markup).toContain('Why it matched')
    expect(markup).toContain(result.canonicalResult.relevance.why_relevant[0] ?? 'No evidence-backed match explanation is available.')
    expect(markup).not.toContain('Live verified')
  })
})
