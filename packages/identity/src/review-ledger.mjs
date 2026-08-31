import { assert, clone, uniqueSorted } from "./common.mjs";

const DECISIONS = new Set([
  "same_identity",
  "not_same_identity",
  "family_member",
  "mirror_of",
  "successor_of",
  "defer",
  "needs_more_evidence",
]);

export function appendReviewDecision(events, input, reviewEvidence) {
  const priorEvents = clone(events);
  assert(!priorEvents.some((event) => event.decision_id === input.decision_id), "Decision IDs are immutable and unique", "duplicate_decision");
  assert(DECISIONS.has(input.decision), "Unknown review decision", "invalid_decision");
  assert(input.reviewer?.human === true, "Review decisions require an identified human reviewer", "human_review_required");
  assert(typeof input.rationale === "string" && input.rationale.length >= 20, "Review rationale must be substantive", "rationale_required");
  assert(Array.isArray(input.evidence_ids) && input.evidence_ids.length > 0, "Review evidence is required", "evidence_required");
  assert(reviewEvidence?.status === "externally_verified_human_review" || reviewEvidence?.status === "controlled_fixture_not_adjudication_evidence", "Review evidence status must be explicit", "review_evidence_required");
  if (reviewEvidence.status === "externally_verified_human_review") {
    assert(reviewEvidence.reviewer_roster_receipt_id && reviewEvidence.review_attestation_receipt_id, "External human review requires authorized roster and attestation receipts", "external_review_receipts_required");
  }

  const currentForCandidate = materializeReviewDecisions(priorEvents)
    .filter((event) => event.candidate_id === input.candidate_id && event.state === "current");
  assert(currentForCandidate.length <= 1, "Review history must have at most one current decision per candidate", "decision_not_current");
  if (currentForCandidate.length === 1) {
    assert(input.supersedes_decision_id === currentForCandidate[0].decision_id, "A current decision must be explicitly superseded before appending another", "decision_not_current");
  }

  if (input.supersedes_decision_id) {
    const previous = priorEvents.find((event) => event.decision_id === input.supersedes_decision_id);
    assert(previous, "A superseding decision must reference an existing decision", "missing_superseded_decision");
    assert(previous.candidate_id === input.candidate_id, "A decision may only supersede a decision for the same candidate", "candidate_mismatch");
    assert(!priorEvents.some((event) => event.supersedes_decision_id === previous.decision_id), "Only the current decision may be superseded", "decision_not_current");
    assert(Date.parse(input.decided_at) >= Date.parse(previous.decided_at) && Date.parse(input.recorded_at) >= Date.parse(previous.recorded_at), "Superseding decisions cannot precede the decision they supersede", "decision_time_regression");
  }

  return [...priorEvents, {
    ...clone(input),
    evidence_ids: uniqueSorted(input.evidence_ids),
    review_evidence_status: reviewEvidence.status,
    reviewer_roster_receipt_id: reviewEvidence.reviewer_roster_receipt_id ?? null,
    review_attestation_receipt_id: reviewEvidence.review_attestation_receipt_id ?? null,
  }];
}

export function materializeReviewDecisions(events) {
  const supersededBy = new Map();
  for (const event of events) {
    if (event.supersedes_decision_id) supersededBy.set(event.supersedes_decision_id, event.decision_id);
  }
  return [...events]
    .map((event) => ({
      ...clone(event),
      state: supersededBy.has(event.decision_id) ? "superseded" : "current",
      superseded_by_decision_id: supersededBy.get(event.decision_id) ?? null,
    }))
    .sort((left, right) => left.decision_id.localeCompare(right.decision_id));
}

export function currentDecisionByCandidate(events, { includeControlledFixtures = false } = {}) {
  const current = materializeReviewDecisions(events).filter((decision) => decision.state === "current");
  return new Map(current
    .filter((decision) => includeControlledFixtures || decision.review_evidence_status === "externally_verified_human_review")
    .map((decision) => [decision.candidate_id, decision]));
}

export function toContractReviewDecision(event) {
  assert(event.review_evidence_status === "externally_verified_human_review", "Controlled fixtures cannot be exported as adjudication evidence", "not_adjudication_evidence");
  assert(["current", "superseded"].includes(event.state) && "superseded_by_decision_id" in event, "Review decisions must be materialized before contract export", "decision_not_materialized");
  const { review_evidence_status: _status, reviewer_roster_receipt_id: _roster, review_attestation_receipt_id: _attestation, ...contractDecision } = event;
  return contractDecision;
}
