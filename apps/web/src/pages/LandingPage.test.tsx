import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import { LandingPage } from './LandingPage'
import publicRegression from '../../../../evaluation/source-selection/queries.public.json'

it('offers visible task examples before typing, linked to exact public regression questions', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, {initialEntries:['/']}, createElement(LandingPage)))
  const section = html.match(/<section aria-labelledby="task-examples-heading">([\s\S]*?)<\/section>/)?.[1]
  expect(section).toBeDefined()
  for (const id of ['pa-finance', 'county-life', 'medicaid']) {
    const query = publicRegression.queries.find(item => item.query_id === id)!
    expect(section).toContain(`href="/search?${new URLSearchParams({q:query.text}).toString()}"`)
    expect(section).toContain(query.text)
  }
  expect(section).toContain('coverage, access requirements and limitations')
  expect(section).not.toMatch(/validated recommendation|proven source|guaranteed/i)
})
