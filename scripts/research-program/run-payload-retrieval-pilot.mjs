#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validatePayloadRetrievalPilot } from './validate-payload-retrieval-pilot.mjs';
import { validateReceipt } from './ingest-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKET_REL = 'verification/research-program/evidence/payload-retrieval-pilot.json';
const AUTH_REL = 'verification/research-program/authorization/payload-authorizations.json';
const CAPTURE_DIR = 'verification/research-program/evidence/payloads/pilot-r04';
const EXPECTED_COHORTS = '89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543';
const ALLOWED_HOSTS = new Set(['data.cms.gov', 'data.cdc.gov']);

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function gitHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}

class RequestBudget {
  constructor(maxRequests) {
    this.remaining = maxRequests;
    this.used = 0;
  }
  consume(kind, url) {
    if (this.remaining <= 0) fail('PILOT_REQUEST_BUDGET_EXHAUSTED', kind + ' ' + url);
    this.remaining -= 1;
    this.used += 1;
    return this.used;
  }
}

function hostAllowed(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') fail('PILOT_URL_NOT_HTTPS', url);
  if (!ALLOWED_HOSTS.has(parsed.host)) fail('PILOT_URL_HOST', url);
  return parsed;
}

async function boundedGet(url, { budget, maxBytes, timeoutMs, maxRedirects, deadline }) {
  let current = url;
  const chain = [];
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    hostAllowed(current);
    if (Date.now() > deadline) fail('PILOT_TIMEOUT', current);
    budget.consume(hop === 0 ? 'initial' : 'redirect', current);
    const remainingMs = Math.max(1, deadline - Date.now());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remainingMs));
    let response;
    try {
      response = await fetch(current, {
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
      hostAllowed(next);
      chain.push(next);
      current = next;
      continue;
    }
    if (response.status === 429 || response.status === 503) {
      return { retryable: true, status: response.status, url: current, chain };
    }
    if (response.status < 200 || response.status > 299) fail('PILOT_HTTP_STATUS', String(response.status));
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    if (!reader) fail('PILOT_EMPTY_BODY', current);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) fail('PILOT_BYTE_LIMIT', String(size));
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks, size);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) fail('PILOT_CONTENT_TYPE', contentType);
    return {
      retryable: false,
      status: response.status,
      url: current,
      requestUrl: url,
      chain,
      contentType,
      bytes,
    };
  }
  fail('PILOT_TOO_MANY_REDIRECTS', url);
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

export async function runPayloadRetrievalPilot({ fetchImpl = fetch, execute = false } = {}) {
  if (!execute) fail('PILOT_EXECUTE_FLAG_REQUIRED');
  globalThis.fetch = fetchImpl;
  validatePayloadRetrievalPilot({ repoRoot: ROOT });
  const head = gitHead();
  const cohortsSha = sha256(readFileSync(path.join(ROOT, 'evaluation/research-program/cohorts.json')));
  if (cohortsSha !== EXPECTED_COHORTS) fail('FROZEN_COHORTS_CHANGED');
  const packet = JSON.parse(readFileSync(path.join(ROOT, PACKET_REL), 'utf8'));
  const auth = JSON.parse(readFileSync(path.join(ROOT, AUTH_REL), 'utf8'));
  const entry = (auth.entries ?? []).find((row) => row.id === 'AUTH-PAYLOAD-PILOT' && row.authorized === true);
  if (!entry || entry.candidate_head !== head) fail('PILOT_AUTH_NOT_MATERIALIZED');
  mkdirSync(path.join(ROOT, CAPTURE_DIR), { recursive: true });
  const budget = new RequestBudget(packet.totals.max_requests);
  const deadline = Date.now() + packet.totals.max_seconds * 1000;
  const captures = [];
  for (const product of packet.products) {
    const sourceDeadline = Math.min(deadline, Date.now() + product.limits.max_seconds * 1000);
    let attempt = await boundedGet(product.endpoint, {
      budget,
      maxBytes: product.limits.max_bytes,
      timeoutMs: product.limits.max_seconds * 1000,
      maxRedirects: packet.request_accounting.max_redirects_per_request,
      deadline: sourceDeadline,
    });
    if (attempt.retryable) {
      attempt = await boundedGet(product.endpoint, {
        budget,
        maxBytes: product.limits.max_bytes,
        timeoutMs: product.limits.max_seconds * 1000,
        maxRedirects: packet.request_accounting.max_redirects_per_request,
        deadline: sourceDeadline,
      });
      if (attempt.retryable) fail('PILOT_RETRY_EXHAUSTED', product.product_key);
    }
    const parsed = parseRows(attempt.bytes);
    if (parsed.rows.length > product.limits.max_rows) fail('PILOT_ROW_LIMIT', product.product_key);
    const digest = sha256(attempt.bytes);
    const relative = path.join(CAPTURE_DIR, product.product_key + '.json');
    writeFileSync(path.join(ROOT, relative), attempt.bytes);
    const started = new Date().toISOString();
    const ended = new Date().toISOString();
    const receipt = {
      format: 'ushso.evidence-receipt.v1',
      receipt_id: 'pilot-' + product.product_key,
      kind: 'core_cell',
      generation: packet.generation,
      candidate_head: head,
      recorded_at: started,
      evidence_reference: relative,
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
        limitation: (product.release_verification?.reason ?? 'Release semantics remain unresolved.'),
        authorization: { id: 'AUTH-PAYLOAD-PILOT', authorized: true, environment: 'staging_egress', candidate_head: head },
        execution: {
          kind: 'bounded_http_sample',
          started_at: started,
          ended_at: ended,
          request_url: product.endpoint,
          final_url: attempt.url,
          http_status: attempt.status,
          content_type: attempt.contentType,
          redirects: attempt.chain.length,
          redirect_chain: attempt.chain,
          bytes: attempt.bytes.length,
        },
      },
    };
    const validated = validateReceipt(receipt, {
      repoRoot: ROOT,
      currentCandidateHead: head,
      payloadAuthRegister: auth,
    });
    captures.push({
      product_key: product.product_key,
      evidence_reference: relative,
      evidence_sha256: digest,
      rows: parsed.rows.length,
      bytes: attempt.bytes.length,
      http_status: attempt.status,
      live_http: validated.payload.live_http,
      derived: validated.payload._derived_payload_sample === true,
      release_check: validated.payload._release_check,
    });
  }
  const report = {
    format: 'ushso.payload-retrieval-pilot-run.v1',
    candidate_head: head,
    authorized: true,
    live_http: true,
    accepted: false,
    requests_used: budget.used,
    requests_remaining: budget.remaining,
    captures,
    frozen_cohorts_sha256: EXPECTED_COHORTS,
  };
  writeFileSync(path.join(ROOT, 'verification/research-program/evidence/payload-retrieval-pilot-run.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runPayloadRetrievalPilot({ execute: process.argv.includes('--execute') });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
