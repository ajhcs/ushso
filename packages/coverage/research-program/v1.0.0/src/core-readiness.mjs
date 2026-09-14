import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSourceCard } from '../../../../enrichment/source-card.mjs';
import { LAST_GOOD_GENERATION } from './qualify-deterministic.mjs';
import { validateResearchReady } from '../../../../enrichment/measure-semantics.mjs';

export const CORE_READINESS_POLICY_VERSION = 'ushso.core-readiness.v1';
export const PRODUCT_DENOMINATOR = 100;
export const PUBLIC_SAMPLE_TARGET = 80;
export { LAST_GOOD_GENERATION };

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

export function loadCohort(file = defaultCohortPath()) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function defaultCohortPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../../evaluation/research-program/cohorts.json');
}

export function productDenominator(products, { extraReleases = [] } = {}) {
  if (!Array.isArray(products) || products.length !== PRODUCT_DENOMINATOR) fail('PRODUCT_DENOMINATOR_NOT_100', String(products?.length));
  const keys = new Set(products.map((product) => product.product_key));
  if (keys.size !== PRODUCT_DENOMINATOR) fail('DUPLICATE_PRODUCT_KEYS');
  for (const release of extraReleases) {
    if (keys.has(release.product_key)) continue;
    fail('ANNUAL_RELEASE_INFLATED_DENOMINATOR', release.product_key);
  }
  return freeze({ denominator: PRODUCT_DENOMINATOR, annual_releases_are_not_products: true });
}

export function joinProductContext(product) {
  const anchor = product.anchor ?? {};
  const missing = [];
  if (anchor.status !== 'resolved_catalog_record') missing.push('catalog_record');
  if (!product.product_release_distinction) missing.push('release_distinction');
  const restricted = ['restricted_or_manual_route', 'pending_source_intake', 'mixed_public_and_restricted'].includes(product.access_expectation);
  return freeze({
    product_key: product.product_key,
    title: product.title,
    access_expectation: product.access_expectation,
    anchor_status: anchor.status ?? 'unknown',
    selected_release: anchor.representative?.record_id ?? null,
    documentation: anchor.representative?.authoritative_url ?? product.anchor?.intake?.official_discovery_url ?? null,
    restricted_or_manual: restricted,
    missing_essential_context: freeze(missing),
    named_blocker: missing.length ? freeze({ id: `missing-context:${product.product_key}`, fields: freeze(missing) }) : null,
  });
}

export function essentialReadiness(product, { cardInput = null, optionalFields = 0, unknownEssentialDenominator = false, inaccessibleRecipe = false, publicSample = null, restrictedRoute = null } = {}) {
  const context = joinProductContext(product);
  const card = cardInput ? buildSourceCard(cardInput) : null;
  const publicOk = product.access_expectation === 'public_sample_eligible' && context.anchor_status === 'resolved_catalog_record' && publicSample !== false;
  const restrictedOk = context.restricted_or_manual && restrictedRoute?.verified === true && Array.isArray(restrictedRoute?.contents) && restrictedRoute.contents.length > 0;
  if (unknownEssentialDenominator || inaccessibleRecipe) {
    return freeze({
      product_key: product.product_key,
      research_ready: false,
      code: unknownEssentialDenominator ? 'UNKNOWN_ESSENTIAL_DENOMINATOR' : 'INACCESSIBLE_RECIPE',
      optional_fields: optionalFields,
      optional_fields_cannot_compensate: true,
      public_sample_complete: publicOk,
      restricted_route_complete: restrictedOk,
      card_incomplete: card?.incomplete ?? true,
    });
  }
  if (card?.incomplete) {
    return freeze({
      product_key: product.product_key,
      research_ready: false,
      code: 'SOURCE_CARD_INCOMPLETE',
      missing_essential: card.missing_essential,
      optional_fields: optionalFields,
      optional_fields_cannot_compensate: true,
      public_sample_complete: publicOk,
      restricted_route_complete: restrictedOk,
    });
  }
  return freeze({
    product_key: product.product_key,
    research_ready: publicOk || restrictedOk,
    public_sample_complete: publicOk,
    restricted_route_complete: restrictedOk,
    optional_fields: optionalFields,
    optional_fields_cannot_compensate: true,
  });
}

export function deficitAssignment(product, readiness) {
  const blockers = [];
  if (readiness.code === 'UNKNOWN_ESSENTIAL_DENOMINATOR') blockers.push({ field: 'denominator', evidence: 'source_native_denominator_definition' });
  if (readiness.code === 'INACCESSIBLE_RECIPE') blockers.push({ field: 'recipe', evidence: 'executable_or_documented_recipe' });
  if (readiness.code === 'SOURCE_CARD_INCOMPLETE') {
    for (const field of readiness.missing_essential ?? []) blockers.push({ field, evidence: `source-card:${field}` });
  }
  const context = joinProductContext(product);
  if (context.named_blocker) blockers.push({ field: context.named_blocker.fields.join(','), evidence: 'exact_context' });
  if (context.restricted_or_manual && !readiness.restricted_route_complete) {
    blockers.push({ field: 'restricted_or_manual_route', evidence: 'verified_route_and_documented_contents' });
  }
  if (!blockers.length) return null;
  return freeze({
    format: 'ushso.exception-pr-template.v1',
    product_key: product.product_key,
    next_task: `PR-040-deficit-${product.product_key}`,
    source_id: product.program_key,
    blockers: freeze(blockers),
    group: context.restricted_or_manual ? 'restricted-or-manual-intake' : 'public-sample-context',
    cannot_waive_by_adding_easy_records: true,
  });
}

export function evaluateCoreReadiness(cohort, extras = {}) {
  const products = cohort.products ?? [];
  const denom = productDenominator(products, { extraReleases: extras.extraReleases ?? [] });
  const rows = products.map((product) => {
    const extra = extras.byProduct?.[product.product_key] ?? {};
    const readiness = essentialReadiness(product, extra);
    return freeze({
      ...joinProductContext(product),
      readiness,
      deficit: deficitAssignment(product, readiness),
    });
  });
  const publicComplete = rows.filter((row) => row.readiness.public_sample_complete);
  const restrictedComplete = rows.filter((row) => row.readiness.restricted_route_complete);
  const incomplete = rows.filter((row) => row.deficit);
  if (incomplete.some((row) => !row.deficit.next_task)) fail('INCOMPLETE_WITHOUT_NEXT_TASK');
  const r04 = publicComplete.length >= PUBLIC_SAMPLE_TARGET;
  const r05 = incomplete.filter((row) => row.restricted_or_manual).every((row) => row.readiness.restricted_route_complete);
  return freeze({
    format: 'ushso.core-readiness.v1',
    generation: LAST_GOOD_GENERATION,
    last_good_generation_changed: false,
    denominator: denom.denominator,
    annual_releases_are_not_products: denom.annual_releases_are_not_products,
    public_sample_complete: publicComplete.length,
    public_sample_target: PUBLIC_SAMPLE_TARGET,
    restricted_route_complete: restrictedComplete.length,
    incomplete: incomplete.length,
    deficits: freeze(incomplete.map((row) => row.deficit)),
    rows: freeze(rows),
    r04_engineering_target_met: r04,
    r05_restricted_routes_verified: r05,
    r04_accepted: false,
    r05_accepted: false,
    gate_cannot_waive_by_adding_easy_records: true,
  });
}

export { validateResearchReady };
