import { LAST_GOOD_GENERATION } from '../../coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';
import { PAYER_TIC_SCHEMA_FAMILY } from './payer-index.mjs';
import { loadOfficialInNetworkExample } from './payer-in-network.mjs';

export const PROVIDER_REFERENCE_FORMAT = 'ushso.payer-provider-reference.v1';
export const DEFAULT_MAX_REFERENCES = 20;
export const DEFAULT_MAX_BYTES = 65536;
export { LAST_GOOD_GENERATION, PAYER_TIC_SCHEMA_FAMILY, loadOfficialInNetworkExample };

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

export function scopedReferenceId({ fileId, version, providerGroupId }) {
  if (fileId == null || providerGroupId == null) fail('REFERENCE_SCOPE_REQUIRED');
  return freeze({
    kind: 'in_file_provider_group_id',
    file_id: String(fileId),
    version: version ?? null,
    provider_group_id: providerGroupId,
    not_npi: true,
    not_hospital_ccn: true,
    scoped_key: `${fileId}|${version ?? ''}|${providerGroupId}`,
  });
}

export function refuseCrossFileJoin(left, right) {
  if (left.provider_group_id === right.provider_group_id && left.file_id !== right.file_id) {
    fail('EQUAL_NUMERIC_REFERENCE_IDS_CANNOT_JOIN_ACROSS_FILES');
  }
  return freeze({ joined: false, reason: 'different_file_scope' });
}

export function refuseReferenceAsNpiOrCcn(reference) {
  if (reference?.treated_as_npi === true) fail('PROVIDER_REFERENCE_ID_IS_NOT_NPI');
  if (reference?.treated_as_hospital_ccn === true) fail('PROVIDER_REFERENCE_ID_IS_NOT_HOSPITAL_CCN');
  return freeze({
    provider_group_id: reference?.provider_group_id ?? null,
    not_npi: true,
    not_hospital_ccn: true,
  });
}

export function refuseNameInventedGroup(observation = {}) {
  if (observation.invented_from_hospital_name === true) fail('NO_PROVIDER_GROUP_FROM_HOSPITAL_NAME');
  return freeze({ invented: false });
}

export function refuseNpiAsHospitalCcn(observation = {}) {
  if (observation.npi_maps_to_hospital_ccn === true) fail('NPI_BEARING_RATE_DOES_NOT_MAP_TO_HOSPITAL_CCN');
  if (observation.complete_facility_roster === true) fail('NPI_IS_NOT_COMPLETE_FACILITY_ROSTER');
  return freeze({
    npi_maps_to_hospital_ccn: false,
    complete_facility_roster: false,
    facility_mapping: 'separate_qualified_join',
  });
}

export function resolveProviderReferences(document, {
  fileId = 'official-in-network-sample',
  maxReferences = DEFAULT_MAX_REFERENCES,
  maxBytes = DEFAULT_MAX_BYTES,
  externalResources = [],
} = {}) {
  if (document?.synthetic !== true && document?.official_fictional_example === true) {
    fail('OFFICIAL_FICTIONAL_EXAMPLE_MUST_BE_SYNTHETIC');
  }
  const inline = Array.isArray(document?.provider_references) ? document.provider_references : [];
  if (inline.length > maxReferences) fail('REFERENCE_COUNT_LIMIT', String(inline.length));
  const payloadBytes = JSON.stringify(inline).length;
  if (payloadBytes > maxBytes) fail('REFERENCE_BYTE_LIMIT', String(payloadBytes));
  if (externalResources.length > maxReferences) fail('REFERENCE_COUNT_LIMIT', String(externalResources.length));

  const byId = new Map();
  for (const group of inline) {
    const scoped = scopedReferenceId({ fileId, version: document?.version, providerGroupId: group.provider_group_id });
    refuseReferenceAsNpiOrCcn({ provider_group_id: group.provider_group_id, treated_as_npi: false, treated_as_hospital_ccn: false });
    byId.set(group.provider_group_id, freeze({
      ...scoped,
      location: 'inline',
      network_name: freeze([...(group.network_name ?? [])]),
      provider_groups: freeze((group.provider_groups ?? []).map((entry) => freeze({
        npi: freeze([...(entry.npi ?? [])].map((value) => String(value))),
        tin: freeze(entry.tin ? { type: entry.tin.type ?? null, value: entry.tin.value ?? null, business_name: entry.tin.business_name ?? null } : null),
      }))),
    }));
  }

  const requested = [];
  for (const item of document?.in_network ?? []) {
    for (const rate of item.negotiated_rates ?? []) {
      for (const id of rate.provider_references ?? []) requested.push(id);
    }
  }
  const uniqueRequested = [...new Set(requested)];
  const resolved = [];
  const unresolved = [];
  const seenExternal = new Set();
  for (const id of uniqueRequested) {
    if (byId.has(id)) {
      resolved.push(byId.get(id));
      continue;
    }
    const external = externalResources.find((resource) => resource.provider_group_id === id);
    if (external) {
      if (seenExternal.has(id)) fail('REFERENCE_CYCLE', String(id));
      seenExternal.add(id);
      resolved.push(freeze({
        ...scopedReferenceId({ fileId: external.file_id ?? `external:${fileId}`, version: external.version ?? document?.version, providerGroupId: id }),
        location: 'external',
        bounded_resource: true,
      }));
      continue;
    }
    unresolved.push(freeze({
      provider_group_id: id,
      status: 'unresolved',
      invented: false,
    }));
  }

  return freeze({
    format: PROVIDER_REFERENCE_FORMAT,
    schema_family: PAYER_TIC_SCHEMA_FAMILY,
    generation: LAST_GOOD_GENERATION,
    file_id: fileId,
    version: document?.version ?? null,
    synthetic: document?.synthetic === true,
    official_fictional_example: document?.official_fictional_example === true,
    resolved: freeze(resolved),
    unresolved: freeze(unresolved),
    resolved_count: resolved.length,
    unresolved_count: unresolved.length,
    requested_count: uniqueRequested.length,
    count_limit: maxReferences,
    byte_limit: maxBytes,
    implicit_cross_source_merge: false,
    last_good_generation_changed: false,
  });
}

export function attachReferenceCompleteness(rateSample, resolvedIndex) {
  const npiPresent = (resolvedIndex.resolved ?? []).some((group) => (group.provider_groups ?? []).some((entry) => (entry.npi ?? []).length > 0));
  refuseNpiAsHospitalCcn({ npi_maps_to_hospital_ccn: false, complete_facility_roster: false });
  return freeze({
    rate_sample_id: rateSample?.plan_id ?? null,
    resolved_count: resolvedIndex.resolved_count,
    unresolved_count: resolvedIndex.unresolved_count,
    npi_present: npiPresent,
    maps_to_hospital_ccn: false,
    complete_facility_roster: false,
    facility_mapping: 'separate_qualified_join',
    implicit_cross_source_merge: false,
  });
}
