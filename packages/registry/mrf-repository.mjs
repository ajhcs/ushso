import { LAST_GOOD_GENERATION } from './publication-parity.mjs';
import { refuseEnforcementAsRateFile } from '../connectors/mrf/hospital-registry.mjs';
import { buildSourceCard } from '../enrichment/source-card.mjs';

export const MRF_REPOSITORY_FORMAT = 'ushso.mrf-repository.v1';
export { LAST_GOOD_GENERATION };

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

export function defineMrfIdentity({ entityId, releaseId, fileType, locator } = {}) {
  if (!entityId || !releaseId || !fileType) fail('MRF_IDENTITY_REQUIRED');
  return freeze({
    entity_id: entityId,
    release_id: releaseId,
    file_type: fileType,
    locator: locator ?? null,
    stable_key: `${entityId}|${releaseId}|${fileType}`,
  });
}

export function createMrfProfile(input = {}) {
  const identity = defineMrfIdentity(input);
  const blocked = input.disposition === 'blocked' || input.disposition === 'failed' || input.accessible === false;
  if (blocked && input.sample_exists === true) fail('BLOCKED_FILE_CANNOT_CLAIM_SAMPLE');
  const card = buildSourceCard({
    source_id: identity.stable_key,
    purpose: input.purpose ?? 'Hospital or payer machine-readable file directory profile',
    coverage: input.coverage ?? 'selected MRF cohort entity/file',
    grain: 'file_release',
    example_variables: input.example_variables ?? ['file_type', 'schema_version', 'tested_state'],
    access_steps: input.access_steps ?? [{ step: 'directory_profile', tested: false }],
    tested_state: input.tested_state ?? (blocked ? 'failed' : 'indexed'),
    limits: input.limits ?? ['An MRF sample is not a complete hospital or payer publication.'],
    citation: input.citation ?? 'CMS hospital-price-transparency / price-transparency-guide pinned fixtures',
    status: blocked ? 'documented' : input.status,
    release_id: identity.release_id,
    schema_id: input.schema_version ?? null,
  });
  return freeze({
    format: MRF_REPOSITORY_FORMAT,
    generation: LAST_GOOD_GENERATION,
    identity,
    entity_kind: input.entity_kind ?? null,
    file_types: freeze([...(input.file_types ?? [identity.file_type])]),
    locator: identity.locator,
    size_bytes: input.size_bytes ?? null,
    schema_version: input.schema_version ?? null,
    tested_state: card.tested_state,
    sample_scope: blocked ? null : (input.sample_scope ?? null),
    sample_exists: blocked ? false : input.sample_exists === true,
    disposition: input.disposition ?? (blocked ? 'blocked' : 'indexed'),
    blocked_reason: blocked ? (input.blocked_reason ?? 'file_inaccessible_or_unparsed') : null,
    price_caveats: freeze([...(input.price_caveats ?? ['gross_cash_negotiated_allowed_remain_distinct'])]),
    complete_hospital_publication: false,
    complete_payer_publication: false,
    source_card: card,
    last_good_generation_changed: false,
  });
}

export function indexNegotiatedRateQuery(candidates = []) {
  const ranked = [];
  for (const candidate of candidates) {
    refuseEnforcementAsRateFile({
      product_key: candidate.product_key,
      satisfies_rate_file: candidate.satisfies_rate_file === true,
    });
    if (candidate.product_key === 'cms-hospital-price-transparency-enforcement') continue;
    if (candidate.file_type === 'in_network' || candidate.file_type === 'negotiated_rate' || candidate.rate_type === 'negotiated') {
      ranked.push(freeze({ ...candidate, compatible_rate_file: true }));
    }
  }
  if (ranked[0]?.product_key === 'cms-hospital-price-transparency-enforcement') {
    fail('ENFORCEMENT_IS_NOT_RATE_FILE');
  }
  return freeze({
    query: 'negotiated_rate_files',
    results: freeze(ranked),
    enforcement_not_leading_compatible_file: true,
  });
}

export function publishMrfCoverage({ hospitals = [], payers = [], files = [] } = {}) {
  const shared = new Map();
  for (const file of files) {
    const key = file.locator ?? file.stable_key;
    shared.set(key, (shared.get(key) ?? 0) + 1);
  }
  const uniqueFiles = [...new Set(files.map((file) => file.locator ?? file.stable_key))].length;
  if (uniqueFiles < files.length && files.length === payers.length && uniqueFiles !== files.length) {
    /* shared files counted once below */
  }
  return freeze({
    format: MRF_REPOSITORY_FORMAT,
    generation: LAST_GOOD_GENERATION,
    hospital_count: hospitals.length,
    reporting_entity_count: payers.length,
    file_count: uniqueFiles,
    shared_files_do_not_inflate_provider_coverage: uniqueFiles <= files.length,
    complete_hospital_publication: false,
    complete_payer_publication: false,
    last_good_generation_changed: false,
  });
}
