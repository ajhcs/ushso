import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { runMetadataCheck, loadLedger, assertMetadataExecutionAuthorized } from '../../scripts/research-program/run-metadata-check.mjs';
import { validateMetadataCheck, METADATA_HISTORICAL_BRANCH } from '../../scripts/research-program/validate-metadata-check.mjs';
import { payloadSampleCountsFromReceipts } from '../../scripts/research-program/qualify-core.mjs';
import { loadCohort } from '../../packages/coverage/research-program/v1.0.0/src/core-readiness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HCRIS = 'cms-hcris-hospital-provider-cost-report';
const PLACES = 'cdc-places-local-data-for-better-health';
const HCRIS_URL = 'https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data?size=5';
const PLACES_URL = 'https://data.cdc.gov/resource/swc5-untb.json?$limit=5';
const BRANCH = 'codex/ushso-track4-metadata-20260916';

function copyNeeded(srcRoot, dstRoot, rel) {
  mkdirSync(path.dirname(path.join(dstRoot, rel)), { recursive: true });
  cpSync(path.join(srcRoot, rel), path.join(dstRoot, rel));
}

function seedLedger(dir, auth, overrides = {}) {
  const ledger = {
    format: 'ushso.metadata-check-ledger.v1',
    authorization_id: 'AUTH-METADATA-CHECK',
    candidate_head: auth.entries[0].candidate_head,
    totals: { max_requests: 2, used_requests: 0, remaining_requests: 2 },
    per_source: {
      [HCRIS]: { used_requests: 0, remaining_requests: 1, max_requests: 1 },
      [PLACES]: { used_requests: 0, remaining_requests: 1, max_requests: 1 },
    },
    attempts: [],
    closed: false,
    ...overrides,
  };
  mkdirSync(path.join(dir, 'verification/research-program/evidence'), { recursive: true });
  writeFileSync(path.join(dir, 'verification/research-program/evidence/metadata-check-ledger.json'), JSON.stringify(ledger, null, 2) + '\n');
  return ledger;
}

function isolateRepo({ ledger = true } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ushso-meta-'));
  for (const rel of [
    'evaluation/research-program/cohorts.json',
    'verification/research-program/evidence/metadata-check-packet.json',
    'verification/research-program/authorization/metadata-authorizations.json',
    'verification/research-program/evidence/product-sample-requirements.json',
    'verification/external-authorization/v1.0.0/register.json',
    '.gitignore',
  ]) copyNeeded(ROOT, dir, rel);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['checkout', '-B', BRANCH], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=meta@example.test', '-c', 'user.name=meta', 'commit', '-qm', 'isolate'], { cwd: dir });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const authPath = path.join(dir, 'verification/research-program/authorization/metadata-authorizations.json');
  const auth = JSON.parse(readFileSync(authPath, 'utf8'));
  auth.entries[0].candidate_head = head;
  auth.entries[0].authorized = true;
  auth.entries[0].status = 'authorized';
  auth.entries[0].revoked = false;
  // Refresh validity window to cover wall-clock execution (offline validation is
  // branch-agnostic; execution still enforces window before any fetch).
  auth.entries[0].valid_from = new Date(Date.now() - 86400_000).toISOString();
  auth.entries[0].valid_until = new Date(Date.now() + 86400_000).toISOString();
  writeFileSync(authPath, JSON.stringify(auth, null, 2) + '\n');
  if (ledger) seedLedger(dir, auth);
  return { dir, head, auth };
}

function jsonResponse(body, { status = 200, headers = { 'content-type': 'application/json' }, chunks, stallAfter = -1, oversized = false, onCancel } = {}) {
  const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const streamChunks = chunks ?? (oversized ? [Buffer.alloc(70000)] : [bytes]);
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

test('metadata packet is internally consistent offline on any branch (branch-agnostic)', () => {
  const out = validateMetadataCheck({ repoRoot: ROOT });
  assert.equal(out.branch, BRANCH);
  assert.equal(out.packet_branch, BRANCH);
  assert.equal(out.historical_branch, BRANCH);
  assert.equal(METADATA_HISTORICAL_BRANCH, BRANCH);
  assert.equal(out.branch_enforcement, 'execution-only');
  assert.deepEqual([...out.products], [HCRIS, PLACES]);
  assert.deepEqual([...out.endpoints], [HCRIS_URL, PLACES_URL]);
  assert.equal(out.frozen_cohorts_unmodified, true);
  assert.equal(out.authorized, false);
  assert.equal(out.checkout_head, out.git_head);
  assert.ok(out.checkout_branch === null || typeof out.checkout_branch === 'string');
});

test('metadata offline validation passes on integration branch (no dev-branch gate)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ushso-meta-branch-'));
  for (const rel of [
    'evaluation/research-program/cohorts.json',
    'verification/research-program/evidence/metadata-check-packet.json',
    'verification/research-program/authorization/metadata-authorizations.json',
    'verification/research-program/evidence/product-sample-requirements.json',
    'verification/external-authorization/v1.0.0/register.json',
    '.gitignore',
  ]) copyNeeded(ROOT, dir, rel);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['checkout', '-B', 'codex/ushso-corr2-gate-20260917'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=meta@example.test', '-c', 'user.name=meta', 'commit', '-qm', 'isolate'], { cwd: dir });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const out = validateMetadataCheck({ repoRoot: dir });
  assert.equal(out.packet_branch, BRANCH);
  assert.equal(out.checkout_branch, 'codex/ushso-corr2-gate-20260917');
  assert.equal(out.checkout_head, head);
  assert.equal(out.branch_enforcement, 'execution-only');
});

test('metadata offline validation passes on detached HEAD (no detached workaround needed)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ushso-meta-detached-'));
  for (const rel of [
    'evaluation/research-program/cohorts.json',
    'verification/research-program/evidence/metadata-check-packet.json',
    'verification/research-program/authorization/metadata-authorizations.json',
    'verification/research-program/evidence/product-sample-requirements.json',
    'verification/external-authorization/v1.0.0/register.json',
    '.gitignore',
  ]) copyNeeded(ROOT, dir, rel);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['checkout', '-B', 'codex/ushso-corr2-gate-20260917'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=meta@example.test', '-c', 'user.name=meta', 'commit', '-qm', 'isolate'], { cwd: dir });
  execFileSync('git', ['checkout', '--detach', 'HEAD'], { cwd: dir });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const current = execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.equal(current, '');
  const out = validateMetadataCheck({ repoRoot: dir });
  assert.equal(out.checkout_branch, null);
  assert.equal(out.checkout_head, head);
  assert.equal(out.detached_head_allowed, true);
});

test('metadata execution authorization still binds exact HEAD + window before any fetch', () => {
  const head = 'c'.repeat(40);
  const base = {
    id: 'AUTH-METADATA-CHECK',
    authorized: true,
    status: 'authorized',
    revoked: false,
    candidate_head: head,
    valid_from: new Date(Date.now() - 3600_000).toISOString(),
    valid_until: new Date(Date.now() + 3600_000).toISOString(),
  };
  assert.doesNotThrow(() => assertMetadataExecutionAuthorized(base, head, Date.now));
  assert.throws(() => assertMetadataExecutionAuthorized(base, 'd'.repeat(40), Date.now), { code: 'METADATA_AUTH_NOT_MATERIALIZED' });
  assert.throws(
    () => assertMetadataExecutionAuthorized({ ...base, valid_until: new Date(Date.now() - 1000).toISOString() }, head, Date.now),
    { code: 'METADATA_AUTH_EXPIRED' },
  );
  assert.throws(() => assertMetadataExecutionAuthorized({ ...base, revoked: true }, head, Date.now), { code: 'METADATA_AUTH_REVOKED' });
});

test('metadata check does not fetch unless execute is set', async () => {
  await assert.rejects(() => runMetadataCheck({ execute: false, repoRoot: ROOT }), { code: 'METADATA_EXECUTE_FLAG_REQUIRED' });
});

test('missing ledger is not recovered (no live fetch)', async () => {
  const { dir } = isolateRepo({ ledger: false });
  let fetches = 0;
  await assert.rejects(
    () => runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: async () => { fetches += 1; return jsonResponse([{ stateabbr: 'AL' }]); } }),
    { code: 'METADATA_LEDGER_REQUIRED' },
  );
  assert.equal(fetches, 0);
});

test('stale candidate HEAD fails closed before any fetch (execution binds HEAD, not branch)', async () => {
  const { dir } = isolateRepo();
  const authPath = path.join(dir, 'verification/research-program/authorization/metadata-authorizations.json');
  const stale = JSON.parse(readFileSync(authPath, 'utf8'));
  stale.entries[0].candidate_head = 'e'.repeat(40);
  writeFileSync(authPath, JSON.stringify(stale, null, 2) + '\n');
  let fetches = 0;
  await assert.rejects(
    () => runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: async () => { fetches += 1; return jsonResponse([{ stateabbr: 'AL' }]); } }),
    { code: 'METADATA_AUTH_NOT_MATERIALIZED' },
  );
  assert.equal(fetches, 0);
});

test('expired AUTH window fails closed before any fetch', async () => {
  const { dir } = isolateRepo();
  const authPath = path.join(dir, 'verification/research-program/authorization/metadata-authorizations.json');
  const expired = JSON.parse(readFileSync(authPath, 'utf8'));
  expired.entries[0].valid_until = new Date(Date.now() - 1000).toISOString();
  writeFileSync(authPath, JSON.stringify(expired, null, 2) + '\n');
  let fetches = 0;
  await assert.rejects(
    () => runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: async () => { fetches += 1; return jsonResponse([{ stateabbr: 'AL' }]); } }),
    { code: 'METADATA_AUTH_EXPIRED' },
  );
  assert.equal(fetches, 0);
});

test('revoked AUTH fails closed before any fetch', async () => {
  const { dir } = isolateRepo();
  const authPath = path.join(dir, 'verification/research-program/authorization/metadata-authorizations.json');
  const revoked = JSON.parse(readFileSync(authPath, 'utf8'));
  revoked.entries[0].revoked = true;
  writeFileSync(authPath, JSON.stringify(revoked, null, 2) + '\n');
  let fetches = 0;
  await assert.rejects(
    () => runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: async () => { fetches += 1; return jsonResponse([{ stateabbr: 'AL' }]); } }),
    { code: 'METADATA_AUTH_REVOKED' },
  );
  assert.equal(fetches, 0);
});

test('two successful JSON metadata fetches consume exactly 1+1=2 and persist SHAs', async () => {
  const { dir, auth } = isolateRepo();
  const fetchImpl = async (url) => {
    if (url.includes('44060663')) return jsonResponse([{ 'Provider CCN': '110130', 'Fiscal Year End Date': '2023-12-31' }]);
    return jsonResponse([{ stateabbr: 'AL', year: '2024' }]);
  };
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl });
  assert.equal(report.captures.length, 2);
  const ledger = loadLedger(dir, auth);
  assert.equal(ledger.totals.used_requests, 2);
  assert.equal(ledger.totals.remaining_requests, 0);
  assert.equal(ledger.per_source[HCRIS].used_requests, 1);
  assert.equal(ledger.per_source[PLACES].used_requests, 1);
  for (const cap of report.captures) {
    assert.equal(cap.capture_success, true);
    assert.match(cap.evidence_sha256, /^[a-f0-9]{64}$/);
    assert.ok(existsSync(path.join(dir, cap.evidence_reference)));
    assert.ok(existsSync(path.join(dir, cap.receipt_reference)));
  }
  // Release stays unresolved; observation year is not release proof.
  for (const cap of report.captures) {
    assert.equal(cap.release_verified, false);
    assert.equal(cap.acceptance_eligible, false);
  }
  assert.equal(report.qualified_sample_count, 0);
});

test('any redirect aborts with METADATA_REDIRECT_NOT_PERMITTED and spends only the initial unit', async () => {
  const { dir, auth } = isolateRepo();
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    if (url === HCRIS_URL) {
      return {
        status: 302,
        headers: { get: (n) => (n === 'location' ? HCRIS_URL : null) },
        body: { async cancel() {}, getReader() { return { async read() { return { done: true }; }, async cancel() {} }; } },
      };
    }
    return jsonResponse([{ stateabbr: 'AL', year: '2024' }]);
  };
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl });
  const hcris = report.captures.find((r) => r.product_key === HCRIS);
  assert.equal(hcris.error.code, 'METADATA_REDIRECT_NOT_PERMITTED');
  assert.deepEqual(fetched.filter((u) => u.includes('44060663')), [HCRIS_URL]);
  assert.equal(loadLedger(dir, auth).per_source[HCRIS].used_requests, 1);
});

test('any 429/503 retry aborts with METADATA_RETRY_NOT_PERMITTED', async () => {
  const { dir } = isolateRepo();
  const fetchImpl = async (url) => {
    if (url.includes('44060663')) return jsonResponse('busy', { status: 503 });
    return jsonResponse([{ stateabbr: 'AL', year: '2024' }]);
  };
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl });
  const hcris = report.captures.find((r) => r.product_key === HCRIS);
  assert.equal(hcris.error.code, 'METADATA_RETRY_NOT_PERMITTED');
});

test('oversized body over 65536 cancels and fails METADATA_BYTE_LIMIT', async () => {
  const { dir } = isolateRepo();
  const cancelled = [];
  const fetchImpl = async (url) => {
    if (!url.includes('44060663')) return jsonResponse([{ stateabbr: 'AL', year: '2024' }]);
    return jsonResponse([{ 'Provider CCN': '110130' }], { oversized: true, onCancel: (r) => cancelled.push(r) });
  };
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl });
  const hcris = report.captures.find((r) => r.product_key === HCRIS);
  assert.equal(hcris.error.code, 'METADATA_BYTE_LIMIT');
  assert.ok(cancelled.includes('oversized'));
});

test('duplicate query key is rejected before follow', async () => {
  const { dir } = isolateRepo();
  const fetchImpl = async (url) => {
    if (url === HCRIS_URL) {
      return {
        status: 302,
        headers: { get: (n) => (n === 'location' ? HCRIS_URL + '&size=5' : null) },
        body: { async cancel() {}, getReader() { return { async read() { return { done: true }; }, async cancel() {} }; } },
      };
    }
    return jsonResponse([{ stateabbr: 'AL' }]);
  };
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl });
  // Redirects are forbidden first, so either duplicate-query or redirect-not-permitted proves no follow.
  const hcris = report.captures.find((r) => r.product_key === HCRIS);
  assert.ok(['METADATA_REDIRECT_NOT_PERMITTED', 'METADATA_URL_DUPLICATE_QUERY'].includes(hcris.error.code));
});

test('out-of-scope row-limit increase is rejected (rows>5)', async () => {
  const { dir } = isolateRepo();
  const fetchImpl = async (url) => {
    if (url.includes('44060663')) return jsonResponse(Array.from({ length: 6 }, (_, i) => ({ 'Provider CCN': String(110130 + i) })));
    return jsonResponse([{ stateabbr: 'AL' }]);
  };
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl });
  const hcris = report.captures.find((r) => r.product_key === HCRIS);
  assert.equal(hcris.error.code, 'METADATA_ROW_LIMIT');
});

test('HCRIS Provider CCN passes identity while release stays unresolved (0 samples)', async () => {
  const { dir } = isolateRepo();
  const fetchImpl = async (url) => {
    if (url.includes('44060663')) return jsonResponse([{ 'Provider CCN': '110130', 'Fiscal Year End Date': '2023-12-31' }]);
    return jsonResponse([{ stateabbr: 'AL', year: '2024' }]);
  };
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl });
  const hcris = report.captures.find((r) => r.product_key === HCRIS);
  assert.equal(hcris.capture_success, true);
  assert.equal(hcris.identity_verified, true);
  assert.equal(hcris.release_verified, false);
  const persisted = JSON.parse(readFileSync(path.join(dir, hcris.receipt_reference), 'utf8'));
  assert.equal(persisted.payload._release_check.status, 'unresolved');
  assert.equal(report.qualified_sample_count, 0);
  const products = loadCohort(path.join(ROOT, 'evaluation/research-program/cohorts.json')).products;
  const receipts = report.captures.filter((c) => c.receipt_reference && !c.error).map((c) => JSON.parse(readFileSync(path.join(dir, c.receipt_reference), 'utf8')));
  assert.equal(payloadSampleCountsFromReceipts(receipts, products).public_sample_complete, 0);
});

test('concurrent invocations respect the lock and do not double-spend', async () => {
  const { dir, auth } = isolateRepo();
  let releaseFetch;
  const started = new Promise((res) => { releaseFetch = res; });
  let cont;
  const held = new Promise((res) => { cont = res; });
  let n = 0;
  const fetchImpl = async (url) => {
    n += 1;
    if (n === 1) { releaseFetch(); await held; }
    if (url.includes('44060663')) return jsonResponse([{ 'Provider CCN': '110130' }]);
    return jsonResponse([{ stateabbr: 'AL' }]);
  };
  const first = runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl });
  await started;
  const secondErr = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl }).then(() => null, (e) => e);
  cont();
  await first;
  assert.equal(secondErr?.code, 'METADATA_CONCURRENT_INVOCATION');
  assert.ok(loadLedger(dir, auth).totals.used_requests <= 2);
});
