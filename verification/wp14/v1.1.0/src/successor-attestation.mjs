import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { buildImplementationManifest } from "../../v1.0.0/src/package-integrity.mjs";
import {
  canonicalJson,
  readJson,
  repoPath,
  sha256File,
  verifyCanonicalDigest,
} from "../../v1.0.0/src/common.mjs";

export const SUCCESSOR_IMPLEMENTATION_COMMIT = "f2641a3bfd5ae7249d0acffff883b312e4bdb077";
export const SUCCESSOR_IMPLEMENTATION_TREE = "dc80d1c0f9ff7d8c4a2a4a8beb01ed2723878675";
export const SUCCESSOR_POLICY_PATH = "verification/wp14/v1.1.0/policy/successor-attestation.v1.1.0.json";
export const SUCCESSOR_RECEIPT_PATH = "verification/wp14/v1.1.0/receipts/successor-attestation.json";

const EXPECTED_RESTRICTIONS = Object.freeze([
  "release_gate_execution",
  "deployment",
  "provider_mutation",
  "production_action",
  "production_eligibility_claim",
  "historical_receipt_repin",
  "historical_receipt_overwrite",
]);

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function git(args, { encoding = "utf8", allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: repoPath(""),
    encoding,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr || "").trim()}`);
  }
  return result;
}

function exactKeys(value, expected) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join("\u0000") === [...expected].sort().join("\u0000");
}

export function validateSuccessorDocuments(policy, receipt) {
  if (policy?.schema_version !== "ushso-wp14-successor-attestation-policy.v1.1.0"
      || policy.attestation_id !== "wp14-fixture-cas-successor-2026-09-01"
      || policy.authorization?.authorization_id !== "owner-wp14-successor-attestation-2026-09-01"
      || policy.authorization?.authorized !== true
      || policy.authorization?.scope !== "local fixture-only CAS successor attestation") {
    throw new Error("successor attestation owner authorization is invalid");
  }
  if (policy.implementation?.commit !== SUCCESSOR_IMPLEMENTATION_COMMIT
      || policy.implementation?.tree !== SUCCESSOR_IMPLEMENTATION_TREE
      || !Array.isArray(policy.implementation?.files)
      || policy.implementation.files.length !== 2) {
    throw new Error("successor attestation implementation binding is invalid");
  }
  if (!exactKeys(policy.restrictions, EXPECTED_RESTRICTIONS)
      || EXPECTED_RESTRICTIONS.some((name) => policy.restrictions[name] !== false)
      || policy.production_eligibility !== false
      || policy.historical_v1_0_0?.mutation_permitted !== false) {
    throw new Error("successor attestation restrictions are invalid");
  }
  if (receipt?.schema_version !== "ushso-wp14-successor-attestation-receipt.v1.1.0"
      || receipt.receipt_id !== policy.attestation_id
      || receipt.authorization_id !== policy.authorization.authorization_id
      || receipt.implementation?.commit !== SUCCESSOR_IMPLEMENTATION_COMMIT
      || receipt.implementation?.tree !== SUCCESSOR_IMPLEMENTATION_TREE
      || receipt.production_eligibility !== false
      || receipt.release_gate?.executed !== false
      || receipt.release_gate?.historical_failure_preserved !== true
      || !exactKeys(receipt.actions, ["provider_mutations", "deployments", "production_actions", "release_gate_executions"])
      || Object.values(receipt.actions).some((value) => value !== 0)) {
    throw new Error("successor attestation receipt boundary is invalid");
  }
  if (!verifyCanonicalDigest(receipt, "receipt_sha256").ok) {
    throw new Error("successor attestation receipt digest is invalid");
  }
  return true;
}

function recordCheck(checks, failures, id, condition, details = null) {
  checks.push({ id, status: condition ? "pass" : "fail", details });
  if (!condition) failures.push({ id, details });
}

export function verifySuccessorAttestation() {
  const checks = [];
  const failures = [];
  const policy = readJson(repoPath(SUCCESSOR_POLICY_PATH));
  const receipt = readJson(repoPath(SUCCESSOR_RECEIPT_PATH));
  const record = (id, condition, details = null) => recordCheck(checks, failures, id, condition, details);

  try {
    validateSuccessorDocuments(policy, receipt);
    record("successor-documents", true);
  } catch (error) {
    record("successor-documents", false, error.message);
  }

  const actualTree = git(["rev-parse", `${SUCCESSOR_IMPLEMENTATION_COMMIT}^{tree}`]).stdout.trim();
  record("authorized-implementation-tree", actualTree === SUCCESSOR_IMPLEMENTATION_TREE, {
    expected: SUCCESSOR_IMPLEMENTATION_TREE,
    actual: actualTree,
  });
  const currentHead = git(["rev-parse", "HEAD"]).stdout.trim();
  const ancestor = git(["merge-base", "--is-ancestor", SUCCESSOR_IMPLEMENTATION_COMMIT, currentHead], { allowFailure: true });
  record("authorized-implementation-is-ancestor", ancestor.status === 0, { current_head: currentHead });

  for (const file of policy.implementation.files) {
    const actualBlob = git(["rev-parse", `${SUCCESSOR_IMPLEMENTATION_COMMIT}:${file.authorized_path}`]).stdout.trim();
    const authorizedBytes = git(["show", `${SUCCESSOR_IMPLEMENTATION_COMMIT}:${file.authorized_path}`], { encoding: null }).stdout;
    const successorBytes = readFileSync(repoPath(file.successor_path));
    record(`source-blob:${file.successor_path}`, actualBlob === file.git_blob_oid, { expected: file.git_blob_oid, actual: actualBlob });
    record(`source-sha256:${file.successor_path}`, sha256(authorizedBytes) === file.sha256 && sha256(successorBytes) === file.sha256, {
      expected: file.sha256,
      authorized: sha256(authorizedBytes),
      successor: sha256(successorBytes),
    });
    record(`source-bytes:${file.successor_path}`, Buffer.compare(authorizedBytes, successorBytes) === 0);
  }

  const historical = policy.historical_v1_0_0;
  const sealedManifest = readJson(repoPath(historical.implementation_manifest_path));
  const currentManifest = buildImplementationManifest();
  record("historical-v1-manifest-file", `sha256:${sha256File(repoPath(historical.implementation_manifest_path))}` === historical.implementation_manifest_file_sha256);
  record("historical-v1-package-preserved", canonicalJson(currentManifest) === canonicalJson(sealedManifest));
  for (const item of historical.required_receipts) {
    const document = readJson(repoPath(item.path));
    record(`historical-receipt-file:${item.path}`, `sha256:${sha256File(repoPath(item.path))}` === item.file_sha256);
    record(`historical-receipt-digest:${item.path}`, verifyCanonicalDigest(document, item.digest_field).ok);
  }

  record("successor-policy-file-binding", receipt.policy?.path === SUCCESSOR_POLICY_PATH
    && receipt.policy?.file_sha256 === `sha256:${sha256File(repoPath(SUCCESSOR_POLICY_PATH))}`);
  record("successor-source-list-binding", canonicalJson(receipt.implementation?.files) === canonicalJson(policy.implementation.files));
  record("historical-manifest-binding", receipt.historical_v1_0_0?.implementation_manifest_file_sha256 === historical.implementation_manifest_file_sha256);

  const register = readJson(repoPath("verification/external-authorization/v1.0.0/register.json"));
  const authorizationBoundary = Array.isArray(register.entries)
    && register.entries.length > 0
    && register.entries.every((entry) => entry.status === "not_requested" && entry.authorized === false);
  record("external-authorizations-remain-false", authorizationBoundary, { entries: register.entries?.length ?? 0 });
  record("zero-action-boundary", Object.values(receipt.actions ?? {}).every((value) => value === 0));
  record("not-production-eligible", policy.production_eligibility === false && receipt.production_eligibility === false);
  record("release-gate-not-executed", receipt.release_gate?.executed === false && receipt.release_gate?.historical_failure_preserved === true);

  return {
    schema_version: "ushso-wp14-successor-attestation-verification.v1.1.0",
    status: failures.length === 0 ? "PASS_SUCCESSOR_ATTESTATION_BOUND_TO_F2641A3" : "FAIL",
    attested_commit: SUCCESSOR_IMPLEMENTATION_COMMIT,
    attested_tree: SUCCESSOR_IMPLEMENTATION_TREE,
    current_checkout_commit: currentHead,
    production_eligibility: false,
    check_count: checks.length,
    passed: checks.filter((item) => item.status === "pass").length,
    failed: failures.length,
    checks,
    failures,
  };
}
