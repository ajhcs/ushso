import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { CURRENT_GENERATION, LearnPage } from './LearnPage'

describe('learn destinations', () => {
  it('maps every destination to a real question and keeps disabled planner off the primary path', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/learn'] }, createElement(LearnPage)))
    expect(markup).toContain(CURRENT_GENERATION)
    expect(markup).toContain('Finding a source is not obtaining the data')
    expect(markup).toContain('href="/search"')
    expect(markup).toContain('href="/sources"')
    expect(markup).toContain('href="/about"')
    expect(markup).toContain('href="/agents"')
    expect(markup).toContain('plan_research stays disabled')
    expect(markup).not.toContain('href="/plan"')
    const app = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/learn'] }, createElement(App)))
    expect(app).toContain('Choose a starting route')
  })
})
