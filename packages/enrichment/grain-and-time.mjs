import { createHash } from 'node:crypto';

export const GRAIN_POLICY_VERSION = 'ushso.grain-and-time.v1';
export const UNKNOWN = Object.freeze({ state: 'unknown', value: null, inferred: false });

const DIMENSIONS = Object.freeze(['observation_grain', 'sampled_entity', 'reporting_organization', 'universe', 'geographic_dimension']);
const DATE_ROLES = Object.freeze(['collection_period', 'fiscal_year', 'calendar_year', 'release', 'revision', 'projection_horizon', 'observation_end', 'metadata_modified']);

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function sha(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function requireEvidence(item, label) {
  if (!item) return UNKNOWN;
  if (item.state === 'unknown' || item.value == null) {
    return freeze({ state: 'unknown', value: null, inferred: false, source_native: item.source_native ?? null, evidence_ids: freeze([...(item.evidence_ids ?? [])]) });
  }
  if (!Array.isArray(item.evidence_ids) || item.evidence_ids.length === 0) fail('DIMENSION_EVIDENCE_REQUIRED', label);
  if (item.inferred === true) fail('INFERRED_GRAIN_FORBIDDEN', label);
  return freeze({
    state: 'evidenced',
    value: item.value,
    inferred: false,
    source_native: item.source_native ?? null,
    evidence_ids: freeze([...item.evidence_ids]),
  });
}

export function defineResearchDimensions(input = {}) {
  const dimensions = {};
  for (const name of DIMENSIONS) {
    dimensions[name] = requireEvidence(input[name], name);
  }
  const values = DIMENSIONS.map((name) => dimensions[name].value).filter(Boolean);
  if (values.includes('hospital') && values.includes('person')) fail('GENERIC_TAG_COLLAPSE');
  const grain = dimensions.observation_grain.value;
  const sampled = dimensions.sampled_entity.value;
  const geo = dimensions.geographic_dimension.value;
  if (grain === 'facility/report/year' && sampled === 'person') fail('HCRIS_GRAIN_COLLAPSE');
  if (grain === 'county/measure/year' && sampled === 'hospital') fail('PLACES_GRAIN_COLLAPSE');
  if (grain === 'hospital' || grain === 'person') fail('GENERIC_TAG_COLLAPSE');
  return freeze({
    format: 'ushso.research-dimensions.v1',
    policy_version: GRAIN_POLICY_VERSION,
    dimensions: freeze(dimensions),
    source_native_terms: freeze(DIMENSIONS.map((name) => ({
      dimension: name,
      source_native: dimensions[name].source_native,
      normalized: dimensions[name].value,
    }))),
    inferred_tags_substituted: false,
    checksum: sha(dimensions),
  });
}

export function bindDateRoles(input = {}) {
  const roles = {};
  for (const name of DATE_ROLES) {
    const item = input[name];
    if (!item || item.value == null) {
      roles[name] = freeze({ state: 'unknown', value: null, inferred: false, evidence_ids: freeze([]) });
      continue;
    }
    if (!Array.isArray(item.evidence_ids) || item.evidence_ids.length === 0) fail('DATE_EVIDENCE_REQUIRED', name);
    if (item.inferred === true) fail('INFERRED_DATE_FORBIDDEN', name);
    roles[name] = freeze({
      state: 'evidenced',
      value: item.value,
      kind: item.kind ?? name,
      inferred: false,
      overlapping: item.overlapping === true,
      rolling: item.rolling === true,
      evidence_ids: freeze([...item.evidence_ids]),
      source_native: item.source_native ?? null,
    });
  }
  if (!roles.observation_end.value && roles.metadata_modified.value) {
    // A metadata-modified date cannot fill observation end.
    roles.observation_end = freeze({ ...roles.observation_end, blocked_fill: 'metadata_modified', code: 'METADATA_MODIFIED_NOT_OBSERVATION_END' });
  }
  if (roles.projection_horizon.value) {
    const year = Number(String(roles.projection_horizon.value).slice(0, 4));
    if (Number.isFinite(year) && year >= 2100) {
      roles.projection_horizon = freeze({
        ...roles.projection_horizon,
        observed_future_data: false,
        code: 'PROJECTION_NOT_OBSERVED_FUTURE',
      });
    }
  }
  return freeze({
    format: 'ushso.date-roles.v1',
    policy_version: GRAIN_POLICY_VERSION,
    roles: freeze(roles),
    overlapping_acs_preserved: roles.collection_period.overlapping === true,
    rolling_releases_preserved: roles.release.rolling === true,
    metadata_modified_fills_observation_end: false,
    projection_is_observed_future: false,
  });
}

export function checkGrainAndTime({ dimensions, dates, equateFiscalToCalendar = false } = {}) {
  if (equateFiscalToCalendar === true) fail('FISCAL_CALENDAR_EQUIVALENCE_FORBIDDEN');
  const cautions = [];
  const blockers = [];
  const grain = dimensions?.dimensions ?? dimensions;
  const roles = dates?.roles ?? dates ?? {};
  const fiscal = roles.fiscal_year?.value;
  const calendar = roles.calendar_year?.value;
  if (fiscal && calendar && fiscal !== calendar) {
    const caution = freeze({
      code: 'INCOMPATIBLE_REPORTING_PERIODS',
      kind: 'blocker',
      fiscal_year: fiscal,
      calendar_year: calendar,
      automatic_equivalence: false,
      detail: 'Fiscal year and calendar year are both evidenced and disagree. They are not equivalent.',
    });
    cautions.push(caution);
    blockers.push(caution);
  }
  if (roles.observation_end?.blocked_fill === 'metadata_modified') {
    blockers.push(freeze({ code: 'METADATA_MODIFIED_NOT_OBSERVATION_END', kind: 'blocker' }));
  }
  if (roles.projection_horizon?.observed_future_data === false) {
    cautions.push(freeze({ code: 'PROJECTION_NOT_OBSERVED_FUTURE', kind: 'caution' }));
  }
  const grainValue = grain?.observation_grain?.value;
  const sampled = grain?.sampled_entity?.value;
  if (grainValue === 'facility/report/year' && sampled && sampled !== 'hospital_facility' && sampled !== 'provider_facility') {
    blockers.push(freeze({ code: 'HCRIS_GRAIN_COLLAPSE', kind: 'blocker' }));
  }
  if (grainValue === 'county/measure/year' && sampled && sampled !== 'county_population' && sampled !== 'county') {
    blockers.push(freeze({ code: 'PLACES_GRAIN_COLLAPSE', kind: 'blocker' }));
  }
  return freeze({
    format: 'ushso.grain-time-check.v1',
    ok: blockers.length === 0,
    cautions: freeze(cautions),
    blockers: freeze(blockers),
    source_native_terms: dimensions?.source_native_terms ?? freeze([]),
    inferred_tags_substituted: false,
    fiscal_calendar_equivalence: false,
    review_required: blockers.length > 0,
  });
}

export const FIXTURES = Object.freeze({
  hcris: {
    observation_grain: { value: 'facility/report/year', source_native: 'CMS cost report / CCN / fiscal year', evidence_ids: ['ev:hcris:grain'] },
    sampled_entity: { value: 'hospital_facility', source_native: 'Medicare-certified hospital / CCN', evidence_ids: ['ev:hcris:entity'] },
    reporting_organization: { value: 'cms', source_native: 'Centers for Medicare & Medicaid Services', evidence_ids: ['ev:hcris:org'] },
    universe: { value: 'medicare_certified_hospitals', source_native: 'HCRIS hospital cost reports', evidence_ids: ['ev:hcris:universe'] },
    geographic_dimension: { value: 'provider_location', source_native: 'provider state / CCN geography', evidence_ids: ['ev:hcris:geo'] },
  },
  places: {
    observation_grain: { value: 'county/measure/year', source_native: 'PLACES county measure year', evidence_ids: ['ev:places:grain'] },
    sampled_entity: { value: 'county_population', source_native: 'county adult population', evidence_ids: ['ev:places:entity'] },
    reporting_organization: { value: 'cdc', source_native: 'CDC PLACES', evidence_ids: ['ev:places:org'] },
    universe: { value: 'us_counties', source_native: 'county estimates', evidence_ids: ['ev:places:universe'] },
    geographic_dimension: { value: 'county', source_native: 'county FIPS', evidence_ids: ['ev:places:geo'] },
  },
});
