import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchIdentifiers } from './identifier-systems.mjs';

export const JOIN_EVIDENCE_POLICY_VERSION = 'ushso.join-evidence.v1';
export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export const R08_MINIMUM_QUALIFIED_ROUTES = 15;

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

export function loadJoinFixtures(file = defaultFixturePath()) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function defaultFixturePath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../../evaluation/research-program/joins/priority-routes.json');
}

export function detectJoinDefects(fixture, observed = {}) {
  const defects = [];
  if ((observed.output_rows ?? fixture.expected_outputs) > fixture.eligible_key_count) defects.push('ROW_MULTIPLICATION');
  if (observed.leading_zeros_lost === true) defects.push('LEADING_ZERO_LOSS');
  if ((observed.unmatched ?? fixture.nulls) > 0 && observed.sql_success === true && defects.length === 0) {
    defects.push('UNMATCHED_ROWS');
  }
  if (observed.sql_success === true && defects.length === 0 && observed.unmatched > 0) defects.push('UNMATCHED_ROWS');
  return freeze({
    route_id: fixture.route_id,
    sql_success_insufficient: true,
    defects: freeze(defects),
    valid_case: fixture.valid_case,
    incompatible_case: fixture.incompatible_case,
  });
}

export function scopedMetrics(fixture, { matched, unmatched, expansion, sampled = true } = {}) {
  const denominator = sampled ? fixture.sample_size : fixture.full_release_size;
  if (sampled === true && denominator < 50 && matched === denominator) fail('UNIVERSAL_MATCH_FROM_TINY_SAMPLE');
  const rate = denominator ? matched / denominator : null;
  return freeze({
    route_id: fixture.route_id,
    scope: sampled ? 'sampled' : 'full_release',
    matched,
    unmatched,
    denominator,
    match_rate: rate,
    universal_claim: false,
    expansion,
    evidence_hash: sha({ route: fixture.route_id, matched, unmatched, denominator, sampled }),
  });
}

export function blockIncompatible(fixture, context) {
  if (context?.temporal === fixture.incompatible_case.temporal || context?.universe === fixture.incompatible_case.universe) {
    return freeze({ blocked: true, reason: 'INCOMPATIBLE_CONTEXT', route_id: fixture.route_id });
  }
  return freeze({ blocked: false, route_id: fixture.route_id });
}

export function publishRoutes(fixtures, { qualifiedIds = [], machine = {}, ui = {} } = {}) {
  const routes = fixtures.routes.map((fixture) => freeze({
    ...fixture,
    qualified: qualifiedIds.includes(fixture.route_id),
    generation: LAST_GOOD_GENERATION,
    ccn_equals_npi: false,
    hops: fixture.route_id.includes('nppes') && fixture.route_id.includes('hcris') ? ['direct_candidate'] : ['direct'],
  }));
  const qualified = routes.filter((route) => route.qualified);
  if (qualified.length < R08_MINIMUM_QUALIFIED_ROUTES) {
    return freeze({
      r08_complete: false,
      reason: 'FEWER_THAN_FIFTEEN_QUALIFIED_ROUTES',
      qualified_count: qualified.length,
      routes: freeze(routes),
      machine: freeze({ ...machine }),
      ui: freeze({ ...ui }),
      identical_machine_ui: JSON.stringify(machine) === JSON.stringify(ui),
    });
  }
  return freeze({
    r08_complete: true,
    qualified_count: qualified.length,
    routes: freeze(routes),
    machine: freeze({ ...machine }),
    ui: freeze({ ...ui }),
    identical_machine_ui: JSON.stringify(machine) === JSON.stringify(ui),
  });
}

export function hcrisToNppesClaim({ ccn, npi } = {}) {
  const match = matchIdentifiers(
    { system: 'ccn', value: ccn },
    { system: 'npi', value: npi },
  );
  if (match.identity_established) fail('CCN_EQUALS_NPI_FORBIDDEN');
  return freeze({ claim: 'CCN=NPI', allowed: false, identity_established: false, reason: match.reason });
}
