import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  CURRENT_LIVE_GENERATION,
  CURRENT_LIVE_MANIFEST_SHA256,
  bindCapturedCatalogRecord,
  compareReplacementIdentities,
  createGenerationIdentityMap,
  live20260903GenerationMap,
  lookupProductContext,
  mintDistributionIdentity,
  mintReleaseIdentity,
} from "../../packages/identity/src/index.mjs";
import { createStaticPublicationReadContext } from "../../packages/registry/publication-read-context.mjs";
import { lookupMappedProductContext } from "../../packages/registry/generation-identity.mjs";
import { resolveReleaseDistributions } from "../../packages/registry/release-catalog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OBSERVED_AT = "2026-09-03T22:22:33.908Z";
const STABLE_ASSET_ID = "obs:asset:cms-data-catalog:hcris-hospital-cost-report";
const schema = JSON.parse(await fs.readFile(path.join(ROOT, "packages/identity/schemas/release-identity.schema.json"), "utf8"));
const generationSchema = JSON.parse(await fs.readFile(path.join(ROOT, "packages/identity/schemas/generation-identity.schema.json"), "utf8"));
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addFormat("date-time", (value) => typeof value === "string" && Number.isFinite(Date.parse(value)));
ajv.addFormat("date", (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
const validateSchema = ajv.compile(schema);
const validateGenerationSchema = ajv.compile(generationSchema);

function evidence(id = "evidence:release-identity.fixture") {
  return [id];
}

function publisherAsset(overrides = {}) {
  return {
    source_id: "urn:ushso:source:cms-data-catalog",
    namespace: "data.cms.gov.dataset",
    value: "4999da74-1d8d-4a6f-934e-2d7ea470cc63",
    entity_scope: "asset",
    uniqueness_policy: "source_scoped",
    evidence_ids: evidence(),
    ...overrides,
  };
}

function assertSchema(value) {
  assert.equal(validateSchema(value), true, JSON.stringify(validateSchema.errors, null, 2));
}

test("C-007-1 rolling endpoints do not mint an exact release from a URL", () => {
  const identity = mintReleaseIdentity({
    asset_id: "obs:asset:cdc-socrata:235m-gsry-94053d5d5c02689f",
    source_id: "urn:ushso:source:cdc-socrata",
    publisher_identifiers: [{
      source_id: "urn:ushso:source:cdc-socrata",
      namespace: "data.cdc.gov.view",
      value: "235m-gsry",
      entity_scope: "asset",
      uniqueness_policy: "reusable_over_time",
      evidence_ids: evidence("evidence:cdc-rolling"),
    }],
    locator: {
      kind: "rolling_current",
      url: "https://data.cdc.gov/resource/235m-gsry.json",
      evidence_ids: evidence("evidence:cdc-rolling"),
    },
    date_roles: [{
      role: "metadata_observed_at",
      value: OBSERVED_AT,
      evidence_ids: evidence("evidence:cdc-rolling"),
    }],
    release_kind: "rolling_current",
    evidence_ids: evidence("evidence:cdc-rolling"),
    observed_at: OBSERVED_AT,
  });
  assertSchema(identity);
  assert.equal(identity.identity_state, "rolling");
  assert.equal(identity.release_id, null);
  assert.equal(identity.identity_rule, null);
  assert.equal(identity.asset_id, "obs:asset:cdc-socrata:235m-gsry-94053d5d5c02689f");
  assert.ok(identity.reason_codes.includes("rolling_endpoint_not_exact"));
  assert.equal(identity.boundaries.url_alone_is_exact_release, false);
});

test("C-007-1 hash-scoped identity is used when a publisher supplies no stable release ID", () => {
  const content = "sha256:" + "ab".repeat(32);
  const identity = mintReleaseIdentity({
    asset_id: STABLE_ASSET_ID,
    source_id: "urn:ushso:source:cms-data-catalog",
    publisher_identifiers: [publisherAsset()],
    locator: {
      kind: "exact_distribution",
      url: "https://data.cms.gov/data-api/v1/dataset/4999da74-1d8d-4a6f-934e-2d7ea470cc63/data",
      evidence_ids: evidence(),
    },
    date_roles: [{
      role: "publisher_released_at",
      value: "2024-08-01T00:00:00.000Z",
      evidence_ids: evidence(),
    }],
    content_sha256: content,
    evidence_ids: evidence(),
    observed_at: OBSERVED_AT,
  });
  assertSchema(identity);
  assert.equal(identity.identity_state, "exact");
  assert.equal(identity.identity_rule, "hash_scoped_content_identity");
  assert.match(identity.release_id, /^urn:ushso:release:hash\.[a-f0-9]{32}$/);
  assert.equal(identity.asset_id, STABLE_ASSET_ID);
});

test("C-007-1 publisher stable release IDs are preserved and do not rewrite existing asset IDs", () => {
  const identity = mintReleaseIdentity({
    asset_id: STABLE_ASSET_ID,
    preserve_asset_id: STABLE_ASSET_ID,
    source_id: "urn:ushso:source:cms-data-catalog",
    publisher_identifiers: [
      publisherAsset(),
      {
        source_id: "urn:ushso:source:cms-data-catalog",
        namespace: "data.cms.gov.release",
        value: "hcris-2024-q4",
        entity_scope: "release",
        uniqueness_policy: "source_scoped",
        evidence_ids: evidence(),
      },
    ],
    locator: {
      kind: "exact_distribution",
      url: "https://data.cms.gov/data-api/v1/dataset/4999da74-1d8d-4a6f-934e-2d7ea470cc63/data",
      evidence_ids: evidence(),
    },
    publisher_version: "2024-Q4",
    release_kind: "vintage",
    evidence_ids: evidence(),
    observed_at: OBSERVED_AT,
  });
  assertSchema(identity);
  assert.equal(identity.identity_state, "exact");
  assert.equal(identity.identity_rule, "publisher_stable_release_id");
  assert.equal(identity.asset_id, STABLE_ASSET_ID);
  assert.match(identity.release_id, /^urn:ushso:release:pub\./);
  assert.throws(
    () => mintReleaseIdentity({
      asset_id: STABLE_ASSET_ID,
      preserve_asset_id: "obs:asset:rewritten",
      source_id: "urn:ushso:source:cms-data-catalog",
      publisher_identifiers: [publisherAsset()],
      locator: { kind: "landing_page", url: "https://data.cms.gov/example", evidence_ids: evidence() },
      evidence_ids: evidence(),
      observed_at: OBSERVED_AT,
    }),
    { code: "stable_id_rewritten" },
  );
});

test("C-007-1 replacement files remain distinct identities", () => {
  const locator = {
    kind: "exact_distribution",
    url: "https://data.cms.gov/sites/default/files/hcris-dictionary.pdf",
    evidence_ids: evidence("evidence:replacement"),
  };
  const previous = mintReleaseIdentity({
    asset_id: STABLE_ASSET_ID,
    source_id: "urn:ushso:source:cms-data-catalog",
    publisher_identifiers: [publisherAsset()],
    locator,
    content_sha256: "11".repeat(32),
    evidence_ids: evidence("evidence:replacement"),
    observed_at: "2026-01-01T00:00:00.000Z",
  });
  const current = mintReleaseIdentity({
    asset_id: STABLE_ASSET_ID,
    source_id: "urn:ushso:source:cms-data-catalog",
    publisher_identifiers: [publisherAsset()],
    locator: { ...locator, kind: "replacement" },
    content_sha256: "22".repeat(32),
    replacement_of: previous.release_id,
    evidence_ids: evidence("evidence:replacement"),
    observed_at: OBSERVED_AT,
  });
  assertSchema(previous);
  assertSchema(current);
  assert.notEqual(previous.release_id, current.release_id);
  assert.equal(previous.asset_id, current.asset_id);
  assert.equal(current.identity_state, "replaced");
  const comparison = compareReplacementIdentities(previous, current);
  assert.equal(comparison.identity_equality, false);
  assert.equal(comparison.merged, false);
  assert.equal(comparison.relationship, "successor_of");
});

test("C-007-1 multiple distributions remain distinct and are not merged", () => {
  const identity = mintReleaseIdentity({
    asset_id: STABLE_ASSET_ID,
    source_id: "urn:ushso:source:cms-data-catalog",
    publisher_identifiers: [
      publisherAsset(),
      {
        source_id: "urn:ushso:source:cms-data-catalog",
        namespace: "data.cms.gov.release",
        value: "hcris-2024",
        entity_scope: "release",
        uniqueness_policy: "source_scoped",
        evidence_ids: evidence(),
      },
    ],
    locator: {
      kind: "landing_page",
      url: "https://data.cms.gov/dataset/hospital-cost-report",
      evidence_ids: evidence(),
    },
    publisher_version: "2024",
    distributions: [
      {
        distribution_kind: "api",
        format: "JSON",
        media_type: "application/json",
        locator: {
          kind: "exact_distribution",
          url: "https://data.cms.gov/data-api/v1/dataset/4999da74-1d8d-4a6f-934e-2d7ea470cc63/data",
          evidence_ids: evidence("evidence:api"),
        },
        content_sha256: "aa".repeat(32),
        evidence_ids: evidence("evidence:api"),
      },
      {
        distribution_kind: "download",
        format: "CSV",
        media_type: "text/csv",
        locator: {
          kind: "exact_distribution",
          url: "https://data.cms.gov/sites/default/files/hcris-2024.csv",
          evidence_ids: evidence("evidence:csv"),
        },
        content_sha256: "bb".repeat(32),
        evidence_ids: evidence("evidence:csv"),
      },
      {
        distribution_kind: "document",
        format: "PDF",
        media_type: "application/pdf",
        locator: {
          kind: "exact_distribution",
          url: "https://data.cms.gov/sites/default/files/hcris-dictionary.pdf",
          evidence_ids: evidence("evidence:pdf"),
        },
        content_sha256: "cc".repeat(32),
        evidence_ids: evidence("evidence:pdf"),
      },
    ],
    evidence_ids: evidence(),
    observed_at: OBSERVED_AT,
  });
  assertSchema(identity);
  assert.equal(identity.distributions.length, 3);
  const ids = identity.distributions.map((item) => item.distribution_id);
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.every((id) => id && id.startsWith("urn:ushso:distribution:")));
  assert.deepEqual(identity.distributions.map((item) => item.format), ["JSON", "CSV", "PDF"]);
});

test("C-007-1 conflicting date roles stay distinct and are not merged", () => {
  const identity = mintReleaseIdentity({
    asset_id: STABLE_ASSET_ID,
    source_id: "urn:ushso:source:cms-data-catalog",
    publisher_identifiers: [
      publisherAsset(),
      {
        source_id: "urn:ushso:source:cms-data-catalog",
        namespace: "data.cms.gov.release",
        value: "hcris-2023",
        entity_scope: "release",
        uniqueness_policy: "source_scoped",
        evidence_ids: evidence(),
      },
    ],
    locator: {
      kind: "exact_distribution",
      url: "https://data.cms.gov/data-api/v1/dataset/4999da74-1d8d-4a6f-934e-2d7ea470cc63/data",
      evidence_ids: evidence(),
    },
    publisher_version: "2023",
    date_roles: [
      { role: "catalog_issued", value: "2023-01-15", evidence_ids: evidence("evidence:issued") },
      { role: "catalog_modified", value: "2024-06-01", evidence_ids: evidence("evidence:modified") },
      { role: "vintage", value: "2023", evidence_ids: evidence("evidence:vintage") },
      { role: "observation_period_start", value: "2022-10-01", evidence_ids: evidence("evidence:coverage") },
      { role: "observation_period_end", value: "2023-09-30", evidence_ids: evidence("evidence:coverage") },
      { role: "publisher_released_at", value: "2023-12-01T00:00:00.000Z", evidence_ids: evidence("evidence:released") },
      { role: "revision_at", value: "2024-02-01T00:00:00.000Z", evidence_ids: evidence("evidence:revision") },
      { role: "catalog_modified", value: "2025-01-01", evidence_ids: evidence("evidence:modified-conflict") },
    ],
    evidence_ids: evidence(),
    observed_at: OBSERVED_AT,
  });
  assertSchema(identity);
  const byRole = Object.fromEntries(identity.date_roles.map((role) => [role.role, role]));
  assert.equal(byRole.catalog_issued.value, "2023-01-15");
  assert.equal(byRole.vintage.value, "2023");
  assert.equal(byRole.catalog_modified.value_state, "conflicted");
  assert.equal(byRole.catalog_modified.value, null);
  assert.notEqual(byRole.catalog_issued.value, byRole.catalog_modified.value);
  assert.equal(identity.identity_state, "conflicted");
  assert.ok(identity.reason_codes.includes("date_role_conflict"));
  assert.equal(identity.boundaries.date_roles_merged, false);
  assert.throws(
    () => mintReleaseIdentity({
      asset_id: STABLE_ASSET_ID,
      source_id: "urn:ushso:source:cms-data-catalog",
      publisher_identifiers: [publisherAsset()],
      locator: { kind: "landing_page", url: "https://data.cms.gov/example", evidence_ids: evidence() },
      date_roles: [{ role: "vintage", value: "2023", merged_date: "2023-01-15", evidence_ids: evidence() }],
      evidence_ids: evidence(),
      observed_at: OBSERVED_AT,
    }),
    { code: "date_roles_merged" },
  );
});

test("C-007-1 a landing-page URL without content or a stable release ID stays unresolved", () => {
  const identity = mintReleaseIdentity({
    asset_id: STABLE_ASSET_ID,
    source_id: "urn:ushso:source:cms-data-catalog",
    publisher_identifiers: [publisherAsset()],
    locator: {
      kind: "landing_page",
      url: "https://data.cms.gov/dataset/hospital-cost-report",
      evidence_ids: evidence(),
    },
    evidence_ids: evidence(),
    observed_at: OBSERVED_AT,
  });
  assertSchema(identity);
  assert.equal(identity.identity_state, "unresolved");
  assert.equal(identity.release_id, null);
  assert.ok(identity.reason_codes.includes("url_alone_is_not_exact_release"));
  const distribution = mintDistributionIdentity({
    distribution_kind: "api",
    format: "JSON",
    locator: {
      kind: "ambiguous",
      url: "https://data.cms.gov/data.json",
      evidence_ids: evidence("evidence:catalog-root"),
    },
    repeated_urls: ["https://data.cms.gov/data.json", "https://data.cms.gov/data.json"],
    evidence_ids: evidence("evidence:catalog-root"),
  });
  assert.equal(distribution.identity_state, "ambiguous");
  assert.equal(distribution.distribution_id, null);
});

const captures = JSON.parse(await fs.readFile(path.join(ROOT, "verification/research-program/pr-007/fixtures/catalog-resources.captures.json"), "utf8"));

function fixturePublication() {
  return createStaticPublicationReadContext({
    corpus_id: "ushso-pr007-release-binding-fixture",
    corpus_version: "test",
    manifest_sha256: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  });
}

test("C-007-2 one-to-many publisher distributions remain distinct", () => {
  const binding = bindCapturedCatalogRecord({
    record: captures.cms_record,
    catalogCapture: captures.cms_catalog,
    resourcesCapture: captures.cms_resources,
    observedAt: captures.observed_at,
  });
  assert.equal(binding.asset_id, captures.cms_record.record_id);
  assert.equal(binding.binding_state, "one_to_many");
  assert.equal(binding.fabricated_exact_binding, false);
  const distributionIds = binding.distributions.map((item) => item.distribution_id).filter(Boolean);
  assert.ok(distributionIds.length >= 3);
  assert.equal(new Set(distributionIds).size, distributionIds.length);
  assert.ok(binding.distributions.some((item) => item.format === "API" || item.distribution_kind === "api"));
  assert.ok(binding.distributions.some((item) => item.format === "CSV"));
  assert.ok(binding.distributions.some((item) => item.identity_state === "replaced"));
  assert.ok(binding.evidence_pointers.some((item) => item.pointer.includes("/distribution/")));
  assert.ok(binding.evidence_pointers.some((item) => item.pointer.startsWith("/data/")));
  const resolved = resolveReleaseDistributions({
    publication: fixturePublication(),
    record: captures.cms_record,
    catalogCapture: captures.cms_catalog,
    resourcesCapture: captures.cms_resources,
    observedAt: captures.observed_at,
  });
  assert.equal(resolved.binding_state, "one_to_many");
  assert.equal(resolved.asset_id, captures.cms_record.record_id);
  assert.equal(resolved.publication.corpus.corpus_id, "ushso-pr007-release-binding-fixture");
});

test("C-007-2 an ambiguous URL never produces a fabricated exact binding", () => {
  const urlOnly = bindCapturedCatalogRecord({
    record: captures.cms_record,
    catalogCapture: null,
    observedAt: captures.observed_at,
  });
  assert.equal(urlOnly.binding_state, "unresolved");
  assert.deepEqual(urlOnly.releases, []);
  assert.ok(urlOnly.reason_codes.includes("url_alone_is_not_exact_release"));
  assert.equal(urlOnly.fabricated_exact_binding, false);

  const shared = bindCapturedCatalogRecord({
    record: {
      record_id: "obs:asset:cms-data-catalog:shared-one",
      identity: {
        asset: { asset_id: "obs:asset:cms-data-catalog:shared-one", version_state: "edition" },
        match_fields: { source_id: "asset-one", canonical_url: "https://data.cms.gov/shared-endpoint" },
        source: { source_id: "cms-data-catalog" },
      },
    },
    catalogCapture: captures.ambiguous_catalog,
    observedAt: captures.observed_at,
  });
  assert.equal(shared.binding_state, "ambiguous");
  assert.ok(shared.distributions.every((item) => item.distribution_id == null));
  assert.ok(shared.alternatives.length >= 1);
  assert.ok(shared.alternatives.every((item) => item.evidence_pointers?.length));

  const duplicateIdentifier = structuredClone(captures.cms_catalog);
  duplicateIdentifier.data.dataset.push({
    identifier: captures.cms_record.identity.match_fields.source_id,
    distribution: [{ accessURL: "https://data.cms.gov/other", format: "API" }],
  });
  const ambiguousId = bindCapturedCatalogRecord({
    record: captures.cms_record,
    catalogCapture: duplicateIdentifier,
    observedAt: captures.observed_at,
  });
  assert.equal(ambiguousId.binding_state, "ambiguous");
  assert.deepEqual(ambiguousId.releases, []);
  assert.ok(ambiguousId.alternatives.length >= 2);
});

test("C-007-2 rolling catalog resources stay rolling and keep the existing asset ID", () => {
  const binding = bindCapturedCatalogRecord({
    record: captures.cdc_record,
    catalogCapture: captures.cdc_catalog,
    observedAt: captures.observed_at,
  });
  assert.equal(binding.binding_state, "rolling");
  assert.equal(binding.asset_id, captures.cdc_record.record_id);
  assert.deepEqual(binding.releases, []);
  assert.ok(binding.reason_codes.includes("rolling_endpoint_not_exact"));
});

test("C-007-3 human-to-machine source lookup returns the same product context", () => {
  const map = live20260903GenerationMap();
  assert.equal(validateGenerationSchema(map), true, JSON.stringify(validateGenerationSchema.errors, null, 2));
  assert.equal(map.human_manifest.value, CURRENT_LIVE_MANIFEST_SHA256);
  assert.equal(map.machine_generation.value, CURRENT_LIVE_GENERATION);
  assert.equal(map.record_count, 3434);
  assert.equal(map.searchable_count, 3430);
  assert.equal(map.isolated_count, 4);
  assert.equal(map.dictionary_source_revision.scientific_approval, false);
  assert.equal(map.dictionary_source_revision.applicability_state, "unresolved");
  const binding = bindCapturedCatalogRecord({
    record: captures.cms_record,
    catalogCapture: captures.cms_catalog,
    observedAt: captures.observed_at,
  });
  const human = lookupProductContext({ map, pin: CURRENT_LIVE_MANIFEST_SHA256, pin_kind: "corpus_manifest_sha256", record: captures.cms_record, binding });
  const machine = lookupProductContext({ map, pin: CURRENT_LIVE_GENERATION, pin_kind: "publication_generation_label", record: captures.cms_record, binding });
  assert.equal(human.restart_required, false);
  assert.equal(machine.restart_required, false);
  assert.equal(human.product_context_fingerprint, machine.product_context_fingerprint);
  assert.equal(human.asset_id, captures.cms_record.record_id);
  assert.equal(human.generation, CURRENT_LIVE_GENERATION);
  const publication = createStaticPublicationReadContext({
    corpus_id: "ushso-live-catalog-2026-09-03",
    corpus_version: "1.2.0",
    manifest_sha256: CURRENT_LIVE_MANIFEST_SHA256,
  });
  const mapped = lookupMappedProductContext({
    publication,
    map,
    record: captures.cms_record,
    binding,
  });
  assert.equal(mapped.lookup.restart_required, false);
  assert.equal(mapped.lookup.product_context_fingerprint, human.product_context_fingerprint);
});

test("C-007-3 stale or mismatched pins yield typed restart guidance", () => {
  const map = live20260903GenerationMap();
  const staleHuman = lookupProductContext({
    map,
    pin: "23f704ce3e421a6eb26c2b3677d616a1ae6b4f45226233257b9a1ff676caba2b",
    pin_kind: "corpus_manifest_sha256",
    record: captures.cms_record,
  });
  assert.equal(staleHuman.restart_required, true);
  assert.equal(staleHuman.code, "manifest_mismatch");
  assert.equal(staleHuman.next_action.includes("Restart"), true);

  const staleMachine = lookupProductContext({
    map,
    pin: "live-2026-08-01-deadbeef",
    pin_kind: "publication_generation_label",
    record: captures.cms_record,
  });
  assert.equal(staleMachine.restart_required, true);
  assert.equal(staleMachine.code, "generation_unavailable");

  const mismatched = lookupProductContext({
    map,
    record: captures.cms_record,
    pins: {
      human_manifest: CURRENT_LIVE_MANIFEST_SHA256,
      machine_generation: "legacy-static:1.1.0",
    },
  });
  assert.equal(mismatched.restart_required, true);
  assert.equal(mismatched.code, "cross_generation_reference");

  const dictionary = lookupProductContext({
    map,
    record: captures.cms_record,
    pins: { dictionary_source_revision: "dictionary-revision-from-another-generation" },
  });
  assert.equal(dictionary.restart_required, true);
  assert.equal(dictionary.code, "dictionary_revision_mismatch");

  assert.throws(
    () => createGenerationIdentityMap({
      ...map,
      dictionary_source_revision: {
        ...map.dictionary_source_revision,
        generation: "live-other",
      },
    }),
    { code: "cross_generation_reference" },
  );
  assert.throws(
    () => createGenerationIdentityMap({
      ...map,
      dictionary_source_revision: {
        ...map.dictionary_source_revision,
        scientific_approval: true,
      },
    }),
    { code: "scientific_approval_forbidden" },
  );

  const publication = createStaticPublicationReadContext({
    corpus_id: "ushso-pr007-release-binding-fixture",
    corpus_version: "test",
    manifest_sha256: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  });
  const mapped = lookupMappedProductContext({
    publication,
    map,
    record: captures.cms_record,
  });
  assert.equal(mapped.restart_required, true);
  assert.equal(mapped.code, "manifest_mismatch");
});
