import { semanticErrors } from './record-semantics.mjs';

const EVIDENCE_STATES = new Set(['verified_first_party', 'source_asserted', 'inferred', 'unresolved', 'unavailable']);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** The minimum canonical-record contract enforced by the browser provider. */
export function browserRecordErrors(record) {
  const errors = [];
  if (!object(record)) return ['record must be an object'];
  if (record.schema_version !== 'observatory-record.v1.0.0') errors.push('schema_version must be observatory-record.v1.0.0');
  if (!nonEmpty(record.record_id)) errors.push('record_id must be a non-empty string');
  if (record.record_type !== 'dataset_asset') errors.push('record_type must be dataset_asset');
  for (const key of ['identity', 'access', 'geography', 'time_coverage', 'capabilities', 'freshness_verification', 'retrieval', 'join_compatibility']) {
    if (!object(record[key])) errors.push(`${key} must be an object`);
  }
  for (const key of ['provenance', 'evidence', 'unit_of_analysis']) if (!Array.isArray(record[key])) errors.push(`${key} must be an array`);
  if (!nonEmpty(record.title)) errors.push('title must be a non-empty string');
  if (!nonEmpty(record.description)) errors.push('description must be a non-empty string');
  if (!nonEmpty(record.authoritative_url)) errors.push('authoritative_url must be a non-empty string');
  const freshness = record.freshness_verification;
  if (object(freshness)) {
    if (!nonEmpty(freshness.metadata_observed_at)) errors.push('freshness_verification.metadata_observed_at must be a timestamp string');
    if (freshness.data_through !== null && typeof freshness.data_through !== 'string') errors.push('freshness_verification.data_through must be string or null');
    if (freshness.next_review_due !== null && typeof freshness.next_review_due !== 'string') errors.push('freshness_verification.next_review_due must be string or null');
  }
  const provenanceIds = new Set();
  for (const [index, row] of (record.provenance ?? []).entries()) {
    if (!object(row) || !nonEmpty(row.provenance_id) || !nonEmpty(row.locator) || !nonEmpty(row.observed_at)) errors.push(`provenance[${index}] is incomplete`);
    else provenanceIds.add(row.provenance_id);
  }
  if ((record.provenance ?? []).length === 0) errors.push('provenance must contain at least one row');
  for (const [index, row] of (record.evidence ?? []).entries()) {
    if (!object(row) || !nonEmpty(row.evidence_id) || !nonEmpty(row.claim) || !EVIDENCE_STATES.has(row.state)) errors.push(`evidence[${index}] is incomplete`);
    if (!Array.isArray(row?.provenance_ids) || row.provenance_ids.length === 0 || row.provenance_ids.some(id => !provenanceIds.has(id))) errors.push(`evidence[${index}] must reference preserved provenance`);
  }
  if ((record.evidence ?? []).length === 0) errors.push('evidence must contain at least one row');
  if (errors.length === 0) {
    try {
      errors.push(...semanticErrors(record));
    } catch (error) {
      errors.push(`semantic validation could not complete: ${error.message}`);
    }
  }
  return [...new Set(errors)];
}

export function validateCatalogRecords(records) {
  const valid = [];
  const invalid = [];
  const seen = new Set();
  for (const [index, record] of records.entries()) {
    const errors = browserRecordErrors(record);
    if (record?.record_id && seen.has(record.record_id)) errors.push('record_id must be unique within the catalog');
    if (record?.record_id) seen.add(record.record_id);
    if (errors.length) invalid.push({
      index,
      record_id: nonEmpty(record?.record_id) ? record.record_id : null,
      code: 'invalid_catalog_record',
      errors: [...new Set(errors)]
    });
    else valid.push(record);
  }
  return { valid, invalid };
}

export function freshnessState(record, now = new Date()) {
  const historical = record.freshness_verification ?? {};
  const due = historical.next_review_due ? new Date(historical.next_review_due) : null;
  const nowDate = now instanceof Date ? now : new Date(now);
  const dueValid = due && !Number.isNaN(due.valueOf());
  return {
    verification_status: historical.verification_status ?? 'unknown',
    last_checked: historical.metadata_observed_at ?? null,
    next_review_due: historical.next_review_due ?? null,
    freshness_state: !dueValid ? 'deadline_unknown' : nowDate.valueOf() > due.valueOf() ? 'overdue' : 'within_review_window',
    failed_refresh_state: historical.failed_refresh_state ?? 'none_recorded',
    note: !dueValid
      ? 'No review deadline is documented; historical verification evidence is unchanged.'
      : nowDate.valueOf() > due.valueOf()
        ? 'Review is overdue; this does not by itself mean the preserved metadata is false.'
        : 'Review deadline has not passed.'
  };
}

export function metadataDimensions(record) {
  const unitsKnown = Array.isArray(record.unit_of_analysis) && record.unit_of_analysis.some(value => value !== 'unknown');
  const geographyKnown = record.geography?.coverage_level && record.geography.coverage_level !== 'unknown';
  return {
    observation_grain: { values: unitsKnown ? [...record.unit_of_analysis] : [], state: unitsKnown ? record.geography?.evidence_state ?? 'source_asserted' : 'unresolved' },
    sampled_entity: { values: [], state: 'unresolved' },
    reporting_organization: { values: [], state: 'unresolved' },
    population_universe: { values: [], state: 'unresolved' },
    geographic_dimensions: {
      values: geographyKnown ? [record.geography.coverage_level, ...(record.geography.jurisdictions ?? [])] : [],
      state: geographyKnown ? record.geography.evidence_state ?? 'source_asserted' : 'unresolved'
    },
    inferred_search_tags: [...new Set([...(record.capabilities?.topics ?? []), ...(record.capabilities?.use_cases ?? [])]
      .filter(item => item.evidence_state === 'inferred').map(item => item.id))]
  };
}

export function dateDimensions(record) {
  return {
    observation_period: {
      start: record.time_coverage?.start ?? null,
      end: record.time_coverage?.end ?? null,
      state: record.time_coverage?.state ?? 'unknown',
      evidence_state: record.time_coverage?.evidence_state ?? 'unresolved'
    },
    publisher_release_date: record.release_date ?? record.dates?.release_date ?? null,
    publisher_revision_date: record.revision_date ?? record.dates?.revision_date ?? null,
    projection_horizon: record.projection_horizon ?? record.dates?.projection_horizon ?? null,
    metadata_observed_at: record.freshness_verification?.metadata_observed_at ?? null
  };
}

export function accessDimensions(record) {
  const status = record.access?.status ?? 'unknown';
  const publicPayload = status === 'public_direct';
  const restricted = ['registration_required', 'application_required', 'dua_required', 'licensed_paid', 'controlled'].includes(status);
  return {
    catalog_visibility: 'indexed',
    payload_access: publicPayload ? 'documented_public' : restricted ? 'documented_restricted' : 'unknown',
    cost_state: publicPayload && (record.access?.requirements ?? []).includes('none') ? 'documented_free' : status === 'licensed_paid' ? 'payment_required' : 'unknown',
    source_status: status,
    evidence_state: record.access?.evidence_state ?? 'unresolved'
  };
}

export function descriptionQuality(record) {
  const raw = String(record.description ?? '');
  const replacementCharacter = raw.includes('\uFFFD');
  const mojibake = /(?:Ã.|Â.|â€|ï¿½)/.test(raw);
  return {
    raw_description: raw,
    state: replacementCharacter || mojibake ? 'suspected_encoding_corruption' : 'no_corruption_detected',
    indicators: [replacementCharacter ? 'replacement_character' : null, mojibake ? 'recognizable_mojibake' : null].filter(Boolean),
    display_description: raw,
    repair_state: replacementCharacter || mojibake ? 'unresolved_no_verified_repair' : 'not_needed',
    authoritative_url: record.authoritative_url ?? null
  };
}

export function auditEvidence(record) {
  const provenance = new Map((record.provenance ?? []).map(row => [row.provenance_id, row]));
  return (record.evidence ?? []).map(row => ({
    evidence_id: row.evidence_id,
    claim: row.claim,
    evidence_state: row.state,
    references: (row.provenance_ids ?? []).map(id => {
      const source = provenance.get(id);
      return {
        provenance_id: id,
        source_locator: source?.locator ?? null,
        captured_at: source?.observed_at ?? null,
        content_sha256: source?.content_sha256 ?? null,
        excerpt: null,
        excerpt_state: 'not_preserved'
      };
    }),
    limitations: [...(row.limitations ?? [])]
  }));
}

export function retrievalPlan(record) {
  const instructions = record.retrieval?.instructions ?? [];
  return {
    access_routes: instructions.filter(step => step.action !== 'stop_and_report' && step.url).map(step => structuredClone(step)),
    stop_conditions: instructions.filter(step => step.action === 'stop_and_report').map(step => ({ ...structuredClone(step), url: null })),
    unresolved_routes: instructions.filter(step => step.action !== 'stop_and_report' && !step.url).map(step => structuredClone(step)),
    route_state: instructions.some(step => step.action !== 'stop_and_report' && step.url)
      ? 'route_available'
      : instructions.some(step => step.action !== 'stop_and_report') ? 'route_unresolved' : 'no_route'
  };
}
