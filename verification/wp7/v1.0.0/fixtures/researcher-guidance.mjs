export const observedAt = "2026-08-30T00:00:00.000Z";

export function useCardInput() {
  return {
    use_card_id: "use-card:verification.facility",
    asset_id: "urn:ushso:asset:left",
    asset_revision_id: "urn:ushso:revision:asset-left-r1",
    best_for: ["Selecting a source-reported facility directory for an evidence-bound research design."],
    not_sufficient_for: ["Calculating market share, performing analysis, or producing a financial benchmark."],
    key_analytic_cautions: ["Facility, campus, legal filer, and consolidated system grains are not interchangeable."],
    typical_unit_of_observation: { grain: "facility", evidence_ids: ["evidence:guidance.verification"] },
    known_breaks_in_series: ["Effective-dated identifiers can change and unresolved transitions require review."],
    update_frequency: { category: "annual", evidence_ids: ["evidence:guidance.verification"] },
    expected_lag: { category: "variable", evidence_ids: ["evidence:guidance.verification"] },
    suppression_and_completeness_notes: ["Confirm source-reported completeness and suppression for the exact release."],
    identifier_stability_over_time: { state: "conditional", evidence_ids: ["evidence:guidance.verification"] },
    measure_semantics: [{ measure: "facility_characteristic", kind: "source_reported", evidence_ids: ["evidence:guidance.verification"] }],
    compatibility: [{ geography: "US", time: "2025", grain: "facility", state: "conditional", evidence_ids: ["evidence:guidance.verification"] }],
    known_join_requirements: [{ route_id: "route:controlled.ccn", state: "conditional", requirement: "Use the exact effective-dated field revisions.", evidence_ids: ["evidence:guidance.verification"] }],
    evidence_ids: ["evidence:guidance.verification"],
    status: "pending_review",
    review_receipt_id: null,
    observed_at: observedAt,
  };
}

export function accessRecipeInput() {
  return {
    recipe_id: "access-recipe:verification.facility",
    asset_id: "urn:ushso:asset:left",
    access_route_id: "urn:ushso:access-route:left",
    access_class: "application",
    who_qualifies: ["Researchers who meet the publisher's current documented criteria."],
    request_process: [{ sequence: 1, actor: "human", instruction: "Review the evidence-pinned publisher instructions." }],
    human_authorization_gates: [{ gate: "publisher_approval", state: "required_unmet" }],
    turnaround: { category: "variable", point_estimate: null, evidence_ids: ["evidence:access.verification"], observed_at: observedAt },
    fee_basis: { state: "unknown", description: "No evidenced fee schedule is present." },
    delivery: { mechanism: "controlled_transfer", format: "publisher_defined" },
    required_inputs: ["Publisher-defined research request"],
    expected_artifacts: ["Application receipt", "Typed publisher decision"],
    stop_conditions: ["Stop before submission without explicit human authorization."],
    typed_failures: [{ outcome: "authorization_required", translate_to_not_found: false }],
    evidence_ids: ["evidence:access.verification"],
    observed_at: observedAt,
  };
}

export function retrievalRecipeInput() {
  return {
    recipe_id: "retrieval-recipe:verification.facility",
    asset_id: "urn:ushso:asset:left",
    release_id: "urn:ushso:release:left-2025",
    distribution_id: "urn:ushso:distribution:left-2025-csv",
    access_route_id: "urn:ushso:access-route:left",
    steps: [{ sequence: 1, instruction: "Inspect pinned metadata and stop at any authorization or release mismatch.", execution_allowed: false, stop_conditions: ["Authorization required", "Pinned release mismatch"] }],
    expected_artifacts: ["metadata_receipt"],
    typed_failures: [{ outcome: "authorization_required", translate_to_not_found: false }],
    evidence_ids: ["evidence:retrieval.verification"],
    observed_at: observedAt,
  };
}

export function readinessInput() {
  const evidence = { evidence_ids: ["evidence:readiness.verification"], observed_at: observedAt };
  return {
    release_id: "urn:ushso:release:left-2025",
    distribution_id: "urn:ushso:distribution:left-2025-csv",
    flags: {
      interface: { state: "documented_api", ...evidence },
      authentication: { state: "not_required", ...evidence },
      schema: { state: "indexed", ...evidence },
      pagination: { state: "documented", ...evidence },
      recipe: { state: "available", ...evidence },
      verification: { state: "verified", ...evidence },
      join_evidence: { state: "compatible_documented", ...evidence }
    }
  };
}
