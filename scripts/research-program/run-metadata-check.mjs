#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateMetadataCheck } from './validate-metadata-check.mjs';
import { validateReceipt } from './ingest-evidence.mjs';
import { payloadSampleCountsFromReceipts } from './qualify-core.mjs';
import { loadCohort } from '../../packages/coverage/research-program/v1.0.0/src/core-readiness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKET_REL = 'verification/research-program/evidence/metadata-check-packet.json';
const AUTH_REL = 'verification/research-program/authorization/metadata-authorizations.json';
const LEDGER_REL = 'verification/research-program/evidence/metadata-check-ledger.json';
const LOCK_REL = 'verification/research-program/evidence/metadata-check.lock';
const CAPTURE_DIR = 'verification/research-program/evidence/payloads/metadata-check';
const ATTEMPT_DIR = 'verification/research-program/evidence/metadata-attempts';
const RECEIPT_DIR = 'verification/research-program/evidence/metadata-receipts';
const EXPECTED_COHORTS = '89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543';
const LEDGER_FORMAT = 'ushso.metadata-check-ledger.v1';
const AUTH_ID = 'AUTH-METADATA-CHECK';

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

function writeJsonAtomic(abs, value) {
  mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.tmp-' + randomUUID();
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, abs);
}

function acquirePilotLock(repoRoot) {
  const lockPath = path.join(repoRoot, LOCK_REL);
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

function assertLedgerConsistent(ledger, auth) {
  if (ledger.format !== LEDGER_FORMAT) fail('METADATA_LEDGER_FORMAT');
  if (ledger.authorization_id !== 'AUTH-METADATA-CHECK') fail('METADATA_LEDGER_AUTH');
  if (ledger.closed) fail('METADATA_LEDGER_CLOSED');
  const limits = auth.entries[0].limits;
  const keys = auth.entries[0].product_keys ?? [];
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

export function loadLedger(repoRoot = ROOT, auth = JSON.parse(readFileSync(path.join(repoRoot, AUTH_REL), 'utf8'))) {
  const abs = path.join(repoRoot, LEDGER_REL);
  if (!existsSync(abs)) fail('METADATA_LEDGER_REQUIRED');
  const ledger = JSON.parse(readFileSync(abs, 'utf8'));
  assertLedgerConsistent(ledger, auth);
  return ledger;
}

function persistLedger(repoRoot, ledger) {
  writeJsonAtomic(path.join(repoRoot, LEDGER_REL), ledger);
}

function consumeBudget(ledger, productKey, kind, url, repoRoot) {
  const source = ledger.per_source[productKey];
  if (!source) fail('METADATA_UNKNOWN_SOURCE', productKey);
  if (ledger.totals.remaining_requests <= 0) fail('METADATA_REQUEST_BUDGET_EXHAUSTED', kind + ' ' + url);
  if (source.remaining_requests <= 0) fail('METADATA_SOURCE_REQUEST_BUDGET_EXHAUSTED', productKey);
  ledger.totals.used_requests += 1;
  ledger.totals.remaining_requests -= 1;
  source.used_requests += 1;
  source.remaining_requests -= 1;
  persistLedger(repoRoot, ledger);
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

function approvedEndpoint(auth, productKey, url) {
  const entry = (auth.entries ?? []).find((row) => row.id === 'AUTH-METADATA-CHECK');
  const keys = entry?.product_keys ?? [];
  const endpoints = entry?.endpoints ?? [];
  const scoped = endpoints.filter((endpoint, index) => keys[index] === productKey);
  return scoped.some((endpoint) => sameApprovedEndpoint(endpoint, url));
}

function requireApprovedUrl(auth, productKey, url) {
  let parsed;
  try { parsed = new URL(url); } catch { fail('METADATA_URL_INVALID', url); }
  if (parsed.protocol !== 'https:') fail('METADATA_URL_NOT_HTTPS', url);
  if (!approvedEndpoint(auth, productKey, url)) fail('METADATA_URL_OUT_OF_SCOPE', url);
  return parsed;
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

function parseRows(bytes) {
  const value = JSON.parse(bytes.toString('utf8'));
  if (Array.isArray(value)) return { format: 'json_array', rows: value };
  if (value && typeof value === 'object') {
    const rows = value.data ?? value.rows ?? value.results;
    if (Array.isArray(rows)) return { format: 'json_object', rows };
  }
  fail('METADATA_NOT_JSON_ROWS');
}

function writeAttempt(repoRoot, attempt) {
  writeJsonAtomic(path.join(repoRoot, ATTEMPT_DIR, attempt.attempt_id + '.json'), attempt);
}

export async function runMetadataCheck({
  fetchImpl = globalThis.fetch,
  execute = false,
  repoRoot = ROOT,
  now = Date.now,
} = {}) {
  if (!execute) fail('METADATA_EXECUTE_FLAG_REQUIRED');
  validateMetadataCheck({ repoRoot });
  const packet = JSON.parse(readFileSync(path.join(repoRoot, PACKET_REL), 'utf8'));
  const auth = JSON.parse(readFileSync(path.join(repoRoot, AUTH_REL), 'utf8'));
  const head = gitHead(repoRoot);
  const entry = (auth.entries ?? []).find((row) => row.id === 'AUTH-METADATA-CHECK' && row.authorized === true);
  assertMetadataExecutionAuthorized(entry, head, Date.now);
  if (sha256(readFileSync(path.join(repoRoot, 'evaluation/research-program/cohorts.json'))) !== EXPECTED_COHORTS) fail('FROZEN_COHORTS_CHANGED');
  mkdirSync(path.join(repoRoot, CAPTURE_DIR), { recursive: true });
  mkdirSync(path.join(repoRoot, ATTEMPT_DIR), { recursive: true });
  mkdirSync(path.join(repoRoot, RECEIPT_DIR), { recursive: true });
  const lock = acquirePilotLock(repoRoot);
  try {
    const ledger = loadLedger(repoRoot, auth);
    if (ledger.authorization_id !== entry.id) fail('METADATA_LEDGER_AUTH');
    const beforeUsed = ledger.totals.used_requests;
    const beforeRemaining = ledger.totals.remaining_requests;
    ledger.last_seen_candidate_head = head;
    if (!Array.isArray(ledger.execution_heads)) ledger.execution_heads = ledger.candidate_head ? [ledger.candidate_head] : [];
    if (!ledger.execution_heads.includes(head)) ledger.execution_heads.push(head);
    persistLedger(repoRoot, ledger);
    if (ledger.totals.used_requests !== beforeUsed || ledger.totals.remaining_requests !== beforeRemaining) fail('METADATA_LEDGER_BUDGET_MUTATED');
    if (ledger.totals.remaining_requests <= 0) fail('METADATA_REQUEST_BUDGET_EXHAUSTED');
    if (packet.totals.max_requests !== 2) fail('METADATA_TOTAL_REQUESTS', String(packet.totals.max_requests));
    if (packet.totals.max_bytes !== 131072) fail('METADATA_TOTAL_BYTES', String(packet.totals.max_bytes));
    if (packet.totals.max_seconds !== 15) fail('METADATA_TOTAL_SECONDS', String(packet.totals.max_seconds));
    if (packet.totals.max_concurrency !== 1) fail('METADATA_CONCURRENCY', String(packet.totals.max_concurrency));
    if (packet.request_accounting.max_redirects_per_request !== 0) fail('METADATA_REDIRECT_BUDGET_MUST_BE_ZERO');
    if (packet.request_accounting.max_retries_per_source !== 0) fail('METADATA_RETRY_BUDGET_MUST_BE_ZERO');
    const globalDeadline = now() + packet.totals.max_seconds * 1000;
    const captures = [];
    let aggregateBytes = 0;
    let aggregateRows = 0;
    for (const product of packet.products) {
      if (product.credentials?.required === true) fail('METADATA_CREDENTIAL_NOT_ALLOWED', product.product_key);
      if (product.limits.max_requests !== 1) fail('METADATA_SOURCE_REQUESTS', product.product_key);
      if (product.limits.max_bytes !== 65536) fail('METADATA_SOURCE_BYTES', product.product_key);
      if (product.limits.max_rows !== 5) fail('METADATA_SOURCE_ROWS', product.product_key);
      if (product.permitted_redirects !== 0) fail('METADATA_PERMITTED_REDIRECTS', product.product_key);
      const attemptId = 'attempt-' + product.product_key + '-' + String(now()).replace(/\D/g, '') + '-' + randomUUID().slice(0, 8);
      const started = new Date(now()).toISOString();
      const sourceDeadline = now() + product.limits.max_seconds * 1000;
      const attempt = {
        format: 'ushso.metadata-check-attempt.v1',
        attempt_id: attemptId,
        product_key: product.product_key,
        candidate_head: head,
        started_at: started,
        ended_at: null,
        live_http: true,
        capture_success: false,
        identity_verified: false,
        release_verified: false,
        acceptance_eligible: false,
        requests: [],
        error: null,
        receipt: null,
      };
      writeAttempt(repoRoot, attempt);
      ledger.attempts.push(attemptId);
      persistLedger(repoRoot, ledger);
      try {
        let current = product.endpoint;
        const chain = [];
        let response;
        let retries = 0;
        for (let hop = 0; hop <= packet.request_accounting.max_redirects_per_request; hop += 1) {
          if (remainingMs(sourceDeadline, now) <= 0 || remainingMs(globalDeadline, now) <= 0) {
            failTimeout(sourceDeadline, globalDeadline, now);
          }
          requireApprovedUrl(auth, product.product_key, current);
          consumeBudget(ledger, product.product_key, hop === 0 ? 'initial' : 'redirect', current, repoRoot);
          attempt.requests.push({ kind: hop === 0 ? 'initial' : 'redirect', url: current, at: new Date(now()).toISOString() });
          writeAttempt(repoRoot, attempt);
          const wait = Math.max(1, Math.min(remainingMs(sourceDeadline, now), remainingMs(globalDeadline, now)));
          const controller = new AbortController();
          let aborted = false;
          const timer = setTimeout(() => {
            aborted = true;
            controller.abort();
          }, wait);
          try {
            response = await fetchImpl(current, {
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
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            await cancelBody(response);
            fail('METADATA_REDIRECT_NOT_PERMITTED', product.product_key + ' ' + String(response.status));
            const next = new URL(location, current).toString();
            requireApprovedUrl(auth, product.product_key, next);
            chain.push(next);
            current = next;
            continue;
          }
          if (response.status === 429 || response.status === 503) {
            await cancelBody(response);
            fail('METADATA_RETRY_NOT_PERMITTED', product.product_key + ' ' + String(response.status));
            await cancelBody(response);
            current = product.endpoint;
            consumeBudget(ledger, product.product_key, 'retry', current, repoRoot);
            attempt.requests.push({ kind: 'retry', url: current, at: new Date(now()).toISOString() });
            writeAttempt(repoRoot, attempt);
            const retryWait = Math.max(1, Math.min(remainingMs(sourceDeadline, now), remainingMs(globalDeadline, now)));
            const retryController = new AbortController();
            let retryAborted = false;
            const retryTimer = setTimeout(() => {
              retryAborted = true;
              retryController.abort();
            }, retryWait);
            try {
              response = await fetchImpl(current, {
                method: 'GET',
                redirect: 'manual',
                signal: retryController.signal,
                headers: { accept: 'application/json', 'user-agent': 'ushso-metadata-check/1' },
              });
            } catch (error) {
              if (retryAborted || remainingMs(sourceDeadline, now) <= 0 || remainingMs(globalDeadline, now) <= 0) {
                failTimeout(sourceDeadline, globalDeadline, now);
              }
              throw error;
            } finally {
              clearTimeout(retryTimer);
            }
            if (retryAborted) failTimeout(sourceDeadline, globalDeadline, now);
            if ([301, 302, 303, 307, 308].includes(response.status) || response.status === 429 || response.status === 503) {
              await cancelBody(response);
              fail('METADATA_RETRY_NOT_SUCCESS', String(response.status));
            }
          }
          if (response.status < 200 || response.status > 299) {
            await cancelBody(response);
            fail('METADATA_HTTP_STATUS', String(response.status));
          }
          const bytes = await readBodyWithTimeout(response, {
            maxBytes: product.limits.max_bytes,
            sourceDeadline,
            globalDeadline,
            nowFn: now,
          });
          const contentType = response.headers.get('content-type') ?? '';
          if (!contentType.includes('json')) fail('METADATA_CONTENT_TYPE', contentType);
          const parsed = parseRows(bytes);
          if (parsed.rows.length > product.limits.max_rows) fail('METADATA_ROW_LIMIT', product.product_key);
          if (aggregateBytes + bytes.length > packet.totals.max_bytes) fail('METADATA_AGGREGATE_BYTE_LIMIT', String(aggregateBytes + bytes.length));
          if (aggregateRows + parsed.rows.length > packet.totals.max_rows) fail('METADATA_AGGREGATE_ROW_LIMIT', String(aggregateRows + parsed.rows.length));
          aggregateBytes += bytes.length;
          aggregateRows += parsed.rows.length;
          const digest = sha256(bytes);
          const captureRel = path.join(CAPTURE_DIR, attemptId + '-' + product.product_key + '.json');
          writeFileSync(path.join(repoRoot, captureRel), bytes);
          attempt.capture_success = true;
          attempt.capture_reference = captureRel;
          attempt.evidence_sha256 = digest;
          attempt.http_status = response.status;
          attempt.bytes = bytes.length;
          attempt.rows = parsed.rows.length;
          attempt.redirect_chain = chain;
          attempt.ended_at = new Date(now()).toISOString();
          writeAttempt(repoRoot, attempt);
          const receipt = {
            format: 'ushso.evidence-receipt.v1',
            receipt_id: 'metadata-' + attemptId,
            kind: 'core_cell',
            generation: packet.generation,
            candidate_head: head,
            recorded_at: attempt.ended_at,
            evidence_reference: captureRel,
            evidence_sha256: digest,
            payload: {
              product_key: product.product_key,
              field: 'publisher_access',
              supported: true,
              unknown: false,
              status: 'bounded_sample',
              bounded_sample: true,
              payload_success: true,
              live_http: true,
              native_product_id: product.native_product_id,
              record_id: product.frozen_record_id,
              release_id: product.release_id,
              result_format: parsed.format,
              row_count: parsed.rows.length,
              recipe: 'authorized bounded CMS/CDC JSON metadata check; keep live_http=true; observation year is not release proof',
              limitation: product.release_verification?.reason ?? 'Release semantics remain unresolved.',
              authorization: { id: 'AUTH-METADATA-CHECK', authorized: true, environment: 'staging_egress', candidate_head: head },
              execution: {
                kind: 'bounded_http_sample',
                started_at: started,
                ended_at: attempt.ended_at,
                request_url: product.endpoint,
                final_url: current,
                http_status: response.status,
                content_type: contentType,
                redirects: chain.length,
                redirect_chain: chain,
                bytes: bytes.length,
              },
            },
          };
          try {
            const validated = validateReceipt(receipt, {
              repoRoot,
              currentCandidateHead: head,
              payloadAuthRegister: auth,
            });
            attempt.identity_verified = validated.payload._derived_payload_sample === true;
            attempt.release_verified = validated.payload._release_check?.status === 'verified';
            attempt.acceptance_eligible = attempt.identity_verified && attempt.release_verified;
            attempt.receipt_id = validated.receipt_id;
            attempt.receipt = validated;
            const receiptRel = path.join(RECEIPT_DIR, attemptId + '.json');
            writeJsonAtomic(path.join(repoRoot, receiptRel), validated);
            attempt.receipt_reference = receiptRel;
            writeAttempt(repoRoot, attempt);
            captures.push({
              attempt_id: attemptId,
              product_key: product.product_key,
              capture_success: true,
              identity_verified: attempt.identity_verified,
              release_verified: attempt.release_verified,
              acceptance_eligible: attempt.acceptance_eligible,
              evidence_reference: captureRel,
              receipt_reference: receiptRel,
              evidence_sha256: digest,
              rows: parsed.rows.length,
              bytes: bytes.length,
              live_http: true,
              release_check: validated.payload._release_check,
            });
          } catch (error) {
            attempt.identity_verified = false;
            attempt.release_verified = false;
            attempt.acceptance_eligible = false;
            attempt.error = { code: error.code, message: error.message };
            receipt.payload.supported = false;
            receipt.payload.unknown = false;
            receipt.payload.status = error.code ?? 'receipt_validation_failed';
            receipt.payload.bounded_sample = false;
            receipt.payload.payload_success = false;
            attempt.receipt = receipt;
            attempt.ended_at = new Date(now()).toISOString();
            const receiptRel = path.join(RECEIPT_DIR, attemptId + '-failed.json');
            writeJsonAtomic(path.join(repoRoot, receiptRel), receipt);
            attempt.receipt_reference = receiptRel;
            writeAttempt(repoRoot, attempt);
            captures.push({
              attempt_id: attemptId,
              product_key: product.product_key,
              capture_success: true,
              identity_verified: false,
              release_verified: false,
              acceptance_eligible: false,
              evidence_reference: captureRel,
              receipt_reference: receiptRel,
              evidence_sha256: digest,
              rows: parsed.rows.length,
              bytes: bytes.length,
              live_http: true,
              error: attempt.error,
            });
          }
          break;
        }
        if (!attempt.capture_success && !attempt.error) fail('METADATA_REDIRECT_LIMIT', product.product_key);
      } catch (error) {
        attempt.error = { code: error.code, message: error.message };
        attempt.ended_at = new Date(now()).toISOString();
        writeAttempt(repoRoot, attempt);
        captures.push({
          attempt_id: attemptId,
          product_key: product.product_key,
          capture_success: attempt.capture_success,
          identity_verified: false,
          release_verified: false,
          acceptance_eligible: false,
          error: attempt.error,
        });
      }
    }
    const attemptReceipts = captures
      .filter((row) => row.acceptance_eligible)
      .map((row) => JSON.parse(readFileSync(path.join(repoRoot, row.receipt_reference), 'utf8')));
    const products = loadCohort(path.join(repoRoot, 'evaluation/research-program/cohorts.json')).products;
    const counts = payloadSampleCountsFromReceipts(attemptReceipts, products);
    const report = {
      format: 'ushso.metadata-check-run.v1',
      candidate_head: head,
      authorized: true,
      live_http: true,
      accepted: false,
      r04_accepted: false,
      requests_used: ledger.totals.used_requests,
      requests_remaining: ledger.totals.remaining_requests,
      captures,
      qualified_sample_count: counts.public_sample_complete,
      frozen_cohorts_sha256: EXPECTED_COHORTS,
      ledger: LEDGER_REL,
    };
    writeJsonAtomic(path.join(repoRoot, 'verification/research-program/evidence/metadata-check-run.json'), report);
    return report;
  } finally {
    lock.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runMetadataCheck({ execute: process.argv.includes('--execute') });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
