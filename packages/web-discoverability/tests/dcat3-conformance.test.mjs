import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderDatasetHtml } from '../src/index.mjs';
import { artifact, record } from './fixtures.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(packageRoot, 'conformance', 'dcat3-dataset.v1.0.0.json');

function jsonLd(html, profile) {
  const expression = new RegExp(`<script type="application/ld\\+json" data-profile="${profile}">([\\s\\S]*?)<\\/script>`, 'u');
  const match = expression.exec(html);
  assert.ok(match, `missing independently expected ${profile} JSON-LD`);
  return JSON.parse(match[1]);
}

test('rendered DCAT 3 JSON-LD matches the offline hand-authored normative fixture', async () => {
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  assert.equal(fixture.fixture_origin, 'hand-authored normative expectations; not generated from USHSO implementation output');
  assert.equal(fixture.specification.status, 'W3C Recommendation');
  assert.equal(fixture.specification.immutable_url, 'https://www.w3.org/TR/2024/REC-vocab-dcat-3-20240822/');
  assert.equal(fixture.specification.dcat_namespace, 'http://www.w3.org/ns/dcat#');
  assert.ok(fixture.specification.normative_requirements.length >= 5);

  const projection = await artifact({
    records: [record({
      id: fixture.input.public_id,
      title: fixture.input.title,
      description: fixture.input.description,
      dcatProfile: fixture.input.profile
    })]
  });
  const actual = jsonLd(renderDatasetHtml(projection.records[0]), 'dcat-3');
  assert.deepEqual(actual, fixture.expected_jsonld);
  assert.equal(actual['@context'].dcat, fixture.specification.dcat_namespace);
  assert.equal(actual['@type'], 'dcat:Dataset');
  assert.equal(actual['dct:conformsTo']['@id'], fixture.specification.immutable_url);
  assert.equal(actual['dcat:distribution'][0]['@type'], 'dcat:Distribution');
  assert.equal(actual['dcat:distribution'][0]['dcat:accessURL']['@id'], 'https://data.cms.gov/provider-data/dataset/example');
  assert.equal(actual['dcat:distribution'][0]['dcat:downloadURL']['@id'], 'https://data.cms.gov/files/example.csv');
  assert.deepEqual(actual['dct:temporal']['dcat:startDate'], { '@value': '2020-01-01', '@type': 'xsd:date' });
  assert.deepEqual(actual['dct:temporal']['dcat:endDate'], { '@value': '2025-12-31', '@type': 'xsd:date' });
});
