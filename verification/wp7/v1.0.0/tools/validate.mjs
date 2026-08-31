import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateEvaluationPackage } from "../../../../evaluation/identity/v1.0.0/tools/validate.mjs";
import { validateStoredArtifactSeal } from "../../../../packages/identity/src/artifact-seal.mjs";
import { validateIdentityPackage } from "../../../../packages/identity/tools/validate.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../../..");

function validateExternalGates(gates) {
  const adjudication = gates.find((gate) => gate.gate_id === "identity-human-double-review");
  const enablement = gates.find((gate) => gate.gate_id === "identity-rule-enablement");
  const migrations = gates.find((gate) => gate.gate_id === "wp7-migrations-0008-0009");
  if (adjudication?.authorization_reference !== "AUTH-14" || adjudication.authorization_status !== "not_requested" || adjudication.authorized !== false || adjudication.blocking !== true || adjudication.status !== "pending_external_authorization") return false;
  if (enablement?.blocking !== false || enablement.status !== "not_required_for_candidate_only_release") return false;
  if (migrations?.blocking !== true || migrations.status !== "pending_wp6_dependency_clearance") return false;
  return gates.filter((gate) => gate.blocking === true).length === 2;
}

export async function validateVerificationPackage() {
  const [seal, identity, evaluation] = await Promise.all([
    validateStoredArtifactSeal(packageRoot, "@ushso/verification-wp7-v1"),
    validateIdentityPackage(),
    validateEvaluationPackage(),
  ]);
  const ledger = JSON.parse(await fs.readFile(path.join(packageRoot, "evidence-ledger.json"), "utf8"));
  for (const requirement of ledger.requirements) {
    for (const implementation of requirement.implementation) await fs.access(path.join(repositoryRoot, implementation));
    for (const testPath of requirement.tests) await fs.access(path.join(repositoryRoot, testPath));
    if (requirement.receipt) await fs.access(path.join(packageRoot, requirement.receipt));
  }
  const benchmark = JSON.parse(await fs.readFile(path.join(packageRoot, "receipts/identity-benchmark.json"), "utf8"));
  const reversal = JSON.parse(await fs.readFile(path.join(packageRoot, "receipts/identity-adjudication-reversal.json"), "utf8"));
  const aggregate = JSON.parse(await fs.readFile(path.join(packageRoot, "receipts/wp7-verification.json"), "utf8"));
  const authorizationRegister = JSON.parse(await fs.readFile(path.join(repositoryRoot, "verification/external-authorization/v1.0.0/register.json"), "utf8"));
  const auth14 = authorizationRegister.entries.find((entry) => entry.id === "AUTH-14");
  if (auth14?.status !== "not_requested" || auth14?.authorized !== false || auth14?.environment !== "identity_evaluation_governance") throw new Error("AUTH_14_REGISTER_STATE_INVALID");
  if (benchmark.external_adjudication.double_reviewed_cases !== 0 || benchmark.external_adjudication.percent_agreement !== null || benchmark.external_adjudication.cohens_kappa !== null || benchmark.external_adjudication.completed_adjudication_receipt_present !== false || benchmark.production_rule_state !== "disabled_candidate_only") throw new Error("WP7_BENCHMARK_RECEIPT_EXTERNAL_BOUNDARY_INVALID");
  if (benchmark.reviewer_packet?.status !== "prepared_not_authorized_for_review" || benchmark.reviewer_packet?.packet_byte_sha256 !== evaluation.reviewer_packet_byte_sha256 || benchmark.reviewer_packet?.reviewer_case_sha256 !== evaluation.reviewer_case_sha256 || benchmark.reviewer_packet?.completed_receipt_present !== false) throw new Error("WP7_REVIEWER_PACKET_RECEIPT_INVALID");
  if (reversal.external_adjudication.externally_verified_reviews !== 0 || reversal.external_adjudication.percent_agreement !== null || reversal.external_adjudication.cohens_kappa !== null || reversal.external_adjudication.authorization_status !== "not_requested" || reversal.external_adjudication.authorized !== false) throw new Error("WP7_REVERSAL_RECEIPT_EXTERNAL_BOUNDARY_INVALID");
  if (aggregate.runner.failed_events !== 0 || !validateExternalGates(aggregate.external_gates)) throw new Error("WP7_AGGREGATE_RECEIPT_INVALID");
  if (!validateExternalGates(ledger.external_gates)) throw new Error("WP7_LEDGER_EXTERNAL_GATE_INVALID");
  return {
    package_name: seal.manifest.package_name,
    package_version: seal.manifest.package_version,
    valid: true,
    manifest_verified: true,
    package_payload_digest_sha256: seal.computed.package_payload_digest_sha256,
    dependency_seals: { identity: identity.package_payload_digest_sha256, evaluation: evaluation.package_payload_digest_sha256 },
    aggregate_tests: aggregate.runner,
    external_gates: ledger.external_gates,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateVerificationPackage().then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)).catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
