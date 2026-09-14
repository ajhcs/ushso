import { createHash } from 'node:crypto';
import { LAST_GOOD_GENERATION, PLANNER_ACCEPTANCE_VERSION, PLANNER_PUBLIC_ACTIVATION } from './planner-acceptance.mjs';
import { inspectJoinRoutes } from '../registry/qualified-join-routes.mjs';
import { HCRIS_HOSPITAL_COST_REPORT_ID } from '../registry/asset-context-collections.mjs';
import { PHC4_PUBLIC_FINANCIAL_REPORTS_ID } from '../registry/comparison-dimensions.mjs';

export const METADATA_PLAN_FORMAT = 'ushso.metadata-research-plan.v1';
export { LAST_GOOD_GENERATION, PLANNER_ACCEPTANCE_VERSION };

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function sha(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const CATALOG = freeze({
  'cms-hcris-hospital-provider-cost-report': freeze({
    product_key: 'cms-hcris-hospital-provider-cost-report',
    asset_id: HCRIS_HOSPITAL_COST_REPORT_ID,
    source_id: 'cms-hcris',
    fields: freeze(['PROVNUM', 'NET_PATIENT_REVENUE']),
    access_steps: freeze([{
      id: 'hcris-public-docs',
      label: 'Open the CMS Hospital Provider Cost Report landing page. Catalog membership is not payload access.',
      executed: false,
      human: true,
    }]),
    citations: freeze(['https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report']),
    limitations: freeze(['Accepted Worksheet G-3 wire mappings are not a complete HCRIS schema.']),
  }),
  'pa-phc4-public-financial-reports': freeze({
    product_key: 'pa-phc4-public-financial-reports',
    asset_id: PHC4_PUBLIC_FINANCIAL_REPORTS_ID,
    source_id: 'pa-phc4',
    fields: freeze([]),
    access_steps: freeze([{
      id: 'phc4-public-reports',
      label: 'Open PHC4 public hospital financial-report pages. Custom record-level files remain a separate restricted request.',
      executed: false,
      human: true,
    }]),
    citations: freeze(['https://www.phc4.org/report-focus/financial/']),
    limitations: freeze(['PHC4 public financial-statement definitions are not HCRIS Worksheet G-3 cost-report definitions.']),
  }),
  'cdc-places': freeze({
    product_key: 'cdc-places',
    asset_id: 'obs:asset:cdc-places',
    source_id: 'cdc-places',
    fields: freeze(['countyfips', 'uninsured_adults']),
    access_steps: freeze([{
      id: 'places-docs',
      label: 'Open CDC PLACES county documentation. This is not Census SAHIE coverage.',
      executed: false,
      human: true,
    }]),
    citations: freeze(['https://www.cdc.gov/places/']),
    limitations: freeze(['An explicit without-Census filter excludes Census sources.']),
  }),
  'cms-hospital-mrf': freeze({
    product_key: 'cms-hospital-mrf',
    asset_id: null,
    source_id: 'cms-hospital-mrf',
    fields: freeze([]),
    access_steps: freeze([{
      id: 'mrf-unknown-locator',
      label: 'Hospital MRF locators remain unmaterialized. Unknown locator cells cannot count as supported.',
      executed: false,
      human: true,
    }]),
    citations: freeze([]),
    limitations: freeze(['PR-054 retained unknown locator cells as unsupported. A pricing plan cannot invent a complete MRF payload.']),
    required_gap: 'unknown_mrf_locator',
  }),
});

const FORBIDDEN_PRODUCTS = freeze(['invented-dataset', 'census-sahie-when-excluded', 'hcup-payload']);
const FORBIDDEN_FIELDS = freeze(['invented_field', 'CCN_EQUALS_NPI']);
const FORBIDDEN_JOINS = freeze(['ccn-equals-npi', 'two-hop-composed']);

function canonicalSelections(input = {}) {
  const product_keys = [...new Set((input.product_keys ?? []).filter((key) => typeof key === 'string'))].sort();
  const requested_fields = [...new Set((input.fields ?? []).filter((key) => typeof key === 'string'))].sort();
  const requested_joins = [...new Set((input.join_route_ids ?? []).filter((key) => typeof key === 'string'))].sort();
  return freeze({
    question: input.question ?? null,
    generation: input.generation ?? LAST_GOOD_GENERATION,
    product_keys,
    fields: requested_fields,
    join_route_ids: requested_joins,
    require_products: freeze([...(input.require_products ?? [])].sort()),
    exclude_sources: freeze([...(input.exclude_sources ?? [])].sort()),
    analysis_requested: input.analysis_requested === true,
  });
}

export function compileMetadataPlan(input = {}, { activation = PLANNER_PUBLIC_ACTIVATION } = {}) {
  if (activation.plan_research_enabled === true) fail('PLANNER_PUBLIC_ACTIVATION_FORBIDDEN');
  const selections = canonicalSelections(input);
  if (selections.generation !== LAST_GOOD_GENERATION) fail('PLAN_GENERATION_NOT_LAST_GOOD', selections.generation);
  if (selections.analysis_requested) fail('ANALYSIS_OUTSIDE_INVOCATION');

  const named_gaps = [];
  const sources = [];
  const fields = [];
  const access_steps = [];
  const limitations = [];
  const citations = [];

  for (const key of selections.product_keys) {
    if (FORBIDDEN_PRODUCTS.includes(key) || !CATALOG[key]) {
      named_gaps.push(freeze({ kind: 'unknown_or_invented_source', product_key: key }));
      continue;
    }
    const product = CATALOG[key];
    if ((selections.exclude_sources ?? []).includes(product.source_id)) {
      named_gaps.push(freeze({ kind: 'excluded_source', product_key: key, source_id: product.source_id }));
      continue;
    }
    sources.push(freeze({ product_key: product.product_key, asset_id: product.asset_id, source_id: product.source_id }));
    access_steps.push(...product.access_steps);
    limitations.push(...product.limitations);
    citations.push(...product.citations);
    if (product.required_gap) named_gaps.push(freeze({ kind: product.required_gap, product_key: key }));
  }

  for (const required of selections.require_products) {
    if (!sources.some((source) => source.product_key === required)) {
      named_gaps.push(freeze({ kind: 'missing_required_source', product_key: required }));
    }
  }

  for (const field of selections.fields) {
    if (FORBIDDEN_FIELDS.includes(field)) {
      named_gaps.push(freeze({ kind: 'invented_field', field }));
      continue;
    }
    const owner = sources.find((source) => CATALOG[source.product_key].fields.includes(field));
    if (!owner) {
      named_gaps.push(freeze({ kind: 'undocumented_field', field }));
      continue;
    }
    fields.push(freeze({ field, product_key: owner.product_key }));
  }

  const join_inspection = inspectJoinRoutes({
    from_id: sources[0]?.asset_id,
    to_id: sources[1]?.asset_id ?? null,
    include_indirect: true,
    max_hops: 2,
  });
  const qualified_joins = [];
  for (const route_id of selections.join_route_ids) {
    if (FORBIDDEN_JOINS.includes(route_id) || route_id === 'ccn-equals-npi') {
      named_gaps.push(freeze({ kind: 'invented_or_forbidden_join', route_id }));
      continue;
    }
    const documented = join_inspection.routes.find((route) => route.route_id === route_id);
    if (!documented || documented.hop_count !== 1) {
      named_gaps.push(freeze({ kind: 'undocumented_or_uncomposed_join', route_id }));
      continue;
    }
    qualified_joins.push(freeze({
      route_id: documented.route_id,
      hop_count: 1,
      composed: false,
      ccn_equals_npi: false,
    }));
  }

  const uniqueGaps = [...new Map(named_gaps.map((gap) => [JSON.stringify(gap), gap])).values()];
  const uniqueLimitations = [...new Set(limitations)];
  const uniqueCitations = [...new Set(citations)];
  const status = uniqueGaps.length || !sources.length ? 'incomplete' : 'ready_with_constraints';
  const body = freeze({
    format: METADATA_PLAN_FORMAT,
    planner_acceptance_version: PLANNER_ACCEPTANCE_VERSION,
    generation: selections.generation,
    last_good_generation: LAST_GOOD_GENERATION,
    goal: selections.question,
    selections,
    status,
    sources: freeze(sources),
    fields: freeze(fields),
    access_steps: freeze(access_steps),
    qualified_joins: freeze(qualified_joins),
    two_hop_composition: freeze({ composed: false, compatible: false, reason: 'TWO_HOP_COMPOSITION_REQUIRES_SEPARATE_COMPATIBILITY' }),
    named_gaps: freeze(uniqueGaps),
    limitations: freeze(uniqueLimitations),
    citations: freeze(uniqueCitations),
    analysis_output: null,
    acquisition_executed: false,
    plan_research_enabled: false,
    study_design_certified: false,
    public_activation: PLANNER_PUBLIC_ACTIVATION,
  });
  return freeze({ ...body, plan_sha256: sha(body) });
}

export function assertNoInvention(plan) {
  if (!plan || plan.format !== METADATA_PLAN_FORMAT) fail('PLAN_FORMAT_INVALID');
  if (plan.analysis_output != null) fail('INVENTED_ANALYSIS_OUTPUT');
  if (plan.acquisition_executed !== false) fail('ACQUISITION_EXECUTED');
  if (plan.plan_research_enabled !== false) fail('PLANNER_ENABLED');
  if (plan.two_hop_composition?.composed === true) fail('TWO_HOP_COMPOSED');
  if (plan.qualified_joins.some((route) => route.ccn_equals_npi === true || route.hop_count !== 1)) fail('FORBIDDEN_JOIN');
  return true;
}
