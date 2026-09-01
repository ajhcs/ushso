import { buildCandidateSnapshot } from "../src/candidate-snapshot.mjs";
import { canonicalJson, sha256Bytes, withCanonicalDigest } from "../src/common.mjs";
import { createManualClock, loadAuthorizationRegister, loadPolicy } from "../src/rehearsal.mjs";
import {
  AUTHORIZATION_IDS,
  createProductionTestAuthority,
  digest,
} from "../../v1.0.0/tests/helpers.mjs";

export * from "../../v1.0.0/tests/helpers.mjs";

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
  candidate.artifact_pins.find((pin) => pin.role === "authorization_register").sha256 = registerSha256;
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
