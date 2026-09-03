import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateSnapshot } from "../src/candidate-snapshot.mjs";
import { buildEvidenceReceipt, createFixtureReceiptAuthority } from "../src/evidence-receipts.mjs";
import { compileSchemaRegistry, validateSchema } from "../src/schema-validation.mjs";
import { MODES, makeInitialState } from "../src/release-state-machine.mjs";
import { buildRollbackBundle, loadPolicy } from "../src/rehearsal.mjs";
import { digest } from "./helpers.mjs";

function validInstances() {
  const candidate = buildCandidateSnapshot();
  const policy = loadPolicy();
  const authority = createFixtureReceiptAuthority();
  const at = "2026-08-30T00:00:00.000Z";
  return {
    "candidate-envelope.schema.json": candidate,
    "cutover-state.schema.json": makeInitialState({ mode: MODES.FIXTURE, candidate, policy }),
    "evidence-receipt.schema.json": buildEvidenceReceipt({
      receipt_id: "fixture-receipt:schema-validation",
      receipt_kind: "production_gate",
      subject_id: "schema-validation",
      candidate_digest_sha256: candidate.candidate_digest_sha256,
      environment: "local_fixture_only",
      issued_at: at,
      expires_at: "2026-08-30T00:01:00.000Z",
      nonce: "fixture-nonce:schema-validation",
      decision: "PASS",
      evidence_sha256: digest({ schema: "valid" }),
      authority,
    }),
    "rollback-bundle.schema.json": buildRollbackBundle(candidate),
  };
}

test("every checked-in schema compiles strictly as Draft 2020-12 and validates its canonical instance", () => {
  const registry = compileSchemaRegistry();
  assert.deepEqual(registry.files, [
    "candidate-envelope.schema.json",
    "cutover-state.schema.json",
    "evidence-receipt.schema.json",
    "rollback-bundle.schema.json",
  ]);
  for (const { file, schema } of registry.records) {
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema", file);
    assert.ok(schema.$id.startsWith("https://ushso.org/contracts/wp14/"), file);
  }
  for (const [file, instance] of Object.entries(validInstances())) assert.deepEqual(validateSchema(file, instance), { ok: true, errors: [] }, file);
});

test("each schema rejects missing required data, nested additions, wrong types, and malformed timestamps", () => {
  const instances = validInstances();
  const invalid = [
    ["candidate-envelope.schema.json", (value) => { delete value.git.note; }],
    ["candidate-envelope.schema.json", (value) => { value.git.untrusted = true; }],
    ["cutover-state.schema.json", (value) => { value.worker_traffic_percent.candidate = "0"; }],
    ["cutover-state.schema.json", (value) => { value.history = {}; }],
    ["evidence-receipt.schema.json", (value) => { delete value.proof.signature; }],
    ["evidence-receipt.schema.json", (value) => { value.issued_at = "2026-08-30T00:00:00Z"; }],
    ["rollback-bundle.schema.json", (value) => { value.resources.pop(); }],
    ["rollback-bundle.schema.json", (value) => { value.support_window_days = "45"; }],
    ["rollback-bundle.schema.json", (value) => { value.resources[0].untrusted = true; }],
  ];
  for (const [file, mutate] of invalid) {
    const value = structuredClone(instances[file]);
    mutate(value);
    const result = validateSchema(file, value);
    assert.equal(result.ok, false, `${file}:${JSON.stringify(value)}`);
    assert.ok(result.errors.length > 0, file);
  }
});

test("schema validation never coerces a malformed instance", () => {
  const bundle = structuredClone(validInstances()["rollback-bundle.schema.json"]);
  bundle.support_window_days = "45";
  const before = JSON.stringify(bundle);
  assert.equal(validateSchema("rollback-bundle.schema.json", bundle).ok, false);
  assert.equal(JSON.stringify(bundle), before);
});
