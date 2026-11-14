import { defineConfig } from '@playwright/test'
import path from 'node:path'

const temporaryDirectory = process.env.TMPDIR ?? process.env.RUNNER_TEMP ?? '/workspace/build/builderbob/ushso-implementation/tmp'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: 'list',
  outputDir: process.env.USHSO_BROWSER_RESULTS ?? path.join(temporaryDirectory, 'ushso-browser-results'),
  use: {
    baseURL: 'http://127.0.0.1:8787',
    browserName: 'chromium',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'narrow', use: { viewport: { width: 390, height: 844 }, isMobile: true } },
  ],
  webServer: {
    command: `${process.env.USHSO_BROWSER_SKIP_BUILD === '1' ? '' : 'npm run build && '}npm run cf:dev -- --ip 127.0.0.1`,
    url: 'http://127.0.0.1:8787/',
    timeout: 180_000,
    reuseExistingServer: false,
    env: { WRANGLER_SEND_METRICS: 'false', TMPDIR: temporaryDirectory },
  },
})
