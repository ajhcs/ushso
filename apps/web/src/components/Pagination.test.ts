import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Pagination } from './Pagination'

describe('compact pagination', () => {
  it('renders bounded previous/next controls and a current-page summary', () => {
    const markup = renderToStaticMarkup(createElement(Pagination, { currentPage: 12, pageCount: 87, onChange: vi.fn() }))
    expect(markup).toContain('Go to previous results page')
    expect(markup).toContain('Page 12 of 87')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('Go to next results page')
    expect(markup).not.toContain('Go to results page 87')
  })

  it('disables only the unavailable direction at the ends', () => {
    const first = renderToStaticMarkup(createElement(Pagination, { currentPage: 1, pageCount: 3, onChange: vi.fn() }))
    const last = renderToStaticMarkup(createElement(Pagination, { currentPage: 3, pageCount: 3, onChange: vi.fn() }))
    expect(first).toMatch(/aria-label="Go to previous results page" disabled/)
    expect(last).toMatch(/aria-label="Go to next results page" disabled/)
  })
})
