import { AUTOMATIC_GATE_FLOORS } from "../../../../packages/identity/src/common.mjs";

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function acceptedExternalReviews(adjudications, authorizedReviewReceiptIds) {
  return adjudications.filter((item) => item.review_evidence_status === "externally_verified_human_review"
    && item.human === true
    && item.review_receipt_id
    && authorizedReviewReceiptIds.includes(item.review_receipt_id));
}

function agreementMetrics(cases, adjudications, authorizedReviewReceiptIds) {
  const caseIds = new Set(cases.map((item) => item.benchmark_case_id));
  const byCase = new Map();
  for (const review of acceptedExternalReviews(adjudications, authorizedReviewReceiptIds)) {
    if (!caseIds.has(review.benchmark_case_id)) continue;
    if (!byCase.has(review.benchmark_case_id)) byCase.set(review.benchmark_case_id, []);
    if (!byCase.get(review.benchmark_case_id).some((item) => item.reviewer_id === review.reviewer_id)) byCase.get(review.benchmark_case_id).push(review);
  }
  const pairs = [...byCase.values()].filter((reviews) => reviews.length >= 2).map((reviews) => reviews.slice(0, 2));
  const agreements = pairs.filter(([left, right]) => left.decision === right.decision).length;
  const observedAgreement = ratio(agreements, pairs.length);
  const decisions = ["same_identity", "not_same_identity", "needs_more_evidence"];
  let expectedAgreement = 0;
  if (pairs.length > 0) {
    for (const decision of decisions) {
      const leftRate = pairs.filter(([left]) => left.decision === decision).length / pairs.length;
      const rightRate = pairs.filter(([, right]) => right.decision === decision).length / pairs.length;
      expectedAgreement += leftRate * rightRate;
    }
  }
  const kappa = observedAgreement === null || expectedAgreement === 1 ? null : (observedAgreement - expectedAgreement) / (1 - expectedAgreement);
  return { double_reviewed_cases: pairs.length, percent_agreement: observedAgreement, cohens_kappa: kappa, external_reviews: acceptedExternalReviews(adjudications, authorizedReviewReceiptIds).length };
}

function consensusByCase(adjudications, authorizedReviewReceiptIds) {
  const grouped = new Map();
  for (const review of acceptedExternalReviews(adjudications, authorizedReviewReceiptIds)) {
    if (!grouped.has(review.benchmark_case_id)) grouped.set(review.benchmark_case_id, []);
    grouped.get(review.benchmark_case_id).push(review.decision);
  }
  const consensus = new Map();
  for (const [caseId, decisions] of grouped) {
    if (decisions.length < 2 || decisions[0] !== decisions[1]) continue;
    consensus.set(caseId, decisions[0]);
  }
  return consensus;
}

export function evaluateIdentityBenchmark({ cases, predictions, adjudications = [], authorizedReviewReceiptIds = [], reversalChecks = [], explicitEnablementReceiptId = null, authorizedEnablementReceiptIds = [] }) {
  const predictionById = new Map(predictions.map((item) => [item.benchmark_case_id, item]));
  const syntheticPositives = cases.filter((item) => item.synthetic_expected_relationship === "same_identity");
  const syntheticNonMatches = cases.filter((item) => item.synthetic_expected_relationship !== "same_identity");
  const candidateHits = syntheticPositives.filter((item) => predictionById.get(item.benchmark_case_id)?.candidate_generated).length;
  const falseAutomatic = syntheticNonMatches.filter((item) => predictionById.get(item.benchmark_case_id)?.automatic_resolution === true).length;
  const reviewRequired = predictions.filter((item) => item.review_required).length;
  const unresolved = predictions.filter((item) => item.resolution_state === "open" || item.resolution_state === "deferred").length;
  const agreement = agreementMetrics(cases, adjudications, authorizedReviewReceiptIds);
  const consensus = consensusByCase(adjudications, authorizedReviewReceiptIds);
  const agreementFloorMet = agreement.double_reviewed_cases >= Math.min(100, cases.length) && agreement.percent_agreement >= 0.9 && agreement.cohens_kappa >= 0.8;
  const reversalPassed = reversalChecks.filter((item) => item.passed === true).length;
  const reversalRate = ratio(reversalPassed, reversalChecks.length);

  const strata = [...new Set(cases.map((item) => item.stratum_id))].sort().map((stratumId) => {
    const stratumCases = cases.filter((item) => item.stratum_id === stratumId);
    const adjudicated = stratumCases.filter((item) => consensus.has(item.benchmark_case_id));
    const positives = adjudicated.filter((item) => item.category === "positive" && consensus.get(item.benchmark_case_id) === "same_identity");
    const hardNegatives = adjudicated.filter((item) => item.category === "hard_negative" && consensus.get(item.benchmark_case_id) === "not_same_identity");
    const temporal = adjudicated.filter((item) => item.category === "temporal_reuse_conflict");
    const recallHits = positives.filter((item) => predictionById.get(item.benchmark_case_id)?.candidate_generated).length;
    const falseMerges = adjudicated.filter((item) => consensus.get(item.benchmark_case_id) === "not_same_identity" && predictionById.get(item.benchmark_case_id)?.automatic_resolution === true).length;
    const candidateRecall = ratio(recallHits, positives.length);
    const reasons = [];
    if (positives.length < AUTOMATIC_GATE_FLOORS.adjudicated_positive_pairs) reasons.push("adjudicated_positive_pairs_below_floor");
    if (hardNegatives.length < AUTOMATIC_GATE_FLOORS.hard_negative_pairs) reasons.push("hard_negative_pairs_below_floor");
    if (temporal.length < AUTOMATIC_GATE_FLOORS.temporal_reuse_conflict_cases) reasons.push("temporal_reuse_conflict_cases_below_floor");
    if (falseMerges !== 0) reasons.push("false_automatic_merges_nonzero");
    if (candidateRecall === null || candidateRecall < AUTOMATIC_GATE_FLOORS.candidate_recall) reasons.push("candidate_recall_below_floor_or_unmeasured");
    if (!agreementFloorMet) reasons.push("reviewer_agreement_floor_not_met");
    if (reversalRate !== 1) reasons.push("reversal_integrity_not_complete");
    if (!explicitEnablementReceiptId || !authorizedEnablementReceiptIds.includes(explicitEnablementReceiptId)) reasons.push("authorized_enablement_receipt_missing");
    return {
      stratum_id: stratumId,
      state: "disabled_candidate_only",
      automatic_resolution_enablement_eligible: reasons.length === 0,
      candidate_only_release_blocking: false,
      metrics: { adjudicated_positive_pairs: positives.length, hard_negative_pairs: hardNegatives.length, temporal_reuse_conflict_cases: temporal.length, false_automatic_merges: falseMerges, candidate_recall: candidateRecall },
      reasons,
    };
  });

  return {
    schema_version: "identity.benchmark-evaluation.v1.0.0",
    benchmark_status: "sealed_shape_pending_external_authorization",
    synthetic_conformance: {
      case_count: cases.length,
      positive_candidate_recall: ratio(candidateHits, syntheticPositives.length),
      false_automatic_merges: falseAutomatic,
      review_rate: ratio(reviewRequired, predictions.length),
      unresolved_rate: ratio(unresolved, predictions.length),
      status: "controlled_fixture_not_release_adjudication_evidence",
    },
    external_adjudication: {
      status: agreement.external_reviews === 0 ? "pending_external_authorization" : "in_progress_external_double_review",
      ...agreement,
      agreement_floor_met: agreementFloorMet,
    },
    reversal_integrity: {
      passed: reversalPassed,
      attempted: reversalChecks.length,
      rate: reversalRate,
      evidence_class: "controlled_fixture_mechanical_integrity",
    },
    automatic_rules: strata,
    production_rule_enabled: false,
    automatic_resolution_enablement_required_for_candidate_only_release: false,
    enablement_receipt_id: explicitEnablementReceiptId,
  };
}
