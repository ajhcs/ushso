import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNamedSourceRegistry, resolveNamedSource } from '../../enrichment/named-sources.mjs';
import { LAST_GOOD_GENERATION } from '../../coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';

export const FEDERAL_INTAKE_FORMAT = 'ushso.federal-source-intake.v1';
export const FEDERAL_FAMILY_COUNT = 5;
export { LAST_GOOD_GENERATION };

const ADAPTER_PORTS = Object.freeze(['api', 'dcat', 'file', 'document', 'typed_manual']);

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function defaultRegistryPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'federal-families.json');
}

export function loadFederalFamilies(file = defaultRegistryPath()) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function assertPublisherLocator(family) {
  const locator = family.authoritative_documentation;
  if (typeof locator !== 'string' || !/^https:\/\//.test(locator)) fail('LOCATOR_NOT_PUBLISHER_SUPPORTED', family.family_id);
  const host = new URL(locator).hostname;
  const allowed = family.publisher_hosts ?? [];
  if (!allowed.some((item) => host === item || host.endsWith(`.${item}`))) {
    fail('LOCATOR_NOT_PUBLISHER_SUPPORTED', `${family.family_id}:${host}`);
  }
  return true;
}

export function configureAdapter(family) {
  const port = family.adapter_port;
  if (!ADAPTER_PORTS.includes(port)) {
    return freeze({
      family_id: family.family_id,
      configured: false,
      extension_task: `PR-043-extension-${family.family_id}-${port ?? 'unknown'}`,
      scraper_forbidden: true,
      code: 'UNSUPPORTED_PROTOCOL_EXTENSION_REQUIRED',
    });
  }
  if (port === 'typed_manual') {
    return freeze({
      family_id: family.family_id,
      configured: true,
      adapter_port: port,
      public_example: null,
      retrieval_authorized: false,
      fixture: family.fixture_id,
    });
  }
  return freeze({
    family_id: family.family_id,
    configured: true,
    adapter_port: port,
    public_example: family.public_example_supported === true ? freeze(family.public_example) : null,
    retrieval_authorized: false,
    fixture: family.fixture_id,
  });
}

export function refuseTafPublicSummary(question, catalogRecord, family) {
  if (family.family_id !== 'cms-tmsis-taf') return freeze({ applicable: false });
  const text = `${question ?? ''} ${catalogRecord?.title ?? ''} ${catalogRecord?.description ?? ''}`.toLowerCase();
  const publicSummary = /managed care|public medicaid summary|medicaid.gov\/medicaid\/managed-care/.test(text);
  if (publicSummary || catalogRecord?.product_class === 'public_medicaid_summary') {
    fail('TAF_RESTRICTED_NOT_PUBLIC_SUMMARY');
  }
  if (family.access_class !== 'restricted_research_files') fail('TAF_ACCESS_CLASS_REQUIRED');
  if (family.asserts_restricted_access === true) fail('TAF_ROUTE_MUST_NOT_ASSERT_ACCESS');
  return freeze({
    applicable: true,
    restricted_research_files: true,
    public_summary: false,
    access_asserted: false,
  });
}

export function refuseAspeAsAtsdrSvi(catalogRecord) {
  const text = `${catalogRecord?.title ?? ''} ${catalogRecord?.description ?? ''} ${catalogRecord?.record_id ?? ''} ${catalogRecord?.native_id ?? ''}`.toLowerCase();
  if (/ypqf-r5qs|aspe/.test(text)) {
    return freeze({
      catalog_is_not_atsdr_svi: true,
      named_source_id: 'cdc-atsdr-svi',
      reason: 'ASPE_SVI_IS_NOT_ATSDR_SVI',
    });
  }
  return freeze({ catalog_is_not_atsdr_svi: false });
}

export function evaluateFamilyQuestion(question, registry, family) {
  const resolved = resolveNamedSource(question, registry);
  const hit = (resolved.sources ?? []).find((source) => source.source_id === family.named_source_id);
  if (!hit) fail('NAMED_FAMILY_NOT_IDENTIFIED', family.family_id);
  if (hit.catalog_membership === true && family.catalog_membership !== true) fail('CATALOG_MEMBERSHIP_INVENTED', family.family_id);
  return freeze({
    family_id: family.family_id,
    identified: true,
    named_source_id: hit.source_id,
    catalog_membership: hit.catalog_membership === true,
    restrictions_visible: family.restrictions_visible === true,
    coverage_state: hit.coverage_state,
  });
}

export function evaluateFederalIntake({ families = loadFederalFamilies().families, registry = loadNamedSourceRegistry() } = {}) {
  if (!Array.isArray(families) || families.length !== FEDERAL_FAMILY_COUNT) fail('FEDERAL_FAMILY_COUNT', String(families?.length));
  const rows = families.map((family) => {
    assertPublisherLocator(family);
    const adapter = configureAdapter(family);
    if (family.family_id === 'cms-tmsis-taf') {
      refuseTafPublicSummary('Need TAF research files', { title: 'CMS T-MSIS Analytic Files' }, family);
    }
    return freeze({
      family_id: family.family_id,
      title: family.title,
      operator: family.operator,
      access_class: family.access_class,
      adapter,
      unresolved_coverage: family.unresolved_coverage === true,
      unresolved_rights: family.unresolved_rights === true,
      catalog_membership: family.catalog_membership === true,
    });
  });
  return freeze({
    format: FEDERAL_INTAKE_FORMAT,
    generation: LAST_GOOD_GENERATION,
    last_good_generation_changed: false,
    family_count: rows.length,
    rows: freeze(rows),
    taf_access_asserted: false,
    catalog_membership_invented: false,
    scraper_used: false,
  });
}
