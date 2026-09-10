// Focused suite for PR-003 slice C-003-2: scripts/research-program/check-handoff.mjs.
//
// These tests exercise the validator on the committed packet fixtures:
//   * one valid packet, bound to real local files, dependency SHAs and base SHA;
//   * the three required incomplete packets (missing command result, missing
//     artifact, stale dependency SHA);
//   * one artifact SHA-256 tamper case;
//   * input path containment and CLI exit-code behavior.
//
// A passing packet is producer evidence, not independent verification.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import {
  REPO_ROOT,
  checkHandoff,
  resolveContainedPath
} from '../../scripts/research-program/check-handoff.mjs';

const SCRIPT = path.join(REPO_ROOT, 'scripts', 'research-program', 'check-handoff.mjs');
const FIXTURE_DIR = path.join(REPO_ROOT, 'verification', 'research-program', 'pr-003', 'fixtures');

const fixture = name => path.join(FIXTURE_DIR, name);
const rulesOf = report => report.findings.map(finding => finding.rule);
const statusOf = (report, id) => report.checks.find(check => check.id === id)?.status;

function runCli(...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = null;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

test('resolveContainedPath accepts repository-relative paths and rejects escapes', () => {
  const accepted = resolveContainedPath(
    REPO_ROOT,
    'docs/research-program/handoffs/schema/task.schema.json'
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.relative, 'docs/research-program/handoffs/schema/task.schema.json');

  for (const bad of ['/etc/passwd', '../outside.json', 'docs/../../outside.json', '']) {
    const rejected = resolveContainedPath(REPO_ROOT, bad);
    assert.equal(rejected.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test('valid packet is accepted and bound to concrete local sources and dependency SHAs', async () => {
  const report = await checkHandoff(fixture('handoff.valid.json'), { repoRoot: REPO_ROOT });

  assert.equal(report.ok, true);
  assert.equal(report.outcome, 'accepted');
  assert.deepEqual(report.findings, []);

  assert.equal(statusOf(report, 'dependency_sha_binding'), 'passed');
  assert.equal(statusOf(report, 'base_sha_binding'), 'passed');
  assert.equal(statusOf(report, 'git_commit_binding'), 'passed');
  assert.equal(statusOf(report, 'artifact_path_containment'), 'passed');
  assert.equal(statusOf(report, 'artifact_file_existence'), 'passed');
  assert.equal(statusOf(report, 'artifact_sha256_binding'), 'passed');
  assert.equal(statusOf(report, 'source_identity_binding'), 'passed');

  assert.equal(report.handoff.pr_id, 'PR-003');
  assert.match(report.handoff.sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.independent_review.status, 'not_claimed');

  // Typed outcomes are preserved, never coerced into a clean pass.
  assert.deepEqual(report.preserved_outcomes.non_pass_acceptance_results, []);
  assert.equal(report.preserved_outcomes.head_sha_pending, true);
  assert.ok(report.notes.some(note => note.rule === 'head_sha_pending'));
});

test('a claimed pass without a command result is rejected', async () => {
  const report = await checkHandoff(fixture('handoff.reject-claimed-pass-without-command.json'), {
    repoRoot: REPO_ROOT
  });

  assert.equal(report.ok, false);
  assert.equal(report.outcome, 'rejected');
  assert.ok(rulesOf(report).includes('claimed_pass_without_command_result'));
  assert.equal(statusOf(report, 'command_result_resolution'), 'failed');
});

test('a handoff with a missing artifact reference is rejected', async () => {
  const report = await checkHandoff(fixture('handoff.reject-missing-artifact.json'), {
    repoRoot: REPO_ROOT
  });

  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('missing_artifact'));
  assert.equal(statusOf(report, 'artifact_reference_resolution'), 'failed');
});

test('a handoff with a stale dependency SHA is rejected', async () => {
  const report = await checkHandoff(fixture('handoff.reject-stale-dependency-sha.json'), {
    repoRoot: REPO_ROOT
  });

  assert.equal(report.ok, false);
  const stale = report.findings.find(finding => finding.rule === 'stale_dependency_sha');
  assert.ok(stale);
  assert.match(stale.detail, /PR-002 expected 5647e814/);
  assert.equal(statusOf(report, 'dependency_sha_binding'), 'failed');
});

test('a handoff whose artifact SHA-256 does not match disk is rejected', async () => {
  const report = await checkHandoff(fixture('handoff.reject-artifact-hash-mismatch.json'), {
    repoRoot: REPO_ROOT
  });

  assert.equal(report.ok, false);
  const mismatch = report.findings.find(finding => finding.rule === 'artifact_hash_mismatch');
  assert.ok(mismatch);
  assert.match(mismatch.detail, /artifact-checker/);
  assert.equal(statusOf(report, 'artifact_sha256_binding'), 'failed');
});

test('a handoff outside the repository root is rejected before it is read', async () => {
  // Containment is decided lexically before any filesystem access, so a
  // non-existent path above the repository root is a safe, write-free probe.
  const outside = path.resolve(REPO_ROOT, '..', '..', 'ushso-outside-handoff.json');
  const report = await checkHandoff(outside, { repoRoot: REPO_ROOT });
  assert.equal(report.ok, false);
  const containment = report.findings.find(
    finding => finding.rule === 'handoff_path_out_of_containment'
  );
  assert.ok(containment);
  assert.equal(statusOf(report, 'input_path_containment'), 'failed');
  assert.equal(statusOf(report, 'handoff_readable'), 'not_executed');
});

test('CLI exits 0 for the valid packet and 1 for each incomplete packet', () => {
  const valid = runCli(fixture('handoff.valid.json'));
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.json?.ok, true);

  for (const name of [
    'handoff.reject-claimed-pass-without-command.json',
    'handoff.reject-missing-artifact.json',
    'handoff.reject-stale-dependency-sha.json'
  ]) {
    const result = runCli(fixture(name));
    assert.equal(result.status, 1, `${name}: ${result.stderr}`);
    assert.equal(result.json?.ok, false, name);
    assert.equal(result.json?.outcome, 'rejected', name);
  }
});

test('CLI treats a wrong argument count as a usage error', () => {
  const noArgs = runCli();
  assert.equal(noArgs.status, 2);

  const twoArgs = runCli(fixture('handoff.valid.json'), fixture('handoff.valid.json'));
  assert.equal(twoArgs.status, 2);
});
