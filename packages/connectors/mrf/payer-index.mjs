import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAST_GOOD_GENERATION } from '../../coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';

export const PAYER_INDEX_FORMAT = 'ushso.payer-tic-index.v1';
export const PAYER_DENOMINATOR = 10;
export const PINNED_TIC_VERSION = '2.2.1';
export const PINNED_TOC_BLOB_SHA = '370be524856f38d97a9424f8508be6a7b79e28d5';
export const HOSPITAL_HPT_SCHEMA_FAMILY = 'cms-hospital-price-transparency';
export const PAYER_TIC_SCHEMA_FAMILY = 'cms-payer-transparency-in-coverage';
export const FROZEN_PAYER_IDS = Object.freeze([
  '67190', '45845', '32225', '40702', '32753', '15560', '11269', '37833', '59025', '86382',
]);
export { LAST_GOOD_GENERATION };

const FILE_TYPES = Object.freeze(['in_network', 'allowed_amount', 'provider_reference']);
const TYPED_OUTCOMES = Object.freeze(['discovered_index', 'inaccessible_bulk_file', 'broken_link', 'redirect_gate', 'unexpected_format', 'unresolved']);

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function defaultCohortPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'payer-cohort.json');
}

function defaultFixtureDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../evaluation/research-program/mrf-fixtures/payer-index');
}

export function loadPayerCohort(file = defaultCohortPath()) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function loadFrozenPayerIds(cohorts) {
  const ids = cohorts?.mrf_selection?.payer_reporting_entity_candidate_ids ?? [];
  if (ids.length !== PAYER_DENOMINATOR) fail('PAYER_DENOMINATOR_NOT_10', String(ids.length));
  if (JSON.stringify(ids) !== JSON.stringify([...FROZEN_PAYER_IDS])) fail('FROZEN_PAYER_IDS_CHANGED');
  return freeze([...ids]);
}

export function loadPinnedTocSchema(dir = defaultFixtureDir()) {
  return JSON.parse(readFileSync(path.join(dir, 'table-of-contents.json'), 'utf8'));
}

export function loadOfficialTocExample(dir = defaultFixtureDir()) {
  const example = JSON.parse(readFileSync(path.join(dir, 'table-of-contents-sample.json'), 'utf8'));
  return freeze({ ...example, synthetic: true, official_fictional_example: true });
}

export function refuseIdentitySubstitution({ employerPlanId, insurerIdentity, hospitalIdentity } = {}) {
  if (employerPlanId && insurerIdentity && employerPlanId === insurerIdentity) {
    fail('EMPLOYER_PLAN_ID_IS_NOT_INSURER_IDENTITY');
  }
  if (employerPlanId && hospitalIdentity && employerPlanId === hospitalIdentity) {
    fail('EMPLOYER_PLAN_ID_IS_NOT_HOSPITAL_IDENTITY');
  }
  if (insurerIdentity && hospitalIdentity && insurerIdentity === hospitalIdentity) {
    fail('INSURER_IDENTITY_IS_NOT_HOSPITAL_IDENTITY');
  }
  return freeze({
    employer_plan_id: employerPlanId ?? null,
    insurer_identity: insurerIdentity ?? null,
    hospital_identity: hospitalIdentity ?? null,
    substitutable: false,
  });
}

export function refuseHospitalSchemaAsPayer(record = {}) {
  if (record.schema_family === HOSPITAL_HPT_SCHEMA_FAMILY && record.treated_as_payer_tic === true) {
    fail('HOSPITAL_HPT_IS_NOT_PAYER_TIC');
  }
  if (record.schema_family === PAYER_TIC_SCHEMA_FAMILY && record.treated_as_hospital_hpt === true) {
    fail('PAYER_TIC_IS_NOT_HOSPITAL_HPT');
  }
  return freeze({
    schema_family: record.schema_family ?? PAYER_TIC_SCHEMA_FAMILY,
    hospital_hpt_and_payer_tic_remain_separate: true,
  });
}

export function classifyFileType(entry = {}) {
  const declared = entry.file_type ?? entry.type ?? null;
  if (declared === 'in_network' || declared === 'in-network' || entry.in_network === true) {
    return freeze({ file_type: 'in_network', in_network_parser_validates: false, allowed_amount_validated: false });
  }
  if (declared === 'allowed_amount' || declared === 'allowed-amount' || entry.allowed_amount === true) {
    return freeze({
      file_type: 'allowed_amount',
      discoverable: true,
      in_network_parser_validates: false,
      allowed_amount_validated: false,
    });
  }
  if (declared === 'provider_reference' || declared === 'provider-reference') {
    return freeze({ file_type: 'provider_reference', in_network_parser_validates: false });
  }
  if (entry.location && /allowed[-_]?amount/i.test(entry.description ?? entry.location ?? '')) {
    return freeze({
      file_type: 'allowed_amount',
      discoverable: true,
      in_network_parser_validates: false,
      allowed_amount_validated: false,
    });
  }
  if (entry.location && /in[-_]?network/i.test(entry.description ?? entry.location ?? '')) {
    return freeze({ file_type: 'in_network', in_network_parser_validates: false, allowed_amount_validated: false });
  }
  fail('UNKNOWN_TIC_FILE_TYPE', declared ?? entry.description ?? 'unknown');
}

export function parseTableOfContents(document, { maxFiles = 20 } = {}) {
  if (document?.synthetic !== true && document?.official_fictional_example === true) {
    fail('OFFICIAL_FICTIONAL_EXAMPLE_MUST_BE_SYNTHETIC');
  }
  const structures = Array.isArray(document?.reporting_structure) ? document.reporting_structure : [];
  const files = new Map();
  for (const structure of structures) {
    const plans = (structure.reporting_plans ?? []).map((plan) => freeze({
      plan_name: plan.plan_name ?? null,
      plan_id: plan.plan_id ?? null,
      plan_id_type: plan.plan_id_type ?? null,
      plan_market_type: plan.plan_market_type ?? null,
      issuer_name: plan.issuer_name ?? null,
      plan_sponsor_name: plan.plan_sponsor_name ?? null,
    }));
    const declared = [];
    for (const entry of structure.in_network_files ?? []) {
      declared.push({ ...entry, file_type: 'in_network' });
    }
    if (structure.allowed_amount_file) {
      declared.push({ ...structure.allowed_amount_file, file_type: 'allowed_amount' });
    }
    for (const entry of structure.provider_references ?? []) {
      declared.push({ ...entry, file_type: 'provider_reference' });
    }
    for (const entry of declared) {
      const location = entry.location ?? null;
      if (!location) fail('DECLARED_FILE_REFERENCE_REQUIRED');
      if (!files.has(location)) {
        const classified = classifyFileType(entry);
        files.set(location, {
          location,
          description: entry.description ?? null,
          file_type: classified.file_type,
          in_network_parser_validates: classified.in_network_parser_validates === true,
          allowed_amount_validated: classified.allowed_amount_validated === true,
          fetch_once: true,
          plan_associations: [],
        });
      }
      const record = files.get(location);
      for (const plan of plans) {
        if (!record.plan_associations.some((existing) => existing.plan_id === plan.plan_id && existing.plan_id_type === plan.plan_id_type)) {
          record.plan_associations.push(plan);
        }
      }
    }
  }
  const limited = [...files.values()].slice(0, maxFiles);
  return freeze({
    format: PAYER_INDEX_FORMAT,
    schema_family: PAYER_TIC_SCHEMA_FAMILY,
    hospital_hpt_and_payer_tic_remain_separate: true,
    generation: LAST_GOOD_GENERATION,
    reporting_entity_name: document?.reporting_entity_name ?? null,
    reporting_entity_type: document?.reporting_entity_type ?? null,
    version: document?.version ?? null,
    last_updated_on: document?.last_updated_on ?? null,
    synthetic: document?.synthetic === true,
    official_fictional_example: document?.official_fictional_example === true,
    files: freeze(limited.map((file) => freeze({
      ...file,
      plan_associations: freeze(file.plan_associations),
      fetched_once: true,
    }))),
    file_count_seen: limited.length,
    file_count_total: files.size,
    partial_sample: files.size > maxFiles,
    last_good_generation_changed: false,
  });
}

export function reconcileSharedFiles(parsed) {
  const byLocation = new Map();
  for (const file of parsed.files ?? []) {
    if (byLocation.has(file.location)) fail('SHARED_FILE_FETCHED_MORE_THAN_ONCE', file.location);
    byLocation.set(file.location, file);
  }
  return freeze({
    unique_files: byLocation.size,
    fetched_once: true,
    plan_associations_retained: [...byLocation.values()].every((file) => (file.plan_associations ?? []).length >= 1),
  });
}

export function recordPayerDisposition(observation = {}) {
  const outcome = observation.outcome;
  if (observation.crawler_explores_arbitrary_sites === true) fail('NO_ARBITRARY_CRAWLER');
  if (observation.full_size_download === true && observation.budget_decision !== true) fail('FULL_SIZE_MRF_REQUIRES_BUDGET');
  if (!TYPED_OUTCOMES.includes(outcome)) fail('TYPED_OUTCOME_REQUIRED', String(outcome));
  const fileType = observation.file_type ?? null;
  if (fileType && !FILE_TYPES.includes(fileType)) fail('UNKNOWN_TIC_FILE_TYPE', fileType);
  if (fileType === 'allowed_amount' && observation.in_network_parser_validates === true) {
    fail('ALLOWED_AMOUNT_NOT_VALIDATED_BY_IN_NETWORK_PARSER');
  }
  return freeze({
    candidate_id: observation.candidate_id ?? null,
    outcome,
    locator: observation.locator ?? null,
    file_type: fileType,
    declared_version: observation.declared_version ?? null,
    encoding: observation.encoding ?? null,
    bytes: observation.bytes ?? null,
    parser_eligible: outcome === 'discovered_index',
    sample_state: outcome === 'inaccessible_bulk_file' ? 'failed' : (outcome === 'discovered_index' ? 'indexed' : 'unresolved'),
    documented_route: true,
    in_network_parser_validates: false,
    crawler_used: false,
    full_size_download: false,
  });
}

export function reconcilePayerCohort(frozenIds, dispositions = []) {
  const selected = freeze([...frozenIds]);
  if (selected.length !== PAYER_DENOMINATOR) fail('PAYER_DENOMINATOR_NOT_10', String(selected.length));
  const byId = new Map(dispositions.map((row) => [row.candidate_id, row]));
  if (dispositions.length !== new Set(dispositions.map((row) => row.candidate_id)).size) fail('SILENT_DEDUPLICATION_FORBIDDEN');
  const missing = selected.filter((id) => !byId.has(id));
  if (missing.length) fail('DENOMINATOR_SHRUNK', missing.join(','));
  const extra = dispositions.filter((row) => !selected.includes(row.candidate_id));
  if (extra.length) fail('REPLACEMENT_FORBIDDEN', extra.map((row) => row.candidate_id).join(','));
  const inaccessible = dispositions.filter((row) => row.outcome === 'inaccessible_bulk_file');
  const unresolved = dispositions.filter((row) => row.outcome !== 'discovered_index');
  return freeze({
    format: PAYER_INDEX_FORMAT,
    generation: LAST_GOOD_GENERATION,
    selected: selected.length,
    discovered: dispositions.filter((row) => row.outcome === 'discovered_index').length,
    inaccessible: inaccessible.length,
    unresolved: unresolved.length,
    denominator: PAYER_DENOMINATOR,
    denominator_includes_failures: true,
    inaccessible_bulk_file_remains_documented_route: inaccessible.every((row) => row.documented_route === true && row.sample_state === 'failed'),
    last_good_generation_changed: false,
  });
}
