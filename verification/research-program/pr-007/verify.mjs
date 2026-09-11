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
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
