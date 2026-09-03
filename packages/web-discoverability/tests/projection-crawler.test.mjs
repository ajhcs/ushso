import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSeoGenerationArtifact,
  dcatDataset,
  renderDatasetHtml,
  schemaOrgDataset
} from '../src/index.mjs';
import { artifact, publication, record } from './fixtures.mjs';

function jsonLd(html, profile) {
  const expression = new RegExp(`<script type="application/ld\\+json" data-profile="${profile}">([\\s\\S]*?)<\\/script>`, 'u');
  const match = expression.exec(html);
  assert.ok(match, `missing ${profile} JSON-LD`);
  return JSON.parse(match[1]);
}

function sitemapLocations(xml) {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/gu)].map(match => match[1].replaceAll('&amp;', '&'));
}

test('immutable SEO projection and no-JavaScript page carry complete record-specific facts and pins', async () => {
  const projection = await artifact();
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.records[0].document), true);
  assert.equal(projection.publication_pin.search_generation_id, 'generation:a:asset-search');
  assert.equal(projection.publication_pin.seo_generation_id, 'generation:a:seo');
  assert.equal(projection.records[0].document.generation_id, projection.publication_pin.seo_generation_id);
  assert.equal(projection.records[0].document.source_of_truth, false);
  assert.equal(projection.records[0].document.visibility_state, 'public');

  const html = renderDatasetHtml(projection.records[0]);
  assert.match(html, /<title>CMS Facility Directory \| US Health Systems Observatory<\/title>/u);
  assert.match(html, /<meta name="description" content="Public metadata describing/u);
  assert.match(html, /<link rel="canonical" href="https:\/\/ushso\.example\/datasets\/obs%3Aasset%3Acms-facility-directory">/u);
  assert.match(html, /<meta name="robots" content="index,follow/u);
  assert.match(html, /data-crawler-content="dataset"/u);
  assert.match(html, /Centers for Medicare &amp; Medicaid Services/u);
  assert.match(html, /2020 through 2025 \(calendar years\)/u);
  assert.match(html, /United States/u);
  assert.match(html, /Public catalog metadata; verify the selected distribution before use/u);
  assert.match(html, /Evidence status<\/dt><dd>documented/u);
  assert.match(html, /class="canonical-source"[^>]+href="https:\/\/data\.cms\.gov/u);
  assert.doesNotMatch(html, /<script\s+src=/u);

  const schema = jsonLd(html, 'schema-org-dataset');
  assert.equal(schema['@type'], 'Dataset');
  assert.equal(schema.name, 'CMS Facility Directory');
  assert.equal(schema.publisher.name, 'Centers for Medicare & Medicaid Services');
  assert.equal(schema.temporalCoverage, '2020-01-01/2025-12-31');
  assert.equal(schema.distribution[0]['@type'], 'DataDownload');
  assert.equal(schema.isAccessibleForFree, true);
  assert.deepEqual(schema, schemaOrgDataset(projection.records[0]));

  const dcat = jsonLd(html, 'dcat-us-1.1');
  assert.equal(dcat['@type'], 'dcat:Dataset');
  assert.equal(dcat['dct:conformsTo']['@id'], 'https://resources.data.gov/resources/dcat-us/');
  assert.equal(dcat['dct:temporal']['@type'], 'dct:PeriodOfTime');
  assert.deepEqual(dcat['dct:temporal']['dcat:startDate'], { '@value': '2020-01-01', '@type': 'xsd:date' });
  assert.equal(dcat['dct:spatial'][0]['@type'], 'dct:Location');
  assert.deepEqual(dcat, dcatDataset(projection.records[0]));
});

test('untrusted source metadata cannot break HTML, attributes, or JSON-LD script boundaries', async () => {
  const evilTitle = 'Facility </title><script>alert("title")</script> & directory';
  const evilDescription = '</script><img src=x onerror=alert(1)> "metadata" & more';
  const evilPublisher = 'CMS"><svg onload=alert(2)> & publisher';
  const projection = await artifact({ records: [record({ title: evilTitle, description: evilDescription, publisherName: evilPublisher })] });
  const html = renderDatasetHtml(projection.records[0]);
  assert.doesNotMatch(html, /<script>alert/u);
  assert.doesNotMatch(html, /<img src=x/u);
  assert.doesNotMatch(html, /<svg onload/u);
  assert.doesNotMatch(html, /<\/script><img/u);
  assert.match(html, /Facility &lt;\/title&gt;&lt;script&gt;alert/u);
  assert.match(html, /\\u003c\/script\\u003e\\u003cimg/u);
  const schema = jsonLd(html, 'schema-org-dataset');
  assert.equal(schema.name, evilTitle);
  assert.equal(schema.description, evilDescription);
  assert.equal(schema.publisher.name, evilPublisher);
});

test('DCAT is omitted without explicit supported facts and sitemap is an exact sorted public set', async () => {
  const records = [
    record({ id: 'obs:asset:z-record', title: 'Z record', dcat: false }),
    record({ id: 'obs:asset:a-record', title: 'A record', dcat: false })
  ];
  const projection = await artifact({ records });
  const html = renderDatasetHtml(projection.records[0]);
  assert.doesNotMatch(html, /data-profile="dcat-/u);
  assert.equal(projection.sitemap.kind, 'urlset');
  assert.deepEqual(sitemapLocations(projection.sitemap.current_xml), [
    'https://ushso.example/datasets/obs%3Aasset%3Aa-record',
    'https://ushso.example/datasets/obs%3Aasset%3Az-record'
  ]);
  assert.equal(projection.sitemap.url_count, projection.records.length);
});

test('structured data omits unsupported temporal, spatial, download, license, and DCAT claims', async () => {
  const sparse = record({
    id: 'obs:asset:sparse',
    dcat: false,
    distributions: [{
      kind: 'landing_page',
      name: 'Metadata landing page',
      format: 'HTML',
      media_type: 'text/html',
      access_url: 'https://data.cms.gov/provider-data/dataset/example',
      download_url: null,
      evidence_ids: ['evidence:distribution']
    }]
  });
  sparse.temporal_coverage = null;
  sparse.spatial_coverage = [];
  sparse.license_url = null;
  const projection = await artifact({ records: [sparse] });
  const html = renderDatasetHtml(projection.records[0]);
  const schema = jsonLd(html, 'schema-org-dataset');
  for (const field of ['temporalCoverage', 'spatialCoverage', 'distribution', 'license']) assert.equal(Object.hasOwn(schema, field), false, field);
  assert.doesNotMatch(html, /data-profile="dcat-/u);
});

test('identical publication inputs build byte-identical deterministic artifacts', async () => {
  const args = {
    publication: publication(),
    siteOrigin: 'https://ushso.example',
    projectedAt: '2026-08-30T00:00:00Z',
    records: [record({ id: 'obs:asset:b' }), record({ id: 'obs:asset:a' })]
  };
  const first = await buildSeoGenerationArtifact(args);
  const second = await buildSeoGenerationArtifact({ ...args, records: [...args.records].reverse() });
  const afterRollback = await buildSeoGenerationArtifact({ ...args, publication: publication({ pointerSequence: 99 }) });
  assert.equal(first.artifact_digest.value, second.artifact_digest.value);
  assert.equal(first.artifact_digest.value, afterRollback.artifact_digest.value);
  assert.deepEqual(first, second);
});
