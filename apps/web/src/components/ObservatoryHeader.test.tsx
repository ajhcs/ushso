import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ObservatoryHeader, PRIMARY_NAVIGATION } from './ObservatoryHeader'

describe('primary navigation information architecture', () => {
  it('resolves Explore, Learn, Coverage, About and Developers without promoting disabled planner', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ObservatoryHeader)))
    for (const item of PRIMARY_NAVIGATION) {
      expect(markup).toContain(`href="${item.to}"`)
      expect(markup).toContain(`aria-label="${item.name}"`)
      expect(markup).toContain(`>${item.label}<`)
    }
    expect(markup).not.toContain('href="/plan"')
    expect(markup).not.toMatch(/plan_research is enabled|Compile a research plan/i)
  })

  it('keeps 320px and 390px menus usable with descriptive accessible names', async () => {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
    const css = await readFile(`${repositoryRoot}apps/web/src/styles.css`, 'utf8')
    expect(css).toMatch(/@media \(max-width: 320px\)[\s\S]*\.primary-nav a \{ min-height: 44px/)
    expect(css).toMatch(/@media \(max-width: 390px\)[\s\S]*\.primary-nav a \{ min-height: 44px/)
    const markup = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ObservatoryHeader)))
    for (const item of PRIMARY_NAVIGATION) {
      expect(markup).toContain(`aria-label="${item.name}"`)
      expect(item.name.length).toBeGreaterThan(8)
    }
  })
})
