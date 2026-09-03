import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const verificationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(verificationRoot, "../../..");

test("every implemented WP7 requirement maps to existing implementation, tests, and receipt", async () => {
  const ledger = JSON.parse(await fs.readFile(path.join(verificationRoot, "evidence-ledger.json"), "utf8"));
  assert.equal(new Set(ledger.requirements.map((item) => item.requirement_id)).size, ledger.requirements.length);
  for (const requirement of ledger.requirements) {
    for (const implementation of requirement.implementation) await fs.access(path.join(repositoryRoot, implementation));
    for (const testPath of requirement.tests) await fs.access(path.join(repositoryRoot, testPath));
    if (requirement.status.startsWith("implemented_")) {
      assert(requirement.receipt, `${requirement.requirement_id} is missing a receipt`);
      await fs.access(path.join(verificationRoot, requirement.receipt));
    }
  }
  assert.equal(ledger.requirements.find((item) => item.requirement_id === "WP7-DB-0008-0009").status, "pending_dependency_clearance");
});

test("receipts do not fabricate human review or enable an identity rule", async () => {
  const benchmark = JSON.parse(await fs.readFile(path.join(verificationRoot, "receipts/identity-benchmark.json"), "utf8"));
  const reversal = JSON.parse(await fs.readFile(path.join(verificationRoot, "receipts/identity-adjudication-reversal.json"), "utf8"));
  const aggregate = JSON.parse(await fs.readFile(path.join(verificationRoot, "receipts/wp7-verification.json"), "utf8"));
  const packetBytes = await fs.readFile(path.join(repositoryRoot, "evaluation/identity/v1.0.0/adjudication/reviewer-packet.json"));
  const packet = JSON.parse(packetBytes);
  const authorizationRegister = JSON.parse(await fs.readFile(path.join(repositoryRoot, "verification/external-authorization/v1.0.0/register.json"), "utf8"));
  const auth14 = authorizationRegister.entries.find((entry) => entry.id === "AUTH-14");
  assert.equal(benchmark.external_adjudication.double_reviewed_cases, 0);
  assert.equal(benchmark.external_adjudication.percent_agreement, null);
  assert.equal(benchmark.external_adjudication.cohens_kappa, null);
  assert.equal(benchmark.production_rule_state, "disabled_candidate_only");
  assert.equal(benchmark.production_enablement_receipt_id, null);
  assert.equal(benchmark.automatic_rule_enablement_required_for_candidate_only_release, false);
  assert.equal(benchmark.external_adjudication.authorization_reference, "AUTH-14");
  assert.equal(benchmark.external_adjudication.authorization_status, "not_requested");
  assert.equal(benchmark.external_adjudication.authorized, false);
  assert.equal(benchmark.external_adjudication.completed_adjudication_receipt_present, false);
  assert.equal(benchmark.reviewer_packet.packet_byte_sha256, createHash("sha256").update(packetBytes).digest("hex"));
  assert.equal(benchmark.reviewer_packet.completed_receipt_present, false);
  assert.equal(packet.status, "prepared_not_authorized_for_review");
  assert.equal(packet.authorization_boundary.permission_granted, false);
  assert.equal(auth14.status, "not_requested");
  assert.equal(auth14.authorized, false);
  assert.equal(reversal.controlled_fixture.evidence_class, "controlled_fixture_not_adjudication_evidence");
  assert.equal(reversal.external_adjudication.agreement_floor_claimed, false);
  assert.equal(reversal.external_adjudication.authorization_reference, "AUTH-14");
  assert.equal(reversal.external_adjudication.authorization_status, "not_requested");
  assert.equal(reversal.external_adjudication.authorized, false);
  assert.equal(aggregate.external_gates.find((gate) => gate.gate_id === "identity-rule-enablement").status, "not_required_for_candidate_only_release");
  assert.equal(aggregate.external_gates.find((gate) => gate.gate_id === "identity-rule-enablement").blocking, false);
  assert.deepEqual(aggregate.external_gates.filter((gate) => gate.blocking).map((gate) => gate.gate_id).sort(), ["identity-human-double-review", "wp7-migrations-0008-0009"]);
});
