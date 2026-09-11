import { bindCapturedCatalogRecord } from "../identity/src/release-binding.mjs";
import { assertPublicationReadContext } from "./publication-read-context.mjs";

export const RELEASE_CATALOG_VERSION = "ushso-release-distribution-catalog.v1.0.0";

function freezeRecord(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeRecord(child);
  return Object.freeze(value);
}

/**
 * Catalog-facing release/distribution resolver. Reuses identity binding rules
 * and the existing publication read context. It does not invent exact IDs from
 * a URL, does not merge one-to-many distributions, and does not rewrite
 * existing observatory asset IDs.
 */
export function resolveReleaseDistributions({
  publication,
  record,
  catalogCapture = null,
  resourcesCapture = null,
  observedAt = null,
}) {
  assertPublicationReadContext(publication);
  const binding = bindCapturedCatalogRecord({
    record,
    catalogCapture,
    resourcesCapture,
    observedAt: observedAt ?? publication.canonical_as_of ?? record?.freshness_verification?.metadata_observed_at,
  });
  return freezeRecord({
    catalog_version: RELEASE_CATALOG_VERSION,
    publication,
    asset_id: binding.asset_id,
    binding_state: binding.binding_state,
    releases: binding.releases,
    distributions: binding.distributions,
    alternatives: binding.alternatives,
    evidence_pointers: binding.evidence_pointers,
    reason_codes: binding.reason_codes,
    binding,
    boundaries: {
      ...binding.boundaries,
      publication_context_required: true,
      unresolved_schema_applicability_is_not_approval: true,
    },
  });
}

export function listDistinctDistributions(result) {
  return (result?.distributions ?? []).filter((item) => item.distribution_id);
}
