import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  validatePayloadRetrievalPilot,
  PILOT_HISTORICAL_BRANCH,
} from '../../scripts/research-program/validate-payload-retrieval-pilot.mjs';
import { assertPilotExecutionAuthorized } from '../../scripts/research-program/run-payload-retrieval-pilot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HISTORICAL = 'codex/ushso-evidence-ingestion-20260915';

function copyNeeded(srcRoot, dstRoot, rel) {
  mkdirSync(path.dirname(path.join(dstRoot, rel)), { recursive: true });
  cpSync(path.join(srcRoot, rel), path.join(dstRoot, rel));
}

function isolateOffline({ branch = HISTORICAL, detached = false } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ushso-pilot-offline-'));
  for (const rel of [
    'evaluation/research-program/cohorts.json',
    'verification/research-program/evidence/payload-retrieval-pilot.json',
    'verification/research-program/authorization/payload-authorizations.json',
    'verification/research-program/evidence/product-sample-requirements.json',
    'verification/external-authorization/v1.0.0/register.json',
    '.gitignore',
  ]) copyNeeded(ROOT, dir, rel);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['checkout', '-B', branch], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=pilot@example.test', '-c', 'user.name=pilot', 'commit', '-qm', 'isolate'], { cwd: dir });
  if (detached) execFileSync('git', ['checkout', '--detach', 'HEAD'], { cwd: dir });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const current = execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim();
  return { dir, head, current };
}

test('payload-retrieval pilot is prepared, unauthorized, bound to frozen identities, and does not substitute PLACES 7cmc-7y5g', () => {
  const report = validatePayloadRetrievalPilot();
  assert.equal(report.status, 'prepared_not_authorized');
  assert.equal(report.authorized, false);
  assert.equal(report.live_http, false);
  assert.equal(report.accepted, false);
  assert.deepEqual(report.products, ['cms-hcris-hospital-provider-cost-report', 'cdc-places-local-data-for-better-health']);
  assert.equal(report.frozen_cohorts_unmodified, true);
  assert.equal(report.captures_gitignored, true);
  assert.equal(report.redirects_consume_budget, true);
  // Historical provenance preserved, but offline validation is branch-agnostic.
  assert.equal(report.branch, HISTORICAL);
  assert.equal(report.packet_branch, HISTORICAL);
  assert.equal(report.historical_branch, HISTORICAL);
  assert.equal(PILOT_HISTORICAL_BRANCH, HISTORICAL);
  assert.equal(report.branch_enforcement, 'execution-only');
  assert.match(report.git_head, /^[a-f0-9]{40}$/);
  assert.equal(report.checkout_head, report.git_head);
  assert.ok(report.checkout_branch === null || typeof report.checkout_branch === 'string');
  assert.equal(typeof report.detached_head_allowed, 'boolean');
});

test('payload offline validation passes on integration branch (no dev-branch gate)', () => {
  const { dir, head } = isolateOffline({ branch: 'codex/ushso-corr2-gate-20260917' });
  const report = validatePayloadRetrievalPilot({ repoRoot: dir });
  assert.equal(report.status, 'prepared_not_authorized');
  assert.equal(report.packet_branch, HISTORICAL);
  assert.equal(report.historical_branch, HISTORICAL);
  assert.equal(report.checkout_branch, 'codex/ushso-corr2-gate-20260917');
  assert.equal(report.checkout_head, head);
  assert.equal(report.branch_enforcement, 'execution-only');
});

test('payload offline validation passes on detached HEAD (no detached workaround needed)', () => {
  const { dir, head, current } = isolateOffline({ branch: 'codex/ushso-corr2-gate-20260917', detached: true });
  assert.equal(current, '');
  const report = validatePayloadRetrievalPilot({ repoRoot: dir });
  assert.equal(report.status, 'prepared_not_authorized');
  assert.equal(report.checkout_branch, null);
  assert.equal(report.checkout_head, head);
  assert.equal(report.detached_head_allowed, true);
});

test('payload execution authorization still binds exact HEAD before any fetch', () => {
  const head = 'a'.repeat(40);
  const base = {
    id: 'AUTH-PAYLOAD-PILOT',
    authorized: true,
    status: 'authorized',
    revoked: false,
    candidate_head: head,
    valid_from: new Date(Date.now() - 3600_000).toISOString(),
    valid_until: new Date(Date.now() + 3600_000).toISOString(),
  };
  assert.doesNotThrow(() => assertPilotExecutionAuthorized(base, head, Date.now));
  assert.throws(() => assertPilotExecutionAuthorized(base, 'b'.repeat(40), Date.now), { code: 'PILOT_AUTH_NOT_MATERIALIZED' });
  assert.throws(
    () => assertPilotExecutionAuthorized({ ...base, valid_until: new Date(Date.now() - 1000).toISOString() }, head, Date.now),
    { code: 'PILOT_AUTH_EXPIRED' },
  );
  assert.throws(() => assertPilotExecutionAuthorized({ ...base, revoked: true }, head, Date.now), { code: 'PILOT_AUTH_REVOKED' });
});
