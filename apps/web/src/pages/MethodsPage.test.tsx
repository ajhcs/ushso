import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { CURRENT_EVAL_CLAIMS, CURRENT_EVAL_METHODS, CURRENT_EVAL_RESULT, FAILING_DOMAINS, METHODS_GENERATION } from '../content/learn/methods'
import { MethodsPage } from './MethodsPage'
import { LearnPage } from './LearnPage'

describe('advanced methods guides', () => {
  it('keeps maternal/infant and fiscal/calendar as concrete distinctions', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/methods'] }, createElement(MethodsPage)))
    expect(markup).toContain('id="source-assessment"')
    expect(markup).toContain('CDC NVSS maternal mortality counts deaths associated with pregnancy')
    expect(markup).toContain('CDC infant mortality counts deaths of live-born infants')
    expect(markup).toContain('not interchangeable')
    expect(markup).toContain('provider cost-reporting fiscal period')
    expect(markup).toContain('not that CMS fiscal period')
    expect(markup).toContain('Fiscal year and calendar year are not equivalent')
    expect(markup).not.toContain('all mortality measures are similar')
    expect(markup).not.toContain('time periods may vary')
  })

  it('does not recommend CCN=NPI, name-only merging, or inferred payments', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/methods'] }, createElement(MethodsPage)))
    expect(markup).toContain('id="joins-and-mrf"')
    expect(markup).toContain('CCN identifies a Medicare-certified hospital')
    expect(markup).toContain('NPI identifies a provider enumeration')
    expect(markup).toContain('Equal numeric reference IDs in different files cannot join')
    expect(markup).toContain('No automatic name-based merge is available')
    expect(markup).toContain('Negotiated rates are not observed payments')
    expect(markup).toContain('None of these is a patient bill')
    expect(markup).not.toContain('use CCN as NPI')
    expect(markup).not.toContain('merge by hospital name')
    expect(markup).not.toContain('infer what patients paid from negotiated rates')
  })

  it('names exact current evaluation artifacts, receipts, and failure scope', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/methods'] }, createElement(MethodsPage)))
    expect(markup).toContain(METHODS_GENERATION)
    expect(markup).toContain(CURRENT_EVAL_RESULT)
    expect(markup).toContain(CURRENT_EVAL_METHODS)
    expect(markup).toContain('ushso.retrieval-eval.v1')
    expect(markup).toContain('3434')
    expect(markup).toContain('143-record')
    expect(markup).toContain('must not be read as evidence of the current catalog')
    for (const claim of Object.values(CURRENT_EVAL_CLAIMS)) {
      expect(markup).toContain(claim.value)
      expect(markup).toContain(claim.receipt)
    }
    for (const row of FAILING_DOMAINS) {
      expect(markup).toContain(row.domain)
      expect(markup).toContain(row.remediation)
    }
    expect(markup).toContain('R07 remains incomplete')
  })

  it('does not obstruct beginner workflows on Learn', () => {
    const learn = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/learn'] }, createElement(LearnPage)))
    expect(learn).toContain('Finding a source is not obtaining the data')
    expect(learn).toContain('id="what-ushso-does"')
    expect(learn).toContain('id="first-search"')
    expect(learn).toContain('id="developer-quick-start"')
    expect(learn).not.toContain('href="/plan"')
    expect(learn).not.toContain('infer observed payments')
  })
})
