import { canonicalJson, sha256 } from "../../../../packages/identity/src/common.mjs";

export const REVIEW_PACKET_SCHEMA_VERSION = "identity.blind-review-packet.v1.0.0";
export const REVIEW_CASE_SCHEMA_VERSION = "identity.blind-review-case.v1.0.0";

const REVIEW_CASE_DOMAIN = "ushso.identity.blind-review-case.v1.0.0";

function opaqueId(kind, value, length = 24) {
  return `${kind}:${sha256(`${REVIEW_CASE_DOMAIN}\u0000${kind}\u0000${value}`).slice(0, length)}`;
}

function referenceMap(values, kind, reviewCaseId) {
  return new Map([...new Set(values)].sort((left, right) => left.localeCompare(right)).map((value, index) => [
    value,
    `${kind}:${reviewCaseId.slice("review-case:".length)}.${String(index + 1).padStart(2, "0")}`,
  ]));
}

function blindReviewCase(sourceCase) {
  const reviewCaseId = opaqueId("review-case", sourceCase.benchmark_case_id, 32);
  const objectReferences = referenceMap(sourceCase.assertions.map((item) => item.object_id), "object-ref", reviewCaseId);
  const sourceReferences = referenceMap(sourceCase.assertions.map((item) => item.source_id), "source-ref", reviewCaseId);
  const evidenceReferences = referenceMap(sourceCase.assertions.flatMap((item) => item.evidence_ids ?? []), "evidence-ref", reviewCaseId);
  const namespace = sourceCase.namespace;
  const assertions = sourceCase.assertions.map((item, index) => ({
    assertion_ref: `assertion-ref:${reviewCaseId.slice("review-case:".length)}.${String(index + 1).padStart(2, "0")}`,
    object_ref: objectReferences.get(item.object_id),
    source_ref: sourceReferences.get(item.source_id),
    raw_identifier: item.raw_value,
    normalized_identifier: item.normalized_value,
    check_passed: item.check_passed,
    authority_class: item.authority_class,
    entity_type: item.entity_type,
    grain: item.grain,
    effective_interval: item.effective_interval,
    evidence_refs: (item.evidence_ids ?? []).map((id) => evidenceReferences.get(id)),
  }));
  return {
    schema_version: REVIEW_CASE_SCHEMA_VERSION,
    review_case_id: reviewCaseId,
    stratum_id: sourceCase.stratum_id,
    prompt: "Do the evidence-bound assertions identify the same entity at the stated grain and effective time?",
    namespace_policy: {
      namespace_ref: opaqueId("namespace-ref", namespace.namespace_id),
      issuing_authority_ref: opaqueId("authority-ref", namespace.issuing_authority.organization_id),
      scope_kind: namespace.scope.kind,
      entity_types: namespace.entity_types,
      grains: namespace.grains,
      case_behavior: namespace.case_behavior,
      normalization_steps: namespace.normalization_steps,
      check_rule: namespace.check_rule,
      uniqueness_policy: namespace.uniqueness_policy,
      reuse_policy: namespace.reuse_policy,
      effective_date_policy: namespace.effective_date_policy,
    },
    assertions,
    permitted_decisions: ["same_identity", "not_same_identity", "needs_more_evidence"],
  };
}

export function buildBlindReviewCases(cases) {
  return cases.map(blindReviewCase).sort((left, right) => left.review_case_id.localeCompare(right.review_case_id));
}

export function blindReviewCaseDigest(reviewCases) {
  return sha256(canonicalJson(reviewCases));
}

export function buildReviewCaseIndex(cases) {
  const index = new Map();
  for (const sourceCase of cases) {
    const reviewCase = blindReviewCase(sourceCase);
    index.set(reviewCase.review_case_id, { source_case: sourceCase, review_case: reviewCase });
  }
  return index;
}

export function assertReviewerCasesAreBlind(reviewCases) {
  const forbiddenKeys = new Set([
    "benchmark_case_id",
    "category",
    "scenario_kind",
    "synthetic_expected_relationship",
    "synthetic_expectation_is_adjudication",
    "adjudicated_label",
    "production_rule_eligible",
    "similarity_signal",
    "match_score",
    "candidate_generated",
    "automatic_resolution",
    "resolution_state",
    "reviewer_a",
    "reviewer_b",
  ]);
  const forbiddenKeyPaths = [];
  const walk = (value, currentPath) => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => walk(child, `${currentPath}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = currentPath ? `${currentPath}.${key}` : key;
      if (forbiddenKeys.has(key)) forbiddenKeyPaths.push(childPath);
      walk(child, childPath);
    }
  };
  walk(reviewCases, "cases");
  if (forbiddenKeyPaths.length > 0) throw new Error(`REVIEW_PACKET_CONTROLLED_LABEL_FIELD:${forbiddenKeyPaths.join(",")}`);
  if (reviewCases.some((item) => !/^review-case:[0-9a-f]{32}$/.test(item.review_case_id))) throw new Error("REVIEW_PACKET_CASE_ID_NOT_OPAQUE");
  return true;
}
