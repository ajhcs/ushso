import { assert, stableId, uniqueSorted } from "./common.mjs";

const RELATIONSHIP_KINDS = new Set(["family_member", "mirror_of", "successor_of", "version_of", "format_variant_of", "collection_member"]);
const FAMILY_RELATIONSHIPS = Object.freeze({
  version: new Set(["version_of"]),
  mirror: new Set(["mirror_of"]),
  successor: new Set(["successor_of"]),
  format: new Set(["format_variant_of"]),
  collection: new Set(["collection_member", "family_member"]),
});

function assertNoSuccessorCycle(edges) {
  const outbound = new Map();
  for (const edge of edges.filter((item) => item.relationship_type === "successor_of")) {
    if (!outbound.has(edge.object_a_id)) outbound.set(edge.object_a_id, []);
    outbound.get(edge.object_a_id).push(edge.object_b_id);
  }
  const visited = new Set();
  const active = new Set();
  const visit = (id) => {
    if (active.has(id)) throw Object.assign(new Error("Successor relationships must be acyclic"), { code: "successor_cycle" });
    if (visited.has(id)) return;
    active.add(id);
    for (const next of outbound.get(id) ?? []) visit(next);
    active.delete(id);
    visited.add(id);
  };
  for (const id of outbound.keys()) visit(id);
}

export function buildFamilyGraph({ families, memberships, graphRevisionId, projectedAt }) {
  const familyById = new Map(families.map((family) => [family.family_id, family]));
  assert(familyById.size === families.length, "Family IDs must be unique", "duplicate_family");
  const activeMemberships = memberships.filter((membership) => membership.state === "active" && membership.resolution_state !== "rejected");
  for (const membership of activeMemberships) {
    assert(familyById.has(membership.family_id), `Unknown family: ${membership.family_id}`, "unknown_family");
    assert(RELATIONSHIP_KINDS.has(membership.relationship_type), "Identity equality does not belong in the family graph", "identity_family_conflation");
    assert(membership.member_object_id !== membership.family_id, "A family cannot contain itself", "family_self_reference");
    assert(FAMILY_RELATIONSHIPS[familyById.get(membership.family_id).family_kind]?.has(membership.relationship_type), "Membership relationship does not match the family kind", "family_kind_mismatch");
  }

  const membersByFamily = new Map(families.map((family) => [family.family_id, []]));
  for (const membership of activeMemberships) membersByFamily.get(membership.family_id).push(membership);
  const projections = [];
  for (const [familyId, members] of membersByFamily) {
    const accepted = members.filter((membership) => membership.resolution_state === "accepted");
    for (const membership of accepted) {
      assert(["review_decision", "source_declared_lineage"].includes(membership.basis.kind), "Accepted family membership needs reviewed or exact source-declared lineage", "unaccepted_family_basis");
      const projectionBasis = membership.basis.kind === "review_decision"
        ? membership.basis
        : { kind: "exact_authority_policy", reference_id: membership.basis.reference_id };
      projections.push({
        projection_id: stableId("family-edge", { graphRevisionId, membershipId: membership.membership_id }),
        graph_kind: "family",
        relationship_type: membership.relationship_type,
        object_a_id: membership.member_object_id,
        object_b_id: familyId,
        basis: projectionBasis,
        effective_interval: membership.effective_interval,
        evidence_ids: uniqueSorted(membership.evidence_ids),
        graph_revision_id: graphRevisionId,
        projected_at: projectedAt,
        state: "active",
        supersedes_projection_id: null,
        superseded_by_projection_id: null,
      });
    }
  }
  assertNoSuccessorCycle(projections);
  return {
    graph_revision_id: graphRevisionId,
    families: [...families].sort((left, right) => left.family_id.localeCompare(right.family_id)),
    memberships: [...activeMemberships].sort((left, right) => left.membership_id.localeCompare(right.membership_id)),
    relationship_projections: projections.sort((left, right) => left.projection_id.localeCompare(right.projection_id)),
    unresolved_membership_ids: uniqueSorted(activeMemberships.filter((membership) => membership.resolution_state === "candidate").map((membership) => membership.membership_id)),
  };
}
