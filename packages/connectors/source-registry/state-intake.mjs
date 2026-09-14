import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNamedSourceRegistry, resolveNamedSource } from '../../enrichment/named-sources.mjs';
import { LAST_GOOD_GENERATION } from '../../coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';

export const STATE_INTAKE_FORMAT = 'ushso.state-source-intake.v1';
export const STATE_FAMILY_COUNT = 4;
export { LAST_GOOD_GENERATION };

const ADAPTER_PORTS = Object.freeze(['socrata', 'ckan', 'dcat', 'html', 'pdf', 'document', 'typed_manual']);

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function defaultRegistryPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'state-families.json');
}

export function loadStateFamilies(file = defaultRegistryPath()) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function refuseAllStateCompleteness(family, { claimNational = false } = {}) {
  const jurisdictions = family.jurisdictions ?? [];
  if (claimNational === true || family.national_completeness_from_pilot === true) {
    fail('ONE_STATE_IS_NOT_NATIONAL_COMPLETENESS', family.family_id);
  }
  if (jurisdictions.length === 1 && family.implies_all_state_completeness === true) {
    fail('ONE_STATE_IS_NOT_NATIONAL_COMPLETENESS', family.family_id);
  }
  return freeze({
    family_id: family.family_id,
    jurisdictions: freeze([...jurisdictions]),
    all_state_completeness: false,
    national_completeness_from_pilot: false,
  });
}

export function refuseFamiliarTitleAuthority(candidate, family) {
  const title = String(candidate?.title ?? '');
  const operator = family.operator;
  if (title && operator && title.toLowerCase().includes(String(family.familiar_title_fragment ?? '').toLowerCase()) && candidate?.operator !== operator) {
    fail('PUBLISHER_AUTHORITY_NOT_INFERRED_FROM_TITLE', `${title}!=${operator}`);
  }
  if (candidate?.infer_publisher_from_title === true) fail('PUBLISHER_AUTHORITY_NOT_INFERRED_FROM_TITLE');
  return freeze({ inferred: false, operator: family.operator, nongovernmental: family.nongovernmental === true });
}

export function configurePortal(family) {
  const port = family.adapter_port;
  if (!ADAPTER_PORTS.includes(port)) {
    return freeze({
      family_id: family.family_id,
      configured: false,
      extension_task: `PR-044-extension-${family.family_id}-${port ?? 'unknown'}`,
      scraper_forbidden: true,
      code: 'UNSUPPORTED_PROTOCOL_EXTENSION_REQUIRED',
    });
  }
  if (family.scrape_bypasses_application_or_dua === true) fail('SCRAPE_DOES_NOT_BYPASS_APPLICATION_OR_DUA', family.family_id);
  const machine = family.public_machine_access === true;
  return freeze({
    family_id: family.family_id,
    configured: true,
    adapter_port: port,
    fixture: family.fixture_id,
    budget: freeze(family.budget ?? { max_requests: 1, max_bytes: 65536 }),
    public_machine_access: machine,
    application_or_dua_path: machine ? null : (family.application_or_dua_path ?? null),
    scrape_bypasses_application_or_dua: false,
    retrieval_authorized: false,
  });
}

export function pennsylvaniaFinanceCard(families) {
  const phc4 = families.find((family) => family.family_id === 'pa-phc4');
  const hcris = freeze({
    family_id: 'cms-hcris',
    jurisdiction: 'US',
    product_type: 'hospital_cost_report',
    reporting_definitions_identical_to_phc4: false,
    unrestricted_payload_access: false,
  });
  if (!phc4) fail('PHC4_REQUIRED_FOR_PA_FINANCE');
  return freeze({
    task: 'pennsylvania_hospital_finance',
    families: freeze([
      freeze({
        family_id: phc4.family_id,
        jurisdiction: 'US-PA',
        product_type: phc4.product_type,
        reporting_period: phc4.reporting_period,
        access: phc4.access_class,
        unrestricted_payload_access: false,
      }),
      hcris,
    ]),
    identical_reporting_definitions: false,
    unrestricted_payload_access: false,
  });
}

export function evaluateStateIntake({ families = loadStateFamilies().families, registry = loadNamedSourceRegistry() } = {}) {
  if (!Array.isArray(families) || families.length !== STATE_FAMILY_COUNT) fail('STATE_FAMILY_COUNT', String(families?.length));
  const rows = families.map((family) => {
    refuseAllStateCompleteness(family);
    refuseFamiliarTitleAuthority({ title: family.title, operator: family.operator }, family);
    const portal = configurePortal(family);
    const named = resolveNamedSource(family.discovery_question, registry);
    const hit = (named.sources ?? []).find((source) => source.source_id === family.named_source_id);
    if (!hit) fail('NAMED_FAMILY_NOT_IDENTIFIED', family.family_id);
    return freeze({
      family_id: family.family_id,
      title: family.title,
      operator: family.operator,
      jurisdictions: freeze([...(family.jurisdictions ?? [])]),
      geographic_scope: family.geographic_scope,
      access_class: family.access_class,
      product_type: family.product_type,
      reporting_period: family.reporting_period,
      portal,
      gaps: freeze([...(family.gaps ?? [])]),
      nongovernmental: family.nongovernmental === true,
      catalog_membership: hit.catalog_membership === true,
    });
  });
  return freeze({
    format: STATE_INTAKE_FORMAT,
    generation: LAST_GOOD_GENERATION,
    last_good_generation_changed: false,
    family_count: rows.length,
    rows: freeze(rows),
    pennsylvania_finance: pennsylvaniaFinanceCard(families),
    all_state_completeness: false,
    national_completeness_from_pilot: false,
    scrape_used: false,
  });
}
