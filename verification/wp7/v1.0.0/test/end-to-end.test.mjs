import fs from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

import { buildBenchmarkCases } from "../../../../evaluation/identity/v1.0.0/src/cases.mjs";
import { evaluateIdentityBenchmark } from "../../../../evaluation/identity/v1.0.0/src/evaluate.mjs";
import { runConformancePredictions } from "../../../../evaluation/identity/v1.0.0/src/predict.mjs";
import { buildProjectionInputs, buildReviewQueue, generateIdentityCandidates } from "../../../../packages/identity/src/index.mjs";
import { assertionFixture, identityObjects, namespaceFixture, RECORDED_AT } from "../../../../packages/identity/fixtures/production-shaped.mjs";

test("open identity candidates remain separate in public projection inputs and enter review queues", () => {
  const { candidates, assessments } = generateIdentityCandidates({
    assertions: [assertionFixture("alpha"), assertionFixture("beta")],
    namespaces: [namespaceFixture()],
    similaritySignals: [{ object_a_id: "object:facility.beta", object_b_id: "object:facility.gamma", feature_kind: "semantic_similarity", value: 0.99, match_score: 0.99, evidence_ids: ["evidence:semantic.fixture"] }],
    createdAt: RECORDED_AT,
  });
  const projections = buildProjectionInputs({ objects: identityObjects(), candidates, graphRevisionId: "graph-revision:verification", projectedAt: RECORDED_AT });
  assert.equal(projections.identity_clusters.length, 3);
  assert(projections.identity_clusters.every((cluster) => cluster.member_object_ids.length === 1));
  assert.equal(projections.search_projections.length, 3);
  assert(projections.search_projections.every((projection) => projection.separately_searchable));
  assert(projections.search_projections.some((projection) => projection.unresolved_candidate_ids.length > 0));
  const queue = buildReviewQueue(candidates, { assessments });
  assert.equal(queue.length, candidates.length);
  assert(queue.every((item) => item.state === "pending_external_review"));
});

test("sealed evaluation exposes synthetic metrics while human agreement and rules stay pending", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("../../../../evaluation/identity/v1.0.0/benchmark/manifest.json", import.meta.url), "utf8"));
  const cases = buildBenchmarkCases(manifest);
  const result = evaluateIdentityBenchmark({ cases, predictions: runConformancePredictions(cases), adjudications: [], reversalChecks: [{ check_id: "controlled-reversal", passed: true }] });
  assert.equal(result.synthetic_conformance.positive_candidate_recall, 1);
  assert.equal(result.synthetic_conformance.false_automatic_merges, 0);
  assert.equal(result.external_adjudication.status, "pending_external_authorization");
  assert.equal(result.external_adjudication.double_reviewed_cases, 0);
  assert.equal(result.production_rule_enabled, false);
  assert(result.automatic_rules.every((rule) => rule.state === "disabled_candidate_only"));
  assert.equal(result.reversal_integrity.rate, 1);
});
