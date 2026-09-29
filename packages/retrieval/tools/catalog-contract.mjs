import { semanticErrors } from './record-semantics.mjs';
import { isSafeEvidenceLocator, safeExternalHttpsUrl, safePreservedHttpUrl } from './external-url-policy.mjs';

const EVIDENCE_STATES = new Set(['verified_first_party', 'source_asserted', 'inferred', 'unresolved', 'unavailable']);
const VERIFICATION_STATUSES = new Set(['current_verified', 'stale', 'not_live_verified', 'unknown']);
const VERIFICATION_METHODS = new Set(['first_party_live', 'captured_evidence', 'offline_fixture', 'unknown']);
const PROVENANCE_KINDS = new Set(['first_party_page', 'catalog_metadata', 'documentation', 'fixture_note', 'other']);
const CAPTURE_STATES = new Set(['captured_hashed', 'fixture_only', 'locator_only', 'unavailable']);
const RETRIEVAL_ACTIONS = new Set(['open', 'download', 'call_api', 'submit_request', 'accept_license', 'authenticate', 'inspect_metadata', 'contact_owner', 'stop_and_report']);
const PREFERRED_INTERFACES = new Set(['download', 'api', 'portal', 'request_workflow', 'license_workflow', 'unknown']);
const RESTRICTED_ACCESS_STATUSES = new Set(['registration_required', 'application_required', 'dua_required', 'licensed_paid', 'controlled']);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function documentedRestrictedPayload(record) {
  const status = record.access?.status;
  if (RESTRICTED_ACCESS_STATUSES.has(status)) return true;

  const title = String(record.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (/\brestricted\b|\bcontrolled (?:access|use|data|file|dataset)\b/.test(title)) return true;

  const structuredTerms = [...arrayOrEmpty(record.access?.requirements), ...arrayOrEmpty(record.access?.mechanisms)]
    .map(value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' '));
  if (structuredTerms.some(value => /\b(?:register|registration|application|data use agreement|dua|restricted|controlled|authentication|login|payment|paid|fees?|licen[cs](?:e|ed|es|ing)|approval required|authorization required|account required)\b/.test(value))) return true;

  // restriction_note is free text, so accept only clauses that explicitly
  // bind a restriction or human gate to this indexed asset/access route.
  const note = String(record.access?.restriction_note ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return /\b(?:access|this (?:asset|dataset|data|file|payload)|the (?:asset|dataset|data|file|payload)) (?:is|are|remains?) (?:restricted|controlled)\b/.test(note)
    || /\b(?:requires?|required)\b(?: [a-z0-9]+){0,8} \b(?:registration|application|data use agreement|dua|authentication|login|payment|fees?|licen[cs](?:e|ed|es|ing)|approval|authorization|account)\b/.test(note)
    || /\b(?:registration|application|data use agreement|dua|authentication|login|payment|fees?|licen[cs](?:e|ed|es|ing)|approval|authorization|account)\b(?: [a-z0-9]+){0,8} \b(?:is )?required\b/.test(note);
}

function verifiedNavigationUrl(record, value) {
  if (!nonEmpty(value)) return null;
  // Navigable routes must be stored explicitly as HTTPS. A related locator,
  // even at the exact host/path, is evidence data rather than endpoint proof.
  return safeExternalHttpsUrl(value);
}

function variableDocumentationErrors(value) {
  if (value === undefined) return [];
  const errors = [];
  if (!object(value)) return ['variable_documentation must be an object'];
  if (!new Set(['documented', 'partial', 'not_captured', 'unavailable', 'unknown']).has(value.status)) errors.push('variable_documentation.status is invalid');
  if (value.summary !== null && typeof value.summary !== 'string') errors.push('variable_documentation.summary must be string or null');
  if (value.variable_count !== null && (!Number.isInteger(value.variable_count) || value.variable_count < 0)) errors.push('variable_documentation.variable_count must be a non-negative integer or null');
  if (!Array.isArray(value.variables) || !stringArray(value.evidence_ids) || !stringArray(value.limitations) || !EVIDENCE_STATES.has(value.evidence_state)) errors.push('variable_documentation evidence fields are invalid');
  if (value.codebook !== null && (!object(value.codebook) || !nonEmpty(value.codebook.title) || safeExternalHttpsUrl(value.codebook.url) === null)) errors.push('variable_documentation.codebook must contain a safe explicit HTTPS URL');
  for (const [index, variable] of arrayOrEmpty(value.variables).entries()) {
    if (!object(variable) || typeof variable.name !== 'string' || typeof variable.description !== 'string'
      || (variable.label !== null && typeof variable.label !== 'string')
      || (variable.data_type !== null && typeof variable.data_type !== 'string')
      || (variable.unit !== null && typeof variable.unit !== 'string')
      || !stringArray(variable.allowed_values) || !stringArray(variable.evidence_ids)
      || !EVIDENCE_STATES.has(variable.evidence_state)) errors.push(`variable_documentation.variables[${index}] is invalid`);
  }
  return errors;
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
  if (!nonEmpty(record.authoritative_url) || (!safeExternalHttpsUrl(record.authoritative_url) && !safePreservedHttpUrl(record.authoritative_url))) errors.push('authoritative_url must be a safe public HTTP or HTTPS source locator');
  const freshness = record.freshness_verification;
  if (object(freshness)) {
    if (!nonEmpty(freshness.metadata_observed_at)) errors.push('freshness_verification.metadata_observed_at must be a timestamp string');
    if (freshness.data_through !== null && typeof freshness.data_through !== 'string') errors.push('freshness_verification.data_through must be string or null');
    if (freshness.next_review_due !== null && typeof freshness.next_review_due !== 'string') errors.push('freshness_verification.next_review_due must be string or null');
    if (!VERIFICATION_STATUSES.has(freshness.verification_status)) errors.push('freshness_verification.verification_status is invalid');
    if (!VERIFICATION_METHODS.has(freshness.verification_method)) errors.push('freshness_verification.verification_method is invalid');
  }
  const provenanceIds = new Set();
  const provenance = arrayOrEmpty(record.provenance);
  const evidence = arrayOrEmpty(record.evidence);
  for (const [index, row] of provenance.entries()) {
    if (!object(row) || !nonEmpty(row.provenance_id) || !isSafeEvidenceLocator(row.locator) || !nonEmpty(row.observed_at)
      || !PROVENANCE_KINDS.has(row.kind) || !CAPTURE_STATES.has(row.capture_state)
      || (row.content_sha256 !== null && typeof row.content_sha256 !== 'string')) errors.push(`provenance[${index}] is incomplete or invalid`);
    else provenanceIds.add(row.provenance_id);
  }
  if (provenance.length === 0) errors.push('provenance must contain at least one row');
  for (const [index, row] of evidence.entries()) {
    if (!object(row) || !nonEmpty(row.evidence_id) || !nonEmpty(row.claim) || !EVIDENCE_STATES.has(row.state) || !stringArray(row.limitations)) errors.push(`evidence[${index}] is incomplete`);
    if (!stringArray(row?.provenance_ids) || row.provenance_ids.length === 0 || row.provenance_ids.some(id => !provenanceIds.has(id))) errors.push(`evidence[${index}] must reference preserved provenance`);
  }
  if (evidence.length === 0) errors.push('evidence must contain at least one row');
  const retrieval = record.retrieval;
  if (object(retrieval)) {
    if (typeof retrieval.machine_actionable !== 'boolean' || !PREFERRED_INTERFACES.has(retrieval.preferred_interface)
      || !Array.isArray(retrieval.instructions) || retrieval.instructions.length === 0
      || !stringArray(retrieval.expected_artifacts) || !nonEmpty(retrieval.failure_policy)) errors.push('retrieval contract is incomplete or invalid');
  }
  for (const [index, step] of arrayOrEmpty(retrieval?.instructions).entries()) {
    if (!object(step) || step.sequence !== index + 1 || !nonEmpty(step.action) || !nonEmpty(step.instruction) || !nonEmpty(step.expected_result) || typeof step.requires_human !== 'boolean') {
      errors.push(`retrieval.instructions[${index}] is incomplete`);
      continue;
    }
    if (!RETRIEVAL_ACTIONS.has(step.action)) errors.push(`retrieval.instructions[${index}].action is invalid`);
    if (step.url !== null && !safeExternalHttpsUrl(step.url) && !safePreservedHttpUrl(step.url)) errors.push(`retrieval.instructions[${index}].url must be a safe public HTTP or HTTPS source locator or null`);
  }
  errors.push(...variableDocumentationErrors(record.variable_documentation));
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
    let errors;
    try {
      errors = browserRecordErrors(record);
    } catch (error) {
      errors = [`record validation could not complete: ${error instanceof Error ? error.message : String(error)}`];
    }
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

/**
 * Suppress known context-collision classifications at the discovery boundary.
 * Canonical captured records remain unchanged; this is a reviewed search aid.
 */
export function reviewedTopics(record) {
  const title = String(record?.title ?? '').toLowerCase();
  const description = String(record?.description ?? '').toLowerCase();
  return (record?.capabilities?.topics ?? []).filter(topic => {
    if (topic.evidence_state !== 'inferred') return true;
    if (topic.id === 'maternal_child_health' && /cigarette smoking among adults/.test(title)) return false;
    if (topic.id === 'hospital_financials' && /unbanked|underbanked/.test(title + ' ' + description)) return false;
    if (topic.id === 'hospital_capacity' && /seismic waveform/.test(title + ' ' + description)) return false;
    return true;
  });
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
  const geographyKnown = record.geography?.coverage_level && record.geography.coverage_level !== 'unknown';
  const inferredUnits = (record.unit_of_analysis ?? []).filter(value => value !== 'unknown').map(value => `unit_of_analysis:${value}`);
  return {
    // The v1.2 wire record has no evidence linkage for unit_of_analysis. Keep
    // those values available as search hints, but never promote them to a
    // claim about the dataset's observation grain.
    observation_grain: { values: [], state: 'unresolved' },
    sampled_entity: { values: [], state: 'unresolved' },
    reporting_organization: { values: [], state: 'unresolved' },
    population_universe: { values: [], state: 'unresolved' },
    geographic_dimensions: {
      values: geographyKnown ? [record.geography.coverage_level, ...(record.geography.jurisdictions ?? [])] : [],
      state: geographyKnown ? record.geography.evidence_state ?? 'source_asserted' : 'unresolved'
    },
    inferred_search_tags: [...new Set([
      ...inferredUnits,
      ...[...reviewedTopics(record), ...(record.capabilities?.use_cases ?? [])]
        .filter(item => item.evidence_state === 'inferred').map(item => item.id)
    ])]
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

export function documentedPublicPayload(record) {
  const status = record.access?.status;
  const title = String(record.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');

  // A restriction on the indexed asset takes precedence over public-access
  // references, which may describe a different product in the same family.
  if (documentedRestrictedPayload(record)) return false;
  if (status === 'public_direct') return true;
  if (!['verified_first_party', 'source_asserted'].includes(record.access?.evidence_state)) return false;
  if (/\bpublic use (?:[a-z0-9]+ ){0,3}(?:data|file|dataset)\b/.test(title)) return true;

  // Free text is acceptable only when it grammatically points at this asset.
  // An unqualified mention of another public-use product is not access proof.
  const description = String(record.description ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return /\b(?:this|these)\s+(?:[a-z0-9]+\s+){0,8}(?:public use (?:data|file|dataset)|(?:data|dataset|file)s? (?:is|are|remain|remains|will remain|will continue to be) publicly available)\b/.test(description);
}

export function accessDimensions(record) {
  const status = record.access?.status ?? 'unknown';
  const publicPayload = documentedPublicPayload(record);
  const restricted = documentedRestrictedPayload(record);
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
    authoritative_url: verifiedNavigationUrl(record, record.authoritative_url),
    original_authoritative_url: record.authoritative_url ?? null
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
  const accessRoutes = instructions.filter(step => step.action !== 'stop_and_report' && step.url).map(step => {
    const navigationUrl = verifiedNavigationUrl(record, step.url);
    return navigationUrl ? { ...structuredClone(step), original_url: step.url, url: navigationUrl } : null;
  }).filter(Boolean);
  const unresolvedRoutes = instructions.filter(step => step.action !== 'stop_and_report').filter(step => {
    return !step.url || verifiedNavigationUrl(record, step.url) === null;
  }).map(step => ({ ...structuredClone(step), original_url: step.url ?? null, url: null }));
  return {
    access_routes: accessRoutes,
    stop_conditions: instructions.filter(step => step.action === 'stop_and_report').map(step => ({ ...structuredClone(step), url: null })),
    unresolved_routes: unresolvedRoutes,
    route_state: accessRoutes.length
      ? 'route_available'
      : unresolvedRoutes.length ? 'route_unresolved' : 'no_route'
  };
}
