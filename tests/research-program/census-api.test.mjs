import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ACSST1Y2023_ID,
  ACSST5Y2023_ID,
  BDSTIMESERIES_ID,
  PENNSYLVANIA_FIPS,
  bindCensusProducts,
  blockedFetch,
  buildCensusSampleRecipe,
  censusKeyFromSecretProvider,
  classifyCensusProduct,
  classifyKeylessCensusHtml,
  evidenceUrlWithoutKey,
  extractCensusDimensions,
  redactCensusQuery,
} from '../../packages/connectors/src/adapters/census-api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalogGz = path.join(root, 'verification/research-program/pr-015/fixtures/census-catalog-slim.json.gz');
const geoGz = path.join(root, 'verification/research-program/pr-015/fixtures/acs5-subject-geography.json.gz');
const varsGz = path.join(root, 'verification/research-program/pr-015/fixtures/acs5-subject-variables-slim.json.gz');
const censusHtml = path.join(root, 'tests/research-program/fixtures/pr009-census-negative/sample-census-acs.html');
const censusReceipt = path.join(root, 'tests/research-program/fixtures/pr009-census-negative/sample-census-acs.receipt.json');

async function loadJsonGz(file) {
  return JSON.parse(gunzipSync(await fs.readFile(file)).toString('utf8'));
}

function headers(contentType) {
  return new Headers({ 'content-type': contentType });
}

test('ACS five-year, ACS one-year and time-series stay distinct without vintage-as-period inference', async () => {
  const catalog = await loadJsonGz(catalogGz);
  const products = bindCensusProducts(catalog);
  const five = products.find((item) => item.identifier === ACSST5Y2023_ID);
  const one = products.find((item) => item.identifier === ACSST1Y2023_ID);
  const series = products.find((item) => item.identifier === BDSTIMESERIES_ID);
  assert.equal(five.product_kind, 'acs_five_year');
  assert.equal(one.product_kind, 'acs_one_year');
  assert.equal(series.product_kind, 'time_series');
  assert.notEqual(five.dataset.join('/'), one.dataset.join('/'));
  assert.equal(five.vintage.observation_period_inferred, false);
  assert.equal(one.vintage.observation_period_inferred, false);
  assert.equal(series.vintage.c_vintage, null);
  assert.equal(series.vintage.temporal, '1978/2023');
  assert.equal(classifyCensusProduct(five), 'acs_five_year');
});

test('variables, geography, groups and examples links bind to exact catalog entries', async () => {
  const catalog = await loadJsonGz(catalogGz);
  const five = bindCensusProducts(catalog).find((item) => item.identifier === ACSST5Y2023_ID);
  assert.equal(five.links.variables, 'https://api.census.gov/data/2023/acs/acs5/subject/variables.json');
  assert.equal(five.links.geography, 'https://api.census.gov/data/2023/acs/acs5/subject/geography.json');
  assert.equal(five.links.groups, 'https://api.census.gov/data/2023/acs/acs5/subject/groups.json');
  assert.equal(five.links.examples, 'https://api.census.gov/data/2023/acs/acs5/subject/examples.json');
  assert.match(five.links.documentation, /census\.gov/);
});

test('keyless HTML remains authentication-required and not JSON success', async () => {
  const html = await fs.readFile(censusHtml);
  const receipt = JSON.parse(await fs.readFile(censusReceipt, 'utf8'));
  const classified = classifyKeylessCensusHtml({
    headers: headers(receipt.observed_media_type),
    bodyBytes: html,
    receipt,
  });
  assert.equal(classified.accepted, false);
  assert.equal(classified.json_success, false);
  assert.equal(classified.authentication_required, true);
  assert.equal(classified.observed_role, 'error_html');
  assert.equal(classified.actionable_recipe, false);
});

test('offline tests run with no secret and missing keys stay a documented access step', () => {
  const missing = censusKeyFromSecretProvider(null);
  assert.equal(missing.present, false);
  assert.equal(missing.access_step, 'configure_census_secret_provider');
  const empty = censusKeyFromSecretProvider({ getSecret: () => null });
  assert.equal(empty.present, false);
  assert.equal(empty.access_step, 'obtain_census_api_key_from_secret_provider');
});

test('keyed recipe succeeds without placing the key in evidence URLs or unredacted logs', async () => {
  const [catalog, geography, variables] = await Promise.all([loadJsonGz(catalogGz), loadJsonGz(geoGz), loadJsonGz(varsGz)]);
  const five = bindCensusProducts(catalog).find((item) => item.identifier === ACSST5Y2023_ID);
  const dimensions = extractCensusDimensions({ variables, geography });
  const provider = { getSecret: () => 'fixture-census-key-not-for-publication' };
  const recipe = buildCensusSampleRecipe({
    product: five,
    dimensions,
    geographyName: 'state',
    geographyValue: PENNSYLVANIA_FIPS,
    variables: ['S0101_C01_001E'],
    secretProvider: provider,
  });
  assert.equal(recipe.emitted, true);
  assert.equal(recipe.geography.value, PENNSYLVANIA_FIPS);
  assert.doesNotMatch(recipe.evidence_url, /fixture-census-key|key=/i);
  assert.equal(recipe.query.key, '[REDACTED]');
  assert.equal(evidenceUrlWithoutKey('https://api.census.gov/data/2023/acs/acs5/subject?get=S0101_C01_001E&for=state:42&key=secret-value').includes('key='), false);
  assert.equal(recipe.log.event, 'census.sample_recipe');
  assert.equal(JSON.stringify(recipe.log).includes('fixture-census-key'), false);
  assert.equal(recipe.payload_success, false);
});

test('sample recipe is withheld until required inputs including the key are present', async () => {
  const [catalog, geography, variables] = await Promise.all([loadJsonGz(catalogGz), loadJsonGz(geoGz), loadJsonGz(varsGz)]);
  const five = bindCensusProducts(catalog).find((item) => item.identifier === ACSST5Y2023_ID);
  const dimensions = extractCensusDimensions({ variables, geography });
  const withheld = buildCensusSampleRecipe({
    product: five,
    dimensions,
    geographyName: 'state',
    geographyValue: PENNSYLVANIA_FIPS,
    variables: ['S0101_C01_001E'],
    secretProvider: { getSecret: () => null },
  });
  assert.equal(withheld.emitted, false);
  assert.ok(withheld.missing.includes('census_api_key'));
});

test('Pennsylvania aggregate uses supported geography predicates and does not treat labels as definitions', async () => {
  const [catalog, geography, variables] = await Promise.all([loadJsonGz(catalogGz), loadJsonGz(geoGz), loadJsonGz(varsGz)]);
  const five = bindCensusProducts(catalog).find((item) => item.identifier === ACSST5Y2023_ID);
  const dimensions = extractCensusDimensions({ variables, geography });
  assert.ok(dimensions.geography_levels.some((level) => level.name === 'state'));
  assert.ok(dimensions.geography_levels.some((level) => level.name === 'county' && level.requires.includes('state')));
  assert.ok(dimensions.predicates.some((item) => item.name === 'for' && item.predicate_only));
  assert.equal(dimensions.variables.every((item) => item.is_definition === false), true);
  const recipe = buildCensusSampleRecipe({
    product: five,
    dimensions,
    geographyName: 'state',
    geographyValue: PENNSYLVANIA_FIPS,
    variables: ['S0101_C01_001E'],
    secretProvider: { getSecret: () => 'fixture-census-key-not-for-publication' },
  });
  assert.equal(recipe.emitted, true);
  assert.deepEqual(recipe.access_conditions, [
    'census_api_key_via_secret_provider',
    'publisher_terms_unverified',
    'payload_authorization_unverified',
  ]);
  assert.equal(redactCensusQuery({ key: 'abc', get: 'S0101_C01_001E' }).key, '[REDACTED]');
});

test('live fetch is forbidden in the Census adapter path', async () => {
  await assert.rejects(() => blockedFetch('https://api.census.gov/data.json'), { code: 'CENSUS_API_LIVE_NETWORK_FORBIDDEN' });
});
