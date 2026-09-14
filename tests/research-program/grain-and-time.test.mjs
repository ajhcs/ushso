import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIXTURES,
  bindDateRoles,
  checkGrainAndTime,
  defineResearchDimensions,
} from '../../packages/enrichment/grain-and-time.mjs';

test('HCRIS facility/report/year and PLACES county/measure/year cannot collapse into generic hospital/person tags', () => {
  const hcris = defineResearchDimensions(FIXTURES.hcris);
  const places = defineResearchDimensions(FIXTURES.places);
  assert.equal(hcris.dimensions.observation_grain.value, 'facility/report/year');
  assert.equal(places.dimensions.observation_grain.value, 'county/measure/year');
  assert.notEqual(hcris.dimensions.observation_grain.value, places.dimensions.observation_grain.value);
  assert.notEqual(hcris.dimensions.sampled_entity.value, places.dimensions.sampled_entity.value);
  assert.equal(hcris.inferred_tags_substituted, false);
  assert.throws(() => defineResearchDimensions({
    ...FIXTURES.hcris,
    observation_grain: { value: 'hospital', evidence_ids: ['ev:bad'] },
  }), { code: 'GENERIC_TAG_COLLAPSE' });
  assert.throws(() => defineResearchDimensions({
    ...FIXTURES.places,
    observation_grain: { value: 'county/measure/year', evidence_ids: ['ev:places:grain'] },
    sampled_entity: { value: 'hospital', evidence_ids: ['ev:bad'] },
  }), { code: 'PLACES_GRAIN_COLLAPSE' });
  assert.throws(() => defineResearchDimensions({
    ...FIXTURES.hcris,
    sampled_entity: { value: 'person', evidence_ids: ['ev:bad'] },
  }), { code: 'HCRIS_GRAIN_COLLAPSE' });
  const unknown = defineResearchDimensions({});
  assert.equal(unknown.dimensions.universe.state, 'unknown');
  assert.equal(unknown.dimensions.geographic_dimension.inferred, false);
});

test('metadata-modified cannot fill observation end; a 2100 projection is not observed future data; ACS overlap and rolling releases are preserved', () => {
  const dates = bindDateRoles({
    collection_period: { value: '2018-2022', overlapping: true, evidence_ids: ['ev:acs:period'], source_native: 'ACS 5-year estimates' },
    fiscal_year: { value: 'FY2022', evidence_ids: ['ev:hcris:fy'] },
    calendar_year: { value: '2022', evidence_ids: ['ev:places:cy'] },
    release: { value: '2023-08-01', rolling: true, evidence_ids: ['ev:places:release'] },
    revision: { value: '2023-09-15', evidence_ids: ['ev:rev'] },
    projection_horizon: { value: '2100-01-01', evidence_ids: ['ev:proj'] },
    metadata_modified: { value: '2024-01-02', evidence_ids: ['ev:mod'] },
  });
  assert.equal(dates.roles.observation_end.value, null);
  assert.equal(dates.roles.observation_end.blocked_fill, 'metadata_modified');
  assert.equal(dates.metadata_modified_fills_observation_end, false);
  assert.equal(dates.roles.projection_horizon.observed_future_data, false);
  assert.equal(dates.projection_is_observed_future, false);
  assert.equal(dates.overlapping_acs_preserved, true);
  assert.equal(dates.rolling_releases_preserved, true);
  assert.throws(() => bindDateRoles({
    observation_end: { value: '2022-12-31', inferred: true, evidence_ids: ['ev:x'] },
  }), { code: 'INFERRED_DATE_FORBIDDEN' });
});

test('incompatible reporting periods yield a specific caution/blocker; no automatic fiscal-to-calendar equivalence', () => {
  const dimensions = defineResearchDimensions(FIXTURES.hcris);
  const dates = bindDateRoles({
    fiscal_year: { value: 'FY2022', evidence_ids: ['ev:fy'] },
    calendar_year: { value: '2021', evidence_ids: ['ev:cy'] },
    metadata_modified: { value: '2024-01-02', evidence_ids: ['ev:mod'] },
    projection_horizon: { value: '2100', evidence_ids: ['ev:proj'] },
  });
  assert.throws(() => checkGrainAndTime({ dimensions, dates, equateFiscalToCalendar: true }), { code: 'FISCAL_CALENDAR_EQUIVALENCE_FORBIDDEN' });
  const checked = checkGrainAndTime({ dimensions, dates });
  assert.equal(checked.ok, false);
  assert.equal(checked.fiscal_calendar_equivalence, false);
  assert.ok(checked.blockers.some((row) => row.code === 'INCOMPATIBLE_REPORTING_PERIODS'));
  assert.ok(checked.cautions.some((row) => row.code === 'INCOMPATIBLE_REPORTING_PERIODS'));
  assert.ok(checked.blockers.some((row) => row.code === 'METADATA_MODIFIED_NOT_OBSERVATION_END'));
  assert.ok(checked.source_native_terms.some((row) => row.source_native && row.normalized));
  assert.equal(checked.inferred_tags_substituted, false);
  assert.equal(checked.review_required, true);
});
