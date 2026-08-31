import test from "node:test";
import assert from "node:assert/strict";

import {
  assessBenchmarkGate,
  evaluateCheckRule,
  evaluateExactIdentifierPair,
  generateIdentityCandidates,
  normalizeIdentifier,
} from "../src/index.mjs";
import {
  assertionFixture,
  enabledControlledNamespaceFixture,
  namespaceFixture,
  RECORDED_AT,
} from "../fixtures/production-shaped.mjs";

test("normalization and check rules are namespace-defined and deterministic", () => {
  const namespace = namespaceFixture();
  const normalized = normalizeIdentifier(" 12-3456 ", namespace);
  assert.equal(normalized, "123456");
  assert.deepEqual(evaluateCheckRule(normalized, namespace.check_rule), { passed: true, reason: "regex" });
  assert.equal(evaluateCheckRule("42", { kind: "check_digit", expression: "fixture-validator", version: "1.0.0" }).passed, false);
  assert.equal(evaluateCheckRule("42", { kind: "check_digit", expression: "fixture-validator", version: "1.0.0" }, { checkDigitValidators: { "fixture-validator": (value) => value === "42" } }).passed, true);
});

test("a benchmark below any floor remains candidate-only", () => {
  const gate = assessBenchmarkGate(namespaceFixture().benchmark_gate);
  assert.equal(gate.eligible, false);
  assert(gate.reasons.includes("gate_not_enabled"));
  assert(gate.reasons.includes("adjudicated_positive_pairs_below_floor"));
  assert(gate.reasons.includes("hard_negative_pairs_below_floor"));
  assert(gate.reasons.includes("temporal_reuse_conflict_cases_below_floor"));
  assert(gate.reasons.includes("candidate_recall_below_floor"));
});

test("exact identity requires a sealed gate and separately authorized enablement receipt", () => {
  const namespace = enabledControlledNamespaceFixture();
  const left = assertionFixture("alpha");
  const right = assertionFixture("beta");
  const withoutAuthorization = evaluateExactIdentifierPair({ left, right, namespace, activeAssertions: [left, right] });
  assert.equal(withoutAuthorization.eligible, false);
  assert(withoutAuthorization.reasons.includes("enablement_receipt_authorized"));

  const authorized = evaluateExactIdentifierPair({
    left,
    right,
    namespace,
    activeAssertions: [left, right],
    authorizedEnablementReceiptIds: [namespace.benchmark_gate.enablement_receipt_id],
  });
  assert.equal(authorized.eligible, true);
  assert.equal(authorized.state, "accepted");
  assert.equal(authorized.disposition, "automatic_exact_policy");
});

test("temporal uncertainty, identifier reuse, source scope, grain, and conflicts fail closed", () => {
  const enabled = enabledControlledNamespaceFixture();
  const authorization = [enabled.benchmark_gate.enablement_receipt_id];
  const left = assertionFixture("alpha");
  const right = assertionFixture("beta");

  const incomplete = evaluateExactIdentifierPair({
    left,
    right: assertionFixture("beta", { effective_interval: { start: "2020-01-01", end: null, bounds: "[)", completeness: "open_end" } }),
    namespace: enabled,
    activeAssertions: [left, right],
    authorizedEnablementReceiptIds: authorization,
  });
  assert(incomplete.reasons.includes("effective_dates_incomplete"));

  const reusedNamespace = { ...enabled, reuse_policy: "known_reuse" };
  assert(evaluateExactIdentifierPair({ left, right, namespace: reusedNamespace, activeAssertions: [left, right], authorizedEnablementReceiptIds: authorization }).reasons.includes("identifier_reuse_not_prohibited"));

  const sourceLocal = { ...enabled, scope: { kind: "source_local", source_id: left.source_id } };
  assert.equal(evaluateExactIdentifierPair({ left, right, namespace: sourceLocal, activeAssertions: [left, right], authorizedEnablementReceiptIds: authorization }).checks.source_scope_eligible, false);
  const localRight = assertionFixture("beta", { source_id: left.source_id, authority_class: "source_native" });
  const localLeft = { ...left, authority_class: "source_native" };
  assert.equal(evaluateExactIdentifierPair({ left: localLeft, right: localRight, namespace: sourceLocal, activeAssertions: [localLeft, localRight], authorizedEnablementReceiptIds: authorization }).eligible, true);

  const campus = assertionFixture("beta", { entity_type: "hospital_campus", grain: "campus" });
  const grainCheck = evaluateExactIdentifierPair({ left, right: campus, namespace: enabled, activeAssertions: [left, campus], authorizedEnablementReceiptIds: authorization });
  assert.equal(grainCheck.checks.entity_type_compatible, false);
  assert.equal(grainCheck.checks.grain_compatible, false);

  const conflict = assertionFixture("alpha-conflict", { object_id: left.object_id, normalized_value: "654321", raw_value: "654321" });
  const conflictCheck = evaluateExactIdentifierPair({ left, right, namespace: enabled, activeAssertions: [left, right, conflict], authorizedEnablementReceiptIds: authorization });
  assert.equal(conflictCheck.checks.no_authoritative_conflict, false);
  assert.equal(conflictCheck.state, "open");
});

test("candidate generation preserves fuzzy and disabled-exact pairs as open records", () => {
  const left = assertionFixture("alpha");
  const right = assertionFixture("beta");
  const { candidates, assessments } = generateIdentityCandidates({
    assertions: [left, right],
    namespaces: [namespaceFixture()],
    similaritySignals: [{
      object_a_id: left.object_id,
      object_b_id: "object:facility.gamma",
      feature_kind: "title_similarity",
      value: 0.99,
      match_score: 0.99,
      evidence_ids: ["evidence:title.similarity"],
    }],
    createdAt: RECORDED_AT,
  });
  assert.equal(candidates.length, 2);
  assert(candidates.every((candidate) => candidate.state === "open"));
  assert(candidates.every((candidate) => candidate.resolution_mode === "candidate_only"));
  assert.equal(new Set(candidates.map((candidate) => `${candidate.object_a_id}:${candidate.object_b_id}`)).size, 2);
  assert(assessments.some((assessment) => assessment.reasons.includes("fuzzy_signals_are_candidate_only")));
  assert(assessments.some((assessment) => assessment.reasons.includes("gate_not_enabled")));
});
