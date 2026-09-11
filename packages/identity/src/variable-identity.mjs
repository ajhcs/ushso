import { assert, deepFreeze, sha256, uniqueSorted } from "./common.mjs";
import { createContextScopedSchemaFieldId } from "./schema-catalog.mjs";

export const VARIABLE_IDENTITY_VERSION = "ushso.variable-identity.v1.2.0";
export const VARIABLE_TRANSFORMATION_VERSION = "1.0.0";
export const VARIABLE_TRANSFORMATIONS = Object.freeze({
  cdc: "cdc_variable_identity",
  census: "census_variable_identity",
  cms: "cms_variable_identity",
});
export const VARIABLE_MAPPING_STATES = Object.freeze(["exact", "reviewed_alias", "ambiguous", "unmatched"]);
export const VARIABLE_CONTEXT_STATES = Object.freeze(["resolved", "unresolved"]);
export const VARIABLE_BINDING_STATES = Object.freeze(["exact", "one_to_many", "rolling", "replaced", "ambiguous", "unresolved", "conflicted"]);
export const VARIABLE_SEMANTIC_ROLES = Object.freeze([
  "identifier",
  "dimension",
  "measure",
  "measure_description",
  "date",
  "geography",
  "suppression_flag",
  "metadata",
  "unknown",
]);
export const VARIABLE_UNIT_STATES = Object.freeze(["documented", "not_applicable", "missing", "unknown"]);
export const VARIABLE_ASSERTION_STATES = Object.freeze(["documented", "observed", "unknown", "unavailable"]);
export const VARIABLE_CODE_STATES = Object.freeze(["documented", "not_documented", "unknown"]);

const CONTEXT_IDS = Object.freeze([
  "source_id",
  "asset_id",
  "release_id",
  "distribution_id",
  "schema_snapshot_id",
]);
const OPTIONAL_CONTEXT_IDS = Object.freeze(["schema_field_id", "field_revision_id"]);
const HEX = /^[a-f0-9]{64}$/u;
const POINTER = /^(?:|\/)/u;

function record(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`, "invalid_variable_identity");
  return value;
}

function boundedText(value, label, { nullable = false, max = 2000, allowEmpty = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  assert(typeof value === "string" && (allowEmpty || value.length > 0) && value.length <= max, `${label} must be a bounded string`, "invalid_variable_identity");
  return value;
}

function nullableText(value, label, max = 2000) {
  return boundedText(value, label, { nullable: true, max });
}

function id(value, label, nullable = true) {
  if (nullable && (value === null || value === undefined)) return null;
  assert(typeof value === "string" && value.length >= 3 && value.length <= 200, `${label} must be an identifier`, "invalid_variable_context");
  return value;
}

function evidenceIds(value, label = "evidence_ids", { required = false } = {}) {
  const ids = value ?? [];
  assert(Array.isArray(ids) && ids.every((item) => typeof item === "string" && item.length >= 3 && item.length <= 200), `${label} must contain identifiers`, "missing_variable_evidence");
  const sorted = uniqueSorted(ids);
  if (required) assert(sorted.length > 0, `${label} is required`, "missing_variable_evidence");
  return sorted;
}

function distinct(values, label) {
  assert(Array.isArray(values), `${label} must be an array`, "invalid_variable_identity");
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const item = boundedText(value, `${label}[]`);
    assert(!seen.has(item), `${label} must be unique`, "duplicate_variable_value");
    seen.add(item);
    output.push(item);
  }
  return output;
}

function hashValue(value) {
  return sha256(JSON.stringify(value));
}

function contextComplete(context) {
  return CONTEXT_IDS.every((key) => typeof context[key] === "string" && context[key].length >= 3);
}

export function createVariableContext(input = {}) {
  record(input, "context_binding");
  const inferredState = input.state ?? (contextComplete(input) ? "resolved" : "unresolved");
  const bindingState = input.binding_state ?? (inferredState === "resolved" ? "exact" : "unresolved");
  assert(VARIABLE_BINDING_STATES.includes(bindingState), `Unknown variable binding state: ${bindingState}`, "invalid_variable_context");
  const context = {
    state: inferredState,
    binding_state: bindingState,
    source_id: id(input.source_id, "source_id"),
    asset_id: id(input.asset_id, "asset_id"),
    release_id: id(input.release_id, "release_id"),
    distribution_id: id(input.distribution_id, "distribution_id"),
    schema_snapshot_id: id(input.schema_snapshot_id, "schema_snapshot_id"),
    schema_field_id: id(input.schema_field_id, "schema_field_id"),
    field_revision_id: id(input.field_revision_id, "field_revision_id"),
    reason: nullableText(input.reason ?? (inferredState === "unresolved" ? "source release and schema binding unresolved" : null), "context_binding.reason", 2000),
  };
  assert(VARIABLE_CONTEXT_STATES.includes(context.state), `Unknown variable context state: ${context.state}`, "invalid_variable_context");
  if (context.state === "resolved") {
    assert(bindingState === "exact", "Resolved variable context requires an exact binding", "unresolved_variable_context");
    assert(contextComplete(context), "Resolved variable context requires source, asset, release, distribution and schema IDs", "incomplete_variable_context");
    assert(context.reason === null, "Resolved variable context cannot carry an unresolved reason", "invalid_variable_context");
  } else {
    assert(context.reason !== null, "Unresolved variable context requires a reason", "invalid_variable_context");
  }
  return context;
}

export function variableIdForContext(context, wireName) {
  const bound = createVariableContext({ ...context, state: "resolved", binding_state: "exact" });
  const wire = boundedText(wireName, "wire_name");
  return `urn:ushso:variable:${sha256({
    source_id: bound.source_id,
    asset_id: bound.asset_id,
    release_id: bound.release_id,
    distribution_id: bound.distribution_id,
    schema_snapshot_id: bound.schema_snapshot_id,
    schema_field_id: bound.schema_field_id,
    field_revision_id: bound.field_revision_id,
    wire_name: wire,
  }).slice(0, 32)}`;
}

export function schemaFieldIdForContext(context, wireName) {
  const bound = createVariableContext({ ...context, state: "resolved", binding_state: "exact" });
  return createContextScopedSchemaFieldId(bound, wireName);
}

function normalizeAssertion(input, label, states, defaultState = "unknown") {
  if (input === null || input === undefined) return { state: defaultState, value: null, evidence_ids: [] };
  if (typeof input === "string") input = { state: input.length ? "documented" : defaultState, value: input || null, evidence_ids: [] };
  record(input, label);
  const state = input.state ?? defaultState;
  assert(states.includes(state), `Unknown ${label} state: ${state}`, "invalid_variable_assertion");
  const value = nullableText(input.value, `${label}.value`);
  const ids = evidenceIds(input.evidence_ids, `${label}.evidence_ids`, { required: ["documented", "observed"].includes(state) });
  assert((state === "documented" || state === "observed") ? value !== null : value === null || typeof value === "string", `${label} state/value mismatch`, "invalid_variable_assertion");
  return { state, value, evidence_ids: ids };
}

function normalizeUnit(input, semanticRole) {
  if (typeof input === "string") input = { state: "documented", value: input };
  if (input === null || input === undefined) input = { state: "unknown", value: null };
  record(input, "unit");
  const state = input.state ?? "unknown";
  assert(VARIABLE_UNIT_STATES.includes(state), `Unknown unit state: ${state}`, "invalid_variable_unit");
  const value = nullableText(input.value, "unit.value");
  const rationale = nullableText(input.rationale, "unit.rationale");
  const ids = evidenceIds(input.evidence_ids, "unit.evidence_ids", { required: state === "documented" || state === "not_applicable" });
  if (state === "documented") assert(value !== null, "Documented units require a value", "invalid_variable_unit");
  if (state === "not_applicable") {
    assert(semanticRole === "identifier", "Only identifier variables may use a not-applicable unit", "unit_not_applicable_requires_identifier");
    assert(value === null && rationale !== null, "Not-applicable units require a reason and no value", "invalid_variable_unit");
  }
  if (state === "missing" || state === "unknown") assert(value === null, `${state} units cannot carry a unit value`, "invalid_variable_unit");
  return { state, value, rationale, evidence_ids: ids };
}

function normalizeLiteralValues(input, label) {
  const raw = input ?? [];
  if (Array.isArray(raw)) {
    return raw.map((entry) => {
      if (typeof entry === "string") return { code: entry, label: null };
      record(entry, `${label}[]`);
      return { code: boundedText(entry.code, `${label}[].code`), label: nullableText(entry.label, `${label}[].label`) };
    });
  }
  record(raw, label);
  return Object.entries(raw).map(([code, labelValue]) => {
    let labelText = null;
    if (typeof labelValue === "string") labelText = labelValue;
    else if (labelValue !== null && typeof labelValue === "object" && !Array.isArray(labelValue)) labelText = nullableText(labelValue.label, `${label}.label`);
    else throw Error("invalid_literal_encoding");
    return { code: boundedText(code, `${label}.code`), label: labelText };
  });
}

function normalizeCodeSet(input, label, defaultState = "unknown") {
  if (input === null || input === undefined) return { state: defaultState, values: [], evidence_ids: [] };
  if (Array.isArray(input) || (input && typeof input === "object" && !Object.hasOwn(input, "state") && !Object.hasOwn(input, "values"))) {
    input = { state: "documented", values: input };
  }
  record(input, label);
  const state = input.state ?? defaultState;
  assert(VARIABLE_CODE_STATES.includes(state), `Unknown ${label} state: ${state}`, "invalid_variable_codebook");
  const values = normalizeLiteralValues(input.values ?? [], `${label}.values`);
  const seen = new Set();
  for (const entry of values) {
    assert(!seen.has(entry.code), `${label} codes must be unique`, "duplicate_variable_code");
    seen.add(entry.code);
  }
  const ids = evidenceIds(input.evidence_ids, `${label}.evidence_ids`, { required: state === "documented" });
  if (state === "documented") assert(values.length > 0, `Documented ${label} requires literal values`, "invalid_variable_codebook");
  if (state !== "documented") assert(values.length === 0, `${label} values require documented state`, "invalid_variable_codebook");
  return { state, values, evidence_ids: ids };
}

export function createVariableMapping(input = {}) {
  record(input, "mapping");
  const state = input.state;
  assert(VARIABLE_MAPPING_STATES.includes(state), `Unknown variable mapping state: ${state}`, "invalid_variable_mapping");
  const documentedName = nullableText(input.documented_name, "mapping.documented_name");
  const wire = nullableText(input.wire_name, "mapping.wire_name");
  const candidates = distinct(input.candidate_wire_names ?? [], "mapping.candidate_wire_names");
  const ids = evidenceIds(input.evidence_ids, "mapping.evidence_ids", { required: state === "reviewed_alias" || state === "ambiguous" });
  if (state === "exact") {
    assert(documentedName !== null && wire !== null && documentedName === wire, "Exact mappings require identical literal names", "mapping_exact_name_mismatch");
    assert(candidates.length === 0 || (candidates.length === 1 && candidates[0] === wire), "Exact mappings cannot carry alternate candidates", "invalid_variable_mapping");
  }
  if (state === "reviewed_alias") {
    assert(documentedName !== null && wire !== null && documentedName !== wire, "Reviewed aliases require distinct literal names", "mapping_alias_name_mismatch");
    assert(candidates.length === 0 || (candidates.length === 1 && candidates[0] === wire), "Reviewed aliases cannot carry unrelated candidates", "invalid_variable_mapping");
  }
  if (state === "ambiguous") {
    assert(documentedName !== null && wire === null && candidates.length > 0, "Ambiguous mappings require candidates and no selected wire name", "invalid_variable_mapping");
  }
  if (state === "unmatched") {
    assert(documentedName !== null && wire === null && candidates.length === 0, "Unmatched mappings retain a documented name without a selected wire name", "invalid_variable_mapping");
  }
  return { state, documented_name: documentedName, wire_name: wire, candidate_wire_names: candidates, evidence_ids: ids };
}

function normalizeProvenance(input, defaultEvidenceIds = []) {
  record(input, "provenance");
  const sourceLocator = boundedText(input.source_locator, "provenance.source_locator", { max: 2048 });
  const pointer = boundedText(input.pointer ?? "", "provenance.pointer", { max: 2048, allowEmpty: true });
  assert(POINTER.test(pointer), "Provenance pointer must be a JSON pointer", "invalid_variable_provenance");
  const capture = boundedText(input.capture_sha256, "provenance.capture_sha256", { max: 64 });
  const raw = boundedText(input.raw_value_sha256, "provenance.raw_value_sha256", { max: 64 });
  assert(HEX.test(capture) && HEX.test(raw), "Provenance hashes must be SHA-256 hex", "invalid_variable_provenance");
  record(input.transformation, "provenance.transformation");
  const transformation = {
    name: boundedText(input.transformation.name, "provenance.transformation.name", { max: 128 }),
    version: boundedText(input.transformation.version, "provenance.transformation.version", { max: 32 }),
  };
  const ids = evidenceIds(input.evidence_ids ?? defaultEvidenceIds, "provenance.evidence_ids", { required: true });
  return { source_locator: sourceLocator, pointer, capture_sha256: capture, raw_value_sha256: raw, transformation, evidence_ids: ids };
}

function completenessFor({ context, semanticRole, unit, mapping, sourceType, observedType }) {
  const measurement = semanticRole === "measure" || semanticRole === "measure_description";
  if (measurement && unit.state === "missing") return "incomplete";
  if (context.state !== "resolved" || ["ambiguous", "unmatched"].includes(mapping.state)) return "unknown";
  if (sourceType.state === "unknown" || observedType.state === "unknown") return "unknown";
  return "complete";
}

export function createVariableIdentity(input = {}) {
  record(input, "variable_identity");
  const context = createVariableContext(input.context_binding ?? input.context ?? {});
  const semanticRole = input.semantic_role ?? "unknown";
  assert(VARIABLE_SEMANTIC_ROLES.includes(semanticRole), `Unknown semantic role: ${semanticRole}`, "invalid_variable_semantic_role");
  const sourceType = normalizeAssertion(input.source_type, "source_type", ["documented", "unknown", "unavailable"]);
  const observedType = normalizeAssertion(input.observed_type, "observed_type", ["observed", "unknown", "unavailable"]);
  const unit = normalizeUnit(input.unit, semanticRole);
  const codeValues = normalizeCodeSet(input.code_values, "code_values", "unknown");
  const missingness = normalizeCodeSet(input.missingness, "missingness", "unknown");
  const suppliedWireName = nullableText(input.wire_name, "wire_name");
  const mapping = createVariableMapping(input.mapping ?? {
    state: suppliedWireName === null ? "unmatched" : "exact",
    documented_name: nullableText(input.documented_name ?? suppliedWireName, "documented_name"),
    wire_name: suppliedWireName,
    candidate_wire_names: [],
  });
  if (["exact", "reviewed_alias"].includes(mapping.state)) {
    assert(suppliedWireName !== null && mapping.wire_name === suppliedWireName, "Selected mapping wire name must equal variable wire name", "variable_mapping_wire_mismatch");
  } else {
    assert(suppliedWireName === null, "Ambiguous or unmatched mappings cannot select a wire name", "variable_mapping_wire_mismatch");
  }
  const defaultEvidence = uniqueSorted([
    ...(sourceType.evidence_ids ?? []),
    ...(observedType.evidence_ids ?? []),
    ...(unit.evidence_ids ?? []),
    ...(codeValues.evidence_ids ?? []),
    ...(missingness.evidence_ids ?? []),
    ...(mapping.evidence_ids ?? []),
  ]);
  const provenance = normalizeProvenance(input.provenance, defaultEvidence);
  const allEvidence = evidenceIds([...(input.evidence_ids ?? []), ...defaultEvidence, ...provenance.evidence_ids], "evidence_ids", { required: true });
  const variableId = context.state === "resolved" && suppliedWireName !== null && ["exact", "reviewed_alias"].includes(mapping.state)
    ? variableIdForContext(context, suppliedWireName)
    : null;
  const completeness = completenessFor({ context, semanticRole, unit, mapping, sourceType, observedType });
  const limitations = Array.isArray(input.limitations) ? input.limitations.map((item) => boundedText(item, "limitations[]", { max: 4000 })) : [];
  const output = {
    schema_version: VARIABLE_IDENTITY_VERSION,
    variable_id: variableId,
    context_binding: context,
    wire_name: suppliedWireName,
    publisher_label: nullableText(input.publisher_label, "publisher_label"),
    publisher_concept: nullableText(input.publisher_concept, "publisher_concept"),
    definition: nullableText(input.definition, "definition"),
    source_type: sourceType,
    observed_type: observedType,
    semantic_role: semanticRole,
    unit,
    code_values: codeValues,
    missingness,
    mapping,
    provenance,
    evidence_ids: allEvidence,
    evidence_state: input.evidence_state ?? (context.state === "resolved" && !["ambiguous", "unmatched"].includes(mapping.state) ? "documented" : mapping.state === "ambiguous" ? "ambiguous" : "candidate"),
    completeness,
    limitations,
    publication_authorized: false,
    promotion_eligible: false,
  };
  assert(["unknown", "candidate", "ambiguous", "documented", "observed"].includes(output.evidence_state), "Unknown variable evidence state", "invalid_variable_evidence_state");
  return deepFreeze(output);
}

export function createVariableProvenance({ capture, pointer, raw, transformation, evidence_ids = [] } = {}) {
  record(capture, "capture");
  const ids = evidenceIds(evidence_ids, "evidence_ids", { required: true });
  return normalizeProvenance({
    source_locator: boundedText(capture.url, "capture.url", { max: 2048 }),
    pointer,
    capture_sha256: capture.sha256,
    raw_value_sha256: hashValue(raw),
    transformation,
    evidence_ids: ids,
  }, ids);
}

export function retainNameDiscrepancySummary(input) {
  record(input, "discrepancy_summary");
  assert(Number.isSafeInteger(input.sample_fields) && input.sample_fields >= 0, "sample_fields must be a count", "invalid_discrepancy_summary");
  assert(Number.isSafeInteger(input.dictionary_fields) && input.dictionary_fields >= 0, "dictionary_fields must be a count", "invalid_discrepancy_summary");
  const payload = distinct(input.in_payload_not_dictionary ?? [], "in_payload_not_dictionary");
  const dictionary = distinct(input.in_dictionary_not_payload ?? [], "in_dictionary_not_payload");
  assert(payload.length === dictionary.length, "Discrepancy sides must have equal literal counts", "invalid_discrepancy_summary");
  assert(Number.isSafeInteger(input.mismatch_count) && input.mismatch_count >= 0, "mismatch_count must be a count", "invalid_discrepancy_summary");
  assert(payload.length === input.mismatch_count, "Mismatch count must equal supplied literal pairs", "invalid_discrepancy_summary");
  return deepFreeze({
    scope: "single_response_field_name_comparison",
    record_id: nullableText(input.record_id, "record_id", 256),
    sample: boundedText(input.sample, "sample", { max: 256 }),
    sample_fields: input.sample_fields,
    dictionary_fields: input.dictionary_fields,
    mismatch_count: input.mismatch_count,
    payload_names: payload,
    dictionary_names: dictionary,
    mappings: payload.map((wireName, index) => createVariableMapping({
      state: "ambiguous",
      documented_name: dictionary[index],
      wire_name: null,
      candidate_wire_names: [wireName],
      evidence_ids: ["evidence:retained-discrepancy-summary"],
    })),
    limitation: boundedText(input.limitation, "limitation", { max: 2000 }),
    source_acceptance: "unresolved",
  });
}
