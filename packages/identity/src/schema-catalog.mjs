import { assert, canonicalJson, clone, deepFreeze, sha256, uniqueSorted } from "./common.mjs";

function recordFingerprint(record) {
  return sha256(record);
}

const CONTEXT_SCOPE_KEYS = Object.freeze([
  "source_id",
  "asset_id",
  "release_id",
  "distribution_id",
  "schema_snapshot_id",
]);

function requireContextScope(context) {
  assert(context && typeof context === "object" && !Array.isArray(context), "Schema field context must be an object", "invalid_schema_field_context");
  for (const key of CONTEXT_SCOPE_KEYS) {
    assert(typeof context[key] === "string" && context[key].length >= 3, "Schema field context requires " + key, "incomplete_schema_field_context");
  }
  return context;
}

/**
 * Derive a field identifier from the complete source/release/schema scope and
 * the exact publisher wire name. This helper does not register a field or
 * relax any of the immutable catalog or endpoint checks below.
 */
export function createContextScopedSchemaFieldId(context, wireName) {
  const scoped = requireContextScope(context);
  assert(context.state === undefined || context.state === "resolved", "Unresolved variable context cannot mint a schema field identifier", "unresolved_variable_context");
  assert(context.binding_state === undefined || context.binding_state === "exact", "Non-exact variable context cannot mint a schema field identifier", "unresolved_variable_context");
  assert(typeof wireName === "string" && wireName.length > 0 && wireName.length <= 2048, "Schema field wire name must be a bounded string", "invalid_schema_field_name");
  return "urn:ushso:field:" + sha256({
    source_id: scoped.source_id,
    asset_id: scoped.asset_id,
    release_id: scoped.release_id,
    distribution_id: scoped.distribution_id,
    schema_snapshot_id: scoped.schema_snapshot_id,
    schema_field_id: scoped.schema_field_id ?? null,
    field_revision_id: scoped.field_revision_id ?? null,
    wire_name: wireName,
  }).slice(0, 32);
}

export class ImmutableSchemaCatalog {
  #snapshots = new Map();
  #fields = new Map();
  #fingerprints = new Map();

  registerSnapshot(snapshot, fields) {
    assert(snapshot.entity_type === "SchemaSnapshot", "Expected a SchemaSnapshot", "invalid_schema_snapshot");
    assert(snapshot.immutable === true, "Schema snapshots must be immutable", "mutable_schema_snapshot");
    assert(Array.isArray(fields) && fields.length > 0, "A schema snapshot requires fields", "missing_schema_fields");
    const fieldIds = uniqueSorted(fields.map((field) => field.schema_field_id));
    assert(fieldIds.length === fields.length, "Schema field IDs must be unique", "duplicate_schema_field");
    assert(new Set(fields.map((field) => field.ordinal)).size === fields.length, "Schema field ordinals must be unique within a snapshot", "duplicate_schema_ordinal");
    assert(canonicalJson(fieldIds) === canonicalJson(uniqueSorted(snapshot.field_ids)), "Snapshot field_ids must exactly match registered fields", "snapshot_field_mismatch");
    for (const field of fields) {
      assert(field.entity_type === "SchemaField", "Expected a SchemaField", "invalid_schema_field");
      assert(field.schema_snapshot_id === snapshot.schema_snapshot_id, "A field must reference its exact schema snapshot", "field_snapshot_mismatch");
      assert(field.entity_id === field.schema_field_id, "SchemaField entity_id and schema_field_id must agree", "field_identity_mismatch");
    }
    this.#registerImmutable("snapshot", snapshot.schema_snapshot_id, snapshot, this.#snapshots);
    for (const field of fields) this.#registerImmutable("field", field.schema_field_id, field, this.#fields);
    return this.getSnapshot(snapshot.schema_snapshot_id);
  }

  #registerImmutable(kind, id, value, store) {
    const key = `${kind}:${id}`;
    const fingerprint = recordFingerprint(value);
    if (this.#fingerprints.has(key)) {
      assert(this.#fingerprints.get(key) === fingerprint, `Immutable ${kind} ${id} cannot be changed in place`, "immutable_record_conflict");
      return;
    }
    store.set(id, deepFreeze(clone(value)));
    this.#fingerprints.set(key, fingerprint);
  }

  getSnapshot(id) {
    const value = this.#snapshots.get(id);
    return value ? clone(value) : null;
  }

  getField(id) {
    const value = this.#fields.get(id);
    return value ? clone(value) : null;
  }

  resolveEndpoint(endpoint) {
    const snapshot = this.#snapshots.get(endpoint.schema_snapshot_id);
    const field = this.#fields.get(endpoint.schema_field_id);
    assert(snapshot, `Unknown schema snapshot: ${endpoint.schema_snapshot_id}`, "unknown_schema_snapshot");
    assert(field, `Unknown schema field: ${endpoint.schema_field_id}`, "unknown_schema_field");
    assert(snapshot.release_id === endpoint.release_id, "Join endpoint release does not match its schema snapshot", "endpoint_release_mismatch");
    assert(snapshot.distribution_id === endpoint.distribution_id, "Join endpoint distribution does not match its schema snapshot", "endpoint_distribution_mismatch");
    assert(field.schema_snapshot_id === endpoint.schema_snapshot_id, "Join field does not belong to the exact snapshot", "endpoint_field_mismatch");
    assert(field.revision_id === endpoint.field_revision_id, "Join endpoint must pin the exact field revision", "endpoint_field_revision_mismatch");

    return { snapshot: clone(snapshot), field: clone(field) };
  }

  resolveVariableContext(context, relationshipEvidence = null) {
    requireContextScope(context);
    assert(typeof context.schema_field_id === "string" && context.schema_field_id.length >= 3, "Resolved variable context requires schema_field_id", "incomplete_variable_context");
    assert(typeof context.field_revision_id === "string" && context.field_revision_id.length >= 3, "Resolved variable context requires field_revision_id", "incomplete_variable_context");
    // Keep the frozen endpoint wire shape unchanged. Relationship evidence is
    // an additive guard around the existing exact release/distribution/field
    // lookup; it may be either direct facts or an accepted PR-007 release
    // binding with nested release/distribution facts.
    const resolved = this.resolveEndpoint({
      release_id: context.release_id,
      distribution_id: context.distribution_id,
      schema_snapshot_id: context.schema_snapshot_id,
      schema_field_id: context.schema_field_id,
      field_revision_id: context.field_revision_id,
    });
    const binding = relationshipEvidence?.release_binding ?? relationshipEvidence;
    const releaseIdentity = binding?.release_identity;
    const distributionRecords = Array.isArray(binding?.distributions) ? binding.distributions : [];
    const relationshipSource = binding?.source_id ?? binding?.source?.source_id ?? null;
    const relationshipAsset = binding?.asset_id ?? binding?.asset?.asset_id ?? null;
    const relationshipRelease = binding?.release_id ?? releaseIdentity?.release_id ?? (Array.isArray(binding?.releases) && binding.releases.length === 1 ? binding.releases[0] : null);
    const relationshipDistributionIds = [...new Set([
      binding?.distribution_id,
      ...(Array.isArray(binding?.distribution_ids) ? binding.distribution_ids : []),
      ...distributionRecords.map((item) => item?.distribution_id),
    ].filter((value) => typeof value === "string" && value.length >= 3))];
    const relationshipSnapshot = binding?.schema_snapshot_id ?? null;
    const snapshotSource = resolved.snapshot.source_id ?? relationshipSource;
    const snapshotAsset = resolved.snapshot.asset_id ?? relationshipAsset;
    assert(typeof snapshotSource === "string" && snapshotSource.length >= 3, "Variable context lacks independently bound source relationship", "unresolved_variable_context");
    assert(typeof snapshotAsset === "string" && snapshotAsset.length >= 3, "Variable context lacks independently bound asset relationship", "unresolved_variable_context");
    assert(snapshotSource === context.source_id, "Variable context source does not match its released schema snapshot", "variable_context_source_mismatch");
    assert(snapshotAsset === context.asset_id, "Variable context asset does not match its released schema snapshot", "variable_context_asset_mismatch");
    if (relationshipSource !== null) assert(relationshipSource === snapshotSource, "Relationship evidence source conflicts with the released schema snapshot", "variable_context_source_mismatch");
    if (relationshipAsset !== null) assert(relationshipAsset === snapshotAsset, "Relationship evidence asset conflicts with the released schema snapshot", "variable_context_asset_mismatch");
    if (relationshipRelease !== null) assert(relationshipRelease === context.release_id, "Relationship evidence release does not match the variable context", "variable_context_release_mismatch");
    if (relationshipDistributionIds.length > 0) assert(relationshipDistributionIds.includes(context.distribution_id), "Relationship evidence does not contain the variable distribution", "variable_context_distribution_mismatch");
    if (relationshipSnapshot !== null) assert(relationshipSnapshot === context.schema_snapshot_id, "Relationship evidence schema snapshot does not match the variable context", "variable_context_snapshot_mismatch");
    if (binding?.binding_state !== undefined) assert(binding.binding_state === "exact", "A non-exact release relationship cannot resolve a variable context", "unresolved_variable_context");
    return resolved;
  }

  inventory() {
    return {
      snapshots: [...this.#snapshots.values()].map(clone).sort((left, right) => left.schema_snapshot_id.localeCompare(right.schema_snapshot_id)),
      fields: [...this.#fields.values()].map(clone).sort((left, right) => left.schema_field_id.localeCompare(right.schema_field_id)),
    };
  }
}
