import { htmlAttribute, htmlText, safeJsonForHtml, safePublicHttpsUrl } from '../packages/web-discoverability/src/safety.mjs';

export const CATALOG_HTML_GENERATION = 'live-2026-09-03-85b50522b420';
export const SITE_NAME = 'United States Health Systems Observatory';
const UNKNOWN = 'not captured';

function captured(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : UNKNOWN;
}

function firstHttps(candidates) {
  for (const value of candidates) {
    if (typeof value !== 'string' || value.trim().length === 0) continue;
    try {
      return safePublicHttpsUrl(value.trim(), 'catalog.canonical_source_url', { allowQuery: true });
    } catch {
      continue;
    }
  }
  return null;
}

export function catalogSourceFacts(record = {}, { origin = 'https://ushso.org', generation = CATALOG_HTML_GENERATION } = {}) {
  const title = captured(record.title ?? record.identity?.asset?.name);
  const description = captured(record.description);
  const publisher = captured(record.identity?.source?.name);
  const recordId = captured(record.record_id);
  const sourceUrl = firstHttps([
    record.authoritative_url,
    record.provenance?.[0]?.locator,
    record.identity?.source?.homepage,
  ]);
  const time = record.time_coverage;
  const temporal = time?.start && time?.end
    ? `${time.start}–${time.end}`
    : captured(time?.state);
  const geography = Array.isArray(record.geography?.jurisdictions) && record.geography.jurisdictions.length
    ? record.geography.jurisdictions.join('; ')
    : captured(record.geography?.coverage_level);
  const evidenceId = captured(record.evidence?.[0]?.evidence_id);
  const evidenceState = captured(record.evidence?.[0]?.state ?? record.access?.evidence_state);
  const path = recordId === UNKNOWN ? '/datasets' : `/datasets/${encodeURIComponent(recordId)}`;
  return {
    title,
    description,
    publisher,
    record_id: recordId,
    generation,
    temporal_coverage: temporal,
    spatial_coverage: geography,
    evidence_id: evidenceId,
    evidence_state: evidenceState,
    canonical_source_url: sourceUrl,
    canonical_url: `${origin}${path}`,
    path,
    invented_fields: [],
  };
}

export function catalogSourceJsonLd(facts) {
  const dataset = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: facts.title,
    description: facts.description,
    identifier: facts.record_id,
    url: facts.canonical_url,
    publisher: {
      '@type': 'Organization',
      name: facts.publisher,
    },
  };
  if (facts.canonical_source_url) dataset.sameAs = facts.canonical_source_url;
  if (facts.temporal_coverage !== UNKNOWN) dataset.temporalCoverage = facts.temporal_coverage;
  if (facts.spatial_coverage !== UNKNOWN) dataset.spatialCoverage = { '@type': 'Place', name: facts.spatial_coverage };
  return dataset;
}

export function renderCatalogSourceHtml(record, options = {}) {
  const facts = catalogSourceFacts(record, options);
  const schema = catalogSourceJsonLd(facts);
  const sourceLink = facts.canonical_source_url
    ? `<p><strong>Clear source action:</strong> Open the publisher page for this exact product. That page is a reachable documentation page, not proven payload or browser access.</p><p><a class="canonical-source" rel="external noopener" href="${htmlAttribute(facts.canonical_source_url)}">View the publisher source</a></p>`
    : '<p><strong>Clear source action:</strong> No verified publisher URL is bound for this record. Catalog membership is not payload access.</p><p>Publisher locator not captured.</p>';
  const body = `<main data-crawler-content="dataset" data-publication-generation="${htmlAttribute(facts.generation)}">
<nav aria-label="Breadcrumb"><a href="/">USHSO</a> / <a href="/learn">Learn</a> / <a href="/methods">Methods</a></nav>
<article>
<header><p>Public catalog metadata</p><h1>${htmlText(facts.title)}</h1><p class="summary">${htmlText(facts.description)}</p></header>
<section aria-labelledby="record-facts"><h2 id="record-facts">Source facts</h2><dl>
<div><dt>Publisher</dt><dd>${htmlText(facts.publisher)}</dd></div>
<div><dt>Record ID</dt><dd>${htmlText(facts.record_id)}</dd></div>
<div><dt>Generation</dt><dd>${htmlText(facts.generation)}</dd></div>
<div><dt>Temporal coverage</dt><dd>${htmlText(facts.temporal_coverage)}</dd></div>
<div><dt>Spatial coverage</dt><dd>${htmlText(facts.spatial_coverage)}</dd></div>
<div><dt>Evidence ID</dt><dd>${htmlText(facts.evidence_id)}</dd></div>
<div><dt>Evidence state</dt><dd>${htmlText(facts.evidence_state)}</dd></div>
</dl></section>
${sourceLink}
<aside aria-label="Research boundary"><strong>Research boundary:</strong> Catalog membership is not payload access. Finding a source is not obtaining the data. HTTP 200 is not a completed research task. Unknown fields stay not captured and are not invented.</aside>
</article></main>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlText(`${facts.title} | ${SITE_NAME}`)}</title><meta name="description" content="${htmlAttribute(facts.description)}"><link rel="canonical" href="${htmlAttribute(facts.canonical_url)}"><meta name="ushso:search-generation" content="${htmlAttribute(facts.generation)}"><script type="application/ld+json" data-profile="schema-org-dataset">${safeJsonForHtml(schema)}</script></head><body>${body}</body></html>`;
}

export function publicGuideSitemapPages() {
  return ['/', '/search', '/learn', '/methods', '/agents', '/sources', '/about', '/privacy', '/terms', '/contact'];
}

export function renderPublicSitemap(origin, { recordIds = [], lastmod = '2026-09-03' } = {}) {
  const pages = publicGuideSitemapPages().map((page) => `${origin}${page}`);
  const sources = recordIds.slice(0, 50).map((id) => `${origin}/datasets/${encodeURIComponent(id)}`);
  const urls = [...pages, ...sources];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${url.replaceAll('&', '&amp;')}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`;
}

export function htmlCrawlerSeesSource(html, facts) {
  return html.includes(htmlText(facts.title))
    && html.includes(htmlText(facts.description).slice(0, 40))
    && html.includes(htmlText(facts.publisher))
    && html.includes(htmlText(facts.generation))
    && html.includes('data-crawler-content="dataset"')
    && html.includes(htmlText(facts.record_id))
    && !/<script\s+src=/u.test(html);
}
