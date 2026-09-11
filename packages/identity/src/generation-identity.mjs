import { assert, clone, deepFreeze, sha256 } from "./common.mjs";

export const GENERATION_IDENTITY_VERSION = "identity.generation-identity-map.v1.0.0";

export const CURRENT_LIVE_GENERATION = "live-2026-09-03-85b50522b420";
export const CURRENT_LIVE_MANIFEST_SHA256 = "85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e";
export const CURRENT_LIVE_CORPUS_ID = "ushso-live-catalog-2026-09-03";
export const CURRENT_LIVE_CORPUS_VERSION = "1.2.0";
export const CURRENT_LIVE_RECORD_COUNT = 3434;
export const CURRENT_LIVE_SEARCHABLE_COUNT = 3430;
export const CURRENT_LIVE_ISOLATED_COUNT = 4;

export const RESTART_CODES = Object.freeze([
  "generation_unavailable",
  "manifest_mismatch",
  "dictionary_revision_mismatch",
  "stale_pin",
  "corpus_identity_mismatch",
  "cross_generation_reference",
  "unsupported_pin_kind",
  "binding_ownership_mismatch",
]);

export const SUPPORTED_PIN_KINDS = Object.freeze([
  "corpus_manifest_sha256",
  "publication_generation_label",
  "dictionary_or_source_revision",
]);

export const RETAINED_GENERATION_EVIDENCE = Object.freeze({
  human_manifest_citation: "docs/research-program/acceptance.md",
  machine_generation_citation: "packages/retrieval/versions/v1.2.0/manifests/corpus-manifest.json",
  local_retrieval_corpus_manifest_sha256: "7909b624d33bdf1d6b0091c0655ce6b7c17751e52023d5404fa57be46c50048f",
});

const SHA256 = /^[a-f0-9]{64}$/;

function restartGuidance({ code, expected, observed, detail }) {
  assert(RESTART_CODES.includes(code), `Unknown restart code: ${code}`, "invalid_restart_code");
  return deepFreeze({
    restart_required: true,
    code,
    expected: expected ?? null,
    observed: observed ?? null,
    detail,
    next_action: "Restart against the mapped human manifest, machine generation, and dictionary/source revision. Do not substitute another generation silently.",
  });
}

export function createGenerationIdentityMap(input) {
  assert(input?.human_manifest?.kind === "corpus_manifest_sha256", "Human identity must be the corpus manifest SHA-256", "invalid_generation_map");
  assert(typeof input.human_manifest.value === "string" && SHA256.test(input.human_manifest.value), "Human manifest pin must be a 64-character SHA-256", "invalid_generation_map");
  assert(input.machine_generation?.kind === "publication_generation_label", "Machine identity must be the publication generation label", "invalid_generation_map");
  assert(typeof input.machine_generation.value === "string" && input.machine_generation.value.length > 0, "Machine generation label is required", "invalid_generation_map");
  assert(input.dictionary_source_revision?.scientific_approval === false, "Dictionary/source revision cannot claim scientific approval", "scientific_approval_forbidden");
  assert(input.dictionary_source_revision?.generation === input.machine_generation.value, "Dictionary/source revision must pin the same machine generation", "cross_generation_reference");
  assert(typeof input.corpus_id === "string" && input.corpus_id.length >= 3, "corpus_id is required", "invalid_generation_map");
  assert(typeof input.corpus_version === "string" && input.corpus_version.length > 0, "corpus_version is required", "invalid_generation_map");
  assert(Number.isInteger(input.record_count) && input.record_count >= 0, "record_count is required", "invalid_generation_map");
  assert(Number.isInteger(input.searchable_count) && Number.isInteger(input.isolated_count), "searchable and isolated counts are required", "invalid_generation_map");
  assert(input.searchable_count + input.isolated_count === input.record_count, "searchable + isolated must equal record_count", "catalog_count_mismatch");

  return deepFreeze({
    schema_version: GENERATION_IDENTITY_VERSION,
    human_manifest: clone(input.human_manifest),
    machine_generation: clone(input.machine_generation),
    dictionary_source_revision: clone(input.dictionary_source_revision),
    corpus_id: input.corpus_id,
    corpus_version: input.corpus_version,
    record_count: input.record_count,
    searchable_count: input.searchable_count,
    isolated_count: input.isolated_count,
    observed_at: input.observed_at ?? null,
    evidence_ids: [...(input.evidence_ids ?? [])],
    cited_generation_evidence: clone(input.cited_generation_evidence ?? []),
    boundaries: {
      catalog_membership_is_payload_access: false,
      unresolved_dictionary_applicability_is_approval: false,
      scientific_fitness_claimed: false,
      silent_cross_generation_substitution: false,
    },
  });
}

export function live20260903GenerationMap() {
  return createGenerationIdentityMap({
    human_manifest: { kind: "corpus_manifest_sha256", value: CURRENT_LIVE_MANIFEST_SHA256 },
    machine_generation: { kind: "publication_generation_label", value: CURRENT_LIVE_GENERATION },
    dictionary_source_revision: {
      kind: "unresolved",
      value: "unresolved",
      generation: CURRENT_LIVE_GENERATION,
      applicability_state: "unresolved",
      scientific_approval: false,
      unresolved_reason: "No independently known dictionary or source-revision identity is bound for this generation; the machine generation label is not that identity.",
    },
    corpus_id: CURRENT_LIVE_CORPUS_ID,
    corpus_version: CURRENT_LIVE_CORPUS_VERSION,
    record_count: CURRENT_LIVE_RECORD_COUNT,
    searchable_count: CURRENT_LIVE_SEARCHABLE_COUNT,
    isolated_count: CURRENT_LIVE_ISOLATED_COUNT,
    observed_at: "2026-09-03T22:22:33.908Z",
    evidence_ids: [
      "evidence:generation:live-2026-09-03-85b50522b420",
      "evidence:acceptance:catalog-manifest:85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e",
      "evidence:retrieval-corpus-manifest:v1.2.0",
    ],
    cited_generation_evidence: [
      {
        role: "human_manifest",
        path: RETAINED_GENERATION_EVIDENCE.human_manifest_citation,
        value: CURRENT_LIVE_MANIFEST_SHA256,
      },
      {
        role: "machine_generation",
        path: RETAINED_GENERATION_EVIDENCE.machine_generation_citation,
        value: CURRENT_LIVE_GENERATION,
      },
      {
        role: "dictionary_source_revision",
        path: RETAINED_GENERATION_EVIDENCE.machine_generation_citation,
        value: null,
        state: "unresolved",
        local_retrieval_corpus_manifest_sha256: RETAINED_GENERATION_EVIDENCE.local_retrieval_corpus_manifest_sha256,
        detail: "The local retrieval corpus-manifest.json is retained generation evidence. It is not an independently known dictionary revision.",
      },
    ],
  });
}

export function assertGenerationPins(map, pins = {}) {
  const human = pins.human_manifest;
  const machine = pins.machine_generation;
  if (human && machine) {
    const humanOk = human === map.human_manifest.value;
    const machineOk = machine === map.machine_generation.value;
    if (humanOk !== machineOk) {
      return restartGuidance({
        code: "cross_generation_reference",
        expected: `${map.human_manifest.value}/${map.machine_generation.value}`,
        observed: `${human}/${machine}`,
        detail: "Human and machine pins refer to different generations.",
      });
    }
  }
  if (human && human !== map.human_manifest.value) {
    return restartGuidance({
      code: SHA256.test(human) ? "manifest_mismatch" : "stale_pin",
      expected: map.human_manifest.value,
      observed: human,
      detail: "The human manifest pin does not match this generation map.",
    });
  }
  if (machine && machine !== map.machine_generation.value) {
    return restartGuidance({
      code: "generation_unavailable",
      expected: map.machine_generation.value,
      observed: machine,
      detail: "The machine generation pin is unavailable for this map.",
    });
  }
  if (pins.dictionary_source_revision && pins.dictionary_source_revision !== map.dictionary_source_revision.value) {
    return restartGuidance({
      code: "dictionary_revision_mismatch",
      expected: map.dictionary_source_revision.value,
      observed: pins.dictionary_source_revision,
      detail: "The dictionary/source revision pin belongs to another generation.",
    });
  }
  if (pins.corpus_id && pins.corpus_id !== map.corpus_id) {
    return restartGuidance({
      code: "corpus_identity_mismatch",
      expected: map.corpus_id,
      observed: pins.corpus_id,
      detail: "The corpus identity does not match this generation map.",
    });
  }
  return deepFreeze({ restart_required: false, code: null, map });
}

function normalizeSourceId(value) {
  if (typeof value !== "string" || value.length < 3) return null;
  return value.startsWith("urn:ushso:source:") ? value : `urn:ushso:source:${value}`;
}

function productContext({ map, record, binding = null }) {
  const assetId = record.record_id ?? record.identity?.asset?.asset_id;
  const sourceId = record.identity?.source?.source_id ?? record.source_id;
  const sourceNativeId = record.identity?.match_fields?.source_id ?? record.source_native_id ?? null;
  const context = {
    restart_required: false,
    generation: map.machine_generation.value,
    human_manifest_sha256: map.human_manifest.value,
    corpus_id: map.corpus_id,
    corpus_version: map.corpus_version,
    asset_id: assetId,
    source_id: sourceId,
    source_native_id: sourceNativeId,
    release_id: binding?.releases?.[0] ?? null,
    distribution_ids: (binding?.distributions ?? []).map((item) => item.distribution_id).filter(Boolean),
  };
  context.product_context_fingerprint = sha256({
    generation: context.generation,
    human_manifest_sha256: context.human_manifest_sha256,
    corpus_id: context.corpus_id,
    corpus_version: context.corpus_version,
    asset_id: context.asset_id,
    source_id: context.source_id,
    source_native_id: context.source_native_id,
    release_id: context.release_id,
    distribution_ids: context.distribution_ids,
  });
  return deepFreeze(context);
}

function bindingOwnershipRestart(record, binding) {
  if (!binding) return null;
  const assetId = record.record_id ?? record.identity?.asset?.asset_id ?? null;
  const sourceId = normalizeSourceId(record.identity?.source?.source_id ?? record.source_id);
  const bindingAsset = binding.asset_id ?? null;
  const bindingSource = normalizeSourceId(binding.source_id);
  if (bindingAsset && assetId && bindingAsset !== assetId) {
    return restartGuidance({
      code: "binding_ownership_mismatch",
      expected: assetId,
      observed: bindingAsset,
      detail: "A foreign asset binding cannot be attached to the requested product.",
    });
  }
  if (bindingSource && sourceId && bindingSource !== sourceId) {
    return restartGuidance({
      code: "binding_ownership_mismatch",
      expected: sourceId,
      observed: bindingSource,
      detail: "A foreign source binding cannot be attached to the requested product.",
    });
  }
  return null;
}

export function assertPublicationGenerationBinding(map, publicationCorpus = {}) {
  assert(map?.schema_version === GENERATION_IDENTITY_VERSION, "A generation identity map is required", "invalid_generation_map");
  const fingerprint = publicationCorpus.content_fingerprint_sha256;
  if (typeof fingerprint === "string" && SHA256.test(fingerprint) && fingerprint !== map.human_manifest.value) {
    return restartGuidance({
      code: "manifest_mismatch",
      expected: map.human_manifest.value,
      observed: fingerprint,
      detail: "Publication fingerprint does not match this generation map. Do not substitute the current inner context under a stale outer publication.",
    });
  }
  if (publicationCorpus.corpus_id && publicationCorpus.corpus_id !== map.corpus_id) {
    return restartGuidance({
      code: "corpus_identity_mismatch",
      expected: map.corpus_id,
      observed: publicationCorpus.corpus_id,
      detail: "Publication corpus_id does not match this generation map.",
    });
  }
  if (publicationCorpus.corpus_version && publicationCorpus.corpus_version !== map.corpus_version) {
    return restartGuidance({
      code: "corpus_identity_mismatch",
      expected: map.corpus_version,
      observed: publicationCorpus.corpus_version,
      detail: "Publication corpus_version does not match this generation map.",
    });
  }
  return deepFreeze({ restart_required: false, code: null, map });
}

export function lookupProductContext({ map, pin, pin_kind = null, record, binding = null, pins = null }) {
  assert(map?.schema_version === GENERATION_IDENTITY_VERSION, "A generation identity map is required", "invalid_generation_map");
  assert(record && (record.record_id || record.identity?.asset?.asset_id), "Product lookup requires a source record", "missing_product_record");

  if (pins) {
    const checked = assertGenerationPins(map, pins);
    if (checked.restart_required) return checked;
  }

  if (pin_kind != null && !SUPPORTED_PIN_KINDS.includes(pin_kind)) {
    return restartGuidance({
      code: "unsupported_pin_kind",
      expected: SUPPORTED_PIN_KINDS.join(","),
      observed: pin_kind,
      detail: "An unsupported pin kind cannot authorize substitution to the current generation map.",
    });
  }

  if (pin) {
    const kind = pin_kind
      ?? (SHA256.test(pin) ? "corpus_manifest_sha256" : "publication_generation_label");
    if (kind === "corpus_manifest_sha256" && pin !== map.human_manifest.value) {
      return restartGuidance({
        code: "manifest_mismatch",
        expected: map.human_manifest.value,
        observed: pin,
        detail: "Human-to-machine lookup received a stale or mismatched manifest pin.",
      });
    }
    if (kind === "publication_generation_label" && pin !== map.machine_generation.value) {
      return restartGuidance({
        code: "generation_unavailable",
        expected: map.machine_generation.value,
        observed: pin,
        detail: "Machine generation lookup received an unavailable generation pin.",
      });
    }
    if (kind === "dictionary_or_source_revision" && pin !== map.dictionary_source_revision.value) {
      return restartGuidance({
        code: "dictionary_revision_mismatch",
        expected: map.dictionary_source_revision.value,
        observed: pin,
        detail: "Dictionary/source revision lookup received a pin that is not bound on this map.",
      });
    }
  }

  const ownership = bindingOwnershipRestart(record, binding);
  if (ownership) return ownership;

  return productContext({ map, record, binding });
}
