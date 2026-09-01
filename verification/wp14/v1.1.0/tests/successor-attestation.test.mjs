import test from "node:test";
import assert from "node:assert/strict";
import { readJson, repoPath } from "../../v1.0.0/src/common.mjs";
import {
  SUCCESSOR_POLICY_PATH,
  SUCCESSOR_RECEIPT_PATH,
  validateSuccessorDocuments,
  verifySuccessorAttestation,
} from "../src/successor-attestation.mjs";

test("successor attestation binds the authorized CAS commit and preserves historical WP14", () => {
  const result = verifySuccessorAttestation();
  assert.equal(result.status, "PASS_SUCCESSOR_ATTESTATION_BOUND_TO_F2641A3");
  assert.equal(result.failed, 0);
  assert.equal(result.passed, result.check_count);
  assert.equal(result.production_eligibility, false);
});

test("successor attestation fails closed on implementation or authorization drift", () => {
  const policy = readJson(repoPath(SUCCESSOR_POLICY_PATH));
  const receipt = readJson(repoPath(SUCCESSOR_RECEIPT_PATH));
  assert.equal(validateSuccessorDocuments(policy, receipt), true);

  assert.throws(
    () => validateSuccessorDocuments({ ...policy, implementation: { ...policy.implementation, commit: "0".repeat(40) } }, receipt),
    /implementation binding/u,
  );
  assert.throws(
    () => validateSuccessorDocuments({ ...policy, authorization: { ...policy.authorization, authorized: false } }, receipt),
    /owner authorization/u,
  );
  assert.throws(
    () => validateSuccessorDocuments({ ...policy, production_eligibility: true }, receipt),
    /restrictions/u,
  );
  assert.throws(
    () => validateSuccessorDocuments(policy, { ...receipt, actions: { ...receipt.actions, deployments: 1 } }),
    /receipt boundary/u,
  );
});

test("every historical receipt and source-copy check is present and passing", () => {
  const result = verifySuccessorAttestation();
  const relevant = result.checks.filter((item) => item.id.startsWith("historical-") || item.id.startsWith("source-"));
  assert.ok(relevant.length >= 13);
  assert.equal(relevant.every((item) => item.status === "pass"), true);
});

test("successor boundary retains false external authorizations and zero actions", () => {
  const result = verifySuccessorAttestation();
  for (const id of ["external-authorizations-remain-false", "zero-action-boundary", "not-production-eligible", "release-gate-not-executed"]) {
    assert.equal(result.checks.find((item) => item.id === id)?.status, "pass", id);
  }
});
