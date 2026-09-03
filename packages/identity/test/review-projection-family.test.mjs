import test from "node:test";
import assert from "node:assert/strict";

import {
  appendReviewDecision,
  buildFamilyGraph,
  buildProjectionInputs,
  buildReversalPlan,
  buildReviewQueue,
  currentDecisionByCandidate,
  generateIdentityCandidates,
  materializeReviewDecisions,
  toContractReviewDecision,
} from "../src/index.mjs";
import { assertionFixture, enabledControlledNamespaceFixture, identityObjects, namespaceFixture, RECORDED_AT } from "../fixtures/production-shaped.mjs";

function decision(id, candidateId, outcome, supersedes = null) {
  return {
    schema_version: "identity.review-decision.v1.0.0",
    decision_id: id,
    candidate_id: candidateId,
    decision: outcome,
    reviewer: { reviewer_id: "reviewer:controlled.fixture", role: "controlled reversal test", human: true },
    rationale: "Controlled fixture decision used only to verify reversible projection mechanics.",
    evidence_ids: ["evidence:controlled.reversal"],
    algorithm_version: "1.0.0",
    decided_at: RECORDED_AT,
    recorded_at: RECORDED_AT,
    supersedes_decision_id: supersedes,
  };
}

test("review events append, supersede reciprocally, and controlled fixtures cannot become adjudication evidence", () => {
  const { candidates } = generateIdentityCandidates({
    assertions: [assertionFixture("alpha"), assertionFixture("beta")],
    namespaces: [namespaceFixture()],
    createdAt: RECORDED_AT,
  });
  const candidateId = candidates[0].candidate_id;
  let events = appendReviewDecision([], decision("decision:controlled.accept", candidateId, "same_identity"), { status: "controlled_fixture_not_adjudication_evidence" });
  assert.throws(() => appendReviewDecision(events, decision("decision:controlled.duplicate", candidateId, "same_identity"), { status: "controlled_fixture_not_adjudication_evidence" }), { code: "decision_not_current" });
  events = appendReviewDecision(events, decision("decision:controlled.reverse", candidateId, "not_same_identity", "decision:controlled.accept"), { status: "controlled_fixture_not_adjudication_evidence" });
  const materialized = materializeReviewDecisions(events);
  assert.equal(materialized.find((item) => item.decision_id === "decision:controlled.accept").state, "superseded");
  assert.equal(materialized.find((item) => item.decision_id === "decision:controlled.accept").superseded_by_decision_id, "decision:controlled.reverse");
  assert.equal(materialized.find((item) => item.decision_id === "decision:controlled.reverse").state, "current");
  assert.throws(() => toContractReviewDecision(events[0]), { code: "not_adjudication_evidence" });
  assert.throws(() => appendReviewDecision([], decision("decision:unattested.external", candidateId, "same_identity"), { status: "externally_verified_human_review" }), { code: "external_review_receipts_required" });
});

test("projection rebuild is deterministic, reversible, non-destructive, and keeps open candidates searchable", () => {
  const { candidates, assessments } = generateIdentityCandidates({
    assertions: [assertionFixture("alpha"), assertionFixture("beta")],
    namespaces: [namespaceFixture()],
    similaritySignals: [{ object_a_id: "object:facility.beta", object_b_id: "object:facility.gamma", feature_kind: "publisher_similarity", value: 0.8, match_score: 0.8, evidence_ids: ["evidence:publisher.similarity"] }],
    createdAt: RECORDED_AT,
  });
  const exact = candidates.find((candidate) => candidate.features[0].feature_kind === "exact_identifier");
  let acceptedEvents = appendReviewDecision([], decision("decision:controlled.accept", exact.candidate_id, "same_identity"), { status: "controlled_fixture_not_adjudication_evidence" });
  const before = buildProjectionInputs({ objects: identityObjects(), candidates, reviewEvents: acceptedEvents, graphRevisionId: "graph-revision:before", projectedAt: RECORDED_AT, includeControlledFixtures: true, plannerFixtureIds: ["plan-fixture:identity.reversal"] });
  const repeated = buildProjectionInputs({ objects: identityObjects(), candidates, reviewEvents: acceptedEvents, graphRevisionId: "graph-revision:before", projectedAt: RECORDED_AT, includeControlledFixtures: true, plannerFixtureIds: ["plan-fixture:identity.reversal"] });
  assert.equal(before.output_sha256, repeated.output_sha256);
  assert(before.identity_clusters.some((cluster) => cluster.member_object_ids.length === 2));
  assert.equal(before.search_projections.length, 2);
  assert(before.search_projections.some((projection) => projection.member_object_ids.length === 2 && projection.separately_searchable === false));
  assert(before.search_projections.find((projection) => projection.member_object_ids.includes("object:facility.gamma")).unresolved_candidate_ids.length === 1);

  acceptedEvents = appendReviewDecision(acceptedEvents, decision("decision:controlled.reverse", exact.candidate_id, "not_same_identity", "decision:controlled.accept"), { status: "controlled_fixture_not_adjudication_evidence" });
  const after = buildProjectionInputs({ objects: identityObjects(), candidates, reviewEvents: acceptedEvents, graphRevisionId: "graph-revision:after", projectedAt: RECORDED_AT, includeControlledFixtures: true, plannerFixtureIds: ["plan-fixture:identity.reversal"] });
  assert(after.identity_clusters.every((cluster) => cluster.member_object_ids.length === 1));
  assert.deepEqual(after.retained_object_ids, before.retained_object_ids);
  const reversal = buildReversalPlan({ before, after, candidateId: exact.candidate_id, supersededDecisionId: "decision:controlled.accept", supersedingDecisionId: "decision:controlled.reverse", plannerFixtureIds: ["plan-fixture:identity.reversal"], recordedAt: RECORDED_AT });
  assert.deepEqual(reversal.rebuild_targets, ["identity_clusters", "aliases", "search_projections", "join_views", "plan_fixtures"]);
  assert.equal(reversal.destructive_deletes_allowed, false);
  assert.equal(reversal.retain_source_observations, true);
  assert.equal(reversal.retain_identifier_assertions, true);

  const productionView = buildProjectionInputs({ objects: identityObjects(), candidates, reviewEvents: acceptedEvents.slice(0, 1), graphRevisionId: "graph-revision:production", projectedAt: RECORDED_AT });
  assert(productionView.identity_clusters.every((cluster) => cluster.member_object_ids.length === 1), "controlled review fixtures must be ignored in production mode");
  const queue = buildReviewQueue(candidates, { assessments });
  assert(queue.length >= 2);
  assert(queue.every((item) => item.state === "pending_external_review"));

  const deferredCandidate = candidates.find((candidate) => candidate.state === "open");
  const deferredEvents = appendReviewDecision([], decision("decision:controlled.defer", deferredCandidate.candidate_id, "defer"), { status: "controlled_fixture_not_adjudication_evidence" });
  const deferredQueue = buildReviewQueue(candidates, {
    assessments,
    currentDecisions: currentDecisionByCandidate(deferredEvents, { includeControlledFixtures: true }),
  });
  assert(deferredQueue.some((item) => item.candidate_id === deferredCandidate.candidate_id));
});

test("family relationships never collapse identity and unresolved members remain explicit", () => {
  const family = {
    schema_version: "identity.family.v1.0.0",
    family_id: "family:asset.editions",
    family_kind: "version",
    label: "Controlled asset editions",
    resolution_state: "review_pending",
    evidence_ids: ["evidence:family.fixture"],
    current_revision_id: "family-revision:asset.editions.1",
    recorded_at: RECORDED_AT,
  };
  const base = {
    schema_version: "identity.family-membership.v1.0.0",
    family_id: family.family_id,
    member_object_type: "release",
    relationship_type: "version_of",
    basis: { kind: "candidate", reference_id: "candidate:family.fixture" },
    effective_interval: { start: "2025-01-01", end: "2026-01-01", bounds: "[)", completeness: "complete" },
    evidence_ids: ["evidence:family.fixture"],
    state: "active",
    supersedes_membership_id: null,
    superseded_by_membership_id: null,
    recorded_at: RECORDED_AT,
  };
  const graph = buildFamilyGraph({
    families: [family],
    memberships: [
      { ...base, membership_id: "membership:edition.one", member_object_id: "release:edition.one", resolution_state: "accepted", basis: { kind: "review_decision", reference_id: "decision:family.one" } },
      { ...base, membership_id: "membership:edition.two", member_object_id: "release:edition.two", resolution_state: "candidate" },
    ],
    graphRevisionId: "graph-revision:family.1",
    projectedAt: RECORDED_AT,
  });
  assert.equal(graph.relationship_projections[0].graph_kind, "family");
  assert.equal(graph.relationship_projections[0].relationship_type, "version_of");
  assert.deepEqual(graph.unresolved_membership_ids, ["membership:edition.two"]);
});

test("automatic candidate state alone cannot collapse search without its authorized policy assessment", () => {
  const namespace = enabledControlledNamespaceFixture();
  const { candidates, assessments } = generateIdentityCandidates({
    assertions: [assertionFixture("alpha"), assertionFixture("beta")],
    namespaces: [namespace],
    authorizedEnablementReceiptIds: [namespace.benchmark_gate.enablement_receipt_id],
    createdAt: RECORDED_AT,
  });
  assert.equal(candidates[0].resolution_mode, "automatic_exact_policy");
  const withoutAssessment = buildProjectionInputs({ objects: identityObjects(), candidates, graphRevisionId: "graph-revision:auto-untrusted", projectedAt: RECORDED_AT });
  assert.equal(withoutAssessment.identity_clusters.length, 3);
  assert(withoutAssessment.search_projections.some((projection) => projection.unresolved_candidate_ids.includes(candidates[0].candidate_id)));
  const withAssessment = buildProjectionInputs({ objects: identityObjects(), candidates, policyAssessments: assessments, authorizedEnablementReceiptIds: [namespace.benchmark_gate.enablement_receipt_id], graphRevisionId: "graph-revision:auto-authorized", projectedAt: RECORDED_AT });
  assert.equal(withAssessment.identity_clusters.length, 2);
  assert(withAssessment.search_projections.some((projection) => projection.member_object_ids.length === 2 && projection.separately_searchable === false));
  const unboundQueue = buildReviewQueue(candidates, { assessments });
  assert(unboundQueue.some((item) => item.candidate_id === candidates[0].candidate_id));
  const authorizedQueue = buildReviewQueue(candidates, { assessments, authorizedEnablementReceiptIds: [namespace.benchmark_gate.enablement_receipt_id] });
  assert.equal(authorizedQueue.some((item) => item.candidate_id === candidates[0].candidate_id), false);
});

test("load path fails closed on duplicate current decisions instead of silently keeping one", () => {
  const { candidates } = generateIdentityCandidates({
    assertions: [assertionFixture("alpha"), assertionFixture("beta")],
    namespaces: [namespaceFixture()],
    createdAt: RECORDED_AT,
  });
  const candidateId = candidates[0].candidate_id;
  const first = decision("decision:controlled.first", candidateId, "same_identity");
  const second = decision("decision:controlled.second", candidateId, "not_same_identity");
  assert.throws(
    () => currentDecisionByCandidate([first, second], { includeControlledFixtures: true }),
    { code: "duplicate_current_decision" },
  );
  assert.throws(
    () => buildProjectionInputs({
      objects: identityObjects(),
      candidates,
      reviewEvents: [first, second],
      graphRevisionId: "graph-revision:duplicate-current",
      projectedAt: RECORDED_AT,
      includeControlledFixtures: true,
    }),
    { code: "duplicate_current_decision" },
  );
});

test("a later human not_same_identity or defer decision reverses automatic identity collapse", () => {
  const namespace = enabledControlledNamespaceFixture();
  const { candidates, assessments } = generateIdentityCandidates({
    assertions: [assertionFixture("alpha"), assertionFixture("beta")],
    namespaces: [namespace],
    authorizedEnablementReceiptIds: [namespace.benchmark_gate.enablement_receipt_id],
    createdAt: RECORDED_AT,
  });
  const automatic = candidates.find((candidate) => candidate.resolution_mode === "automatic_exact_policy");
  const merged = buildProjectionInputs({
    objects: identityObjects(),
    candidates,
    policyAssessments: assessments,
    authorizedEnablementReceiptIds: [namespace.benchmark_gate.enablement_receipt_id],
    graphRevisionId: "graph-revision:auto-before-reversal",
    projectedAt: RECORDED_AT,
  });
  assert.equal(merged.identity_clusters.length, 2);

  for (const outcome of ["not_same_identity", "defer"]) {
    const events = appendReviewDecision([], decision(`decision:controlled.${outcome}`, automatic.candidate_id, outcome), {
      status: "controlled_fixture_not_adjudication_evidence",
    });
    const reversed = buildProjectionInputs({
      objects: identityObjects(),
      candidates,
      reviewEvents: events,
      policyAssessments: assessments,
      authorizedEnablementReceiptIds: [namespace.benchmark_gate.enablement_receipt_id],
      graphRevisionId: `graph-revision:auto-reversed-${outcome}`,
      projectedAt: RECORDED_AT,
      includeControlledFixtures: true,
    });
    assert.equal(reversed.identity_clusters.length, 3, `${outcome} must unmerge automatic identity`);
    assert(reversed.relationship_projections.every((projection) => projection.object_a_id !== automatic.object_a_id || projection.object_b_id !== automatic.object_b_id));
    const queue = buildReviewQueue(candidates, {
      assessments,
      authorizedEnablementReceiptIds: [namespace.benchmark_gate.enablement_receipt_id],
      currentDecisions: currentDecisionByCandidate(events, { includeControlledFixtures: true }),
    });
    assert.equal(
      queue.some((item) => item.candidate_id === automatic.candidate_id),
      outcome === "defer",
      `${outcome} review-queue membership`,
    );
  }
});

test("automatic projection requires a candidate-bound, authorized, complete policy assessment", () => {
  const namespace = enabledControlledNamespaceFixture();
  const { candidates, assessments } = generateIdentityCandidates({
    assertions: [assertionFixture("alpha"), assertionFixture("beta")],
    namespaces: [namespace],
    authorizedEnablementReceiptIds: [namespace.benchmark_gate.enablement_receipt_id],
    createdAt: RECORDED_AT,
  });
  const forged = structuredClone(assessments);
  forged[0].checks = {};
  const projection = buildProjectionInputs({
    objects: identityObjects(),
    candidates,
    policyAssessments: forged,
    authorizedEnablementReceiptIds: [namespace.benchmark_gate.enablement_receipt_id],
    graphRevisionId: "graph-revision:auto-forged",
    projectedAt: RECORDED_AT,
  });
  assert.equal(projection.identity_clusters.length, 3);
  const unauthorized = buildProjectionInputs({
    objects: identityObjects(),
    candidates,
    policyAssessments: assessments,
    authorizedEnablementReceiptIds: ["enablement-receipt:forged"],
    graphRevisionId: "graph-revision:auto-forged-receipt",
    projectedAt: RECORDED_AT,
  });
  assert.equal(unauthorized.identity_clusters.length, 3);
});

test("a current non-merge decision blocks transitive automatic collapse of the same pair", () => {
  const namespace = enabledControlledNamespaceFixture();
  const enablement = namespace.benchmark_gate.enablement_receipt_id;
  const { candidates, assessments } = generateIdentityCandidates({
    assertions: ["alpha", "beta", "gamma"].map((suffix) => assertionFixture(suffix)),
    namespaces: [namespace],
    authorizedEnablementReceiptIds: [enablement],
    createdAt: RECORDED_AT,
  });
  const automatic = candidates.filter((candidate) => candidate.resolution_mode === "automatic_exact_policy");
  assert.equal(automatic.length, 3);
  const alphaGamma = automatic.find((candidate) => candidate.object_a_id === "object:facility.alpha" && candidate.object_b_id === "object:facility.gamma");
  const unconstrained = buildProjectionInputs({
    objects: identityObjects(),
    candidates,
    policyAssessments: assessments,
    authorizedEnablementReceiptIds: [enablement],
    graphRevisionId: "graph-revision:auto-three",
    projectedAt: RECORDED_AT,
  });
  assert.equal(unconstrained.identity_clusters.length, 1);

  for (const outcome of ["not_same_identity", "defer"]) {
    const events = appendReviewDecision([], decision(`decision:controlled.ac.${outcome}`, alphaGamma.candidate_id, outcome), {
      status: "controlled_fixture_not_adjudication_evidence",
    });
    const constrained = buildProjectionInputs({
      objects: identityObjects(),
      candidates,
      reviewEvents: events,
      policyAssessments: assessments,
      authorizedEnablementReceiptIds: [enablement],
      graphRevisionId: `graph-revision:auto-three-${outcome}`,
      projectedAt: RECORDED_AT,
      includeControlledFixtures: true,
    });
    assert.equal(constrained.identity_clusters.some((cluster) => (
      cluster.member_object_ids.includes("object:facility.alpha")
      && cluster.member_object_ids.includes("object:facility.gamma")
    )), false, `${outcome} must not allow alpha and gamma to share a cluster`);
    assert.equal(constrained.identity_clusters.length, 3, `${outcome} drops conflicting automatic transitivity`);
  }
});

test("load path fails closed on cross-candidate supersession instead of dropping the current decision", () => {
  const { candidates } = generateIdentityCandidates({
    assertions: [assertionFixture("alpha"), assertionFixture("beta")],
    namespaces: [namespaceFixture()],
    createdAt: RECORDED_AT,
  });
  const first = decision("decision:controlled.keep", candidates[0].candidate_id, "not_same_identity");
  const forged = decision("decision:controlled.forged", "candidate:missing", "same_identity", "decision:controlled.keep");
  assert.throws(
    () => materializeReviewDecisions([first, forged]),
    { code: "candidate_mismatch" },
  );
  assert.throws(
    () => currentDecisionByCandidate([first, forged], { includeControlledFixtures: true }),
    { code: "candidate_mismatch" },
  );
});

test("review queue fails closed on duplicate policy assessments", () => {
  const namespace = enabledControlledNamespaceFixture();
  const { candidates, assessments } = generateIdentityCandidates({
    assertions: [assertionFixture("alpha"), assertionFixture("beta")],
    namespaces: [namespace],
    createdAt: RECORDED_AT,
  });
  const duplicate = structuredClone(assessments[0]);
  duplicate.automatic_resolution_eligible = true;
  assert.throws(
    () => buildReviewQueue(candidates, { assessments: [...assessments, duplicate] }),
    { code: "duplicate_policy_assessment" },
  );
});
