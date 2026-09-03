import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { canonicalJson, sha256 } from "../../../../packages/identity/src/common.mjs";
import { benchmarkCaseDigest, buildBenchmarkCases } from "../src/cases.mjs";
import { assertReviewerCasesAreBlind, blindReviewCaseDigest, buildBlindReviewCases, buildReviewCaseIndex } from "../src/adjudication-packet.mjs";
import { validateAdjudicationSubmission } from "../src/adjudication-import.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../../..");
const benchmarkManifest = JSON.parse(await fs.readFile(path.join(packageRoot, "benchmark/manifest.json"), "utf8"));
const packetBytes = await fs.readFile(path.join(packageRoot, "adjudication/reviewer-packet.json"));
const packet = JSON.parse(packetBytes);
const packetByteSha256 = createHash("sha256").update(packetBytes).digest("hex");
const cases = buildBenchmarkCases(benchmarkManifest);
const reviewCaseIndex = buildReviewCaseIndex(cases);
const reviewerCases = buildBlindReviewCases(cases);
const authorizationRegister = JSON.parse(await fs.readFile(path.join(repositoryRoot, "verification/external-authorization/v1.0.0/register.json"), "utf8"));
const auth14 = authorizationRegister.entries.find((entry) => entry.id === "AUTH-14");

function reviewer(reviewerId, roles, suffix) {
  return {
    schema_version: "identity.reviewer-roster-entry.v1.0.0",
    reviewer_id: reviewerId,
    human: true,
    identified: true,
    controlled_fixture: false,
    identity_receipt_id: `receipt:identity.${suffix}.2026`,
    independence_attestation_id: `attestation:independence.${suffix}.2026`,
    assigned_roles: roles,
    independence_declarations: {
      controlled_label_access: false,
      peer_decision_access_before_independent_submission: false,
      algorithm_output_access: false,
      conflict_disclosures: [],
    },
  };
}

function sampledReviewCases() {
  const selected = new Map();
  for (const stratum of benchmarkManifest.launch_critical_strata) {
    for (const category of ["positive", "hard_negative", "temporal_reuse_conflict"]) {
      const entry = [...reviewCaseIndex.values()].find((item) => item.source_case.stratum_id === stratum.stratum_id && item.source_case.category === category);
      selected.set(entry.review_case.review_case_id, entry.review_case);
    }
  }
  for (const reviewCase of reviewerCases) {
    if (selected.size === 100) break;
    selected.set(reviewCase.review_case_id, reviewCase);
  }
  return [...selected.values()].sort((left, right) => left.review_case_id.localeCompare(right.review_case_id));
}

function decisionFor(reviewCaseId) {
  return Number.parseInt(reviewCaseId.at(-1), 16) % 2 === 0 ? "same_identity" : "not_same_identity";
}

function recordFor(reviewCase, rosterEntry, role, ordinal, decision = decisionFor(reviewCase.review_case_id)) {
  return {
    schema_version: "identity.benchmark-adjudication.v1.0.0",
    packet_id: packet.packet_id,
    reviewer_packet_byte_sha256: packetByteSha256,
    review_case_id: reviewCase.review_case_id,
    reviewer_id: rosterEntry.reviewer_id,
    reviewer_identity_receipt_id: rosterEntry.identity_receipt_id,
    independence_attestation_id: rosterEntry.independence_attestation_id,
    review_role: role,
    human: true,
    decision,
    rationale: "Independent preflight input based only on the blinded assertion evidence supplied.",
    evidence_reference_ids: [reviewCase.assertions[0].evidence_refs[0]],
    reviewed_at: "2026-08-30T12:00:00.000Z",
    review_receipt_id: `review-receipt:preflight.${role}.${String(ordinal).padStart(4, "0")}`,
    review_evidence_status: "externally_verified_human_review",
  };
}

function preflightSubmission() {
  const primary = reviewer("reviewer:alpha.independent", ["primary"], "alpha");
  const secondary = reviewer("reviewer:bravo.independent", ["secondary"], "bravo");
  const records = sampledReviewCases().flatMap((reviewCase, index) => [
    recordFor(reviewCase, primary, "primary", index + 1),
    recordFor(reviewCase, secondary, "secondary", index + 1),
  ]);
  return {
    schema_version: "identity.adjudication-submission.v1.0.0",
    submission_id: "adjudication-submission:preflight.local",
    packet_id: packet.packet_id,
    reviewer_packet_byte_sha256: packetByteSha256,
    benchmark_case_sha256: packet.benchmark.case_sha256,
    reviewer_case_sha256: packet.reviewer_case_contract.case_sha256,
    authorization_reference: "AUTH-14",
    authorization_receipt_id: "pending:AUTH-14",
    reviewer_roster: [primary, secondary],
    records,
    record_set_sha256: sha256(canonicalJson(records)),
  };
}

function validate(submission) {
  return validateAdjudicationSubmission({ submission, cases, packet, packetByteSha256, authorizationEntry: auth14 });
}

test("blinded reviewer cases preserve the seal without exposing controlled labels", () => {
  assert.equal(cases.length, 720);
  assert.equal(benchmarkCaseDigest(cases), packet.benchmark.case_sha256);
  assert.equal(reviewerCases.length, 720);
  assert.equal(blindReviewCaseDigest(reviewerCases), packet.reviewer_case_contract.case_sha256);
  assert.equal(assertReviewerCasesAreBlind(reviewerCases), true);
  const serialized = JSON.stringify(reviewerCases);
  for (const forbidden of ["benchmark_case_id", "synthetic_expected_relationship", "scenario_kind", "adjudicated_label", "category", "similarity_signal", "match_score", "automatic_resolution"]) assert.equal(serialized.includes(`\"${forbidden}\"`), false);
});

test("AUTH-14 remains unauthorized and therefore no completed receipt can be emitted", () => {
  assert.equal(auth14.status, "not_requested");
  assert.equal(auth14.authorized, false);
  const result = validate(preflightSubmission());
  assert.equal(result.status, "pending_external_authorization");
  assert.equal(result.ready_for_import, false);
  assert.equal(result.validation_receipt, null);
  assert.equal(result.metrics_evidence_status, "untrusted_submission_not_adjudication_evidence");
  assert.deepEqual(result.errors.map((item) => item.code), ["AUTHORIZATION_REQUIRED"]);
  assert.equal(result.metrics.double_reviewed_cases, 100);
  assert.equal(result.metrics.percent_agreement, 1);
  assert.equal(result.metrics.cohens_kappa, 1);
  assert.equal(result.metrics.per_stratum.length, 6);
  assert(result.metrics.per_stratum.every((item) => item.double_reviewed_cases > 0));
});

test("controlled identities and controlled-label fields are rejected", () => {
  const submission = preflightSubmission();
  submission.reviewer_roster[0].reviewer_id = "reviewer:controlled.fixture";
  submission.records[0].reviewer_id = "reviewer:controlled.fixture";
  submission.records[0].synthetic_expected_relationship = "same_identity";
  submission.records[0].evidence_reference_ids = [submission.records[2].evidence_reference_ids[0]];
  submission.record_set_sha256 = sha256(canonicalJson(submission.records));
  const codes = validate(submission).errors.map((item) => item.code);
  assert(codes.includes("CONTROLLED_FIXTURE_IDENTIFIER_FORBIDDEN"));
  assert(codes.includes("UNEXPECTED_FIELD"));
  assert(codes.includes("UNKNOWN_EVIDENCE_REFERENCE"));
});

test("a primary-secondary disagreement remains unresolved without a distinct adjudicator", () => {
  const submission = preflightSubmission();
  submission.records[1].decision = submission.records[0].decision === "same_identity" ? "not_same_identity" : "same_identity";
  submission.record_set_sha256 = sha256(canonicalJson(submission.records));
  const result = validate(submission);
  assert(result.errors.some((item) => item.code === "UNRESOLVED_REVIEW_CONFLICT"));
  assert.equal(result.metrics.unresolved_conflicts, 1);
  assert.equal(result.ready_for_import, false);
});

test("a conflict is structurally resolved only by a third identified reviewer", () => {
  const submission = preflightSubmission();
  submission.records[1].decision = submission.records[0].decision === "same_identity" ? "not_same_identity" : "same_identity";
  const adjudicator = reviewer("reviewer:charlie.independent", ["adjudicator"], "charlie");
  submission.reviewer_roster.push(adjudicator);
  submission.records.push(recordFor(sampledReviewCases()[0], adjudicator, "adjudicator", 1, "needs_more_evidence"));
  submission.record_set_sha256 = sha256(canonicalJson(submission.records));
  const result = validate(submission);
  assert.equal(result.errors.some((item) => item.code === "UNRESOLVED_REVIEW_CONFLICT"), false);
  assert.equal(result.metrics.resolved_conflicts, 1);
  assert.equal(result.metrics.unresolved_conflicts, 0);
  assert.deepEqual(result.errors.map((item) => item.code), ["AUTHORIZATION_REQUIRED"]);
  assert.equal(result.validation_receipt, null);
});

test("reviewer identity and independence receipts cannot be reused", () => {
  const submission = preflightSubmission();
  submission.reviewer_roster[1].identity_receipt_id = submission.reviewer_roster[0].identity_receipt_id;
  submission.records.filter((item) => item.reviewer_id === submission.reviewer_roster[1].reviewer_id).forEach((item) => {
    item.reviewer_identity_receipt_id = submission.reviewer_roster[1].identity_receipt_id;
  });
  submission.record_set_sha256 = sha256(canonicalJson(submission.records));
  assert(validate(submission).errors.some((item) => item.code === "REUSED_IDENTITY_RECEIPT"));
});
