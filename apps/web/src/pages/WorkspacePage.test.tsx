import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { addShortlistItem, createMemoryShortlistStorage, rememberLastSeenGeneration, setShortlistStorage } from '../lib/shortlist'
import { WorkspacePage } from './WorkspacePage'

const sample = {
  record_id: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17',
  title: 'Hospital Provider Cost Report',
  source_name: 'CMS',
  details_path: '/datasets/obs%3Aasset%3Acms-data-catalog%3Adata.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17',
  generation: 'live-2026-09-03-85b50522b420',
  notes: 'local only',
}

describe('local shortlist workspace', () => {
  it('shows empty state, count, and links back to the exact source context', () => {
    const storage = createMemoryShortlistStorage()
    setShortlistStorage(storage)
    const empty = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(WorkspacePage)))
    expect(empty).toContain('No sources are saved in this browser')
    expect(empty).toContain('0 saved sources')
    expect(empty).toContain('Shortlist success is not scientific suitability')
    addShortlistItem(sample)
    rememberLastSeenGeneration('live-2026-09-10-changed')
    const filled = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(WorkspacePage)))
    expect(filled).toContain('1 saved source')
    expect(filled).toContain('need an explicit generation refresh')
    expect(filled).toContain(sample.title)
    expect(filled).toContain(`href="${sample.details_path}"`)
    expect(filled).toContain('Clear shortlist')
    expect(filled).toContain('Export local copy')
    expect(filled).toContain('Refresh generation')
    expect(filled).toContain('Never sent to enrichment or telemetry')
    expect(filled).toContain('does not compile a research plan')
    expect(filled).toContain('Compare documented examples')
    setShortlistStorage(null)
  })

  it('keeps App workspace routing and worker SPA_ROUTES aligned without promoting plan_research', async () => {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
    const app = await readFile(`${repositoryRoot}apps/web/src/App.tsx`, 'utf8')
    const worker = await readFile(`${repositoryRoot}worker/index.mjs`, 'utf8')
    const footer = await readFile(`${repositoryRoot}apps/web/src/components/ObservatoryFooter.tsx`, 'utf8')
    const header = await readFile(`${repositoryRoot}apps/web/src/components/ObservatoryHeader.tsx`, 'utf8')
    expect(app).toContain('path="/workspace"')
    expect(app).toContain('path="/compare"')
    expect(app).toContain('WorkspacePage')
    expect(app).toContain('ComparePage')
    expect(worker).toContain("'/workspace'")
    expect(worker).toContain("'/compare'")
    expect(worker).not.toContain('packages/enrichment')
    expect(footer).toContain('to="/workspace"')
    expect(footer).toContain('to="/compare"')
    expect(header).not.toContain("to: '/workspace'")
    expect(header).not.toContain("to: '/compare'")
    expect(header).not.toContain("to: '/plan'")
  })
})
