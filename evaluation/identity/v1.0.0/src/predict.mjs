import { generateIdentityCandidates } from "../../../../packages/identity/src/index.mjs";

export function runConformancePredictions(cases) {
  return cases.map((item) => {
    const { candidates } = generateIdentityCandidates({
      assertions: item.assertions,
      namespaces: [item.namespace],
      similaritySignals: item.similarity_signal ? [item.similarity_signal] : [],
      createdAt: "2026-08-30T00:00:00.000Z",
      algorithmVersion: "1.0.0",
      featureVersion: "1.0.0",
      authorizedEnablementReceiptIds: [],
    });
    const relevant = candidates.find((candidate) => [candidate.object_a_id, candidate.object_b_id].includes(item.assertions[0].object_id)
      && [candidate.object_a_id, candidate.object_b_id].includes(item.assertions[1].object_id));
    return {
      benchmark_case_id: item.benchmark_case_id,
      candidate_generated: Boolean(relevant),
      automatic_resolution: relevant?.resolution_mode === "automatic_exact_policy",
      review_required: Boolean(relevant) && relevant.resolution_mode === "candidate_only",
      resolution_state: relevant?.state ?? "no_candidate",
    };
  });
}
