import { evaluateExactIdentifierPair } from "./exact-identifier-policy.mjs";
import { orderedPair, stableId, uniqueSorted } from "./common.mjs";

function confidenceFor(policy) {
  if (policy.eligible) return { level: "high", basis: "All registered exact-identifier checks and the sealed benchmark gate passed." };
  return { level: "unknown", basis: `Candidate retained for review; automatic identity is blocked: ${policy.reasons.join(", ")}.` };
}

function makeCandidate({ left, right, feature, score, policy, createdAt, algorithmVersion, featureVersion, candidateType = "same_identity" }) {
  const [objectA, objectB] = orderedPair(left.object_id, right.object_id);
  const supporting = uniqueSorted([left.assertion_id, right.assertion_id].filter(Boolean));
  const conflicts = policy?.conflicting_assertion_ids ?? [];
  const candidate = {
    schema_version: "identity.candidate.v1.0.0",
    candidate_id: stableId("identity-candidate", { objectA, objectB, candidateType, algorithmVersion, feature }),
    object_a_id: objectA,
    object_b_id: objectB,
    candidate_type: candidateType,
    algorithm_version: algorithmVersion,
    feature_version: featureVersion,
    features: [feature],
    match_score: score,
    epistemic_confidence: policy ? confidenceFor(policy) : {
      level: "unknown",
      basis: "A similarity signal proposes review; fuzzy evidence never establishes identity automatically.",
    },
    supporting_assertion_ids: supporting,
    conflicting_assertion_ids: conflicts,
    state: policy?.state ?? "open",
    resolution_mode: policy?.disposition ?? "candidate_only",
    created_at: createdAt,
    reviewed_at: null,
    supersedes_candidate_id: null,
    superseded_by_candidate_id: null,
    lineage: {
      import_run_id: stableId("candidate-run", { createdAt, algorithmVersion }),
      normalizer_version: featureVersion,
      recorded_at: createdAt,
    },
  };
  return {
    candidate,
    assessment: {
      candidate_id: candidate.candidate_id,
      automatic_resolution_eligible: policy?.eligible ?? false,
      enablement_receipt_id: policy?.enablement_receipt_id ?? null,
      reasons: policy?.reasons ?? ["fuzzy_signals_are_candidate_only"],
      checks: policy?.checks ?? {},
    },
  };
}

export function generateIdentityCandidates({
  assertions,
  namespaces,
  similaritySignals = [],
  authorizedEnablementReceiptIds = [],
  checkRuleContext = {},
  createdAt,
  algorithmVersion = "1.0.0",
  featureVersion = "1.0.0",
}) {
  const namespaceById = new Map(namespaces.map((namespace) => [namespace.namespace_id, namespace]));
  const candidates = new Map();
  const active = assertions.filter((assertion) => assertion.state === "active");

  for (let index = 0; index < active.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < active.length; otherIndex += 1) {
      const left = active[index];
      const right = active[otherIndex];
      if (left.object_id === right.object_id || left.namespace_id !== right.namespace_id) continue;
      if (left.normalized_value !== right.normalized_value) continue;
      const namespace = namespaceById.get(left.namespace_id);
      if (!namespace) continue;
      const policy = evaluateExactIdentifierPair({ left, right, namespace, activeAssertions: active, authorizedEnablementReceiptIds, checkRuleContext });
      const feature = {
        feature_kind: "exact_identifier",
        value: `${left.namespace_id}:${left.normalized_value}`,
        evidence_ids: uniqueSorted([...left.evidence_ids, ...right.evidence_ids]),
      };
      const record = makeCandidate({ left, right, feature, score: 1, policy, createdAt, algorithmVersion, featureVersion });
      candidates.set(`${record.candidate.object_a_id}\u0000${record.candidate.object_b_id}\u0000${record.candidate.candidate_type}`, record);
    }
  }

  for (const signal of similaritySignals) {
    if (signal.object_a_id === signal.object_b_id) continue;
    const [objectA, objectB] = orderedPair(signal.object_a_id, signal.object_b_id);
    const key = `${objectA}\u0000${objectB}\u0000${signal.candidate_type ?? "same_identity"}`;
    if (candidates.has(key)) continue;
    const record = makeCandidate({
      left: { object_id: objectA },
      right: { object_id: objectB },
      feature: {
        feature_kind: signal.feature_kind,
        value: signal.value,
        evidence_ids: uniqueSorted(signal.evidence_ids),
      },
      score: signal.match_score,
      policy: null,
      createdAt,
      algorithmVersion,
      featureVersion,
      candidateType: signal.candidate_type ?? "same_identity",
    });
    candidates.set(key, record);
  }

  const records = [...candidates.values()].sort((left, right) => left.candidate.candidate_id.localeCompare(right.candidate.candidate_id));
  return {
    candidates: records.map((record) => record.candidate),
    assessments: records.map((record) => record.assessment),
  };
}
