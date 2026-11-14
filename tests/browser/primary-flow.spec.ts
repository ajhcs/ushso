import { test, expect, type Page } from '@playwright/test'

const runtimeErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ context, page }) => {
  // No publisher, analytics, font, or other external requests are permitted.
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? route.continue() : route.abort('blockedbyclient')
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    // The disabled publication route intentionally returns 503; assert its typed
    // response and visible boundary below, while retaining all other errors.
    const expectedUnavailable = message.location().url.endsWith('/api/source-selection/v1/publication') && message.text().includes('503')
    if (message.type() === 'error' && !expectedUnavailable) errors.push(message.text())
  })
  // Fail at teardown on runtime errors as well as on visible assertions.
  runtimeErrors.set(page, errors)
})

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page), 'Browser console and uncaught runtime errors').toEqual([])
})

test('researcher can search, refine, read source evidence, and return to the same results', async ({ page }, info) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Health data source discovery/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Find and assess')
  const query = page.getByRole('combobox')
  await query.fill('hospital')
  await query.press('Enter')
  await expect(page).toHaveURL(/\/search\?q=hospital/)
  await expect(page.getByRole('heading', { name: 'Results in selected order' })).toBeVisible()
  const narrow = info.project.name === 'narrow'
  if (narrow) await page.getByRole('button', { name: /^Refine results/ }).click()
  const facets = narrow ? page.getByRole('dialog', { name: 'Refine results' }) : page.locator('.desktop-facets')
  const filter = facets.locator('input[type=checkbox]:enabled').first()
  await expect(filter).toBeVisible()
  await filter.focus()
  await page.keyboard.press('Space')
  await expect(filter).toBeChecked()
  if (narrow) {
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  await expect(page.getByRole('heading', { name: 'Results in selected order' })).toBeVisible()
  await expect(page.locator('.result-card').first().getByText('Documented match', { exact: true })).toHaveCount(0)
  const resultsUrl = page.url()
  const detailLink = page.getByRole('link', { name: 'View evidence and access', exact: true }).first()
  await expect(detailLink).toBeVisible()
  await detailLink.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Evidence dossier', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Access and requirements' })).toBeVisible()
  await page.getByRole('link', { name: 'Return to these search results' }).click()
  expect(page.url().split('#')[0]).toBe(resultsUrl)
  await expect(page.getByRole('heading', { name: 'Results in selected order' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('search-return.png'), fullPage: false })
})

test('shortlist preserves the unavailable publication boundary without accepted facts', async ({ page }) => {
  const response = await page.request.get('/api/source-selection/v1/publication')
  await page.goto('/shortlist')
  expect(response.status()).toBe(503)
  expect(await response.json()).toMatchObject({ status: 'unavailable' })
  await expect(page.getByRole('heading', { name: 'Source shortlist', exact: true })).toBeVisible()
  await expect(page.getByText('No sources shortlisted.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Add .*shortlist|Add to shortlist/i })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: /Memory only/i })).toBeVisible()
  await expect(page.getByText('Accepted source selection is unavailable for this publication. Catalog records cannot substitute for accepted snapshots.')).toBeVisible()
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => /shortlist/i.test(key)))).toEqual([])
})


test('controlled discovery replaces inferred constraints, preserves the question, and reports coverage exclusions', async ({ page }) => {
  const original = 'hospital finances Pennsylvania 2020'
  const inputs: { query: { question: string; cursor?: string }; intent_override: unknown; coverage_mode: string }[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/discovery-controls/v1/search' && request.method() === 'POST') inputs.push(request.postDataJSON())
  })
  await page.goto(`/search?q=${encodeURIComponent(original)}`)
  const editor = page.locator('details.interpretation-editor')
  const openEditor = async () => { if ((await editor.getAttribute('open')) === null) await editor.locator('summary').click() }
  const apply = async () => {
    const before = inputs.length
    await page.getByRole('button', { name: 'Apply constraints and restart results' }).click()
    await expect.poll(() => inputs.length).toBeGreaterThan(before)
    await expect(page.locator('.results-list')).toHaveAttribute('aria-busy', 'false')
    expect(inputs.at(-1)!.query.question).toBe(original)
    await expect(page.getByRole('textbox', { name: 'Search question', exact: true })).toHaveValue(original)
    return inputs.at(-1)!
  }
  await expect(editor).toBeVisible()
  await openEditor()
  await page.getByRole('combobox', { name: 'Required subject', exact: true }).selectOption('quality')
  await page.getByRole('combobox', { name: 'Required geography', exact: true }).selectOption('US-NY')
  await page.getByLabel('Observation start year', { exact: true }).fill('2021')
  await page.getByLabel('Observation end year', { exact: true }).fill('2022')
  let input = await apply()
  expect(input.intent_override).toEqual({ subjects: ['quality'], geographies: ['US-NY'], observation_years: { start: 2021, end: 2022 } })
  await openEditor()
  await page.getByRole('combobox', { name: 'Required subject', exact: true }).selectOption('')
  await page.getByRole('combobox', { name: 'Required geography', exact: true }).selectOption('')
  await page.getByLabel('Observation start year', { exact: true }).fill('')
  await page.getByLabel('Observation end year', { exact: true }).fill('')
  await page.getByRole('combobox', { name: 'Coverage evidence', exact: true }).selectOption('all')
  input = await apply()
  expect(input.intent_override).toEqual({ subjects: [], geographies: [], observation_years: null })
  const status = page.getByRole('status').filter({ hasText: 'Coverage filter:' })
  await expect(status).toContainText(/Coverage filter: [1-9][0-9]* included/)
  await page.getByRole('button', { name: 'Go to next results page' }).click()
  await expect(page).toHaveURL(/cursor=/)
  await expect(page.locator('.results-list')).toHaveAttribute('aria-busy', 'false')
  await openEditor()
  await page.getByRole('combobox', { name: 'Coverage evidence', exact: true }).selectOption('verified_only')
  input = await apply()
  expect(input.coverage_mode).toBe('verified_only')
  expect(input.query.cursor).toBeUndefined()
  const url = new URL(page.url())
  expect(url.searchParams.has('cursor')).toBe(false)
  expect(url.searchParams.has('generation')).toBe(false)
  expect(url.searchParams.get('page') ?? '1').toBe('1')
  await expect(status).toContainText(/Coverage filter: 0 included of [1-9][0-9]* matching records before pagination; [1-9][0-9]* excluded/)
  await expect(status).toContainText('Verified: 0;')
  await expect(page.getByText('This is not evidence that no source exists. Try broader terms or remove a constraint.')).toBeVisible()
  await openEditor()
  await page.getByRole('combobox', { name: 'Coverage evidence', exact: true }).selectOption('unresolved_only')
  input = await apply()
  expect(input.coverage_mode).toBe('unresolved_only')
  await expect(status).toContainText(/Coverage filter: [1-9][0-9]* included/)
  await expect(page.getByRole('heading', { name: 'Results in selected order' })).toBeVisible()
  await openEditor()
  await page.getByRole('combobox', { name: 'Coverage evidence', exact: true }).selectOption('all')
  await apply()
  await expect(status).toContainText(/Coverage filter: [1-9][0-9]* included/)
  await openEditor()
  await page.getByRole('button', { name: 'Restore automatic interpretation' }).click()
  await expect(page.locator('.results-list')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('textbox', { name: 'Search question', exact: true })).toHaveValue(original)
  expect(new URL(page.url()).searchParams.has('controls')).toBe(false)
})

test('320px reflow/text resize keeps the real search page and controls within the viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/search?q=hospital')
  await expect(page.getByRole('heading', { name: 'Results in selected order' })).toBeVisible()
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
  await page.locator('details.interpretation-editor > summary').click()
  await expect(page.getByRole('combobox', { name: 'Required subject', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Coverage evidence', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }))).toEqual({ width: 320, viewport: 320 })
  await page.screenshot({ path: info.outputPath('320px-reflow-text-resize.png'), fullPage: false })
})
