import {
  assertGenerationPins,
  assertPublicationGenerationBinding,
  live20260903GenerationMap,
  lookupProductContext,
} from "../identity/src/generation-identity.mjs";
import { assertPublicationReadContext } from "./publication-read-context.mjs";

export const REGISTRY_GENERATION_IDENTITY_VERSION = "ushso-generation-identity.v1.0.0";

function freezeRecord(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeRecord(child);
  return Object.freeze(value);
}

/**
 * Registry-facing generation lookup. Publication context is required so a
 * caller cannot silently switch generations. The identity map, not catalog
 * membership, is the human/machine/dictionary correspondence.
 */
export function lookupMappedProductContext({
  publication,
  map = live20260903GenerationMap(),
  pin,
  pin_kind = null,
  record,
  binding = null,
  pins = null,
}) {
  assertPublicationReadContext(publication);
  const publicationCheck = assertPublicationGenerationBinding(map, publication.corpus ?? {});
  if (publicationCheck.restart_required) return publicationCheck;
  const fingerprint = publication.corpus?.content_fingerprint_sha256;
  const inferredHuman = /^[a-f0-9]{64}$/.test(fingerprint ?? "") ? fingerprint : null;
  const combinedPins = {
    ...(pins ?? {}),
    ...(inferredHuman && !pins?.human_manifest && !pin ? { human_manifest: inferredHuman } : {}),
  };
  const pinCheck = assertGenerationPins(map, combinedPins);
  if (pinCheck.restart_required) return pinCheck;
  const lookup = lookupProductContext({
    map,
    pin: pin ?? inferredHuman,
    pin_kind: pin_kind ?? (inferredHuman && !pin ? "corpus_manifest_sha256" : null),
    record,
    binding,
    pins: combinedPins,
  });
  return freezeRecord({
    registry_version: REGISTRY_GENERATION_IDENTITY_VERSION,
    publication_manifest_id: publication.publication_manifest_id,
    index_generation: publication.index_generation,
    lookup,
  });
}

export { live20260903GenerationMap, assertGenerationPins, assertPublicationGenerationBinding, lookupProductContext };
