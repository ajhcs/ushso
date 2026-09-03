import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AgentsPage } from '../pages/AgentsPage'
import { loadAcceptedDiscoveryFixture } from './acceptedDiscoveryFixture'
import agentsExampleSource from './agents-discovery-example.json'
import { compactDiscoveryExample } from './agentsDiscoveryExample'
import { assertDiscoveryResult } from '../providers/discoveryProvider'

const acceptedResponse = await loadAcceptedDiscoveryFixture()
assertDiscoveryResult(acceptedResponse)

describe('Agents page contract example', () => {
  it('is generated from the accepted discovery fixture rather than a hand-written geography array', () => {
    const generated = compactDiscoveryExample(acceptedResponse)

    expect(agentsExampleSource.question).toBe(acceptedResponse.query.question)
    expect(agentsExampleSource.example).toEqual(generated)
    expect(generated.query.interpretation.geographies[0]).toMatchObject({
      id: 'US-PA',
      label: 'Pennsylvania',
      kind: 'geography',
      evidence: 'controlled_vocabulary',
    })
    expect(typeof generated.query.interpretation.geographies[0]).toBe('object')
  })

  it('renders structured geography objects instead of postal-code strings', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(AgentsPage)))
    expect(markup).toContain('&quot;id&quot;: &quot;US-PA&quot;')
    expect(markup).toContain('&quot;kind&quot;: &quot;geography&quot;')
    expect(markup).not.toContain('[&quot;US-TX&quot;]')
    expect(markup).not.toContain('&quot;geographies&quot;: [&quot;US-PA&quot;]')
    expect(markup).toContain('hospital financial and utilization data for Pennsylvania')
    expect(markup).toContain('registers 8 read-only inspection tools')
    expect(markup).toContain('observatory.search_assets')
    expect(markup).toContain('POST /api/machine/v1/search-assets')
    expect(markup).toContain('observatory.plan_research')
  })
})
