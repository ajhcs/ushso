import { test, expect, type Page } from '@playwright/test'
import { fixture } from '../source-selection/fixture.mjs'
import { canonical, sha256, createDataManifest, projectLedger } from '../../packages/source-selection/index.mjs'
import { acceptedPublicationPin, compareAccepted } from '../../worker/source-selection-publication.mjs'

// Synthetic transport fixture only. These facts never enter staged production
// assets or the default Worker publication; no real approval is represented.
function syntheticPublication() {
  const ledger = fixture()
  // Clone the shared, explicitly publishable reviewed identity/evidence fixture
  // with distinct IDs; the second source must satisfy the same public contract.
  const second = JSON.parse(JSON.stringify(fixture())
    .replaceAll('Synthetic hospital source', 'Synthetic second source')
    .replaceAll('asset_1', 'asset_2').replaceAll('ev_1', 'ev_2')
    .replaceAll('ast_1', 'ast_2').replaceAll('dec_1', 'dec_2')
    .replaceAll('ast_identity', 'ast_identity_2').replaceAll('dec_identity', 'dec_identity_2'))
  for (const key of ['assets', 'captures', 'decisions', 'assertions'] as const) ledger[key].push(...second[key])
  const ledgerHash = sha256(canonical(ledger))
  const { generation_id, manifest } = createDataManifest({ ledgerRevision: ledgerHash, ledgerHash, evidenceHash: sha256(canonical(ledger.captures)), rightsHash: sha256('synthetic policy'), schemaHashes: { source_selection: sha256('synthetic schema') } })
  return { status: 'available', generation_id, bundle: { data_manifest: manifest, views: projectLedger(ledger, generation_id) } }
}
const storageKey = 'ushso.shortlist.v1'
async function saved(page: Page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), storageKey) }
async function downloadBrief(page: Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export reproducible JSON brief' }).click()
  const stream = await (await pending).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

test('SYNTHETIC accepted projection: shortlist, comparison, consent, export/import, and generation rejection', async ({ page, context }) => {
  const publication = syntheticPublication()
  const pin = acceptedPublicationPin(publication)
  let mismatch = false
  const comparisonRequests: Record<string, unknown>[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return route.abort('blockedbyclient')
    if (url.pathname === '/api/source-selection/v1/publication') return route.fulfill({ json: { ...publication, pin } })
    if (url.pathname === '/api/machine/v2/compare-assets') {
      const input = route.request().postDataJSON()
      comparisonRequests.push(input)
      const result = compareAccepted(publication, input)
      if (mismatch && result.status === 200) result.body.pin = { ...pin, generation_id: 'f'.repeat(64), data_manifest_sha256: 'f'.repeat(64) }
      return route.fulfill({ status: result.status, json: result.body })
    }
    return route.continue()
  })
  await page.goto('/shortlist')
  const chooser = page.getByRole('region', { name: 'Accepted sources' })
  await chooser.getByRole('button', { name: 'Add Synthetic hospital source to shortlist', exact: true }).click()
  await chooser.getByRole('button', { name: 'Add Synthetic second source to shortlist', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Decision', exact: true })).toHaveCount(2)
  expect(await saved(page)).toBeNull()
  await page.getByLabel('Reason or note', { exact: true }).first().fill('private synthetic decision note')
  const question = page.getByLabel('Research question (optional)', { exact: true })
  await question.fill('private synthetic browser research question')
  const storageConsent = page.getByLabel('Also save this question on this device')
  const exportConsent = page.getByLabel('Include the question in this export only')
  await expect(storageConsent).not.toBeChecked()
  await expect(exportConsent).not.toBeChecked()
  const defaultBrief = await downloadBrief(page)
  expect(JSON.parse(defaultBrief.toString()).question).toBeNull()
  expect(defaultBrief.toString()).not.toContain('private synthetic browser research question')
  await exportConsent.check()
  const explicitBrief = await downloadBrief(page)
  expect(JSON.parse(explicitBrief.toString()).question).toBe('private synthetic browser research question')
  await expect(exportConsent).not.toBeChecked()
  await page.getByRole('button', { name: 'Save on this device for 30 days', exact: true }).click()
  let stored = await saved(page)
  expect(stored.question).toBeUndefined()
  expect(Date.parse(stored.expires_at) - Date.parse(stored.storage_consent.granted_at)).toBe(30 * 86400000)
  await storageConsent.check()
  await page.getByRole('button', { name: 'Save on this device for 30 days', exact: true }).click()
  expect((await saved(page)).question).toBe('private synthetic browser research question')
  await page.getByRole('link', { name: 'Compare up to four sources' }).click()
  await expect(page.getByRole('table', { name: 'Accepted source dimensions in one pinned publication' })).toBeVisible()
  await expect(page.getByRole('cell', { name: /PA/ }).first()).toBeVisible()
  expect(comparisonRequests.length).toBeGreaterThan(0)
  for (const input of comparisonRequests) {
    expect(Object.keys(input).sort()).toEqual(['asset_ids', 'contract_version', 'dimensions', 'expected_pin'])
    expect(input.expected_pin).toEqual(pin)
    expect(JSON.stringify(input)).not.toMatch(/private synthetic/)
  }
  await page.getByRole('link', { name: 'Edit shortlist' }).click()
  await page.getByRole('button', { name: 'Clear shortlist and revoke device storage' }).click()
  expect(await saved(page)).toBeNull()
  await chooser.getByRole('button', { name: 'Add Synthetic hospital source to shortlist', exact: true }).click()
  await expect(question).toHaveValue('')
  await expect(storageConsent).not.toBeChecked()
  await expect(exportConsent).not.toBeChecked()
  await page.getByRole('button', { name: 'Clear shortlist and revoke device storage' }).click()
  const upload = page.getByLabel('Import shortlist JSON (maximum 1 MiB; imported facts remain unverified)')
  await upload.setInputFiles({ name: 'synthetic-selection-brief.json', mimeType: 'application/json', buffer: defaultBrief })
  await expect(page.getByText('Unverified import.', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Decision', exact: true })).toHaveCount(2)
  expect(await saved(page)).toBeNull()
  mismatch = true
  await page.getByRole('link', { name: 'Compare up to four sources' }).click()
  await expect(page.getByRole('alert')).toHaveText('Comparison publication or source identity mismatch.')
  await expect(page.getByRole('table')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('feedback draft stays local and closing clears content and reply consent', async ({ page, context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort('blockedbyclient'))
  await page.goto('/contact')
  await page.getByRole('button', { name: 'Prepare a feedback draft' }).click()
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  const beforeStorage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  await page.getByLabel('Supporting source URL (optional, HTTP or HTTPS)', { exact: true }).fill('https://example.org/synthetic-source')
  await page.getByLabel('Feedback (optional, 2,000 characters)', { exact: true }).fill('Synthetic private feedback draft')
  await page.getByLabel('I request a reply if I later send this feedback').check()
  await expect(page.locator('pre.source-snapshot')).toContainText('Synthetic private feedback draft')
  await page.getByRole('button', { name: 'Close and clear draft' }).click()
  await page.getByRole('button', { name: 'Prepare a feedback draft' }).click()
  await expect(page.getByLabel('Feedback (optional, 2,000 characters)', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Supporting source URL (optional, HTTP or HTTPS)', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('I request a reply if I later send this feedback')).not.toBeChecked()
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).toBe(beforeStorage)
  expect(requests).toEqual([])
})
