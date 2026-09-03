import { canonicalJson, clone, isSha256, sha256Json, verifyCanonicalDigest, withCanonicalDigest } from "./common.mjs";
import { validateSchema } from "./schema-validation.mjs";

export function receiptSigningMaterial(receipt) {
  const copy = clone(receipt);
  delete copy.receipt_sha256;
  if (copy.proof) delete copy.proof.signature;
  return canonicalJson(copy);
}

export function buildEvidenceReceipt({
  receipt_id,
  receipt_kind,
  subject_id,
  candidate_digest_sha256,
  environment,
  issued_at,
  expires_at,
  nonce,
  decision,
  evidence_sha256,
  authority,
}) {
  if (!authority || typeof authority.sign !== "function") throw new Error("RECEIPT_SIGNER_MISSING");
  const draft = {
    schema_version: "ushso-wp14-evidence-receipt.v1.0.0",
    receipt_id,
    receipt_kind,
    subject_id,
    candidate_digest_sha256,
    environment,
    issued_at,
    expires_at,
    nonce,
    decision,
    evidence_sha256,
    proof: {
      method: authority.method,
      key_id: authority.key_id,
      signature: `sha256:${"0".repeat(64)}`,
    },
  };
  draft.proof.signature = authority.sign(receiptSigningMaterial(draft));
  const receipt = withCanonicalDigest(draft, "receipt_sha256");
  const schema = validateSchema("evidence-receipt.schema.json", receipt);
  if (!schema.ok) throw new Error(`RECEIPT_SCHEMA_INVALID:${JSON.stringify(schema.errors)}`);
  return receipt;
}

export function createFixtureReceiptAuthority() {
  const key_id = "wp14-fixture-digest-authority";
  const sign = (material) => `sha256:${sha256Json({ domain: "wp14-fixture-only", key_id, material })}`;
  return {
    trust_class: "fixture_only",
    method: "fixture_digest_v1",
    key_id,
    sign,
    verify({ receipt, signing_material }) {
      const ok = receipt.proof.method === "fixture_digest_v1"
        && receipt.proof.key_id === key_id
        && receipt.proof.signature === sign(signing_material);
      return {
        ok,
        verifier_receipt_sha256: `sha256:${sha256Json({ verifier: key_id, receipt: receipt.receipt_sha256, ok })}`,
      };
    },
  };
}

function deny(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function parseTime(value, code, field) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    deny(code, `${field} must be an exact UTC instant`, { field, value });
  }
  return milliseconds;
}

export function verifyEvidenceReceipt(receipt, {
  candidate,
  context,
  expected_kind,
  expected_subject,
  expected_environment,
  expected_decision,
  expected_evidence_sha256,
  now,
}) {
  const schema = validateSchema("evidence-receipt.schema.json", receipt);
  if (!schema.ok) deny("EVIDENCE_RECEIPT_SCHEMA_INVALID", "evidence receipt is not schema-valid", schema);
  const digest = verifyCanonicalDigest(receipt, "receipt_sha256");
  if (!digest.ok) deny("EVIDENCE_RECEIPT_DIGEST_MISMATCH", "evidence receipt digest mismatch", digest);
  const failures = [];
  if (receipt.receipt_kind !== expected_kind) failures.push("kind");
  if (receipt.subject_id !== expected_subject) failures.push("subject");
  if (receipt.environment !== expected_environment) failures.push("environment");
  if (receipt.decision !== expected_decision) failures.push("decision");
  if (receipt.candidate_digest_sha256 !== candidate.candidate_digest_sha256) failures.push("candidate");
  if (expected_evidence_sha256 && receipt.evidence_sha256 !== expected_evidence_sha256) failures.push("evidence_digest");
  const nowMs = parseTime(now, "TRUSTED_CLOCK_INVALID", "now");
  const issuedMs = parseTime(receipt.issued_at, "EVIDENCE_RECEIPT_TIME_INVALID", "issued_at");
  const expiresMs = parseTime(receipt.expires_at, "EVIDENCE_RECEIPT_TIME_INVALID", "expires_at");
  if (issuedMs > nowMs) failures.push("not_yet_valid");
  if (expiresMs <= issuedMs) failures.push("non_positive_validity_window");
  if (nowMs > expiresMs) failures.push("expired");
  const maximumValiditySeconds = context.policy?.receipt_max_validity_seconds?.[receipt.receipt_kind];
  if (!Number.isInteger(maximumValiditySeconds) || maximumValiditySeconds <= 0) failures.push("validity_policy_missing");
  else if (expiresMs - issuedMs > maximumValiditySeconds * 1000) failures.push("validity_window_too_long");
  if (failures.length > 0) deny("EVIDENCE_RECEIPT_BINDING_INVALID", "evidence receipt is stale or not bound to this transition", { failures });

  const verifier = context.receipt_verifier;
  if (!verifier || typeof verifier.verify !== "function") {
    deny("RECEIPT_VERIFIER_MISSING", "an injected trusted receipt verifier is required");
  }
  if (candidate.candidate_class === "production_release_candidate" && verifier.trust_class !== "production") {
    deny("RECEIPT_VERIFIER_NOT_PRODUCTION_TRUSTED", "production transitions require a production-trusted verifier port");
  }
  const verification = verifier.verify({ receipt, signing_material: receiptSigningMaterial(receipt) });
  if (!verification || verification.ok !== true || !isSha256(verification.verifier_receipt_sha256)) {
    deny("EVIDENCE_RECEIPT_PROOF_INVALID", "trusted receipt verification failed", { verification });
  }
  return {
    receipt_sha256: receipt.receipt_sha256,
    nonce: receipt.nonce,
    verifier_receipt_sha256: verification.verifier_receipt_sha256,
  };
}
