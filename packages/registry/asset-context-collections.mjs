import { CATALOG_REPOSITORY_VERSION } from './catalog-repository.mjs';

export const ASSET_CONTEXT_COLLECTIONS_VERSION = 'ushso.asset-context-collections.v1';
export const HCRIS_HOSPITAL_COST_REPORT_ID = 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17';

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._~:/-]{0,127}$/u;

function freeze(value) {
  return Object.freeze(value);
}

function evidenceIds(record) {
  return freeze((record?.evidence ?? []).map((item) => item.evidence_id).filter(Boolean));
}

function nestedRecord({ record_id, record_type, label, lifecycle_state = 'active', evidence_ids }) {
  return freeze({
    record_id,
    record_type,
    label: String(label ?? record_id).replace(/\s+/gu, ' ').trim().slice(0, 2000),
    lifecycle_state,
    evidence_ids: freeze([...(evidence_ids ?? [])]),
  });
}

function locatorId(url) {
  if (typeof url !== 'string' || url.length === 0) return null;
  if (url.length <= 128 && STABLE_ID.test(url)) return url;
  let hash = 0x811c9dc5;
  for (const character of url) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `documentation.${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function addDocumentation(items, seen, url, label, evidence) {
  if (typeof url !== 'string' || !url || seen.has(url)) return;
  const record_id = locatorId(url);
  if (!record_id) return;
  seen.add(url);
  items.push(nestedRecord({
    record_id,
    record_type: 'documentation',
    label,
    evidence_ids: evidence.length ? evidence : freeze(['evidence.catalog.locator']),
  }));
}

function rolling(record) {
  const state = record?.identity?.asset?.version_state;
  return state === 'rolling' || state === 'rolling_current';
}

function collection(items, resolved) {
  if (!resolved) {
    return freeze({ items: freeze([]), completeness: 'unknown', resolved: false });
  }
  return freeze({ items: freeze([...items]), completeness: 'complete', resolved: true });
}

/**
 * Map canonical product/source/releases/distributions/documentation/schemas
 * from catalog locators and optional exact identity bindings. Rolling endpoints
 * do not mint an exact release from a URL. Known-empty (resolved, length 0)
 * remains distinct from not-yet-resolved (unknown).
 */
export function collectAssetContext(record, { binding = null } = {}) {
  if (!record || typeof record !== 'object') throw new TypeError('ASSET_CONTEXT_RECORD_REQUIRED');
  const evidence = evidenceIds(record);
  const documentation = [];
  const seen = new Set();
  for (const step of record.retrieval?.instructions ?? []) {
    if (step.action === 'stop_and_report') continue;
    addDocumentation(documentation, seen, step.url, step.instruction ?? 'Verified navigation route', evidence);
  }
  addDocumentation(documentation, seen, record.authoritative_url, 'Authoritative source', evidence);
  for (const source of record.provenance ?? []) {
    addDocumentation(
      documentation,
      seen,
      source.locator,
      source.kind === 'documentation' ? 'Publisher documentation' : 'Preserved source locator',
      evidence,
    );
  }

  const releases = [];
  const distributions = [];
  const schemas = [];
  const exactRelease = !rolling(record)
    && (binding?.release_identity?.release_id ?? (Array.isArray(binding?.releases) ? binding.releases[0] : null));
  if (typeof exactRelease === 'string' && STABLE_ID.test(exactRelease)) {
    releases.push(nestedRecord({
      record_id: exactRelease,
      record_type: 'release',
      label: record.identity?.asset?.version_label ?? exactRelease,
      evidence_ids: evidence,
    }));
  }
  for (const item of binding?.distributions ?? []) {
    if (item?.identity_state === 'exact' && typeof item.distribution_id === 'string' && STABLE_ID.test(item.distribution_id)) {
      distributions.push(nestedRecord({
        record_id: item.distribution_id,
        record_type: 'distribution',
        label: item.format ?? item.media_type ?? item.distribution_id,
        evidence_ids: evidence,
      }));
    }
  }
  const exactSchema = binding?.schema_id ?? record.variable_documentation?.schema_id ?? null;
  if (typeof exactSchema === 'string' && STABLE_ID.test(exactSchema) && !rolling(record)) {
    schemas.push(nestedRecord({
      record_id: exactSchema,
      record_type: 'schema',
      label: record.variable_documentation?.codebook?.title ?? exactSchema,
      evidence_ids: evidence,
    }));
  }

  return freeze({
    format: ASSET_CONTEXT_COLLECTIONS_VERSION,
    catalog_repository_version: CATALOG_REPOSITORY_VERSION,
    asset_id: record.record_id,
    rolling: rolling(record),
    minted_exact_release_from_url: false,
    releases: collection(releases, releases.length > 0),
    distributions: collection(distributions, Boolean(binding) && !rolling(record)),
    documentation: collection(documentation, documentation.length > 0),
    schemas: collection(schemas, schemas.length > 0),
  });
}

export function isHcrisHospitalCostReport(record) {
  return record?.record_id === HCRIS_HOSPITAL_COST_REPORT_ID
    || record?.title === 'Hospital Provider Cost Report';
}
