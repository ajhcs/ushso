import { readFile } from "node:fs/promises";
import {
  canonical,
  sha256,
  validateLedger,
  projectLedger,
} from "../../packages/source-selection/index.mjs";
import { validateGenerationApproval } from "../../packages/source-selection-approval/index.mjs";
const [approvalPath, ledgerPath, bundlePath, rightsPath, target] =
  process.argv.slice(2);
if (!target)
  throw new Error(
    "usage: validate-generation.mjs approval.json ledger.json bundle.json rights-policy.json exact-target",
  );
const read = async (p) => JSON.parse(await readFile(p, "utf8"));
const [approval, ledger, bundle, rights] = await Promise.all(
  [approvalPath, ledgerPath, bundlePath, rightsPath].map(read),
);
validateLedger(ledger);
const expected = {
  generation_id: sha256(canonical(bundle.data_manifest)),
  ledger_revision: sha256(canonical(ledger)),
  bundle_hash: sha256(canonical(bundle)),
  rights_policy_hash: sha256(canonical(rights)),
  target,
};
const m = bundle.data_manifest;
if (
  m.accepted_ledger_revision !== expected.ledger_revision ||
  m.accepted_ledger_sha256 !== expected.ledger_revision ||
  m.rights_policy_sha256 !== expected.rights_policy_hash ||
  m.evidence_manifest_sha256 !== sha256(canonical(ledger.captures)) ||
  !Array.isArray(rights.revoked_rights) ||
  canonical(
    projectLedger(ledger, expected.generation_id, {
      revokedRights: rights.revoked_rights,
    }),
  ) !== canonical(bundle.views)
)
  throw new Error("generation_artifact_mismatch");
if (
  bundle.rights_expire_at &&
  Date.parse(bundle.rights_expire_at) <= Date.now()
)
  throw new Error("generation_rights_expired");
validateGenerationApproval(approval, expected);
console.log(
  JSON.stringify(
    { status: "valid_exact_generation_approval", ...expected, executed: false },
    null,
    2,
  ),
);
