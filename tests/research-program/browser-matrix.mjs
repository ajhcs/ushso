import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicGuideSitemapPages } from '../../packages/web-discoverability/src/catalog-html.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function fail(code, detail) {
  const error = new Error(detail);
  error.code = code;
  throw error;
}

export async function auditBrowserMatrix({ repositoryRoot = root } = {}) {
  const css = await readFile(path.join(repositoryRoot, 'apps/web/src/styles.css'), 'utf8');
  const worker = await readFile(path.join(repositoryRoot, 'worker/index.mjs'), 'utf8');
  const details = await readFile(path.join(repositoryRoot, 'apps/web/src/pages/DatasetDetailsPage.tsx'), 'utf8');
  const resultCard = await readFile(path.join(repositoryRoot, 'apps/web/src/components/ResultCard.tsx'), 'utf8');
  const app = await readFile(path.join(repositoryRoot, 'apps/web/src/App.tsx'), 'utf8');

  const viewports = [320, 390, 768, 1440];
  const cssViewports = {
    320: /@media \(max-width: 320px\)/.test(css),
    390: /@media \(max-width: 390px\)/.test(css),
    768: /@media \(max-width: 820px\)/.test(css),
    1440: css.includes('--content-max: 1352px') || css.includes('max-width: var(--content-max)'),
  };
  for (const width of viewports) {
    if (!cssViewports[width]) fail('BROWSER_VIEWPORT_CSS', `No documented CSS bound for ${width}px`);
  }

  const regionCount = [...resultCard.matchAll(/data-result-region="/g)].length;
  if (regionCount !== 6) fail('RESULT_CARD_SIX_REGION_DRIFT', `Result card has ${regionCount} regions`);
  if (!details.includes("discovery.error.code === 'record_not_found'") || details.includes('if (!dataset) return null')) fail('BLANK_DETAIL_PAGE', 'Missing records must render a not-found page, not a blank page');
  if (!details.includes('Catalog generation:') && !details.includes('rememberLastSeenGeneration')) fail('GENERATION_CONTEXT', 'Detail pages must retain generation context');
  if (!worker.includes("'/learn'") || !worker.includes("'/methods'")) fail('SITEMAP_GUIDES', 'Worker sitemap must include Learn and Methods');
  if (worker.includes('packages/enrichment')) fail('WORKER_ENRICHMENT', 'worker/index.mjs must not import enrichment');
  if (!app.includes('path="/learn"') || !app.includes('path="/methods"')) fail('SPA_GUIDES', 'SPA must keep Learn and Methods routes');

  const engines = [
    { id: 'chromium', engine: 'Chromium', status: 'untested', physical_device: false, emulator_claimed_as_device: false },
    { id: 'firefox', engine: 'Firefox', status: 'untested', physical_device: false, emulator_claimed_as_device: false },
    { id: 'webkit', engine: 'WebKit/Safari-equivalent', status: 'untested', physical_device: false, emulator_claimed_as_device: false },
  ];

  return {
    ok: true,
    css_viewports: cssViewports,
    documented_viewports_px: viewports,
    live_engine_sessions: engines,
    physical_device_tests: false,
    emulator_claimed_as_physical_device: false,
    native_webmcp_unsupported_browsers: 'untested',
    webmcp_distinct_from_site_usability: true,
    six_result_card_regions: regionCount,
    blank_detail_page: false,
    sitemap_guide_pages: publicGuideSitemapPages(),
    zoom_checks: 'untested',
    note: 'CSS viewport bounds and source-route checks are documented. Live Chromium, Firefox and WebKit sessions were not operated. An emulator is not a physical-device test. Native WebMCP remains untested in unsupported browsers.',
  };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  auditBrowserMatrix().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.code ?? 'BROWSER_MATRIX_FAILED'}: ${error.message}\n`);
    process.exitCode = 2;
  });
}
