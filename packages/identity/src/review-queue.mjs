import { assert, uniqueSorted } from "./common.mjs";
import { automaticAssessmentIsBound } from "./projection-rebuilder.mjs";

const TERMINAL_DECISIONS = new Set(["same_identity", "not_same_identity", "family_member", "mirror_of", "successor_of"]);

const PRIORITY = Object.freeze({
  authoritative_conflict: 100,
  parent_campus_or_system_ambiguity: 90,
  temporal_or_reuse_uncertainty: 80,
  incompatible_entity_or_grain: 70,
  exact_candidate_gate_disabled: 60,
  fuzzy_candidate: 40,
  deferred: 20,
});

function classify(candidate, policyReasons) {
  const reasons = new Set(policyReasons);
  if (candidate.conflicting_assertion_ids?.length || reasons.has("no_authoritative_conflict")) return "authoritative_conflict";
  if (reasons.has("parent_campus_or_system_ambiguity")) return "parent_campus_or_system_ambiguity";
  if (["identifier_reuse_not_prohibited", "effective_dates_incomplete", "effective_periods_do_not_overlap"].some((reason) => reasons.has(reason))) return "temporal_or_reuse_uncertainty";
  if (reasons.has("entity_type_compatible") || reasons.has("grain_compatible")) return "incompatible_entity_or_grain";
  if (candidate.state === "deferred") return "deferred";
  if (candidate.features?.some((feature) => feature.feature_kind === "exact_identifier")) return "exact_candidate_gate_disabled";
  return "fuzzy_candidate";
}

export function buildReviewQueue(candidates, { currentDecisions = new Map(), assessments = [], authorizedEnablementReceiptIds = [] } = {}) {
  const assessmentByCandidate = new Map();
  for (const assessment of assessments) {
    assert(!assessmentByCandidate.has(assessment.candidate_id), "Policy assessments must be unique by candidate", "duplicate_policy_assessment");
    assessmentByCandidate.set(assessment.candidate_id, assessment);
  }
  return candidates
    .filter((candidate) => {
      const currentDecision = currentDecisions.get(candidate.candidate_id);
      if (currentDecision && !TERMINAL_DECISIONS.has(currentDecision.decision)) return true;
      if (currentDecision) return false;
      if (["open", "deferred"].includes(candidate.state)) return true;
      return candidate.state === "accepted"
        && candidate.resolution_mode === "automatic_exact_policy"
        && !automaticAssessmentIsBound(candidate, assessmentByCandidate.get(candidate.candidate_id), authorizedEnablementReceiptIds);
    })
    .map((candidate) => {
      const policyReasons = assessmentByCandidate.get(candidate.candidate_id)?.reasons ?? [];
      const reason = classify(candidate, policyReasons);
      return {
        queue_item_id: `review:${candidate.candidate_id}`,
        candidate_id: candidate.candidate_id,
        object_ids: uniqueSorted([candidate.object_a_id, candidate.object_b_id]),
        priority: PRIORITY[reason],
        reason,
        state: "pending_external_review",
        policy_reasons: uniqueSorted(policyReasons),
      };
    })
    .sort((left, right) => right.priority - left.priority || left.candidate_id.localeCompare(right.candidate_id));
}
