import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateStoredArtifactSeal } from "../src/artifact-seal.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function validateIdentityPackage() {
  const result = await validateStoredArtifactSeal(packageRoot, "@ushso/identity");
  const receipt = result.receipt;
  if (receipt.automatic_rule_state !== "disabled_candidate_only" || receipt.externally_verified_human_reviews !== 0 || receipt.double_reviewed_cases !== 0 || receipt.percent_agreement !== null || receipt.cohens_kappa !== null) throw new Error("IDENTITY_EXTERNAL_REVIEW_BOUNDARY_INVALID");
  if (receipt.automatic_rule_enablement_required_for_candidate_only_release !== false) throw new Error("IDENTITY_CANDIDATE_ONLY_RELEASE_POLICY_INVALID");
  if (receipt.analysis_executed !== false || receipt.identity_merges_performed !== false || receipt.access_workflows_submitted !== 0) throw new Error("IDENTITY_PRODUCT_BOUNDARY_INVALID");
  return {
    package_name: result.manifest.package_name,
    package_version: result.manifest.package_version,
    valid: true,
    manifest_verified: true,
    file_count: result.computed.file_count,
    package_payload_digest_sha256: result.computed.package_payload_digest_sha256,
    automatic_rule_state: receipt.automatic_rule_state,
    automatic_rule_enablement_required_for_candidate_only_release: false,
    external_human_metrics: { reviews: 0, double_reviewed_cases: 0, percent_agreement: null, cohens_kappa: null },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateIdentityPackage().then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)).catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
