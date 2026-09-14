import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))

describe('browse, discover, and plan mode separation', () => {
  it('keeps browse/search providers free of planner endpoints and generation calls', async () => {
    const paths = [
      'apps/web/src/pages/SearchResultsPage.tsx',
      'apps/web/src/pages/LandingPage.tsx',
      'apps/web/src/providers/DiscoveryProviderContext.tsx',
      'apps/web/src/providers/discoveryProvider.ts',
    ]
    for (const path of paths) {
      const source = await readFile(`${repositoryRoot}${path}`, 'utf8')
      expect(source, path).not.toMatch(/\/api\/plan|requestPlan|planResearch|plan_research|planApiAdapter/)
    }
  })

  it('keeps the planner adapter isolated from browse/discover route modules', async () => {
    const app = await readFile(`${repositoryRoot}apps/web/src/App.tsx`, 'utf8')
    const planPage = await readFile(`${repositoryRoot}apps/web/src/pages/PlanPage.tsx`, 'utf8')
    expect(app).toContain('<Route path="/plan" element={<PlanPage />} />')
    expect(planPage).not.toContain('useDiscoveryResult')
    expect(planPage).not.toContain('useDiscoveryProvider')
  })
})
