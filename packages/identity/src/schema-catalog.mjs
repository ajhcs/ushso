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
    // lookup. A resolved variable needs an independently supplied source ->
    // asset -> release -> selected distribution chain.
    const resolved = this.resolveEndpoint({
      release_id: context.release_id,
      distribution_id: context.distribution_id,
      schema_snapshot_id: context.schema_snapshot_id,
      schema_field_id: context.schema_field_id,
      field_revision_id: context.field_revision_id,
    });
    const roots = [];
    if (relationshipEvidence === null || relationshipEvidence === undefined) {
      // Preserve the original resolver behavior for registered snapshots that
      // already carry both source and asset ownership facts. Core snapshots
      // without those parent fields still require independent relationship
      // evidence below.
      assert(typeof resolved.snapshot.source_id === "string" && resolved.snapshot.source_id.length >= 3, "Variable context lacks independently bound source relationship", "unresolved_variable_context");
      assert(typeof resolved.snapshot.asset_id === "string" && resolved.snapshot.asset_id.length >= 3, "Variable context lacks independently bound asset relationship", "unresolved_variable_context");
      roots.push({
        source_id: resolved.snapshot.source_id,
        asset_id: resolved.snapshot.asset_id,
        release_id: resolved.snapshot.release_id,
        distribution_id: resolved.snapshot.distribution_id,
        schema_snapshot_id: resolved.snapshot.schema_snapshot_id,
      });
    } else {
      assert(typeof relationshipEvidence === "object" && !Array.isArray(relationshipEvidence), "Variable context relationship evidence must be an object", "unresolved_variable_context");
      roots.push(relationshipEvidence);
      if (Object.hasOwn(relationshipEvidence, "release_binding")) {
        assert(relationshipEvidence.release_binding && typeof relationshipEvidence.release_binding === "object" && !Array.isArray(relationshipEvidence.release_binding), "Release relationship binding must be an object", "unresolved_variable_context");
        roots.push(relationshipEvidence.release_binding);
      }
      if (Object.hasOwn(resolved.snapshot, "source_id") || Object.hasOwn(resolved.snapshot, "asset_id")) {
        // Registered parent facts are immutable constraints. They remain in
        // the relationship set even when a caller supplies external binding
        // evidence, so foreign caller facts cannot override the snapshot.
        assert(typeof resolved.snapshot.source_id === "string" && resolved.snapshot.source_id.length >= 3, "Registered snapshot source relationship is invalid", "unresolved_variable_context");
        assert(typeof resolved.snapshot.asset_id === "string" && resolved.snapshot.asset_id.length >= 3, "Registered snapshot asset relationship is invalid", "unresolved_variable_context");
        roots.push({ source_id: resolved.snapshot.source_id, asset_id: resolved.snapshot.asset_id });
      }
    }

    const sourceIds = []
    const assetIds = [];
    const releaseIds = [];
    const schemaSnapshotIds = [];
    const selectedDistributionIds = [];
    const listedDistributionIds = [];
    const distributionRecords = [];
    const bindingStates = [];
    const relationshipId = (value, label, target) => {
      assert(typeof value === "string" && value.length >= 3, label + " must be an identifier", "unresolved_variable_context");
      target.push(value);
    };
    const scalar = (record, key, label, target) => {
      if (Object.hasOwn(record, key)) relationshipId(record[key], label, target);
    };
    const idList = (record, key, label, target) => {
      if (!Object.hasOwn(record, key)) return;
      assert(Array.isArray(record[key]) && record[key].length > 0, label + " must contain at least one identifier", "unresolved_variable_context");
      record[key].forEach((value, index) => relationshipId(value, label + "[" + index + "]", target));
    };
    const distributionList = (record, key, label) => {
      if (!Object.hasOwn(record, key)) return;
      assert(Array.isArray(record[key]) && record[key].length > 0, label + " must contain at least one distribution", "unresolved_variable_context");
      record[key].forEach((item, index) => {
        assert(item && typeof item === "object" && !Array.isArray(item), label + "[" + index + "] must be an object", "unresolved_variable_context");
        distributionRecords.push(item);
        if (Object.hasOwn(item, "distribution_id") && item.distribution_id !== null && item.distribution_id !== undefined) {
          relationshipId(item.distribution_id, label + "[" + index + "].distribution_id", listedDistributionIds);
        }
        if (Object.hasOwn(item, "release_id") && item.release_id !== null && item.release_id !== undefined) {
          relationshipId(item.release_id, label + "[" + index + "].release_id", releaseIds);
        }
      });
    };
    for (const root of roots) {
      if (Object.hasOwn(root, "binding_state")) {
        assert(["exact", "one_to_many"].includes(root.binding_state), "A non-exact release relationship cannot resolve a variable context", "unresolved_variable_context");
        bindingStates.push(root.binding_state);
      }
      scalar(root, "source_id", "relationship source_id", sourceIds);
      scalar(root, "asset_id", "relationship asset_id", assetIds);
      scalar(root, "release_id", "relationship release_id", releaseIds);
      scalar(root, "schema_snapshot_id", "relationship schema_snapshot_id", schemaSnapshotIds);
      scalar(root, "distribution_id", "relationship distribution_id", selectedDistributionIds);
      idList(root, "distribution_ids", "relationship distribution_ids", listedDistributionIds);
      idList(root, "releases", "relationship releases", releaseIds);
      distributionList(root, "distributions", "relationship distributions");
      if (Object.hasOwn(root, "source")) {
        assert(root.source && typeof root.source === "object" && !Array.isArray(root.source), "Relationship source must be an object", "unresolved_variable_context");
        scalar(root.source, "source_id", "relationship source.source_id", sourceIds);
      }
      if (Object.hasOwn(root, "asset")) {
        assert(root.asset && typeof root.asset === "object" && !Array.isArray(root.asset), "Relationship asset must be an object", "unresolved_variable_context");
        scalar(root.asset, "asset_id", "relationship asset.asset_id", assetIds);
      }
      if (Object.hasOwn(root, "release_identity")) {
        const release = root.release_identity;
        assert(release && typeof release === "object" && !Array.isArray(release), "Release identity must be an object", "unresolved_variable_context");
        if (Object.hasOwn(release, "identity_state")) {
          assert(release.identity_state === "exact", "A non-exact release identity cannot resolve a variable context", "unresolved_variable_context");
        }
        scalar(release, "source_id", "release_identity.source_id", sourceIds);
        scalar(release, "asset_id", "release_identity.asset_id", assetIds);
        scalar(release, "release_id", "release_identity.release_id", releaseIds);
        scalar(release, "schema_snapshot_id", "release_identity.schema_snapshot_id", schemaSnapshotIds);
        scalar(release, "distribution_id", "release_identity.distribution_id", selectedDistributionIds);
        idList(release, "distribution_ids", "release_identity.distribution_ids", listedDistributionIds);
        idList(release, "releases", "release_identity.releases", releaseIds);
        distributionList(release, "distributions", "release_identity.distributions");
      }
    }

    const allDistributionIds = [...selectedDistributionIds, ...listedDistributionIds];
    assert(sourceIds.length > 0, "Variable context lacks independently bound source relationship", "unresolved_variable_context");
    assert(assetIds.length > 0, "Variable context lacks independently bound asset relationship", "unresolved_variable_context");
    assert(releaseIds.length > 0, "Variable context lacks independently bound release relationship", "unresolved_variable_context");
    assert(schemaSnapshotIds.every((value) => value === context.schema_snapshot_id), "Relationship evidence schema snapshot does not match the variable context", "variable_context_snapshot_mismatch");
    assert(allDistributionIds.length > 0, "Variable context lacks independently bound distribution relationship", "unresolved_variable_context");
    assert(sourceIds.every((value) => value === context.source_id), "Variable context source does not match its release relationship", "variable_context_source_mismatch");
    assert(assetIds.every((value) => value === context.asset_id), "Variable context asset does not match its release relationship", "variable_context_asset_mismatch");
    assert(releaseIds.every((value) => value === context.release_id), "Relationship evidence release does not match the variable context", "variable_context_release_mismatch");
    assert(selectedDistributionIds.every((value) => value === context.distribution_id), "Relationship evidence selected distribution does not match the variable context", "variable_context_distribution_mismatch");
    assert(allDistributionIds.includes(context.distribution_id), "Relationship evidence does not contain the variable distribution", "variable_context_distribution_mismatch");

    const selectedRecords = distributionRecords.filter((item) => item.distribution_id === context.distribution_id);
    if (distributionRecords.length > 0) {
      assert(selectedRecords.length > 0, "Relationship distribution records do not contain the variable distribution", "variable_context_distribution_mismatch");
    }
    for (const distribution of selectedRecords) {
      assert(distribution.identity_state === undefined || distribution.identity_state === "exact", "The selected distribution is not exact", "unresolved_variable_context");
      assert(distribution.release_id === context.release_id, "Selected distribution release does not match the variable context", "variable_context_release_mismatch");
    }
    if (bindingStates.includes("one_to_many")) {
      assert(selectedRecords.length > 0, "A one-to-many release relationship requires an explicitly selected distribution record", "unresolved_variable_context");
    }
    return resolved;
  }
  inventory() {
    return {
      snapshots: [...this.#snapshots.values()].map(clone).sort((left, right) => left.schema_snapshot_id.localeCompare(right.schema_snapshot_id)),
      fields: [...this.#fields.values()].map(clone).sort((left, right) => left.schema_field_id.localeCompare(right.schema_field_id)),
    };
  }
}
