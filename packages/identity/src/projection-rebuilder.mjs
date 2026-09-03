import { REBUILD_TARGETS, assert, canonicalJson, orderedPair, sha256, stableId, uniqueSorted } from "./common.mjs";
import { currentDecisionByCandidate } from "./review-ledger.mjs";

const AUTOMATIC_CHECKS = Object.freeze([
  "different_objects",
  "same_namespace",
  "normalized_values_match",
  "normalization_verified",
  "registered_check_rule_passed",
  "check_passed",
  "active_assertions",
  "entity_type_compatible",
  "grain_compatible",
  "complete_intervals",
  "intervals_overlap",
  "uniqueness_known",
  "reuse_safe",
  "authority_eligible",
  "source_scope_eligible",
  "no_authoritative_conflict",
  "benchmark_gate",
  "enablement_receipt_authorized",
]);

class DisjointSet {
  constructor(ids) {
    this.parent = new Map(ids.map((id) => [id, id]));
  }

  find(id) {
    assert(this.parent.has(id), `Unknown identity object: ${id}`, "unknown_object");
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let current = id;
    while (this.parent.get(current) !== current) {
      const next = this.parent.get(current);
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    const [canonical, alias] = [leftRoot, rightRoot].sort((a, b) => a.localeCompare(b));
    this.parent.set(alias, canonical);
  }
}

export function automaticAssessmentIsBound(candidate, assessment, authorizedEnablementReceiptIds) {
  if (candidate.state !== "accepted" || candidate.resolution_mode !== "automatic_exact_policy") return false;
  if (candidate.object_a_id.localeCompare(candidate.object_b_id) >= 0
    || candidate.candidate_type !== "same_identity"
    || candidate.match_score !== 1
    || candidate.features?.length !== 1
    || candidate.features[0]?.feature_kind !== "exact_identifier"
    || candidate.conflicting_assertion_ids?.length !== 0
    || candidate.epistemic_confidence?.level !== "high") return false;
  if (candidate.candidate_id !== stableId("identity-candidate", {
    objectA: candidate.object_a_id,
    objectB: candidate.object_b_id,
    candidateType: candidate.candidate_type,
    algorithmVersion: candidate.algorithm_version,
    feature: candidate.features[0],
  })) return false;
  if (!assessment || assessment.candidate_id !== candidate.candidate_id
    || assessment.automatic_resolution_eligible !== true
    || typeof assessment.enablement_receipt_id !== "string"
    || !authorizedEnablementReceiptIds.includes(assessment.enablement_receipt_id)
    || !Array.isArray(assessment.reasons)
    || assessment.reasons.length !== 0) return false;
  return AUTOMATIC_CHECKS.every((name) => assessment.checks?.[name] === true)
    && Object.keys(assessment.checks ?? {}).every((name) => AUTOMATIC_CHECKS.includes(name));
}

function acceptedBasis(candidate, decisions, assessmentByCandidate, authorizedEnablementReceiptIds) {
  const decision = decisions.get(candidate.candidate_id);
  // A later human decision always outranks automatic acceptance. Only an
  // explicit current same_identity decision may collapse identity; defer,
  // not_same_identity, and every other current review outcome fail closed.
  if (decision) {
    if (decision.decision === "same_identity") return { kind: "review_decision", reference_id: decision.decision_id };
    return null;
  }
  if (candidate.state === "accepted" && candidate.resolution_mode === "automatic_exact_policy") {
    const assessment = assessmentByCandidate.get(candidate.candidate_id);
    if (!automaticAssessmentIsBound(candidate, assessment, authorizedEnablementReceiptIds)) return null;
    return { kind: "exact_authority_policy", reference_id: candidate.candidate_id };
  }
  return null;
}

function pairKey(left, right) {
  return orderedPair(left, right).join("\u0000");
}

function forbiddenEqualityPairs(candidates, decisions) {
  const forbidden = new Set();
  for (const candidate of candidates) {
    const decision = decisions.get(candidate.candidate_id);
    if (decision && decision.decision !== "same_identity") forbidden.add(pairKey(candidate.object_a_id, candidate.object_b_id));
  }
  return forbidden;
}

function applyUnions(objectIds, edges) {
  const sets = new DisjointSet(objectIds);
  for (const { candidate } of edges) sets.union(candidate.object_a_id, candidate.object_b_id);
  return sets;
}

function forbiddenPairSharesCluster(sets, forbidden) {
  for (const pair of forbidden) {
    const [left, right] = pair.split("\u0000");
    if (sets.find(left) === sets.find(right)) return true;
  }
  return false;
}

export function buildProjectionInputs({
  objects,
  candidates,
  reviewEvents = [],
  graphRevisionId,
  projectedAt,
  includeControlledFixtures = false,
  policyAssessments = [],
  authorizedEnablementReceiptIds = [],
  joinRouteIds = [],
  plannerFixtureIds = [],
}) {
  const objectIds = uniqueSorted(objects.map((object) => object.object_id));
  assert(objectIds.length === objects.length, "Identity object IDs must be unique", "duplicate_object");
  const objectById = new Map(objects.map((object) => [object.object_id, object]));
  const decisions = currentDecisionByCandidate(reviewEvents, { includeControlledFixtures });
  const candidateIds = new Set(candidates.map((candidate) => candidate.candidate_id));
  const assessmentByCandidate = new Map();
  for (const assessment of policyAssessments) {
    assert(!assessmentByCandidate.has(assessment.candidate_id), "Policy assessments must be unique by candidate", "duplicate_policy_assessment");
    assert(candidateIds.has(assessment.candidate_id), "Policy assessment must reference an existing candidate", "unknown_policy_assessment");
    assessmentByCandidate.set(assessment.candidate_id, assessment);
  }
  const forbidden = forbiddenEqualityPairs(candidates, decisions);
  const reviewEdges = [];
  const automaticEdges = [];
  const unresolvedByObject = new Map(objectIds.map((id) => [id, []]));

  for (const candidate of [...candidates].sort((left, right) => left.candidate_id.localeCompare(right.candidate_id))) {
    assert(objectById.has(candidate.object_a_id) && objectById.has(candidate.object_b_id), "Candidate endpoint does not exist", "unknown_candidate_endpoint");
    const basis = acceptedBasis(candidate, decisions, assessmentByCandidate, authorizedEnablementReceiptIds);
    if (basis?.kind === "review_decision") reviewEdges.push({ candidate, basis });
    else if (basis) automaticEdges.push({ candidate, basis });
    else if (["open", "deferred", "rejected"].includes(candidate.state)
      || (candidate.state === "accepted" && candidate.resolution_mode === "automatic_exact_policy")) {
      unresolvedByObject.get(candidate.object_a_id).push(candidate.candidate_id);
      unresolvedByObject.get(candidate.object_b_id).push(candidate.candidate_id);
    }
  }

  const reviewSets = applyUnions(objectIds, reviewEdges);
  assert(!forbiddenPairSharesCluster(reviewSets, forbidden), "A current non-merge review decision cannot share an identity cluster", "conflicting_identity_collapse");
  // Automatic unions are all-or-nothing inside a constraint conflict: if the
  // complete automatic set would make a forbidden pair equal, drop every
  // automatic edge rather than choosing an order-dependent spanning tree.
  const proposedAutomatic = forbiddenPairSharesCluster(applyUnions(objectIds, [...reviewEdges, ...automaticEdges]), forbidden)
    ? []
    : automaticEdges;
  const sets = applyUnions(objectIds, [...reviewEdges, ...proposedAutomatic]);
  assert(!forbiddenPairSharesCluster(sets, forbidden), "A current non-merge review decision cannot share an identity cluster", "conflicting_identity_collapse");
  const acceptedEdges = [...reviewEdges, ...proposedAutomatic];

  const memberGroups = new Map();
  for (const id of objectIds) {
    const root = sets.find(id);
    if (!memberGroups.has(root)) memberGroups.set(root, []);
    memberGroups.get(root).push(id);
  }
  const identityClusters = [...memberGroups.values()]
    .map((members) => {
      const sorted = uniqueSorted(members);
      return {
        cluster_id: stableId("identity-cluster", { graphRevisionId, members: sorted }),
        graph_revision_id: graphRevisionId,
        canonical_object_id: sorted[0],
        member_object_ids: sorted,
      };
    })
    .sort((left, right) => left.cluster_id.localeCompare(right.cluster_id));

  const clusterByMember = new Map(identityClusters.flatMap((cluster) => cluster.member_object_ids.map((id) => [id, cluster])));
  const aliases = objectIds.map((objectId) => ({
    alias_object_id: objectId,
    canonical_object_id: clusterByMember.get(objectId).canonical_object_id,
    cluster_id: clusterByMember.get(objectId).cluster_id,
    graph_revision_id: graphRevisionId,
  }));
  const searchProjections = identityClusters.map((cluster) => ({
    projection_id: stableId("identity-search", { graphRevisionId, clusterId: cluster.cluster_id }),
    canonical_object_id: cluster.canonical_object_id,
    cluster_id: cluster.cluster_id,
    member_object_ids: [...cluster.member_object_ids],
    unresolved_candidate_ids: uniqueSorted(cluster.member_object_ids.flatMap((objectId) => unresolvedByObject.get(objectId))),
    separately_searchable: cluster.member_object_ids.length === 1,
    source_objects: cluster.member_object_ids.map((objectId) => objectById.get(objectId)),
  }));
  const relationshipProjections = acceptedEdges.map(({ candidate, basis }) => ({
    schema_version: "identity.relationship-projection.v1.0.0",
    projection_id: stableId("identity-edge", { graphRevisionId, candidateId: candidate.candidate_id, basis }),
    graph_kind: "identity",
    relationship_type: "same_identity",
    object_a_id: candidate.object_a_id,
    object_b_id: candidate.object_b_id,
    basis,
    effective_interval: { start: null, end: null, bounds: "[)", completeness: "unknown" },
    evidence_ids: uniqueSorted(candidate.features.flatMap((feature) => feature.evidence_ids)),
    graph_revision_id: graphRevisionId,
    projected_at: projectedAt,
    state: "active",
    supersedes_projection_id: null,
    superseded_by_projection_id: null,
  }));
  const joinViews = uniqueSorted(joinRouteIds).map((routeId) => ({ route_id: routeId, graph_revision_id: graphRevisionId }));
  const planFixtures = uniqueSorted(plannerFixtureIds).map((fixtureId) => ({ fixture_id: fixtureId, graph_revision_id: graphRevisionId }));

  const output = {
    graph_revision_id: graphRevisionId,
    projected_at: projectedAt,
    identity_clusters: identityClusters,
    aliases,
    search_projections: searchProjections,
    relationship_projections: relationshipProjections,
    join_views: joinViews,
    plan_fixtures: planFixtures,
    retained_object_ids: objectIds,
  };
  return { ...output, output_sha256: sha256(output) };
}

export function buildReversalPlan({
  before,
  after,
  candidateId,
  supersededDecisionId,
  supersedingDecisionId,
  plannerFixtureIds,
  recordedAt,
}) {
  const beforeProjectionIds = new Set(before.relationship_projections.map((projection) => projection.projection_id));
  const afterProjectionIds = new Set(after.relationship_projections.map((projection) => projection.projection_id));
  const removed = [...beforeProjectionIds].filter((id) => !afterProjectionIds.has(id)).sort();
  assert(removed.length > 0, "A reversal plan must remove at least one derived relationship projection", "reversal_no_change");
  assert(canonicalJson(before.retained_object_ids) === canonicalJson(after.retained_object_ids), "A reversal must retain every source object", "destructive_reversal");
  return {
    schema_version: "identity.reversal-plan.v1.0.0",
    reversal_plan_id: stableId("identity-reversal", { supersededDecisionId, supersedingDecisionId, candidateId }),
    superseding_decision_id: supersedingDecisionId,
    superseded_decision_id: supersededDecisionId,
    candidate_id: candidateId,
    input_graph_revision_id: before.graph_revision_id,
    output_graph_revision_id: after.graph_revision_id,
    rebuild_targets: [...REBUILD_TARGETS],
    expected_removed_projection_ids: removed,
    expected_retained_object_ids: [...after.retained_object_ids],
    retain_source_observations: true,
    retain_identifier_assertions: true,
    destructive_deletes_allowed: false,
    orphaned_lineage_allowed: false,
    canonical_input_sha256: sha256({ before, supersededDecisionId, supersedingDecisionId }),
    expected_output_sha256: after.output_sha256,
    planner_fixture_ids: uniqueSorted(plannerFixtureIds),
    recorded_at: recordedAt,
  };
}
