import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { CURRENT_GENERATION, LandingPage } from './LandingPage'

describe('home mission and tested journeys', () => {
  it('matches the accepted generation and distinguishes finding a source from obtaining restricted data', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(LandingPage)))
    expect(markup).toContain(CURRENT_GENERATION)
    expect(markup).toContain('3434 indexed source identities')
    expect(markup).toContain('Hospital cost-report net patient revenue for Pennsylvania')
    expect(markup).toContain('County uninsured estimates without inventing Census coverage')
    expect(markup).toContain('Find HCUP inpatient stays')
    expect(markup).toContain('Finding the source is not obtaining the research file')
    expect(markup).toContain('Catalog membership is not payload access')
    expect(markup).toContain('href="/learn"')
    expect(markup).not.toContain('href="/plan"')
  })
})
