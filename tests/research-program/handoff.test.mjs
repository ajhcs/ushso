// Focused suite for PR-003 C-003-2 and integrity corrections C-003-1-R1/C-003-2-R1.
//
// The suite exercises the validator on committed fixtures and ephemeral,
// write-then-remove symlink probes. A passing packet is producer evidence, not
// independent verification or scientific acceptance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
const readJson = async name => JSON.parse(await readFile(fixture(name), 'utf8'));
const writeRuntimeHandoff = async (name, handoff) => {
  const dir = await mkdtemp(path.join(FIXTURE_DIR, '.runtime-handoff-'));
  const file = path.join(dir, name);
  await writeFile(file, `${JSON.stringify(handoff, null, 2)}\n`);
  return { dir, file };
};

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
  assert.equal(report.binding_source, 'sibling-task-binding');
  assert.equal(report.authorities.task_bindings.length, 1);

  // A producer packet can carry a typed pending head while the controller has
  // not yet made the commit. Null is accepted only with that explicit claim.
  assert.deepEqual(report.preserved_outcomes.non_pass_acceptance_results, []);
  assert.equal(report.preserved_outcomes.head_sha_pending, true);
  assert.ok(report.notes.some(note => note.rule === 'head_sha_pending'));
});

test('expected-negative nonzero outcome is accepted when expected and observed match', async () => {
  const report = await checkHandoff(fixture('handoff.valid-expected-negative.json'), {
    repoRoot: REPO_ROOT
  });
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.equal(report.findings.length, 0);
});

test('typed unavailable outcome preserves provider limitation without inventing an exit', async () => {
  const report = await checkHandoff(fixture('handoff.valid-unavailable.json'), {
    repoRoot: REPO_ROOT
  });
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.equal(report.findings.length, 0);
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

test('a nonzero observation cannot back a success claim expecting exit zero', async () => {
  const report = await checkHandoff(fixture('handoff.reject-nonzero-success.json'), {
    repoRoot: REPO_ROOT
  });
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('command_outcome_mismatch'));
});

test('duplicate command IDs with conflicting outcomes are rejected', async () => {
  const report = await checkHandoff(fixture('handoff.reject-duplicate-command.json'), {
    repoRoot: REPO_ROOT
  });
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('duplicate_command_id'));
});

test('completed packet cannot hide empty evidence or a null owner', async () => {
  const report = await checkHandoff(fixture('handoff.reject-empty-evidence.json'), {
    repoRoot: REPO_ROOT
  });
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('empty_evidence_array'));
  assert.ok(rulesOf(report).includes('packet_owner_missing'));
});

test('local source identity must carry its hash', async () => {
  const report = await checkHandoff(fixture('handoff.reject-source-hash-omitted.json'), {
    repoRoot: REPO_ROOT
  });
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('source_identity_hash_omitted'));
});

test('nested event source is subject to existence, containment and hash binding', async () => {
  const report = await checkHandoff(fixture('handoff.reject-missing-event-source.json'), {
    repoRoot: REPO_ROOT
  });
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('artifact_missing_on_disk'));
});

test('nonexistent all-zero head is rejected while the pending null convention is explicit', async () => {
  const report = await checkHandoff(fixture('handoff.reject-invalid-head.json'), {
    repoRoot: REPO_ROOT
  });
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('head_sha_not_local_commit'));

  const terminal = await readJson('handoff.valid.json');
  terminal.status = 'independently_verified';
  const runtime = await writeRuntimeHandoff('terminal-null-head.json', terminal);
  try {
    const terminalReport = await checkHandoff(runtime.file, { repoRoot: REPO_ROOT });
    assert.equal(terminalReport.ok, false);
    assert.ok(rulesOf(terminalReport).includes('head_sha_required_for_terminal_state'));
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('base SHA must match the concrete per-PR task binding', async () => {
  const report = await checkHandoff(fixture('handoff.reject-stale-base-sha.json'), {
    repoRoot: REPO_ROOT
  });
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('stale_base_sha'));
});

test('local source and changed-file paths reject symlink escapes', async () => {
  const handoff = await readJson('handoff.valid.json');
  const runtime = await writeRuntimeHandoff('symlink-escape.json', handoff);
  const sourceLink = path.join(runtime.dir, 'source-link');
  const relativeSourceLink = path.relative(REPO_ROOT, sourceLink);
  await symlink('/etc/hosts', sourceLink);
  const changedLink = path.join(runtime.dir, 'changed-link');
  const relativeChangedLink = path.relative(REPO_ROOT, changedLink);
  await symlink('/etc/hosts', changedLink);
  handoff.source_identities[0] = {
    kind: 'symlink-probe', id: relativeSourceLink, location: 'local', sha256: '0'.repeat(64)
  };
  handoff.changed_files = [relativeChangedLink];
  await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
  try {
    const report = await checkHandoff(runtime.file, { repoRoot: REPO_ROOT });
    assert.equal(report.ok, false);
    assert.ok(rulesOf(report).includes('source_identity_path_escapes_root_via_symlink'));
    assert.ok(rulesOf(report).includes('changed_file_escapes_root_via_symlink'));
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('sibling task-binding symlink is rejected before JSON fallback', async () => {
  const handoff = await readJson('handoff.valid.json');
  const runtime = await writeRuntimeHandoff('binding-symlink.json', handoff);
  const bindingLink = path.join(runtime.dir, 'task-binding.json');
  await symlink('/etc/hosts', bindingLink);
  try {
    const report = await checkHandoff(runtime.file, { repoRoot: REPO_ROOT });
    assert.equal(report.ok, false);
    assert.ok(rulesOf(report).includes('task_binding_path_escapes_root_via_symlink'));
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('repoRoot controls packet and evidence roots while schemas stay module-authoritative', async () => {
  const valid = await checkHandoff('verification/research-program/pr-003/fixtures/handoff.valid.json', {
    repoRoot: REPO_ROOT
  });
  assert.equal(valid.ok, true, JSON.stringify(valid.findings));
  assert.equal(valid.authorities.execution_ledger.path, 'docs/research-program/execution-ledger.json');

  const narrowerRoot = path.join(REPO_ROOT, 'verification', 'research-program', 'pr-003');
  const scoped = await checkHandoff('fixtures/handoff.valid.json', { repoRoot: narrowerRoot });
  assert.equal(scoped.ok, false);
  assert.ok(rulesOf(scoped).includes('artifact_missing_on_disk') || rulesOf(scoped).includes('source_identity_missing_on_disk'));
  assert.ok(scoped.notes.some(note => note.rule === 'execution_ledger_unavailable'));
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

test('CLI exits 0 for accepted packets and 1 for rejected packets', () => {
  for (const name of ['handoff.valid.json', 'handoff.valid-expected-negative.json', 'handoff.valid-unavailable.json']) {
    const valid = runCli(fixture(name));
    assert.equal(valid.status, 0, `${name}: ${valid.stderr}`);
    assert.equal(valid.json?.ok, true, name);
  }

  for (const name of [
    'handoff.reject-claimed-pass-without-command.json',
    'handoff.reject-missing-artifact.json',
    'handoff.reject-stale-dependency-sha.json',
    'handoff.reject-nonzero-success.json',
    'handoff.reject-duplicate-command.json',
    'handoff.reject-empty-evidence.json',
    'handoff.reject-source-hash-omitted.json',
    'handoff.reject-missing-event-source.json',
    'handoff.reject-invalid-head.json',
    'handoff.reject-stale-base-sha.json'
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
