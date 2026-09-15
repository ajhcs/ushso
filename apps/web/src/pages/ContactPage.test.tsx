import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { PUBLIC_CONTACT, SHORTLIST_KEY, UNSUPPLIED } from '../content/learn/accountability'
import { ContactPage } from './ContactPage'

describe('contact and corrections', () => {
  it('does not expose private forwarding or attach sensitive user content automatically', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/contact'] }, createElement(ContactPage)))
    expect(markup).toContain(PUBLIC_CONTACT)
    expect(markup).toContain(`mailto:${PUBLIC_CONTACT}`)
    expect(markup).toContain('The originating research question is intentionally excluded')
    expect(markup).toContain('Protected health information is not attached automatically')
    expect(markup).toContain(UNSUPPLIED.response_time)
    expect(markup).toContain('proposed for owner review')
    expect(markup).toContain(SHORTLIST_KEY)
    expect(markup).not.toContain('forwarding@')
    expect(markup).not.toContain('within 2 business days')
    expect(markup).not.toContain('we will reply in')
  })
})
