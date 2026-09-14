import { classifyResponse, classifyResourceRole } from '../content-classifier.mjs';

function redactCensusLog(event) {
  const output = {
    level: event.level,
    event: event.event,
    timestamp: event.timestamp,
    source_id: event.source_id,
    safe_detail_code: event.safe_detail_code,
  };
  return Object.freeze(output);
}

export const CENSUS_SOURCE_ID = 'census-api';
export const ACSST5Y2023_ID = 'https://api.census.gov/data/id/ACSST5Y2023';
export const ACSST1Y2023_ID = 'https://api.census.gov/data/id/ACSST1Y2023';
export const BDSTIMESERIES_ID = 'https://api.census.gov/data/id/BDSTIMESERIES';
export const PENNSYLVANIA_FIPS = '42';
export const CENSUS_KEY_QUERY_NAME = 'key';

const HTTPS_HOST = 'api.census.gov';

export async function blockedFetch() {
  const error = new Error('CENSUS_API_LIVE_NETWORK_FORBIDDEN');
  error.code = 'CENSUS_API_LIVE_NETWORK_FORBIDDEN';
  throw error;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function httpsUrl(value) {
  if (!text(value)) return null;
  try {
    const url = new URL(value.replace(/^http:/, 'https:'));
    if (url.hostname !== HTTPS_HOST) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function classifyCensusProduct(row = {}) {
  const dataset = Array.isArray(row.c_dataset)
    ? row.c_dataset.map((item) => String(item).toLowerCase())
    : (Array.isArray(row.dataset) ? row.dataset.map((item) => String(item).toLowerCase()) : []);
  if (row.c_isTimeseries === true || row.timeseries === true || dataset[0] === 'timeseries') return 'time_series';
  if (row.product_kind === 'acs_five_year' || dataset.includes('acs5')) return 'acs_five_year';
  if (row.product_kind === 'acs_one_year' || dataset.includes('acs1')) return 'acs_one_year';
  if (row.c_isAggregate === true || row.aggregate === true) return 'aggregate';
  return 'unclassified';
}

export function vintageIsNotObservationPeriod(row) {
  return Object.freeze({
    c_vintage: row?.c_vintage ?? null,
    temporal: row?.temporal ?? null,
    observation_period_inferred: false,
    note: 'publisher-labelled catalog field; vintage/modified are not observation/release dates',
  });
}

export function bindCensusCatalogLinks(row) {
  const links = {
    variables: httpsUrl(row.c_variablesLink),
    geography: httpsUrl(row.c_geographyLink),
    groups: httpsUrl(row.c_groupsLink),
    examples: httpsUrl(row.c_examplesLink),
    documentation: text(row.c_documentationLink),
  };
  return Object.freeze({
    identifier: row.identifier,
    title: row.title ?? null,
    product_kind: classifyCensusProduct(row),
    aggregate: row.c_isAggregate === true,
    timeseries: row.c_isTimeseries === true,
    dataset: Object.freeze(Array.isArray(row.c_dataset) ? [...row.c_dataset] : []),
    vintage: vintageIsNotObservationPeriod(row),
    links,
    payload_success: false,
    publication_authorized: false,
  });
}

export function extractCensusDimensions({ variables = {}, geography = [] } = {}) {
  const entries = variables.variables ?? variables;
  const predicates = [];
  const labels = [];
  if (entries && typeof entries === 'object') {
    for (const [name, spec] of Object.entries(entries)) {
      if (!spec || typeof spec !== 'object') continue;
      const item = Object.freeze({
        name,
        label: spec.label ?? null,
        concept: spec.concept ?? null,
        predicate_type: spec.predicateType ?? null,
        predicate_only: spec.predicateOnly === true,
        required: spec.required === true,
        is_definition: false,
      });
      if (item.predicate_only) predicates.push(item);
      else labels.push(item);
    }
  }
  const levels = Array.isArray(geography.fips) ? geography.fips : (Array.isArray(geography) ? geography : []);
  return Object.freeze({
    predicates: Object.freeze(predicates),
    variables: Object.freeze(labels),
    geography_levels: Object.freeze(levels.map((level) => Object.freeze({
      name: level.name,
      geo_level_display: level.geoLevelDisplay ?? null,
      requires: Object.freeze(Array.isArray(level.requires) ? [...level.requires] : []),
      wildcard: Object.freeze(Array.isArray(level.wildcard) ? [...level.wildcard] : []),
    }))),
  });
}

export function censusKeyFromSecretProvider(secretProvider, { sourceId = CENSUS_SOURCE_ID } = {}) {
  if (!secretProvider || typeof secretProvider.getSecret !== 'function') {
    return Object.freeze({ present: false, reason: 'SECRET_PROVIDER_MISSING', access_step: 'configure_census_secret_provider' });
  }
  const value = secretProvider.getSecret({ sourceId, name: 'census_api_key' });
  if (typeof value !== 'string' || value.length === 0) {
    return Object.freeze({ present: false, reason: 'CENSUS_KEY_MISSING', access_step: 'obtain_census_api_key_from_secret_provider' });
  }
  return Object.freeze({ present: true, handle: 'secret://census_api_key', value: null });
}

export function redactCensusQuery(query = {}) {
  const redacted = { ...query };
  if (CENSUS_KEY_QUERY_NAME in redacted) redacted[CENSUS_KEY_QUERY_NAME] = '[REDACTED]';
  return Object.freeze(redacted);
}

export function evidenceUrlWithoutKey(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete(CENSUS_KEY_QUERY_NAME);
  parsed.username = '';
  parsed.password = '';
  return parsed.toString();
}

export function buildCensusSampleRecipe({ product, dimensions, geographyName, geographyValue, variables, secretProvider, now = null }) {
  const required = [];
  if (!product?.links?.variables) required.push('variables_link');
  if (!product?.links?.geography) required.push('geography_link');
  const level = dimensions.geography_levels.find((item) => item.name === geographyName);
  if (!level) required.push('supported_geography');
  if (level?.requires?.length) {
    for (const need of level.requires) {
      if (need === 'state' && geographyName === 'state') continue;
      if (!geographyValue && need === geographyName) required.push(need);
    }
  }
  if (!Array.isArray(variables) || variables.length === 0) required.push('variables');
  const key = censusKeyFromSecretProvider(secretProvider);
  if (!key.present) required.push('census_api_key');
  if (required.length) {
    return Object.freeze({
      emitted: false,
      missing: Object.freeze(required),
      access_step: key.present ? 'satisfy_documented_query_inputs' : key.access_step,
      payload_success: false,
    });
  }
  const get = new URL(product.links.variables.replace(/variables\.json$/, ''));
  get.searchParams.set('get', variables.join(','));
  get.searchParams.set('for', `${geographyName}:${geographyValue}`);
  get.searchParams.set(CENSUS_KEY_QUERY_NAME, 'secret://census_api_key');
  const evidence = evidenceUrlWithoutKey(get.toString());
  const log = redactCensusLog({
    level: 'info',
    event: 'census.sample_recipe',
    timestamp: now ?? '2026-09-14T00:00:00.000Z',
    source_id: CENSUS_SOURCE_ID,
    safe_detail_code: 'CENSUS_SAMPLE_RECIPE',
  });
  return Object.freeze({
    emitted: true,
    product_kind: product.product_kind,
    geography: Object.freeze({ name: geographyName, value: geographyValue }),
    variables: Object.freeze([...variables]),
    access_conditions: Object.freeze(['census_api_key_via_secret_provider', 'publisher_terms_unverified', 'payload_authorization_unverified']),
    evidence_url: evidence,
    query: redactCensusQuery({ get: variables.join(','), for: `${geographyName}:${geographyValue}`, key: 'secret://census_api_key' }),
    log,
    payload_success: false,
    publication_authorized: false,
  });
}

export function classifyKeylessCensusHtml({ headers, bodyBytes, receipt }) {
  const classified = classifyResponse({
    purpose: 'catalog_metadata',
    expectedContentClasses: ['catalog_collection', 'catalog_item_record'],
    headers,
    bodyBytes,
  });
  const role = classifyResourceRole({
    requestedUrl: 'https://api.census.gov/data/acs',
    finalUrl: receipt?.safe_final_host ? `https://${receipt.safe_final_host}${receipt.safe_final_path}` : null,
    expectedRole: 'catalog_metadata',
    observedTitle: 'Missing Key',
    mediaType: receipt?.observed_media_type ?? 'text/html',
    status: receipt?.observed_status ?? 200,
    redirectCount: receipt?.redirect_count ?? null,
    purpose: 'catalog_metadata',
  });
  return Object.freeze({
    accepted: classified.accepted,
    json_success: false,
    authentication_required: true,
    observed_role: role.observed_role,
    reason_code: classified.reasonCode,
    actionable_recipe: role.actionable_recipe,
  });
}

export function bindCensusProducts(catalog) {
  const rows = catalog?.dataset ?? [];
  return Object.freeze(rows.map((row) => bindCensusCatalogLinks(row)));
}
