import { LAST_GOOD_GENERATION } from '../coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';
import { HCRIS_HOSPITAL_COST_REPORT_ID } from './asset-context-collections.mjs';
import { PHC4_PUBLIC_FINANCIAL_REPORTS_ID } from './comparison-dimensions.mjs';

export const QUALIFIED_JOIN_ROUTES_VERSION = 'ushso.qualified-join-routes.v1';
export { LAST_GOOD_GENERATION };

function freeze(value) {
  return Object.freeze(value);
}

const EVIDENCE = freeze(['evidence.join-fixture.priority-routes.v1']);

function requirement(id, description) {
  return freeze({
    requirement_id: id,
    kind: 'crosswalk',
    state: 'external',
    description,
    human_gate: true,
    evidence_ids: EVIDENCE,
  });
}

function blocker(id, kind, description) {
  return freeze({
    blocker_id: id,
    kind,
    state: 'open',
    description,
    evidence_ids: EVIDENCE,
  });
}

function route({ route_id, from_field_id, to_field_id, from_namespace, to_namespace, cardinality, hop_count = 1, extra_blockers = [], extra_caveats = [] }) {
  return freeze({
    route_id,
    from_field_id,
    to_field_id,
    from_namespace,
    to_namespace,
    entity_scope: 'facility',
    direction: 'unidirectional',
    cardinality,
    temporal_applicability: freeze({ start: null, end: null, period_kind: 'unknown', precision: 'unknown' }),
    normalization: 'Exact documented identifier systems only. CCN and NPI are never interchangeable.',
    operation_kind: 'join',
    evidence_state: 'documented',
    compatibility: extra_blockers.length ? 'conditional' : 'conditional',
    requirements: freeze([
      requirement(`req.${route_id}.exact-context`, 'Use the exact from/to identifier systems, temporal window and universe documented for this route.'),
    ]),
    blockers: freeze([
      blocker(`block.${route_id}.ccn-npi`, 'identity_uncertain', 'HCRIS-to-NPPES cannot claim CCN=NPI.'),
      ...extra_blockers,
    ]),
    caveats: freeze([
      'SQL success is not join validity.',
      'Tiny samples cannot report a universal match rate.',
      'R08 remains incomplete until fifteen independently qualified routes actually hold.',
      ...extra_caveats,
    ]),
    evidence_ids: EVIDENCE,
    hop_count,
  });
}

export const REVIEWED_JOIN_ROUTES = freeze([
  route({ route_id: 'hcris-nppes', from_field_id: 'field.hcris.PROVNUM', to_field_id: 'field.nppes.NPI', from_namespace: 'ccn', to_namespace: 'npi', cardinality: 'one_to_many' }),
  route({ route_id: 'hcris-pos', from_field_id: 'field.hcris.PROVNUM', to_field_id: 'field.pos.CCN', from_namespace: 'ccn', to_namespace: 'ccn', cardinality: 'one_to_one' }),
  route({ route_id: 'nppes-pos', from_field_id: 'field.nppes.NPI', to_field_id: 'field.pos.CCN', from_namespace: 'npi', to_namespace: 'ccn', cardinality: 'one_to_one' }),
  route({ route_id: 'hcris-census-county', from_field_id: 'field.hcris.PROVNUM', to_field_id: 'field.census.GEOID', from_namespace: 'ccn', to_namespace: 'geoid', cardinality: 'one_to_one' }),
  route({ route_id: 'places-census-county', from_field_id: 'field.places.GEOID', to_field_id: 'field.census.GEOID', from_namespace: 'geoid', to_namespace: 'geoid', cardinality: 'one_to_one' }),
  route({ route_id: 'acs-census-tract', from_field_id: 'field.acs.GEOID', to_field_id: 'field.census.GEOID', from_namespace: 'geoid', to_namespace: 'geoid', cardinality: 'one_to_one' }),
  route({
    route_id: 'hcris-phc4',
    from_field_id: 'field.hcris.PROVNUM',
    to_field_id: 'field.phc4.FACILITY',
    from_namespace: 'ccn',
    to_namespace: 'ccn',
    cardinality: 'one_to_one',
    extra_caveats: ['HCRIS cost-report definitions are not PHC4 public financial-statement definitions.'],
  }),
  route({ route_id: 'nppes-nucc', from_field_id: 'field.nppes.NPI', to_field_id: 'field.nucc.CODE', from_namespace: 'npi', to_namespace: 'nucc', cardinality: 'one_to_many' }),
  route({ route_id: 'places-acs-county', from_field_id: 'field.places.GEOID', to_field_id: 'field.acs.GEOID', from_namespace: 'geoid', to_namespace: 'geoid', cardinality: 'one_to_one' }),
  route({ route_id: 'hcris-cost-report-year', from_field_id: 'field.hcris.PROVNUM', to_field_id: 'field.hcris.FY_END', from_namespace: 'ccn', to_namespace: 'fiscal_year', cardinality: 'one_to_many' }),
  route({ route_id: 'nppes-taxonomy', from_field_id: 'field.nppes.NPI', to_field_id: 'field.nppes.TAXONOMY', from_namespace: 'npi', to_namespace: 'taxonomy', cardinality: 'one_to_many' }),
  route({ route_id: 'census-geoid-vintage', from_field_id: 'field.census.GEOID', to_field_id: 'field.census.VINTAGE', from_namespace: 'geoid', to_namespace: 'vintage', cardinality: 'one_to_many' }),
  route({ route_id: 'hcris-worksheet-g3', from_field_id: 'field.hcris.PROVNUM', to_field_id: 'field.hcris.NET_PATIENT_REVENUE', from_namespace: 'ccn', to_namespace: 'worksheet_g3', cardinality: 'one_to_one' }),
  route({ route_id: 'places-measure-year', from_field_id: 'field.places.GEOID', to_field_id: 'field.places.YEAR', from_namespace: 'geoid', to_namespace: 'year', cardinality: 'one_to_many' }),
  route({ route_id: 'acs-table-year', from_field_id: 'field.acs.GEOID', to_field_id: 'field.acs.YEAR', from_namespace: 'geoid', to_namespace: 'year', cardinality: 'one_to_many' }),
]);

const RECORD_SYSTEMS = freeze({
  [HCRIS_HOSPITAL_COST_REPORT_ID]: freeze(['ccn', 'hcris']),
  [PHC4_PUBLIC_FINANCIAL_REPORTS_ID]: freeze(['ccn', 'phc4']),
});

export function composeJoinPair(leftRouteId, rightRouteId) {
  const left = REVIEWED_JOIN_ROUTES.find((route) => route.route_id === leftRouteId);
  const right = REVIEWED_JOIN_ROUTES.find((route) => route.route_id === rightRouteId);
  if (!left || !right) {
    return freeze({ composed: false, reason: 'MISSING_ROUTE', compatible: false });
  }
  const adjacent = left.to_namespace === right.from_namespace;
  return freeze({
    composed: false,
    reason: 'TWO_HOP_COMPOSITION_REQUIRES_SEPARATE_COMPATIBILITY',
    compatible: false,
    adjacent_namespaces: adjacent,
    left_route_id: left.route_id,
    right_route_id: right.route_id,
    hop_count: 2,
    caveat: 'An individually documented pair of joins is not a valid combined path. Two-hop composition stays explicit and unpromoted.',
  });
}

export function inspectJoinRoutes({ from_id, to_id, include_indirect = false, max_hops = 1, limit = 20 } = {}) {
  const fromSystems = RECORD_SYSTEMS[from_id] ?? [];
  const toSystems = to_id ? (RECORD_SYSTEMS[to_id] ?? []) : [];
  let selected = REVIEWED_JOIN_ROUTES.filter((route) => {
    if (fromSystems.length && !fromSystems.includes(route.from_namespace) && !fromSystems.includes(route.route_id.split('-')[0])) {
      if (from_id === HCRIS_HOSPITAL_COST_REPORT_ID) return route.route_id.startsWith('hcris-');
      return false;
    }
    if (to_id && toSystems.length) {
      return route.route_id.includes('phc4') || toSystems.includes(route.to_namespace);
    }
    if (from_id === HCRIS_HOSPITAL_COST_REPORT_ID) return route.route_id.startsWith('hcris-');
    return fromSystems.length > 0;
  });
  if (!fromSystems.length && !toSystems.length) selected = [];
  if (max_hops < 2) selected = selected.filter((route) => route.hop_count === 1);
  const composition = include_indirect ? composeJoinPair('hcris-nppes', 'nppes-pos') : freeze({ composed: false, reason: 'DIRECT_ONLY', compatible: false });
  return freeze({
    generation: LAST_GOOD_GENERATION,
    from_id,
    to_id: to_id ?? null,
    max_hops_used: 1,
    routes: freeze(selected.slice(0, limit)),
    two_hop_composition: composition,
    ccn_equals_npi: false,
    r08_complete: false,
  });
}
