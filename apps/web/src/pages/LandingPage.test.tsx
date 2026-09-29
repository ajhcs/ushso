import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { CURRENT_GENERATION, LandingPage } from './LandingPage'
import { findPriorityResearchQuestion } from '../data/researchNavigator'

describe('home mission and tested journeys', () => {
  it('matches the accepted generation and distinguishes finding a source from obtaining restricted data', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(LandingPage)))
    expect(markup).toContain(CURRENT_GENERATION)
    expect(markup).toContain('3434 indexed source identities')
    expect(markup).toContain('Hospital cost-report net patient revenue for Pennsylvania')
    expect(markup).toContain('County uninsured estimates with verified Census coverage')
    expect(markup).toContain('Census SAHIE county health-insurance estimates')
    expect(markup).toContain('href="/search?q=county%20uninsured%20SAHIE"')
    expect(markup).toContain('Find HCUP inpatient stays')
    expect(markup).toContain('Finding the source is not obtaining the research file')
    expect(markup).toContain('Catalog membership is not payload access')
    expect(markup).toContain('href="/learn"')
    expect(markup).toContain('href="/learn#first-search"')
    expect(markup).toContain('Learn the difference')
    expect(markup).toContain('start with a verified HCRIS search')
    expect(markup).not.toContain('href="/plan"')
  })
  it('routes each search journey href to its named navigator brief (F-05)', () => {
    expect(findPriorityResearchQuestion('CMS HCRIS hospital cost reports')?.id).toBe('hospital-finance-hcris')
    expect(findPriorityResearchQuestion('county uninsured SAHIE')?.id).toBe('county-uninsured')
  })
})
