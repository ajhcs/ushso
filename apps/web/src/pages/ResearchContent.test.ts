import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { AboutPage } from './AboutPage'
import { ContactPage } from './ContactPage'
import { LandingPage } from './LandingPage'

function render(component: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(createElement(MemoryRouter, {}, component))
}

describe('research-facing static content', () => {
  it('does not invent governance, funding, affiliation, or private-contact facts', () => {
    const about = render(createElement(AboutPage))
    const contact = render(createElement(ContactPage))
    expect(about).toContain('Not yet disclosed by the owner')
    expect(about).toContain('Institutional affiliations')
    expect(about).toContain('Funding and conflicts')
    expect(contact).toContain('Status: not yet published')
    expect(contact).toContain('protected health information')
    expect(contact).toContain('https://github.com/ajhcs/ushso/issues/new')
  })

  it('preserves ordinary spaces when responsive line breaks are removed', () => {
    const text = `${render(createElement(LandingPage))}${render(createElement(ObservatoryFooter))}`.replace(/<[^>]+>/g, '')
    expect(text).toContain('contains, and')
    expect(text).toContain('access the')
  })
})
