import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import {
  ImmutableSchemaCatalog,
  createContextScopedSchemaFieldId,
  createVariableContext,
  createVariableIdentity,
  createVariableMapping,
  retainNameDiscrepancySummary,
  schemaFieldIdForContext,
  variableIdForContext,
} from "../../packages/identity/src/index.mjs";

const digest = "a".repeat(64);
const evidence = ["evidence:variable-identity:test"];
const context = {
  source_id: "urn:ushso:source:test",
  asset_id: "urn:ushso:asset:test",
  release_id: "urn:ushso:release:test",
  distribution_id: "urn:ushso:distribution:test",
  schema_snapshot_id: "urn:ushso:schema:test",
  schema_field_id: "urn:ushso:field:test",
  field_revision_id: "urn:ushso:revision:test",
};
const provenance = {
  source_locator: "https://example.test/variables.json",
  pointer: "/variables/ZIP",
  capture_sha256: digest,
  raw_value_sha256: "b".repeat(64),
  transformation: { name: "test_variable_identity", version: "1.0.0" },
  evidence_ids: evidence,
};

function identity(overrides = {}) {
  return createVariableIdentity({
    context_binding: context,
    wire_name: "ZIP",
    publisher_label: "Postal code",
    publisher_concept: "A postal identifier",
    definition: "The publisher-described postal code.",
    source_type: { state: "documented", value: "string", evidence_ids: evidence },
    observed_type: { state: "unknown", value: null, evidence_ids: [] },
    semantic_role: "identifier",
    unit: { state: "not_applicable", value: null, rationale: "Identifiers have no measurement unit.", evidence_ids: evidence },
    code_values: { state: "documented", values: [{ code: "00123", label: "Éxample" }, { code: "—", label: "Suppressed" }], evidence_ids: evidence },
    missingness: { state: "documented", values: [{ code: "-1", label: "Not in universe" }], evidence_ids: evidence },
    mapping: { state: "exact", documented_name: "ZIP", wire_name: "ZIP", candidate_wire_names: [], evidence_ids: [] },
    provenance,
    ...overrides,
  });
}

test("wire names are scoped by release, distribution, schema and field revision", () => {
  const first = variableIdForContext(context, "ZIP");
  const second = variableIdForContext({ ...context, distribution_id: "urn:ushso:distribution:other" }, "ZIP");
  const third = variableIdForContext({ ...context, schema_snapshot_id: "urn:ushso:schema:other" }, "ZIP");
  assert.match(first, /^urn:ushso:variable:[a-f0-9]{32}$/);
  assert.notEqual(first, second);
  assert.notEqual(first, third);
  assert.equal(schemaFieldIdForContext(context, "ZIP"), createContextScopedSchemaFieldId(context, "ZIP"));
  assert.throws(() => variableIdForContext({ ...context, release_id: null }, "ZIP"), { code: "incomplete_variable_context" });
});

test("unresolved or non-exact contexts cannot mint a variable identifier", () => {
  const unresolved = createVariableContext({ state: "unresolved", binding_state: "ambiguous", reason: "two publisher releases remain possible" });
  const value = identity({ context_binding: unresolved });
  assert.equal(value.variable_id, null);
  assert.equal(value.context_binding.reason, "two publisher releases remain possible");
  assert.equal(value.evidence_state, "candidate");
  assert.throws(() => createVariableContext({ ...context, state: "resolved", binding_state: "ambiguous" }), { code: "unresolved_variable_context" });
});

test("identifier applicability and measurement unit absence remain distinct", () => {
  const identifier = identity();
  assert.equal(identifier.unit.state, "not_applicable");
  assert.equal(identifier.unit.value, null);
  const measurement = identity({
    wire_name: "AMOUNT",
    publisher_label: "Amount",
    semantic_role: "measure",
    unit: { state: "missing", value: null, rationale: "The retained dictionary did not document a unit.", evidence_ids: evidence },
    mapping: { state: "exact", documented_name: "AMOUNT", wire_name: "AMOUNT", candidate_wire_names: [], evidence_ids: [] },
  });
  assert.equal(measurement.unit.state, "missing");
  assert.equal(measurement.completeness, "incomplete");
});

test("mapping states preserve literal alternatives and refuse punctuation-only aliasing", () => {
  assert.deepEqual(createVariableMapping({
    state: "reviewed_alias",
    documented_name: "Wage – Related Costs",
    wire_name: "Wage-Related Costs",
    candidate_wire_names: ["Wage-Related Costs"],
    evidence_ids: evidence,
  }).state, "reviewed_alias");
  const ambiguous = createVariableMapping({
    state: "ambiguous",
    documented_name: "FTE – Employees on Payroll",
    wire_name: null,
    candidate_wire_names: ["FTE - Employees on Payroll"],
    evidence_ids: evidence,
  });
  assert.equal(ambiguous.wire_name, null);
  assert.throws(() => createVariableMapping({
    state: "reviewed_alias",
    documented_name: "A",
    wire_name: "A",
    candidate_wire_names: [],
    evidence_ids: evidence,
  }), { code: "mapping_alias_name_mismatch" });
});

test("strict v1.2 schema accepts literal encodings and rejects unauthorized promotion", async () => {
  const schema = JSON.parse(await readFile(new URL("../../contracts/machine-toolkit/v1.2.0/schemas/variable-identity.schema.json", import.meta.url)));
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictSchema: true, strictTypes: true });
  const validate = ajv.compile(schema);
  const value = identity();
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...value, publication_authorized: true }), false);
  const unresolved = identity({
    context_binding: { state: "unresolved", binding_state: "unresolved", source_id: null, asset_id: null, release_id: null, distribution_id: null, schema_snapshot_id: null, schema_field_id: null, field_revision_id: null, reason: "release binding unavailable" },
    wire_name: null,
    mapping: { state: "unmatched", documented_name: "Dictionary-only name", wire_name: null, candidate_wire_names: [], evidence_ids: [] },
  });
  assert.equal(validate(unresolved), true, JSON.stringify(validate.errors));
  assert.equal(unresolved.variable_id, null);
});

test("catalog context helper does not weaken exact endpoint invariants", () => {
  const catalog = new ImmutableSchemaCatalog();
  const snapshot = {
    entity_type: "SchemaSnapshot",
    schema_snapshot_id: "urn:ushso:schema:catalog",
    release_id: "urn:ushso:release:catalog",
    distribution_id: "urn:ushso:distribution:catalog",
    field_ids: ["urn:ushso:field:catalog"],
    immutable: true,
  };
  const field = {
    entity_type: "SchemaField",
    entity_id: "urn:ushso:field:catalog",
    schema_field_id: "urn:ushso:field:catalog",
    schema_snapshot_id: snapshot.schema_snapshot_id,
    revision_id: "urn:ushso:revision:catalog",
    ordinal: 0,
  };
  catalog.registerSnapshot(snapshot, [field]);
  assert.throws(() => catalog.resolveVariableContext({ ...context, schema_snapshot_id: snapshot.schema_snapshot_id, release_id: snapshot.release_id, distribution_id: snapshot.distribution_id, schema_field_id: field.schema_field_id, field_revision_id: "urn:ushso:revision:foreign" }), { code: "endpoint_field_revision_mismatch" });
});

test("retained audit summary remains a discrepancy set, never an alias approval", () => {
  const summary = retainNameDiscrepancySummary({
    record_id: "urn:ushso:asset:hcris",
    sample: "HCRIS117/117",
    sample_fields: 117,
    dictionary_fields: 117,
    mismatch_count: 1,
    in_payload_not_dictionary: ["FTE - Employees on Payroll"],
    in_dictionary_not_payload: ["FTE – Employees on Payroll"],
    limitation: "The retained summary is not a complete inventory or payload qualification.",
  });
  assert.equal(summary.source_acceptance, "unresolved");
  assert.equal(summary.mappings[0].state, "ambiguous");
  assert.equal(summary.mappings[0].wire_name, null);
  assert.deepEqual(summary.payload_names, ["FTE - Employees on Payroll"]);
});
