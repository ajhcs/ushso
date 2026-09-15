import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ComparePage } from './ComparePage'

describe('human comparison page', () => {
  it('shows HCRIS/PHC4 incomparable dimensions without a numeric quality score', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/compare?preset=hcris_phc4'] }, createElement(ComparePage)))
    expect(markup).toContain('same evidence as')
    expect(markup).toContain('compare_assets')
    expect(markup).toContain('does not compile a research plan')
    expect(markup).toContain('data-comparison-state="incomparable"')
    expect(markup).toContain('not a confirmed merge')
    expect(markup).not.toMatch(/overall quality score:\s*[0-9]/i)
    expect(markup).not.toContain('plan_research is enabled')
  })

  it('keeps negotiated rates distinct from patient bills in hospital/payer MRF comparison', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/compare?preset=hospital_payer_mrf'] }, createElement(ComparePage)))
    expect(markup).toContain('Negotiated rate between a hospital and a payer. This is not a patient bill.')
    expect(markup).toContain('Gross, cash, negotiated and allowed-amount remain distinct measures')
    expect(markup).toContain('Price types are not patient bills')
  })
})
