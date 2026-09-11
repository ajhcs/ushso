import { assert, canonicalJson, clone, deepFreeze, sha256, uniqueSorted } from "./common.mjs";

export const RELEASE_IDENTITY_VERSION = "identity.release-identity.v1.0.0";

export const DATE_ROLES = Object.freeze([
  "observation_period_start",
  "observation_period_end",
  "fiscal_period",
  "vintage",
  "publisher_released_at",
  "publisher_modified_at",
  "catalog_issued",
  "catalog_modified",
  "metadata_observed_at",
  "revision_at",
]);

export const LOCATOR_KINDS = Object.freeze([
  "exact_distribution",
  "rolling_current",
  "landing_page",
  "replacement",
  "ambiguous",
  "unknown",
]);

export const IDENTITY_STATES = Object.freeze([
  "exact",
  "rolling",
  "replaced",
  "unresolved",
  "conflicted",
  "ambiguous",
]);

export const IDENTITY_RULES = Object.freeze([
  "publisher_stable_release_id",
  "hash_scoped_content_identity",
]);

export const RELEASE_KINDS = Object.freeze([
  "edition",
  "vintage",
  "snapshot",
  "filing_period",
  "api_version",
  "rolling_current",
  "other",
  "unknown",
]);

export const DISTRIBUTION_KINDS = Object.freeze([
  "download",
  "api",
  "query_service",
  "web_interface",
  "document",
  "other",
  "unknown",
]);

const MERGED_DATE_KEYS = Object.freeze([
  "date",
  "the_date",
  "merged_date",
  "release_or_modified",
  "issued_or_modified",
  "coverage_or_release",
]);

const OPAQUE_TOKEN = /^[A-Za-z0-9._~-]{1,180}$/;
const CONTENT_SHA = /^(?:sha256:)?[a-f0-9]{64}$/;
const STABLE_UNIQUENESS = new Set(["unique", "source_scoped"]);


function requireEvidence(ids, label) {
  assert(Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === "string" && id.length >= 3), `${label} requires evidence`, "missing_evidence");
  return uniqueSorted(ids);
}

function normalizeSha256(value) {
  if (value == null) return null;
  assert(typeof value === "string" && CONTENT_SHA.test(value), "content_sha256 must be a 64-character hex digest", "invalid_content_hash");
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

function opaqueId(kind, token) {
  assert(OPAQUE_TOKEN.test(token), `opaque ${kind} token is invalid`, "invalid_opaque_id");
  return `urn:ushso:${kind}:${token}`;
}

function hashScopedToken(material) {
  return `hash.${sha256(material).slice(0, 32)}`;
}

function encodeIdentitySegment(value) {
  let encoded = "";
  for (const ch of String(value)) {
    const code = ch.codePointAt(0);
    if (code < 128 && /[A-Za-z0-9_-]/.test(ch)) {
      encoded += ch;
      continue;
    }
    // BMP uses a fixed 4-hex-digit escape. Supplementary code points use a
    // `~u` + 6-hex-digit form so U+1F600 and U+1F60 followed by ASCII "0"
    // cannot both mint `~1F600`.
    if (code <= 0xFFFF) encoded += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
    else encoded += `~u${code.toString(16).toUpperCase().padStart(6, "0")}`;
  }
  return encoded;
}

function publisherToken({
  sourceId,
  namespace,
  normalizedValue,
  uniquenessPolicy,
  entityScope,
  authority,
  assetId = null,
}) {
  const material = {
    rule: "publisher_stable_release_id",
    source_id: sourceId,
    namespace,
    normalized_value: normalizedValue,
    uniqueness_policy: uniquenessPolicy,
    entity_scope: entityScope,
    authority,
    asset_id: uniquenessPolicy === "unique" ? null : assetId,
  };
  const sourceKey = encodeIdentitySegment(String(sourceId).replace(/^urn:ushso:source:/, ""));
  const namespaceKey = encodeIdentitySegment(namespace);
  const valueKey = encodeIdentitySegment(normalizedValue);
  const qualified = `pub.${sourceKey}.${namespaceKey}.${valueKey}`;
  if (OPAQUE_TOKEN.test(qualified) && qualified.length <= 180 && sourceKey && namespaceKey && valueKey) {
    return qualified;
  }
  const hashed = `pub.hash.${sha256(material).slice(0, 32)}`;
  assert(OPAQUE_TOKEN.test(hashed), "opaque release token is invalid", "invalid_opaque_id");
  return hashed;
}

function isStablePublisherIdentifier(identifier, entityScope) {
  return Boolean(
    identifier
    && identifier.entity_scope === entityScope
    && identifier.authority === "source_native"
    && STABLE_UNIQUENESS.has(identifier.uniqueness_policy)
    && identifier.normalized_value,
  );
}

export function createPublisherIdentifier(input) {
  assert(typeof input?.source_id === "string" && input.source_id.length >= 3, "Publisher identifier requires source_id", "invalid_publisher_identifier");
  assert(typeof input.namespace === "string" && /^[a-z][a-z0-9._-]{1,79}$/.test(input.namespace), "Publisher identifier namespace is invalid", "invalid_publisher_identifier");
  assert(typeof input.value === "string" && input.value.length > 0, "Publisher identifier value is required", "invalid_publisher_identifier");
  const identifier = {
    source_id: input.source_id,
    namespace: input.namespace,
    value: input.value,
    normalized_value: input.normalized_value ?? input.value,
    case_behavior: input.case_behavior ?? "sensitive",
    preservation: "exact",
    entity_scope: input.entity_scope ?? "unknown",
    authority: input.authority ?? "source_native",
    uniqueness_policy: input.uniqueness_policy ?? "source_scoped",
    effective_from: input.effective_from ?? null,
    effective_to: input.effective_to ?? null,
    evidence_ids: requireEvidence(input.evidence_ids, "publisher identifier"),
  };
  assert(["organization", "source", "asset", "release", "distribution", "documentation", "schema", "field", "access_route", "unknown"].includes(identifier.entity_scope), "Unknown publisher identifier entity_scope", "invalid_publisher_identifier");
  return deepFreeze(identifier);
}

export function classifyLocator(input, { repeatedUrls = [] } = {}) {
  assert(typeof input?.url === "string" && input.url.length > 0, "Locator URL is required", "invalid_locator");
  const evidenceIds = requireEvidence(input.evidence_ids, "locator");
  let kind = input.kind ?? "unknown";
  assert(LOCATOR_KINDS.includes(kind), `Unknown locator kind: ${kind}`, "invalid_locator");
  const repeated = repeatedUrls.filter((url) => url === input.url).length > 1 || input.repeated === true;
  if (repeated && kind !== "replacement") kind = "ambiguous";
  return deepFreeze({
    kind,
    url: input.url,
    canonical: input.canonical === true,
    repeated,
    evidence_ids: evidenceIds,
  });
}

export function collectDateRoles(roles = []) {
  assert(Array.isArray(roles), "date_roles must be an array", "invalid_date_role");
  for (const role of roles) {
    assert(role && typeof role === "object" && !Array.isArray(role), "Each date role must be an object", "invalid_date_role");
    for (const key of Object.keys(role)) {
      assert(!MERGED_DATE_KEYS.includes(key), "Date roles cannot be merged into a single date field", "date_roles_merged");
    }
    assert(DATE_ROLES.includes(role.role), `Unknown date role: ${role.role}`, "invalid_date_role");
    requireEvidence(role.evidence_ids, `date role ${role.role}`);
  }

  const collected = [];
  const firstIndexByRole = new Map();
  for (const role of roles) {
    const value = role.value === undefined ? null : role.value;
    const existingIndex = firstIndexByRole.get(role.role);
    if (existingIndex != null) {
      const existing = collected[existingIndex];
      if (existing.value === value && existing.value_state !== "conflicted") {
        existing.evidence_ids = uniqueSorted([...existing.evidence_ids, ...role.evidence_ids]);
        continue;
      }
      existing.value_state = "conflicted";
      collected.push({
        role: role.role,
        value,
        value_state: "conflicted",
        period_basis: role.period_basis ?? existing.period_basis ?? "unknown",
        evidence_ids: uniqueSorted(role.evidence_ids),
      });
      continue;
    }
    const entry = {
      role: role.role,
      value,
      value_state: value == null ? "unknown" : "known",
      period_basis: role.period_basis ?? "unknown",
      evidence_ids: uniqueSorted(role.evidence_ids),
    };
    firstIndexByRole.set(role.role, collected.length);
    collected.push(entry);
  }
  return collected.map((entry) => deepFreeze(entry));
}

function stableReleaseIdentifier(identifiers) {
  return identifiers.find((item) => isStablePublisherIdentifier(item, "release"));
}

function mintReleaseId({ rule, sourceId, identifier, contentSha256, locator, observedAt, publisherVersion, assetId }) {
  if (rule === "publisher_stable_release_id") {
    return opaqueId("release", publisherToken({
      sourceId,
      namespace: identifier.namespace,
      normalizedValue: identifier.normalized_value,
      uniquenessPolicy: identifier.uniqueness_policy,
      entityScope: identifier.entity_scope,
      authority: identifier.authority,
      assetId,
    }));
  }
  const material = {
    rule: "hash_scoped_content_identity",
    source_id: sourceId,
    asset_id: assetId,
    content_sha256: contentSha256,
    locator: locator.url,
    locator_kind: locator.kind,
    publisher_version: publisherVersion,
  };
  if (contentSha256) material.observed_at = observedAt;
  return opaqueId("release", hashScopedToken(material));
}

function mintDistributionId({ releaseId, distribution, contentSha256 }) {
  const publisherDistribution = (distribution.publisher_identifiers ?? []).find((item) => isStablePublisherIdentifier(item, "distribution"));
  if (publisherDistribution && distribution.locator.kind !== "ambiguous") {
    return {
      distribution_id: opaqueId("distribution", publisherToken({
        sourceId: publisherDistribution.source_id,
        namespace: publisherDistribution.namespace,
        normalizedValue: publisherDistribution.normalized_value,
        uniquenessPolicy: publisherDistribution.uniqueness_policy,
        entityScope: publisherDistribution.entity_scope,
        authority: publisherDistribution.authority,
        assetId: releaseId,
      })),
      identity_rule: "publisher_stable_release_id",
    };
  }
  if (!contentSha256) {
    return { distribution_id: null, identity_rule: null };
  }
  return {
    distribution_id: opaqueId("distribution", hashScopedToken({
      rule: "hash_scoped_content_identity",
      release_id: releaseId,
      distribution_kind: distribution.distribution_kind,
      format: distribution.format,
      media_type: distribution.media_type ?? null,
      locator: distribution.locator.url,
      content_sha256: contentSha256,
    })),
    identity_rule: "hash_scoped_content_identity",
  };
}

export function assertExistingStableIdUnchanged(expectedAssetId, actualAssetId) {
  assert(typeof expectedAssetId === "string" && expectedAssetId.length >= 3, "Existing stable asset ID is required", "stable_id_rewritten");
  assert(expectedAssetId === actualAssetId, "Existing stable IDs cannot change meaning", "stable_id_rewritten");
  return expectedAssetId;
}

export function mintDistributionIdentity(input, { releaseId = null, releaseState = "unresolved" } = {}) {
  const locator = classifyLocator(input.locator, { repeatedUrls: input.repeated_urls });
  const evidenceIds = requireEvidence(input.evidence_ids, "distribution identity");
  const contentSha256 = normalizeSha256(input.content_sha256 ?? null);
  const distributionKind = input.distribution_kind ?? "unknown";
  assert(DISTRIBUTION_KINDS.includes(distributionKind), `Unknown distribution kind: ${distributionKind}`, "invalid_distribution_kind");
  assert(typeof input.format === "string" && input.format.length > 0, "Distribution format is required", "invalid_distribution");

  let identityState = "unresolved";
  if (locator.kind === "ambiguous") identityState = "ambiguous";
  else if (locator.kind === "replacement") identityState = "replaced";
  else if (locator.kind === "rolling_current") identityState = "rolling";
  else if (contentSha256 && locator.kind === "exact_distribution") identityState = "exact";

  const minted = mintDistributionId({
    releaseId,
    distribution: { ...input, locator },
    contentSha256,
  });
  if (identityState === "exact" && minted.distribution_id == null) identityState = "unresolved";
  if (locator.kind === "ambiguous") {
    assert(minted.distribution_id == null || identityState === "ambiguous", "An ambiguous URL cannot mint an exact distribution", "url_only_exact_binding_forbidden");
  }

  return deepFreeze({
    distribution_id: identityState === "ambiguous" ? null : minted.distribution_id,
    release_id: releaseState === "ambiguous" ? null : releaseId,
    distribution_kind: distributionKind,
    format: input.format,
    media_type: input.media_type ?? null,
    locator,
    content_sha256: contentSha256,
    identity_state: identityState,
    identity_rule: identityState === "ambiguous" || identityState === "unresolved" ? null : minted.identity_rule,
    replacement_of: input.replacement_of ?? null,
    evidence_ids: evidenceIds,
  });
}

export function mintReleaseIdentity(input) {
  assert(typeof input?.asset_id === "string" && input.asset_id.length >= 3, "Release identity requires the existing asset ID", "stable_id_rewritten");
  assert(typeof input.source_id === "string" && input.source_id.length >= 3, "Release identity requires source_id", "invalid_release_identity");
  const assetId = assertExistingStableIdUnchanged(input.asset_id, input.preserve_asset_id ?? input.asset_id);
  const publisherIdentifiers = (input.publisher_identifiers ?? []).map(createPublisherIdentifier);
  assert(publisherIdentifiers.length > 0, "At least one publisher identifier is required", "publisher_identifier_required");
  const locator = classifyLocator(input.locator, { repeatedUrls: input.repeated_urls });
  const dateRoles = collectDateRoles(input.date_roles ?? []);
  const evidenceIds = requireEvidence(input.evidence_ids, "release identity");
  const contentSha256 = normalizeSha256(input.content_sha256 ?? null);
  const publisherVersion = input.publisher_version ?? null;
  const observedAt = input.observed_at;
  assert(typeof observedAt === "string" && Number.isFinite(Date.parse(observedAt)), "observed_at must be an ISO timestamp", "invalid_time");

  const reasons = [];
  const alternatives = [];
  const dateConflict = dateRoles.some((role) => role.value_state === "conflicted");
  if (dateConflict) reasons.push("date_role_conflict");

  let identityState = "unresolved";
  let identityRule = null;
  let releaseKind = input.release_kind ?? "unknown";
  assert(RELEASE_KINDS.includes(releaseKind), `Unknown release kind: ${releaseKind}`, "invalid_release_kind");

  if (locator.kind === "ambiguous") {
    identityState = "ambiguous";
    reasons.push("ambiguous_locator");
    alternatives.push({
      state: "ambiguous",
      release_id: null,
      distribution_id: null,
      reason_codes: ["ambiguous_url_is_not_exact_release"],
      evidence_ids: locator.evidence_ids,
      evidence_pointers: input.evidence_pointers ?? [],
    });
  } else if (locator.kind === "rolling_current" || releaseKind === "rolling_current") {
    identityState = "rolling";
    releaseKind = "rolling_current";
    reasons.push("rolling_endpoint_not_exact");
    if (contentSha256) {
      identityRule = "hash_scoped_content_identity";
    } else {
      reasons.push("rolling_without_content_identity");
    }
  } else if (locator.kind === "replacement") {
    identityState = "replaced";
    reasons.push("replacement_content");
    if (contentSha256) identityRule = "hash_scoped_content_identity";
  } else {
    const stable = stableReleaseIdentifier(publisherIdentifiers);
    if (stable && publisherVersion) {
      identityRule = "publisher_stable_release_id";
      identityState = dateConflict ? "conflicted" : "exact";
      if (!input.release_kind) releaseKind = "edition";
    } else if (contentSha256) {
      identityRule = "hash_scoped_content_identity";
      identityState = dateConflict ? "conflicted" : "exact";
      if (!input.release_kind) releaseKind = publisherVersion ? "vintage" : "snapshot";
    } else if (publisherVersion && locator.kind !== "unknown") {
      identityRule = "hash_scoped_content_identity";
      identityState = dateConflict ? "conflicted" : "exact";
      if (!input.release_kind) releaseKind = "vintage";
    } else {
      reasons.push("no_stable_release_id_or_content_hash");
      if (locator.kind === "landing_page" || locator.kind === "unknown") reasons.push("url_alone_is_not_exact_release");
    }
  }

  if (identityState === "exact" && locator.kind !== "exact_distribution" && locator.kind !== "landing_page" && !contentSha256 && identityRule !== "publisher_stable_release_id") {
    identityState = "unresolved";
    identityRule = null;
    reasons.push("url_only_exact_binding_forbidden");
  }

  const releaseId = identityRule && identityState !== "ambiguous"
    ? mintReleaseId({
      rule: identityRule,
      sourceId: input.source_id,
      identifier: stableReleaseIdentifier(publisherIdentifiers) ?? publisherIdentifiers[0],
      contentSha256,
      locator,
      observedAt,
      publisherVersion,
      assetId,
    })
    : null;

  const distributions = (input.distributions ?? []).map((distribution) => mintDistributionIdentity(distribution, {
    releaseId,
    releaseState: identityState,
  }));

  if (identityState === "ambiguous") {
    assert(releaseId == null, "An ambiguous URL cannot mint an exact release ID", "url_only_exact_binding_forbidden");
  }

  return deepFreeze({
    schema_version: RELEASE_IDENTITY_VERSION,
    asset_id: assetId,
    source_id: input.source_id,
    release_id: identityState === "ambiguous" ? null : releaseId,
    identity_state: identityState,
    identity_rule: identityState === "unresolved" || identityState === "ambiguous" ? null : identityRule,
    release_kind: releaseKind,
    publisher_version: publisherVersion,
    publisher_identifiers: publisherIdentifiers,
    locator,
    date_roles: dateRoles,
    content_sha256: contentSha256,
    distributions,
    alternatives,
    replacement_of: input.replacement_of ?? null,
    evidence_ids: evidenceIds,
    evidence_pointers: clone(input.evidence_pointers ?? []),
    observed_at: observedAt,
    reason_codes: uniqueSorted(reasons),
    boundaries: {
      existing_stable_id_rewritten: false,
      url_alone_is_exact_release: false,
      date_roles_merged: false,
      catalog_membership_is_payload_access: false,
      scientific_fitness_claimed: false,
    },
  });
}

export function compareReplacementIdentities(previous, current) {
  assert(previous && current, "Replacement comparison requires previous and current identities", "invalid_replacement");
  assert(previous.locator?.url === current.locator?.url, "Replacement comparison requires the same locator", "replacement_locator_mismatch");
  assert(previous.content_sha256 && current.content_sha256, "Replacement comparison requires content hashes", "missing_content_identity");
  assert(previous.content_sha256 !== current.content_sha256, "Replacement content hashes must differ", "replacement_unchanged");
  assert(previous.release_id !== current.release_id && previous.asset_id === current.asset_id, "Replacement must preserve the asset and mint a new release identity", "stable_id_rewritten");
  return deepFreeze({
    relationship: "successor_of",
    identity_equality: false,
    previous_release_id: previous.release_id,
    current_release_id: current.release_id,
    locator: current.locator.url,
    previous_content_sha256: previous.content_sha256,
    current_content_sha256: current.content_sha256,
    merged: false,
  });
}

export function canonicalReleaseIdentityJson(value) {
  return canonicalJson(value);
}
