import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { fingerprintTruthRevision } from "../../../contracts/core/v2.0.0/tools/common.mjs";
import { clone, deepFreeze, uniqueSorted } from "./common.mjs";

export const CORE_CONTRACT_VERSION = "observatory-core.v2.0.0";
export const CORE_NATIVE_IDENTIFIER_REF = "https://ushso.org/contracts/core/v2.0.0/schemas/common.schema.json#/$defs/nativeIdentifier";
export const CORE_RELEASE_SCHEMA_ID = "https://ushso.org/contracts/core/v2.0.0/schemas/release.schema.json";
export const CORE_OPAQUE_ID = /^urn:ushso:[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$/;

const CORE_SCHEMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../contracts/core/v2.0.0/schemas");

/**
 * Format predicates from contracts/core/v2.0.0/tools/schema.mjs. Identity
 * reuses that frozen facility rather than ajv-formats or a structural
 * any-string date check.
 */
function addFrozenCoreFormats(ajv) {
  ajv.addFormat("date-time", (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && !Number.isNaN(Date.parse(value)));
  ajv.addFormat("date", (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
  ajv.addFormat("uri", (value) => {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && url.username === "" && url.password === "";
    } catch {
      return false;
    }
  });
}

let frozenValidators = null;

function loadFrozenCoreValidators() {
  if (frozenValidators) return frozenValidators;
  const ajv = new Ajv2020({
    strict: true,
    strictSchema: true,
    strictTypes: true,
    strictRequired: true,
    allErrors: true,
    validateFormats: true,
    allowUnionTypes: false,
  });
  addFrozenCoreFormats(ajv);
  for (const name of fs.readdirSync(CORE_SCHEMA_DIR).filter((file) => file.endsWith(".schema.json")).sort()) {
    const schema = JSON.parse(fs.readFileSync(path.join(CORE_SCHEMA_DIR, name), "utf8"));
    ajv.addSchema(schema, schema.$id ?? name);
  }
  frozenValidators = {
    native: ajv.compile({ $ref: CORE_NATIVE_IDENTIFIER_REF }),
    release: ajv.getSchema(CORE_RELEASE_SCHEMA_ID),
  };
  return frozenValidators;
}

export function nativeIdentifierConformsToCore(identifier) {
  if (!identifier || typeof identifier !== "object" || Array.isArray(identifier)) return false;
  try {
    const { native } = loadFrozenCoreValidators();
    return native(identifier) === true;
  } catch {
    return false;
  }
}

export function coreNativeIdentifiersFromPublisher(identifiers = []) {
  return identifiers.filter(nativeIdentifierConformsToCore).map(clone);
}

function nativeKey(identifier) {
  return `${identifier.source_id}::${identifier.namespace}`;
}

function ownershipReasonCodes(identity, envelope) {
  const reasons = [];
  if (envelope.asset_id !== identity.asset_id) reasons.push("core_asset_id_mismatch");
  if (envelope.release_id !== identity.release_id) reasons.push("core_release_id_mismatch");
  if (envelope.entity_id !== identity.release_id) reasons.push("core_entity_id_mismatch");
  const identityNatives = coreNativeIdentifiersFromPublisher(identity.publisher_identifiers ?? []);
  const envelopeNatives = Array.isArray(envelope.native_identifiers) ? envelope.native_identifiers : [];
  if (identity.source_id) {
    for (const native of [...identityNatives, ...envelopeNatives]) {
      if (native.source_id && native.source_id !== identity.source_id) reasons.push("core_source_id_mismatch");
    }
  }
  const envelopeByNamespace = new Map(envelopeNatives.map((native) => [nativeKey(native), native.value]));
  for (const native of identityNatives) {
    const existing = envelopeByNamespace.get(nativeKey(native));
    if (existing != null && existing !== native.value) reasons.push("core_native_identifier_mismatch");
  }
  return uniqueSorted(reasons);
}

function notProjected(identity, reasonCodes, extra = {}) {
  return deepFreeze({
    projected: false,
    core_object: null,
    identity_state: identity?.identity_state ?? "unresolved",
    release_id: identity?.release_id ?? null,
    asset_id: identity?.asset_id ?? null,
    native_identifiers: coreNativeIdentifiersFromPublisher(identity?.publisher_identifiers ?? []),
    reason_codes: uniqueSorted(reasonCodes),
    contract_version: CORE_CONTRACT_VERSION,
    ...extra,
  });
}

function envelopeFingerprintReason(envelope) {
  try {
    const actual = fingerprintTruthRevision(envelope);
    if (envelope.canonical_content_fingerprint !== actual) {
      return {
        reason_codes: ["core_content_fingerprint_mismatch"],
        extra: {
          envelope_canonical_content_fingerprint: envelope.canonical_content_fingerprint ?? null,
          actual_canonical_content_fingerprint: actual,
        },
      };
    }
    return { reason_codes: [], extra: {} };
  } catch {
    return { reason_codes: ["incomplete_or_invalid_core_envelope"], extra: {} };
  }
}

/**
 * Exact identity may cite core native identifiers. Unresolved, rolling, and
 * ambiguous identity decisions are not projected as fabricated core
 * Source/Release/Distribution objects. A supplied envelope is this release
 * only when frozen Release schema validation, release/entity/asset/source
 * ownership, and the frozen canonical content fingerprint all bind.
 * Provenance and fingerprints stay on the envelope; a stale hash is a typed
 * non-projection, not a silent rewrite.
 */
export function projectCoreReleaseDecision(identity, { envelope = null } = {}) {
  const identityState = identity?.identity_state ?? "unresolved";
  if (!identity?.release_id || !["exact", "conflicted"].includes(identityState)) {
    return notProjected(identity, ["unresolved_identity_is_not_a_core_release"]);
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return notProjected(identity, envelope == null
      ? ["exact_identity_without_core_envelope_is_not_fabricated"]
      : ["incomplete_or_invalid_core_envelope"]);
  }

  let schemaValid = false;
  try {
    const { release } = loadFrozenCoreValidators();
    schemaValid = release?.(envelope) === true;
  } catch {
    schemaValid = false;
  }
  if (!schemaValid) {
    return notProjected(identity, ["incomplete_or_invalid_core_envelope"]);
  }

  const ownership = ownershipReasonCodes(identity, envelope);
  const fingerprint = envelopeFingerprintReason(envelope);
  if (ownership.length > 0 || fingerprint.reason_codes.length > 0) {
    return notProjected(identity, [...ownership, ...fingerprint.reason_codes], {
      envelope_release_id: envelope.release_id ?? null,
      envelope_entity_id: envelope.entity_id ?? null,
      envelope_asset_id: envelope.asset_id ?? null,
      ...fingerprint.extra,
    });
  }

  return deepFreeze({
    projected: true,
    core_object: clone(envelope),
    identity_state: identityState,
    release_id: identity.release_id,
    asset_id: identity.asset_id,
    native_identifiers: clone(envelope.native_identifiers),
    reason_codes: [],
    contract_version: CORE_CONTRACT_VERSION,
  });
}
