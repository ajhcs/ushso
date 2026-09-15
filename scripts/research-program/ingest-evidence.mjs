#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export const BASELINE_DENOMINATOR = 3434;
export const ATTEMPT_AXES = Object.freeze(['metadata', 'documentation', 'api_file_sample', 'schema_binding']);
export const AXIS_COUNT = BASELINE_DENOMINATOR * ATTEMPT_AXES.length;
export const ATTEMPT_STATES = Object.freeze(['not_attempted', 'succeeded', 'restricted', 'failed', 'blocked', 'unavailable', 'stale', 'unknown']);
export const RECEIPT_KINDS = Object.freeze(['observation_window', 'scheduled_cycle', 'attempt_axis']);
export const REQUIRED_ELAPSED_DAYS = 14;
export const REQUIRED_SCHEDULED_CYCLES = 2;

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

function sha256File(abs) {
  return sha256Bytes(readFileSync(abs));
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

export function listReceiptFiles(repoRoot = ROOT, relativeDir = DEFAULT_RECEIPT_DIR) {
  const dir = path.join(repoRoot, relativeDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(relativeDir, name));
}

function authGranted(register, authorization, { candidateHead, environment }) {
  if (!authorization || typeof authorization !== 'object') return false;
  if (authorization.authorized !== true) return false;
  if (authorization.candidate_head && authorization.candidate_head !== candidateHead) return false;
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
    if (Date.parse(payload.observation_ended_at) < Date.parse(payload.observation_started_at)) fail('OBSERVATION_WINDOW_INVERTED');
    if (payload.generated_dates === true || payload.simulated_operation === true) fail('GENERATED_DATES_OR_SIMULATION_FORBIDDEN');
    if (!payload.deployment?.deployment_id || !payload.deployment?.version_id) fail('OBSERVATION_DEPLOYMENT_REQUIRED');
    if (!authGranted(authorizationRegister, payload.authorization, {
      candidateHead: receipt.candidate_head,
      environment: payload.environment,
    })) fail('AUTH_NOT_GRANTED');
  }

  if (receipt.kind === 'scheduled_cycle') {
    if (typeof payload.cycle_id !== 'string' || !payload.cycle_id.trim()) fail('CYCLE_ID_REQUIRED');
    if (seenCycleIds.has(payload.cycle_id)) fail('DUPLICATE_CYCLE_ID', payload.cycle_id);
    seenCycleIds.add(payload.cycle_id);
    if (!isRfc3339(payload.started_at) || !isRfc3339(payload.completed_at)) fail('CYCLE_TIMESTAMPS');
    if (typeof payload.scheduler_run_id !== 'string' || !payload.scheduler_run_id.trim()) fail('SCHEDULER_RUN_ID_REQUIRED');
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
  const files = listReceiptFiles(repoRoot, relativeDir);
  const receipts = [];
  for (const relative of files) {
    const parsed = JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));
    receipts.push(validateReceipt(parsed, {
      repoRoot,
      seenIds,
      seenAttemptKeys,
      seenCycleIds,
      currentCandidateHead,
      currentCandidateTree,
      authorizationRegister,
    }));
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
  const completeCycles = cycles.filter((row) => row.payload.complete === true && row.payload._after_refresh_complete === true).length;
  const environment = window?.payload.environment ?? null;
  const deployedProduct = environment === 'staging' || environment === 'production';
  const technicalSuccess = deployedProduct
    && days >= REQUIRED_ELAPSED_DAYS
    && completeCycles >= REQUIRED_SCHEDULED_CYCLES;
  const empty = window == null && cycles.length === 0;
  return freeze({
    elapsed_observation_days: days,
    complete_scheduled_cycles: completeCycles,
    required_elapsed_days: REQUIRED_ELAPSED_DAYS,
    required_scheduled_cycles: REQUIRED_SCHEDULED_CYCLES,
    environment,
    deployed_product_observation: deployedProduct,
    fixture_observation_cannot_satisfy_r15: environment === 'fixture',
    generated_dates: false,
    simulated_operation: false,
    scheduler_created: true,
    scheduler_ran: completeCycles > 0,
    scheduler_created_is_not_evidence_it_ran: completeCycles === 0,
    missing_observation_time: days < REQUIRED_ELAPSED_DAYS,
    missing_or_failed_cycle: completeCycles < REQUIRED_SCHEDULED_CYCLES,
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
