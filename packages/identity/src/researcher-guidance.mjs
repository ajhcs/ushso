import { assert, clone, deepFreeze, uniqueSorted } from "./common.mjs";

const ACCESS_CLASSES = new Set(["public", "registration", "application", "dua", "licensed", "paid", "unknown"]);
const TURNAROUND_CATEGORIES = new Set(["immediate", "days", "weeks", "months", "variable", "unknown", "not_applicable"]);
const TYPED_FAILURES = new Set([
  "authorization_required",
  "authentication_required",
  "registration_required",
  "application_required",
  "dua_required",
  "payment_required",
  "license_required",
  "rate_limited",
  "timed_out",
  "transport_failure",
  "malformed_response",
  "cancelled",
  "unavailable",
  "unresolved",
]);
const READINESS_STATES = Object.freeze({
  interface: new Set(["human_readable_only", "direct_download", "documented_api", "query_service", "unknown"]),
  authentication: new Set(["not_required", "required", "unknown"]),
  schema: new Set(["none", "documented", "indexed", "unknown"]),
  pagination: new Set(["not_applicable", "documented", "undocumented", "unknown"]),
  recipe: new Set(["none", "candidate", "available", "unknown"]),
  verification: new Set(["unverified", "verified", "stale", "unknown"]),
  join_evidence: new Set(["none", "candidate", "compatible_documented", "blocked", "unknown"]),
});

function requireEvidence(item, label) {
  assert(Array.isArray(item.evidence_ids) && item.evidence_ids.length > 0, `${label} requires evidence`, "evidence_required");
  assert(typeof item.observed_at === "string" && Number.isFinite(Date.parse(item.observed_at)), `${label} requires an observation time`, "observation_time_required");
}

function assertNoAnalyticsOrExecution(value, path = "$") {
  if (!value || typeof value !== "object") return;
  const forbidden = new Set(["analysis_result", "market_share", "financial_benchmark", "computed_estimate", "execute_analysis", "payload_acquired"]);
  for (const [key, child] of Object.entries(value)) {
    assert(!forbidden.has(key), `${path}.${key} crosses the recommendation-only boundary`, "product_boundary_violation");
    assertNoAnalyticsOrExecution(child, `${path}.${key}`);
  }
}

export function createUseCard(input) {
  const requiredNarratives = ["best_for", "not_sufficient_for", "key_analytic_cautions", "known_breaks_in_series", "suppression_and_completeness_notes"];
  for (const field of requiredNarratives) assert(Array.isArray(input[field]) && input[field].length > 0, `Use Card ${field} is required`, "incomplete_use_card");
  assert(input.typical_unit_of_observation?.grain, "Use Card requires a typical unit/grain", "incomplete_use_card");
  assert(input.update_frequency && input.expected_lag, "Use Card requires update frequency and expected lag", "incomplete_use_card");
  assert(input.identifier_stability_over_time, "Use Card requires identifier stability guidance", "incomplete_use_card");
  assert(Array.isArray(input.measure_semantics) && input.measure_semantics.length > 0, "Use Card must distinguish source-reported, derived, and proxy measures", "incomplete_use_card");
  assert(Array.isArray(input.compatibility) && input.compatibility.length > 0, "Use Card requires geography/time/grain compatibility", "incomplete_use_card");
  assert(Array.isArray(input.known_join_requirements), "Use Card join requirements must be explicit, including an empty evidenced list", "incomplete_use_card");
  assert(Array.isArray(input.evidence_ids) && input.evidence_ids.length > 0, "Use Card evidence is required", "evidence_required");
  assert(input.status !== "reviewed" || input.review_receipt_id, "Reviewed status requires a review receipt", "review_receipt_required");
  const card = {
    ...clone(input),
    schema_version: "identity.researcher-use-card.v1.0.0",
    evidence_ids: uniqueSorted(input.evidence_ids),
    immutable: true,
    truth_boundary: {
      source_truth_separate: true,
      analytical_fit_is_curated: true,
      source_reported_derived_proxy_separate: true,
      analysis_execution_allowed: false,
    },
  };
  assertNoAnalyticsOrExecution(card);
  return deepFreeze(card);
}

export function createAccessRecipe(input) {
  assert(ACCESS_CLASSES.has(input.access_class), "Access recipe requires a typed access class", "invalid_access_class");
  assert(Array.isArray(input.who_qualifies) && input.who_qualifies.length > 0, "Access recipe requires qualification guidance", "incomplete_access_recipe");
  assert(Array.isArray(input.request_process) && input.request_process.length > 0, "Access recipe requires an ordered request process", "incomplete_access_recipe");
  assert(Array.isArray(input.human_authorization_gates), "Human authorization gates must be explicit", "incomplete_access_recipe");
  assert(TURNAROUND_CATEGORIES.has(input.turnaround?.category), "Turnaround must use an approximate category", "invalid_turnaround");
  assert(input.turnaround.point_estimate == null, "Access recipes cannot invent turnaround point estimates", "invented_point_estimate");
  assert(input.fee_basis && input.delivery && input.required_inputs, "Fee, delivery, and required inputs must be explicit", "incomplete_access_recipe");
  assert(Array.isArray(input.expected_artifacts) && input.expected_artifacts.length > 0, "Expected artifacts are required", "incomplete_access_recipe");
  assert(Array.isArray(input.stop_conditions) && input.stop_conditions.length > 0, "Stop conditions are required", "incomplete_access_recipe");
  assert(Array.isArray(input.typed_failures) && input.typed_failures.length > 0, "Typed failures are required", "incomplete_access_recipe");
  for (const failure of input.typed_failures) {
    assert(TYPED_FAILURES.has(failure.outcome), `Unknown typed failure: ${failure.outcome}`, "invalid_typed_failure");
    assert(failure.translate_to_not_found === false, "Access failures cannot be translated to not_found", "failure_translation_forbidden");
  }
  requireEvidence(input.turnaround, "turnaround");
  const recipe = {
    ...clone(input),
    schema_version: "identity.access-recipe.v1.0.0",
    immutable: true,
    authorization: {
      acquired_by_ushso: false,
      public_route_is_authorization: false,
      execution_allowed: false,
      access_workflow_submission_allowed: false,
    },
  };
  assertNoAnalyticsOrExecution(recipe);
  return deepFreeze(recipe);
}

export function createRetrievalRecipe(input) {
  assert(input.asset_id && input.release_id && input.distribution_id && input.access_route_id, "Retrieval recipe must pin asset, release, distribution, and access route", "inexact_retrieval_recipe");
  assert(Array.isArray(input.steps) && input.steps.length > 0, "Retrieval recipe requires bounded ordered steps", "incomplete_retrieval_recipe");
  const sequences = [...input.steps].sort((left, right) => left.sequence - right.sequence).map((step) => step.sequence);
  assert(sequences.every((value, index) => value === index + 1), "Retrieval steps must be contiguous and ordered", "invalid_retrieval_sequence");
  assert(input.steps.every((step) => step.execution_allowed === false), "Recipes explain retrieval but do not authorize execution", "retrieval_execution_forbidden");
  assert(input.steps.every((step) => Array.isArray(step.stop_conditions)), "Every retrieval step requires explicit stop conditions", "retrieval_stop_conditions_required");
  assert(Array.isArray(input.expected_artifacts) && input.expected_artifacts.length > 0, "Retrieval recipe requires expected artifacts", "incomplete_retrieval_recipe");
  assert(Array.isArray(input.typed_failures) && input.typed_failures.length > 0, "Retrieval recipe requires typed failure outcomes", "incomplete_retrieval_recipe");
  for (const failure of input.typed_failures) {
    assert(TYPED_FAILURES.has(failure.outcome) && failure.translate_to_not_found === false, "Retrieval failures must remain typed and cannot become not_found", "invalid_typed_failure");
  }
  const recipe = {
    ...clone(input),
    schema_version: "identity.retrieval-recipe.v1.0.0",
    immutable: true,
    boundary: {
      execution_allowed: false,
      payload_acquisition_claimed: false,
      authorization_claimed: false,
    },
  };
  assertNoAnalyticsOrExecution(recipe);
  return deepFreeze(recipe);
}

export function classifyMachineReadiness(input) {
  const requiredFlags = ["interface", "authentication", "schema", "pagination", "recipe", "verification", "join_evidence"];
  for (const flag of requiredFlags) {
    assert(input.flags?.[flag], `Machine-readiness flag ${flag} is required`, "missing_readiness_flag");
    assert(READINESS_STATES[flag].has(input.flags[flag].state), `Machine-readiness flag ${flag} has an unknown state`, "invalid_readiness_flag");
    requireEvidence(input.flags[flag], `machine-readiness.${flag}`);
  }
  const state = (flag) => input.flags[flag].state;
  let label = "human_only";
  if (["direct_download", "documented_api", "query_service"].includes(state("interface"))) label = state("interface") === "direct_download" ? "downloadable" : "api_documented";
  if (label !== "human_only" && state("schema") === "indexed") label = "schema_indexed";
  if (state("recipe") === "available" && state("verification") === "verified") label = "retrieval_ready";
  if (label === "retrieval_ready" && state("join_evidence") === "compatible_documented") label = "join_ready";
  return deepFreeze({
    schema_version: "identity.machine-readiness.v1.0.0",
    release_id: input.release_id,
    distribution_id: input.distribution_id,
    flags: clone(input.flags),
    convenience_label: label,
    evidence_ids: uniqueSorted(Object.values(input.flags).flatMap((flag) => flag.evidence_ids)),
    observed_at: [...Object.values(input.flags).map((flag) => flag.observed_at)].sort().at(-1),
    boundaries: {
      analytical_quality_inferred: false,
      authorization_inferred: false,
      opaque_score_used: false,
    },
  });
}
