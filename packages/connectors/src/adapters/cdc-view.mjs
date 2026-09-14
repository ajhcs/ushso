import { createHash } from 'node:crypto';
import { classifyResponse, classifyResourceRole } from '../content-classifier.mjs';

export const CDC_SOURCE_ID = 'cdc-socrata';
export const PLACES_154_VIEW_ID = '7cmc-7y5g';
export const ISOLATED_CDC_RECORD_IDS = Object.freeze([
  'obs:asset:cdc-socrata:2g2d-yfx9-060a56b0e1f5e82b',
  'obs:asset:cdc-socrata:38b4-r9iv-82269ee71b664250',
  'obs:asset:cdc-socrata:4ckf-c7xz-8a5026e46b58641e',
  'obs:asset:cdc-socrata:va9e-d8re-c845d9bfb921e339',
]);

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

export async function blockedFetch() {
  const error = new Error('CDC_VIEW_LIVE_NETWORK_FORBIDDEN');
  error.code = 'CDC_VIEW_LIVE_NETWORK_FORBIDDEN';
  throw error;
}

export function viewUrl(sourceNativeId) {
  return `https://data.cdc.gov/api/views/${sourceNativeId}.json`;
}

export function classifyCdcViewKind({ viewType, displayType, assetType } = {}) {
  const view = typeof viewType === 'string' ? viewType : null;
  const display = typeof displayType === 'string' ? displayType : null;
  const asset = typeof assetType === 'string' ? assetType : null;
  if (view === 'href' || asset === 'href') return 'external_link';
  if (view === 'blobby' || display === 'blob' || asset === 'file') return 'document';
  if (view === 'story' || display === 'story' || asset === 'story') return 'visualization';
  if (display === 'visualization_canvas_chart' || display === 'visualization_canvas_map' || asset === 'chart' || asset === 'map') {
    return 'visualization';
  }
  if (view === 'tabular' && (display === 'table' || display == null)) return 'tabular_dataset';
  if (view === 'tabular') return 'visualization';
  return 'unclassified';
}

export function rowSampleEligible(kind) {
  return kind === 'tabular_dataset';
}

export function normalizeCdcView(view) {
  if (view?.view && isObject(view.view)) return view.view;
  if (typeof view?.id === 'string' && (Array.isArray(view.columns) || view.viewType)) return view;
  return {
    id: view?.source_native_id ?? view?.id ?? null,
    name: view?.title ?? view?.name ?? null,
    viewType: view?.view_type ?? view?.viewType ?? null,
    displayType: view?.display_type ?? view?.displayType ?? null,
    assetType: view?.asset_type ?? view?.assetType ?? null,
    columns: view?.columns,
    metadata: view?.metadata,
  };
}

export function assertViewIdentity(view, sourceNativeId) {
  if (!isObject(view) || typeof view.id !== 'string') {
    const error = new Error('CDC_VIEW_IDENTITY_MISSING');
    error.code = 'CDC_VIEW_IDENTITY_MISSING';
    throw error;
  }
  if (view.id !== sourceNativeId) {
    const error = new Error('CDC_VIEW_IDENTITY_MISMATCH');
    error.code = 'CDC_VIEW_IDENTITY_MISMATCH';
    throw error;
  }
  return true;
}

export function extractCdcColumns(view) {
  if (!Array.isArray(view?.columns)) return [];
  const columns = view.columns.filter((column) => isObject(column) && text(column.fieldName) && !column.fieldName.startsWith(':'));
  if (columns.some((column) => view.columns.filter((entry) => entry?.fieldName === column.fieldName).length !== 1)) {
    const error = new Error('DUPLICATE_VARIABLE');
    error.code = 'DUPLICATE_VARIABLE';
    throw error;
  }
  return columns.map((column) => {
    const codes = Array.isArray(column.cachedContents?.top)
      ? column.cachedContents.top.map((item) => item?.item).filter((item) => typeof item === 'string')
      : (Array.isArray(column.code_sample) ? column.code_sample : (column.code_sample?.item ? [column.code_sample.item] : []));
    return Object.freeze({
      fieldName: column.fieldName,
      label: text(column.name),
      type: text(column.dataTypeName),
      description: text(column.description) ?? '',
      code_values: Object.freeze(codes),
      unit: null,
      geography_complete: false,
      person_level_grain: false,
    });
  });
}

export function bindCdcView({ record, view, captureSha256 = null }) {
  const sourceNativeId = record?.identity?.match_fields?.source_id;
  if (record?.identity?.source?.source_id !== CDC_SOURCE_ID || typeof sourceNativeId !== 'string') {
    const error = new Error('CDC_RECORD_IDENTITY_INVALID');
    error.code = 'CDC_RECORD_IDENTITY_INVALID';
    throw error;
  }
  const normalized = normalizeCdcView(view);
  assertViewIdentity(normalized, sourceNativeId);
  const kind = classifyCdcViewKind(normalized);
  const eligible = rowSampleEligible(kind);
  const isolated = ISOLATED_CDC_RECORD_IDS.includes(record.record_id) || record.description === '';
  const columns = eligible && !isolated ? extractCdcColumns(normalized) : [];
  return Object.freeze({
    record_id: record.record_id,
    source_native_id: sourceNativeId,
    title: record.title ?? normalized.name ?? null,
    view_type: normalized.viewType ?? null,
    display_type: normalized.displayType ?? null,
    asset_type: normalized.assetType ?? null,
    kind,
    row_sample_eligible: eligible && !isolated,
    view_identity_verified: true,
    columns: Object.freeze(columns),
    named_column_count: columns.length,
    dictionary_parse_receipt: eligible && !isolated && columns.length > 0,
    row_label: normalized.metadata?.rowLabel ?? null,
    date_roles: Object.freeze(['publisher_metadata_only']),
    geographic_assertions: Object.freeze(['publisher_labelled_only']),
    custom_fields: normalized.metadata?.custom_fields ?? null,
    geography_complete: false,
    person_level_grain: false,
    isolated,
    isolation_reason: isolated ? (record.description === '' ? 'description must be a non-empty string' : 'explicit_compatibility_or_missing_data') : null,
    handling: isolated ? 'compatibility_or_missing_data' : (eligible ? 'row_sample_queue' : 'non_tabular_catalog_entry'),
    capture_sha256: captureSha256 ?? (Array.isArray(normalized.columns) ? sha256Text(JSON.stringify(normalized)) : null),
    payload_success: false,
    publication_authorized: false,
    queryable_table: eligible && !isolated,
  });
}

export function buildCdcExtractionReceipt({ records, views }) {
  const selected = records.filter((record) => record?.identity?.source?.source_id === CDC_SOURCE_ID);
  const byId = new Map();
  for (const view of views ?? []) {
    const key = view.source_native_id ?? view.id ?? view.view?.id;
    if (typeof key === 'string') byId.set(key, view);
  }
  const rows = selected.map((record) => {
    const sourceNativeId = record.identity.match_fields.source_id;
    const view = byId.get(sourceNativeId);
    if (!view) {
      return Object.freeze({
        record_id: record.record_id,
        source_native_id: sourceNativeId,
        title: record.title ?? null,
        kind: 'unclassified',
        row_sample_eligible: false,
        view_identity_verified: false,
        named_column_count: 0,
        dictionary_parse_receipt: false,
        isolated: ISOLATED_CDC_RECORD_IDS.includes(record.record_id) || record.description === '',
        handling: 'missing_view_capture',
        payload_success: false,
        publication_authorized: false,
        queryable_table: false,
      });
    }
    return bindCdcView({ record, view, captureSha256: view.capture_sha256 ?? null });
  });
  const dictionaryIds = rows.filter((row) => row.dictionary_parse_receipt).map((row) => row.record_id);
  return Object.freeze({
    format: 'ushso.cdc-extraction-receipt.v1',
    source_id: CDC_SOURCE_ID,
    record_count: rows.length,
    rows: Object.freeze(rows),
    disappeared_record_count: selected.length - rows.length,
    isolated_record_ids: Object.freeze(rows.filter((row) => row.isolated).map((row) => row.record_id)),
    dictionary_record_ids: Object.freeze(dictionaryIds),
    dictionary_count: dictionaryIds.length,
    fetched_page_count: null,
    payload_success: false,
    publication_authorized: false,
  });
}

export function htmlDocumentationCannotBeJsonSuccess({ headers, bodyBytes, purpose = 'catalog_metadata' }) {
  return classifyResponse({
    purpose,
    expectedContentClasses: ['json'],
    headers,
    bodyBytes,
    profile: { validateJson() { return { accepted: true, classification: 'catalog_metadata' }; } },
  });
}

export { classifyResourceRole, classifyResponse };
