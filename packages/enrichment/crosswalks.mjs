import { matchIdentifiers } from './identifier-systems.mjs';

export const CROSSWALK_POLICY_VERSION = 'ushso.crosswalks.v1';

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

export function registerCrosswalk(input = {}) {
  const required = ['crosswalk_id', 'publisher', 'release', 'rights', 'access_route', 'entity', 'from_system', 'to_system'];
  const missing = required.filter((field) => !input[field]);
  if (missing.length) fail('CROSSWALK_METADATA_INCOMPLETE', missing.join(','));
  if (input.task_entity && input.entity !== input.task_entity) fail('ENTITY_MISMATCH', `${input.entity}!=${input.task_entity}`);
  if (input.task_from_system && input.from_system !== input.task_from_system) fail('KEY_SYSTEM_MISMATCH', input.from_system);
  if (input.task_to_system && input.to_system !== input.task_to_system) fail('KEY_SYSTEM_MISMATCH', input.to_system);
  return freeze({
    format: 'ushso.crosswalk-source.v1',
    ...input,
    version: input.version ?? input.release,
    data_product: true,
    absent: false,
  });
}

export function absentCrosswalk({ task, entity, from_system, to_system } = {}) {
  return freeze({
    format: 'ushso.crosswalk-absence.v1',
    task,
    entity,
    from_system,
    to_system,
    absent: true,
    explicit: true,
  });
}

export function parseMappings(rows = [], { from_system, to_system } = {}) {
  const mappings = [];
  const unmatched = [];
  const byFrom = new Map();
  const byTo = new Map();
  for (const row of rows) {
    if (!row.from_id || !row.to_id) {
      unmatched.push(freeze({ ...row, reason: 'UNMATCHED_KEY' }));
      continue;
    }
    const mapping = freeze({
      from_system,
      to_system,
      from_id: String(row.from_id),
      to_id: String(row.to_id),
      valid_from: row.valid_from ?? null,
      valid_to: row.valid_to ?? null,
      source_native: true,
      heuristic_merge: false,
    });
    mappings.push(mapping);
    byFrom.set(mapping.from_id, [...(byFrom.get(mapping.from_id) ?? []), mapping]);
    byTo.set(mapping.to_id, [...(byTo.get(mapping.to_id) ?? []), mapping]);
  }
  const oneToMany = [...byFrom.values()].filter((group) => group.length > 1);
  const manyToOne = [...byTo.values()].filter((group) => group.length > 1);
  const manyToMany = oneToMany.length > 0 && manyToOne.length > 0;
  return freeze({
    mappings: freeze(mappings),
    unmatched: freeze(unmatched),
    one_to_many: oneToMany.length > 0,
    many_to_one: manyToOne.length > 0,
    many_to_many: manyToMany,
    date_scope_preserved: mappings.every((row) => 'valid_from' in row && 'valid_to' in row),
  });
}

export function collapsePreferred(parsed, { prefer } = {}) {
  if (parsed.many_to_many || parsed.one_to_many || parsed.many_to_one) {
    fail('AMBIGUOUS_MAPPING_NOT_COLLAPSED', prefer ?? 'preferred');
  }
  if (parsed.mappings.length !== 1) fail('AMBIGUOUS_MAPPING_NOT_COLLAPSED');
  return parsed.mappings[0];
}

export function createRouteCandidate(crosswalk, parsed, extras = {}) {
  if (!crosswalk || crosswalk.absent) fail('ABSENT_CROSSWALK');
  const cardinality = parsed.many_to_many ? 'many_to_many' : parsed.one_to_many ? 'one_to_many' : parsed.many_to_one ? 'many_to_one' : 'one_to_one';
  return freeze({
    format: 'ushso.join-route-candidate.v1',
    status: 'candidate',
    qualified: false,
    review_required: true,
    crosswalk_id: crosswalk.crosswalk_id,
    crosswalk_version: crosswalk.version,
    from_system: crosswalk.from_system,
    to_system: crosswalk.to_system,
    entity: crosswalk.entity,
    cardinality,
    universe: extras.universe ?? null,
    time_constraints: freeze(extras.time_constraints ?? []),
    transform: extras.transform ?? 'source_native',
    field_name_only: extras.field_name_only === true,
  });
}

export function routeFromSharedFieldName({ field_name } = {}) {
  fail('SHARED_FIELD_NAME_NOT_A_ROUTE', field_name);
}

export function qualifyRoute(candidate, { validated = false, reviewed = false } = {}) {
  if (candidate.status !== 'candidate') fail('NOT_A_CANDIDATE');
  if (!(validated && reviewed)) {
    return freeze({ ...candidate, status: 'candidate', qualified: false, review_required: true });
  }
  return freeze({ ...candidate, status: 'qualified', qualified: true, review_required: false });
}

export const SOURCES = Object.freeze({
  cms_nppes_ccn: registerCrosswalk({
    crosswalk_id: 'cms:nppes-ccn',
    publisher: 'CMS',
    release: '2024-01',
    version: '2024-01',
    rights: 'public domain US government work',
    access_route: 'https://download.cms.gov/nppes/NPI_Files.html',
    entity: 'medicare_provider',
    from_system: 'ccn',
    to_system: 'npi',
    task_entity: 'medicare_provider',
    task_from_system: 'ccn',
    task_to_system: 'npi',
  }),
  census_geoid_vintage: registerCrosswalk({
    crosswalk_id: 'census:geoid-vintage',
    publisher: 'Census Bureau',
    release: '2020-vintage',
    version: '2020',
    rights: 'public domain US government work',
    access_route: 'https://www.census.gov/geographies/reference-files.html',
    entity: 'geography',
    from_system: 'geoid',
    to_system: 'geoid',
    task_entity: 'geography',
    task_from_system: 'geoid',
    task_to_system: 'geoid',
  }),
});

export { matchIdentifiers };
