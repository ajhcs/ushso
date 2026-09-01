#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCandidateSnapshot } from "../src/candidate-snapshot.mjs";
import { canonicalJson, packageRoot, readJson, repoPath, sha256File, verifyCanonicalDigest } from "../src/common.mjs";
import { buildImplementationManifest } from "../src/package-integrity.mjs";
import { loadAuthorizationRegister, loadPolicy, runFixtureRehearsal } from "../src/rehearsal.mjs";
import { validateCandidate, verifyRollbackBundle } from "../src/release-state-machine.mjs";
import { compileSchemaRegistry, validateSchema } from "../src/schema-validation.mjs";
import { buildVerificationReceipt } from "../src/verification-receipt.mjs";

const failures = [];
const checks = [];

function check(id, condition, details = null) {
  checks.push({ id, status: condition ? "pass" : "fail", details });
  if (!condition) failures.push({ id, details });
}

function parse(path) {
  try {
    return readJson(resolve(packageRoot, path));
  } catch (error) {
    failures.push({ id: `parse:${path}`, details: error.message });
    return null;
  }
}

const policy = loadPolicy();
const register = loadAuthorizationRegister();
const savedCandidate = parse("receipts/candidate-envelope.json");
const currentCandidate = buildCandidateSnapshot();
const savedRehearsal = parse("receipts/zero-traffic-dry-run.json");
const currentRehearsal = runFixtureRehearsal();
const boundaryPins = parse("receipts/runtime-boundary-pins.json");
const savedManifest = parse("receipts/implementation-file-manifest.json");
const currentManifest = buildImplementationManifest();
const savedVerificationReceipt = parse("receipts/wp14-verification.json");
const currentVerificationReceipt = buildVerificationReceipt();
const ledger = parse("evidence-ledger.json");
const mapping = parse("requirements-dod-mapping.json");

check("candidate-envelope-canonical-digest", savedCandidate && verifyCanonicalDigest(savedCandidate, "candidate_digest_sha256").ok);
check("candidate-envelope-current-artifacts", savedCandidate && canonicalJson(savedCandidate) === canonicalJson(currentCandidate));
check("rehearsal-canonical-digest", savedRehearsal && verifyCanonicalDigest(savedRehearsal, "receipt_sha256").ok);
check("rehearsal-deterministic", savedRehearsal && canonicalJson(savedRehearsal) === canonicalJson(currentRehearsal));
check("implementation-manifest-current", savedManifest && canonicalJson(savedManifest) === canonicalJson(currentManifest));
check("implementation-manifest-digest", savedManifest && verifyCanonicalDigest(savedManifest, "manifest_sha256").ok);
check("verification-receipt-canonical-digest", savedVerificationReceipt && verifyCanonicalDigest(savedVerificationReceipt, "receipt_sha256").ok);
check("verification-receipt-deterministic", savedVerificationReceipt && canonicalJson(savedVerificationReceipt) === canonicalJson(currentVerificationReceipt));
try {
  check("current-candidate-strict-contract", validateCandidate(currentCandidate, policy) === true);
} catch (error) {
  check("current-candidate-strict-contract", false, { code: error.code, message: error.message, details: error.details });
}

check("seven-stages-policy", policy.stages.length === 7 && policy.stages.map((stage) => stage.id).join(",") === "expand,backfill,shadow,internal_canary,public_promotion,soak,retire_jsonl_runtime");
const mappedAuth = new Set(Object.values(policy.central_authorization_gates).flat());
check("central-authorization-set", canonicalJson([...mappedAuth].sort()) === canonicalJson(["AUTH-03", "AUTH-05", "AUTH-06", "AUTH-07", "AUTH-08", "AUTH-09", "AUTH-11"]));
for (const id of mappedAuth) {
  const entry = register.entries.find((item) => item.id === id);
  check(`authorization-${id}-not-granted`, entry?.status === "not_requested" && entry?.authorized === false, entry ? { status: entry.status, authorized: entry.authorized } : "missing");
}

for (const item of boundaryPins?.files ?? []) {
  const current = sha256File(repoPath(item.path));
  check(`runtime-boundary:${item.path}`, item.entry_sha256 === item.exit_sha256 && item.exit_sha256 === current, { expected: item.exit_sha256, current });
}
check("runtime-jsonl-active", boundaryPins?.runtime_jsonl_active === true && boundaryPins?.runtime_jsonl_retired === false);
check("worker-entry-not-composed-with-wp14", !/verification\/wp14|cutover-state|retire_runtime_jsonl/.test(readFileSync(repoPath("worker/index.mjs"), "utf8")));

check("fixture-two-connector-cycles", savedRehearsal?.rehearsals?.connector_refresh_cycle_count === 2);
check("fixture-two-rebuild-cycles", savedRehearsal?.rehearsals?.rebuild_promote_rollback_cycle_count === 2);
check("fixture-cycles-not-production-soak", savedRehearsal?.rehearsals?.fixture_cycles_count_toward_production_soak === false);
check("fixture-rollback-triad", savedRehearsal?.rehearsals?.generation_pointer_rollback_rehearsed === true && savedRehearsal?.rehearsals?.worker_and_asset_rollback_rehearsed === true && savedRehearsal?.rehearsals?.static_fallback_rehearsed === true);
check("fixture-zero-traffic-final", savedRehearsal?.rehearsals?.final_public_traffic_percent === 0 && savedRehearsal?.rehearsals?.final_public_backend === "immutable_static_jsonl");
check("fixture-failure-injection", savedRehearsal?.failure_injection?.passed === true && savedRehearsal.failure_injection.case_count >= 8);
check("n-minus-one-bundle", savedRehearsal?.n_minus_one?.rollback_bundle_verification?.ok === true && savedRehearsal?.n_minus_one?.cross_version_asset_matrix?.asset_404_count === 0);
check("current-pointer-rollbacks-non-noop", currentRehearsal?.rehearsals?.pointer_changes_non_noop === true && currentRehearsal?.rehearsals?.generation_pointer_rollback_rehearsed === true && currentRehearsal?.rehearsals?.worker_and_asset_rollback_rehearsed === true && currentRehearsal?.rehearsals?.static_fallback_rehearsed === true);
check("current-adversarial-failure-matrix", currentRehearsal?.failure_injection?.passed === true && currentRehearsal.failure_injection.case_count >= 30, { case_count: currentRehearsal?.failure_injection?.case_count });
const currentBundle = currentRehearsal?.n_minus_one?.rollback_bundle;
check("current-complete-rollback-bundle", currentBundle && verifyRollbackBundle(currentBundle, currentCandidate, policy, { now: currentBundle.prepared_at, expected_anchor_at: currentBundle.support_window_anchor_at }).ok === true);
check("no-production-claims", savedRehearsal && Object.values(savedRehearsal.production_status).every((value) => value === false));
check("zero-execution-boundary", savedRehearsal && Object.values(savedRehearsal.execution_boundary).every((value) => value === 0));

check("evidence-ledger-shape", ledger?.entries?.length >= 20 && ledger.entries.every((entry) => entry.requirement_id && entry.status && Array.isArray(entry.evidence)));
check("dod-mapping-honest", mapping?.overall_wp14_acceptance === "BLOCKED_EXTERNAL_AND_PREDECESSOR_GATES" && mapping.items.filter((item) => item.id.startsWith("WP14-AC-")).every((item) => item.satisfied === false));
check("retirement-denied-in-ledger", ledger?.entries?.find((entry) => entry.requirement_id === "M24.7-JSONL-RETIREMENT")?.status === "fail_closed_ineligible_runtime_intact");

try {
  const registry = compileSchemaRegistry();
  check("strict-draft-2020-12-schema-registry", registry.files.length === 4 && registry.records.every(({ schema }) => schema.$schema === "https://json-schema.org/draft/2020-12/schema"));
  check("schema-application-current-candidate", validateSchema("candidate-envelope.schema.json", currentCandidate).ok === true);
  check("schema-application-current-rollback-bundle", validateSchema("rollback-bundle.schema.json", currentBundle).ok === true);
} catch (error) {
  check("strict-draft-2020-12-schema-registry", false, error.message);
}

const sourceText = [
  "src/candidate-snapshot.mjs", "src/durable-transition.mjs", "src/evidence-receipts.mjs", "src/rehearsal.mjs", "src/release-state-machine.mjs", "src/schema-validation.mjs", "tools/cutover.mjs",
].map((path) => readFileSync(resolve(packageRoot, path), "utf8")).join("\n");
check("tooling-no-network-client", !/\bfetch\s*\(|https?\.request|node:https|node:http/.test(sourceText));
check("tooling-no-provider-cli", !/\bwrangler\b|\bterraform\s+(?:apply|destroy)|\bneonctl\b|\bcurl\b/.test(sourceText));
check("tooling-no-raw-query-storage", !/writeFile|appendFile|createWriteStream/.test(sourceText));
check("durable-cas-append-port-present", /atomicCompareAndSwapAppend/.test(sourceText) && /DURABLE_CAS_CONFLICT/.test(sourceText) && /AUTHORITATIVE_DURABLE_ADAPTER_REQUIRED/.test(sourceText));
check("cli-production-transition-fail-closed", /state\.mode !== "fixture_rehearsal"/.test(readFileSync(resolve(packageRoot, "tools/cutover.mjs"), "utf8")));

const expectedReceiptDriftIds = new Set([
  "candidate-envelope-current-artifacts",
  "rehearsal-deterministic",
  "implementation-manifest-current",
  "verification-receipt-deterministic",
]);
const nonReceiptDriftFailures = failures.filter((failure) => !expectedReceiptDriftIds.has(failure.id));

const result = {
  schema_version: "ushso-wp14-validator-result.v1.0.0",
  status: failures.length === 0 ? "PASS_LOCAL_ZERO_TRAFFIC_FOUNDATION" : "FAIL",
  check_count: checks.length,
  passed: checks.filter((item) => item.status === "pass").length,
  failed: failures.length,
  expected_unsealed_receipt_drift_only: failures.length > 0 && nonReceiptDriftFailures.length === 0,
  expected_unsealed_receipt_drift_ids: [...expectedReceiptDriftIds].sort(),
  candidate_digest_sha256: currentCandidate.candidate_digest_sha256,
  rehearsal_receipt_sha256: currentRehearsal.receipt_sha256,
  implementation_manifest_sha256: currentManifest.manifest_sha256,
  production_accepted: false,
  checks,
  failures,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
