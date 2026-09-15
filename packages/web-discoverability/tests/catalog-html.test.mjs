import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATALOG_HTML_GENERATION,
  catalogSourceFacts,
  htmlCrawlerSeesSource,
  publicGuideSitemapPages,
  renderCatalogSourceHtml,
  renderPublicSitemap,
} from '../src/catalog-html.mjs';

const record = {
  record_id: 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17',
  title: 'Hospital Provider Cost Report',
  description: 'CMS hospital cost-report catalog metadata. Catalog membership is not payload access.',
  authoritative_url: 'https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report',
  identity: { source: { name: 'Centers for Medicare & Medicaid Services' }, asset: { name: 'Hospital Provider Cost Report' } },
  time_coverage: { start: 'documentation', end: 'landing page', state: 'bounded' },
  geography: { coverage_level: 'national', jurisdictions: ['US'] },
  evidence: [{ evidence_id: 'evidence:cms-data-catalog:bf696c5e94f4146abe7ad61b', state: 'source_asserted' }],
};

test('HTML-only crawler sees catalog source facts without invented structured fields', () => {
  const facts = catalogSourceFacts(record);
  const html = renderCatalogSourceHtml(record);
  assert.equal(facts.generation, CATALOG_HTML_GENERATION);
  assert.equal(facts.invented_fields.length, 0);
  assert.equal(htmlCrawlerSeesSource(html, facts), true);
  assert.match(html, /<link rel="canonical" href="https:\/\/ushso.org\/datasets\/obs%3Aasset%3Acms-data-catalog/);
  assert.doesNotMatch(html, /<script\s+src=/);
  assert.doesNotMatch(html, /doi.org\/10\./);
  const missing = catalogSourceFacts({ record_id: 'obs:asset:example', title: 'Example' });
  assert.equal(missing.publisher, 'not captured');
  assert.equal(missing.canonical_source_url, null);
});

test('public sitemap includes Methods, guides, and eligible source pages', () => {
  const xml = renderPublicSitemap('https://ushso.org', { recordIds: [record.record_id] });
  for (const page of publicGuideSitemapPages()) assert.match(xml, new RegExp(`<loc>https://ushso.org${page}</loc>`));
  assert.match(xml, /<loc>https:\/\/ushso.org\/learn<\/loc>/);
  assert.match(xml, /<loc>https:\/\/ushso.org\/methods<\/loc>/);
  assert.match(xml, /datasets\/obs%3Aasset%3Acms-data-catalog/);
});
