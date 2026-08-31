import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { benchmarkCaseDigest, buildBenchmarkCases, CATEGORY_COUNTS } from "../src/cases.mjs";
import { evaluateIdentityBenchmark } from "../src/evaluate.mjs";
import { runConformancePredictions } from "../src/predict.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await fs.readFile(path.join(root, "benchmark/manifest.json"), "utf8"));

test("sealed benchmark has 50/50/20 in every launch-critical stratum", () => {
  const cases = buildBenchmarkCases(manifest);
  assert.equal(cases.length, manifest.expected_case_count);
  assert.equal(benchmarkCaseDigest(cases), manifest.expected_case_sha256);
  for (const stratum of manifest.launch_critical_strata) {
    for (const [category, count] of Object.entries(CATEGORY_COUNTS)) {
      assert.equal(cases.filter((item) => item.stratum_id === stratum.stratum_id && item.category === category).length, count);
    }
  }
  assert(cases.some((item) => item.scenario_kind === "parent_campus_system_ambiguity"));
  assert(cases.some((item) => item.scenario_kind === "non_overlapping_effective_period"));
  assert(cases.some((item) => item.scenario_kind === "identifier_reuse_or_incomplete_dates"));
  assert(cases.some((item) => item.scenario_kind === "conflicting_authoritative_identifier"));
  assert(cases.every((item) => item.adjudication_status === "pending_external_double_review"));
  assert(cases.every((item) => item.synthetic_expectation_is_adjudication === false));
  assert(cases.every((item) => item.reviewer_a === null && item.reviewer_b === null && item.adjudicated_label === null));
});

test("synthetic conformance reaches candidate recall without enabling automatic rules", () => {
  const cases = buildBenchmarkCases(manifest);
  const predictions = runConformancePredictions(cases);
  const result = evaluateIdentityBenchmark({ cases, predictions });
  assert.equal(result.synthetic_conformance.positive_candidate_recall, 1);
  assert.equal(result.synthetic_conformance.false_automatic_merges, 0);
  assert.equal(result.external_adjudication.status, "pending_external_authorization");
  assert.equal(result.external_adjudication.external_reviews, 0);
  assert.equal(result.external_adjudication.percent_agreement, null);
  assert.equal(result.external_adjudication.cohens_kappa, null);
  assert.equal(result.production_rule_enabled, false);
  assert.equal(result.automatic_resolution_enablement_required_for_candidate_only_release, false);
  assert(result.automatic_rules.every((rule) => rule.state === "disabled_candidate_only"));
  assert(result.automatic_rules.every((rule) => rule.candidate_only_release_blocking === false));
  assert(result.automatic_rules.every((rule) => rule.reasons.includes("adjudicated_positive_pairs_below_floor")));
  assert(predictions.every((prediction) => prediction.automatic_resolution === false));
});

test("controlled review fixtures are excluded from human agreement and enablement metrics", () => {
  const cases = buildBenchmarkCases(manifest);
  const predictions = runConformancePredictions(cases);
  const fixtureReviews = cases.slice(0, 2).flatMap((item) => ["a", "b"].map((reviewer) => ({
    benchmark_case_id: item.benchmark_case_id,
    reviewer_id: `reviewer:controlled.${reviewer}`,
    human: true,
    decision: "same_identity",
    review_receipt_id: `receipt:controlled.${reviewer}`,
    review_evidence_status: "controlled_fixture_not_adjudication_evidence",
  })));
  const result = evaluateIdentityBenchmark({ cases, predictions, adjudications: fixtureReviews });
  assert.equal(result.external_adjudication.external_reviews, 0);
  assert.equal(result.external_adjudication.double_reviewed_cases, 0);
  assert.equal(result.production_rule_enabled, false);
});

test("reversal integrity is reported separately as mechanical fixture evidence", () => {
  const cases = buildBenchmarkCases(manifest);
  const result = evaluateIdentityBenchmark({ cases, predictions: runConformancePredictions(cases), reversalChecks: [{ check_id: "reversal:1", passed: true }] });
  assert.equal(result.reversal_integrity.rate, 1);
  assert.equal(result.reversal_integrity.evidence_class, "controlled_fixture_mechanical_integrity");
});

