import { assert, clone, deepFreeze, uniqueSorted } from "./common.mjs";
import {
  mintDistributionIdentity,
  mintReleaseIdentity,
} from "./release-identity.mjs";

export const RELEASE_BINDING_VERSION = "identity.release-binding.v1.0.0";
export const BINDING_STATES = Object.freeze([
  "exact",
  "one_to_many",
  "rolling",
  "replaced",
  "ambiguous",
  "unresolved",
  "conflicted",
]);

function requireCapture(capture, label) {
  if (!capture || typeof capture !== "object") return { ok: false, reason: `${label}_missing` };
  if (capture.status !== "captured") return { ok: false, reason: `${label}_unavailable` };
  if (typeof capture.sha256 !== "string" || capture.sha256.length < 32) return { ok: false, reason: `${label}_unhashed` };
  return { ok: true };
}

function sourceNativeId(record) {
  return record?.identity?.match_fields?.source_id
    ?? record?.source_native_id
    ?? record?.identity?.source_native_id
    ?? null;
}

function stableAssetId(record) {
  return record?.record_id ?? record?.identity?.asset?.asset_id ?? null;
}

function sourceId(record) {
  const raw = record?.identity?.source?.source_id ?? record?.source_id ?? null;
  if (typeof raw !== "string" || raw.length < 3) return null;
  return raw.startsWith("urn:ushso:source:") ? raw : `urn:ushso:source:${raw}`;
}

function catalogEntries(capture) {
  const data = capture.data;
  if (Array.isArray(data?.dataset)) {
    return data.dataset.map((row, index) => ({
      kind: "dcat",
      row,
      pointer: `/dataset/${index}`,
      identifier: row?.identifier ?? null,
    }));
  }
  if (data && typeof data === "object" && !Array.isArray(data) && typeof data.id === "string") {
    return [{ kind: "socrata_view", row: data, pointer: "", identifier: data.id }];
  }
  return [];
}

function distributionUrl(distribution) {
  return distribution?.downloadURL ?? distribution?.accessURL ?? distribution?.accessUrl ?? null;
}

function resourcesUrl(distribution) {
  return distribution?.resourcesAPI ?? distribution?.resources_url ?? null;
}

function locatorKindFor(distribution, { rolling = false, repeated = false, replacement = false } = {}) {
  if (replacement) return "replacement";
  if (repeated) return "ambiguous";
  if (rolling) return "rolling_current";
  if (distribution?.downloadURL || distribution?.accessURL) return "exact_distribution";
  return "unknown";
}

function dateRolesFromCatalogRow(row, evidenceId) {
  const roles = [];
  const push = (role, value) => {
    if (value === undefined || value === null || value === "") return;
    roles.push({ role, value: String(value), evidence_ids: [evidenceId] });
  };
  push("catalog_issued", row.issued);
  push("catalog_modified", row.modified);
  push("vintage", row.c_vintage ?? row.vintage);
  if (typeof row.temporal === "string" && row.temporal.includes("/")) {
    const [start, end] = row.temporal.split("/");
    push("observation_period_start", start);
    push("observation_period_end", end);
  } else {
    push("observation_period_start", row.temporal);
  }
  push("publisher_released_at", row.publisher_released_at);
  push("revision_at", row.publisher_modified_at);
  return roles;
}

function urlIndex(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const distributions = Array.isArray(entry.row?.distribution) ? entry.row.distribution : [];
    for (const distribution of distributions) {
      const url = distributionUrl(distribution);
      if (!url) continue;
      counts.set(url, (counts.get(url) ?? 0) + 1);
    }
  }
  return counts;
}

function evidencePointer({ evidenceId, captureSha256, pointer, locator = null }) {
  return {
    evidence_id: evidenceId,
    capture_sha256: captureSha256 ?? null,
    pointer,
    locator,
  };
}

function emptyBinding(overrides) {
  return deepFreeze({
    schema_version: RELEASE_BINDING_VERSION,
    binding_state: "unresolved",
    asset_id: null,
    source_id: null,
    source_native_id: null,
    release_identity: null,
    releases: [],
    distributions: [],
    alternatives: [],
    evidence_pointers: [],
    reason_codes: [],
    fabricated_exact_binding: false,
    boundaries: {
      existing_stable_id_rewritten: false,
      url_alone_is_exact_release: false,
      catalog_membership_is_payload_access: false,
      scientific_fitness_claimed: false,
    },
    ...overrides,
  });
}

export function bindCapturedCatalogRecord(input) {
  const record = input?.record;
  const catalogCapture = input?.catalogCapture ?? null;
  const resourcesCapture = input?.resourcesCapture ?? null;
  const observedAt = input?.observedAt ?? catalogCapture?.captured_at ?? record?.freshness_verification?.metadata_observed_at;
  const assetId = stableAssetId(record);
  const nativeId = sourceNativeId(record);
  const resolvedSourceId = sourceId(record);
  const reasons = [];
  const alternatives = [];
  const pointers = [];

  if (typeof assetId !== "string" || assetId.length < 3) {
    return emptyBinding({ reason_codes: ["missing_stable_asset_id"] });
  }
  if (typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt))) {
    return emptyBinding({
      asset_id: assetId,
      source_id: resolvedSourceId,
      source_native_id: nativeId,
      reason_codes: ["missing_observation_time"],
    });
  }

  if (!catalogCapture) {
    const url = record?.authoritative_url ?? record?.identity?.match_fields?.canonical_url ?? null;
    reasons.push("catalog_capture_missing");
    if (url) reasons.push("url_alone_is_not_exact_release");
    return emptyBinding({
      asset_id: assetId,
      source_id: resolvedSourceId,
      source_native_id: nativeId,
      reason_codes: uniqueSorted(reasons),
      alternatives: url ? [{
        state: "unresolved",
        release_id: null,
        distribution_id: null,
        reason_codes: ["ambiguous_or_url_only_input"],
        evidence_ids: ["evidence:url-only"],
        evidence_pointers: [evidencePointer({ evidenceId: "evidence:url-only", captureSha256: null, pointer: "/authoritative_url", locator: url })],
      }] : [],
    });
  }

  const catalogOk = requireCapture(catalogCapture, "catalog");
  if (!catalogOk.ok) {
    return emptyBinding({
      asset_id: assetId,
      source_id: resolvedSourceId,
      source_native_id: nativeId,
      reason_codes: [catalogOk.reason],
    });
  }

  const catalogEvidenceId = catalogCapture.evidence_id ?? `evidence:catalog:${catalogCapture.sha256.slice(0, 24)}`;
  const entries = catalogEntries(catalogCapture);
  if (entries.length === 0) {
    return emptyBinding({
      asset_id: assetId,
      source_id: resolvedSourceId,
      source_native_id: nativeId,
      reason_codes: ["catalog_shape_unresolved"],
      evidence_pointers: [evidencePointer({ evidenceId: catalogEvidenceId, captureSha256: catalogCapture.sha256, pointer: "/", locator: catalogCapture.url ?? null })],
    });
  }
  if (typeof nativeId !== "string" || nativeId.length === 0) {
    return emptyBinding({
      asset_id: assetId,
      source_id: resolvedSourceId,
      source_native_id: nativeId,
      reason_codes: ["source_native_id_missing"],
      evidence_pointers: [evidencePointer({ evidenceId: catalogEvidenceId, captureSha256: catalogCapture.sha256, pointer: "/", locator: catalogCapture.url ?? null })],
    });
  }

  const matches = entries.filter((entry) => entry.identifier === nativeId);
  if (matches.length === 0) {
    return emptyBinding({
      asset_id: assetId,
      source_id: resolvedSourceId,
      source_native_id: nativeId,
      reason_codes: ["identity_not_found"],
      evidence_pointers: [evidencePointer({ evidenceId: catalogEvidenceId, captureSha256: catalogCapture.sha256, pointer: "/", locator: catalogCapture.url ?? null })],
    });
  }
  if (matches.length > 1) {
    for (const match of matches) {
      alternatives.push({
        state: "ambiguous",
        release_id: null,
        distribution_id: null,
        reason_codes: ["ambiguous_catalog_identifier"],
        evidence_ids: [catalogEvidenceId],
        evidence_pointers: [evidencePointer({
          evidenceId: catalogEvidenceId,
          captureSha256: catalogCapture.sha256,
          pointer: `${match.pointer}/identifier`,
          locator: catalogCapture.url ?? null,
        })],
      });
    }
    return emptyBinding({
      binding_state: "ambiguous",
      asset_id: assetId,
      source_id: resolvedSourceId,
      source_native_id: nativeId,
      alternatives,
      evidence_pointers: alternatives.flatMap((item) => item.evidence_pointers),
      reason_codes: ["ambiguous_catalog_identifier"],
    });
  }

  const match = matches[0];
  pointers.push(evidencePointer({
    evidenceId: catalogEvidenceId,
    captureSha256: catalogCapture.sha256,
    pointer: `${match.pointer}/identifier`,
    locator: catalogCapture.url ?? null,
  }));

  const rolling = record?.identity?.asset?.version_state === "rolling" || match.kind === "socrata_view";
  const catalogDistributions = Array.isArray(match.row?.distribution) ? match.row.distribution : [];
  const urlCounts = urlIndex(entries);
  const distributionInputs = [];

  for (const [index, distribution] of catalogDistributions.entries()) {
    const url = distributionUrl(distribution);
    const repeated = url ? (urlCounts.get(url) ?? 0) > 1 : false;
    const pointer = `${match.pointer}/distribution/${index}`;
    pointers.push(evidencePointer({
      evidenceId: catalogEvidenceId,
      captureSha256: catalogCapture.sha256,
      pointer,
      locator: url,
    }));
    if (repeated) {
      alternatives.push({
        state: "ambiguous",
        release_id: null,
        distribution_id: null,
        reason_codes: ["ambiguous_distribution_url"],
        evidence_ids: [catalogEvidenceId],
        evidence_pointers: [evidencePointer({
          evidenceId: catalogEvidenceId,
          captureSha256: catalogCapture.sha256,
          pointer,
          locator: url,
        })],
      });
    }
    const contentSha256 = distribution.content_sha256 ?? distribution.sha256 ?? null;
    distributionInputs.push({
      distribution_kind: distribution.distribution_kind
        ?? (distribution.downloadURL ? "download" : distribution.accessURL ? "api" : "unknown"),
      format: distribution.format ?? distribution.mediaType ?? "unknown",
      media_type: distribution.mediaType ?? distribution.media_type ?? null,
      locator: {
        kind: locatorKindFor(distribution, { rolling, repeated }),
        url: url ?? catalogCapture.url ?? "https://invalid.example/missing-distribution-locator",
        evidence_ids: [catalogEvidenceId],
      },
      content_sha256: contentSha256,
      publisher_identifiers: distribution.identifier ? [{
        source_id: resolvedSourceId,
        namespace: "publisher.distribution",
        value: distribution.identifier,
        entity_scope: "distribution",
        uniqueness_policy: "source_scoped",
        evidence_ids: [catalogEvidenceId],
      }] : [],
      evidence_ids: [catalogEvidenceId],
      resources_url: resourcesUrl(distribution),
      catalog_pointer: pointer,
    });
  }

  if (resourcesCapture) {
    const resourcesOk = requireCapture(resourcesCapture, "resources");
    const expectedResourcesUrl = distributionInputs.map((item) => item.resources_url).find(Boolean) ?? null;
    const observedResourcesUrl = resourcesCapture.data?.links?.self?.href ?? resourcesCapture.url ?? null;
    const resourcesEvidenceId = resourcesCapture.evidence_id ?? `evidence:resources:${resourcesCapture.sha256.slice(0, 24)}`;
    if (!resourcesOk.ok) {
      reasons.push(resourcesOk.reason);
    } else if (!expectedResourcesUrl) {
      reasons.push("resources_link_required");
      alternatives.push({
        state: "unresolved",
        release_id: null,
        distribution_id: null,
        reason_codes: ["resources_link_required", "unrelated_resources_capture"],
        evidence_ids: [resourcesEvidenceId],
        evidence_pointers: [evidencePointer({
          evidenceId: resourcesEvidenceId,
          captureSha256: resourcesCapture.sha256,
          pointer: "/links/self/href",
          locator: observedResourcesUrl,
        })],
      });
    } else if (observedResourcesUrl !== expectedResourcesUrl) {
      reasons.push("resources_self_identity_mismatch");
      alternatives.push({
        state: "unresolved",
        release_id: null,
        distribution_id: null,
        reason_codes: ["resources_self_identity_mismatch"],
        evidence_ids: [resourcesEvidenceId],
        evidence_pointers: [evidencePointer({
          evidenceId: resourcesEvidenceId,
          captureSha256: resourcesCapture.sha256,
          pointer: "/links/self/href",
          locator: observedResourcesUrl,
        })],
      });
    } else if (Array.isArray(resourcesCapture.data?.data)) {
      for (const [index, resource] of resourcesCapture.data.data.entries()) {
        const url = resource.downloadURL ?? resource.url ?? null;
        pointers.push(evidencePointer({
          evidenceId: resourcesEvidenceId,
          captureSha256: resourcesCapture.sha256,
          pointer: `/data/${index}`,
          locator: url,
        }));
        distributionInputs.push({
          distribution_kind: resource.distribution_kind ?? "document",
          format: resource.format ?? (/\.pdf$/i.test(url ?? "") ? "PDF" : resource.name ?? "unknown"),
          media_type: resource.mediaType ?? resource.media_type ?? null,
          locator: {
            kind: resource.replacement_of ? "replacement" : (rolling ? "rolling_current" : "exact_distribution"),
            url: url ?? resourcesCapture.url ?? "https://invalid.example/missing-resource-locator",
            evidence_ids: [resourcesEvidenceId],
          },
          content_sha256: resource.content_sha256 ?? resource.sha256 ?? null,
          replacement_of: resource.replacement_of ?? null,
          evidence_ids: [resourcesEvidenceId],
        });
      }
    } else {
      reasons.push("resources_shape_unresolved");
    }
  }

  const publisherIdentifiers = [{
    source_id: resolvedSourceId,
    namespace: match.kind === "socrata_view" ? "data.cdc.gov.view" : "publisher.catalog.identifier",
    value: nativeId,
    entity_scope: "asset",
    uniqueness_policy: rolling ? "reusable_over_time" : "source_scoped",
    evidence_ids: [catalogEvidenceId],
  }];
  const catalogVintage = match.row?.c_vintage ?? match.row?.vintage ?? null;
  const publisherReleaseId = match.row?.publisher_release_id ?? null;
  if (publisherReleaseId && !rolling) {
    publisherIdentifiers.push({
      source_id: resolvedSourceId,
      namespace: "publisher.release",
      value: String(publisherReleaseId),
      entity_scope: "release",
      uniqueness_policy: "source_scoped",
      evidence_ids: [catalogEvidenceId],
    });
  }
  const editionContext = catalogVintage ?? match.row?.publisher_version ?? match.row?.version ?? null;

  const landingUrl = record?.authoritative_url ?? record?.identity?.match_fields?.canonical_url ?? catalogCapture.url;
  const releaseIdentity = mintReleaseIdentity({
    asset_id: assetId,
    preserve_asset_id: assetId,
    source_id: resolvedSourceId,
    publisher_identifiers: publisherIdentifiers,
    locator: {
      kind: rolling ? "rolling_current" : (catalogDistributions.length ? "landing_page" : "unknown"),
      url: landingUrl ?? catalogCapture.url,
      evidence_ids: [catalogEvidenceId],
    },
    date_roles: dateRolesFromCatalogRow(match.row, catalogEvidenceId),
    publisher_version: rolling ? null : editionContext,
    release_kind: rolling ? "rolling_current" : (editionContext ? "vintage" : undefined),
    content_sha256: match.row?.content_sha256 ?? match.row?.sha256 ?? null,
    distributions: distributionInputs.map((item) => ({
      distribution_kind: item.distribution_kind,
      format: item.format,
      media_type: item.media_type,
      locator: item.locator,
      content_sha256: item.content_sha256,
      publisher_identifiers: item.publisher_identifiers,
      replacement_of: item.replacement_of,
      evidence_ids: item.evidence_ids,
    })),
    evidence_ids: [catalogEvidenceId],
    evidence_pointers: pointers,
    observed_at: observedAt,
  });

  const exactDistributions = releaseIdentity.distributions.filter((item) => item.identity_state === "exact" && item.distribution_id);
  const ambiguousDistributions = releaseIdentity.distributions.filter((item) => item.identity_state === "ambiguous");
  let bindingState = releaseIdentity.identity_state;
  if (bindingState === "exact" && exactDistributions.length > 1) bindingState = "one_to_many";
  if (bindingState === "unresolved" && exactDistributions.length > 1) bindingState = "one_to_many";
  if (ambiguousDistributions.length > 0 && exactDistributions.length === 0 && releaseIdentity.identity_state !== "rolling") {
    bindingState = "ambiguous";
    reasons.push("ambiguous_distribution_url");
  }
  if (releaseIdentity.identity_state === "exact" && exactDistributions.length === 1 && catalogDistributions.length <= 1 && !resourcesCapture) {
    bindingState = "exact";
  }
  if (exactDistributions.length > 1) {
    bindingState = bindingState === "rolling" ? "rolling" : "one_to_many";
  }

  reasons.push(...releaseIdentity.reason_codes);
  assert(releaseIdentity.asset_id === assetId, "Existing stable IDs cannot change meaning", "stable_id_rewritten");
  assert(bindingState !== "exact" || releaseIdentity.release_id != null, "Exact binding requires a minted release ID", "fabricated_exact_binding");
  if (bindingState === "ambiguous") {
    assert(releaseIdentity.release_id == null || ambiguousDistributions.length > 0, "Ambiguous URL cannot fabricate an exact release", "url_only_exact_binding_forbidden");
  }

  return deepFreeze({
    schema_version: RELEASE_BINDING_VERSION,
    binding_state: bindingState,
    asset_id: assetId,
    source_id: resolvedSourceId,
    source_native_id: nativeId,
    release_identity: releaseIdentity,
    releases: releaseIdentity.release_id ? [releaseIdentity.release_id] : [],
    distributions: clone(releaseIdentity.distributions),
    alternatives,
    evidence_pointers: pointers,
    reason_codes: uniqueSorted(reasons),
    fabricated_exact_binding: false,
    boundaries: {
      existing_stable_id_rewritten: false,
      url_alone_is_exact_release: false,
      catalog_membership_is_payload_access: false,
      scientific_fitness_claimed: false,
    },
  });
}
