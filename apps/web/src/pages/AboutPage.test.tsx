import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { OPERATOR, PUBLIC_CONTACT, UNSUPPLIED } from '../content/learn/accountability'
import { AboutPage } from './AboutPage'

describe('about accountability', () => {
  it('explains user benefit without inventing affiliations, staff, funding or outcomes', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/about'] }, createElement(AboutPage)))
    expect(markup).toContain('Find published health-systems sources and see how to reach them')
    expect(markup).toContain('researchers, analysts, journalists, and developers')
    expect(markup).toContain(OPERATOR)
    expect(markup).toContain('does not imply affiliation with or endorsement by the United States government')
    expect(markup).toContain('CMS Hospital Provider Cost Report')
    expect(markup).toContain(UNSUPPLIED.funding)
    expect(markup).toContain(UNSUPPLIED.staff)
    expect(markup).toContain(UNSUPPLIED.named_editorial_roles)
    expect(markup).toContain(UNSUPPLIED.outcomes)
    expect(markup).not.toContain('National Institutes of Health affiliate')
    expect(markup).not.toContain('chief scientist')
    expect(markup).not.toContain('grant number')
    expect(markup).not.toContain('scientifically approved')
  })

  it('keeps info@ushso.org as the verified public contact', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/about'] }, createElement(AboutPage)))
    expect(markup).toContain(PUBLIC_CONTACT)
    expect(markup).toContain('mailto:info@ushso.org')
    expect(markup).not.toContain('forwarding@')
    expect(markup).not.toContain('within 24 hours')
  })
})
