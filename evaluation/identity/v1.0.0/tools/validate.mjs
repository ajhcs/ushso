import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateStoredArtifactSeal } from "../../../../packages/identity/src/artifact-seal.mjs";
import { assertReviewerCasesAreBlind, blindReviewCaseDigest, buildBlindReviewCases } from "../src/adjudication-packet.mjs";
import { benchmarkCaseDigest, buildBenchmarkCases } from "../src/cases.mjs";
import { evaluateIdentityBenchmark } from "../src/evaluate.mjs";
import { runConformancePredictions } from "../src/predict.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../../..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function validateEvaluationPackage() {
  const seal = await validateStoredArtifactSeal(packageRoot, "@ushso/evaluation-identity-v1");
  const benchmarkManifest = JSON.parse(await fs.readFile(path.join(packageRoot, "benchmark/manifest.json"), "utf8"));
  const cases = buildBenchmarkCases(benchmarkManifest);
  const caseDigest = benchmarkCaseDigest(cases);
  if (cases.length !== 720 || caseDigest !== benchmarkManifest.expected_case_sha256) throw new Error("IDENTITY_BENCHMARK_SEAL_INVALID");
  const reviewerCases = buildBlindReviewCases(cases);
  assertReviewerCasesAreBlind(reviewerCases);
  const packetBytes = await fs.readFile(path.join(packageRoot, "adjudication/reviewer-packet.json"));
  const packet = JSON.parse(packetBytes);
  if (packet.status !== "prepared_not_authorized_for_review" || packet.authorization_boundary?.reference !== "AUTH-14" || packet.authorization_boundary?.register_status !== "not_requested" || packet.authorization_boundary?.authorized !== false || packet.authorization_boundary?.permission_granted !== false || packet.authorization_boundary?.authorization_receipt_id !== null) throw new Error("IDENTITY_REVIEW_PACKET_AUTHORIZATION_BOUNDARY_INVALID");
  if (packet.benchmark?.case_count !== cases.length || packet.benchmark?.case_sha256 !== caseDigest || packet.reviewer_case_contract?.case_count !== reviewerCases.length || packet.reviewer_case_contract?.case_sha256 !== blindReviewCaseDigest(reviewerCases)) throw new Error("IDENTITY_REVIEW_PACKET_CASE_BINDING_INVALID");
  for (const binding of packet.artifact_bindings ?? []) {
    const bytes = await fs.readFile(path.join(packageRoot, binding.path));
    if (digest(bytes) !== binding.byte_sha256) throw new Error(`IDENTITY_REVIEW_PACKET_ARTIFACT_DRIFT:${binding.path}`);
  }
  if ((packet.artifact_bindings ?? []).length !== 10) throw new Error("IDENTITY_REVIEW_PACKET_ARTIFACT_SET_INVALID");
  const registerBytes = await fs.readFile(path.join(repositoryRoot, packet.authorization_boundary.register_path));
  const authorizationRegister = JSON.parse(registerBytes);
  const auth14 = authorizationRegister.entries.find((entry) => entry.id === "AUTH-14");
  if (digest(registerBytes) !== packet.authorization_boundary.register_byte_sha256 || auth14?.environment !== "identity_evaluation_governance" || auth14?.status !== "not_requested" || auth14?.authorized !== false) throw new Error("AUTH_14_REGISTER_STATE_INVALID");
  const evaluation = evaluateIdentityBenchmark({ cases, predictions: runConformancePredictions(cases) });
  if (evaluation.production_rule_enabled !== false || evaluation.external_adjudication.external_reviews !== 0 || evaluation.external_adjudication.double_reviewed_cases !== 0 || evaluation.external_adjudication.percent_agreement !== null || evaluation.external_adjudication.cohens_kappa !== null) throw new Error("IDENTITY_BENCHMARK_EXTERNAL_METRICS_INVALID");
  if (!evaluation.automatic_rules.every((rule) => rule.state === "disabled_candidate_only")) throw new Error("IDENTITY_BENCHMARK_RULE_ENABLED");
  if (evaluation.automatic_resolution_enablement_required_for_candidate_only_release !== false || !evaluation.automatic_rules.every((rule) => rule.candidate_only_release_blocking === false)) throw new Error("IDENTITY_CANDIDATE_ONLY_RELEASE_POLICY_INVALID");
  const receipt = seal.receipt;
  if (receipt.case_sha256 !== caseDigest || receipt.total_cases !== 720 || receipt.externally_verified_human_reviews !== 0 || receipt.production_rule_state !== "disabled_candidate_only" || receipt.automatic_rule_enablement_required_for_candidate_only_release !== false) throw new Error("IDENTITY_BENCHMARK_RECEIPT_INVALID");
  if (receipt.external_adjudication_authorization_reference !== "AUTH-14" || receipt.external_adjudication_authorization_status !== "not_requested" || receipt.external_adjudication_authorized !== false || receipt.reviewer_packet_byte_sha256 !== digest(packetBytes) || receipt.completed_adjudication_receipt_present !== false) throw new Error("IDENTITY_BENCHMARK_EXTERNAL_BOUNDARY_RECEIPT_INVALID");
  return {
    package_name: seal.manifest.package_name,
    package_version: seal.manifest.package_version,
    valid: true,
    manifest_verified: true,
    package_payload_digest_sha256: seal.computed.package_payload_digest_sha256,
    case_sha256: caseDigest,
    reviewer_case_sha256: packet.reviewer_case_contract.case_sha256,
    reviewer_packet_byte_sha256: digest(packetBytes),
    total_cases: cases.length,
    synthetic_candidate_recall: evaluation.synthetic_conformance.positive_candidate_recall,
    synthetic_false_automatic_merges: evaluation.synthetic_conformance.false_automatic_merges,
    external_human_metrics: { reviews: 0, double_reviewed_cases: 0, percent_agreement: null, cohens_kappa: null },
    production_rule_state: "disabled_candidate_only",
    automatic_rule_enablement_required_for_candidate_only_release: false,
    external_adjudication: { authorization_reference: "AUTH-14", register_status: "not_requested", authorized: false, completed_receipt_present: false },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateEvaluationPackage().then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)).catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
