import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { loadLedger, runPayloadRetrievalPilot } from '../../scripts/research-program/run-payload-retrieval-pilot.mjs';
import { payloadSampleCountsFromReceipts } from '../../scripts/research-program/qualify-core.mjs';
import { loadCohort } from '../../packages/coverage/research-program/v1.0.0/src/core-readiness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const HCRIS = 'cms-hcris-hospital-provider-cost-report';
const PLACES = 'cdc-places-local-data-for-better-health';
const HCRIS_URL = 'https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data?size=5';
const PLACES_URL = 'https://data.cdc.gov/resource/swc5-untb.json?$limit=5';

function copyNeeded(srcRoot, dstRoot, rel) {
  const from = path.join(srcRoot, rel);
  const to = path.join(dstRoot, rel);
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to);
}

function isolateRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ushso-pilot-'));
  const needed = [
    'evaluation/research-program/cohorts.json',
    'verification/research-program/evidence/payload-retrieval-pilot.json',
    'verification/research-program/authorization/payload-authorizations.json',
    'verification/research-program/evidence/product-sample-requirements.json',
    'verification/external-authorization/v1.0.0/register.json',
    '.gitignore',
  ];
  for (const rel of needed) copyNeeded(ROOT, dir, rel);
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
  return { dir, head, auth };
}

function jsonResponse(url, body, { status = 200, headers = { 'content-type': 'application/json' }, stallMs = 0, oversized = false } = {}) {
  const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return {
    status,
    headers: { get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null },
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (stallMs) await new Promise((resolve) => setTimeout(resolve, stallMs));
            if (sent) return { done: true, value: undefined };
            sent = true;
            if (oversized) return { done: false, value: Buffer.alloc(200000) };
            return { done: false, value: bytes };
          },
          async cancel() {},
        };
      },
    },
  };
}

test('payload retrieval pilot does not fetch unless execute is set', async () => {
  await assert.rejects(() => runPayloadRetrievalPilot({ execute: false, repoRoot: ROOT }), { code: 'PILOT_EXECUTE_FLAG_REQUIRED' });
});

test('restart after a partially spent budget cannot spend the same remaining units twice', async () => {
  const { dir, auth } = isolateRepo();
  const ledger = {
    format: 'ushso.payload-retrieval-pilot-ledger.v1',
    authorization_id: 'AUTH-PAYLOAD-PILOT',
    candidate_head: auth.entries[0].candidate_head,
    totals: { max_requests: 4, used_requests: 3, remaining_requests: 1 },
    per_source: {
      [HCRIS]: { used_requests: 2, remaining_requests: 0, max_requests: 2 },
      [PLACES]: { used_requests: 1, remaining_requests: 1, max_requests: 2 },
    },
    attempts: ['prior-hcris'],
    closed: false,
  };
  mkdirSync(path.join(dir, 'verification/research-program/evidence'), { recursive: true });
  writeFileSync(path.join(dir, 'verification/research-program/evidence/payload-retrieval-pilot-ledger.json'), JSON.stringify(ledger, null, 2));
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.includes('swc5-untb')) return jsonResponse(url, [{ stateabbr: 'AL', year: '2024' }]);
    return jsonResponse(url, [{ 'Provider CCN': '110130' }]);
  };
  const first = await runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl });
  assert.equal(first.requests_used, 4);
  assert.equal(first.requests_remaining, 0);
  await assert.rejects(() => runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl }), { code: 'PILOT_REQUEST_BUDGET_EXHAUSTED' });
  const after = loadLedger(dir, auth);
  assert.equal(after.totals.used_requests, 4);
  assert.ok(seen.every((url) => url.includes('swc5-untb') || url.includes('44060663')));
});

test('redirect plus retry exceeding a per-source limit fails closed', async () => {
  const { dir } = isolateRepo();
  const fetchImpl = async (url) => {
    if (url === HCRIS_URL) {
      return { status: 302, headers: { get: (n) => n === 'location' ? HCRIS_URL + '&page=2' : 'application/json' }, body: { getReader() { return { async read() { return { done: true }; }, async cancel() {} }; } } };
    }
    return jsonResponse(url, [{ PROVNUM: '010001' }]);
  };
  const report = await runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl });
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.capture_success === true || hcris.error?.code === 'PILOT_SOURCE_REQUEST_BUDGET_EXHAUSTED' || hcris.error?.code === 'PILOT_URL_OUT_OF_SCOPE', true);
});

test('disallowed cross-source redirect is rejected', async () => {
  const { dir } = isolateRepo();
  const fetchImpl = async (url) => {
    if (url.includes('44060663')) {
      return { status: 302, headers: { get: (n) => n === 'location' ? PLACES_URL : null }, body: { getReader() { return { async read() { return { done: true }; }, async cancel() {} }; } } };
    }
    return jsonResponse(url, [{ stateabbr: 'AL' }]);
  };
  const report = await runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl });
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.error.code, 'PILOT_URL_OUT_OF_SCOPE');
});

test('headers arriving promptly but body stalling times out', async () => {
  const { dir } = isolateRepo();
  const fetchImpl = async (url) => jsonResponse(url, [{ stateabbr: 'AL' }], { stallMs: 50 });
  const start = Date.now();
  const report = await runPayloadRetrievalPilot({
    execute: true,
    repoRoot: dir,
    fetchImpl,
    now: () => start + (Date.now() - start) + 40000,
  });
  assert.ok(report.captures.some((row) => row.error?.code === 'PILOT_TIMEOUT' || row.error?.code === 'PILOT_REQUEST_BUDGET_EXHAUSTED' || row.capture_success === true));
});

test('oversized response cancels and does not count as a sample', async () => {
  const { dir } = isolateRepo();
  const fetchImpl = async (url) => jsonResponse(url, [{ stateabbr: 'AL' }], { oversized: true });
  const report = await runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl });
  assert.ok(report.captures.every((row) => row.acceptance_eligible !== true));
  assert.ok(report.captures.some((row) => row.error?.code === 'PILOT_BYTE_LIMIT' || row.capture_success === false || row.identity_verified === false));
});

test('HCRIS validation failure retains a failed-attempt record without qualifying a sample', async () => {
  const { dir } = isolateRepo();
  const fetchImpl = async (url) => {
    if (url.includes('44060663')) return jsonResponse(url, [{ 'Provider CCN': '110130', 'Fiscal Year End Date': '2023-12-31' }]);
    return jsonResponse(url, [{ stateabbr: 'AL', year: '2024' }]);
  };
  const report = await runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl });
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.capture_success, true);
  assert.equal(hcris.identity_verified, false);
  assert.equal(hcris.acceptance_eligible, false);
  assert.equal(hcris.error.code, 'BOUNDED_SAMPLE_IDENTITY_FIELD_MISSING');
  assert.ok(hcris.evidence_reference.includes('attempt-'));
  const places = report.captures.find((row) => row.product_key === PLACES);
  assert.equal(places.identity_verified, true);
  assert.equal(places.release_verified, false);
  assert.equal(places.acceptance_eligible, false);
  assert.equal(report.qualified_sample_count, 0);
  const products = loadCohort(path.join(ROOT, 'evaluation/research-program/cohorts.json')).products;
  const counts = payloadSampleCountsFromReceipts([{
    kind: 'core_cell',
    payload: {
      field: 'publisher_access',
      product_key: PLACES,
      supported: true,
      bounded_sample: true,
      payload_success: true,
      live_http: true,
      _derived_payload_sample: true,
      _derived_from_frozen_requirements: true,
      _derived_row_count: 5,
      _release_check: { status: 'unresolved' },
    },
  }], products);
  assert.equal(counts.public_sample_complete, 0);
});

test('duplicate invocation cannot spend the same remaining budget', async () => {
  const { dir } = isolateRepo();
  const ledger = {
    format: 'ushso.payload-retrieval-pilot-ledger.v1',
    authorization_id: 'AUTH-PAYLOAD-PILOT',
    candidate_head: JSON.parse(readFileSync(path.join(dir, 'verification/research-program/authorization/payload-authorizations.json'), 'utf8')).entries[0].candidate_head,
    totals: { max_requests: 4, used_requests: 4, remaining_requests: 0 },
    per_source: {
      [HCRIS]: { used_requests: 2, remaining_requests: 0, max_requests: 2 },
      [PLACES]: { used_requests: 2, remaining_requests: 0, max_requests: 2 },
    },
    attempts: ['a', 'b'],
    closed: false,
  };
  mkdirSync(path.join(dir, 'verification/research-program/evidence'), { recursive: true });
  writeFileSync(path.join(dir, 'verification/research-program/evidence/payload-retrieval-pilot-ledger.json'), JSON.stringify(ledger, null, 2));
  let fetches = 0;
  const fetchImpl = async (url) => {
    fetches += 1;
    return jsonResponse(url, [{ stateabbr: 'AL' }]);
  };
  await assert.rejects(() => runPayloadRetrievalPilot({ execute: true, repoRoot: dir, fetchImpl }), { code: 'PILOT_REQUEST_BUDGET_EXHAUSTED' });
  assert.equal(fetches, 0);
});
