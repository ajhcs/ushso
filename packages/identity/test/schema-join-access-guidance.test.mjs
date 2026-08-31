import test from "node:test";
import assert from "node:assert/strict";

import {
  ImmutableSchemaCatalog,
  classifyMachineReadiness,
  createAccessRecipe,
  createRetrievalRecipe,
  createUseCard,
  deriveAccessObservation,
  validateJoinRoute,
} from "../src/index.mjs";
import { joinFixture, RECORDED_AT, schemaFixture } from "../fixtures/production-shaped.mjs";

function catalogFixture() {
  const catalog = new ImmutableSchemaCatalog();
  const left = schemaFixture("left");
  const right = schemaFixture("right");
  catalog.registerSnapshot(left.snapshot, left.fields);
  catalog.registerSnapshot(right.snapshot, right.fields);
  return { catalog, left, right };
}

test("schema snapshots and fields are immutable and exact endpoint revisions are enforced", () => {
  const { catalog, left } = catalogFixture();
  catalog.registerSnapshot(left.snapshot, left.fields);
  assert.throws(() => catalog.registerSnapshot({ ...left.snapshot, release_id: "urn:ushso:release:mutated" }, left.fields), { code: "immutable_record_conflict" });
  const { route, steps } = joinFixture();
  const valid = validateJoinRoute({ route, steps, schemaCatalog: catalog, namespaceIds: ["namespace:cms.ccn"] });
  assert.equal(valid.exact_fields.source.field.revision_id, route.source_endpoint.field_revision_id);
  assert.throws(() => validateJoinRoute({ route: { ...route, source_endpoint: { ...route.source_endpoint, field_revision_id: "urn:ushso:revision:wrong" } }, steps, schemaCatalog: catalog, namespaceIds: ["namespace:cms.ccn"] }), { code: "endpoint_field_revision_mismatch" });
});

test("join operation, evidence, compatibility, requirements, and blockers remain orthogonal", () => {
  const { catalog } = catalogFixture();
  const { route, steps } = joinFixture();
  const blocked = [{ ...steps[0], blockers: [{ blocker_id: "blocker:identity", blocker_kind: "identity_unresolved", state: "open", description: "Parent/campus identity remains unresolved.", evidence_ids: [] }] }];
  assert.throws(() => validateJoinRoute({ route, steps: blocked, schemaCatalog: catalog, namespaceIds: ["namespace:cms.ccn"] }), { code: "readiness_mismatch" });
  const falseExecuted = [{ ...steps[0], evidence_state: "executed", derived_readiness: "ready" }];
  assert.throws(() => validateJoinRoute({ route, steps: falseExecuted, schemaCatalog: catalog, namespaceIds: ["namespace:cms.ccn"] }), { code: "execution_context_required" });
  const grainRoute = { ...route, source_endpoint: { ...route.source_endpoint, grain: "campus" } };
  const grainChange = [{ ...steps[0], source_grain: "campus", target_grain: "facility" }];
  assert.throws(() => validateJoinRoute({ route: grainRoute, steps: grainChange, schemaCatalog: catalog, namespaceIds: ["namespace:cms.ccn"] }), { code: "aggregation_required" });
});

test("access observations deterministically age to stale or unknown", () => {
  const observation = {
    observation_id: "urn:ushso:access-observation:route-1",
    access_route_id: "urn:ushso:access-route:route-1",
    clocks: { observed_at: "2026-01-01T00:00:00.000Z", recorded_at: "2026-01-01T00:00:01.000Z" },
    catalog_visibility_state: "visible",
    payload_access_state: "metadata_only",
    authorization_state: "not_required",
    infrastructure_state: "reachable",
    requirement_state: "documented",
    freshness_state: "current",
    stale_at: "2026-02-01T00:00:00.000Z",
    access_workflow_submitted: false,
    payloads_acquired: false,
    raw_payload_stored: false,
  };
  const stale = deriveAccessObservation({ accessRouteId: observation.access_route_id, observations: [observation], asOf: "2026-03-01T00:00:00.000Z" });
  assert.equal(stale.freshness_state, "stale");
  assert.equal(stale.payload_access_state, "stale");
  const unknown = deriveAccessObservation({ accessRouteId: "urn:ushso:access-route:missing", observations: [observation], asOf: "2026-03-01T00:00:00.000Z" });
  assert.equal(unknown.freshness_state, "unknown");
  const lateRecorded = { ...observation, observation_id: "urn:ushso:access-observation:late", access_route_id: "urn:ushso:access-route:late", clocks: { observed_at: "2026-01-01T00:00:00.000Z", recorded_at: "2026-04-01T00:00:00.000Z" } };
  assert.equal(deriveAccessObservation({ accessRouteId: lateRecorded.access_route_id, observations: [lateRecorded], asOf: "2026-03-01T00:00:00.000Z" }).freshness_state, "unknown");
});

test("Use Cards, Access Recipes, and Retrieval Recipes enforce recommendation-only boundaries", () => {
  const useCard = createUseCard({
    use_card_id: "use-card:controlled.asset",
    asset_id: "urn:ushso:asset:left",
    asset_revision_id: "urn:ushso:revision:asset-left-r1",
    best_for: ["Locating source-reported facility characteristics for a scoped research design."],
    not_sufficient_for: ["Calculating market share or producing a financial benchmark without additional analysis."],
    key_analytic_cautions: ["Facility and campus grains are not interchangeable."],
    typical_unit_of_observation: { grain: "facility", evidence_ids: ["evidence:use-card.fixture"] },
    known_breaks_in_series: ["Identifier changes require the effective-dated identity graph."],
    update_frequency: { category: "annual", evidence_ids: ["evidence:use-card.fixture"] },
    expected_lag: { category: "variable", evidence_ids: ["evidence:use-card.fixture"] },
    suppression_and_completeness_notes: ["Completeness is source-reported and must be checked per release."],
    identifier_stability_over_time: { state: "conditional", evidence_ids: ["evidence:use-card.fixture"] },
    measure_semantics: [{ measure: "facility_characteristic", kind: "source_reported", evidence_ids: ["evidence:use-card.fixture"] }],
    compatibility: [{ geography: "US", time: "2025", grain: "facility", state: "conditional", evidence_ids: ["evidence:use-card.fixture"] }],
    known_join_requirements: [{ route_id: "route:controlled.ccn", state: "conditional", requirement: "Use exact effective-dated CCN fields.", evidence_ids: ["evidence:use-card.fixture"] }],
    evidence_ids: ["evidence:use-card.fixture"],
    status: "pending_review",
    review_receipt_id: null,
    observed_at: RECORDED_AT,
  });
  assert.equal(useCard.truth_boundary.analysis_execution_allowed, false);
  assert.throws(() => createUseCard({ ...useCard, market_share: 0.5 }), { code: "product_boundary_violation" });

  const accessRecipe = createAccessRecipe({
    recipe_id: "access-recipe:controlled.asset",
    asset_id: "urn:ushso:asset:left",
    access_route_id: "urn:ushso:access-route:left",
    access_class: "application",
    who_qualifies: ["Researchers meeting the publisher's documented eligibility criteria."],
    request_process: [{ sequence: 1, actor: "human", instruction: "Review the publisher's current application instructions." }],
    human_authorization_gates: [{ gate: "publisher_approval", state: "required_unmet" }],
    turnaround: { category: "variable", point_estimate: null, evidence_ids: ["evidence:access.fixture"], observed_at: RECORDED_AT },
    fee_basis: { state: "unknown", description: "No evidenced fee schedule in the fixture." },
    delivery: { mechanism: "controlled_transfer", format: "publisher_defined" },
    required_inputs: ["Publisher-defined research request"],
    expected_artifacts: ["Application receipt", "Typed publisher decision"],
    stop_conditions: ["Stop before submission without explicit human authorization."],
    typed_failures: [{ outcome: "authorization_required", translate_to_not_found: false }],
    evidence_ids: ["evidence:access.fixture"],
    observed_at: RECORDED_AT,
  });
  assert.equal(accessRecipe.authorization.execution_allowed, false);

  const retrievalRecipe = createRetrievalRecipe({
    recipe_id: "retrieval-recipe:controlled.asset",
    asset_id: "urn:ushso:asset:left",
    release_id: "urn:ushso:release:left-2025",
    distribution_id: "urn:ushso:distribution:left-2025-csv",
    access_route_id: "urn:ushso:access-route:left",
    steps: [{ sequence: 1, instruction: "Inspect the evidence-pinned metadata and stop at any authorization gate.", execution_allowed: false, stop_conditions: ["Authorization is required", "Metadata does not match the pinned release"] }],
    expected_artifacts: ["metadata_receipt"],
    typed_failures: [{ outcome: "authorization_required", translate_to_not_found: false }],
    evidence_ids: ["evidence:retrieval.fixture"],
    observed_at: RECORDED_AT,
  });
  assert.equal(retrievalRecipe.boundary.payload_acquisition_claimed, false);
});

test("machine readiness publishes evidence-backed flags and no opaque quality score", () => {
  const evidence = { evidence_ids: ["evidence:readiness.fixture"], observed_at: RECORDED_AT };
  const readiness = classifyMachineReadiness({
    release_id: "urn:ushso:release:left-2025",
    distribution_id: "urn:ushso:distribution:left-2025-csv",
    flags: {
      interface: { state: "documented_api", ...evidence },
      authentication: { state: "not_required", ...evidence },
      schema: { state: "indexed", ...evidence },
      pagination: { state: "documented", ...evidence },
      recipe: { state: "available", ...evidence },
      verification: { state: "verified", ...evidence },
      join_evidence: { state: "compatible_documented", ...evidence },
    },
  });
  assert.equal(readiness.convenience_label, "join_ready");
  assert.equal(readiness.boundaries.analytical_quality_inferred, false);
  assert.equal(readiness.boundaries.authorization_inferred, false);
  assert.equal("score" in readiness, false);
  assert.throws(() => classifyMachineReadiness({
    release_id: readiness.release_id,
    distribution_id: readiness.distribution_id,
    flags: { ...readiness.flags, interface: { ...readiness.flags.interface, state: "opaque_score" } },
  }), { code: "invalid_readiness_flag" });
});
