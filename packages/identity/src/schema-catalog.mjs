import { assert, canonicalJson, clone, deepFreeze, sha256, uniqueSorted } from "./common.mjs";

function recordFingerprint(record) {
  return sha256(record);
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

  inventory() {
    return {
      snapshots: [...this.#snapshots.values()].map(clone).sort((left, right) => left.schema_snapshot_id.localeCompare(right.schema_snapshot_id)),
      fields: [...this.#fields.values()].map(clone).sort((left, right) => left.schema_field_id.localeCompare(right.schema_field_id)),
    };
  }
}
