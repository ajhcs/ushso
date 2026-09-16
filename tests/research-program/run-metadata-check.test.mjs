import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  runMetadataCheck,
  loadLedger,
  resolveMetadataOperation,
  assertMetadataUrlAllowed,
  isForbiddenPayloadUrl,
  parseCmsDatasetResources,
  parseCdcSocrataView,
  assertMetadataExecutionAuthorized,
  METADATA_OPERATION_ID,
  METADATA_PACKET_VERSION,
  METADATA_AUTH_ID,
  CORRECTED_LEDGER_REL,
  SPENT_LEDGER_REL,
  CMS_METADATA_URL,
  CDC_METADATA_URL,
  CMS_DATASET_UUID,
  CDC_VIEW_ID,
  CMS_PARSER_VERSION,
  CDC_PARSER_VERSION,
} from '../../scripts/research-program/run-metadata-check.mjs';
import { validateMetadataCheck, METADATA_HISTORICAL_BRANCH } from '../../scripts/research-program/validate-metadata-check.mjs';
import { payloadSampleCountsFromReceipts } from '../../scripts/research-program/qualify-core.mjs';
import { loadCohort } from '../../packages/coverage/research-program/v1.0.0/src/core-readiness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HCRIS = 'cms-hcris-hospital-provider-cost-report';
const PLACES = 'cdc-places-local-data-for-better-health';
const HCRIS_URL = CMS_METADATA_URL;
const PLACES_URL = CDC_METADATA_URL;
const FORBIDDEN_HCRIS_PAYLOAD_URL = 'https://data.cms.gov/data-api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data?size=5';
const FORBIDDEN_PLACES_PAYLOAD_URL = 'https://data.cdc.gov/resource/swc5-untb.json?$limit=5';
const BRANCH = 'codex/ushso-int2-metadata-20260917';
const RECEIPT_DIR = 'verification/research-program/evidence/metadata-receipts-corrected-20260917/';
const CAPTURE_DIR = 'verification/research-program/evidence/payloads/metadata-check/corrected-20260917/';
const RUN_REPORT_REL = 'verification/research-program/evidence/metadata-check-run-corrected-20260917.json';

// Representative CMS dataset-resources doc: correct UUID + dated distribution
// naming the claimed release exactly.
const CMS_DOC_VERIFIED = {
  dataset: {
    uuid: CMS_DATASET_UUID,
    title: 'Hospital Provider Cost Report',
    description: 'Hospital cost reports indexed by fiscal year end date.',
  },
  resources: [
    {
      name: 'CostReport_2023_Final.csv',
      title: 'CostReport 2023 Final',
      format: 'CSV',
      accessURL: 'https://data.cms.gov/api/v1/dataset/44060663-47d8-4ced-a115-b53b4c270acb/data',
      created: '2024-05-15',
      modified: '2024-06-01',
    },
    {
      name: 'data-dictionary',
      format: 'JSON',
      accessURL: HCRIS_URL,
      created: '2024-01-01',
    },
  ],
};
// Representative CMS doc with correct identity but no dated release distribution.
const CMS_DOC_UNRESOLVED = {
  dataset: {
    uuid: CMS_DATASET_UUID,
    title: 'Hospital Provider Cost Report',
    description: 'Hospital cost reports indexed by fiscal year end date.',
  },
  resources: [
    {
      name: 'data-dictionary',
      format: 'JSON',
      accessURL: HCRIS_URL,
      created: '2024-01-01',
    },
  ],
};
// Representative CDC Socrata view doc: correct id, no explicit release statement.
const CDC_DOC = {
  id: CDC_VIEW_ID,
  name: 'PLACES: Local Data for Better Health, County Data',
  description: 'Modeled county-level estimates for chronic disease measures.',
  columns: [
    { fieldName: 'stateabbr', name: 'State Abbreviation', description: 'Two-letter state abbreviation.' },
    { fieldName: 'year', name: 'Year', description: 'Observation year for the modeled estimate.' },
    { fieldName: 'measure', name: 'Measure', description: 'Health measure identifier.' },
  ],
};

function copyNeeded(srcRoot, dstRoot, rel) {
  mkdirSync(path.dirname(path.join(dstRoot, rel)), { recursive: true });
  cpSync(path.join(srcRoot, rel), path.join(dstRoot, rel));
}

function isolateRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ushso-meta-'));
  for (const rel of [
    'evaluation/research-program/cohorts.json',
    'verification/research-program/evidence/metadata-check-packet.json',
    'verification/research-program/evidence/metadata-check-ledger-corrected-20260917.json',
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
  const corrected = auth.entries.find((row) => row.id === METADATA_AUTH_ID);
  assert.ok(corrected, 'additive corrected AUTH entry must exist');
  corrected.candidate_head = head;
  corrected.authorized = true;
  corrected.status = 'authorized';
  corrected.revoked = false;
  corrected.valid_from = new Date(Date.now() - 86400_000).toISOString();
  corrected.valid_until = new Date(Date.now() + 86400_000).toISOString();
  writeFileSync(authPath, JSON.stringify(auth, null, 2) + '\n');
  return { dir, head };
}

function readJson(dir, rel) {
  return JSON.parse(readFileSync(path.join(dir, rel), 'utf8'));
}

function writeJson(dir, rel, value) {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(value, null, 2) + '\n');
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

function countingFetch(impl) {
  let fetches = 0;
  const urls = [];
  const fetchImpl = async (url, init) => {
    fetches += 1;
    urls.push(url);
    return impl(url, init);
  };
  return { fetchImpl, count: () => fetches, urls: () => [...urls] };
}

function successFetch() {
  return async (url) => {
    if (url.includes('44060663')) return jsonResponse(CMS_DOC_VERIFIED);
    return jsonResponse(CDC_DOC);
  };
}

// ---- offline validation + operation resolution ----

test('packet v2 operation is internally consistent offline on any branch (branch-agnostic)', () => {
  const out = validateMetadataCheck({ repoRoot: ROOT });
  assert.equal(out.operation_id, METADATA_OPERATION_ID);
  assert.equal(out.packet_version, METADATA_PACKET_VERSION);
  assert.equal(out.auth_id, METADATA_AUTH_ID);
  assert.equal(out.ledger, CORRECTED_LEDGER_REL);
  assert.equal(out.capture_dir, CAPTURE_DIR);
  assert.equal(out.receipt_dir, RECEIPT_DIR);
  assert.equal(out.branch, BRANCH);
  assert.equal(out.packet_branch, BRANCH);
  assert.equal(out.historical_branch, METADATA_HISTORICAL_BRANCH);
  assert.equal(out.branch_enforcement, 'execution-only');
  assert.deepEqual([...out.products], [HCRIS, PLACES]);
  assert.deepEqual([...out.endpoints], [HCRIS_URL, PLACES_URL]);
  assert.equal(out.frozen_cohorts_unmodified, true);
  assert.equal(out.authorized, false);
  assert.equal(out.checkout_head, out.git_head);
  assert.ok(out.checkout_branch === null || typeof out.checkout_branch === 'string');
});

test('offline validation passes on another integration branch name (no dev-branch gate)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ushso-meta-branch-'));
  for (const rel of [
    'evaluation/research-program/cohorts.json',
    'verification/research-program/evidence/metadata-check-packet.json',
    'verification/research-program/evidence/metadata-check-ledger-corrected-20260917.json',
    'verification/research-program/authorization/metadata-authorizations.json',
    'verification/research-program/evidence/product-sample-requirements.json',
    'verification/research-program/evidence/metadata-check-packet-amendment-20260917.json',
    'verification/external-authorization/v1.0.0/register.json',
    '.gitignore',
  ]) copyNeeded(ROOT, dir, rel);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['checkout', '-B', 'codex/ushso-some-other-20260917'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=meta@example.test', '-c', 'user.name=meta', 'commit', '-qm', 'isolate'], { cwd: dir });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const out = validateMetadataCheck({ repoRoot: dir });
  assert.equal(out.operation_id, METADATA_OPERATION_ID);
  assert.equal(out.packet_branch, BRANCH);
  assert.equal(out.checkout_branch, 'codex/ushso-some-other-20260917');
  assert.equal(out.checkout_head, head);
  assert.equal(out.branch_enforcement, 'execution-only');
});

test('offline validation passes on detached HEAD', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ushso-meta-detached-'));
  for (const rel of [
    'evaluation/research-program/cohorts.json',
    'verification/research-program/evidence/metadata-check-packet.json',
    'verification/research-program/evidence/metadata-check-ledger-corrected-20260917.json',
    'verification/research-program/authorization/metadata-authorizations.json',
    'verification/research-program/evidence/product-sample-requirements.json',
    'verification/external-authorization/v1.0.0/register.json',
    '.gitignore',
  ]) copyNeeded(ROOT, dir, rel);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['checkout', '-B', 'codex/ushso-some-other-20260917'], { cwd: dir });
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

test('resolveMetadataOperation returns the corrected binding (pure: no fetch, no writes)', () => {
  const op = resolveMetadataOperation({ repoRoot: ROOT });
  assert.equal(op.operation_id, METADATA_OPERATION_ID);
  assert.equal(op.packet_version, METADATA_PACKET_VERSION);
  assert.equal(op.auth_id, METADATA_AUTH_ID);
  assert.equal(op.ledger_rel, CORRECTED_LEDGER_REL);
  assert.notEqual(op.ledger_rel, SPENT_LEDGER_REL);
  assert.equal(op.capture_dir, CAPTURE_DIR);
  assert.equal(op.receipt_dir, RECEIPT_DIR);
  assert.deepEqual(op.endpoints.map((row) => row.url), [HCRIS_URL, PLACES_URL]);
  assert.deepEqual(op.endpoints.map((row) => row.product_key), [HCRIS, PLACES]);
  assert.deepEqual({ ...op.limits }, {
    max_requests: 2,
    max_bytes: 131072,
    max_seconds: 15,
    max_concurrency: 1,
    max_bytes_per_source: 65536,
    max_seconds_per_source: 15,
    max_requests_per_source: 1,
    max_redirects_per_request: 0,
    max_retries_per_source: 0,
  });
  assert.ok(!('max_rows' in op.limits));
});

test('resolver rejects a packet without the operation (never falls back to spent ledger)', () => {
  const { dir } = isolateRepo();
  const packet = readJson(dir, 'verification/research-program/evidence/metadata-check-packet.json');
  delete packet.operation;
  writeJson(dir, 'verification/research-program/evidence/metadata-check-packet.json', packet);
  assert.throws(() => resolveMetadataOperation({ repoRoot: dir }), { code: 'METADATA_OPERATION_UNRESOLVED' });
  assert.equal(existsSync(path.join(dir, SPENT_LEDGER_REL)), false);
});

test('resolver rejects an operation ledger pointing at the spent ledger', () => {
  const { dir } = isolateRepo();
  const packet = readJson(dir, 'verification/research-program/evidence/metadata-check-packet.json');
  packet.operation.ledger = SPENT_LEDGER_REL;
  writeJson(dir, 'verification/research-program/evidence/metadata-check-packet.json', packet);
  assert.throws(() => resolveMetadataOperation({ repoRoot: dir }), { code: 'METADATA_SPENT_LEDGER_FALLBACK' });
});

test('resolver rejects an AUTH endpoint mismatch before any fetch', async () => {
  const { dir } = isolateRepo();
  const auth = readJson(dir, 'verification/research-program/authorization/metadata-authorizations.json');
  auth.entries.find((row) => row.id === METADATA_AUTH_ID).endpoints = [HCRIS_URL, HCRIS_URL];
  writeJson(dir, 'verification/research-program/authorization/metadata-authorizations.json', auth);
  const gate = countingFetch(successFetch());
  await assert.rejects(
    () => runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl }),
    { code: 'METADATA_AUTH_ENDPOINT_MISMATCH' },
  );
  assert.equal(gate.count(), 0);
});

test('execution authorization still binds exact HEAD + window before any fetch', () => {
  const head = 'c'.repeat(40);
  const base = {
    id: METADATA_AUTH_ID,
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

test('check does not fetch unless execute is set', async () => {
  await assert.rejects(() => runMetadataCheck({ execute: false, repoRoot: ROOT }), { code: 'METADATA_EXECUTE_FLAG_REQUIRED' });
});

test('missing corrected ledger is not recovered (no live fetch)', async () => {
  const { dir } = isolateRepo();
  rmSync(path.join(dir, CORRECTED_LEDGER_REL));
  const gate = countingFetch(successFetch());
  await assert.rejects(
    () => runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl }),
    { code: 'METADATA_LEDGER_REQUIRED' },
  );
  assert.equal(gate.count(), 0);
});

test('stale candidate HEAD fails closed before any fetch', async () => {
  const { dir } = isolateRepo();
  const auth = readJson(dir, 'verification/research-program/authorization/metadata-authorizations.json');
  auth.entries.find((row) => row.id === METADATA_AUTH_ID).candidate_head = 'e'.repeat(40);
  writeJson(dir, 'verification/research-program/authorization/metadata-authorizations.json', auth);
  const gate = countingFetch(successFetch());
  await assert.rejects(
    () => runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl }),
    { code: 'METADATA_AUTH_NOT_MATERIALIZED' },
  );
  assert.equal(gate.count(), 0);
});

test('expired AUTH window fails closed before any fetch', async () => {
  const { dir } = isolateRepo();
  const auth = readJson(dir, 'verification/research-program/authorization/metadata-authorizations.json');
  auth.entries.find((row) => row.id === METADATA_AUTH_ID).valid_until = new Date(Date.now() - 1000).toISOString();
  writeJson(dir, 'verification/research-program/authorization/metadata-authorizations.json', auth);
  const gate = countingFetch(successFetch());
  await assert.rejects(
    () => runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl }),
    { code: 'METADATA_AUTH_EXPIRED' },
  );
  assert.equal(gate.count(), 0);
});

test('revoked AUTH fails closed before any fetch', async () => {
  const { dir } = isolateRepo();
  const auth = readJson(dir, 'verification/research-program/authorization/metadata-authorizations.json');
  auth.entries.find((row) => row.id === METADATA_AUTH_ID).revoked = true;
  writeJson(dir, 'verification/research-program/authorization/metadata-authorizations.json', auth);
  const gate = countingFetch(successFetch());
  await assert.rejects(
    () => runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl }),
    { code: 'METADATA_AUTH_REVOKED' },
  );
  assert.equal(gate.count(), 0);
});

// ---- success paths: metadata docs parsed as documents ----

test('representative docs: CMS identity+dated release verified, CDC identity verified release unresolved, exactly 1+1=2', async () => {
  const { dir, head } = isolateRepo();
  const gate = countingFetch(successFetch());
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl });
  assert.equal(gate.count(), 2);
  assert.deepEqual(gate.urls(), [HCRIS_URL, PLACES_URL]);
  assert.equal(report.operation_id, METADATA_OPERATION_ID);
  assert.equal(report.captures.length, 2);
  assert.equal(report.requests_used, 2);
  assert.equal(report.requests_remaining, 0);
  assert.equal(report.qualified_sample_count, 0);
  assert.equal(report.ledger, CORRECTED_LEDGER_REL);
  assert.ok(existsSync(path.join(dir, RUN_REPORT_REL)));
  assert.equal(existsSync(path.join(dir, SPENT_LEDGER_REL)), false);
  const ledger = loadLedger({ repoRoot: dir });
  assert.equal(ledger.authorization_id, METADATA_AUTH_ID);
  assert.equal(ledger.totals.used_requests, 2);
  assert.equal(ledger.totals.remaining_requests, 0);
  assert.equal(ledger.per_source[HCRIS].used_requests, 1);
  assert.equal(ledger.per_source[PLACES].used_requests, 1);
  const expectedSha = createHash('sha256').update(readFileSync(path.join(ROOT, 'scripts/research-program/run-metadata-check.mjs'))).digest('hex');
  for (const cap of report.captures) {
    assert.equal(cap.capture_success, true);
    assert.equal(cap.error, undefined);
    assert.match(cap.evidence_sha256, /^[a-f0-9]{64}$/);
    assert.ok(existsSync(path.join(dir, cap.evidence_reference)));
    assert.ok(existsSync(path.join(dir, cap.receipt_reference)));
    assert.ok(cap.evidence_reference.startsWith(CAPTURE_DIR), cap.evidence_reference);
    assert.ok(cap.receipt_reference.startsWith(RECEIPT_DIR), cap.receipt_reference);
    const receipt = readJson(dir, cap.receipt_reference);
    assert.equal(receipt.format, 'ushso.metadata-receipt.v1');
    assert.equal(receipt.kind, 'metadata_check');
    assert.equal(receipt.operation_id, METADATA_OPERATION_ID);
    assert.equal(receipt.authorization.id, METADATA_AUTH_ID);
    assert.equal(receipt.candidate_head, head);
    assert.equal(receipt.execution_sha256, expectedSha);
    assert.equal(receipt.payload.field, 'source_metadata');
    assert.equal(receipt.payload.bounded_sample, undefined);
    assert.equal(receipt.payload.payload_success, undefined);
    assert.equal(receipt.request.attempted, true);
    assert.equal(receipt.request.url, cap.product_key === HCRIS ? HCRIS_URL : PLACES_URL);
    assert.equal(receipt.response.captured, true);
    assert.equal(receipt.response.http_status, 200);
    assert.ok(receipt.response.content_type.includes('json'));
    assert.equal(receipt.response.capture_sha256, cap.evidence_sha256);
    assert.equal(receipt.structure.recognized, true);
    assert.equal(receipt.identity.verified, true);
    assert.equal(receipt.failure, null);
    assert.ok(Array.isArray(receipt.limitations) && receipt.limitations.length > 0);
  }
  const cms = report.captures.find((row) => row.product_key === HCRIS);
  const cmsReceipt = readJson(dir, cms.receipt_reference);
  assert.equal(cmsReceipt.structure.parser_version, CMS_PARSER_VERSION);
  assert.ok(cmsReceipt.identity.facts.some((fact) => fact.path === '$.dataset.uuid' && fact.value === CMS_DATASET_UUID));
  assert.equal(cms.release_status ?? cmsReceipt.release.status, 'verified');
  assert.equal(cmsReceipt.release.status, 'verified');
  assert.equal(cmsReceipt.release.claimed_release, 'CostReport_2023_Final');
  assert.ok(cmsReceipt.release.evidence.some((fact) => fact.path === '$.resources[0].name' && fact.value === 'CostReport_2023_Final.csv'));
  const cdc = report.captures.find((row) => row.product_key === PLACES);
  const cdcReceipt = readJson(dir, cdc.receipt_reference);
  assert.equal(cdcReceipt.structure.parser_version, CDC_PARSER_VERSION);
  assert.ok(cdcReceipt.identity.facts.some((fact) => fact.path === '$.id' && fact.value === CDC_VIEW_ID));
  assert.equal(cdc.release_verified ?? false, false);
  assert.equal(cdcReceipt.release.status, 'unresolved');
  assert.ok(cdcReceipt.year_notes.some((note) => String(note.path).startsWith('$.columns[')));
  assert.ok(!JSON.stringify(cdcReceipt.release.evidence).includes('year'));
});

test('correct identity with insufficient release evidence stays unresolved, not a failure', async () => {
  const { dir } = isolateRepo();
  const gate = countingFetch(async (url) => {
    if (url.includes('44060663')) return jsonResponse(CMS_DOC_UNRESOLVED);
    return jsonResponse(CDC_DOC);
  });
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl });
  assert.equal(gate.count(), 2);
  for (const cap of report.captures) {
    assert.equal(cap.capture_success, true);
    assert.equal(cap.identity_verified, true);
    assert.equal(cap.release_status, 'unresolved');
    assert.equal(cap.acceptance_eligible, false);
    assert.equal(cap.error, undefined);
    const receipt = readJson(dir, cap.receipt_reference);
    assert.equal(receipt.release.status, 'unresolved');
    assert.equal(receipt.failure, null);
  }
  assert.equal(report.qualified_sample_count, 0);
});

test('metadata receipts count zero samples via payloadSampleCountsFromReceipts', async () => {
  const { dir } = isolateRepo();
  const gate = countingFetch(successFetch());
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl });
  const receipts = report.captures.map((cap) => readJson(dir, cap.receipt_reference));
  assert.ok(receipts.length >= 2);
  for (const receipt of receipts) {
    assert.notEqual(receipt.kind, 'core_cell');
    assert.notEqual(receipt.payload?.field, 'publisher_access');
  }
  const products = loadCohort(path.join(ROOT, 'evaluation/research-program/cohorts.json')).products;
  assert.equal(payloadSampleCountsFromReceipts(receipts, products).public_sample_complete, 0);
});

// ---- typed failure paths (exact codes + fetch counts) ----

test('wrong CMS dataset UUID is rejected as wrong product', async () => {
  const { dir } = isolateRepo();
  const wrong = structuredClone(CMS_DOC_VERIFIED);
  wrong.dataset.uuid = '11111111-2222-3333-4444-555555555555';
  const gate = countingFetch(async (url) => {
    if (url.includes('44060663')) return jsonResponse(wrong);
    return jsonResponse(CDC_DOC);
  });
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl });
  assert.equal(gate.count(), 2);
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.error.code, 'METADATA_IDENTITY_MISMATCH');
  assert.equal(hcris.capture_success, true);
  const receipt = readJson(dir, hcris.receipt_reference);
  assert.equal(receipt.response.captured, true);
  assert.equal(receipt.structure.recognized, true);
  assert.equal(receipt.identity.verified, false);
  assert.equal(receipt.failure.code, 'METADATA_IDENTITY_MISMATCH');
});

test('wrong CDC view id is rejected as wrong product', async () => {
  const { dir } = isolateRepo();
  const wrong = { ...CDC_DOC, id: 'xxxx-yyyy' };
  const gate = countingFetch(async (url) => {
    if (url.includes('44060663')) return jsonResponse(CMS_DOC_VERIFIED);
    return jsonResponse(wrong);
  });
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl });
  assert.equal(gate.count(), 2);
  const places = report.captures.find((row) => row.product_key === PLACES);
  assert.equal(places.error.code, 'METADATA_IDENTITY_MISMATCH');
  const receipt = readJson(dir, places.receipt_reference);
  assert.equal(receipt.failure.code, 'METADATA_IDENTITY_MISMATCH');
});

test('malformed JSON body fails METADATA_NOT_JSON after capture', async () => {
  const { dir } = isolateRepo();
  const gate = countingFetch(async (url) => {
    if (url.includes('44060663')) return jsonResponse('not json{{{');
    return jsonResponse(CDC_DOC);
  });
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl });
  assert.equal(gate.count(), 2);
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.error.code, 'METADATA_NOT_JSON');
  const receipt = readJson(dir, hcris.receipt_reference);
  assert.equal(receipt.response.captured, true);
  assert.equal(receipt.structure.recognized, false);
  assert.equal(receipt.failure.code, 'METADATA_NOT_JSON');
});

test('HTML content-type fails METADATA_CONTENT_TYPE after capture', async () => {
  const { dir } = isolateRepo();
  const gate = countingFetch(async (url) => {
    if (url.includes('44060663')) return jsonResponse('<html>nope</html>', { headers: { 'content-type': 'text/html' } });
    return jsonResponse(CDC_DOC);
  });
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl });
  assert.equal(gate.count(), 2);
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.error.code, 'METADATA_CONTENT_TYPE');
  const receipt = readJson(dir, hcris.receipt_reference);
  assert.equal(receipt.response.captured, true);
  assert.equal(receipt.structure.recognized, false);
  assert.equal(receipt.failure.code, 'METADATA_CONTENT_TYPE');
});

test('non-2xx status fails METADATA_HTTP_STATUS without capture', async () => {
  const { dir } = isolateRepo();
  const gate = countingFetch(async (url) => {
    if (url.includes('44060663')) return jsonResponse({ error: true }, { status: 500 });
    return jsonResponse(CDC_DOC);
  });
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl });
  assert.equal(gate.count(), 2);
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.error.code, 'METADATA_HTTP_STATUS');
  assert.equal(hcris.capture_success, false);
  const receipt = readJson(dir, hcris.receipt_reference);
  assert.equal(receipt.response.captured, false);
  assert.equal(receipt.response.http_status, null);
  assert.equal(receipt.failure.code, 'METADATA_HTTP_STATUS');
});

test('oversized body over 65536 cancels and fails METADATA_BYTE_LIMIT', async () => {
  const { dir } = isolateRepo();
  const cancelled = [];
  const gate = countingFetch(async (url) => {
    if (url.includes('44060663')) return jsonResponse(CMS_DOC_VERIFIED, { oversized: true, onCancel: (reason) => cancelled.push(reason) });
    return jsonResponse(CDC_DOC);
  });
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl });
  assert.equal(gate.count(), 2);
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.error.code, 'METADATA_BYTE_LIMIT');
  assert.ok(cancelled.includes('oversized'));
  const receipt = readJson(dir, hcris.receipt_reference);
  assert.equal(receipt.response.captured, false);
});

test('stalled body hits the global deadline with METADATA_GLOBAL_TIMEOUT', async () => {
  const { dir } = isolateRepo();
  let t = 1_000_000;
  const cancelled = [];
  const fetchImpl = async (url) => {
    if (url.includes('44060663')) {
      return {
        status: 200,
        headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null) },
        body: {
          async cancel(reason) { cancelled.push(reason ?? 'cancel'); },
          getReader() {
            let n = 0;
            return {
              async read() {
                n += 1;
                if (n === 1) {
                  t += 20_000;
                  return { done: false, value: Buffer.from('{"dataset":') };
                }
                await new Promise(() => {});
              },
              async cancel(reason) { cancelled.push(reason ?? 'cancel'); },
            };
          },
        },
      };
    }
    return jsonResponse(CDC_DOC);
  };
  let fetches = 0;
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: async (url, init) => { fetches += 1; return fetchImpl(url, init); }, now: () => t });
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.error.code, 'METADATA_GLOBAL_TIMEOUT');
  assert.ok(cancelled.includes('timeout'));
  assert.equal(fetches, 1);
});

test('any redirect aborts with METADATA_REDIRECT_NOT_PERMITTED and spends only the initial unit', async () => {
  const { dir } = isolateRepo();
  const gate = countingFetch(async (url) => {
    if (url === HCRIS_URL) {
      return {
        status: 302,
        headers: { get: (name) => (name === 'location' ? HCRIS_URL : null) },
        body: { async cancel() {}, getReader() { return { async read() { return { done: true }; }, async cancel() {} }; } },
      };
    }
    return jsonResponse(CDC_DOC);
  });
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl });
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.error.code, 'METADATA_REDIRECT_NOT_PERMITTED');
  assert.deepEqual(gate.urls().filter((url) => url.includes('44060663')), [HCRIS_URL]);
  assert.equal(loadLedger({ repoRoot: dir }).per_source[HCRIS].used_requests, 1);
});

test('duplicate query key on a redirect Location is rejected', async () => {
  const { dir } = isolateRepo();
  const gate = countingFetch(async (url) => {
    if (url === HCRIS_URL) {
      return {
        status: 302,
        headers: { get: (name) => (name === 'location' ? HCRIS_URL + '?a=1&a=2' : null) },
        body: { async cancel() {}, getReader() { return { async read() { return { done: true }; }, async cancel() {} }; } },
      };
    }
    return jsonResponse(CDC_DOC);
  });
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl });
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.error.code, 'METADATA_URL_DUPLICATE_QUERY');
  assert.deepEqual(gate.urls().filter((url) => url.includes('44060663')), [HCRIS_URL]);
});

test('any 429/503 retry aborts with METADATA_RETRY_NOT_PERMITTED', async () => {
  const { dir } = isolateRepo();
  const gate = countingFetch(async (url) => {
    if (url.includes('44060663')) return jsonResponse('busy', { status: 503 });
    return jsonResponse(CDC_DOC);
  });
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl });
  assert.equal(gate.count(), 2);
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.error.code, 'METADATA_RETRY_NOT_PERMITTED');
});

test('exhausted ledger fails closed before any fetch', async () => {
  const { dir } = isolateRepo();
  const ledger = readJson(dir, CORRECTED_LEDGER_REL);
  ledger.totals.used_requests = 2;
  ledger.totals.remaining_requests = 0;
  ledger.per_source[HCRIS].used_requests = 1;
  ledger.per_source[HCRIS].remaining_requests = 0;
  ledger.per_source[PLACES].used_requests = 1;
  ledger.per_source[PLACES].remaining_requests = 0;
  writeJson(dir, CORRECTED_LEDGER_REL, ledger);
  const gate = countingFetch(successFetch());
  await assert.rejects(
    () => runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl }),
    { code: 'METADATA_REQUEST_BUDGET_EXHAUSTED' },
  );
  assert.equal(gate.count(), 0);
});

test('mismatched ledger totals fail closed before any fetch', async () => {
  const { dir } = isolateRepo();
  const ledger = readJson(dir, CORRECTED_LEDGER_REL);
  ledger.totals.max_requests = 99;
  writeJson(dir, CORRECTED_LEDGER_REL, ledger);
  const gate = countingFetch(successFetch());
  await assert.rejects(
    () => runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl }),
    { code: 'METADATA_LEDGER_LIMIT_MISMATCH' },
  );
  assert.equal(gate.count(), 0);
});

test('spent-ledger authorization id in the corrected path fails closed before any fetch', async () => {
  const { dir } = isolateRepo();
  const ledger = readJson(dir, CORRECTED_LEDGER_REL);
  ledger.authorization_id = 'AUTH-METADATA-CHECK';
  writeJson(dir, CORRECTED_LEDGER_REL, ledger);
  const gate = countingFetch(successFetch());
  await assert.rejects(
    () => runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl }),
    { code: 'METADATA_LEDGER_AUTH' },
  );
  assert.equal(gate.count(), 0);
});

test('concurrent invocations respect the lock and do not double-spend', async () => {
  const { dir } = isolateRepo();
  let releaseFetch;
  const started = new Promise((res) => { releaseFetch = res; });
  let cont;
  const held = new Promise((res) => { cont = res; });
  let n = 0;
  const gate = countingFetch(async (url) => {
    n += 1;
    if (n === 1) { releaseFetch(); await held; }
    if (url.includes('44060663')) return jsonResponse(CMS_DOC_VERIFIED);
    return jsonResponse(CDC_DOC);
  });
  const first = runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl });
  await started;
  const secondErr = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl }).then(() => null, (error) => error);
  cont();
  await first;
  assert.equal(secondErr?.code, 'METADATA_CONCURRENT_INVOCATION');
  assert.ok(loadLedger({ repoRoot: dir }).totals.used_requests <= 2);
});

test('interrupted execution preserves the persisted budget (no loss, no double-spend)', async () => {
  const { dir } = isolateRepo();
  let fetches = 0;
  const fetchImpl = async (url) => {
    fetches += 1;
    if (url.includes('44060663')) return jsonResponse(CMS_DOC_VERIFIED);
    throw new Error('simulated interruption');
  };
  const report = await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl });
  assert.equal(fetches, 2);
  const hcris = report.captures.find((row) => row.product_key === HCRIS);
  assert.equal(hcris.capture_success, true);
  assert.equal(hcris.error, undefined);
  const places = report.captures.find((row) => row.product_key === PLACES);
  assert.equal(places.error.code, 'METADATA_FETCH_FAILED');
  const placesReceipt = readJson(dir, places.receipt_reference);
  assert.equal(placesReceipt.request.attempted, true);
  assert.equal(placesReceipt.response.captured, false);
  assert.equal(placesReceipt.failure.code, 'METADATA_FETCH_FAILED');
  const ledger = loadLedger({ repoRoot: dir });
  assert.equal(ledger.totals.used_requests, 2);
  assert.equal(ledger.totals.remaining_requests, 0);
  assert.equal(ledger.per_source[HCRIS].used_requests, 1);
  assert.equal(ledger.per_source[PLACES].used_requests, 1);
});

test('payload endpoints cannot satisfy the corrected metadata operation (fetch count 0)', async () => {
  const { dir } = isolateRepo();
  const packet = readJson(dir, 'verification/research-program/evidence/metadata-check-packet.json');
  packet.products[0].endpoint = FORBIDDEN_HCRIS_PAYLOAD_URL;
  packet.products[1].endpoint = FORBIDDEN_PLACES_PAYLOAD_URL;
  packet.endpoint_provenance.urls = [FORBIDDEN_HCRIS_PAYLOAD_URL, FORBIDDEN_PLACES_PAYLOAD_URL];
  writeJson(dir, 'verification/research-program/evidence/metadata-check-packet.json', packet);
  const gate = countingFetch(successFetch());
  try {
    await runMetadataCheck({ execute: true, repoRoot: dir, fetchImpl: gate.fetchImpl });
    assert.fail('tampered payload packet should have been rejected');
  } catch (error) {
    assert.ok(
      ['METADATA_ENDPOINT_PROVENANCE', 'METADATA_EXACT_URLS'].includes(error.code),
      'expected provenance/exact-URL rejection, got ' + error.code,
    );
  }
  assert.equal(gate.count(), 0);
  assert.equal(loadLedger({ repoRoot: dir }).totals.used_requests, 0);
  assert.equal(loadLedger({ repoRoot: dir }).totals.remaining_requests, 2);
});

test('collector allowlist forbids payload URLs pre-fetch even if AUTH is stale (defense in depth)', () => {
  assert.equal(isForbiddenPayloadUrl(FORBIDDEN_HCRIS_PAYLOAD_URL), true);
  assert.equal(isForbiddenPayloadUrl(FORBIDDEN_PLACES_PAYLOAD_URL), true);
  assert.equal(isForbiddenPayloadUrl(HCRIS_URL), false);
  assert.equal(isForbiddenPayloadUrl(PLACES_URL), false);
  const op = resolveMetadataOperation({ repoRoot: ROOT });
  assert.doesNotThrow(() => assertMetadataUrlAllowed(op, HCRIS, HCRIS_URL));
  assert.doesNotThrow(() => assertMetadataUrlAllowed(op, PLACES, PLACES_URL));
  assert.throws(() => assertMetadataUrlAllowed(op, HCRIS, FORBIDDEN_HCRIS_PAYLOAD_URL), { code: 'METADATA_PAYLOAD_URL_FORBIDDEN' });
  assert.throws(() => assertMetadataUrlAllowed(op, PLACES, FORBIDDEN_PLACES_PAYLOAD_URL), { code: 'METADATA_PAYLOAD_URL_FORBIDDEN' });
  assert.throws(() => assertMetadataUrlAllowed(op, HCRIS, 'https://data.cms.gov/data-api/v1/other'), { code: 'METADATA_URL_OUT_OF_SCOPE' });
  assert.throws(() => assertMetadataUrlAllowed(op, HCRIS, HCRIS_URL + '?a=1&a=2'), { code: 'METADATA_URL_DUPLICATE_QUERY' });
});

// ---- parser unit tests (offline, no fetch) ----

test('CMS parser verifies a dated release distribution and records field paths', () => {
  const out = parseCmsDatasetResources(Buffer.from(JSON.stringify(CMS_DOC_VERIFIED)));
  assert.equal(out.recognized, true);
  assert.equal(out.parser_version, CMS_PARSER_VERSION);
  assert.equal(out.identity.verified, true);
  assert.equal(out.identity.uuid_path, '$.dataset.uuid');
  assert.ok(out.identity.facts.some((fact) => fact.path === '$.dataset.title'));
  assert.ok(out.identity.facts.some((fact) => fact.path === '$.resources[0].accessURL'));
  assert.equal(out.release.status, 'verified');
  assert.deepEqual(out.release.evidence.map((fact) => fact.path), ['$.resources[0].name', '$.resources[0].modified']);
  assert.ok(out.year_notes.some((note) => note.path === '$.dataset.description'));
});

test('CMS parser keeps insufficient release evidence unresolved (not a failure)', () => {
  const out = parseCmsDatasetResources(Buffer.from(JSON.stringify(CMS_DOC_UNRESOLVED)));
  assert.equal(out.recognized, true);
  assert.equal(out.identity.verified, true);
  assert.equal(out.release.status, 'unresolved');
  assert.equal(out.failure, undefined);
});

test('CMS parser rejects wrong-product, missing, malformed, and shapeless docs with typed codes', () => {
  const wrong = structuredClone(CMS_DOC_VERIFIED);
  wrong.dataset.uuid = '11111111-2222-3333-4444-555555555555';
  assert.equal(parseCmsDatasetResources(Buffer.from(JSON.stringify(wrong))).failure, 'METADATA_IDENTITY_MISMATCH');
  const missing = structuredClone(CMS_DOC_VERIFIED);
  delete missing.dataset.uuid;
  assert.equal(parseCmsDatasetResources(Buffer.from(JSON.stringify(missing))).failure, 'METADATA_IDENTITY_MISSING');
  assert.equal(parseCmsDatasetResources(Buffer.from('nope{{{')).failure, 'METADATA_NOT_JSON');
  assert.equal(parseCmsDatasetResources(Buffer.from('[1,2]')).failure, 'METADATA_STRUCTURE_UNRECOGNIZED');
  assert.equal(parseCmsDatasetResources(Buffer.from(JSON.stringify({ dataset: {} }))).failure, 'METADATA_STRUCTURE_UNRECOGNIZED');
});

test('CDC parser verifies identity, keeps release unresolved, and separates year notes', () => {
  const out = parseCdcSocrataView(Buffer.from(JSON.stringify(CDC_DOC)));
  assert.equal(out.recognized, true);
  assert.equal(out.parser_version, CDC_PARSER_VERSION);
  assert.equal(out.identity.verified, true);
  assert.equal(out.identity.id_path, '$.id');
  assert.ok(out.identity.facts.some((fact) => fact.path === '$.columns[0].fieldName' && fact.value === 'stateabbr'));
  assert.equal(out.release.status, 'unresolved');
  assert.deepEqual(out.release.evidence, []);
  assert.ok(out.year_notes.some((note) => String(note.path).startsWith('$.columns[1]')));
});

test('CDC parser honors an explicit release statement and rejects wrong-product docs', () => {
  const released = { ...structuredClone(CDC_DOC), metadata: { release: 'PLACES_2025_county_table' } };
  const verified = parseCdcSocrataView(Buffer.from(JSON.stringify(released)));
  assert.equal(verified.identity.verified, true);
  assert.equal(verified.release.status, 'verified');
  assert.deepEqual(verified.release.evidence, [{ path: '$.metadata.release', value: 'PLACES_2025_county_table' }]);
  const wrong = { ...CDC_DOC, id: 'xxxx-yyyy' };
  assert.equal(parseCdcSocrataView(Buffer.from(JSON.stringify(wrong))).failure, 'METADATA_IDENTITY_MISMATCH');
  assert.equal(parseCdcSocrataView(Buffer.from('nope{{{')).failure, 'METADATA_NOT_JSON');
  assert.equal(parseCdcSocrataView(Buffer.from(JSON.stringify({ hello: 1 }))).failure, 'METADATA_STRUCTURE_UNRECOGNIZED');
});
