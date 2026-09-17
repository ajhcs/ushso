import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WCAG_TARGET = 'WCAG 2.2 AA';
const RESULT_REGIONS = ['title', 'description', 'why-match', 'geo-grain-time', 'access-evidence', 'details-action'];

function fail(code, detail) {
  const error = new Error(detail);
  error.code = code;
  throw error;
}

function channel(value) {
  const n = value / 255;
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const raw = hex.replace('#', '');
  const n = parseInt(raw, 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function cssVar(css, name) {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) fail('A11Y_CSS_TOKEN_MISSING', `Missing CSS token ${name}`);
  return match[1];
}

// Source-presence check only; browser journeys verify actual focus restoration.
export function hasReturnFocusTargets(source) {
  const match = source.match(/target\.querySelector<HTMLAnchorElement>\(\s*(['"])(.*?)\1\s*\)\?\.focus\(/);
  const selectors = match?.[2].split(',').map((selector) => selector.trim()) ?? [];
  return selectors.includes('h2 a') && selectors.includes('[data-navigator-details]');
}

export async function auditBrowserAccessibility({ repositoryRoot = root } = {}) {
  const files = {
    app: await readFile(path.join(repositoryRoot, 'apps/web/src/App.tsx'), 'utf8'),
    css: await readFile(path.join(repositoryRoot, 'apps/web/src/styles.css'), 'utf8'),
    header: await readFile(path.join(repositoryRoot, 'apps/web/src/components/ObservatoryHeader.tsx'), 'utf8'),
    searchBox: await readFile(path.join(repositoryRoot, 'apps/web/src/components/SearchBox.tsx'), 'utf8'),
    facets: await readFile(path.join(repositoryRoot, 'apps/web/src/components/FacetSidebar.tsx'), 'utf8'),
    pagination: await readFile(path.join(repositoryRoot, 'apps/web/src/components/Pagination.tsx'), 'utf8'),
    resultCard: await readFile(path.join(repositoryRoot, 'apps/web/src/components/ResultCard.tsx'), 'utf8'),
    searchPage: await readFile(path.join(repositoryRoot, 'apps/web/src/pages/SearchResultsPage.tsx'), 'utf8'),
    details: await readFile(path.join(repositoryRoot, 'apps/web/src/pages/DatasetDetailsPage.tsx'), 'utf8'),
    workspace: await readFile(path.join(repositoryRoot, 'apps/web/src/pages/WorkspacePage.tsx'), 'utf8'),
    compare: await readFile(path.join(repositoryRoot, 'apps/web/src/pages/ComparePage.tsx'), 'utf8'),
    variables: await readFile(path.join(repositoryRoot, 'apps/web/src/components/VariableBrowser.tsx'), 'utf8'),
  };

  const findings = [];
  const record = (id, status, detail) => findings.push({ id, status, detail });

  if (!files.app.includes('className="skip-link"') || !files.app.includes('href="#main-content"')) fail('A11Y_SKIP_LINK', 'Skip link to #main-content is missing');
  if (!files.css.includes('.skip-link:focus')) fail('A11Y_SKIP_LINK_FOCUS', 'Skip link is not revealed on keyboard focus');
  record('skip-link', 'source_present', 'Skip link targets #main-content and is revealed on :focus.');

  const regionMatches = [...files.resultCard.matchAll(/data-result-region="([^"]+)"/g)].map((match) => match[1]);
  if (regionMatches.length !== 6) fail('RESULT_CARD_SIX_REGION_DRIFT', `Result card has ${regionMatches.length} data-result-region values`);
  if (RESULT_REGIONS.some((region, index) => regionMatches[index] !== region)) fail('RESULT_CARD_SIX_REGION_DRIFT', 'Result card regions drifted from the sealed six-region contract');
  record('six-result-regions', 'source_present', 'Exactly six sealed result-card regions remain.');

  if (!files.header.includes('aria-expanded={menuOpen}') || !files.header.includes("event.key === 'Escape'")) fail('A11Y_MENU_ESCAPE', 'Primary navigation must expose expanded state and close on Escape');
  if (!files.searchBox.includes('role="combobox"') || !files.searchBox.includes("event.key === 'Escape'")) fail('A11Y_SEARCH_KEYBOARD', 'Search combobox must support arrow keys and Escape');
  if (!files.searchPage.includes("event.key === 'Escape'") || !files.searchPage.includes('filterTriggerRef.current?.focus()')) fail('A11Y_FILTER_FOCUS_RESTORE', 'Filter dialog must restore focus to its trigger');
  if (!hasReturnFocusTargets(files.searchPage)) fail('A11Y_BACK_NAV_FOCUS', 'Returning from a source page must restore focus to the selected result or navigator brief');
  if (!files.facets.includes('aria-label="Close filters"') || !files.pagination.includes('aria-label="Search results pages"')) fail('A11Y_CONTROL_NAME', 'Filter close and pagination controls need accessible names');
  if (!files.variables.includes('aria-labelledby="variable-browser-heading"') || !files.workspace.includes('aria-live="polite"')) fail('A11Y_LIVE_OR_DICTIONARY', 'Dictionary region or shortlist live status is missing');
  if (!files.compare.includes('aria-label="Example comparisons"') || !files.workspace.includes('Download evidence packet')) fail('A11Y_COMPARE_EXPORT', 'Comparison presets or packet export controls are missing');
  record('keyboard-source', 'source_present', 'Search, menu Escape, filter focus trap/restore, back-navigation restore, dictionary, shortlist, comparison and export controls are present in source.');

  const navy = cssVar(files.css, '--navy');
  const interactive = cssVar(files.css, '--interactive');
  const secondary = cssVar(files.css, '--secondary');
  const pairs = [
    { name: 'navy-on-white', fg: navy, bg: '#ffffff', minimum: 4.5 },
    { name: 'interactive-on-white', fg: interactive, bg: '#ffffff', minimum: 4.5 },
    { name: 'secondary-on-white', fg: secondary, bg: '#ffffff', minimum: 4.5 },
    { name: 'white-on-navy-deep', fg: '#ffffff', bg: cssVar(files.css, '--navy-deep'), minimum: 4.5 },
  ];
  const contrastPairs = pairs.map((pair) => {
    const ratio = Number(contrast(pair.fg, pair.bg).toFixed(2));
    if (ratio < pair.minimum) fail('A11Y_CONTRAST', `${pair.name} contrast ${ratio} is below ${pair.minimum}`);
    return { ...pair, ratio };
  });
  record('contrast-tokens', 'measured', 'Named text tokens meet 4.5:1 against their documented backgrounds. This is not a full-page contrast certification.');

  if (!/@media \(max-width: 320px\)[\s\S]*\.primary-nav a \{ min-height: 44px/.test(files.css)) fail('A11Y_TARGET_320', '320px primary nav targets are below 44px');
  if (!/@media \(max-width: 390px\)[\s\S]*\.primary-nav a \{ min-height: 44px/.test(files.css)) fail('A11Y_TARGET_390', '390px primary nav targets are below 44px');
  if (!files.css.includes('.mobile-menu-button { width: 44px; height: 44px;')) fail('A11Y_TARGET_MENU', 'Mobile menu button is not 44x44');
  if (/@media \(max-width: 360px\)[\s\S]*\.mobile-menu-button \{ width: 40px;/.test(files.css)) fail('A11Y_TARGET_MENU_360', '360px menu button shrinks below 44px');
  record('target-size', 'measured', 'Documented 44px targets remain for primary nav at 320/390 and the mobile menu button.');

  const atLog = {
    target: WCAG_TARGET,
    method: 'No screen-reader/browser combination was operated for PR-073.',
    combinations: [
      { id: 'nvda-firefox', tool: 'NVDA', browser: 'Firefox', status: 'untested' },
      { id: 'voiceover-safari', tool: 'VoiceOver', browser: 'Safari', status: 'untested' },
      { id: 'jaws-chrome', tool: 'JAWS', browser: 'Chrome', status: 'untested' },
    ],
    novice_tasks: 'untested',
    expert_tasks: 'untested',
    frontend_acceptance: 'not_issued',
    note: 'An implementation passes only named combinations that were actually run. Untested combinations are not passed. Automated source checks do not certify WCAG 2.2 AA.',
  };
  record('assistive-technology', 'untested', 'No real supported screen-reader/browser combination was run. Combinations remain untested, not passed.');

  return {
    ok: true,
    wcag_target: WCAG_TARGET,
    automated_certification: false,
    conformance_claimed: false,
    six_result_card_regions: regionMatches,
    contrast_pairs: contrastPairs,
    keyboard_source_present: true,
    assistive_technology: atLog,
    findings,
    live_browser_session: false,
    screenshot_conformance: false,
  };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  auditBrowserAccessibility().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.code ?? 'A11Y_CHECK_FAILED'}: ${error.message}\n`);
    process.exitCode = 2;
  });
}
