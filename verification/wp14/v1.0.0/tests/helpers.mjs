import { createHmac } from "node:crypto";
import { buildCandidateSnapshot } from "../src/candidate-snapshot.mjs";
import { buildEvidenceReceipt } from "../src/evidence-receipts.mjs";
import { canonicalJson, sha256Bytes, sha256Json, withCanonicalDigest } from "../src/common.mjs";
import { createManualClock, loadAuthorizationRegister, loadPolicy } from "../src/rehearsal.mjs";

export const AUTHORIZATION_IDS = ["AUTH-03", "AUTH-05", "AUTH-06", "AUTH-07", "AUTH-08", "AUTH-09", "AUTH-11"];

export const GATE_NAMES = [
  "additive_migration_validation", "backwards_compatibility_validation", "migration_applied_and_compatible", "backfill_reconciled",
  "shadow_parity_pass", "search_quality_release_gate", "coverage_release_gate", "planner_release_gate", "machine_toolkit_release_gate",
  "seo_release_gate", "production_like_2x_load_gate", "managed_recovery_gate", "n_minus_one_compatibility",
  "cross_version_asset_matrix_zero_404", "v1_translation_compatibility", "static_fallback_rehearsed", "generation_rollback_rehearsed",
  "support_retention_lock", "alert_oncall_ownership", "incident_process_ready", "no_unresolved_coverage_or_visibility_incident",
  "queue_and_outbox_age_slo", "all_dlq_and_workflows_resolved_or_owned", "managed_alerts_exercised",
  "no_unresolved_sev1_or_sev2_final_interval", "n_minus_one_dependency_audit", "static_emergency_artifact_healthy",
  "managed_failover_measured", "pitr_measured", "static_drill_measured",
];

export function digest(value) {
  return `sha256:${sha256Json(value)}`;
}

export function createProductionTestAuthority() {
  const key = "wp14-local-test-key-not-an-operational-secret";
  const key_id = "wp14-production-port-test-key";
  const sign = (material) => `sha256:${createHmac("sha256", key).update(material).digest("hex")}`;
  return {
    trust_class: "production",
    method: "hmac_sha256_test_v1",
    key_id,
    sign,
    verify({ receipt, signing_material }) {
      const ok = receipt.proof.method === "hmac_sha256_test_v1"
        && receipt.proof.key_id === key_id
        && receipt.proof.signature === sign(signing_material);
      return {
        ok,
        verifier_receipt_sha256: digest({ verifier: key_id, receipt: receipt.receipt_sha256, ok }),
      };
    },
  };
}

function serializeRegister(register) {
  return Buffer.from(`${JSON.stringify(register, null, 2)}\n`, "utf8");
}

export function buildProductionCandidate({ id = "wp14-production-test-candidate", postRemoval = false } = {}) {
  const register = structuredClone(loadAuthorizationRegister());
  for (const entry of register.entries) {
    if (AUTHORIZATION_IDS.includes(entry.id)) {
      entry.status = "authorized";
      entry.authorized = true;
    }
  }
  const registerBytes = serializeRegister(register);
  const registerSha256 = `sha256:${sha256Bytes(registerBytes)}`;
  const candidate = structuredClone(buildCandidateSnapshot());
  delete candidate.candidate_digest_sha256;
  candidate.candidate_id = id;
  candidate.candidate_class = "production_release_candidate";
  candidate.environment = "production";
  candidate.git.exact_candidate_tree_sealed = true;
  candidate.git.working_tree_status = "clean_exact_candidate";
  candidate.git.note = "Synthetic exact-candidate shape for local state-machine tests; never operational evidence.";
  candidate.release_gate.status = "PASS";
  candidate.release_gate.receipt_sha256 = digest({ candidate: id, release_gate: "synthetic-test-pass" });
  candidate.release_gate.reason = "Synthetic trusted-port contract test only.";
  candidate.authorization_register_sha256 = registerSha256;
  const registerPin = candidate.artifact_pins.find((pin) => pin.role === "authorization_register");
  registerPin.sha256 = registerSha256;
  candidate.artifact_pin_count = candidate.artifact_pins.length;
  candidate.candidate_content_manifest_sha256 = `sha256:${sha256Bytes(canonicalJson(candidate.artifact_pins))}`;
  candidate.component_gates = Object.fromEntries(Object.keys(candidate.component_gates).map((name) => [name, "PASS"]));
  candidate.runtime_boundary = {
    runtime_jsonl_loader_present: !postRemoval,
    stage_corpus_dependency_present: !postRemoval,
    jsonl_archives_retained: true,
    static_emergency_artifact_deployable: true,
  };
  candidate.production_eligibility = true;
  candidate.production_blockers = [];
  return { candidate: withCanonicalDigest(candidate, "candidate_digest_sha256"), register, registerBytes };
}

function receipt(context, {
  id,
  kind,
  subject,
  environment,
  decision = "PASS",
  evidence_sha256,
  candidate = context.candidate,
  at = context.clock.now(),
  validitySeconds = 60,
}) {
  context.receipt_counter += 1;
  const issuedAt = new Date(Date.parse(at) - 1000).toISOString();
  const maximum = context.policy.receipt_max_validity_seconds[kind];
  const expiresAt = new Date(Date.parse(issuedAt) + Math.min(validitySeconds, maximum) * 1000).toISOString();
  return buildEvidenceReceipt({
    receipt_id: `production-test:${id}:${context.receipt_counter}`,
    receipt_kind: kind,
    subject_id: subject,
    candidate_digest_sha256: candidate.candidate_digest_sha256,
    environment,
    issued_at: issuedAt,
    expires_at: expiresAt,
    nonce: `production-test-nonce:${id}:${context.receipt_counter}`,
    decision,
    evidence_sha256,
    authority: context.receipt_authority,
  });
}

export function createProductionContext(options = {}) {
  const built = buildProductionCandidate(options);
  const authority = createProductionTestAuthority();
  const clock = createManualClock("2026-08-30T00:00:00.000Z", "production");
  return {
    ...built,
    context: {
      candidate: built.candidate,
      policy: loadPolicy(),
      authorization_register: built.register,
      authorization_register_bytes: built.registerBytes,
      authorization_receipts: {},
      production_gate_receipts: {},
      release_candidate_receipt: null,
      receipt_verifier: authority,
      receipt_authority: authority,
      clock,
      receipt_counter: 0,
    },
  };
}

export function refreshProductionReceipts(context, at, { gateEnvironment, gateNames = [], candidate = context.candidate } = {}) {
  context.clock.set(at);
  context.release_candidate_receipt = receipt(context, {
    id: `release:${candidate.candidate_id}`,
    kind: "release_candidate",
    subject: candidate.candidate_id,
    environment: "production",
    evidence_sha256: candidate.release_gate.receipt_sha256,
    candidate,
    at,
  });
  context.authorization_receipts = Object.fromEntries(AUTHORIZATION_IDS.map((authorizationId) => {
    const entry = context.authorization_register.entries.find((item) => item.id === authorizationId);
    return [authorizationId, receipt(context, {
      id: `authorization:${authorizationId}`,
      kind: "authorization",
      subject: authorizationId,
      environment: context.policy.authorization_environments[authorizationId],
      decision: "authorized",
      evidence_sha256: digest(entry),
      at,
    })];
  }));
  context.production_gate_receipts = Object.fromEntries(gateNames.map((gate) => [gate, receipt(context, {
    id: `gate:${gate}`,
    kind: "production_gate",
    subject: gate,
    environment: gateEnvironment,
    evidence_sha256: digest({ gate, candidate_digest_sha256: context.candidate.candidate_digest_sha256, at }),
    at,
  })]));
  return context;
}

export function buildReceipt(context, fields) {
  return receipt(context, fields);
}

export function productionEvent(type, at, id, extra = {}) {
  return { type, event_id: `production-test:${type}:${id}`, occurred_at: at, simulated: false, ...extra };
}

export function advanceInstant(at, milliseconds = 1000) {
  return new Date(Date.parse(at) + milliseconds).toISOString();
}
