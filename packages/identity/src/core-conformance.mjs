import { assert, clone, deepFreeze } from "./common.mjs";

export const CORE_CONTRACT_VERSION = "observatory-core.v2.0.0";
export const CORE_NATIVE_IDENTIFIER_REF = "https://ushso.org/contracts/core/v2.0.0/schemas/common.schema.json#/$defs/nativeIdentifier";
export const CORE_OPAQUE_ID = /^urn:ushso:[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$/;

const ENTITY_SCOPES = new Set([
  "organization", "source", "asset", "release", "distribution",
  "documentation", "schema", "field", "access_route", "unknown",
]);
const AUTHORITIES = new Set(["source_native", "authoritative_cross_source", "legacy_alias"]);
const UNIQUENESS = new Set(["unique", "reusable_over_time", "source_scoped", "unknown"]);
const CASE_BEHAVIOR = new Set(["sensitive", "insensitive", "normalization_defined"]);

/**
 * Structural check against core v2 nativeIdentifier. This is not a substitute
 * for schema validation; tests compile the frozen core schema separately.
 */
export function nativeIdentifierConformsToCore(identifier) {
  if (!identifier || typeof identifier !== "object") return false;
  if (!CORE_OPAQUE_ID.test(identifier.source_id)) return false;
  if (typeof identifier.namespace !== "string" || !/^[a-z][a-z0-9._-]{1,79}$/.test(identifier.namespace)) return false;
  if (typeof identifier.value !== "string" || identifier.value.length < 1) return false;
  if (identifier.normalized_value != null && (typeof identifier.normalized_value !== "string" || identifier.normalized_value.length < 1)) return false;
  if (!CASE_BEHAVIOR.has(identifier.case_behavior)) return false;
  if (identifier.preservation !== "exact") return false;
  if (!ENTITY_SCOPES.has(identifier.entity_scope)) return false;
  if (!AUTHORITIES.has(identifier.authority)) return false;
  if (!UNIQUENESS.has(identifier.uniqueness_policy)) return false;
  if (!(identifier.effective_from === null || typeof identifier.effective_from === "string")) return false;
  if (!(identifier.effective_to === null || typeof identifier.effective_to === "string")) return false;
  if (!Array.isArray(identifier.evidence_ids) || identifier.evidence_ids.length === 0) return false;
  return identifier.evidence_ids.every((id) => CORE_OPAQUE_ID.test(id));
}

export function coreNativeIdentifiersFromPublisher(identifiers = []) {
  return identifiers.filter(nativeIdentifierConformsToCore).map(clone);
}

/**
 * Exact identity may cite core native identifiers. Unresolved, rolling, and
 * ambiguous identity decisions are not projected as fabricated core
 * Source/Release/Distribution objects.
 */
export function projectCoreReleaseDecision(identity, { envelope = null } = {}) {
  const identityState = identity?.identity_state ?? "unresolved";
  const nativeIdentifiers = coreNativeIdentifiersFromPublisher(identity?.publisher_identifiers ?? []);
  if (!identity?.release_id || !["exact", "conflicted"].includes(identityState)) {
    return deepFreeze({
      projected: false,
      core_object: null,
      identity_state: identityState,
      release_id: identity?.release_id ?? null,
      native_identifiers: nativeIdentifiers,
      reason_codes: ["unresolved_identity_is_not_a_core_release"],
      contract_version: CORE_CONTRACT_VERSION,
    });
  }
  if (!envelope) {
    return deepFreeze({
      projected: false,
      core_object: null,
      identity_state: identityState,
      release_id: identity.release_id,
      asset_id: identity.asset_id,
      native_identifiers: nativeIdentifiers,
      reason_codes: ["exact_identity_without_core_envelope_is_not_fabricated"],
      contract_version: CORE_CONTRACT_VERSION,
    });
  }
  assert(envelope.contract_version === CORE_CONTRACT_VERSION, "Core envelope contract_version is required", "invalid_core_envelope");
  assert(envelope.entity_type === "Release", "Core envelope must be a Release", "invalid_core_envelope");
  assert(envelope.asset_id && envelope.release_id, "Core envelope requires asset_id and release_id", "invalid_core_envelope");
  assert(envelope.asset_id === identity.asset_id || identity.asset_id === envelope.entity_id || envelope.asset_id, "Core envelope asset_id is required", "invalid_core_envelope");
  if (envelope.release_id !== identity.release_id) {
    return deepFreeze({
      projected: false,
      core_object: null,
      identity_state: identityState,
      release_id: identity.release_id,
      envelope_release_id: envelope.release_id,
      native_identifiers: nativeIdentifiers,
      reason_codes: ["core_release_id_mismatch"],
      contract_version: CORE_CONTRACT_VERSION,
    });
  }
  const projected = clone(envelope);
  if (nativeIdentifiers.length > 0) projected.native_identifiers = nativeIdentifiers;
  return deepFreeze({
    projected: true,
    core_object: projected,
    identity_state: identityState,
    release_id: identity.release_id,
    native_identifiers: nativeIdentifiers,
    reason_codes: [],
    contract_version: CORE_CONTRACT_VERSION,
  });
}
