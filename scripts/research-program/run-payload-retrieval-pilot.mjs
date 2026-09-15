#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validatePayloadRetrievalPilot } from './validate-payload-retrieval-pilot.mjs';
import { validateReceipt } from './ingest-evidence.mjs';
import { payloadSampleCountsFromReceipts } from './qualify-core.mjs';
import { loadCohort } from '../../packages/coverage/research-program/v1.0.0/src/core-readiness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKET_REL = 'verification/research-program/evidence/payload-retrieval-pilot.json';
const AUTH_REL = 'verification/research-program/authorization/payload-authorizations.json';
const LEDGER_REL = 'verification/research-program/evidence/payload-retrieval-pilot-ledger.json';
const CAPTURE_DIR = 'verification/research-program/evidence/payloads/pilot-r04';
const ATTEMPT_DIR = 'verification/research-program/evidence/pilot-attempts';
const EXPECTED_COHORTS = '89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543';

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

function nowIso() {
  return new Date().toISOString();
}

function writeJsonAtomic(abs, value) {
  mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.tmp-' + randomUUID();
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, abs);
}

function emptyLedger(auth) {
  const limits = auth.entries[0].limits;
  return {
    format: 'ushso.payload-retrieval-pilot-ledger.v1',
    authorization_id: 'AUTH-PAYLOAD-PILOT',
    candidate_head: auth.entries[0].candidate_head,
    totals: {
      max_requests: limits.max_requests,
      used_requests: 0,
      remaining_requests: limits.max_requests,
    },
    per_source: Object.fromEntries((auth.entries[0].product_keys ?? []).map((key) => [key, {
      used_requests: 0,
      remaining_requests: limits.max_requests_per_source,
      max_requests: limits.max_requests_per_source,
    }])),
    attempts: [],
    closed: false,
  };
}

export function loadLedger(repoRoot = ROOT, auth = JSON.parse(readFileSync(path.join(repoRoot, AUTH_REL), 'utf8'))) {
  const abs = path.join(repoRoot, LEDGER_REL);
  if (!existsSync(abs)) return emptyLedger(auth);
  return JSON.parse(readFileSync(abs, 'utf8'));
}

function persistLedger(repoRoot, ledger) {
  writeJsonAtomic(path.join(repoRoot, LEDGER_REL), ledger);
}

function consumeBudget(ledger, productKey, kind, url, repoRoot) {
  const source = ledger.per_source[productKey];
  if (!source) fail('PILOT_UNKNOWN_SOURCE', productKey);
  if (ledger.totals.remaining_requests <= 0) fail('PILOT_REQUEST_BUDGET_EXHAUSTED', kind + ' ' + url);
  if (source.remaining_requests <= 0) fail('PILOT_SOURCE_REQUEST_BUDGET_EXHAUSTED', productKey);
  ledger.totals.used_requests += 1;
  ledger.totals.remaining_requests -= 1;
  source.used_requests += 1;
  source.remaining_requests -= 1;
  persistLedger(repoRoot, ledger);
  return ledger.totals.used_requests;
}

function approvedEndpoint(auth, productKey, url) {
  const entry = (auth.entries ?? []).find((row) => row.id === 'AUTH-PAYLOAD-PILOT');
  const keys = entry?.product_keys ?? [];
  const endpoints = entry?.endpoints ?? [];
  const scoped = endpoints.filter((endpoint, index) => keys[index] === productKey);
  return scoped.some((endpoint) => {
    const base = endpoint.split('?')[0];
    return url === endpoint || url.split('?')[0] === base;
  });
}

function requireApprovedUrl(auth, productKey, url) {
  let parsed;
  try { parsed = new URL(url); } catch { fail('PILOT_URL_INVALID', url); }
  if (parsed.protocol !== 'https:') fail('PILOT_URL_NOT_HTTPS', url);
  if (!approvedEndpoint(auth, productKey, url)) fail('PILOT_URL_OUT_OF_SCOPE', url);
  return parsed;
}

async function readBodyWithTimeout(response, { maxBytes, deadline, timeoutMs }) {
  const reader = response.body?.getReader();
  if (!reader) fail('PILOT_EMPTY_BODY');
  const chunks = [];
  let size = 0;
  while (true) {
    const remaining = Math.max(1, Math.min(timeoutMs, deadline - Date.now()));
    if (Date.now() > deadline) fail('PILOT_TIMEOUT');
    const timer = setTimeout(() => reader.cancel('timeout').catch(() => {}), remaining);
    let result;
    try {
      result = await reader.read();
    } finally {
      clearTimeout(timer);
    }
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel('oversized').catch(() => {});
      fail('PILOT_BYTE_LIMIT', String(size));
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
  fail('PILOT_NOT_JSON_ROWS');
}

function writeAttempt(repoRoot, attempt) {
  writeJsonAtomic(path.join(repoRoot, ATTEMPT_DIR, attempt.attempt_id + '.json'), attempt);
}

export async function runPayloadRetrievalPilot({
  fetchImpl = globalThis.fetch,
  execute = false,
  repoRoot = ROOT,
  now = Date.now,
} = {}) {
  if (!execute) fail('PILOT_EXECUTE_FLAG_REQUIRED');
  validatePayloadRetrievalPilot({ repoRoot });
  const packet = JSON.parse(readFileSync(path.join(repoRoot, PACKET_REL), 'utf8'));
  const auth = JSON.parse(readFileSync(path.join(repoRoot, AUTH_REL), 'utf8'));
  const head = gitHead(repoRoot);
  const entry = (auth.entries ?? []).find((row) => row.id === 'AUTH-PAYLOAD-PILOT' && row.authorized === true);
  if (!entry || entry.candidate_head !== head) fail('PILOT_AUTH_NOT_MATERIALIZED');
  if (sha256(readFileSync(path.join(repoRoot, 'evaluation/research-program/cohorts.json'))) !== EXPECTED_COHORTS) fail('FROZEN_COHORTS_CHANGED');
  mkdirSync(path.join(repoRoot, CAPTURE_DIR), { recursive: true });
  mkdirSync(path.join(repoRoot, ATTEMPT_DIR), { recursive: true });
  const ledger = loadLedger(repoRoot, auth);
  if (ledger.closed) fail('PILOT_LEDGER_CLOSED');
  if (ledger.candidate_head !== entry.candidate_head) fail('PILOT_LEDGER_CANDIDATE_MISMATCH');
  if (ledger.totals.remaining_requests <= 0) fail('PILOT_REQUEST_BUDGET_EXHAUSTED');
  const deadline = now() + packet.totals.max_seconds * 1000;
  const captures = [];
  for (const product of packet.products) {
    const attemptId = 'attempt-' + product.product_key + '-' + String(now()).replace(/\D/g, '') + '-' + randomUUID().slice(0, 8);
    const started = new Date(now()).toISOString();
    const attempt = {
      format: 'ushso.payload-retrieval-attempt.v1',
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
    };
    writeAttempt(repoRoot, attempt);
    ledger.attempts.push(attemptId);
    persistLedger(repoRoot, ledger);
    try {
      let current = product.endpoint;
      const chain = [];
      let response;
      for (let hop = 0; hop <= packet.request_accounting.max_redirects_per_request; hop += 1) {
        requireApprovedUrl(auth, product.product_key, current);
        consumeBudget(ledger, product.product_key, hop === 0 ? 'initial' : 'redirect', current, repoRoot);
        attempt.requests.push({ kind: hop === 0 ? 'initial' : 'redirect', url: current, at: new Date(now()).toISOString() });
        writeAttempt(repoRoot, attempt);
        const remainingMs = Math.max(1, Math.min(product.limits.max_seconds * 1000, deadline - now()));
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), remainingMs);
        try {
          response = await fetchImpl(current, {
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
            headers: { accept: 'application/json', 'user-agent': 'ushso-payload-pilot/1' },
          });
        } finally {
          clearTimeout(timer);
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) fail('PILOT_REDIRECT_MISSING_LOCATION', current);
          const next = new URL(location, current).toString();
          requireApprovedUrl(auth, product.product_key, next);
          chain.push(next);
          current = next;
          continue;
        }
        if (response.status === 429 || response.status === 503) {
          consumeBudget(ledger, product.product_key, 'retry', product.endpoint, repoRoot);
          attempt.requests.push({ kind: 'retry', url: product.endpoint, at: new Date(now()).toISOString() });
          writeAttempt(repoRoot, attempt);
          current = product.endpoint;
          hop = -1;
          continue;
        }
        if (response.status < 200 || response.status > 299) fail('PILOT_HTTP_STATUS', String(response.status));
        const bytes = await readBodyWithTimeout(response, {
          maxBytes: product.limits.max_bytes,
          deadline,
          timeoutMs: product.limits.max_seconds * 1000,
        });
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('json')) fail('PILOT_CONTENT_TYPE', contentType);
        const parsed = parseRows(bytes);
        if (parsed.rows.length > product.limits.max_rows) fail('PILOT_ROW_LIMIT', product.product_key);
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
          receipt_id: 'pilot-' + attemptId,
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
            recipe: 'authorized two-source public JSON pilot; keep live_http=true',
            limitation: product.release_verification?.reason ?? 'Release semantics remain unresolved.',
            authorization: { id: 'AUTH-PAYLOAD-PILOT', authorized: true, environment: 'staging_egress', candidate_head: head },
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
          writeAttempt(repoRoot, attempt);
          captures.push({
            attempt_id: attemptId,
            product_key: product.product_key,
            capture_success: true,
            identity_verified: attempt.identity_verified,
            release_verified: attempt.release_verified,
            acceptance_eligible: attempt.acceptance_eligible,
            evidence_reference: captureRel,
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
          attempt.ended_at = new Date(now()).toISOString();
          writeAttempt(repoRoot, attempt);
          captures.push({
            attempt_id: attemptId,
            product_key: product.product_key,
            capture_success: true,
            identity_verified: false,
            release_verified: false,
            acceptance_eligible: false,
            evidence_reference: captureRel,
            evidence_sha256: digest,
            rows: parsed.rows.length,
            bytes: bytes.length,
            live_http: true,
            error: attempt.error,
          });
        }
        break;
      }
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
    .map((row) => ({
      kind: 'core_cell',
      payload: {
        field: 'publisher_access',
        product_key: row.product_key,
        supported: true,
        bounded_sample: true,
        payload_success: true,
        live_http: true,
        _derived_payload_sample: true,
        _derived_from_frozen_requirements: true,
        _derived_row_count: row.rows,
        _release_check: { status: 'verified' },
      },
    }));
  const products = loadCohort(path.join(repoRoot, 'evaluation/research-program/cohorts.json')).products;
  const counts = payloadSampleCountsFromReceipts(attemptReceipts, products);
  const report = {
    format: 'ushso.payload-retrieval-pilot-run.v1',
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
  writeJsonAtomic(path.join(repoRoot, 'verification/research-program/evidence/payload-retrieval-pilot-run.json'), report);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runPayloadRetrievalPilot({ execute: process.argv.includes('--execute') });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
