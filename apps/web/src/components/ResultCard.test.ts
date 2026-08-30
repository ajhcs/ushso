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

describe('result card presentation', () => {
  const result = adaptDiscoveryResponse(acceptedResponse).records[0]
  const markup = renderToStaticMarkup(createElement(
    MemoryRouter,
    {},
    createElement(ResultCard, { result }),
  ))

  it('keeps the default card to title, categories, geography, grain, time, status, and one action', () => {
    expect(markup).toContain(result.title)
    expect(markup).toContain(result.description)
    expect(markup).toContain(result.geographicApplicability)
    expect(markup).toContain(result.grain)
    expect(markup).toContain(result.availableYears)
    expect(markup).toContain(result.accessStatusLabel)
    expect(markup).toContain('View details')
    expect(markup).toContain(result.detailsUrl)
    result.categories.slice(0, 3).forEach((category) => expect(markup).toContain(category))
  })

  it('moves rank, family, relevance, field summary, and access routes off the default card', () => {
    expect(markup).not.toContain('result-card__rank')
    expect(markup).not.toContain(result.familyStatus)
    expect(markup).not.toContain(result.relationship)
    expect(markup).not.toContain('What the fields tell you:')
    expect(markup).not.toContain('Evidence source')
    expect(markup).not.toContain('Why it matched')
    expect(markup).not.toContain(result.canonicalResult.relevance.why_relevant[0] ?? '__missing__')
    expect(markup).not.toContain('Record type')
    expect(markup).not.toContain('Variables documented')
    expect(markup).not.toContain('Access and requirements')
  })

  it('shows live verification as a status, not the evidence dossier', () => {
    expect(markup).toContain('Live verified')
    expect(markup).not.toContain(`dateTime="${result.verification.metadataObservedAt}"`)
  })
})
