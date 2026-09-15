import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { PUBLIC_CONTACT, SHORTLIST_KEY, UNSUPPLIED } from '../content/learn/accountability'
import { StandardPage } from './StandardPage'

describe('privacy and terms policy copy', () => {
  it('describes implemented shortlist and correction behavior without guessed response times', () => {
    const privacy = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(StandardPage, { title: 'Privacy', copy: 'No account is required. USHSO does not intentionally persist search questions or personal information. Cloudflare may process connection metadata to serve the site. Do not submit personal health information.' })))
    expect(privacy).toContain(SHORTLIST_KEY)
    expect(privacy).toContain(PUBLIC_CONTACT)
    expect(privacy).toContain('does not automatically attach the originating research question')
    expect(privacy).toContain(UNSUPPLIED.response_time)
    const terms = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(StandardPage, { title: 'Terms', copy: 'Discovery metadata is provided as-is and does not replace validation at the authoritative source. Source-specific licenses, fees, applications, data-use agreements, and restrictions continue to apply.' })))
    expect(terms).toContain('Source-specific rights remain with the publisher')
    expect(terms).toContain('not a completed research task')
  })
})
