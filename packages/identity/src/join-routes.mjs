import { assert, uniqueSorted } from "./common.mjs";

const OPERATIONS = new Set(["join", "crosswalk", "aggregate", "filter", "temporal_alignment", "measure_harmonization"]);
const EVIDENCE_STATES = ["unknown", "candidate", "ambiguous", "documented", "observed", "executed", "proven"];
const EXECUTION_EVIDENCE = new Set(["controlled_test", "external_execution"]);

function checkExecutionEvidence(step) {
  if (!["executed", "proven"].includes(step.evidence_state)) return;
  assert(step.execution_context, `${step.evidence_state} requires an execution context`, "execution_context_required");
  assert(step.execution_context.public_request === false, "Execution evidence can never claim a public user plan was run", "public_execution_claim");
  assert(EXECUTION_EVIDENCE.has(step.execution_context.kind), "Execution context must be controlled-test or external", "invalid_execution_context");
  assert(step.evidence.some((item) => item.evidence_id === step.execution_context.evidence_id && EXECUTION_EVIDENCE.has(item.evidence_class)), "Execution context must reference admissible execution evidence", "execution_evidence_required");
}

function deriveReadiness(step) {
  if (step.blockers.some((blocker) => blocker.state === "open")) return "blocked";
  if (step.requirements.some((requirement) => ["unsatisfied", "unknown"].includes(requirement.state))) return "blocked";
  if (step.compatibility !== "compatible") return step.compatibility === "incompatible" ? "blocked" : "unknown";
  if (EVIDENCE_STATES.indexOf(step.evidence_state) < EVIDENCE_STATES.indexOf("documented")) return "unknown";
  return "ready";
}

export function validateJoinRoute({ route, steps, schemaCatalog, namespaceIds = [] }) {
  const source = schemaCatalog.resolveEndpoint(route.source_endpoint);
  const target = schemaCatalog.resolveEndpoint(route.target_endpoint);
  assert(route.identity_context?.graph_revision_id && route.identity_context?.valid_at, "Join routes must pin an identity graph revision and valid date", "identity_context_required");
  assert(Array.isArray(route.identity_context.assertion_ids), "Join route identity assertion IDs are required", "identity_assertions_required");
  if (route.applicability?.start && route.applicability?.end) {
    assert(route.identity_context.valid_at >= route.applicability.start && route.identity_context.valid_at < route.applicability.end, "Identity valid_at must fall within route applicability", "identity_context_outside_applicability");
  }
  assert(steps.length === route.step_ids.length, "Join route steps must exactly match step_ids", "route_step_mismatch");
  assert(new Set(route.step_ids).size === route.step_ids.length && new Set(steps.map((step) => step.step_id)).size === steps.length, "Join step IDs must be unique", "duplicate_step_id");
  assert(canonicalIds(steps.map((step) => step.step_id)) === canonicalIds(route.step_ids), "Join route step IDs differ from supplied steps", "route_step_mismatch");
  const sequences = [...steps].sort((left, right) => left.sequence - right.sequence).map((step) => step.sequence);
  assert(sequences.every((sequence, index) => sequence === index + 1), "Transformation steps must have contiguous unique sequence numbers", "invalid_step_sequence");
  const sourceFieldIds = new Set([route.source_endpoint.schema_field_id]);
  const targetFieldIds = new Set([route.target_endpoint.schema_field_id]);

  for (const step of steps) {
    assert(step.route_id === route.route_id, "Transformation step belongs to another route", "step_route_mismatch");
    assert(OPERATIONS.has(step.operation_kind), "Unknown join operation kind", "invalid_operation_kind");
    assert(Array.isArray(step.evidence) && Array.isArray(step.requirements) && Array.isArray(step.blockers), "Evidence, requirements, and blockers are independent required axes", "missing_semantic_axis");
    assert(step.source_field_ids.every((id) => sourceFieldIds.has(id)), "Step source fields must pin the route's exact source field", "step_source_field_mismatch");
    assert(step.target_field_ids.every((id) => targetFieldIds.has(id)), "Step target fields must pin the route's exact target field", "step_target_field_mismatch");
    assert(step.source_grain === route.source_endpoint.grain && step.target_grain === route.target_endpoint.grain, "Step grains must match the exact route endpoints", "step_grain_mismatch");
    if (["join", "crosswalk"].includes(step.operation_kind)) {
      assert(step.identifier_namespace_id && namespaceIds.includes(step.identifier_namespace_id), "Join/crosswalk steps require a registered identifier namespace", "identifier_namespace_required");
    }
    if (step.operation_kind === "aggregate") {
      assert(step.source_grain !== step.target_grain, "Aggregation must declare a grain change", "aggregation_without_grain_change");
    }
    if (step.operation_kind === "crosswalk") {
      assert(step.evidence.some((item) => item.evidence_class === "authoritative_crosswalk" || item.evidence_class === "source_documentation"), "A crosswalk requires crosswalk/documentation evidence", "crosswalk_evidence_required");
    }
    if (step.evidence_state === "documented") {
      assert(step.evidence.some((item) => ["source_documentation", "authoritative_crosswalk", "schema_snapshot", "source_declared_lineage"].includes(item.evidence_class)), "Documented state requires documentary evidence", "documented_evidence_required");
    }
    checkExecutionEvidence(step);
    assert(step.derived_readiness === deriveReadiness(step), "derived_readiness must be computed from independent axes", "readiness_mismatch");
  }

  const grainChanges = steps.filter((step) => step.source_grain !== step.target_grain);
  if (grainChanges.length > 0) {
    assert(steps.some((step) => step.operation_kind === "aggregate") || steps.some((step) => step.requirements.some((item) => item.requirement_kind === "aggregation" && item.state === "satisfied")), "A crosswalk cannot substitute for required aggregation", "aggregation_required");
  }
  return { route, steps: [...steps].sort((left, right) => left.sequence - right.sequence), exact_fields: { source, target } };
}

function canonicalIds(ids) {
  return uniqueSorted(ids).join("\u0000");
}

export function deriveJoinReadiness(step) {
  return deriveReadiness(step);
}
