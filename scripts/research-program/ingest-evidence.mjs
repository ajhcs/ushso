#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export const BASELINE_DENOMINATOR = 3434;
export const ATTEMPT_AXES = Object.freeze(['metadata', 'documentation', 'api_file_sample', 'schema_binding']);
export const AXIS_COUNT = BASELINE_DENOMINATOR * ATTEMPT_AXES.length;
export const ATTEMPT_STATES = Object.freeze(['not_attempted', 'succeeded', 'restricted', 'failed', 'blocked', 'unavailable', 'stale', 'unknown']);
export const RECEIPT_KINDS = Object.freeze(['observation_window', 'scheduled_cycle', 'attempt_axis', 'core_cell']);
export const CORE_CELL_FIELDS = Object.freeze(['publisher_access', 'schema_qualification', 'join_route', 'unit_grain_date_denominator']);
export const REQUIRED_ELAPSED_DAYS = 14;
export const REQUIRED_SCHEDULED_CYCLES = 2;
export const METADATA_EVIDENCE_KINDS = Object.freeze(['catalog_json', 'catalog_json_gz', 'corpus_jsonl', 'view_index', 'family_registry', 'synthetic_walkthrough', 'example_packet', 'dictionary_geometry']);
export const PAYLOAD_RESULT_FORMATS = Object.freeze(['json_array', 'json_object', 'csv_rows']);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_RECEIPT_DIR = 'verification/research-program/evidence/receipts';

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function sha256Bytes(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const FILE_SHA_CACHE = new Map();

function sha256File(abs) {
  const cached = FILE_SHA_CACHE.get(abs);
  if (cached) return cached;
  const digest = sha256Bytes(readFileSync(abs));
  FILE_SHA_CACHE.set(abs, digest);
  return digest;
}

function isRfc3339(value) {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}

function containedPath(repoRoot, relative) {
  if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative) || relative.includes('\0')) {
    fail('EVIDENCE_REFERENCE_INVALID', relative);
  }
  const abs = path.resolve(repoRoot, relative);
  const root = realpathSync(repoRoot);
  let resolved;
  try {
    resolved = realpathSync(abs);
  } catch {
    fail('EVIDENCE_REFERENCE_MISSING', relative);
  }
  if (resolved !== root && !resolved.startsWith(root + path.sep)) fail('EVIDENCE_REFERENCE_ESCAPES_REPO', relative);
  if (!statSync(resolved).isFile()) fail('EVIDENCE_REFERENCE_NOT_FILE', relative);
  return resolved;
}

export function loadBaselineIds(repoRoot = ROOT) {
  const cohorts = JSON.parse(readFileSync(path.join(repoRoot, 'evaluation/research-program/cohorts.json'), 'utf8'));
  const ids = (cohorts.baseline_records ?? []).map((row) => row.record_id);
  if (ids.length !== BASELINE_DENOMINATOR) fail('BASELINE_DENOMINATOR_NOT_3434', String(ids.length));
  if (new Set(ids).size !== BASELINE_DENOMINATOR) fail('BASELINE_IDS_NOT_UNIQUE');
  if (cohorts.corpus?.generation !== LAST_GOOD_GENERATION) fail('LAST_GOOD_GENERATION_CHANGED');
  return freeze(ids);
}

function loadJsonRelative(repoRoot, relative) {
  return JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));
}

function loadCohorts(repoRoot = ROOT) {
  return JSON.parse(readFileSync(path.join(repoRoot, 'evaluation/research-program/cohorts.json'), 'utf8'));
}

function frozenProduct(repoRoot, productKey) {
  const cohorts = loadCohorts(repoRoot);
  const product = (cohorts.products ?? []).find((row) => row.product_key === productKey);
  if (!product) fail('PRODUCT_NOT_IN_FROZEN_COHORT', productKey);
  return product;
}

function readEvidenceBytes(abs, relative) {
  const bytes = readFileSync(abs);
  if (relative.endsWith('.gz')) return gunzipSync(bytes);
  return bytes;
}

function parseEvidence(relative, bytes) {
  const text = bytes.toString('utf8');
  if (relative.endsWith('.json') || relative.endsWith('.json.gz')) {
    return { kind: 'json', value: JSON.parse(text), text };
  }
  if (relative.endsWith('.jsonl')) {
    const lines = text.split('\n').filter((line) => line.trim());
    return { kind: 'jsonl', value: lines.map((line) => JSON.parse(line)), text };
  }
  if (relative.endsWith('.csv')) {
    const lines = text.split('\n').filter((line) => line.trim());
    return { kind: 'csv', value: lines, text };
  }
  return { kind: 'bytes', value: null, text };
}

function classifyEvidenceKind(relative, parsed, payload) {
  if (payload.fictional === true || payload.synthetic === true) return 'synthetic_walkthrough';
  if (relative.includes('/mrf-examples/')) return 'synthetic_walkthrough';
  if (relative.includes('/source-registry/')) return 'family_registry';
  if (relative.includes('/cms-cost-grid/')) return 'dictionary_geometry';
  if (relative.includes('/examples/')) return 'example_packet';
  if (relative.includes('cdc-view-index')) return 'view_index';
  if (relative.includes('catalog-slim') || relative.endsWith('data.json') || relative.endsWith('data.json.gz')) return relative.endsWith('.gz') ? 'catalog_json_gz' : 'catalog_json';
  if (relative.includes('/corpus/') && relative.endsWith('.jsonl')) return 'corpus_jsonl';
  if (parsed.kind === 'json' && parsed.value && typeof parsed.value === 'object') {
    if (Array.isArray(parsed.value.dataset) || parsed.value['@type'] === 'dcat:Catalog') return 'catalog_json';
    if (Array.isArray(parsed.value.views) && parsed.value.source_id) return 'view_index';
    if (Array.isArray(parsed.value.families)) return 'family_registry';
    if (parsed.value.parser && Array.isArray(parsed.value.pages)) return 'dictionary_geometry';
  }
  return payload.evidence_kind ?? 'unknown';
}

function evidenceLooksLikeCatalogMetadata(kind, parsed) {
  if (METADATA_EVIDENCE_KINDS.includes(kind)) return true;
  if (parsed.kind === 'json' && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)) {
    if (Array.isArray(parsed.value.dataset) || Array.isArray(parsed.value.views) || Array.isArray(parsed.value.families)) return true;
    if (parsed.value.parser && Array.isArray(parsed.value.pages)) return true;
  }
  return false;
}

function payloadRowsFromParsed(parsed, format) {
  if (format === 'json_array') {
    if (!Array.isArray(parsed.value)) fail('BOUNDED_SAMPLE_NOT_JSON_ARRAY');
    return parsed.value;
  }
  if (format === 'json_object') {
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) fail('BOUNDED_SAMPLE_NOT_JSON_OBJECT');
    const rows = parsed.value.data ?? parsed.value.rows ?? parsed.value.results;
    if (!Array.isArray(rows)) fail('BOUNDED_SAMPLE_OBJECT_HAS_NO_ROWS');
    return rows;
  }
  if (format === 'csv_rows') {
    if (parsed.kind !== 'csv' || parsed.value.length < 2) fail('BOUNDED_SAMPLE_NOT_CSV_ROWS');
    const header = parsed.value[0].split(',').map((cell) => cell.trim());
    return parsed.value.slice(1).map((line) => {
      const cells = line.split(',');
      return Object.fromEntries(header.map((name, index) => [name, cells[index]]));
    });
  }
  fail('BOUNDED_SAMPLE_RESULT_FORMAT');
}

function requireIdentityMatch(product, payload) {
  const representative = product.anchor?.representative ?? {};
  const frozenRecordId = representative.record_id ?? null;
  const frozenNativeId = representative.native_id ?? null;
  if (payload.record_id && frozenRecordId && payload.record_id !== frozenRecordId) fail('SAMPLE_RECORD_ID_MISMATCH');
  if (payload.native_product_id !== frozenNativeId) fail('SAMPLE_NATIVE_ID_MISMATCH');
  if (typeof payload.release_id !== 'string' || !payload.release_id.trim()) fail('BOUNDED_SAMPLE_RELEASE_ID_REQUIRED');
  if (payload.release_id === frozenNativeId) fail('SAMPLE_RELEASE_EQUALS_NATIVE_ID');
  if (payload.vintage_substitution === true) fail('VINTAGE_SUBSTITUTION_FORBIDDEN');
  if (typeof frozenNativeId === 'string' && /20\d{2}/.test(frozenNativeId)) {
    const frozenYear = frozenNativeId.match(/20\d{2}/g)?.at(-1);
    const claimedYear = String(payload.release_id).match(/20\d{2}/g)?.at(-1);
    if (frozenYear && claimedYear && frozenYear !== claimedYear) fail('VINTAGE_SUBSTITUTION_FORBIDDEN');
  }
}

function requirePayloadExecution(payload, parsed, kind) {
  const execution = payload.execution;
  if (!execution || typeof execution !== 'object') fail('BOUNDED_SAMPLE_EXECUTION_REQUIRED');
  if (execution.kind !== 'bounded_http_sample' && execution.kind !== 'bounded_file_sample') fail('BOUNDED_SAMPLE_EXECUTION_KIND');
  if (!isRfc3339(execution.started_at) || !isRfc3339(execution.ended_at)) fail('BOUNDED_SAMPLE_EXECUTION_TIMESTAMPS');
  if (Date.parse(execution.ended_at) < Date.parse(execution.started_at)) fail('BOUNDED_SAMPLE_EXECUTION_INVERTED');
  if (execution.kind === 'bounded_http_sample') {
    if (typeof execution.request_url !== 'string' || !execution.request_url.trim()) fail('BOUNDED_SAMPLE_REQUEST_URL');
    if (typeof execution.final_url !== 'string' || !execution.final_url.trim()) fail('BOUNDED_SAMPLE_FINAL_URL');
    if (!Number.isSafeInteger(execution.http_status) || execution.http_status < 200 || execution.http_status > 299) fail('BOUNDED_SAMPLE_HTTP_STATUS');
    if (typeof execution.content_type !== 'string' || (!execution.content_type.includes('json') && execution.content_type !== 'text/csv')) fail('BOUNDED_SAMPLE_CONTENT_TYPE');
    if (!Number.isSafeInteger(execution.redirects) || execution.redirects < 0) fail('BOUNDED_SAMPLE_REDIRECTS');
    if (!Array.isArray(execution.redirect_chain)) fail('BOUNDED_SAMPLE_REDIRECT_CHAIN');
    if (execution.redirect_chain.length !== execution.redirects) fail('BOUNDED_SAMPLE_REDIRECT_CHAIN_LENGTH');
  }
  if (!PAYLOAD_RESULT_FORMATS.includes(payload.result_format)) fail('BOUNDED_SAMPLE_RESULT_FORMAT');
  if (evidenceLooksLikeCatalogMetadata(kind, parsed)) fail('CATALOG_METADATA_IS_NOT_PAYLOAD_SAMPLE');
  const rows = payloadRowsFromParsed(parsed, payload.result_format);
  if (!Array.isArray(rows) || rows.length === 0) fail('BOUNDED_SAMPLE_EMPTY_ROWS');
  if (!Number.isSafeInteger(payload.row_count) || payload.row_count !== rows.length) fail('BOUNDED_SAMPLE_ROW_COUNT');
  const checks = payload.identity_checks;
  if (!checks || typeof checks !== 'object' || !checks.required_fields || typeof checks.required_fields !== 'object') fail('BOUNDED_SAMPLE_IDENTITY_CHECKS');
  for (const [field, typeName] of Object.entries(checks.required_fields)) {
    const value = rows[0]?.[field];
    if (value == null || value === '') fail('BOUNDED_SAMPLE_IDENTITY_FIELD_MISSING', field);
    if (typeName === 'string' && typeof value !== 'string') fail('BOUNDED_SAMPLE_IDENTITY_TYPE', field);
  }
  if (checks.constraints && typeof checks.constraints === 'object') {
    for (const [field, constraint] of Object.entries(checks.constraints)) {
      const value = String(rows[0]?.[field] ?? '');
      if (constraint?.pattern && !new RegExp(constraint.pattern).test(value)) fail('BOUNDED_SAMPLE_RELEASE_CONSTRAINT', field);
      if (Array.isArray(constraint?.allowed) && !constraint.allowed.includes(value)) fail('BOUNDED_SAMPLE_RELEASE_CONSTRAINT', field);
    }
  }
  payload._derived_payload_sample = true;
  payload._derived_row_count = rows.length;
}

export function listReceiptFiles(repoRoot = ROOT, relativeDir = DEFAULT_RECEIPT_DIR) {
  const dir = path.join(repoRoot, relativeDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(relativeDir, name));
}

function authGranted(register, authorization, { candidateHead, environment, action = null }) {
  if (!authorization || typeof authorization !== 'object') return false;
  if (authorization.authorized !== true) return false;
  if (authorization.candidate_head && authorization.candidate_head !== candidateHead) return false;
  if (action === 'payload_retrieval') {
    if (authorization.id === 'AUTH-04') return false;
    return ['AUTH-PAYLOAD-PILOT', 'AUTH-PAYLOAD-RETRIEVAL'].includes(authorization.id);
  }
  if (environment === 'fixture') return authorization.environment === 'fixture' && authorization.id === 'AUTH-FIXTURE';
  const entries = register?.entries ?? [];
  const row = entries.find((item) => item.id === authorization.id);
  if (!row) return false;
  if (row.authorized !== true) return false;
  if (environment === 'staging' && authorization.id !== 'AUTH-03') return false;
  if (environment === 'production' && !['AUTH-06', 'AUTH-07'].includes(authorization.id)) return false;
  return true;
}

export function validateReceipt(receipt, {
  repoRoot = ROOT,
  seenIds = new Set(),
  seenAttemptKeys = new Set(),
  seenCycleIds = new Set(),
  seenSchedulerRunIds = new Set(),
  seenCoreKeys = new Set(),
  currentCandidateHead = null,
  currentCandidateTree = null,
  authorizationRegister = null,
} = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('RECEIPT_NOT_OBJECT');
  if (receipt.format !== 'ushso.evidence-receipt.v1') fail('RECEIPT_FORMAT');
  if (typeof receipt.receipt_id !== 'string' || !receipt.receipt_id.trim()) fail('RECEIPT_ID_REQUIRED');
  if (seenIds.has(receipt.receipt_id)) fail('DUPLICATE_RECEIPT_ID', receipt.receipt_id);
  seenIds.add(receipt.receipt_id);
  if (!RECEIPT_KINDS.includes(receipt.kind)) fail('RECEIPT_KIND_UNKNOWN', String(receipt.kind));
  if (receipt.generation !== LAST_GOOD_GENERATION) fail('RECEIPT_GENERATION_MISMATCH');
  if (currentCandidateHead && receipt.candidate_head !== currentCandidateHead) fail('STALE_CANDIDATE_HEAD');
  if (currentCandidateTree && receipt.candidate_tree && receipt.candidate_tree !== currentCandidateTree) fail('STALE_CANDIDATE_TREE');
  if (!isRfc3339(receipt.recorded_at)) fail('RECEIPT_RECORDED_AT');
  if (!/^[a-f0-9]{64}$/.test(receipt.evidence_sha256 ?? '')) fail('EVIDENCE_SHA256_REQUIRED');
  const abs = containedPath(repoRoot, receipt.evidence_reference);
  const actual = sha256File(abs);
  if (actual !== receipt.evidence_sha256) fail('EVIDENCE_SHA256_MISMATCH', receipt.evidence_reference);
  if (receipt.incomplete === true) fail('INCOMPLETE_RECEIPT');
  if (receipt.accepted === true) fail('RECEIPT_CANNOT_SET_ACCEPTED');
  if (receipt.scientific_approval === true) fail('RECEIPT_CANNOT_GRANT_SCIENTIFIC_APPROVAL');
  const payload = receipt.payload;
  if (!payload || typeof payload !== 'object') fail('RECEIPT_PAYLOAD_REQUIRED');

  if (receipt.kind === 'attempt_axis') {
    if (!payload.record_id || typeof payload.record_id !== 'string') fail('ATTEMPT_RECORD_ID');
    if (!ATTEMPT_AXES.includes(payload.axis)) fail('ATTEMPT_AXIS');
    if (!ATTEMPT_STATES.includes(payload.attempt_state)) fail('ATTEMPT_STATE');
    const key = `${payload.record_id}\u0000${payload.axis}`;
    if (seenAttemptKeys.has(key)) fail('DUPLICATE_ATTEMPT_AXIS', key);
    seenAttemptKeys.add(key);
    if (payload.attempt_state === 'not_attempted' && payload.attempted_at != null) fail('NOT_ATTEMPTED_HAS_TIME');
    if (payload.attempt_state !== 'not_attempted' && !isRfc3339(payload.attempted_at)) fail('ATTEMPT_TIME_REQUIRED');
    if (payload.attempt_state !== 'succeeded' && typeof payload.stop_reason !== 'string') fail('STOP_REASON_REQUIRED');
    if (!['eligible', 'not_applicable', 'blocked', 'unknown'].includes(payload.eligibility)) fail('ELIGIBILITY_REQUIRED');
  }

  if (receipt.kind === 'observation_window') {
    if (!['fixture', 'staging', 'production'].includes(payload.environment)) fail('OBSERVATION_ENVIRONMENT');
    if (!isRfc3339(payload.observation_started_at) || !isRfc3339(payload.observation_ended_at)) fail('OBSERVATION_TIMESTAMPS');
    if (Date.parse(payload.observation_ended_at) <= Date.parse(payload.observation_started_at)) fail('OBSERVATION_WINDOW_INVERTED');
    if (Date.parse(payload.observation_ended_at) > Date.now() + 86400000) fail('OBSERVATION_WINDOW_IN_FUTURE');
    if (payload.generated_dates === true || payload.simulated_operation === true) fail('GENERATED_DATES_OR_SIMULATION_FORBIDDEN');
    if (!payload.deployment?.deployment_id || !payload.deployment?.version_id) fail('OBSERVATION_DEPLOYMENT_REQUIRED');
    if (currentCandidateHead && payload.deployment.candidate_head && payload.deployment.candidate_head !== currentCandidateHead) fail('OBSERVATION_DEPLOYMENT_CANDIDATE_MISMATCH');
    if (!authGranted(authorizationRegister, payload.authorization, {
      candidateHead: receipt.candidate_head,
      environment: payload.environment,
    })) fail('AUTH_NOT_GRANTED');
  }

  if (receipt.kind === 'core_cell') {
    if (typeof payload.product_key !== 'string' || !payload.product_key.trim()) fail('CORE_PRODUCT_KEY');
    if (!CORE_CELL_FIELDS.includes(payload.field)) fail('CORE_CELL_FIELD');
    const key = `${payload.product_key}\u0000${payload.field}`;
    if (seenCoreKeys.has(key)) fail('DUPLICATE_CORE_CELL', key);
    seenCoreKeys.add(key);
    if (payload.unknown === true && payload.supported === true) fail('UNKNOWN_CELL_CANNOT_COUNT_AS_SUPPORTED');
    if (typeof payload.recipe !== 'string' || !payload.recipe.trim()) fail('CORE_CELL_RECIPE_REQUIRED');
    const knownUnsupported = payload.supported === false && payload.unknown === false;
    if (payload.bounded_sample !== true && payload.verified_route !== true && !knownUnsupported) {
      fail('CORE_CELL_SAMPLE_OR_ROUTE_REQUIRED');
    }
    if (knownUnsupported && typeof payload.limitation !== 'string') fail('CORE_CELL_LIMITATION_REQUIRED');
    const evidenceBytes = readEvidenceBytes(abs, receipt.evidence_reference);
    const parsedEvidence = parseEvidence(receipt.evidence_reference, evidenceBytes);
    const evidenceKind = classifyEvidenceKind(receipt.evidence_reference, parsedEvidence, payload);
    payload._evidence_kind = evidenceKind;
    if (payload.live_http === true) {
      if (!authGranted(authorizationRegister, payload.authorization, {
        candidateHead: receipt.candidate_head,
        environment: payload.authorization?.environment ?? 'staging_egress',
        action: 'payload_retrieval',
      })) fail('UNAUTHORIZED_LIVE_HTTP');
    } else if (payload.bounded_sample === true && payload.execution?.kind === 'bounded_http_sample') {
      fail('HTTP_SAMPLE_ORIGIN_MUST_BE_TRUTHFUL');
    }
    if (payload.catalog_membership_as_sample === true) fail('CATALOG_MEMBERSHIP_IS_NOT_PAYLOAD_SAMPLE');
    if (payload.vintage_substitution === true) fail('VINTAGE_SUBSTITUTION_FORBIDDEN');
    if ((payload.fictional === true || payload.synthetic === true || evidenceKind === 'synthetic_walkthrough') && payload.bounded_sample === true) {
      fail('FICTIONAL_WALKTHROUGH_IS_NOT_LIVE_SAMPLE');
    }
    if ((payload.family_workflow_as_verified_route === true || evidenceKind === 'family_registry') && payload.verified_route === true) {
      fail('FAMILY_WORKFLOW_IS_NOT_VERIFIED_ROUTE');
    }
    if ((payload.eligible_for_schema_promotion === true || evidenceKind === 'dictionary_geometry') && payload.bounded_sample === true) {
      fail('DICTIONARY_GEOMETRY_IS_NOT_PAYLOAD_SAMPLE');
    }
    if (payload.bounded_sample === true) {
      if (payload.supported === false) fail('BOUNDED_SAMPLE_CANNOT_BE_UNSUPPORTED');
      const product = frozenProduct(repoRoot, payload.product_key);
      requireIdentityMatch(product, payload);
      requirePayloadExecution(payload, parsedEvidence, evidenceKind);
      if (payload.payload_success !== true) fail('BOUNDED_SAMPLE_REQUIRES_PAYLOAD_SUCCESS');
      payload.supported = true;
      payload.unknown = false;
    } else {
      payload._derived_payload_sample = false;
      if (evidenceLooksLikeCatalogMetadata(evidenceKind, parsedEvidence) && payload.supported === true && payload.field === 'publisher_access') {
        fail('CATALOG_METADATA_CANNOT_SUPPORT_PUBLISHER_ACCESS');
      }
    }
    if (payload.verified_route === true) {
      if (payload.payload_success === true && payload.bounded_sample !== true) fail('VERIFIED_ROUTE_IS_NOT_AUTOMATIC_SAMPLE');
      if (typeof payload.route_id !== 'string' || !payload.route_id.trim()) fail('VERIFIED_ROUTE_ID_REQUIRED');
    }
  }

  if (receipt.kind === 'scheduled_cycle') {
    if (typeof payload.cycle_id !== 'string' || !payload.cycle_id.trim()) fail('CYCLE_ID_REQUIRED');
    if (seenCycleIds.has(payload.cycle_id)) fail('DUPLICATE_CYCLE_ID', payload.cycle_id);
    seenCycleIds.add(payload.cycle_id);
    if (!isRfc3339(payload.started_at) || !isRfc3339(payload.completed_at)) fail('CYCLE_TIMESTAMPS');
    if (Date.parse(payload.completed_at) <= Date.parse(payload.started_at)) fail('CYCLE_TIMESTAMPS_INVERTED');
    if (typeof payload.scheduler_run_id !== 'string' || !payload.scheduler_run_id.trim()) fail('SCHEDULER_RUN_ID_REQUIRED');
    if (seenSchedulerRunIds.has(payload.scheduler_run_id)) fail('DUPLICATE_SCHEDULER_RUN_ID', payload.scheduler_run_id);
    seenSchedulerRunIds.add(payload.scheduler_run_id);
    payload._scheduler_run_id = payload.scheduler_run_id;
    if (payload.generated_dates === true || payload.simulated_operation === true) fail('GENERATED_DATES_OR_SIMULATION_FORBIDDEN');
    if (typeof payload.complete !== 'boolean') fail('CYCLE_COMPLETE_FLAG');
    const after = payload.after_refresh ?? {};
    payload._after_refresh_complete = ['examples_checked', 'schemas_checked', 'joins_checked', 'cross_surface_checked']
      .every((key) => after[key] === true);
  }

  return freeze({ ...receipt, payload });
}

export function loadAndValidateReceipts({
  repoRoot = ROOT,
  relativeDir = DEFAULT_RECEIPT_DIR,
  currentCandidateHead = null,
  currentCandidateTree = null,
  authorizationRegister = null,
} = {}) {
  const seenIds = new Set();
  const seenAttemptKeys = new Set();
  const seenCycleIds = new Set();
  const seenSchedulerRunIds = new Set();
  const seenCoreKeys = new Set();
  const files = listReceiptFiles(repoRoot, relativeDir);
  const receipts = [];
  for (const relative of files) {
    const parsed = JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));
    const items = parsed.format === 'ushso.core-cell-receipt-bundle.v1' && Array.isArray(parsed.receipts)
      ? parsed.receipts
      : [parsed];
    for (const item of items) {
      receipts.push(validateReceipt(item, {
        repoRoot,
        seenIds,
        seenAttemptKeys,
        seenCycleIds,
        seenSchedulerRunIds,
        seenCoreKeys,
        currentCandidateHead,
        currentCandidateTree,
        authorizationRegister,
      }));
    }
  }
  return freeze(receipts);
}

function elapsedDays(startedAt, endedAt) {
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) fail('OBSERVATION_WINDOW_INVERTED');
  return Math.floor(ms / 86400000);
}

export function calculateObservation(receipts = []) {
  const windows = receipts.filter((row) => row.kind === 'observation_window');
  const cycles = receipts.filter((row) => row.kind === 'scheduled_cycle');
  if (windows.length > 1) fail('DUPLICATE_OBSERVATION_WINDOW');
  const window = windows[0] ?? null;
  const days = window ? elapsedDays(window.payload.observation_started_at, window.payload.observation_ended_at) : 0;
  const runIds = new Set();
  const completeCycles = [];
  if (window && Date.parse(window.payload.observation_ended_at) > Date.now() + 86400000) fail('OBSERVATION_WINDOW_IN_FUTURE');
  for (const cycle of cycles) {
    if (runIds.has(cycle.payload.scheduler_run_id)) fail('DUPLICATE_SCHEDULER_RUN_ID', cycle.payload.scheduler_run_id);
    runIds.add(cycle.payload.scheduler_run_id);
    const start = Date.parse(cycle.payload.started_at);
    const end = Date.parse(cycle.payload.completed_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) fail('CYCLE_TIMESTAMPS_INVERTED');
    if (window) {
      const windowStart = Date.parse(window.payload.observation_started_at);
      const windowEnd = Date.parse(window.payload.observation_ended_at);
      if (start < windowStart || end > windowEnd) fail('CYCLE_OUTSIDE_OBSERVATION_WINDOW', cycle.payload.cycle_id);
      if (cycle.payload.environment && cycle.payload.environment !== window.payload.environment) fail('CYCLE_ENVIRONMENT_MISMATCH');
      if (cycle.payload.deployment?.deployment_id && cycle.payload.deployment.deployment_id !== window.payload.deployment.deployment_id) fail('CYCLE_DEPLOYMENT_MISMATCH');
      if (cycle.candidate_head && window.candidate_head && cycle.candidate_head !== window.candidate_head) fail('CYCLE_CANDIDATE_MISMATCH');
    } else if (cycle.payload.complete === true) {
      fail('CYCLE_WITHOUT_OBSERVATION_WINDOW');
    }
    if (cycle.payload.complete === true && cycle.payload._after_refresh_complete === true) completeCycles.push(cycle);
  }
  const environment = window?.payload.environment ?? null;
  const deployedProduct = environment === 'staging' || environment === 'production';
  const technicalSuccess = deployedProduct
    && days >= REQUIRED_ELAPSED_DAYS
    && completeCycles.length >= REQUIRED_SCHEDULED_CYCLES;
  const empty = window == null && cycles.length === 0;
  return freeze({
    elapsed_observation_days: days,
    complete_scheduled_cycles: completeCycles.length,
    required_elapsed_days: REQUIRED_ELAPSED_DAYS,
    required_scheduled_cycles: REQUIRED_SCHEDULED_CYCLES,
    environment,
    deployed_product_observation: deployedProduct,
    fixture_observation_cannot_satisfy_r15: environment === 'fixture',
    generated_dates: false,
    simulated_operation: false,
    scheduler_created: true,
    scheduler_ran: completeCycles.length > 0,
    scheduler_created_is_not_evidence_it_ran: completeCycles.length === 0,
    missing_observation_time: days < REQUIRED_ELAPSED_DAYS,
    missing_or_failed_cycle: completeCycles.length < REQUIRED_SCHEDULED_CYCLES,
    technical_success: technicalSuccess,
    scientific_approval: false,
    result: technicalSuccess ? 'observed' : (empty ? 'unverified' : 'fail'),
  });
}

export function calculateAttemptLedger(receipts = [], baselineIds = loadBaselineIds()) {
  if (!Array.isArray(baselineIds) || baselineIds.length === 0) fail('BASELINE_EMPTY');
  if (new Set(baselineIds).size !== baselineIds.length) fail('BASELINE_IDS_NOT_UNIQUE');
  const idSet = new Set(baselineIds);
  const axes = new Map();
  for (const recordId of baselineIds) {
    for (const axis of ATTEMPT_AXES) {
      axes.set(`${recordId}\u0000${axis}`, freeze({
        record_id: recordId,
        axis,
        eligibility: 'unknown',
        attempt_state: 'not_attempted',
        stop_reason: 'attempt ledger seeded; not_attempted is not success',
        attempted_at: null,
      }));
    }
  }
  let applied = 0;
  for (const receipt of receipts.filter((row) => row.kind === 'attempt_axis')) {
    if (!idSet.has(receipt.payload.record_id)) fail('ATTEMPT_RECORD_NOT_IN_BASELINE', receipt.payload.record_id);
    const key = `${receipt.payload.record_id}\u0000${receipt.payload.axis}`;
    axes.set(key, freeze({
      record_id: receipt.payload.record_id,
      axis: receipt.payload.axis,
      eligibility: receipt.payload.eligibility,
      attempt_state: receipt.payload.attempt_state,
      stop_reason: receipt.payload.stop_reason ?? null,
      attempted_at: receipt.payload.attempted_at ?? null,
    }));
    applied += 1;
  }
  const rows = [...axes.values()];
  const combinations = baselineIds.length * ATTEMPT_AXES.length;
  if (rows.length !== combinations) fail('AXIS_COUNT_MISMATCH', String(rows.length));
  const byState = Object.fromEntries(ATTEMPT_STATES.map((state) => [state, 0]));
  for (const row of rows) byState[row.attempt_state] += 1;
  const succeeded = byState.succeeded;
  const notAttempted = byState.not_attempted;
  if (succeeded > 0 && notAttempted === combinations) fail('SUCCESS_TOTAL_COUNTS_UNATTEMPTED_WORK');
  const idsAccounted = new Set(rows.map((row) => row.record_id)).size;
  const silentLoss = idsAccounted !== baselineIds.length;
  const r03Fail = notAttempted > 0 || silentLoss || rows.some((row) => !row.attempt_state);
  return freeze({
    format: 'ushso.attempt-ledger-summary.v1',
    generation: LAST_GOOD_GENERATION,
    baseline_ids: baselineIds.length,
    axes: ATTEMPT_AXES.slice(),
    combinations,
    combinations_accounted: rows.length,
    source_run_dispositions: freeze(byState),
    receipts_applied: applied,
    silent_loss: silentLoss,
    not_attempted_is_not_success: true,
    success_total_counts_unattempted_work: false,
    identity_accounted: !silentLoss && idsAccounted === baselineIds.length,
    r01: freeze({
      id: 'R01',
      accepted: false,
      result: silentLoss ? 'fail' : 'unverified',
      evidence: silentLoss
        ? 'Silent loss: not every frozen baseline ID is present in the attempt ledger.'
        : `${baselineIds.length} baseline IDs are present. Attempt-axis accounting is ${rows.length}/${combinations}. Source-run dispositions remain predominantly not_attempted; identity accounting is not a completed successful source-run ledger.`,
    }),
    r03: freeze({
      id: 'R03',
      accepted: false,
      result: r03Fail ? 'fail' : 'unverified',
      evidence: `${rows.length}/${combinations} record/axis combinations accounted. not_attempted=${notAttempted}. not_attempted is not success.`,
    }),
    scientific_approval: false,
  });
}

export function ingestEvidence({
  repoRoot = ROOT,
  relativeDir = DEFAULT_RECEIPT_DIR,
  currentCandidateHead = null,
  currentCandidateTree = null,
  authorizationRegister = null,
  baselineIds = null,
  receipts = null,
} = {}) {
  const register = authorizationRegister ?? loadJsonRelative(repoRoot, 'verification/external-authorization/v1.0.0/register.json');
  const validated = receipts ?? loadAndValidateReceipts({
    repoRoot,
    relativeDir,
    currentCandidateHead,
    currentCandidateTree,
    authorizationRegister: register,
  });
  const observation = calculateObservation(validated);
  const attempts = calculateAttemptLedger(validated, baselineIds ?? loadBaselineIds(repoRoot));
  return freeze({
    format: 'ushso.evidence-ingestion-report.v1',
    generation: LAST_GOOD_GENERATION,
    receipts: validated,
    receipt_count: validated.length,
    observation,
    attempts,
    accepted_flags_edited: false,
    scientific_approval: false,
    technical_success_is_not_scientific_approval: true,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = ingestEvidence();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
