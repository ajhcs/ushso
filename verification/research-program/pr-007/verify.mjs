#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENT_LIVE_GENERATION,
  CURRENT_LIVE_MANIFEST_SHA256,
  bindCapturedCatalogRecord,
  live20260903GenerationMap,
  lookupProductContext,
  mintReleaseIdentity,
  nativeIdentifierConformsToCore,
  projectCoreReleaseDecision,
} from "../../../packages/identity/src/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function fail(code, detail) {
  const error = new Error(detail);
  error.code = code;
  throw error;
}

const captures = JSON.parse(await fs.readFile(path.join(ROOT, "verification/research-program/pr-007/fixtures/catalog-resources.captures.json"), "utf8"));
const rolling = mintReleaseIdentity({
  asset_id: captures.cdc_record.record_id,
  source_id: "urn:ushso:source:cdc-socrata",
  publisher_identifiers: [{
    source_id: "urn:ushso:source:cdc-socrata",
    namespace: "data.cdc.gov.view",
    value: "235m-gsry",
    entity_scope: "asset",
    uniqueness_policy: "reusable_over_time",
    evidence_ids: ["evidence:verify"],
  }],
  locator: { kind: "rolling_current", url: "https://data.cdc.gov/resource/235m-gsry.json", evidence_ids: ["evidence:verify"] },
  release_kind: "rolling_current",
  evidence_ids: ["evidence:verify"],
  observed_at: captures.observed_at,
});
if (rolling.identity_state !== "rolling" || rolling.release_id != null) fail("rolling_was_exact", "rolling endpoint minted an exact release");

const binding = bindCapturedCatalogRecord({
  record: captures.cms_record,
  catalogCapture: captures.cms_catalog,
  resourcesCapture: captures.cms_resources,
  observedAt: captures.observed_at,
});
if (binding.binding_state !== "one_to_many") fail("expected_one_to_many", binding.binding_state);
if (binding.fabricated_exact_binding) fail("fabricated_exact_binding", "binding claimed a fabricated exact ID");

const urlOnly = bindCapturedCatalogRecord({
  record: captures.cms_record,
  catalogCapture: null,
  observedAt: captures.observed_at,
});
if (urlOnly.binding_state === "exact" || urlOnly.releases.length > 0) fail("url_only_exact", "URL-only input produced an exact release");

const map = live20260903GenerationMap();
const human = lookupProductContext({ map, pin: CURRENT_LIVE_MANIFEST_SHA256, record: captures.cms_record, binding });
const machine = lookupProductContext({ map, pin: CURRENT_LIVE_GENERATION, pin_kind: "publication_generation_label", record: captures.cms_record, binding });
if (human.restart_required || machine.restart_required) fail("unexpected_restart", human.code ?? machine.code);
if (human.product_context_fingerprint !== machine.product_context_fingerprint) fail("product_context_mismatch", "human and machine lookups diverged");
const stale = lookupProductContext({
  map,
  pin: "23f704ce3e421a6eb26c2b3677d616a1ae6b4f45226233257b9a1ff676caba2b",
  record: captures.cms_record,
});
if (!stale.restart_required || stale.code !== "manifest_mismatch") fail("missing_restart", JSON.stringify(stale));
if (map.dictionary_source_revision.kind !== "unresolved" || map.dictionary_source_revision.value === CURRENT_LIVE_GENERATION) {
  fail("dictionary_revision_invented", "dictionary/source revision identity cannot be invented from the machine generation label");
}
if (map.dictionary_source_revision.scientific_approval !== false) fail("scientific_approval_claimed", "dictionary applicability is not approval");

const otherCatalog = structuredClone(captures.cms_catalog);
const otherRecord = structuredClone(captures.cms_record);
otherRecord.record_id = "obs:asset:cms-data-catalog:other-product";
otherRecord.identity.asset.asset_id = otherRecord.record_id;
otherRecord.identity.match_fields.source_id = "controller-other-native-id";
otherCatalog.data.dataset[0].identifier = "controller-other-native-id";
const otherBinding = bindCapturedCatalogRecord({
  record: otherRecord,
  catalogCapture: otherCatalog,
  observedAt: captures.observed_at,
});
if (binding.releases[0] === otherBinding.releases[0]) fail("vintage_global_release", "c_vintage minted the same release ID for two assets");

const coreBundle = JSON.parse(await fs.readFile(path.join(ROOT, "contracts/core/v2.0.0/bundle/valid-bundle.json"), "utf8"));
const coreRelease = coreBundle.releases[0];
const coreNative = coreRelease.native_identifiers[0];
const coreIdentity = mintReleaseIdentity({
  asset_id: coreRelease.asset_id,
  source_id: coreNative.source_id,
  publisher_identifiers: [coreNative],
  locator: { kind: "exact_distribution", url: "https://data.cms.gov/example-core-release", evidence_ids: coreNative.evidence_ids },
  publisher_version: coreRelease.publisher_version,
  release_kind: coreRelease.release_kind,
  evidence_ids: coreNative.evidence_ids,
  observed_at: captures.observed_at,
});
const coreEnvelope = { ...structuredClone(coreRelease), release_id: coreIdentity.release_id, entity_id: coreIdentity.release_id };
const projectedValid = projectCoreReleaseDecision(coreIdentity, { envelope: coreEnvelope });
if (projectedValid.projected !== true || projectedValid.core_object?.release_id !== coreIdentity.release_id) {
  fail("valid_core_control_not_projected", JSON.stringify(projectedValid.reason_codes));
}
const projectedForeignAsset = projectCoreReleaseDecision(coreIdentity, { envelope: { ...coreEnvelope, asset_id: "urn:ushso:asset:foreign" } });
if (projectedForeignAsset.projected !== false) fail("foreign_asset_projected", "foreign asset_id projected as this release");
const projectedForeignEntity = projectCoreReleaseDecision(coreIdentity, { envelope: { ...coreEnvelope, entity_id: "urn:ushso:release:foreign" } });
if (projectedForeignEntity.projected !== false) fail("foreign_entity_projected", "foreign entity_id projected as this release");
const projectedIncomplete = projectCoreReleaseDecision(coreIdentity, {
  envelope: { contract_version: "observatory-core.v2.0.0", entity_type: "Release", asset_id: coreIdentity.asset_id, release_id: coreIdentity.release_id },
});
if (projectedIncomplete.projected !== false) fail("incomplete_envelope_projected", "incomplete envelope projected as a core Release");
if (nativeIdentifierConformsToCore({ ...coreNative, effective_from: "invalid-date" })) {
  fail("invalid_native_date_accepted", "malformed effective_from accepted as core-conformant");
}
const unicodeA = mintReleaseIdentity({
  asset_id: coreRelease.asset_id,
  source_id: coreNative.source_id,
  publisher_identifiers: [{ ...coreNative, value: String.fromCodePoint(0x1f600), normalized_value: String.fromCodePoint(0x1f600) }],
  locator: { kind: "exact_distribution", url: "https://data.cms.gov/example-core-release", evidence_ids: coreNative.evidence_ids },
  publisher_version: coreRelease.publisher_version,
  release_kind: coreRelease.release_kind,
  evidence_ids: coreNative.evidence_ids,
  observed_at: captures.observed_at,
});
const unicodeB = mintReleaseIdentity({
  asset_id: coreRelease.asset_id,
  source_id: coreNative.source_id,
  publisher_identifiers: [{ ...coreNative, value: String.fromCodePoint(0x1f60) + "0", normalized_value: String.fromCodePoint(0x1f60) + "0" }],
  locator: { kind: "exact_distribution", url: "https://data.cms.gov/example-core-release", evidence_ids: coreNative.evidence_ids },
  publisher_version: coreRelease.publisher_version,
  release_kind: coreRelease.release_kind,
  evidence_ids: coreNative.evidence_ids,
  observed_at: captures.observed_at,
});
if (unicodeA.release_id === unicodeB.release_id) fail("unicode_identifier_collision", "U+1F600 and U+1F60+ASCII 0 minted the same release ID");
if (unicodeA.publisher_identifiers[0].value !== String.fromCodePoint(0x1f600)) fail("unicode_value_rewritten", "exact native value was not preserved");

const report = {
  ok: true,
  generation: CURRENT_LIVE_GENERATION,
  human_manifest_sha256: CURRENT_LIVE_MANIFEST_SHA256,
  rolling_state: rolling.identity_state,
  binding_state: binding.binding_state,
  distinct_distribution_ids: new Set(binding.distributions.map((item) => item.distribution_id).filter(Boolean)).size,
  url_only_state: urlOnly.binding_state,
  product_context_fingerprint: human.product_context_fingerprint,
  stale_restart_code: stale.code,
  scientific_approval: map.dictionary_source_revision.scientific_approval,
  dictionary_revision_kind: map.dictionary_source_revision.kind,
  vintage_release_ids_distinct: binding.releases[0] !== otherBinding.releases[0],
  core_control_projected: projectedValid.projected,
  foreign_asset_projected: projectedForeignAsset.projected,
  foreign_entity_projected: projectedForeignEntity.projected,
  incomplete_envelope_projected: projectedIncomplete.projected,
  invalid_native_date_accepted: nativeIdentifierConformsToCore({ ...coreNative, effective_from: "invalid-date" }),
  unicode_release_ids_distinct: unicodeA.release_id !== unicodeB.release_id,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
