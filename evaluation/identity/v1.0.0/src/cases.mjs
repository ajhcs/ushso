import { canonicalJson, sha256 } from "../../../../packages/identity/src/common.mjs";

const CATEGORY_COUNTS = Object.freeze({ positive: 50, hard_negative: 50, temporal_reuse_conflict: 20 });

function pad(value, width = 4) {
  return String(value).padStart(width, "0");
}

function namespaceFor(stratum) {
  return {
    schema_version: "identity.identifier-namespace.v1.0.0",
    namespace_id: `namespace:${stratum.namespace_kind}.benchmark`,
    registry_revision_id: `namespace-revision:${stratum.namespace_kind}.benchmark.1`,
    display_name: `${stratum.namespace_kind} sealed-shape fixture namespace`,
    issuing_authority: { organization_id: `organization:${stratum.namespace_kind}.fixture`, name: "Controlled benchmark fixture authority" },
    scope: { kind: "cross_source_authoritative", source_id: null },
    entity_types: [stratum.entity_type],
    grains: [stratum.grain],
    case_behavior: "fold_upper",
    normalization_steps: [{ order: 1, operation: "trim", parameter: null }, { order: 2, operation: "case_fold", parameter: null }],
    check_rule: { kind: "regex", expression: "^[A-Z0-9-]{4,40}$", version: "1.0.0" },
    uniqueness_policy: "unique_within_effective_period",
    reuse_policy: stratum.namespace_kind === "state_license" ? "known_reuse" : "prohibited",
    effective_date_policy: { complete_intervals_required_for_auto_resolution: true, overlap_required: true },
    benchmark_gate: {
      state: "disabled_candidate_only",
      stratum_id: stratum.stratum_id,
      sealed_benchmark_id: "identity-benchmark:wp7.conformance.v1",
      adjudicated_positive_pairs: 0,
      hard_negative_pairs: 0,
      temporal_reuse_conflict_cases: 0,
      false_automatic_merges: 0,
      candidate_recall: null,
      enablement_receipt_id: null,
    },
    evidence_ids: [`evidence:benchmark.namespace.${stratum.namespace_kind}`],
    lineage: { import_run_id: "import-run:identity.benchmark.v1", normalizer_version: "1.0.0", recorded_at: "2026-08-30T00:00:00.000Z" },
  };
}

function assertion({ id, objectId, namespace, sourceId, value, entityType, grain, interval, authorityClass = "authoritative" }) {
  return {
    schema_version: "identity.identifier-assertion.v1.0.0",
    assertion_id: id,
    object_id: objectId,
    namespace_id: namespace.namespace_id,
    source_id: sourceId,
    raw_value: value,
    normalized_value: value,
    check_passed: true,
    authority_class: authorityClass,
    entity_type: entityType,
    grain,
    effective_interval: interval,
    evidence_ids: [`evidence:${id.replaceAll(":", ".")}`],
    state: "active",
    supersedes_assertion_id: null,
    superseded_by_assertion_id: null,
    observed_at: "2026-08-30T00:00:00.000Z",
    recorded_at: "2026-08-30T00:00:00.000Z",
  };
}

function buildCase(stratum, category, ordinal) {
  const token = `${stratum.namespace_kind.toUpperCase()}-${pad(ordinal)}`;
  const caseId = `benchmark-case:${stratum.namespace_kind}.${category}.${pad(ordinal)}`;
  const namespace = namespaceFor(stratum);
  const common = {
    benchmark_case_id: caseId,
    stratum_id: stratum.stratum_id,
    category,
    adjudication_status: "pending_external_double_review",
    reviewer_a: null,
    reviewer_b: null,
    adjudicated_label: null,
    synthetic_expectation_is_adjudication: false,
    production_rule_eligible: false,
    namespace,
  };
  const baseInterval = { start: "2020-01-01", end: "2021-01-01", bounds: "[)", completeness: "complete" };
  const left = assertion({ id: `assertion:${caseId}.a`, objectId: `object:${caseId}.a`, namespace, sourceId: "source:benchmark.a", value: token, entityType: stratum.entity_type, grain: stratum.grain, interval: baseInterval });
  let right = assertion({ id: `assertion:${caseId}.b`, objectId: `object:${caseId}.b`, namespace, sourceId: "source:benchmark.b", value: token, entityType: stratum.entity_type, grain: stratum.grain, interval: baseInterval });
  let conflictAssertions = [];
  let scenarioKind = "exact_positive";
  let syntheticExpectedRelationship = "same_identity";
  let similaritySignal = null;

  if (category === "hard_negative") {
    scenarioKind = ordinal % 3 === 0 ? "parent_campus_system_ambiguity" : ordinal % 3 === 1 ? "same_name_different_identifier" : "entity_or_grain_mismatch";
    syntheticExpectedRelationship = "not_same_identity";
    right = { ...right, raw_value: `${token}-B`, normalized_value: `${token}-B` };
    if (scenarioKind === "entity_or_grain_mismatch") {
      right = { ...right, entity_type: stratum.entity_type === "hospital_facility" ? "hospital_campus" : stratum.entity_type, grain: stratum.grain === "facility" ? "campus" : stratum.grain };
    }
    similaritySignal = {
      object_a_id: left.object_id,
      object_b_id: right.object_id,
      feature_kind: scenarioKind === "parent_campus_system_ambiguity" ? "semantic_similarity" : "title_similarity",
      value: 0.98,
      match_score: 0.98,
      evidence_ids: [`evidence:${caseId}.similarity`],
    };
  }
  if (category === "temporal_reuse_conflict") {
    const kind = ordinal % 3;
    scenarioKind = kind === 0 ? "non_overlapping_effective_period" : kind === 1 ? "identifier_reuse_or_incomplete_dates" : "conflicting_authoritative_identifier";
    syntheticExpectedRelationship = "requires_review";
    if (kind === 0) right = { ...right, effective_interval: { start: "2022-01-01", end: "2023-01-01", bounds: "[)", completeness: "complete" } };
    if (kind === 1) right = { ...right, effective_interval: { start: "2020-01-01", end: null, bounds: "[)", completeness: "open_end" } };
    if (kind === 2) {
      conflictAssertions = [assertion({ id: `assertion:${caseId}.conflict`, objectId: left.object_id, namespace, sourceId: "source:benchmark.registry", value: `${token}-X`, entityType: stratum.entity_type, grain: stratum.grain, interval: baseInterval })];
    }
  }
  return {
    ...common,
    scenario_kind: scenarioKind,
    synthetic_expected_relationship: syntheticExpectedRelationship,
    assertions: [left, right, ...conflictAssertions],
    similarity_signal: similaritySignal,
  };
}

export function buildBenchmarkCases(manifest) {
  return manifest.launch_critical_strata.flatMap((stratum) => Object.entries(CATEGORY_COUNTS).flatMap(([category, count]) =>
    Array.from({ length: count }, (_, index) => buildCase(stratum, category, index + 1))));
}

export function benchmarkCaseDigest(cases) {
  return sha256(canonicalJson(cases));
}

export { CATEGORY_COUNTS };
