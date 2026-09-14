import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAST_GOOD_GENERATION } from '../../packages/coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';
import { HOSPITAL_DENOMINATOR, loadFrozenHospitalIds } from '../../packages/connectors/mrf/hospital-registry.mjs';
import { PAYER_DENOMINATOR, FROZEN_PAYER_IDS, loadFrozenPayerIds } from '../../packages/connectors/mrf/payer-index.mjs';
import { buildExamplePacket, LAST_GOOD_GENERATION as PACKET_GENERATION } from '../../packages/enrichment/example-packet.mjs';
import { createExampleReceipt } from '../../packages/connectors/src/testing/example-runner.mjs';

export const QUALIFY_MRF_FORMAT = 'ushso.mrf-pilot-qualification.v1';
export const HOSPITAL_PARSED_SAMPLE_TARGET = 20;
export const PAYER_PARSED_SAMPLE_TARGET = 8;
export const EXPANSION_FAMILY_COUNT = 12;
export { LAST_GOOD_GENERATION, HOSPITAL_DENOMINATOR, PAYER_DENOMINATOR, FROZEN_PAYER_IDS, PACKET_GENERATION };

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function defaultCohortPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../../evaluation/research-program/cohorts.json');
}

export function loadCohort(file = defaultCohortPath()) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function refuseSelfApproval({ actor, role, approved } = {}) {
  if (approved === true && (role === 'implementer' || role === 'model' || actor === 'implementer' || actor === 'model')) {
    fail('IMPLEMENTER_CANNOT_APPROVE_OWN_SCIENTIFIC_OUTPUT');
  }
  return freeze({ scientific_approval: false, actor: actor ?? null, role: role ?? null });
}

export function refuseUnknownCellAsSupported(cell) {
  if ((cell?.status === 'unknown' || cell?.locator == null || cell?.locator_materialized === false) && cell?.supported === true) {
    fail('UNKNOWN_CELL_CANNOT_COUNT_AS_SUPPORTED');
  }
  return freeze({ supported: false, unknown: true });
}

export function refuseCohortReplacement(frozenIds, observedIds) {
  const frozen = [...frozenIds];
  const observed = [...observedIds];
  if (observed.length !== new Set(observed).size) fail('SILENT_DEDUPLICATION_FORBIDDEN');
  const missing = frozen.filter((id) => !observed.includes(id));
  if (missing.length) fail('DIFFICULT_COHORT_MEMBER_REPLACED_OR_DROPPED', missing.join(','));
  const extra = observed.filter((id) => !frozen.includes(id));
  if (extra.length) fail('COHORT_REPLACEMENT_FORBIDDEN', extra.join(','));
  return freeze({ denominator: frozen.length, replacement: false });
}

export function classifyDisposition(row = {}) {
  const locatorMaterialized = row.locator_materialized === true && Boolean(row.locator);
  const parsed = row.bounded_parsed_sample === true && locatorMaterialized;
  const unknown = !locatorMaterialized;
  if (unknown && row.supported === true) fail('UNKNOWN_CELL_CANNOT_COUNT_AS_SUPPORTED');
  return freeze({
    candidate_id: row.candidate_id,
    outcome: unknown ? (row.outcome ?? 'unresolved_locator') : row.outcome,
    locator: row.locator ?? null,
    locator_materialized: locatorMaterialized,
    bounded_parsed_sample: parsed,
    supported: parsed,
    unknown,
    fictional_example: row.fictional_example === true,
    blocker: unknown || row.outcome === 'failed' || row.outcome === 'inaccessible_bulk_file',
    follow_up: unknown || row.outcome === 'failed' || row.outcome === 'inaccessible_bulk_file'
      ? freeze({ id: `follow-up:${row.candidate_id}`, kind: 'bounded_locator_materialization', replacement_allowed: false })
      : null,
  });
}

export function reconcilePilot(cohorts, { hospitalDispositions = [], payerDispositions = [], actor = 'implementer' } = {}) {
  refuseSelfApproval({ actor, role: 'implementer', approved: false });
  const hospitalIds = loadFrozenHospitalIds(cohorts);
  const payerIds = loadFrozenPayerIds(cohorts);
  refuseCohortReplacement(hospitalIds, hospitalDispositions.map((row) => row.candidate_id));
  refuseCohortReplacement(payerIds, payerDispositions.map((row) => row.candidate_id));
  const hospitals = hospitalDispositions.map(classifyDisposition);
  const payers = payerDispositions.map(classifyDisposition);
  const hospitalParsed = hospitals.filter((row) => row.bounded_parsed_sample).length;
  const payerParsed = payers.filter((row) => row.bounded_parsed_sample).length;
  const hospitalUnknown = hospitals.filter((row) => row.unknown).length;
  const payerUnknown = payers.filter((row) => row.unknown).length;
  const liveTargetsMet = hospitalParsed >= HOSPITAL_PARSED_SAMPLE_TARGET && payerParsed >= PAYER_PARSED_SAMPLE_TARGET;
  return freeze({
    format: QUALIFY_MRF_FORMAT,
    generation: LAST_GOOD_GENERATION,
    freeze_id: cohorts?.mrf_selection?.seal?.freeze_id ?? 'ushso-mrf-directory-pilots-20260910-v1',
    status: cohorts?.mrf_selection?.status ?? 'ids_frozen_locators_not_materialized',
    hospital_denominator: HOSPITAL_DENOMINATOR,
    payer_denominator: PAYER_DENOMINATOR,
    hospital_parsed_live: hospitalParsed,
    payer_parsed_live: payerParsed,
    hospital_unknown: hospitalUnknown,
    payer_unknown: payerUnknown,
    hospital_parsed_target: HOSPITAL_PARSED_SAMPLE_TARGET,
    payer_parsed_target: PAYER_PARSED_SAMPLE_TARGET,
    live_parsed_sample_targets_met: liveTargetsMet,
    unknown_cells_counted_as_supported: false,
    cohort_members_replaced: false,
    scientific_acceptance: false,
    implementer_self_approved: false,
    last_good_generation_changed: false,
    hospitals: freeze(hospitals),
    payers: freeze(payers),
    blockers: freeze([...hospitals, ...payers].filter((row) => row.blocker).map((row) => row.follow_up)),
  });
}

export function expansionFamilyRoutes(cohorts) {
  const families = cohorts?.expansion_families?.families ?? [];
  if (families.length !== EXPANSION_FAMILY_COUNT) fail('EXPANSION_FAMILY_COUNT_NOT_12', String(families.length));
  const routes = families.map((family) => freeze({
    family_identity: family.family_identity,
    product_key: family.product_key,
    intake_pr: family.intake_pr ?? null,
    route_documented: Boolean(family.intake_pr || family.candidate_official_locator),
    publisher_access_claimed: family.publisher_access_claimed === true,
    schema_qualification_claimed: family.schema_qualification_claimed === true,
    supported: family.publisher_access_claimed === true && family.schema_qualification_claimed === true,
  }));
  if (routes.some((route) => route.supported && (!route.intake_pr))) {
    fail('UNSUPPORTED_FAMILY_MARKED_SUPPORTED');
  }
  return freeze({
    family_count: routes.length,
    all_have_documented_routes: routes.every((route) => route.route_documented),
    routes,
  });
}

export function hospitalWalkthrough() {
  const generation = LAST_GOOD_GENERATION;
  return buildExamplePacket({
    question: 'Locate a hospital JSON MRF, inspect schema, find CPT 70551, and identify non-comparable per-diem charges',
    generation,
    products: [{ product_key: 'cms-hospital-price-transparency', release: 'v3.0.0-official-fictional', why_needed: 'Pinned CMS hospital JSON v3.0 walkthrough.', source_id: 'cms-hpt-json' }],
    fields: ['hospital_name', 'billing_code', 'standard_charge_dollar', 'standard_charge_percentage'],
    types: { hospital_name: 'string', billing_code: 'string', standard_charge_dollar: 'number', standard_charge_percentage: 'number' },
    access_steps: [{
      id: 'hospital-json-sample',
      label: 'Parse official fictional CMS hospital JSON v3.0 example',
      executed: true,
      receipt: createExampleReceipt({
        source: 'cms-hospital-price-transparency',
        release: generation,
        distribution: 'official-fictional-json-v3',
        expected: { content_class: 'json', media_type: 'application/json', fields: ['hospital_name'], types: { hospital_name: 'string' } },
      }),
    }],
    caveats: [
      'West Mercy Hospital is an official CMS fictional example, labeled synthetic.',
      'A negotiated or gross charge is not an observed paid claim.',
      'Algorithm, percentage and per-diem values are not comparable dollar prices.',
      'A passing sample is not legal compliance.',
    ],
    citations: ['https://github.com/CMSgov/hospital-price-transparency'],
  });
}

export function payerWalkthrough() {
  const generation = LAST_GOOD_GENERATION;
  return buildExamplePacket({
    question: 'Locate a payer in-network file, inspect schema, find CPT 99214, resolve provider-reference 1, and keep percentage rates non-comparable',
    generation,
    products: [{ product_key: 'cms-payer-transparency-in-coverage', release: 'v2.2.1-official-fictional', why_needed: 'Pinned CMS payer in-network walkthrough.', source_id: 'cms-tic-in-network' }],
    fields: ['reporting_entity_name', 'billing_code', 'negotiated_type', 'provider_group_id'],
    types: { reporting_entity_name: 'string', billing_code: 'string', negotiated_type: 'string', provider_group_id: 'number' },
    access_steps: [{
      id: 'payer-in-network-sample',
      label: 'Parse official fictional CMS in-network negotiated-types example',
      executed: true,
      receipt: createExampleReceipt({
        source: 'cms-payer-tic',
        release: generation,
        distribution: 'official-fictional-in-network',
        expected: { content_class: 'json', media_type: 'application/json', fields: ['reporting_entity_name'], types: { reporting_entity_name: 'string' } },
      }),
    }],
    caveats: [
      'Comprehensive Health Insurance is an official CMS fictional example, labeled synthetic.',
      'A negotiated rate is not observed payment or patient liability.',
      'Provider-reference IDs are in-file; they are not NPIs or hospital CCNs.',
      'A passing sample is not legal compliance.',
    ],
    citations: ['https://github.com/CMSgov/price-transparency-guide'],
  });
}

export function qualifyMrf(cohorts = loadCohort(), options = {}) {
  const hospitalIds = loadFrozenHospitalIds(cohorts);
  const payerIds = loadFrozenPayerIds(cohorts);
  const hospitalDispositions = options.hospitalDispositions ?? hospitalIds.map((id) => ({
    candidate_id: id,
    locator_materialized: false,
    bounded_parsed_sample: false,
    outcome: 'unresolved_locator',
  }));
  const payerDispositions = options.payerDispositions ?? payerIds.map((id) => ({
    candidate_id: id,
    locator_materialized: false,
    bounded_parsed_sample: false,
    outcome: 'unresolved_locator',
  }));
  const pilot = reconcilePilot(cohorts, { hospitalDispositions, payerDispositions, actor: options.actor ?? 'implementer' });
  const families = expansionFamilyRoutes(cohorts);
  const hospitalExample = hospitalWalkthrough();
  const payerExample = payerWalkthrough();
  refuseSelfApproval({ actor: options.actor ?? 'implementer', role: 'implementer', approved: options.selfApproved === true });
  return freeze({
    format: QUALIFY_MRF_FORMAT,
    generation: LAST_GOOD_GENERATION,
    pilot,
    expansion_families: families,
    examples: freeze({
      hospital: freeze({ ...hospitalExample, fictional: true, synthetic: true, real_hospital_file: false }),
      payer: freeze({ ...payerExample, fictional: true, synthetic: true, real_payer_file: false }),
    }),
    scientific_acceptance: false,
    legal_compliance: false,
    observed_payment: false,
    discovery_research_layer: true,
    unbounded_national_rate_warehouse: false,
    last_good_generation_changed: false,
  });
}
