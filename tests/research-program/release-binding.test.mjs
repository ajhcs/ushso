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
  createPublisherIdentifier,
  live20260903GenerationMap,
  lookupProductContext,
  mintDistributionIdentity,
  mintReleaseIdentity,
  nativeIdentifierConformsToCore,
  projectCoreReleaseDecision,
} from "../../packages/identity/src/index.mjs";
import { fingerprintTruthRevision } from "../../contracts/core/v2.0.0/tools/common.mjs";
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
  const modified = identity.date_roles.filter((role) => role.role === "catalog_modified");
  assert.equal(byRole.catalog_issued.value, "2023-01-15");
  assert.equal(byRole.vintage.value, "2023");
  assert.equal(modified.length, 2);
  assert.ok(modified.every((role) => role.value_state === "conflicted"));
  assert.ok(modified.some((role) => role.value === "2024-06-01"));
  assert.ok(modified.some((role) => role.value === "2025-01-01"));
  assert.notEqual(byRole.catalog_issued.value, "2024-06-01");
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
  assert.equal(map.dictionary_source_revision.kind, "unresolved");
  assert.equal(map.dictionary_source_revision.value, "unresolved");
  assert.notEqual(map.dictionary_source_revision.value, CURRENT_LIVE_GENERATION);
  assert.ok(map.cited_generation_evidence.some((item) => item.role === "human_manifest" && item.value === CURRENT_LIVE_MANIFEST_SHA256));
  assert.ok(map.cited_generation_evidence.some((item) => item.role === "dictionary_source_revision" && item.state === "unresolved"));
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

function controllerReleaseInput(value, namespace = "publisher.release") {
  return {
    asset_id: "obs:asset:controller-example",
    source_id: "urn:ushso:source:controller",
    publisher_identifiers: [{
      source_id: "urn:ushso:source:controller",
      namespace,
      value,
      entity_scope: "release",
      uniqueness_policy: "source_scoped",
      evidence_ids: evidence("evidence:controller:identity"),
    }],
    locator: {
      kind: "exact_distribution",
      url: "https://example.org/data.csv",
      evidence_ids: evidence("evidence:controller:identity"),
    },
    publisher_version: "2026",
    release_kind: "vintage",
    evidence_ids: evidence("evidence:controller:identity"),
    observed_at: OBSERVED_AT,
  };
}

test("R007-1 qualified publisher release identifiers keep namespace, punctuation, and long suffixes distinct", () => {
  const slash = mintReleaseIdentity(controllerReleaseInput("edition/1"));
  const colon = mintReleaseIdentity(controllerReleaseInput("edition:1"));
  assert.notEqual(slash.release_id, colon.release_id);
  assert.equal(slash.publisher_identifiers[0].value, "edition/1");
  assert.equal(colon.publisher_identifiers[0].value, "edition:1");

  const publisherNs = mintReleaseIdentity(controllerReleaseInput("edition-1", "publisher.release"));
  const archiveNs = mintReleaseIdentity(controllerReleaseInput("edition-1", "archive.release"));
  assert.notEqual(publisherNs.release_id, archiveNs.release_id);

  const longA = mintReleaseIdentity(controllerReleaseInput(`${"a".repeat(200)}1`));
  const longB = mintReleaseIdentity(controllerReleaseInput(`${"a".repeat(200)}2`));
  assert.notEqual(longA.release_id, longB.release_id);
  assert.match(longA.release_id, /^urn:ushso:release:/);
  assert.match(longB.release_id, /^urn:ushso:release:/);
});

test("R007-1 a reusable-over-time distribution identifier does not bind two releases to one ID", () => {
  const publisher = createPublisherIdentifier({
    source_id: "urn:ushso:source:controller",
    namespace: "publisher.distribution",
    value: "download",
    entity_scope: "distribution",
    uniqueness_policy: "reusable_over_time",
    evidence_ids: evidence("evidence:controller:identity"),
  });
  const base = {
    format: "CSV",
    distribution_kind: "download",
    locator: {
      kind: "exact_distribution",
      url: "https://example.org/data.csv",
      evidence_ids: evidence("evidence:controller:identity"),
    },
    publisher_identifiers: [publisher],
    evidence_ids: evidence("evidence:controller:identity"),
  };
  const first = mintDistributionIdentity({ ...base, content_sha256: "a".repeat(64) }, {
    releaseId: "urn:ushso:release:first",
    releaseState: "exact",
  });
  const second = mintDistributionIdentity({ ...base, content_sha256: "b".repeat(64) }, {
    releaseId: "urn:ushso:release:second",
    releaseState: "exact",
  });
  assert.notEqual(first.distribution_id, second.distribution_id);
  assert.equal(first.identity_rule, "hash_scoped_content_identity");
  assert.equal(second.identity_rule, "hash_scoped_content_identity");
});

test("C-007-1 reuses core v2 native-identifier contracts without fabricating unresolved core objects", async () => {
  const coreCommon = JSON.parse(await fs.readFile(path.join(ROOT, "contracts/core/v2.0.0/schemas/common.schema.json"), "utf8"));
  const coreAjv = new Ajv2020({ strict: false, allErrors: true });
  coreAjv.addFormat("date-time", (value) => typeof value === "string" && Number.isFinite(Date.parse(value)));
  coreAjv.addFormat("date", (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
  coreAjv.addSchema(coreCommon);
  const validateNative = coreAjv.compile({
    $ref: "https://ushso.org/contracts/core/v2.0.0/schemas/common.schema.json#/$defs/nativeIdentifier",
  });
  const bundle = JSON.parse(await fs.readFile(path.join(ROOT, "contracts/core/v2.0.0/bundle/valid-bundle.json"), "utf8"));
  const coreRelease = bundle.releases[0];
  const coreNative = coreRelease.native_identifiers[0];
  assert.equal(validateNative(coreNative), true, JSON.stringify(validateNative.errors, null, 2));

  const accepted = createPublisherIdentifier(coreNative);
  assert.equal(nativeIdentifierConformsToCore(accepted), true);
  assert.equal(validateNative(accepted), true, JSON.stringify(validateNative.errors, null, 2));

  const identity = mintReleaseIdentity({
    asset_id: coreRelease.asset_id,
    source_id: coreNative.source_id,
    publisher_identifiers: [coreNative],
    locator: {
      kind: "exact_distribution",
      url: "https://data.cms.gov/example-core-release",
      evidence_ids: coreNative.evidence_ids,
    },
    publisher_version: coreRelease.publisher_version,
    release_kind: coreRelease.release_kind,
    evidence_ids: coreNative.evidence_ids,
    observed_at: OBSERVED_AT,
  });
  assertSchema(identity);
  assert.equal(identity.identity_state, "exact");
  assert.equal(identity.identity_rule, "publisher_stable_release_id");
  assert.equal(nativeIdentifierConformsToCore(identity.publisher_identifiers[0]), true);

  const unresolved = mintReleaseIdentity({
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
  const projectedUnresolved = projectCoreReleaseDecision(unresolved);
  assert.equal(projectedUnresolved.projected, false);
  assert.equal(projectedUnresolved.core_object, null);
  assert.ok(projectedUnresolved.reason_codes.includes("unresolved_identity_is_not_a_core_release"));

  const projectedExactWithoutEnvelope = projectCoreReleaseDecision(identity);
  assert.equal(projectedExactWithoutEnvelope.projected, false);
  assert.equal(projectedExactWithoutEnvelope.core_object, null);
  assert.ok(projectedExactWithoutEnvelope.reason_codes.includes("exact_identity_without_core_envelope_is_not_fabricated"));

  const exactEnvelope = { ...coreRelease, release_id: identity.release_id, entity_id: identity.release_id };
  exactEnvelope.canonical_content_fingerprint = fingerprintTruthRevision(exactEnvelope);
  const projectedExact = projectCoreReleaseDecision(identity, { envelope: exactEnvelope });
  assert.equal(projectedExact.projected, true);
  assert.equal(projectedExact.core_object.entity_type, "Release");
  assert.equal(projectedExact.core_object.contract_version, "observatory-core.v2.0.0");
  assert.equal(projectedExact.core_object.release_id, identity.release_id);
  assert.equal(projectedExact.core_object.canonical_content_fingerprint, fingerprintTruthRevision(projectedExact.core_object));
});

test("R007-2 unsupported pins, foreign bindings, and stale publications restart", () => {
  const map = live20260903GenerationMap();
  const record = { record_id: "obs:asset:controller-example", source_id: "urn:ushso:source:controller", source_native_id: "product-1" };
  const unknownKind = lookupProductContext({
    map,
    record,
    pin: "old-unavailable-generation",
    pin_kind: "unsupported_kind",
  });
  assert.equal(unknownKind.restart_required, true);
  assert.equal(unknownKind.code, "unsupported_pin_kind");

  const foreign = lookupProductContext({
    map,
    record,
    pin: map.machine_generation.value,
    binding: {
      asset_id: "obs:asset:foreign",
      source_id: "urn:ushso:source:foreign",
      releases: ["urn:ushso:release:foreign"],
      distributions: [{ distribution_id: "urn:ushso:distribution:foreign", release_id: "urn:ushso:release:foreign" }],
    },
  });
  assert.equal(foreign.restart_required, true);
  assert.equal(foreign.code, "binding_ownership_mismatch");

  const publication = createStaticPublicationReadContext({
    corpus_id: "controller-old-corpus",
    corpus_version: "0.9.0",
    manifest_sha256: "b".repeat(64),
  });
  const mapped = lookupMappedProductContext({
    publication,
    map,
    record,
    pin: map.machine_generation.value,
  });
  assert.equal(mapped.restart_required, true);
  assert.equal(mapped.lookup, undefined);
});

test("R007-3 catalog vintage is not a global release ID and unrelated resources stay unjoined", () => {
  const first = bindCapturedCatalogRecord({
    record: captures.cms_record,
    catalogCapture: captures.cms_catalog,
  });
  const catalog = structuredClone(captures.cms_catalog);
  const otherRecord = structuredClone(captures.cms_record);
  otherRecord.record_id = "obs:asset:cms-data-catalog:other-product";
  otherRecord.identity.asset.asset_id = otherRecord.record_id;
  otherRecord.identity.match_fields.source_id = "controller-other-native-id";
  catalog.data.dataset[0].identifier = "controller-other-native-id";
  const second = bindCapturedCatalogRecord({
    record: otherRecord,
    catalogCapture: catalog,
  });
  assert.notEqual(first.releases[0], second.releases[0]);
  assert.equal(first.asset_id, captures.cms_record.record_id);
  assert.equal(second.asset_id, otherRecord.record_id);

  const unlinkedCatalog = structuredClone(captures.cms_catalog);
  for (const row of unlinkedCatalog.data.dataset) {
    for (const distribution of row.distribution ?? []) delete distribution.resourcesAPI;
  }
  const unrelated = structuredClone(captures.cms_resources);
  unrelated.data.links.self.href = "https://example.org/unrelated/resources";
  unrelated.data.data = [{ downloadURL: "https://example.org/unrelated.csv", format: "CSV", sha256: "d".repeat(64) }];
  const binding = bindCapturedCatalogRecord({
    record: captures.cms_record,
    catalogCapture: unlinkedCatalog,
    resourcesCapture: unrelated,
  });
  assert.equal(binding.distributions.some((item) => item.locator.url === "https://example.org/unrelated.csv"), false);
  assert.ok(binding.reason_codes.includes("resources_link_required"));
  assert.ok(binding.alternatives.some((item) => item.reason_codes.includes("unrelated_resources_capture")));
});

test("C-007-2 source-shaped CMS catalog metadata keeps two 2023 products distinct without payload access", async () => {
  const sourceShaped = JSON.parse(await fs.readFile(path.join(ROOT, "verification/research-program/pr-007/fixtures/cms-source-shaped.captures.json"), "utf8"));
  const hha = bindCapturedCatalogRecord({
    record: sourceShaped.hha_record,
    catalogCapture: sourceShaped.hha_catalog,
    observedAt: sourceShaped.observed_at,
  });
  const hospital = bindCapturedCatalogRecord({
    record: sourceShaped.hospital_record,
    catalogCapture: sourceShaped.hospital_catalog,
    observedAt: sourceShaped.observed_at,
  });
  assert.equal(hha.asset_id, sourceShaped.hha_record.record_id);
  assert.equal(hospital.asset_id, sourceShaped.hospital_record.record_id);
  assert.notEqual(hha.asset_id, hospital.asset_id);
  assert.notEqual(hha.releases[0], hospital.releases[0]);
  assert.equal(hha.boundaries.catalog_membership_is_payload_access, false);
  assert.equal(hospital.boundaries.catalog_membership_is_payload_access, false);
  assert.equal(sourceShaped.notes.includes("not payload tests"), true);
});

async function frozenCoreReleaseControl() {
  const bundle = JSON.parse(await fs.readFile(path.join(ROOT, "contracts/core/v2.0.0/bundle/valid-bundle.json"), "utf8"));
  const coreRelease = bundle.releases[0];
  const coreNative = coreRelease.native_identifiers[0];
  const identity = mintReleaseIdentity({
    asset_id: coreRelease.asset_id,
    source_id: coreNative.source_id,
    publisher_identifiers: [coreNative],
    locator: {
      kind: "exact_distribution",
      url: "https://data.cms.gov/example-core-release",
      evidence_ids: coreNative.evidence_ids,
    },
    publisher_version: coreRelease.publisher_version,
    release_kind: coreRelease.release_kind,
    evidence_ids: coreNative.evidence_ids,
    observed_at: OBSERVED_AT,
  });
  const envelope = { ...structuredClone(coreRelease), release_id: identity.release_id, entity_id: identity.release_id };
  envelope.canonical_content_fingerprint = fingerprintTruthRevision(envelope);
  return { bundle, coreRelease, coreNative, identity, envelope };
}

test("R007-6 foreign asset_id or entity_id is not projected as this release", async () => {
  const { identity, envelope } = await frozenCoreReleaseControl();
  const valid = projectCoreReleaseDecision(identity, { envelope });
  assert.equal(valid.projected, true);
  assert.equal(valid.core_object.asset_id, identity.asset_id);
  assert.equal(valid.core_object.entity_id, identity.release_id);
  assert.equal(valid.core_object.canonical_content_fingerprint, envelope.canonical_content_fingerprint);

  const foreignAsset = projectCoreReleaseDecision(identity, {
    envelope: { ...envelope, asset_id: "urn:ushso:asset:foreign" },
  });
  assert.equal(foreignAsset.projected, false);
  assert.equal(foreignAsset.core_object, null);
  assert.ok(foreignAsset.reason_codes.includes("core_asset_id_mismatch"));

  const foreignEntity = projectCoreReleaseDecision(identity, {
    envelope: { ...envelope, entity_id: "urn:ushso:release:foreign" },
  });
  assert.equal(foreignEntity.projected, false);
  assert.equal(foreignEntity.core_object, null);
  assert.ok(foreignEntity.reason_codes.includes("core_entity_id_mismatch"));

  const aliasedForeign = projectCoreReleaseDecision(identity, {
    envelope: {
      ...envelope,
      entity_id: "urn:ushso:release:foreign",
      legacy_aliases: ["urn:ushso:release:foreign"],
    },
  });
  assert.equal(aliasedForeign.projected, false);
  assert.ok(aliasedForeign.reason_codes.includes("core_entity_id_mismatch"));

  const foreignSource = projectCoreReleaseDecision(identity, {
    envelope: {
      ...envelope,
      native_identifiers: envelope.native_identifiers.map((item) => ({ ...item, source_id: "urn:ushso:source:foreign" })),
    },
  });
  assert.equal(foreignSource.projected, false);
  assert.ok(foreignSource.reason_codes.includes("core_source_id_mismatch"));
});

test("R007-7 incomplete envelopes and malformed dates are not core-conformant", async () => {
  const { identity, envelope, coreNative } = await frozenCoreReleaseControl();
  const valid = projectCoreReleaseDecision(identity, { envelope });
  assert.equal(valid.projected, true);
  assert.equal(valid.core_object.release_id, identity.release_id);
  assert.deepEqual(valid.core_object.native_identifiers, envelope.native_identifiers);
  assert.equal(valid.core_object.canonical_content_fingerprint, envelope.canonical_content_fingerprint);

  const incomplete = projectCoreReleaseDecision(identity, {
    envelope: {
      contract_version: "observatory-core.v2.0.0",
      entity_type: "Release",
      asset_id: identity.asset_id,
      release_id: identity.release_id,
    },
  });
  assert.equal(incomplete.projected, false);
  assert.equal(incomplete.core_object, null);
  assert.ok(incomplete.reason_codes.includes("incomplete_or_invalid_core_envelope"));

  assert.equal(nativeIdentifierConformsToCore(coreNative), true);
  assert.equal(nativeIdentifierConformsToCore({ ...coreNative, effective_from: "invalid-date" }), false);
  assert.equal(nativeIdentifierConformsToCore({ ...coreNative, effective_from: "2026-13-40" }), false);
  assert.equal(nativeIdentifierConformsToCore({ ...coreNative, effective_from: "2026-01-15" }), true);
});

test("R007-8 Unicode native identifiers stay distinct and preserve exact values", () => {
  const valueA = String.fromCodePoint(0x1f600);
  const valueB = String.fromCodePoint(0x1f60) + "0";
  const valueC = String.fromCodePoint(0x1f60) + "A";
  const valueD = String.fromCodePoint(0x1f60a);
  assert.notEqual(valueA, valueB);
  const mint = (value) => mintReleaseIdentity(controllerReleaseInput(value));
  const a = mint(valueA);
  const b = mint(valueB);
  const c = mint(valueC);
  const d = mint(valueD);
  assert.notEqual(a.release_id, b.release_id);
  assert.notEqual(c.release_id, d.release_id);
  assert.equal(a.publisher_identifiers[0].value, valueA);
  assert.equal(b.publisher_identifiers[0].value, valueB);
  assert.equal(a.publisher_identifiers[0].normalized_value, valueA);
  assert.equal(b.publisher_identifiers[0].normalized_value, valueB);
  assert.equal(a.publisher_identifiers[0].preservation, "exact");
  assert.match(a.release_id, /^urn:ushso:release:/);
  assert.match(b.release_id, /^urn:ushso:release:/);
  assert.equal(a.release_id.includes("~1F600") && b.release_id.includes("~1F600") && a.release_id === b.release_id, false);
});

test("R007-9 a changed revision cannot retain a stale canonical fingerprint", async () => {
  const { identity, envelope } = await frozenCoreReleaseControl();
  const valid = projectCoreReleaseDecision(identity, { envelope });
  assert.equal(valid.projected, true);
  assert.equal(valid.core_object.canonical_content_fingerprint, fingerprintTruthRevision(valid.core_object));
  assert.equal(valid.core_object.canonical_content_fingerprint, envelope.canonical_content_fingerprint);

  const stale = { ...envelope, publisher_version: `${envelope.publisher_version}-changed` };
  assert.notEqual(stale.canonical_content_fingerprint, fingerprintTruthRevision(stale));
  const rejected = projectCoreReleaseDecision(identity, { envelope: stale });
  assert.equal(rejected.projected, false);
  assert.equal(rejected.core_object, null);
  assert.ok(rejected.reason_codes.includes("core_content_fingerprint_mismatch"));
  assert.equal(rejected.envelope_canonical_content_fingerprint, stale.canonical_content_fingerprint);
  assert.equal(rejected.actual_canonical_content_fingerprint, fingerprintTruthRevision(stale));
});

test("R007-10 nested release relationships must be coherent before product context", () => {
  const map = live20260903GenerationMap();
  const binding = bindCapturedCatalogRecord({
    record: captures.cms_record,
    catalogCapture: captures.cms_catalog,
    resourcesCapture: captures.cms_resources,
  });
  assert.equal(binding.binding_state, "one_to_many");
  assert.equal(binding.release_identity.asset_id, binding.asset_id);
  assert.equal(binding.release_identity.source_id, binding.source_id);
  assert.ok(binding.distributions.length > 1);
  assert.ok(binding.distributions.every((item) => item.release_id === binding.release_identity.release_id));
  const lookup = (nextBinding) => lookupProductContext({
    map,
    record: captures.cms_record,
    pin: map.machine_generation.value,
    binding: nextBinding,
  });

  const control = lookup(binding);
  assert.equal(control.restart_required, false);
  assert.equal(control.release_id, binding.release_identity.release_id);
  assert.equal(control.distribution_ids.length, binding.distributions.filter((item) => item.distribution_id).length);

  const foreignDistribution = structuredClone(binding);
  foreignDistribution.distributions[0].release_id = "urn:ushso:release:controller-foreign";
  const foreignDistributionLookup = lookup(foreignDistribution);
  assert.equal(foreignDistributionLookup.restart_required, true);
  assert.equal(foreignDistributionLookup.code, "binding_ownership_mismatch");
  assert.equal(foreignDistributionLookup.release_id == null || foreignDistributionLookup.release_id === binding.release_identity.release_id, true);

  const foreignNestedAsset = structuredClone(binding);
  foreignNestedAsset.release_identity.asset_id = "obs:asset:controller-foreign";
  const foreignNestedAssetLookup = lookup(foreignNestedAsset);
  assert.equal(foreignNestedAssetLookup.restart_required, true);
  assert.equal(foreignNestedAssetLookup.code, "binding_ownership_mismatch");

  const foreignNestedSource = structuredClone(binding);
  foreignNestedSource.release_identity.source_id = "urn:ushso:source:controller-foreign";
  const foreignNestedSourceLookup = lookup(foreignNestedSource);
  assert.equal(foreignNestedSourceLookup.restart_required, true);
  assert.equal(foreignNestedSourceLookup.code, "binding_ownership_mismatch");

  const foreignNestedReleaseId = structuredClone(binding);
  foreignNestedReleaseId.release_identity.release_id = "urn:ushso:release:controller-foreign";
  const foreignNestedReleaseIdLookup = lookup(foreignNestedReleaseId);
  assert.equal(foreignNestedReleaseIdLookup.restart_required, true);
  assert.equal(foreignNestedReleaseIdLookup.code, "binding_ownership_mismatch");

  const foreignList = structuredClone(binding);
  foreignList.releases[0] = "urn:ushso:release:controller-foreign";
  const foreignListLookup = lookup(foreignList);
  assert.equal(foreignListLookup.restart_required, true);
  assert.equal(foreignListLookup.code, "binding_ownership_mismatch");
  assert.notEqual(foreignListLookup.release_id, "urn:ushso:release:controller-foreign");

  const rolling = bindCapturedCatalogRecord({
    record: captures.cdc_record,
    catalogCapture: captures.cdc_catalog,
    observedAt: captures.observed_at,
  });
  assert.equal(rolling.binding_state, "rolling");
  const rollingLookup = lookupProductContext({
    map,
    record: captures.cdc_record,
    pin: map.machine_generation.value,
    binding: rolling,
  });
  assert.equal(rollingLookup.restart_required, false);
  assert.equal(rollingLookup.release_id, null);
  assert.equal(rollingLookup.asset_id, captures.cdc_record.record_id);

  const unresolved = bindCapturedCatalogRecord({
    record: captures.cms_record,
    catalogCapture: null,
    observedAt: captures.observed_at,
  });
  assert.equal(unresolved.binding_state, "unresolved");
  const unresolvedLookup = lookup(unresolved);
  assert.equal(unresolvedLookup.restart_required, false);
  assert.equal(unresolvedLookup.release_id, null);
  assert.deepEqual(unresolvedLookup.distribution_ids, []);

  const nullBinding = lookupProductContext({
    map,
    record: captures.cms_record,
    pin: map.machine_generation.value,
    binding: null,
  });
  assert.equal(nullBinding.restart_required, false);
  assert.equal(nullBinding.release_id, null);
});
