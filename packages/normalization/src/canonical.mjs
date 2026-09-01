import { contentFingerprint, fingerprintTruthRevision } from '../../../contracts/core/v2.0.0/tools/common.mjs';
import { NORMALIZER_NAME, NORMALIZER_VERSION, RECORDED_AT } from './constants.mjs';

export { canonicalJson, contentFingerprint, sha256Bytes } from '../../../contracts/core/v2.0.0/tools/common.mjs';

const KIND_BY_ENTITY = Object.freeze({
  Organization: 'organization', Source: 'source', Asset: 'asset', Release: 'release',
  Distribution: 'distribution', Documentation: 'documentation', SchemaSnapshot: 'schema-snapshot',
  SchemaField: 'schema-field', AccessRoute: 'access-route', AccessObservation: 'access-observation',
  Evidence: 'evidence', Assertion: 'assertion', Relationship: 'relationship'
});

const ID_FIELD_BY_ENTITY = Object.freeze({
  Organization: 'organization_id', Source: 'source_id', Asset: 'asset_id', Release: 'release_id',
  Distribution: 'distribution_id', Documentation: 'documentation_id', SchemaSnapshot: 'schema_snapshot_id',
  SchemaField: 'schema_field_id', AccessRoute: 'access_route_id', AccessObservation: 'observation_id',
  Evidence: 'evidence_id', Assertion: 'assertion_id', Relationship: 'relationship_id'
});

function digestHex(value) {
  return contentFingerprint(value).slice('sha256:'.length);
}

export function opaqueId(kind, immutableKey) {
  if (!/^[a-z][a-z0-9-]*$/u.test(kind)) throw new TypeError(`INVALID_OPAQUE_ID_KIND:${kind}`);
  if (typeof immutableKey !== 'string' || immutableKey.length === 0) throw new TypeError('IMMUTABLE_KEY_REQUIRED');
  return `urn:ushso:${kind}:${digestHex({ kind, immutable_key: immutableKey }).slice(0, 40)}`;
}

export function importId(contentFingerprintHex) {
  return opaqueId('import', `legacy-v1.1.0:${contentFingerprintHex}:${NORMALIZER_NAME}@${NORMALIZER_VERSION}`);
}

export function lineage(import_id, parents = []) {
  return {
    connector_run_id: null,
    normalizer: { name: NORMALIZER_NAME, version: NORMALIZER_VERSION },
    import_id,
    derivation_parent_ids: [...new Set(parents)].sort()
  };
}

export function clocks(observedAt, { publisherReleasedAt = null, publisherModifiedAt = null } = {}) {
  const observed = normalizeDateTime(observedAt) ?? RECORDED_AT;
  if (Date.parse(observed) > Date.parse(RECORDED_AT)) throw new TypeError('OBSERVED_AFTER_RECORDED');
  return {
    first_seen_at: observed,
    observed_at: observed,
    recorded_at: RECORDED_AT,
    publisher_released_at: normalizeDateTime(publisherReleasedAt),
    publisher_modified_at: normalizeDateTime(publisherModifiedAt),
    superseded_at: null
  };
}

export function normalizeDateTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

export function normalizeLocator(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:/iu.test(value) ? value : `https://${value.replace(/^\/+/, '')}`;
    const url = new URL(candidate);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function namespace(value, fallback = 'legacy.identifier') {
  const normalized = String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z]+/u, '')
    .replace(/-+/gu, '-')
    .replace(/[-._]+$/u, '')
    .slice(0, 80);
  return /^[a-z][a-z0-9._-]{1,79}$/u.test(normalized) ? normalized : fallback;
}

export function nativeIdentifier({ sourceId, namespace: nativeNamespace, value, entityScope, evidenceIds, authority = 'legacy_alias' }) {
  const exact = String(value);
  return {
    source_id: sourceId,
    namespace: namespace(nativeNamespace),
    value: exact,
    normalized_value: exact.normalize('NFKC'),
    case_behavior: 'sensitive',
    preservation: 'exact',
    entity_scope: entityScope,
    authority,
    uniqueness_policy: authority === 'authoritative_cross_source' ? 'unique' : 'source_scoped',
    effective_from: null,
    effective_to: null,
    evidence_ids: [...new Set(evidenceIds)].sort()
  };
}

export function evidenceReference(evidenceId, claimPaths, observedAt, evidenceState = 'documented') {
  const state = ['unknown', 'candidate', 'ambiguous', 'documented', 'observed', 'executed', 'proven'].includes(evidenceState)
    ? evidenceState : 'unknown';
  return {
    evidence_id: evidenceId,
    claim_paths: [...new Set(claimPaths)].sort(),
    observed_at: normalizeDateTime(observedAt) ?? RECORDED_AT,
    evidence_state: state,
    staleness_state: 'unknown',
    derivation_lineage: [opaqueId('lineage', `legacy-evidence:${evidenceId}`)],
    review_status: ['unknown', 'candidate', 'ambiguous'].includes(state) ? 'pending' : 'not_required',
    reviewed_at: null
  };
}

export function coverageIntervals(legacy) {
  const value = legacy?.time_coverage;
  if (!value) return [];
  const start = boundaryDate(value.start, false);
  const end = boundaryDate(value.end, true);
  if (!start || !end) {
    return [{ start: null, end: null, period_basis: value.state === 'rolling' ? 'rolling' : 'unknown', fiscal_year_end_month: null, precision: 'unknown', status: 'unknown' }];
  }
  return [{
    start,
    end,
    period_basis: value.state === 'rolling' ? 'rolling' : 'calendar',
    fiscal_year_end_month: null,
    precision: /^\d{4}$/u.test(String(value.start)) && /^\d{4}$/u.test(String(value.end)) ? 'year' : (/^\d{4}-\d{2}$/u.test(String(value.start)) ? 'month' : 'day'),
    status: 'known'
  }];
}

function boundaryDate(value, upper) {
  if (typeof value !== 'string') return null;
  if (/^\d{4}$/u.test(value)) return `${value}-${upper ? '12-31' : '01-01'}`;
  if (/^\d{4}-\d{2}$/u.test(value)) {
    const [year, month] = value.split('-').map(Number);
    if (month < 1 || month > 12) return null;
    const day = upper ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 1;
    return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return value;
  return null;
}

export function finalizeRevision({ entityType, entityId, legacyAliases = [], nativeIdentifiers = [], observedAt, coverage = [], evidenceRefs = [], assertionRefs = [], import_id, parents = [], lifecycleState = 'active', specific }) {
  const kind = KIND_BY_ENTITY[entityType];
  if (!kind) throw new TypeError(`UNKNOWN_ENTITY_TYPE:${entityType}`);
  const idField = ID_FIELD_BY_ENTITY[entityType];
  const semanticDigest = contentFingerprint({
    entity_type: entityType,
    entity_id: entityId,
    lifecycle_state: lifecycleState,
    legacy_aliases: [...new Set(legacyAliases)].sort(),
    native_identifiers: nativeIdentifiers,
    coverage_intervals: coverage,
    evidence_refs: evidenceRefs,
    assertion_refs: assertionRefs,
    specific,
    normalizer: `${NORMALIZER_NAME}@${NORMALIZER_VERSION}`
  });
  const revisionId = opaqueId('revision', `${entityId}:${semanticDigest}`);
  const row = {
    contract_version: 'observatory-core.v2.0.0',
    entity_type: entityType,
    entity_id: entityId,
    revision_id: revisionId,
    schema_version: '2.0.0',
    lifecycle_state: lifecycleState,
    canonical_content_fingerprint: `sha256:${'0'.repeat(64)}`,
    native_identifiers: nativeIdentifiers,
    legacy_aliases: [...new Set(legacyAliases)].sort(),
    clocks: clocks(observedAt),
    coverage_intervals: coverage,
    evidence_refs: evidenceRefs,
    assertion_refs: [...new Set(assertionRefs)].sort(),
    lineage: lineage(import_id, parents),
    history: { append_only: true, supersedes_revision_ids: [], superseded_by_revision_id: null, rationale: null },
    ...specific
  };
  if (row[idField] !== entityId) throw new TypeError(`ENTITY_ID_FIELD_MISMATCH:${entityType}`);
  row.canonical_content_fingerprint = fingerprintTruthRevision(row);
  return Object.freeze(row);
}

export function stableSortRows(rows) {
  return [...rows].sort((left, right) => left.entity_id.localeCompare(right.entity_id) || left.revision_id.localeCompare(right.revision_id));
}
