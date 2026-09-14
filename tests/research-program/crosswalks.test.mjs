import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SOURCES,
  absentCrosswalk,
  collapsePreferred,
  createRouteCandidate,
  parseMappings,
  qualifyRoute,
  registerCrosswalk,
  routeFromSharedFieldName,
} from '../../packages/enrichment/crosswalks.mjs';

test('each route’s intended entity and key system matches the research task; absence of a crosswalk is explicit', () => {
  assert.equal(SOURCES.cms_nppes_ccn.entity, 'medicare_provider');
  assert.equal(SOURCES.cms_nppes_ccn.from_system, 'ccn');
  assert.equal(SOURCES.cms_nppes_ccn.to_system, 'npi');
  assert.equal(SOURCES.cms_nppes_ccn.data_product, true);
  assert.throws(() => registerCrosswalk({
    crosswalk_id: 'bad',
    publisher: 'x',
    release: '1',
    rights: 'none',
    access_route: 'https://example.test',
    entity: 'person',
    from_system: 'ccn',
    to_system: 'npi',
    task_entity: 'medicare_provider',
    task_from_system: 'ccn',
    task_to_system: 'npi',
  }), { code: 'ENTITY_MISMATCH' });
  const absent = absentCrosswalk({ task: 'hcris-to-phc4', entity: 'facility', from_system: 'ccn', to_system: 'phc4_id' });
  assert.equal(absent.absent, true);
  assert.equal(absent.explicit, true);
});

test('a many-to-many or ambiguous mapping cannot collapse to one preferred row silently; unmatched keys and date scope are preserved', () => {
  const parsed = parseMappings([
    { from_id: '012345', to_id: '1111111111', valid_from: '2020-01-01', valid_to: '2021-01-01' },
    { from_id: '012345', to_id: '2222222222', valid_from: '2021-01-01', valid_to: null },
    { from_id: '999999', to_id: null },
  ], { from_system: 'ccn', to_system: 'npi' });
  assert.equal(parsed.one_to_many, true);
  assert.equal(parsed.unmatched.length, 1);
  assert.equal(parsed.date_scope_preserved, true);
  assert.equal(parsed.mappings.every((row) => row.source_native && row.heuristic_merge === false), true);
  assert.throws(() => collapsePreferred(parsed, { prefer: 'latest' }), { code: 'AMBIGUOUS_MAPPING_NOT_COLLAPSED' });
  const manyMany = parseMappings([
    { from_id: 'A', to_id: '1' },
    { from_id: 'A', to_id: '2' },
    { from_id: 'B', to_id: '1' },
  ], { from_system: 'ccn', to_system: 'npi' });
  assert.equal(manyMany.many_to_many, true);
  assert.throws(() => collapsePreferred(manyMany), { code: 'AMBIGUOUS_MAPPING_NOT_COLLAPSED' });
});

test('a candidate route remains candidate until scoped validation and review; a shared field name alone cannot produce a route', () => {
  const parsed = parseMappings([{ from_id: '012345', to_id: '1111111111' }], { from_system: 'ccn', to_system: 'npi' });
  const candidate = createRouteCandidate(SOURCES.cms_nppes_ccn, parsed, { universe: 'medicare_certified_hospitals' });
  assert.equal(candidate.status, 'candidate');
  assert.equal(candidate.qualified, false);
  const still = qualifyRoute(candidate, { validated: true, reviewed: false });
  assert.equal(still.status, 'candidate');
  const qualified = qualifyRoute(candidate, { validated: true, reviewed: true });
  assert.equal(qualified.qualified, true);
  assert.throws(() => routeFromSharedFieldName({ field_name: 'provider_id' }), { code: 'SHARED_FIELD_NAME_NOT_A_ROUTE' });
});
