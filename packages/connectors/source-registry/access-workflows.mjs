import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNamedSourceRegistry, resolveNamedSource } from '../../enrichment/named-sources.mjs';
import { LAST_GOOD_GENERATION } from '../../coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';

export const ACCESS_WORKFLOW_FORMAT = 'ushso.access-workflow.v1';
export const RESTRICTED_FAMILY_COUNT = 3;
export { LAST_GOOD_GENERATION };

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function defaultRegistryPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'restricted-families.json');
}

export function loadRestrictedFamilies(file = defaultRegistryPath()) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function separateAccessClasses(family) {
  const products = (family.products ?? []).map((product) => freeze({
    product_id: product.product_id,
    access_class: product.access_class,
    catalog_access: product.catalog_access ?? 'not_indexed',
    license_access: product.license_access ?? 'unknown',
    payload_access: product.payload_access ?? 'unknown',
    fee: product.fee ?? 'unknown',
    eligibility: product.eligibility ?? 'unknown',
  }));
  const publicMepsRestrictedBecauseSibling = products.some((product) => (
    family.family_id === 'ahrq-meps'
    && product.access_class === 'public_use_file'
    && product.payload_access === 'restricted'
  ));
  if (publicMepsRestrictedBecauseSibling) fail('PUBLIC_MEPS_NOT_RESTRICTED_BECAUSE_SIBLING');
  if (family.family_id === 'aha-annual-survey' && family.terms_inferred === true) fail('AHA_TERMS_NOT_INFERRED');
  return freeze({
    family_id: family.family_id,
    products: freeze(products),
    catalog_license_payload_separate: true,
  });
}

export function refuseGuessedUnknown(step) {
  if (step.fee_guessed === true || step.eligibility_guessed === true) fail('UNKNOWN_NOT_GUESSED', step.id);
  if ((step.fee ?? 'unknown') === 'unknown' && step.fee_amount != null) fail('UNKNOWN_NOT_GUESSED', step.id);
  return freeze({
    id: step.id,
    fee: step.fee ?? 'unknown',
    eligibility: step.eligibility ?? 'unknown',
    guessed: false,
  });
}

export function buildWorkflowCard(family) {
  const steps = (family.workflow ?? []).map((step) => {
    if (!step.citation) fail('STEP_REQUIRES_CITATION', step.id);
    refuseGuessedUnknown(step);
    if (step.collects_eligibility_or_credentials === true) fail('USHSO_DOES_NOT_COLLECT_CREDENTIALS', step.id);
    return freeze({
      id: step.id,
      action: step.action,
      citation: step.citation,
      official_url: step.official_url ?? null,
      expected_artifact: step.expected_artifact ?? null,
      turnaround: step.turnaround ?? 'unknown',
      fee: step.fee ?? 'unknown',
      eligibility: step.eligibility ?? 'unknown',
      collects_eligibility_or_credentials: false,
      executed_in_ushso: false,
    });
  });
  return freeze({
    format: ACCESS_WORKFLOW_FORMAT,
    family_id: family.family_id,
    next_legitimate_step: steps[0] ?? null,
    steps: freeze(steps),
    restricted_download_claimed: false,
  });
}

export function inspectRoute(family, { claimRestrictedDownload = false } = {}) {
  if (claimRestrictedDownload === true) fail('RESTRICTED_DOWNLOAD_NOT_CLAIMED', family.family_id);
  const card = buildWorkflowCard(family);
  return freeze({
    family_id: family.family_id,
    next_legitimate_step: card.next_legitimate_step,
    blocked: family.payload_access === 'restricted' || family.payload_access === 'paid',
    restricted_download_claimed: false,
    guide_url: family.official_documentation,
  });
}

export function evaluateRestrictedRoutes({ families = loadRestrictedFamilies().families, registry = loadNamedSourceRegistry() } = {}) {
  if (!Array.isArray(families) || families.length !== RESTRICTED_FAMILY_COUNT) fail('RESTRICTED_FAMILY_COUNT', String(families?.length));
  const rows = families.map((family) => {
    const classes = separateAccessClasses(family);
    const named = resolveNamedSource(family.discovery_question, registry);
    const hit = (named.sources ?? []).find((source) => source.source_id === family.named_source_id);
    if (!hit) fail('NAMED_FAMILY_NOT_IDENTIFIED', family.family_id);
    return freeze({
      family_id: family.family_id,
      named_source_id: hit.source_id,
      classes,
      workflow: buildWorkflowCard(family),
      route: inspectRoute(family),
      catalog_membership: hit.catalog_membership === true,
    });
  });
  return freeze({
    format: ACCESS_WORKFLOW_FORMAT,
    generation: LAST_GOOD_GENERATION,
    last_good_generation_changed: false,
    family_count: rows.length,
    rows: freeze(rows),
    public_meps_labeled_restricted_because_sibling: false,
    aha_terms_inferred: false,
    credentials_collected: false,
    restricted_download_claimed: false,
  });
}
