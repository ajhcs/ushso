import { htmlText as escape, publicId, siteOrigin, stableDatasetPath, stringValue } from './safety.mjs';
import { renderNotFoundHtml } from './render.mjs';

export const PUBLIC_PAGE_SCHEMA = 'ushso-public-pages.v1';
const boundary = 'Catalog membership does not establish payload access, authorization, schema, join compatibility, or analytic fitness.';
export const informationPages = Object.freeze([
  { path: '/', title: 'United States Health Systems Observatory', description: 'Find healthcare data sources and inspect the evidence and limits of source selection.', body: '<h1>United States Health Systems Observatory</h1><p>Discover healthcare data sources, inspect source metadata, and follow publisher access instructions.</p><p>Examples to investigate include hospital services, public health surveillance, and population denominators. Search results are discovery leads; an analysis has not been performed.</p>' },
  { path: '/about', title: 'About the Observatory', description: 'An evidence-bound discovery and routing layer for United States health-systems data.', body: '<h1>About the Observatory</h1><p>USHSO helps researchers identify data sources and understand their documented access boundaries. The Observatory indexes source metadata and retrieval instructions.</p><p>Accepted source-selection coverage is unresolved for this legacy inventory. Inventory counts are not measures of research readiness.</p>' },
  { path: '/methods', title: 'Methods and evidence boundaries', description: 'How source metadata, evidence, and uncertainty are presented in the Observatory.', body: '<h1>Methods and evidence boundaries</h1><p>Search views are non-authoritative projections of captured source metadata. Metadata observations do not prove current source availability or payload contents.</p><p>Coverage, variables, access, and joins require evidence review. Unknown, blocked, failed, and unavailable outcomes must remain distinct. A zero-result search does not establish source absence.</p>' },
  { path: '/sources', title: 'Source guide', description: 'Use the source inventory while keeping access and coverage limits visible.', body: '<h1>Source guide</h1><p>Inspect each source record and its evidence references before following publisher access instructions. Confirm the release, geography, time coverage, variables, and permitted use for your research.</p><p>This build provides a legacy catalog inventory. Accepted coverage, source-selection readiness, and join compatibility remain unresolved.</p>' }
]);
function text(value, label, max = 2000) { return stringValue(value, label, { max }); }
export function inventoryPage(record) {
  if (!record || typeof record !== 'object') throw new Error('PUBLIC_RECORD_INVALID');
  const id = publicId(record.record_id);
  const title = text(record.title, 'title', 2000);
  // Deliberately omit inferred capabilities, access classifications and coverage claims.
  // Only first-party metadata observations can supply a catalog description.
  const observed = (record.evidence ?? []).some(item => ['source_asserted', 'verified_first_party'].includes(item.state));
  const description = observed && record.description ? text(record.description, 'description', 100000).slice(0, 2000) : 'No eligible source description is available.';
  const evidence = (record.evidence ?? []).filter(item => ['source_asserted', 'verified_first_party'].includes(item.state)).slice(0, 100).map(item => text(item.evidence_id, 'evidence_id', 500));
  return { path: stableDatasetPath(id), title, description: `Legacy source inventory: ${title}`.slice(0, 300), body: `<h1>${escape(title)}</h1><p><strong>Legacy inventory only; accepted coverage unresolved.</strong></p><p>${escape(description)}</p><dl><dt>Record identifier</dt><dd>${escape(id)}</dd><dt>Geographic and time coverage</dt><dd>Unresolved for accepted source selection.</dd><dt>Access and authorization</dt><dd>Unresolved; confirm publisher requirements before retrieval.</dd><dt>Evidence references for captured metadata</dt><dd>${evidence.length ? evidence.map(escape).join(', ') : 'Unknown'}</dd></dl>` };
}
export function renderInitialPage(page, { shell, origin = 'https://ushso.org', legacyGeneration = null } = {}) {
  const canonical = `${siteOrigin(origin)}${page.path === '/' ? '/' : page.path}`;
  if (typeof shell !== 'string' || !/<div id="root"><\/div>/.test(shell)) throw new Error('PUBLIC_MOUNT_SHELL_INVALID');
  const head = `<title>${escape(page.title)} | USHSO</title><meta name="description" content="${escape(page.description)}"><link rel="canonical" href="${escape(canonical)}"><meta property="og:type" content="website"><meta property="og:title" content="${escape(page.title)}"><meta property="og:description" content="${escape(page.description)}"><meta property="og:url" content="${escape(canonical)}"><meta name="ushso:publication-mode" content="legacy_inventory_only">`;
  const content = `<noscript><main id="initial-content"><nav><a href="/">Home</a> · <a href="/sources">Sources</a> · <a href="/about">About</a> · <a href="/methods">Methods</a></nav>${page.body}<p>${escape(boundary)}</p><p>Accepted generation: unavailable.${legacyGeneration ? ` Legacy inventory generation: ${escape(legacyGeneration)}.` : ''}</p></main></noscript>`;
  return shell.replace(/<title>[\s\S]*?<\/title>/gi, '').replace(/<meta\s+name="description"[\s\S]*?>/gi, '').replace('</head>', `${head}</head>`).replace('<div id="root"></div>', `${content}<div id="root"></div>`);
}
export { renderNotFoundHtml };
