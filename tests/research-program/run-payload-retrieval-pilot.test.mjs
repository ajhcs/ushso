import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { loadLedger, runPayloadRetrievalPilot } from '../../scripts/research-program/run-payload-retrieval-pilot.mjs';
import { payloadSampleCountsFromReceipts } from '../../scripts/research-program/qualify-core.mjs';
import { loadCohort } from '../../packages/coverage/research-program/v1.0.0/src/core-readiness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HCRIS = 'cms-hcris-hospital-provider-cost-report';
const PLACES = 'cdc-places-local-data-for-better-health';
const HCRIS_URL = 'https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data?size=5';
const PLACES_URL = 'https://data.cdc.gov/resource/swc5-untb.json?$limit=5';

function copyNeeded(srcRoot, dstRoot, rel) {
  mkdirSync(path.dirname(path.join(dstRoot, rel)), { recursive: true });
  cpSync(path.join(srcRoot, rel), path.join(dstRoot, rel));
}

function seedLedger(dir, auth, overrides = {}) {
  const ledger = {
    format: 'ushso.payload-retrieval-pilot-ledger.v1',
    authorization_id: 'AUTH-PAYLOAD-PILOT',
    candidate_head: auth.entries[0].candidate_head,
    totals: { max_requests: 4, used_requests: 0, remaining_requests: 4 },
    per_source: {
      [HCRIS]: { used_requests: 0, remaining_requests: 2, max_requests: 2 },
      [PLACES]: { used_requests: 0, remaining_requests: 2, max_requests: 2 },
    },
    attempts: [],
    closed: false,
    ...overrides,
  };
  mkdirSync(path.join(dir, 'verification/research-program/evidence'), { recursive: true });
  writeFileSync(path.join(dir, 'verification/research-program/evidence/payload-retrieval-pilot-ledger.json'), JSON.stringify(ledger, null, 2) + '\n');
  return ledger;
}

function isolateRepo({ ledger = true } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ushso-pilot-'));
  for (const rel of [
    'evaluation/research-program/cohorts.json',
    'verification/research-program/evidence/payload-retrieval-pilot.json',
    'verification/research-program/authorization/payload-authorizations.json',
    'verification/research-program/evidence/product-sample-requirements.json',
    'verification/external-authorization/v1.0.0/register.json',
    '.gitignore',
  ]) copyNeeded(ROOT, dir, rel);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['checkout', '-B', 'codex/ushso-evidence-ingestion-20260915'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=pilot@example.test', '-c', 'user.name=pilot', 'commit', '-qm', 'isolate'], { cwd: dir });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const authPath = path.join(dir, 'verification/research-program/authorization/payload-authorizations.json');
  const auth = JSON.parse(readFileSync(authPath, 'utf8'));
  auth.entries[0].candidate_head = head;
  auth.entries[0].authorized = true;
  auth.entries[0].status = 'authorized';
  writeFileSync(authPath, JSON.stringify(auth, null, 2) + '\n');
  if (ledger) seedLedger(dir, auth);
  return { dir, head, auth };
}

function jsonResponse(body, { status = 200, headers = { 'content-type': 'application/json' }, chunks, stallAfter = -1, oversized = false, onCancel } = {}) {
  const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const streamChunks = chunks ?? (oversized ? [Buffer.alloc(200000)] : [bytes]);
  return {
    status,
    headers: { get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null },
    body: {
      async cancel(reason) { onCancel?.(reason ?? 'cancel'); },
      getReader() {
        let index = 0;
        return {
          async read() {
            if (stallAfter >= 0 && index > stallAfter) {
              await new Promise(() => {});
            }
            if (index >= streamChunks.length) return { done: true, value: undefined };
            const value = streamChunks[index];
            index += 1;
            return { done: false, value };
          },
          async cancel(reason) { onCancel?.(reason ?? 'cancel'); },
        };
      },
    },
  };
}

test('payload retrieval pilot does not fetch unless execute is set', async () => {
  await assert.rejects(() => runPayloadRetrievalPilot({ execute: false, repoRoot: ROOT }), { code: 'PILOT_EXECUTE_FLAG_REQUIRED' });
});

test('missing ledger is not recovered by resetting the spent budget', async () => {
  const { dir } = isolateRepo({ ledger: false });
  let fetches = 0;
  await assert.rejects(
    () => runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl: async () => { fetches += 1; return jsonResponse([{ stateabbr: 'AL' }]); } }),
    { code: 'PILOT_LEDGER_REQUIRED' },
  );
  assert.equal(fetches, 0);
  assert.equal(existsSync(path.join(dir, 'verification/research-program/evidence/payload-retrieval-pilot-ledger.json')), false);
});

test('inconsistent ledger remaining counts are rejected', async () => {
  const { dir, auth } = isolateRepo({ ledger: false });
  seedLedger(dir, auth, { totals: { max_requests: 4, used_requests: 2, remaining_requests: 4 } });
  await assert.rejects(
    () => runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl: async () => jsonResponse([{ stateabbr: 'AL' }]) }),
    { code: 'PILOT_LEDGER_REMAINING_MISMATCH' },
  );
});

test('valid JSON followed by a stalled stream times out as an explicit failure', async () => {
  const { dir } = isolateRepo();
  let nowValue = 0;
  const cancelled = [];
  const fetchImpl = async (url) => {
    nowValue = 20_000;
    if (!url.includes('44060663')) return jsonResponse([{ stateabbr: 'AL', year: '2024' }]);
    return jsonResponse([{ 'Provider CCN': '110130' }], {
      chunks: [Buffer.from(JSON.stringify([{ 'Provider CCN': '110130' }]))],
      stallAfter: 0,
      onCancel: (reason) => cancelled.push(reason),
    });
  };
  const report = await runPayloadRetrievalPilot({
    execute: true,
    repoRoot: dir,
    fetchImpl,
    now: () => nowValue,
  });
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.capture_success, false);
  assert.equal(hcris.error.code, 'PILOT_SOURCE_TIMEOUT');
  assert.ok(cancelled.includes('timeout'));
});

test('a 503 followed by a successful response issues exactly two requests and two budget units', async () => {
  const { dir, auth } = isolateRepo();
  const hcrisUrls = [];
  const cancelled = [];
  const fetchImpl = async (url) => {
    if (url.includes('44060663')) {
      hcrisUrls.push(url);
      if (hcrisUrls.length === 1) {
        return jsonResponse('unavailable', { status: 503, onCancel: (reason) => cancelled.push(reason) });
      }
      return jsonResponse([{ 'Provider CCN': '110130' }]);
    }
    return jsonResponse([{ stateabbr: 'AL', year: '2024' }]);
  };
  const report = await runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl });
  assert.equal(hcrisUrls.length, 2);
  assert.deepEqual(hcrisUrls, [HCRIS_URL, HCRIS_URL]);
  const ledger = loadLedger(dir, auth);
  assert.equal(ledger.per_source[HCRIS].used_requests, 2);
  assert.equal(ledger.per_source[HCRIS].remaining_requests, 0);
  assert.equal(cancelled.length >= 1, true);
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.capture_success, true);
});

test('two overlapping invocations respect the shared lock and do not double-spend', async () => {
  const { dir, auth } = isolateRepo();
  let releaseFetch;
  const fetchStarted = new Promise((resolve) => { releaseFetch = resolve; });
  let continueFetch;
  const held = new Promise((resolve) => { continueFetch = resolve; });
  let fetches = 0;
  const fetchImpl = async (url) => {
    fetches += 1;
    if (fetches === 1) {
      releaseFetch();
      await held;
    }
    if (url.includes('44060663')) return jsonResponse([{ 'Provider CCN': '110130' }]);
    return jsonResponse([{ stateabbr: 'AL', year: '2024' }]);
  };
  const first = runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl });
  await fetchStarted;
  const secondError = await runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl }).then(
    () => null,
    (error) => error,
  );
  continueFetch();
  const report = await first;
  assert.equal(secondError?.code, 'PILOT_CONCURRENT_INVOCATION');
  const ledger = loadLedger(dir, auth);
  assert.equal(ledger.totals.used_requests, report.requests_used);
  assert.ok(ledger.totals.used_requests <= 4);
  assert.equal(existsSync(path.join(dir, 'verification/research-program/evidence/payload-retrieval-pilot.lock')), false);
});

test('a redirect that increases the row limit is rejected before it is followed', async () => {
  const { dir, auth } = isolateRepo();
  const fetched = [];
  const cancelled = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    if (url === HCRIS_URL) {
      return {
        status: 302,
        headers: { get: (name) => name === 'location' ? 'https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data?size=50' : null },
        body: { async cancel(reason) { cancelled.push(reason ?? 'cancel'); }, getReader() { return { async read() { return { done: true }; }, async cancel() {} }; } },
      };
    }
    return jsonResponse([{ stateabbr: 'AL', year: '2024' }]);
  };
  const report = await runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl });
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.error.code, 'PILOT_URL_OUT_OF_SCOPE');
  assert.deepEqual(fetched.filter((url) => url.includes('44060663')), [HCRIS_URL]);
  assert.equal(fetched.some((url) => url.includes('size=50')), false);
  assert.equal(cancelled.length >= 1, true);
  assert.equal(loadLedger(dir, auth).per_source[HCRIS].used_requests, 1);
});

test('an oversized body cancels the reader and fails PILOT_BYTE_LIMIT', async () => {
  const { dir } = isolateRepo();
  const cancelled = [];
  const fetchImpl = async (url) => {
    if (!url.includes('44060663')) return jsonResponse([{ stateabbr: 'AL', year: '2024' }]);
    return jsonResponse([{ 'Provider CCN': '110130' }], { oversized: true, onCancel: (reason) => cancelled.push(reason) });
  };
  const report = await runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl });
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.error.code, 'PILOT_BYTE_LIMIT');
  assert.equal(hcris.capture_success, false);
  assert.equal(hcris.acceptance_eligible, false);
  assert.ok(cancelled.includes('oversized'));
});

test('interrupted execution keeps the reserved budget unit', async () => {
  const { dir, auth } = isolateRepo();
  const fetchImpl = async (url) => {
    if (url.includes('44060663')) {
      const error = new Error('socket reset');
      error.code = 'ECONNRESET';
      throw error;
    }
    return jsonResponse([{ stateabbr: 'AL', year: '2024' }]);
  };
  const report = await runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl });
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.capture_success, false);
  assert.match(hcris.error.message, /socket reset/);
  const ledger = loadLedger(dir, auth);
  assert.equal(ledger.per_source[HCRIS].used_requests, 1);
  assert.equal(ledger.per_source[HCRIS].remaining_requests, 1);
});

test('HCRIS identity now matches Provider CCN while unresolved release still contributes zero samples', async () => {
  const { dir } = isolateRepo();
  const fetchImpl = async (url) => {
    if (url.includes('44060663')) return jsonResponse([{ 'Provider CCN': '110130', 'Fiscal Year End Date': '2023-12-31' }]);
    return jsonResponse([{ stateabbr: 'AL', year: '2024' }]);
  };
  const report = await runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl });
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.capture_success, true);
  assert.equal(hcris.identity_verified, true);
  assert.equal(hcris.release_verified, false);
  assert.equal(hcris.acceptance_eligible, false);
  const persisted = JSON.parse(readFileSync(path.join(dir, hcris.receipt_reference), 'utf8'));
  assert.equal(persisted.format, 'ushso.evidence-receipt.v1');
  assert.equal(persisted.payload.product_key, HCRIS);
  assert.equal(persisted.payload.live_http, true);
  assert.equal(persisted.payload._release_check.status, 'unresolved');
  const places = report.captures.find((row) => row.product_key === PLACES);
  assert.equal(places.identity_verified, true);
  assert.equal(places.release_verified, false);
  assert.equal(places.acceptance_eligible, false);
  const placesReceipt = JSON.parse(readFileSync(path.join(dir, places.receipt_reference), 'utf8'));
  assert.equal(placesReceipt.payload._release_check.status, 'unresolved');
  assert.equal(report.qualified_sample_count, 0);
  const products = loadCohort(path.join(ROOT, 'evaluation/research-program/cohorts.json')).products;
  assert.equal(payloadSampleCountsFromReceipts([placesReceipt, persisted], products).public_sample_complete, 0);
});

test('HCRIS rows that still lack Provider CCN persist a failed identity receipt', async () => {
  const { dir } = isolateRepo();
  const fetchImpl = async (url) => {
    if (url.includes('44060663')) return jsonResponse([{ PROVNUM: '110130' }]);
    return jsonResponse([{ stateabbr: 'AL', year: '2024' }]);
  };
  const report = await runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl });
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.capture_success, true);
  assert.equal(hcris.identity_verified, false);
  assert.equal(hcris.acceptance_eligible, false);
  assert.equal(hcris.error.code, 'BOUNDED_SAMPLE_IDENTITY_FIELD_MISSING');
  const persisted = JSON.parse(readFileSync(path.join(dir, hcris.receipt_reference), 'utf8'));
  assert.equal(persisted.payload.live_http, true);
  assert.equal(persisted.payload.bounded_sample, true);
});
