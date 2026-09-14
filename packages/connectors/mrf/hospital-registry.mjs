import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAST_GOOD_GENERATION } from '../../coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';

export const HOSPITAL_MRF_FORMAT = 'ushso.hospital-mrf-registry.v1';
export const HOSPITAL_DENOMINATOR = 25;
export { LAST_GOOD_GENERATION };

const TYPED_OUTCOMES = Object.freeze(['broken_link', 'redirect_gate', 'unexpected_format', 'landing_page_not_file', 'discovered_file', 'unresolved']);

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function defaultCohortPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'hospital-cohort.json');
}

export function loadHospitalCohort(file = defaultCohortPath()) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function loadFrozenHospitalIds(cohorts) {
  const ids = cohorts?.mrf_selection?.hospital_candidate_ids ?? [];
  if (ids.length !== HOSPITAL_DENOMINATOR) fail('HOSPITAL_DENOMINATOR_NOT_25', String(ids.length));
  return freeze([...ids]);
}

export function defineHospitalMrfIdentity(hospital, { locator = null, declaredSchema = null, detectedSchema = null, format = null, reportingDate = null } = {}) {
  if (!hospital?.candidate_id) fail('HOSPITAL_IDENTITY_REQUIRED');
  if (declaredSchema && detectedSchema && declaredSchema !== detectedSchema) {
    return freeze({
      candidate_id: hospital.candidate_id,
      native_identity: freeze({ ...hospital.native_identity }),
      locator,
      declared_schema_version: declaredSchema,
      detected_schema_version: detectedSchema,
      schema_versions_distinct: true,
      format,
      reporting_date: reportingDate,
      verified_file: false,
    });
  }
  return freeze({
    candidate_id: hospital.candidate_id,
    native_identity: freeze({ ...hospital.native_identity }),
    locator,
    declared_schema_version: declaredSchema,
    detected_schema_version: detectedSchema,
    schema_versions_distinct: declaredSchema !== detectedSchema,
    format,
    reporting_date: reportingDate,
    verified_file: Boolean(locator && hospital.candidate_id && format && format !== 'html_landing_page'),
  });
}

export function refuseSystemLandingPageAsOwnedFiles(landingPage, ownedHospitalIds = []) {
  if (landingPage?.kind === 'health_system_landing_page' && ownedHospitalIds.length > 1 && landingPage.verified_for_every_owned_hospital === true) {
    fail('LANDING_PAGE_IS_NOT_VERIFIED_FILE_FOR_EVERY_OWNED_HOSPITAL');
  }
  return freeze({
    locator: landingPage?.locator ?? null,
    verified_file_for_hospitals: freeze([]),
    remaining_unresolved: freeze([...ownedHospitalIds]),
  });
}

export function collectDocumentedLink(observation = {}) {
  const outcome = observation.outcome;
  if (observation.crawler_explores_arbitrary_sites === true) fail('NO_ARBITRARY_CRAWLER');
  if (observation.full_size_download === true && observation.budget_decision !== true) fail('FULL_SIZE_MRF_REQUIRES_BUDGET');
  if (!TYPED_OUTCOMES.includes(outcome)) fail('TYPED_OUTCOME_REQUIRED', String(outcome));
  return freeze({
    candidate_id: observation.candidate_id ?? null,
    outcome,
    locator: observation.locator ?? null,
    media_type: observation.media_type ?? null,
    bytes: observation.bytes ?? null,
    encoding: observation.encoding ?? null,
    terms: observation.terms ?? null,
    crawler_used: false,
    full_size_download: false,
  });
}

export function refuseEnforcementAsRateFile(record) {
  if (record?.product_key === 'cms-hospital-price-transparency-enforcement' && record?.satisfies_rate_file === true) {
    fail('ENFORCEMENT_IS_NOT_RATE_FILE');
  }
  return freeze({ product_key: record?.product_key ?? null, satisfies_rate_file: false });
}

export function reconcileHospitalCohort(frozenIds, dispositions = []) {
  const selected = freeze([...frozenIds]);
  if (selected.length !== HOSPITAL_DENOMINATOR) fail('HOSPITAL_DENOMINATOR_NOT_25', String(selected.length));
  const byId = new Map(dispositions.map((row) => [row.candidate_id, row]));
  if (dispositions.length !== new Set(dispositions.map((row) => row.candidate_id)).size) fail('SILENT_DEDUPLICATION_FORBIDDEN');
  const missing = selected.filter((id) => !byId.has(id));
  if (missing.length) fail('DENOMINATOR_SHRUNK', missing.join(','));
  const extra = dispositions.filter((row) => !selected.includes(row.candidate_id));
  if (extra.length) fail('REPLACEMENT_FORBIDDEN', extra.map((row) => row.candidate_id).join(','));
  const discovered = dispositions.filter((row) => row.outcome === 'discovered_file');
  const accessible = discovered.filter((row) => row.accessible === true);
  const unresolved = dispositions.filter((row) => row.outcome !== 'discovered_file' || row.accessible !== true);
  const parserQueue = {};
  for (const row of discovered) {
    const key = `${row.declared_schema_version ?? 'undeclared'}/${row.format ?? 'unknown'}`;
    parserQueue[key] = (parserQueue[key] ?? 0) + 1;
  }
  return freeze({
    format: HOSPITAL_MRF_FORMAT,
    generation: LAST_GOOD_GENERATION,
    selected: selected.length,
    discovered: discovered.length,
    accessible: accessible.length,
    unresolved: unresolved.length,
    denominator: HOSPITAL_DENOMINATOR,
    denominator_includes_failures: true,
    parser_queue: freeze(parserQueue),
    last_good_generation_changed: false,
  });
}
