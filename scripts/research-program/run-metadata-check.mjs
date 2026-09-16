#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateMetadataCheck } from './validate-metadata-check.mjs';
import { payloadSampleCountsFromReceipts } from './qualify-core.mjs';
import { loadCohort } from '../../packages/coverage/research-program/v1.0.0/src/core-readiness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKET_REL = 'verification/research-program/evidence/metadata-check-packet.json';
const AUTH_REL = 'verification/research-program/authorization/metadata-authorizations.json';
const EXPECTED_COHORTS = '89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543';
const LEDGER_FORMAT = 'ushso.metadata-check-ledger.v1';

// Single coherent corrected operation (20260917, integration branch int2).
// The runner resolves every path/endpoint/auth binding FROM packet+auth config
// via resolveMetadataOperation(). Nothing here may fall back to the spent
// wrong-endpoint ledger (metadata-check-ledger.json, 2 used/0 remaining on the
// prior AUTH entry): that file is preserved as history and is never referenced.
export const METADATA_OPERATION_ID = 'OP-METADATA-CHECK-CORRECTED-20260917';
export const METADATA_PACKET_VERSION = 'ushso.metadata-check-packet.v2';
export const METADATA_RECEIPT_FORMAT = 'ushso.metadata-receipt.v1';
export const METADATA_RECEIPT_KIND = 'metadata_check';
export const METADATA_RECEIPT_FIELD = 'source_metadata';
export const METADATA_RUN_FORMAT = 'ushso.metadata-check-run.v2';
export const METADATA_ATTEMPT_FORMAT = 'ushso.metadata-check-attempt.v2';
export const METADATA_AUTH_ID = 'AUTH-METADATA-CHECK-CORRECTED-20260917';
export const CORRECTED_LEDGER_REL = 'verification/research-program/evidence/metadata-check-ledger-corrected-20260917.json';
export const SPENT_LEDGER_REL = 'verification/research-program/evidence/metadata-check-ledger.json';
export const CMS_METADATA_URL = 'https://data.cms.gov/data-api/v1/dataset-resources/44060663-47d8-4ced-a115-b53b4c270acb';
export const CDC_METADATA_URL = 'https://data.cdc.gov/api/views/swc5-untb.json';
export const CMS_DATASET_UUID = '44060663-47d8-4ced-a115-b53b4c270acb';
export const CDC_VIEW_ID = 'swc5-untb';
export const CMS_PARSER_VERSION = 'cms-dataset-resources.v1';
export const CDC_PARSER_VERSION = 'cdc-socrata-view.v1';
export const CMS_CLAIMED_RELEASE = 'CostReport_2023_Final';
export const CDC_CLAIMED_RELEASE = 'PLACES_2025_county_table';
// Correction 20260917 (see docs/research-program/metadata-endpoint-deviation-20260917.md):
// the bounded payload endpoints below must never satisfy the metadata authorization, even if a
// stale AUTH entry still lists them. Metadata endpoints are dataset-resources + api/views only.
const FORBIDDEN_PAYLOAD_ENDPOINTS = Object.freeze([
  'https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data?size=5',
  'https://data.cdc.gov/resource/swc5-untb.json?$limit=5',
]);

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function gitHead(repoRoot = ROOT) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function executionSha() {
  return sha256(readFileSync(fileURLToPath(import.meta.url)));
}

// Strict execution-time authorization (branch-agnostic): exact candidate HEAD +
// AUTH materialization + validity window. Branch name is intentionally NOT checked;
// HEAD equality is the binding. Endpoints, frozen SHA, budget, and lock are
// enforced separately before any fetch. Offline validation (validate-*.mjs) must
// pass anywhere; this function must fail closed before any live HTTP.
// Window uses wall-clock time (wallNow, default Date.now), not the mocked deadline
// clock `now` used for request timeouts.
function assertMetadataExecutionAuthorized(entry, head, wallNow = Date.now) {
  if (!entry || entry.authorized !== true) fail('METADATA_AUTH_NOT_MATERIALIZED');
  if (entry.status && entry.status !== 'authorized') fail('METADATA_AUTH_NOT_MATERIALIZED');
  if (entry.revoked === true) fail('METADATA_AUTH_REVOKED');
  if (!entry.candidate_head || entry.candidate_head !== head) fail('METADATA_AUTH_NOT_MATERIALIZED');
  const t = (typeof wallNow === 'function' ? wallNow() : wallNow);
  if (entry.valid_from && !(Date.parse(entry.valid_from) <= t)) fail('METADATA_AUTH_NOT_YET_VALID');
  if (entry.valid_until && !(t <= Date.parse(entry.valid_until))) fail('METADATA_AUTH_EXPIRED');
}

export { assertMetadataExecutionAuthorized };

// Pure binding resolution: the single coherent operation is read FROM the packet
// (operation block) joined against the authorization register (corrected entry).
// Every path the collector writes (ledger, captures, receipts, attempts, lock,
// run report) comes from this binding. There is deliberately NO fallback to the
// spent wrong-endpoint ledger: a missing or mismatched binding fails closed here,
// before any fetch, budget mutation, or file write.
export function resolveMetadataOperation({ repoRoot = ROOT } = {}) {
  const packet = JSON.parse(readFileSync(path.join(repoRoot, PACKET_REL), 'utf8'));
  if (packet.format !== METADATA_PACKET_VERSION) fail('METADATA_PACKET_VERSION', String(packet.format));
  const op = packet.operation;
  if (!op || op.id !== METADATA_OPERATION_ID) fail('METADATA_OPERATION_UNRESOLVED', String(op?.id));
  if (op.packet_version !== METADATA_PACKET_VERSION) fail('METADATA_OPERATION_VERSION', String(op.packet_version));
  if (!op.auth_id || op.auth_id !== METADATA_AUTH_ID) fail('METADATA_OPERATION_AUTH', String(op.auth_id));
  if (!op.ledger || op.ledger === SPENT_LEDGER_REL) fail('METADATA_SPENT_LEDGER_FALLBACK', String(op.ledger));
  if (op.ledger !== CORRECTED_LEDGER_REL) fail('METADATA_OPERATION_LEDGER', String(op.ledger));
  for (const rel of [op.capture_dir, op.receipt_dir, op.attempt_dir, op.lock, op.run_report]) {
    if (typeof rel !== 'string' || rel.length < 1) fail('METADATA_OPERATION_PATH', String(rel));
  }
  if (!Array.isArray(op.endpoints) || op.endpoints.length !== 2) fail('METADATA_OPERATION_ENDPOINTS');
  const byKey = Object.fromEntries(op.endpoints.map((row) => [row.product_key, row.url]));
  if (byKey['cms-hcris-hospital-provider-cost-report'] !== CMS_METADATA_URL) fail('METADATA_OPERATION_CMS_URL', String(byKey['cms-hcris-hospital-provider-cost-report']));
  if (byKey['cdc-places-local-data-for-better-health'] !== CDC_METADATA_URL) fail('METADATA_OPERATION_CDC_URL', String(byKey['cdc-places-local-data-for-better-health']));
  const auth = JSON.parse(readFileSync(path.join(repoRoot, AUTH_REL), 'utf8'));
  const entry = (auth.entries ?? []).find((row) => row.id === op.auth_id);
  if (!entry) fail('METADATA_AUTH_ENTRY_MISSING', op.auth_id);
  if (entry.action !== 'metadata_check') fail('METADATA_AUTH_ACTION_MISMATCH', String(entry.action));
  const opKeys = op.endpoints.map((row) => row.product_key);
  if (JSON.stringify(entry.product_keys) !== JSON.stringify(opKeys)) fail('METADATA_AUTH_PRODUCT_MISMATCH');
  const opUrls = op.endpoints.map((row) => row.url);
  if (JSON.stringify(entry.endpoints) !== JSON.stringify(opUrls)) fail('METADATA_AUTH_ENDPOINT_MISMATCH');
  const limits = entry.limits ?? {};
  if (limits.max_requests !== 2) fail('METADATA_AUTH_LIMIT_MISMATCH', 'max_requests');
  if (limits.max_bytes !== 131072) fail('METADATA_AUTH_LIMIT_MISMATCH', 'max_bytes');
  if (limits.max_seconds !== 15) fail('METADATA_AUTH_LIMIT_MISMATCH', 'max_seconds');
  if (limits.max_concurrency !== 1) fail('METADATA_AUTH_LIMIT_MISMATCH', 'max_concurrency');
  if (limits.max_requests_per_source !== 1) fail('METADATA_AUTH_LIMIT_MISMATCH', 'max_requests_per_source');
  if (limits.max_bytes_per_source !== 65536) fail('METADATA_AUTH_LIMIT_MISMATCH', 'max_bytes_per_source');
  if (limits.max_seconds_per_source !== 15) fail('METADATA_AUTH_LIMIT_MISMATCH', 'max_seconds_per_source');
  if (limits.max_redirects_per_request !== 0) fail('METADATA_AUTH_LIMIT_MISMATCH', 'max_redirects_per_request');
  if (limits.max_retries_per_source !== 0) fail('METADATA_AUTH_LIMIT_MISMATCH', 'max_retries_per_source');
  if ('max_rows' in limits || 'max_rows_per_source' in limits) fail('METADATA_AUTH_ROW_LIMIT_FORBIDDEN');
  if (entry.credentials?.required === true) fail('METADATA_AUTH_CREDENTIALS_FORBIDDEN');
  const products = Object.fromEntries((packet.products ?? []).map((row) => [row.product_key, row]));
  const endpoints = op.endpoints.map((row) => {
    const product = products[row.product_key];
    if (!product) fail('METADATA_OPERATION_PRODUCT_MISSING', row.product_key);
    return Object.freeze({
      product_key: row.product_key,
      url: row.url,
      permitted_hosts: Object.freeze([...(product.permitted_hosts ?? [])]),
      native_product_id: product.native_product_id,
      frozen_record_id: product.frozen_record_id,
      release_id: product.release_id,
    });
  });
  return Object.freeze({
    operation_id: op.id,
    packet_version: op.packet_version,
    auth_id: op.auth_id,
    endpoints: Object.freeze(endpoints),
    ledger_rel: op.ledger,
    capture_dir: op.capture_dir,
    receipt_dir: op.receipt_dir,
    attempt_dir: op.attempt_dir,
    lock_rel: op.lock,
    run_report_rel: op.run_report,
    limits: Object.freeze({
      max_requests: 2,
      max_bytes: 131072,
      max_seconds: 15,
      max_concurrency: 1,
      max_bytes_per_source: 65536,
      max_seconds_per_source: 15,
      max_requests_per_source: 1,
      max_redirects_per_request: 0,
      max_retries_per_source: 0,
    }),
    candidate_binding: Object.freeze({
      branch: packet.candidate_binding?.branch ?? null,
      must_match_git_head: packet.candidate_binding?.must_match_git_head === true,
    }),
  });
}

function writeJsonAtomic(abs, value) {
  mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.tmp-' + randomUUID();
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, abs);
}

function acquirePilotLock(repoRoot, lockRel) {
  const lockPath = path.join(repoRoot, lockRel);
  mkdirSync(path.dirname(lockPath), { recursive: true });
  let fd;
  try {
    fd = openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') fail('METADATA_CONCURRENT_INVOCATION', lockPath);
    throw error;
  }
  writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + '\n');
  return {
    path: lockPath,
    fd,
    release() {
      try { closeSync(fd); } catch {}
      try { unlinkSync(lockPath); } catch {}
    },
  };
}

function assertLedgerConsistent(ledger, authEntry, op) {
  if (ledger.format !== LEDGER_FORMAT) fail('METADATA_LEDGER_FORMAT');
  if (ledger.authorization_id !== op.auth_id) fail('METADATA_LEDGER_AUTH', String(ledger.authorization_id));
  if (ledger.operation_id && ledger.operation_id !== op.operation_id) fail('METADATA_LEDGER_OPERATION_MISMATCH', String(ledger.operation_id));
  if (ledger.closed) fail('METADATA_LEDGER_CLOSED');
  const limits = authEntry.limits;
  const keys = op.endpoints.map((row) => row.product_key);
  if (JSON.stringify(authEntry.product_keys) !== JSON.stringify(keys)) fail('METADATA_LEDGER_PRODUCT_MISMATCH');
  if (ledger.totals.max_requests !== limits.max_requests) fail('METADATA_LEDGER_LIMIT_MISMATCH');
  if (!Number.isSafeInteger(ledger.totals.used_requests) || ledger.totals.used_requests < 0) fail('METADATA_LEDGER_USED_INVALID');
  if (ledger.totals.remaining_requests !== ledger.totals.max_requests - ledger.totals.used_requests) fail('METADATA_LEDGER_REMAINING_MISMATCH');
  if (ledger.totals.used_requests > ledger.totals.max_requests) fail('METADATA_LEDGER_OVERSPENT');
  let sourceUsed = 0;
  for (const key of keys) {
    const source = ledger.per_source?.[key];
    if (!source) fail('METADATA_LEDGER_SOURCE_MISSING', key);
    if (source.max_requests !== limits.max_requests_per_source) fail('METADATA_LEDGER_SOURCE_LIMIT_MISMATCH', key);
    if (!Number.isSafeInteger(source.used_requests) || source.used_requests < 0) fail('METADATA_LEDGER_SOURCE_USED_INVALID', key);
    if (source.remaining_requests !== source.max_requests - source.used_requests) fail('METADATA_LEDGER_SOURCE_REMAINING_MISMATCH', key);
    if (source.used_requests > source.max_requests) fail('METADATA_LEDGER_SOURCE_OVERSPENT', key);
    sourceUsed += source.used_requests;
  }
  if (sourceUsed !== ledger.totals.used_requests) fail('METADATA_LEDGER_SOURCE_TOTAL_MISMATCH');
}

export function loadLedger({ repoRoot = ROOT, op = resolveMetadataOperation({ repoRoot }), authEntry = null } = {}) {
  const auth = authEntry ?? JSON.parse(readFileSync(path.join(repoRoot, AUTH_REL), 'utf8'));
  const entry = authEntry ?? (auth.entries ?? []).find((row) => row.id === op.auth_id);
  if (!entry) fail('METADATA_AUTH_ENTRY_MISSING', op.auth_id);
  const abs = path.join(repoRoot, op.ledger_rel);
  if (!existsSync(abs)) fail('METADATA_LEDGER_REQUIRED', op.ledger_rel);
  const ledger = JSON.parse(readFileSync(abs, 'utf8'));
  assertLedgerConsistent(ledger, entry, op);
  return ledger;
}

function persistLedger(repoRoot, op, ledger) {
  writeJsonAtomic(path.join(repoRoot, op.ledger_rel), ledger);
}

function consumeBudget(ledger, productKey, kind, url, repoRoot, op) {
  const source = ledger.per_source[productKey];
  if (!source) fail('METADATA_UNKNOWN_SOURCE', productKey);
  if (ledger.totals.remaining_requests <= 0) fail('METADATA_REQUEST_BUDGET_EXHAUSTED', kind + ' ' + url);
  if (source.remaining_requests <= 0) fail('METADATA_SOURCE_REQUEST_BUDGET_EXHAUSTED', productKey);
  ledger.totals.used_requests += 1;
  ledger.totals.remaining_requests -= 1;
  source.used_requests += 1;
  source.remaining_requests -= 1;
  persistLedger(repoRoot, op, ledger);
  return ledger.totals.used_requests;
}

function queryMap(url) {
  const parsed = new URL(url);
  const pairs = [...parsed.searchParams.entries()];
  const seen = new Set();
  for (const [key] of pairs) {
    if (seen.has(key)) fail('METADATA_URL_DUPLICATE_QUERY', url);
    seen.add(key);
  }
  return Object.fromEntries(pairs.sort((a, b) => a[0].localeCompare(b[0])));
}

function sameApprovedEndpoint(approved, candidate) {
  let approvedUrl;
  let candidateUrl;
  try {
    approvedUrl = new URL(approved);
    candidateUrl = new URL(candidate);
  } catch {
    return false;
  }
  if (approvedUrl.origin !== candidateUrl.origin) return false;
  if (approvedUrl.pathname !== candidateUrl.pathname) return false;
  const allowed = queryMap(approved);
  const actual = queryMap(candidate);
  for (const [key, value] of Object.entries(allowed)) {
    if (actual[key] !== value) return false;
  }
  for (const key of Object.keys(actual)) {
    if (!(key in allowed)) return false;
  }
  return true;
}

// Pre-fetch URL gate for one operation endpoint. Payload URLs are forbidden even
// before scope is consulted, so a stale AUTH entry listing them can never grant
// a fetch. Throws a typed code; returns the parsed URL when allowed.
export function assertMetadataUrlAllowed(op, productKey, url) {
  const endpoint = (op.endpoints ?? []).find((row) => row.product_key === productKey);
  if (!endpoint) fail('METADATA_UNKNOWN_SOURCE', productKey);
  let parsed;
  try { parsed = new URL(url); } catch { fail('METADATA_URL_INVALID', url); }
  if (parsed.protocol !== 'https:') fail('METADATA_URL_NOT_HTTPS', url);
  for (const forbidden of FORBIDDEN_PAYLOAD_ENDPOINTS) {
    if (sameApprovedEndpoint(forbidden, url)) fail('METADATA_PAYLOAD_URL_FORBIDDEN', url);
  }
  if (!sameApprovedEndpoint(endpoint.url, url)) fail('METADATA_URL_OUT_OF_SCOPE', url);
  if (!endpoint.permitted_hosts.includes(parsed.host)) fail('METADATA_ENDPOINT_HOST', productKey);
  return parsed;
}

export function isForbiddenPayloadUrl(url) {
  try {
    return FORBIDDEN_PAYLOAD_ENDPOINTS.some((forbidden) => sameApprovedEndpoint(forbidden, url));
  } catch {
    return false;
  }
}

function remainingMs(deadline, nowFn) {
  return deadline - nowFn();
}

function failTimeout(sourceDeadline, globalDeadline, nowFn) {
  if (nowFn() > globalDeadline) fail('METADATA_GLOBAL_TIMEOUT');
  if (nowFn() > sourceDeadline) fail('METADATA_SOURCE_TIMEOUT');
  fail('METADATA_TIMEOUT');
}

async function cancelBody(response) {
  try {
    await response.body?.cancel?.();
  } catch {}
}

async function readBodyWithTimeout(response, { maxBytes, sourceDeadline, globalDeadline, nowFn }) {
  const reader = response.body?.getReader();
  if (!reader) fail('METADATA_EMPTY_BODY');
  const chunks = [];
  let size = 0;
  while (true) {
    const wait = Math.max(1, Math.min(remainingMs(sourceDeadline, nowFn), remainingMs(globalDeadline, nowFn)));
    if (remainingMs(sourceDeadline, nowFn) <= 0 || remainingMs(globalDeadline, nowFn) <= 0) {
      await reader.cancel('timeout').catch(() => {});
      failTimeout(sourceDeadline, globalDeadline, nowFn);
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reader.cancel('timeout').catch(() => {});
    }, wait);
    let result;
    try {
      result = await reader.read();
    } catch (error) {
      if (timedOut || remainingMs(sourceDeadline, nowFn) <= 0 || remainingMs(globalDeadline, nowFn) <= 0) {
        failTimeout(sourceDeadline, globalDeadline, nowFn);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (timedOut) failTimeout(sourceDeadline, globalDeadline, nowFn);
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel('oversized').catch(() => {});
      fail('METADATA_BYTE_LIMIT', String(size));
    }
    chunks.push(Buffer.from(result.value));
  }
  return Buffer.concat(chunks, size);
}

function getPath(value, dotted) {
  let current = value;
  for (const part of dotted.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = current[part];
  }
  return current;
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function truncate(value, max = 500) {
  if (typeof value !== 'string') return value;
  return value.length > max ? value.slice(0, max) + '…' : value;
}

// Source-specific metadata parser: CMS dataset-resources doc.
// Recognizes the dataset-resources structure (dataset UUID/title plus a resources
// array of named distributions with access URLs and dates), verifies the doc is
// about the expected dataset UUID, and reports release evidence separately from
// year descriptions. Insufficient release evidence yields status 'unresolved',
// never a failure: only a wrong UUID (wrong product) or an unrecognized
// structure fails.
export function parseCmsDatasetResources(bytes, { endpoint = CMS_METADATA_URL } = {}) {
  const limitations = [
    'Metadata doc only; no payload rows are fetched and row limits do not apply.',
    'Byte, request, and time budgets are enforced by the collector, not the parser.',
    'Fiscal Year End Date / FY_END_DT is a reporting-period date and is never release evidence.',
  ];
  let doc;
  try {
    doc = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { recognized: false, parser_version: CMS_PARSER_VERSION, failure: 'METADATA_NOT_JSON' };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { recognized: false, parser_version: CMS_PARSER_VERSION, failure: 'METADATA_STRUCTURE_UNRECOGNIZED' };
  }
  const resources = doc.resources;
  if (!Array.isArray(resources)) {
    return { recognized: false, parser_version: CMS_PARSER_VERSION, failure: 'METADATA_STRUCTURE_UNRECOGNIZED' };
  }
  const uuidPaths = ['dataset.uuid', 'dataset.id', 'uuid', 'id'];
  let uuidPath = null;
  let uuidValue;
  for (const candidate of uuidPaths) {
    const value = getPath(doc, candidate);
    if (typeof value === 'string' && value.length > 0) { uuidPath = candidate; uuidValue = value; break; }
  }
  const titlePaths = ['dataset.title', 'title', 'dataset.name', 'name'];
  let titlePath = null;
  let titleValue;
  for (const candidate of titlePaths) {
    const value = getPath(doc, candidate);
    if (typeof value === 'string' && value.length > 0) { titlePath = candidate; titleValue = value; break; }
  }
  const facts = [];
  if (uuidPath) facts.push({ path: '$.' + uuidPath, value: uuidValue });
  if (titlePath) facts.push({ path: '$.' + titlePath, value: titleValue });
  facts.push({ path: '$.resources.length', value: resources.length });
  const MAX_FACT_RESOURCES = 100;
  resources.slice(0, MAX_FACT_RESOURCES).forEach((resource, index) => {
    if (!resource || typeof resource !== 'object') return;
    const base = '$.resources[' + index + ']';
    for (const field of ['name', 'title', 'format', 'accessURL', 'url', 'created', 'modified', 'issued']) {
      if (resource[field] !== undefined && resource[field] !== null && resource[field] !== '') {
        facts.push({ path: base + '.' + field, value: truncate(String(resource[field])) });
      }
    }
  });
  if (resources.length > MAX_FACT_RESOURCES) {
    limitations.push('Resource facts truncated to the first ' + MAX_FACT_RESOURCES + ' of ' + resources.length + ' entries.');
  }
  if (!uuidValue) {
    return {
      recognized: true,
      parser_version: CMS_PARSER_VERSION,
      identity: { verified: false, expected_uuid: CMS_DATASET_UUID, facts },
      failure: 'METADATA_IDENTITY_MISSING',
      limitations,
    };
  }
  if (uuidValue !== CMS_DATASET_UUID) {
    return {
      recognized: true,
      parser_version: CMS_PARSER_VERSION,
      identity: { verified: false, expected_uuid: CMS_DATASET_UUID, facts },
      failure: 'METADATA_IDENTITY_MISMATCH',
      limitations,
    };
  }
  const identity = { verified: true, expected_uuid: CMS_DATASET_UUID, uuid_path: '$.' + uuidPath, facts };
  // Release evidence: a distribution that names the claimed release exactly
  // (allowing a .csv suffix) AND carries a distribution date. Anything weaker
  // (fiscal-year text, undated names) stays unresolved, not failed.
  let release = {
    status: 'unresolved',
    claimed_release: CMS_CLAIMED_RELEASE,
    evidence: [],
    reason: 'No dated distribution names ' + CMS_CLAIMED_RELEASE + ' in $.resources[]. Fiscal Year End Date is a reporting-period date, not release proof.',
  };
  for (let index = 0; index < resources.length; index += 1) {
    const resource = resources[index];
    if (!resource || typeof resource !== 'object') continue;
    const name = asNonEmptyString(resource.name) ?? asNonEmptyString(resource.title) ?? '';
    const base = name.replace(/\.csv$/i, '');
    const date = asNonEmptyString(resource.issued) ?? asNonEmptyString(resource.modified) ?? asNonEmptyString(resource.created);
    const dateField = resource.issued ? 'issued' : (resource.modified ? 'modified' : (resource.created ? 'created' : null));
    if (base === CMS_CLAIMED_RELEASE && date && dateField) {
      release = {
        status: 'verified',
        claimed_release: CMS_CLAIMED_RELEASE,
        evidence: [
          { path: '$.resources[' + index + '].' + (resource.name ? 'name' : 'title'), value: name },
          { path: '$.resources[' + index + '].' + dateField, value: date },
        ],
        reason: null,
      };
      break;
    }
  }
  const yearNotes = [];
  for (const candidate of ['dataset.description', 'description']) {
    const value = getPath(doc, candidate);
    if (typeof value === 'string' && /fiscal|year/i.test(value)) {
      yearNotes.push({ path: '$.' + candidate, value: truncate(value, 300), note: 'Reporting-period description; kept separate from release evidence.' });
    }
  }
  return { recognized: true, parser_version: CMS_PARSER_VERSION, identity, release, year_notes: yearNotes, endpoint, limitations };
}

// Source-specific metadata parser: CDC Socrata api/views doc.
// Recognizes the Socrata view structure (view id, name, description, columns),
// verifies the view id is swc5-untb, and reports release evidence separately from
// year descriptions. The PLACES 'year' column is an observation attribute, never
// release proof on its own.
export function parseCdcSocrataView(bytes, { endpoint = CDC_METADATA_URL } = {}) {
  const limitations = [
    'Metadata doc only; no payload rows are fetched and row limits do not apply.',
    'Byte, request, and time budgets are enforced by the collector, not the parser.',
    'PLACES year is an observation attribute (measurement vs publication undefined here) and is never release evidence.',
  ];
  let doc;
  try {
    doc = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { recognized: false, parser_version: CDC_PARSER_VERSION, failure: 'METADATA_NOT_JSON' };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { recognized: false, parser_version: CDC_PARSER_VERSION, failure: 'METADATA_STRUCTURE_UNRECOGNIZED' };
  }
  if (typeof doc.id !== 'string' && !Array.isArray(doc.columns)) {
    return { recognized: false, parser_version: CDC_PARSER_VERSION, failure: 'METADATA_STRUCTURE_UNRECOGNIZED' };
  }
  const facts = [];
  if (doc.id !== undefined) facts.push({ path: '$.id', value: truncate(String(doc.id)) });
  if (typeof doc.name === 'string' && doc.name.length > 0) facts.push({ path: '$.name', value: truncate(doc.name) });
  if (typeof doc.description === 'string' && doc.description.length > 0) facts.push({ path: '$.description', value: truncate(doc.description) });
  const columns = Array.isArray(doc.columns) ? doc.columns : [];
  facts.push({ path: '$.columns.length', value: columns.length });
  const MAX_FACT_COLUMNS = 100;
  columns.slice(0, MAX_FACT_COLUMNS).forEach((column, index) => {
    if (!column || typeof column !== 'object') return;
    const base = '$.columns[' + index + ']';
    for (const field of ['fieldName', 'name', 'description']) {
      if (column[field] !== undefined && column[field] !== null && column[field] !== '') {
        facts.push({ path: base + '.' + field, value: truncate(String(column[field]), 300) });
      }
    }
  });
  if (columns.length > MAX_FACT_COLUMNS) {
    limitations.push('Column facts truncated to the first ' + MAX_FACT_COLUMNS + ' of ' + columns.length + ' entries.');
  }
  if (typeof doc.id !== 'string' || doc.id.length === 0) {
    return {
      recognized: true,
      parser_version: CDC_PARSER_VERSION,
      identity: { verified: false, expected_id: CDC_VIEW_ID, facts },
      failure: 'METADATA_IDENTITY_MISSING',
      limitations,
    };
  }
  if (doc.id !== CDC_VIEW_ID) {
    return {
      recognized: true,
      parser_version: CDC_PARSER_VERSION,
      identity: { verified: false, expected_id: CDC_VIEW_ID, facts },
      failure: 'METADATA_IDENTITY_MISMATCH',
      limitations,
    };
  }
  const identity = { verified: true, expected_id: CDC_VIEW_ID, id_path: '$.id', facts };
  // Release evidence: an explicit release statement field naming the claimed
  // release. View name/description text and the year column are not releases.
  const releaseField = typeof doc?.metadata?.release === 'string' ? { path: '$.metadata.release', value: doc.metadata.release }
    : (typeof doc.release === 'string' ? { path: '$.release', value: doc.release } : null);
  let release = {
    status: 'unresolved',
    claimed_release: CDC_CLAIMED_RELEASE,
    evidence: [],
    reason: 'No explicit release statement names ' + CDC_CLAIMED_RELEASE + '. The year column is an observation attribute, not 2025 county-table proof.',
  };
  if (releaseField && releaseField.value === CDC_CLAIMED_RELEASE) {
    release = { status: 'verified', claimed_release: CDC_CLAIMED_RELEASE, evidence: [releaseField], reason: null };
  }
  const yearNotes = [];
  columns.forEach((column, index) => {
    if (column && typeof column === 'object' && column.fieldName === 'year') {
      yearNotes.push({
        path: '$.columns[' + index + ']',
        value: truncate(String(column.description ?? column.name ?? 'year'), 300),
        note: 'Observation attribute; kept separate from release evidence.',
      });
    }
  });
  return { recognized: true, parser_version: CDC_PARSER_VERSION, identity, release, year_notes: yearNotes, endpoint, limitations };
}

export function parseMetadataDocument(productKey, bytes, { endpoint } = {}) {
  if (productKey === 'cms-hcris-hospital-provider-cost-report') return parseCmsDatasetResources(bytes, { endpoint });
  if (productKey === 'cdc-places-local-data-for-better-health') return parseCdcSocrataView(bytes, { endpoint });
  fail('METADATA_UNKNOWN_SOURCE', productKey);
}

function writeAttempt(repoRoot, op, attempt) {
  writeJsonAtomic(path.join(repoRoot, op.attempt_dir, attempt.attempt_id + '.json'), attempt);
}

// Metadata receipt (ushso.metadata-receipt.v1): records the staged outcome
// request-attempted / response-captured / structure-recognized /
// identity-verified / release-verified-or-unresolved. It deliberately is NOT a
// bounded payload sample: kind is 'metadata_check' (never 'core_cell') and
// payload.field is 'source_metadata' (never 'publisher_access'), with no
// bounded_sample / payload_success / _derived_* claims, so
// payloadSampleCountsFromReceipts ignores it and R04 can never increment.
function buildMetadataReceipt({ op, packet, head, executionSha256, product, attempt, request, response, parsed }) {
  const failure = parsed?.failure ?? response?.failure ?? request?.failure ?? null;
  return {
    format: METADATA_RECEIPT_FORMAT,
    receipt_id: 'metadata-' + attempt.attempt_id,
    kind: METADATA_RECEIPT_KIND,
    operation_id: op.operation_id,
    generation: packet.generation,
    candidate_head: head,
    execution_sha256: executionSha256,
    product_key: product.product_key,
    recorded_at: attempt.ended_at,
    authorization: { id: op.auth_id, candidate_head: head },
    payload: {
      product_key: product.product_key,
      field: METADATA_RECEIPT_FIELD,
      native_product_id: product.native_product_id,
      record_id: product.frozen_record_id,
      release_id: product.release_id,
    },
    request: {
      attempted: request.attempted,
      url: request.url,
      final_url: request.final_url,
      redirects: request.redirect_chain.length,
      redirect_chain: request.redirect_chain,
    },
    timing: { started_at: attempt.started_at, ended_at: attempt.ended_at },
    response: {
      captured: response.captured,
      http_status: response.http_status,
      content_type: response.content_type,
      bytes: response.bytes,
      capture_reference: response.capture_reference,
      capture_sha256: response.capture_sha256,
    },
    structure: {
      recognized: parsed ? parsed.recognized === true : false,
      parser_version: parsed?.parser_version ?? null,
    },
    identity: parsed?.identity ?? { verified: false, facts: [] },
    release: parsed?.release ?? { status: 'unresolved', claimed_release: product.release_id, evidence: [], reason: 'No metadata doc was parsed.' },
    year_notes: parsed?.year_notes ?? [],
    limitations: parsed?.limitations ?? ['No metadata doc was parsed; no release statement was sought.'],
    failure: failure ? { code: failure.code, message: failure.message } : null,
  };
}

export async function runMetadataCheck({
  fetchImpl = globalThis.fetch,
  execute = false,
  repoRoot = ROOT,
  now = Date.now,
} = {}) {
  if (!execute) fail('METADATA_EXECUTE_FLAG_REQUIRED');
  validateMetadataCheck({ repoRoot });
  const op = resolveMetadataOperation({ repoRoot });
  const packet = JSON.parse(readFileSync(path.join(repoRoot, PACKET_REL), 'utf8'));
  const auth = JSON.parse(readFileSync(path.join(repoRoot, AUTH_REL), 'utf8'));
  const head = gitHead(repoRoot);
  const entry = (auth.entries ?? []).find((row) => row.id === op.auth_id && row.authorized === true);
  assertMetadataExecutionAuthorized(entry, head, Date.now);
  if (sha256(readFileSync(path.join(repoRoot, 'evaluation/research-program/cohorts.json'))) !== EXPECTED_COHORTS) fail('FROZEN_COHORTS_CHANGED');
  const executionSha256 = executionSha();
  mkdirSync(path.join(repoRoot, op.capture_dir), { recursive: true });
  mkdirSync(path.join(repoRoot, op.attempt_dir), { recursive: true });
  mkdirSync(path.join(repoRoot, op.receipt_dir), { recursive: true });
  const lock = acquirePilotLock(repoRoot, op.lock_rel);
  try {
    const ledger = loadLedger({ repoRoot, op, authEntry: entry });
    const beforeUsed = ledger.totals.used_requests;
    const beforeRemaining = ledger.totals.remaining_requests;
    ledger.last_seen_candidate_head = head;
    if (!Array.isArray(ledger.execution_heads)) ledger.execution_heads = ledger.candidate_head ? [ledger.candidate_head] : [];
    if (!ledger.execution_heads.includes(head)) ledger.execution_heads.push(head);
    persistLedger(repoRoot, op, ledger);
    if (ledger.totals.used_requests !== beforeUsed || ledger.totals.remaining_requests !== beforeRemaining) fail('METADATA_LEDGER_BUDGET_MUTATED');
    if (ledger.totals.remaining_requests <= 0) fail('METADATA_REQUEST_BUDGET_EXHAUSTED');
    if (packet.totals.max_requests !== 2) fail('METADATA_TOTAL_REQUESTS', String(packet.totals.max_requests));
    if (packet.totals.max_bytes !== 131072) fail('METADATA_TOTAL_BYTES', String(packet.totals.max_bytes));
    if (packet.totals.max_seconds !== 15) fail('METADATA_TOTAL_SECONDS', String(packet.totals.max_seconds));
    if (packet.totals.max_concurrency !== 1) fail('METADATA_CONCURRENCY', String(packet.totals.max_concurrency));
    if ('max_rows' in (packet.totals ?? {})) fail('METADATA_ROW_LIMIT_FORBIDDEN', 'totals.max_rows');
    if (packet.request_accounting.max_redirects_per_request !== 0) fail('METADATA_REDIRECT_BUDGET_MUST_BE_ZERO');
    if (packet.request_accounting.max_retries_per_source !== 0) fail('METADATA_RETRY_BUDGET_MUST_BE_ZERO');
    const globalDeadline = now() + packet.totals.max_seconds * 1000;
    const captures = [];
    let aggregateBytes = 0;
    const productsByKey = Object.fromEntries((packet.products ?? []).map((row) => [row.product_key, row]));
    for (const endpoint of op.endpoints) {
      const product = productsByKey[endpoint.product_key];
      if (!product) fail('METADATA_OPERATION_PRODUCT_MISSING', endpoint.product_key);
      if (product.credentials?.required === true) fail('METADATA_CREDENTIAL_NOT_ALLOWED', product.product_key);
      if (product.limits.max_requests !== 1) fail('METADATA_SOURCE_REQUESTS', product.product_key);
      if (product.limits.max_bytes !== 65536) fail('METADATA_SOURCE_BYTES', product.product_key);
      if ('max_rows' in (product.limits ?? {})) fail('METADATA_ROW_LIMIT_FORBIDDEN', product.product_key);
      if (product.limits.max_seconds !== 15) fail('METADATA_SOURCE_SECONDS', product.product_key);
      if (product.limits.max_concurrency !== 1) fail('METADATA_SOURCE_CONCURRENCY', product.product_key);
      if (product.permitted_redirects !== 0) fail('METADATA_PERMITTED_REDIRECTS', product.product_key);
      const attemptId = 'attempt-' + product.product_key + '-' + String(now()).replace(/\D/g, '') + '-' + randomUUID().slice(0, 8);
      const started = new Date(now()).toISOString();
      const sourceDeadline = now() + product.limits.max_seconds * 1000;
      const attempt = {
        format: METADATA_ATTEMPT_FORMAT,
        attempt_id: attemptId,
        operation_id: op.operation_id,
        product_key: product.product_key,
        candidate_head: head,
        started_at: started,
        ended_at: null,
        live_http: true,
        request_attempted: false,
        response_captured: false,
        structure_recognized: false,
        identity_verified: false,
        release_status: 'unresolved',
        acceptance_eligible: false,
        requests: [],
        error: null,
        receipt_reference: null,
      };
      writeAttempt(repoRoot, op, attempt);
      ledger.attempts.push(attemptId);
      persistLedger(repoRoot, op, ledger);
      const request = { attempted: false, url: product.endpoint, final_url: product.endpoint, redirect_chain: [] };
      const response = { captured: false, http_status: null, content_type: null, bytes: null, capture_reference: null, capture_sha256: null };
      let parsed = null;
      const failAttempt = (code, message) => {
        attempt.error = { code, message: message ?? code };
        attempt.ended_at = new Date(now()).toISOString();
        const receipt = buildMetadataReceipt({
          op, packet, head, executionSha256, product, attempt,
          request,
          response: { ...response, failure: attempt.error },
          parsed: parsed ? { ...parsed, failure: attempt.error } : null,
        });
        const receiptRel = path.join(op.receipt_dir, attemptId + '.json');
        writeJsonAtomic(path.join(repoRoot, receiptRel), receipt);
        attempt.receipt_reference = receiptRel;
        writeAttempt(repoRoot, op, attempt);
        captures.push({
          attempt_id: attemptId,
          product_key: product.product_key,
          capture_success: response.captured,
          identity_verified: false,
          release_status: 'unresolved',
          acceptance_eligible: false,
          evidence_reference: response.capture_reference,
          receipt_reference: receiptRel,
          evidence_sha256: response.capture_sha256,
          bytes: response.bytes,
          live_http: true,
          error: attempt.error,
        });
      };
      try {
        assertMetadataUrlAllowed(op, product.product_key, product.endpoint);
        consumeBudget(ledger, product.product_key, 'initial', product.endpoint, repoRoot, op);
        attempt.requests.push({ kind: 'initial', url: product.endpoint, at: new Date(now()).toISOString() });
        writeAttempt(repoRoot, op, attempt);
        if (remainingMs(sourceDeadline, now) <= 0 || remainingMs(globalDeadline, now) <= 0) {
          failTimeout(sourceDeadline, globalDeadline, now);
        }
        const wait = Math.max(1, Math.min(remainingMs(sourceDeadline, now), remainingMs(globalDeadline, now)));
        const controller = new AbortController();
        let aborted = false;
        const timer = setTimeout(() => {
          aborted = true;
          controller.abort();
        }, wait);
        let fetchResponse;
        try {
          request.attempted = true;
          attempt.request_attempted = true;
          fetchResponse = await fetchImpl(product.endpoint, {
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
            headers: { accept: 'application/json', 'user-agent': 'ushso-metadata-check/1' },
          });
        } catch (error) {
          if (aborted || remainingMs(sourceDeadline, now) <= 0 || remainingMs(globalDeadline, now) <= 0) {
            failTimeout(sourceDeadline, globalDeadline, now);
          }
          throw error;
        } finally {
          clearTimeout(timer);
        }
        if (aborted) failTimeout(sourceDeadline, globalDeadline, now);
        request.final_url = product.endpoint;
        if ([301, 302, 303, 307, 308].includes(fetchResponse.status)) {
          const location = fetchResponse.headers.get('location');
          await cancelBody(fetchResponse);
          if (typeof location === 'string' && location.length > 0) {
            // Duplicate query keys are rejected even on a redirect Location that
            // will never be followed (all redirects abort here).
            queryMap(new URL(location, product.endpoint).toString());
          }
          fail('METADATA_REDIRECT_NOT_PERMITTED', product.product_key + ' ' + String(fetchResponse.status));
        }
        if (fetchResponse.status === 429 || fetchResponse.status === 503) {
          await cancelBody(fetchResponse);
          fail('METADATA_RETRY_NOT_PERMITTED', product.product_key + ' ' + String(fetchResponse.status));
        }
        if (fetchResponse.status < 200 || fetchResponse.status > 299) {
          await cancelBody(fetchResponse);
          fail('METADATA_HTTP_STATUS', String(fetchResponse.status));
        }
        const bytes = await readBodyWithTimeout(fetchResponse, {
          maxBytes: product.limits.max_bytes,
          sourceDeadline,
          globalDeadline,
          nowFn: now,
        });
        if (aggregateBytes + bytes.length > packet.totals.max_bytes) fail('METADATA_AGGREGATE_BYTE_LIMIT', String(aggregateBytes + bytes.length));
        aggregateBytes += bytes.length;
        const contentType = fetchResponse.headers.get('content-type') ?? '';
        const digest = sha256(bytes);
        const captureRel = path.join(op.capture_dir, attemptId + '-' + product.product_key + '.json');
        if (!contentType.includes('json')) {
          // Bytes were received within budget: persist them as evidence of what
          // the endpoint returned, then fail on content type.
          writeFileSync(path.join(repoRoot, captureRel), bytes);
          response.captured = true;
          response.http_status = fetchResponse.status;
          response.content_type = contentType;
          response.bytes = bytes.length;
          response.capture_reference = captureRel;
          response.capture_sha256 = digest;
          attempt.response_captured = true;
          attempt.http_status = fetchResponse.status;
          attempt.bytes = bytes.length;
          fail('METADATA_CONTENT_TYPE', contentType);
        }
        writeFileSync(path.join(repoRoot, captureRel), bytes);
        response.captured = true;
        response.http_status = fetchResponse.status;
        response.content_type = contentType;
        response.bytes = bytes.length;
        response.capture_reference = captureRel;
        response.capture_sha256 = digest;
        attempt.response_captured = true;
        attempt.capture_reference = captureRel;
        attempt.evidence_sha256 = digest;
        attempt.http_status = fetchResponse.status;
        attempt.bytes = bytes.length;
        writeAttempt(repoRoot, op, attempt);
        parsed = parseMetadataDocument(product.product_key, bytes, { endpoint: product.endpoint });
        attempt.structure_recognized = parsed.recognized === true;
        if (parsed.recognized !== true) fail(parsed.failure ?? 'METADATA_STRUCTURE_UNRECOGNIZED');
        if (!parsed.identity?.verified) fail(parsed.failure ?? 'METADATA_IDENTITY_MISMATCH');
        attempt.identity_verified = true;
        attempt.release_status = parsed.release?.status ?? 'unresolved';
        attempt.ended_at = new Date(now()).toISOString();
        const receipt = buildMetadataReceipt({ op, packet, head, executionSha256, product, attempt, request, response, parsed });
        const receiptRel = path.join(op.receipt_dir, attemptId + '.json');
        writeJsonAtomic(path.join(repoRoot, receiptRel), receipt);
        attempt.receipt_reference = receiptRel;
        writeAttempt(repoRoot, op, attempt);
        captures.push({
          attempt_id: attemptId,
          product_key: product.product_key,
          capture_success: true,
          identity_verified: true,
          release_status: attempt.release_status,
          acceptance_eligible: false,
          evidence_reference: captureRel,
          receipt_reference: receiptRel,
          evidence_sha256: digest,
          bytes: bytes.length,
          live_http: true,
        });
      } catch (error) {
        failAttempt(error.code ?? 'METADATA_FETCH_FAILED', error.message);
      }
    }
    const metadataReceipts = captures
      .filter((row) => row.receipt_reference)
      .map((row) => JSON.parse(readFileSync(path.join(repoRoot, row.receipt_reference), 'utf8')));
    const products = loadCohort(path.join(repoRoot, 'evaluation/research-program/cohorts.json')).products;
    // Metadata receipts use kind 'metadata_check' / field 'source_metadata', so the
    // payload sample counter ignores them: this must stay 0 without touching
    // qualify-core.mjs.
    const counts = payloadSampleCountsFromReceipts(metadataReceipts, products);
    const report = {
      format: METADATA_RUN_FORMAT,
      operation_id: op.operation_id,
      candidate_head: head,
      authorized: true,
      live_http: true,
      accepted: false,
      r04_accepted: false,
      requests_used: ledger.totals.used_requests,
      requests_remaining: ledger.totals.remaining_requests,
      bytes_captured: aggregateBytes,
      captures,
      qualified_sample_count: counts.public_sample_complete,
      frozen_cohorts_sha256: EXPECTED_COHORTS,
      ledger: op.ledger_rel,
    };
    writeJsonAtomic(path.join(repoRoot, op.run_report_rel), report);
    return report;
  } finally {
    lock.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runMetadataCheck({ execute: process.argv.includes('--execute') });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
