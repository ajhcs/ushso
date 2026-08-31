import {
  LIMITS,
  SEO_RENDERER_VERSION,
  assertByteLimit,
  htmlAttribute,
  htmlText,
  safeJsonForHtml,
  safePublicHttpsUrl,
  siteOrigin,
  xmlText
} from './safety.mjs';

const SITE_NAME = 'US Health Systems Observatory';
const GENERIC_404 = Object.freeze({
  title: `Dataset not found | ${SITE_NAME}`,
  description: 'The requested public dataset page is not available.'
});
const GENERIC_410 = Object.freeze({
  title: `Dataset no longer available | ${SITE_NAME}`,
  description: 'A dataset previously published at this address is no longer available.'
});

function optionalProperty(target, key, value) {
  if (value !== null && value !== undefined && (!Array.isArray(value) || value.length > 0)) target[key] = value;
}

function temporalCoverageValue(coverage) {
  if (!coverage || (!coverage.start && !coverage.end)) return null;
  return `${coverage.start ?? '..'}/${coverage.end ?? '..'}`;
}

function schemaDistribution(distribution) {
  const value = {
    '@type': 'DataDownload',
    name: distribution.name
  };
  optionalProperty(value, 'encodingFormat', distribution.media_type ?? distribution.format);
  optionalProperty(value, 'contentUrl', distribution.download_url);
  optionalProperty(value, 'url', distribution.access_url);
  return value;
}

function unwrapRecord(record) {
  return record?.document ? record : { document: record, publication_pin: record?.publication_pin };
}

export function schemaOrgDataset(record) {
  const { document } = unwrapRecord(record);
  const content = document.content;
  const publisher = {
    '@type': 'Organization',
    name: content.publisher.name
  };
  optionalProperty(publisher, 'url', content.publisher.canonical_url);
  const dataset = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    '@id': `${content.canonical_url}#dataset`,
    url: content.canonical_url,
    identifier: content.public_id,
    name: content.title,
    description: content.description,
    publisher
  };
  optionalProperty(dataset, 'temporalCoverage', temporalCoverageValue(content.temporal_coverage));
  optionalProperty(dataset, 'spatialCoverage', content.spatial_coverage.map(item => ({ '@type': 'Place', name: item.name })));
  optionalProperty(dataset, 'distribution', content.distributions.filter(distribution => distribution.download_url !== null).map(schemaDistribution));
  optionalProperty(dataset, 'license', content.license_url);
  optionalProperty(dataset, 'dateModified', content.modified_at);
  if (content.access.classification === 'open') dataset.isAccessibleForFree = true;
  if (content.access.classification === 'paid') dataset.isAccessibleForFree = false;
  return dataset;
}

function dcatDistribution(distribution, index) {
  const value = {
    '@id': `${distribution.access_url ?? distribution.download_url}#distribution-${index + 1}`,
    '@type': 'dcat:Distribution',
    'dct:title': distribution.name
  };
  optionalProperty(value, 'dct:format', distribution.format);
  optionalProperty(value, 'dcat:mediaType', distribution.media_type);
  optionalProperty(value, 'dcat:accessURL', distribution.access_url ? { '@id': distribution.access_url } : null);
  optionalProperty(value, 'dcat:downloadURL', distribution.download_url ? { '@id': distribution.download_url } : null);
  return value;
}

function dcatTemporal(coverage) {
  if (!coverage || (!coverage.start && !coverage.end)) return null;
  const period = { '@type': 'dct:PeriodOfTime' };
  optionalProperty(period, 'dcat:startDate', coverage.start ? { '@value': coverage.start, '@type': 'xsd:date' } : null);
  optionalProperty(period, 'dcat:endDate', coverage.end ? { '@value': coverage.end, '@type': 'xsd:date' } : null);
  return period;
}

export function dcatDataset(record) {
  const { document } = unwrapRecord(record);
  const content = document.content;
  if (content.dcat_us === null) return null;
  const dataset = {
    '@context': {
      dcat: 'http://www.w3.org/ns/dcat#',
      dct: 'http://purl.org/dc/terms/',
      foaf: 'http://xmlns.com/foaf/0.1/',
      rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
      xsd: 'http://www.w3.org/2001/XMLSchema#'
    },
    '@id': content.canonical_url,
    '@type': 'dcat:Dataset',
    'dct:identifier': content.public_id,
    'dct:title': content.title,
    'dct:description': content.description,
    'dct:publisher': {
      '@type': 'foaf:Agent',
      'foaf:name': content.publisher.name
    },
    'dct:conformsTo': { '@id': content.dcat_us.profile_url }
  };
  optionalProperty(dataset, 'dct:temporal', dcatTemporal(content.temporal_coverage));
  optionalProperty(dataset, 'dct:spatial', content.spatial_coverage.map(item => ({ '@type': 'dct:Location', 'rdfs:label': item.name })));
  optionalProperty(dataset, 'dcat:distribution', content.distributions
    .filter(distribution => distribution.access_url || distribution.download_url)
    .map(dcatDistribution));
  optionalProperty(dataset, 'dct:license', content.license_url ? { '@id': content.license_url } : null);
  return dataset;
}

function definition(label, value, className) {
  return `<div class="fact ${htmlAttribute(className)}"><dt>${htmlText(label)}</dt><dd>${htmlText(value)}</dd></div>`;
}

function recordBody(record) {
  const { document, publication_pin: publicationPin } = unwrapRecord(record);
  const content = document.content;
  const temporal = content.temporal_coverage?.label ?? 'Not documented in this publication';
  const spatial = content.spatial_coverage.length
    ? content.spatial_coverage.map(item => item.name).join('; ')
    : 'Not documented in this publication';
  return `<main data-crawler-content="dataset" data-publication-generation="${htmlAttribute(publicationPin.search_generation_id)}">
<nav aria-label="Breadcrumb"><a href="/">USHSO</a> / <a href="/datasets">Datasets</a></nav>
<article>
<header><p>Public dataset record</p><h1>${htmlText(content.title)}</h1><p class="summary">${htmlText(content.description)}</p></header>
<section aria-labelledby="record-facts"><h2 id="record-facts">Dataset facts</h2><dl>
${definition('Publisher', content.publisher.name, 'publisher')}
${definition('Temporal coverage', temporal, 'temporal-coverage')}
${definition('Spatial coverage', spatial, 'spatial-coverage')}
${definition('Access', content.access.label, 'access-boundary')}
${definition('Access boundary', content.access.boundary, 'access-boundary-detail')}
${definition('Evidence status', content.evidence_summary.status, 'evidence-status')}
${definition('Evidence observed', content.evidence_summary.observed_at, 'evidence-observed')}
</dl></section>
<section aria-labelledby="evidence-summary"><h2 id="evidence-summary">Evidence summary</h2><p>${htmlText(content.evidence_summary.summary)}</p></section>
<p><a class="canonical-source" rel="external noopener" href="${htmlAttribute(content.canonical_source_url)}">View the canonical source metadata</a></p>
<aside aria-label="Research boundary"><strong>Research boundary:</strong> USHSO recommends and explains public sources. It does not execute analyses, calculate market share, or produce financial benchmarks.</aside>
</article></main>`;
}

function htmlShell({ title, description, canonicalUrl = null, robots, body, schema = null, dcat = null, dcatProfile = null, generation = null }) {
  const generationMeta = generation === null ? '' : `<meta name="ushso:search-generation" content="${htmlAttribute(generation)}">`;
  const canonical = canonicalUrl === null ? '' : `<link rel="canonical" href="${htmlAttribute(canonicalUrl)}">`;
  const social = canonicalUrl === null ? '' : `<meta property="og:type" content="website"><meta property="og:site_name" content="${SITE_NAME}"><meta property="og:title" content="${htmlAttribute(title)}"><meta property="og:description" content="${htmlAttribute(description)}"><meta property="og:url" content="${htmlAttribute(canonicalUrl)}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${htmlAttribute(title)}"><meta name="twitter:description" content="${htmlAttribute(description)}">`;
  const schemaScript = schema === null ? '' : `<script type="application/ld+json" data-profile="schema-org-dataset">${safeJsonForHtml(schema)}</script>`;
  const dcatScript = dcat === null ? '' : `<script type="application/ld+json" data-profile="${htmlAttribute(dcatProfile)}">${safeJsonForHtml(dcat)}</script>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="${SEO_RENDERER_VERSION}"><title>${htmlText(title)}</title><meta name="description" content="${htmlAttribute(description)}"><meta name="robots" content="${htmlAttribute(robots)}">${generationMeta}${canonical}${social}${schemaScript}${dcatScript}</head><body>${body}</body></html>`;
  assertByteLimit(html, LIMITS.maxHtmlBytes, 'SEO_HTML_BYTES_EXCEEDED');
  return html;
}

export function renderDatasetHtml(record) {
  const { document, publication_pin: publicationPin } = unwrapRecord(record);
  const title = `${document.content.title} | ${SITE_NAME}`;
  return htmlShell({
    title,
    description: document.content.description,
    canonicalUrl: document.content.canonical_url,
    robots: 'index,follow,max-snippet:-1,max-image-preview:large',
    body: recordBody(record),
    schema: schemaOrgDataset(record),
    dcat: dcatDataset(record),
    dcatProfile: document.content.dcat_us?.profile ?? null,
    generation: publicationPin.search_generation_id
  });
}

export function renderNotFoundHtml() {
  return htmlShell({
    ...GENERIC_404,
    robots: 'noindex,nofollow,noarchive',
    body: '<main><h1>Dataset not found</h1><p>The requested public dataset page is not available.</p></main>'
  });
}

export function renderGoneHtml(canonicalUrl) {
  const safeCanonicalUrl = safePublicHttpsUrl(canonicalUrl, 'gone.canonical_url', { allowQuery: false });
  return htmlShell({
    ...GENERIC_410,
    canonicalUrl: safeCanonicalUrl,
    robots: 'noindex,nofollow,noarchive',
    body: '<main><h1>Dataset no longer available</h1><p>A dataset previously published at this address is no longer available.</p></main>'
  });
}

export function sitemapUrlset(urls, lastModified) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${xmlText(url)}</loc><lastmod>${xmlText(lastModified)}</lastmod></url>`).join('\n')}\n</urlset>\n`;
}

export function sitemapIndex(urls, lastModified) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <sitemap><loc>${xmlText(url)}</loc><lastmod>${xmlText(lastModified)}</lastmod></sitemap>`).join('\n')}\n</sitemapindex>\n`;
}

export function robotsText(origin) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteOrigin(origin)}/sitemap.xml\n`;
}

export const GENERIC_NOT_FOUND_HTML = renderNotFoundHtml();
