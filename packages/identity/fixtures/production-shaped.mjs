const RECORDED_AT = "2026-08-30T00:00:00.000Z";

export function namespaceFixture(overrides = {}) {
  return {
    schema_version: "identity.identifier-namespace.v1.0.0",
    namespace_id: "namespace:cms.ccn",
    registry_revision_id: "namespace-revision:cms.ccn.1",
    display_name: "CMS Certification Number (controlled fixture)",
    issuing_authority: { organization_id: "organization:cms", name: "Centers for Medicare & Medicaid Services" },
    scope: { kind: "cross_source_authoritative", source_id: null },
    entity_types: ["hospital_facility"],
    grains: ["facility"],
    case_behavior: "numeric",
    normalization_steps: [
      { order: 1, operation: "trim", parameter: null },
      { order: 2, operation: "remove_punctuation", parameter: null },
      { order: 3, operation: "left_pad", parameter: "6" },
    ],
    check_rule: { kind: "regex", expression: "^[0-9]{6}$", version: "1.0.0" },
    uniqueness_policy: "unique_within_effective_period",
    reuse_policy: "prohibited",
    effective_date_policy: { complete_intervals_required_for_auto_resolution: true, overlap_required: true },
    benchmark_gate: {
      state: "disabled_candidate_only",
      stratum_id: "stratum:cms.ccn.facility",
      sealed_benchmark_id: null,
      adjudicated_positive_pairs: 0,
      hard_negative_pairs: 0,
      temporal_reuse_conflict_cases: 0,
      false_automatic_merges: 0,
      candidate_recall: null,
      enablement_receipt_id: null,
    },
    evidence_ids: ["evidence:cms.ccn.namespace"],
    lineage: { import_run_id: "import-run:fixture.identity", normalizer_version: "1.0.0", recorded_at: RECORDED_AT },
    ...overrides,
  };
}

export function enabledControlledNamespaceFixture() {
  return namespaceFixture({
    benchmark_gate: {
      state: "enabled",
      stratum_id: "stratum:controlled.ccn.facility",
      sealed_benchmark_id: "benchmark:controlled.ccn.v1",
      adjudicated_positive_pairs: 50,
      hard_negative_pairs: 50,
      temporal_reuse_conflict_cases: 20,
      false_automatic_merges: 0,
      candidate_recall: 0.96,
      enablement_receipt_id: "enablement-receipt:controlled.fixture.only",
    },
  });
}

export function assertionFixture(suffix, overrides = {}) {
  return {
    schema_version: "identity.identifier-assertion.v1.0.0",
    assertion_id: `assertion:ccn.${suffix}`,
    object_id: `object:facility.${suffix}`,
    namespace_id: "namespace:cms.ccn",
    source_id: `source:${suffix}`,
    raw_value: "123456",
    normalized_value: "123456",
    check_passed: true,
    authority_class: "authoritative",
    entity_type: "hospital_facility",
    grain: "facility",
    effective_interval: { start: "2020-01-01", end: "2021-01-01", bounds: "[)", completeness: "complete" },
    evidence_ids: [`evidence:ccn.${suffix}`],
    state: "active",
    supersedes_assertion_id: null,
    superseded_by_assertion_id: null,
    observed_at: RECORDED_AT,
    recorded_at: RECORDED_AT,
    ...overrides,
  };
}

export function identityObjects() {
  return ["alpha", "beta", "gamma"].map((suffix) => ({
    object_id: `object:facility.${suffix}`,
    entity_type: "hospital_facility",
    grain: "facility",
    title: `Controlled facility ${suffix}`,
    source_id: `source:${suffix}`,
  }));
}

function envelope(entityType, entityId, revisionId, entityScope) {
  return {
    contract_version: "observatory-core.v2.0.0",
    entity_type: entityType,
    entity_id: entityId,
    revision_id: revisionId,
    schema_version: "2.0.0",
    lifecycle_state: "active",
    canonical_content_fingerprint: `sha256:${"1".repeat(64)}`,
    native_identifiers: [{
      source_id: "urn:ushso:source:controlled-fixture",
      namespace: "controlled.fixture.identity",
      value: entityId,
      normalized_value: entityId,
      case_behavior: "sensitive",
      preservation: "exact",
      entity_scope: entityScope,
      authority: "source_native",
      uniqueness_policy: "source_scoped",
      effective_from: null,
      effective_to: null,
      evidence_ids: ["urn:ushso:evidence:schema-fixture"],
    }],
    legacy_aliases: [],
    clocks: { first_seen_at: RECORDED_AT, observed_at: RECORDED_AT, recorded_at: RECORDED_AT, publisher_released_at: null, publisher_modified_at: null, superseded_at: null },
    coverage_intervals: [],
    evidence_refs: [{
      evidence_id: "urn:ushso:evidence:schema-fixture",
      claim_paths: ["/entity_id"],
      observed_at: RECORDED_AT,
      evidence_state: "documented",
      staleness_state: "current",
      derivation_lineage: ["urn:ushso:evidence:schema-fixture"],
      review_status: "not_required",
      reviewed_at: null,
    }],
    assertion_refs: [],
    lineage: { connector_run_id: "urn:ushso:run:schema-fixture", normalizer: { name: "controlled-fixture", version: "1.0.0" }, import_id: null, derivation_parent_ids: [] },
    history: { append_only: true, supersedes_revision_ids: [], superseded_by_revision_id: null, rationale: null },
  };
}

export function schemaFixture(side) {
  const snapshotId = `urn:ushso:schema:${side}-2025`;
  const fieldId = `urn:ushso:field:${side}-ccn`;
  const snapshot = {
    ...envelope("SchemaSnapshot", snapshotId, `urn:ushso:revision:schema-${side}-2025-r1`, "schema"),
    schema_snapshot_id: snapshotId,
    release_id: `urn:ushso:release:${side}-2025`,
    distribution_id: `urn:ushso:distribution:${side}-2025-csv`,
    schema_digest: `sha256:${side === "left" ? "2" : "3"}${"0".repeat(63)}`,
    field_ids: [fieldId],
    immutable: true,
  };
  const field = {
    ...envelope("SchemaField", fieldId, `urn:ushso:revision:field-${side}-ccn-r1`, "field"),
    schema_field_id: fieldId,
    schema_snapshot_id: snapshotId,
    source_name: "CCN",
    ordinal: 0,
    source_data_type: "string",
    description: "Source-described facility certification identifier.",
    identifier_namespace: "cms.ccn",
    field_role: "identifier",
  };
  return { snapshot, fields: [field] };
}

export function joinFixture() {
  const route = {
    schema_version: "identity.join-route.v1.0.0",
    route_id: "route:controlled.ccn",
    revision_id: "route-revision:controlled.ccn.1",
    research_purpose: "Link controlled fixture releases at the facility grain using documented CCN fields.",
    source_endpoint: {
      object_id: "urn:ushso:asset:left",
      release_id: "urn:ushso:release:left-2025",
      distribution_id: "urn:ushso:distribution:left-2025-csv",
      schema_snapshot_id: "urn:ushso:schema:left-2025",
      schema_field_id: "urn:ushso:field:left-ccn",
      field_revision_id: "urn:ushso:revision:field-left-ccn-r1",
      entity_type: "hospital_facility",
      grain: "facility",
    },
    target_endpoint: {
      object_id: "urn:ushso:asset:right",
      release_id: "urn:ushso:release:right-2025",
      distribution_id: "urn:ushso:distribution:right-2025-csv",
      schema_snapshot_id: "urn:ushso:schema:right-2025",
      schema_field_id: "urn:ushso:field:right-ccn",
      field_revision_id: "urn:ushso:revision:field-right-ccn-r1",
      entity_type: "hospital_facility",
      grain: "facility",
    },
    applicability: { start: "2025-01-01", end: "2026-01-01", bounds: "[)", completeness: "complete" },
    identity_context: { graph_revision_id: "graph-revision:identity.2025", valid_at: "2025-06-30", assertion_ids: ["assertion:ccn.alpha"] },
    step_ids: ["step:controlled.ccn.join"],
    evidence_ids: ["evidence:join.documentation"],
    state: "active",
    supersedes_revision_id: null,
    superseded_by_revision_id: null,
    observed_at: RECORDED_AT,
    recorded_at: RECORDED_AT,
  };
  const steps = [{
    schema_version: "identity.transformation-step.v1.0.0",
    step_id: "step:controlled.ccn.join",
    route_id: route.route_id,
    sequence: 1,
    operation_kind: "join",
    source_field_ids: ["urn:ushso:field:left-ccn"],
    target_field_ids: ["urn:ushso:field:right-ccn"],
    source_grain: "facility",
    target_grain: "facility",
    identifier_namespace_id: "namespace:cms.ccn",
    direction: "source_to_target",
    cardinality: "one_to_one",
    lossiness: "lossless",
    evidence_state: "documented",
    compatibility: "compatible",
    evidence: [{ evidence_id: "evidence:join.documentation", evidence_class: "source_documentation", observed_at: RECORDED_AT, source_locator: "fixture://wp7/join-documentation" }],
    requirements: [],
    blockers: [],
    preconditions: ["Use the exact field revisions pinned by this route."],
    validation_checks: ["Reject duplicate normalized keys before joining."],
    execution_context: null,
    derived_readiness: "ready",
  }];
  return { route, steps };
}

export { RECORDED_AT };
