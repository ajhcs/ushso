// Focused suite for PR-003 C-003-2 and integrity corrections C-003-1-R1/C-003-2-R1
// plus bounded R2/R3/R4 contract corrections, the R5 fixture-context isolation,
// and the R6 portable-temp / self-contained captured-ledger correction.
//
// The suite exercises the validator on committed fixtures and ephemeral,
// write-then-remove symlink probes. Fixture packets run against an explicit
// controlled ledger/context so they cannot inherit the live controller task
// base. Observed combined-head ledger data is a committed extraction, not a
// later-branch git show. A passing packet is producer evidence, not
// independent verification or scientific acceptance.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  REPO_ROOT,
  checkHandoff,
  compareRfc3339UtcInstants,
  ownedPathMatches,
  parseRfc3339UtcInstant,
  resolveContainedPath
} from '../../scripts/research-program/check-handoff.mjs';

const SCRIPT = path.join(REPO_ROOT, 'scripts', 'research-program', 'check-handoff.mjs');
const FIXTURE_DIR = path.join(REPO_ROOT, 'verification', 'research-program', 'pr-003', 'fixtures');
const CONTEXT_PARENT = path.join(FIXTURE_DIR, '.context');
const LOCAL_SCRATCH_ROOT = path.join(FIXTURE_DIR, '.scratch');
const FIXTURE_CONTEXT_ROOT = path.join(CONTEXT_PARENT, 'matching');
const CONTROLLED_LEDGER = path.join(FIXTURE_DIR, 'controlled-execution-ledger.json');
const CAPTURED_LEDGER_FIXTURE = path.join(FIXTURE_DIR, 'captured-0c29fdb-pr003-task-row.json');
const PRODUCTION_HANDOFF = 'docs/research-program/handoffs/PR-003.json';
const FIXTURE_BASE_SHA = 'f62ce35481cc572e9aad054049c700aac6378f58';
const OBSERVED_LEDGER_COMMIT = '0c29fdb984c7bb4c101650e4bae86c716048c237';
const OBSERVED_LEDGER_PATH = 'docs/research-program/execution-ledger.json';
const OBSERVED_LEDGER_BLOB = '6dacddc34cf466337ea39657313256709b2fc9af';
const OBSERVED_LEDGER_SOURCE_SHA256 = '58a28c0767657d66a9bf35991d1f5e241d6e14f60ff8cd17408ad7c8880e8702';
const OBSERVED_LEDGER_SOURCE_BYTES = 110819;
const OBSERVED_LEDGER_BASE_SHA = '0b28d036f1df4b5248732bc62f68edd79f14d06f';
const OTHER_LEDGER_BASE_SHA = 'e5c44249b9d2448df2e4b6d466077658e42a009d';
const FORBIDDEN_TEMP_ROOTS = new Set(['/', '/tmp', '/home']);
const ownedTempDirs = new Set();

const fixture = name => path.join(FIXTURE_DIR, name);
const rulesOf = report => report.findings.map(finding => finding.rule);
const statusOf = (report, id) => report.checks.find(check => check.id === id)?.status;
const readJson = async name => JSON.parse(await readFile(fixture(name), 'utf8'));

function isUsableTempRoot(value) {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) {
    return false;
  }
  return !FORBIDDEN_TEMP_ROOTS.has(path.resolve(value));
}

function resolveFixtureTempRoot(env = process.env) {
  if (isUsableTempRoot(env.TMPDIR)) return path.resolve(env.TMPDIR);
  if (isUsableTempRoot(env.RUNNER_TEMP)) return path.resolve(env.RUNNER_TEMP);
  return LOCAL_SCRATCH_ROOT;
}

const tmpRoot = () => resolveFixtureTempRoot();

async function ownedTempDir(prefix) {
  const root = tmpRoot();
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, prefix));
  ownedTempDirs.add(dir);
  return dir;
}

async function removeOwnedTempDir(dir) {
  if (!ownedTempDirs.has(dir)) {
    throw new Error(`refusing to remove untracked path: ${dir}`);
  }
  ownedTempDirs.delete(dir);
  await rm(dir, { recursive: true, force: true });
}

const fixtureCheckOptions = (overrides = {}) => ({
  repoRoot: REPO_ROOT,
  contextRoot: FIXTURE_CONTEXT_ROOT,
  ...overrides
});

async function materializeLedgerContext(name, ledgerBytesOrValue) {
  const root = path.join(CONTEXT_PARENT, name);
  const ledgerPath = path.join(root, 'docs', 'research-program', 'execution-ledger.json');
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  const bytes = Buffer.isBuffer(ledgerBytesOrValue)
    ? ledgerBytesOrValue
    : typeof ledgerBytesOrValue === 'string'
      ? ledgerBytesOrValue
      : `${JSON.stringify(ledgerBytesOrValue, null, 2)}\n`;
  await writeFile(ledgerPath, bytes);
  return root;
}

const writeRuntimeHandoff = async (name, handoff, options = {}) => {
  const runtimeRoot = path.join(CONTEXT_PARENT, 'runtime');
  await mkdir(runtimeRoot, { recursive: true });
  const dir = await mkdtemp(path.join(runtimeRoot, 'handoff-'));
  const file = path.join(dir, name);
  await writeFile(file, `${JSON.stringify(handoff, null, 2)}\n`);
  // Runtime copies of historical fixtures keep the fixture sibling binding so
  // they are not rebound to a later per-PR correction task-binding.json.
  if (options.copyFixtureBinding !== false) {
    await copyFile(fixture('task-binding.json'), path.join(dir, 'task-binding.json'));
  }
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

function runFixtureCli(...args) {
  return runCli('--context', FIXTURE_CONTEXT_ROOT, ...args);
}

before(async () => {
  await materializeLedgerContext('matching', await readFile(CONTROLLED_LEDGER));
});

after(async () => {
  for (const dir of [...ownedTempDirs]) {
    ownedTempDirs.delete(dir);
    await rm(dir, { recursive: true, force: true });
  }
  await rm(CONTEXT_PARENT, { recursive: true, force: true });
});

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
  const report = await checkHandoff(fixture('handoff.valid.json'), fixtureCheckOptions());

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
  assert.equal(
    report.authorities.execution_ledger.path,
    'verification/research-program/pr-003/fixtures/.context/matching/docs/research-program/execution-ledger.json'
  );
  assert.ok(report.notes.some(note => note.rule === 'validation_context'));

  // A producer packet can carry a typed pending head while the controller has
  // not yet made the commit. Null is accepted only with that explicit claim.
  assert.deepEqual(report.preserved_outcomes.non_pass_acceptance_results, []);
  assert.equal(report.preserved_outcomes.head_sha_pending, true);
  assert.ok(report.notes.some(note => note.rule === 'head_sha_pending'));
});

test('expected-negative nonzero outcome is accepted when expected and observed match', async () => {
  const report = await checkHandoff(fixture('handoff.valid-expected-negative.json'), fixtureCheckOptions());
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.equal(report.findings.length, 0);
});

test('typed unavailable outcome preserves provider limitation without inventing an exit', async () => {
  const report = await checkHandoff(fixture('handoff.valid-unavailable.json'), fixtureCheckOptions());
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.equal(report.findings.length, 0);
});

test('a claimed pass without a command result is rejected', async () => {
  const report = await checkHandoff(fixture('handoff.reject-claimed-pass-without-command.json'), fixtureCheckOptions());

  assert.equal(report.ok, false);
  assert.equal(report.outcome, 'rejected');
  assert.ok(rulesOf(report).includes('claimed_pass_without_command_result'));
  assert.equal(statusOf(report, 'command_result_resolution'), 'failed');
});

test('a handoff with a missing artifact reference is rejected', async () => {
  const report = await checkHandoff(fixture('handoff.reject-missing-artifact.json'), fixtureCheckOptions());

  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('missing_artifact'));
  assert.equal(statusOf(report, 'artifact_reference_resolution'), 'failed');
});

test('a handoff with a stale dependency SHA is rejected', async () => {
  const report = await checkHandoff(fixture('handoff.reject-stale-dependency-sha.json'), fixtureCheckOptions());

  assert.equal(report.ok, false);
  const stale = report.findings.find(finding => finding.rule === 'stale_dependency_sha');
  assert.ok(stale);
  assert.match(stale.detail, /PR-002 expected 5647e814/);
  assert.equal(statusOf(report, 'dependency_sha_binding'), 'failed');
});

test('a handoff whose artifact SHA-256 does not match disk is rejected', async () => {
  const report = await checkHandoff(fixture('handoff.reject-artifact-hash-mismatch.json'), fixtureCheckOptions());

  assert.equal(report.ok, false);
  const mismatch = report.findings.find(finding => finding.rule === 'artifact_hash_mismatch');
  assert.ok(mismatch);
  assert.match(mismatch.detail, /artifact-checker/);
  assert.equal(statusOf(report, 'artifact_sha256_binding'), 'failed');
});

test('a nonzero observation cannot back a success claim expecting exit zero', async () => {
  const report = await checkHandoff(fixture('handoff.reject-nonzero-success.json'), fixtureCheckOptions());
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('command_outcome_mismatch'));
});

test('duplicate command IDs with conflicting outcomes are rejected', async () => {
  const report = await checkHandoff(fixture('handoff.reject-duplicate-command.json'), fixtureCheckOptions());
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('duplicate_command_id'));
});

test('completed packet cannot hide empty evidence or a null owner', async () => {
  const report = await checkHandoff(fixture('handoff.reject-empty-evidence.json'), fixtureCheckOptions());
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('empty_evidence_array'));
  assert.ok(rulesOf(report).includes('packet_owner_missing'));
});

test('local source identity must carry its hash', async () => {
  const report = await checkHandoff(fixture('handoff.reject-source-hash-omitted.json'), fixtureCheckOptions());
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('source_identity_hash_omitted'));
});

test('immutable Git source snapshots reject wrong bytes and commit bindings', async () => {
  const handoff = await readJson('handoff.valid.json');
  const runtime = await writeRuntimeHandoff('git-snapshot-mutation.json', handoff);
  const source = handoff.source_identities.find(identity =>
    identity.id === 'docs/master-plan/2026-09-10/EXECUTION.md'
  );
  assert.equal(source.location, 'external');
  assert.equal(source.git_commit, 'f62ce35481cc572e9aad054049c700aac6378f58');
  try {
    source.sha256 = '0'.repeat(64);
    await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
    const wrongBytes = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(wrongBytes.ok, false);
    assert.ok(rulesOf(wrongBytes).includes('source_git_snapshot_hash_mismatch'));

    source.sha256 = '4118d4f46a7ebec45749676881c753529593842792a439cfb5e53e50bc1fdfc3';
    source.git_commit = '0'.repeat(40);
    await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
    const wrongCommit = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(wrongCommit.ok, false);
    assert.ok(rulesOf(wrongCommit).includes('source_git_commit_not_local'));
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('nested event source is subject to existence, containment and hash binding', async () => {
  const report = await checkHandoff(fixture('handoff.reject-missing-event-source.json'), fixtureCheckOptions());
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('artifact_missing_on_disk'));
});

test('nonexistent all-zero head is rejected while the pending null convention is explicit', async () => {
  const report = await checkHandoff(fixture('handoff.reject-invalid-head.json'), fixtureCheckOptions());
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('head_sha_not_local_commit'));

  const terminal = await readJson('handoff.valid.json');
  terminal.status = 'independently_verified';
  const runtime = await writeRuntimeHandoff('terminal-null-head.json', terminal);
  try {
    const terminalReport = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(terminalReport.ok, false);
    assert.ok(rulesOf(terminalReport).includes('head_sha_required_for_terminal_state'));
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('command timing must be valid RFC3339 UTC and end no earlier than start', async () => {
  const report = await checkHandoff(fixture('handoff.reject-invalid-timing.json'), fixtureCheckOptions());
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('command_timing_order_invalid'));

  const malformed = await readJson('handoff.valid.json');
  malformed.commands[0].started_at = 'not-a-timestamp';
  const runtime = await writeRuntimeHandoff('malformed-timestamp.json', malformed);
  try {
    const malformedReport = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(malformedReport.ok, false);
    assert.ok(rulesOf(malformedReport).includes('command_timestamp_invalid'));
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('RFC3339 comparison keeps full fractional precision and rejects impossible calendars', () => {
  assert.equal(
    compareRfc3339UtcInstants('2026-09-11T00:00:00.1239Z', '2026-09-11T00:00:00.1231Z'),
    1
  );
  assert.equal(
    compareRfc3339UtcInstants('2026-09-11T00:00:00.1231Z', '2026-09-11T00:00:00.1239Z'),
    -1
  );
  assert.equal(
    compareRfc3339UtcInstants('2026-09-11T00:00:00.12310Z', '2026-09-11T00:00:00.1231Z'),
    0
  );
  assert.equal(parseRfc3339UtcInstant('2026-02-30T00:00:00.1239Z'), null);
  assert.equal(compareRfc3339UtcInstants('2026-02-30T00:00:00Z', '2026-02-30T00:00:01Z'), null);
});

test('completed_at earlier within the same millisecond is rejected', async () => {
  const report = await checkHandoff(fixture('handoff.reject-fractional-timing.json'), fixtureCheckOptions());
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('command_timing_order_invalid'));
});

test('ownedPathMatches documents exact-file and directory/glob ownership', () => {
  assert.equal(ownedPathMatches('scripts/research-program/check-handoff.mjs', 'scripts/research-program/check-handoff.mjs'), true);
  assert.equal(ownedPathMatches('scripts/research-program/check-handoff.mjs', 'scripts/research-program/other.mjs'), false);
  assert.equal(ownedPathMatches('docs/research-program/handoffs/schema/**', 'docs/research-program/handoffs/schema/README.md'), true);
  assert.equal(ownedPathMatches('verification/research-program/pr-003/**', 'verification/research-program/pr-003/fixtures/handoff.valid.json'), true);
  assert.equal(ownedPathMatches('docs/research-program/handoffs/', 'docs/research-program/handoffs/PR-003.json'), true);
  assert.equal(ownedPathMatches('docs/research-program/handoffs/schema/**', 'docs/research-program/handoffs/PR-003.json'), false);

  assert.equal(ownedPathMatches('tests/*.mjs', 'tests/one.mjs'), true);
  assert.equal(ownedPathMatches('tests/*.mjs', 'tests/nested/one.mjs'), false);
  assert.equal(ownedPathMatches('tests/**/*.mjs', 'tests/one.mjs'), true);
  assert.equal(ownedPathMatches('tests/**/*.mjs', 'tests/nested/one.mjs'), true);
  assert.equal(ownedPathMatches('tests/**/*.mjs', 'lib/one.mjs'), false);
  assert.equal(ownedPathMatches('*.mjs', 'one.mjs'), true);
  assert.equal(ownedPathMatches('*.mjs', 'tests/one.mjs'), false);
  assert.equal(ownedPathMatches('foo/**/bar', 'foo/bar'), true);
  assert.equal(ownedPathMatches('foo/**/bar', 'foo/x/bar'), true);
  assert.equal(ownedPathMatches('foo**bar', 'foobar'), true);
  assert.equal(ownedPathMatches('verification/research-program/pr-003/', 'verification/research-program/pr-003'), true);
  assert.equal(ownedPathMatches('verification/research-program/pr-003/**', 'verification/research-program/pr-003'), true);

  assert.equal(ownedPathMatches('tests/*/**', 'tests/unit/one.mjs'), true);
  assert.equal(ownedPathMatches('tests/*/**', 'tests/unit'), true);
  assert.equal(ownedPathMatches('tests/*/**', 'lib/unit/one.mjs'), false);
  assert.equal(ownedPathMatches('docs/**/fixtures/**', 'docs/pr003/fixtures/nested/one.json'), true);
  assert.equal(ownedPathMatches('docs/**/fixtures/**', 'docs/fixtures/one.json'), true);
  assert.equal(ownedPathMatches('docs/**/fixtures/**', 'docs/fixtures'), true);
  assert.equal(ownedPathMatches('docs/**/fixtures/**', 'docs/pr003/fixture/one.json'), false);
  assert.equal(ownedPathMatches('tests/*/', 'tests/unit/one.mjs'), true);
  assert.equal(ownedPathMatches('tests/*/', 'test/unit/one.mjs'), false);
});

test('base SHA must match the concrete per-PR task binding', async () => {
  const report = await checkHandoff(fixture('handoff.reject-stale-base-sha.json'), fixtureCheckOptions());
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
    const report = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(report.ok, false);
    assert.ok(rulesOf(report).includes('source_identity_path_escapes_root_via_symlink'));
    assert.ok(rulesOf(report).includes('changed_file_escapes_root_via_symlink'));
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('sibling task-binding symlink is rejected before JSON fallback', async () => {
  const handoff = await readJson('handoff.valid.json');
  const runtime = await writeRuntimeHandoff('binding-symlink.json', handoff, {
    copyFixtureBinding: false
  });
  const bindingLink = path.join(runtime.dir, 'task-binding.json');
  await symlink('/etc/hosts', bindingLink);
  try {
    const report = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(report.ok, false);
    assert.ok(rulesOf(report).includes('task_binding_path_escapes_root_via_symlink'));
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('repoRoot controls packet and evidence roots while schemas stay module-authoritative', async () => {
  const live = await checkHandoff(PRODUCTION_HANDOFF, { repoRoot: REPO_ROOT });
  assert.equal(live.ok, true, JSON.stringify(live.findings));
  assert.equal(live.authorities.execution_ledger.path, 'docs/research-program/execution-ledger.json');
  assert.equal(live.notes.some(note => note.rule === 'validation_context'), false);

  const fixtureReport = await checkHandoff(
    'verification/research-program/pr-003/fixtures/handoff.valid.json',
    fixtureCheckOptions()
  );
  assert.equal(fixtureReport.ok, true, JSON.stringify(fixtureReport.findings));
  assert.equal(
    fixtureReport.authorities.execution_ledger.path,
    'verification/research-program/pr-003/fixtures/.context/matching/docs/research-program/execution-ledger.json'
  );

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
  const report = await checkHandoff(outside, fixtureCheckOptions());
  assert.equal(report.ok, false);
  const containment = report.findings.find(
    finding => finding.rule === 'handoff_path_out_of_containment'
  );
  assert.ok(containment);
  assert.equal(statusOf(report, 'input_path_containment'), 'failed');
  assert.equal(statusOf(report, 'handoff_readable'), 'not_executed');
});

test('immutable Git snapshots larger than Node default maxBuffer hash from Git bytes', async () => {
  const handoff = await readJson('handoff.valid.json');
  const runtime = await writeRuntimeHandoff('large-git-snapshot.json', handoff);
  const commit = 'f62ce35481cc572e9aad054049c700aac6378f58';
  const gitPath = 'evaluation/research-program/cohorts.json';
  handoff.source_identities.push({
    kind: 'frozen-cohort-snapshot',
    id: 'evaluation/research-program/cohorts.json',
    location: 'external',
    sha256: '89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543',
    git_commit: commit,
    git_path: gitPath
  });
  await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
  try {
    const report = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(report.ok, true, JSON.stringify(report.findings));

    handoff.source_identities.at(-1).git_path = 'evaluation/research-program/pr003-r2-missing-cohorts.json';
    await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
    const missing = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(missing.ok, false);
    assert.ok(rulesOf(missing).includes('source_git_path_missing_at_commit'));
    assert.equal(rulesOf(missing).includes('source_git_snapshot_unreadable'), false);
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('schema-invalid null JSON returns a rejected packet report rather than throwing', async () => {
  const runtime = await writeRuntimeHandoff('null-packet.json', null);
  try {
    const report = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(report.ok, false);
    assert.equal(report.outcome, 'rejected');
    assert.ok(rulesOf(report).includes('schema_invalid'));
    assert.equal(rulesOf(report).includes('validator_operational_error'), false);
    const cli = runFixtureCli(runtime.file);
    assert.equal(cli.status, 1, cli.stderr);
    assert.equal(cli.json?.outcome, 'rejected');
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('noniterable collection types return schema findings without throwing', async () => {
  const handoff = await readJson('handoff.valid.json');
  handoff.commands = { not: 'an-array' };
  const runtime = await writeRuntimeHandoff('noniterable-commands.json', handoff);
  try {
    const report = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(report.ok, false);
    assert.equal(report.outcome, 'rejected');
    assert.ok(rulesOf(report).includes('schema_invalid'));
    assert.equal(statusOf(report, 'command_result_resolution'), 'not_executed');
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

const OBJECT_ITEM_COLLECTIONS = [
  'commands',
  'artifacts',
  'source_identities',
  'acceptance_results',
  'failures_and_skipped_checks',
  'unresolved_claims'
];

for (const key of OBJECT_ITEM_COLLECTIONS) {
  test(`null ${key} item is a schema-invalid rejected packet (API and CLI)`, async () => {
    const handoff = await readJson('handoff.valid.json');
    handoff[key] = [...handoff[key], null];
    const runtime = await writeRuntimeHandoff(`null-${key}-item.json`, handoff);
    try {
      const report = await checkHandoff(runtime.file, fixtureCheckOptions());
      assert.equal(report.ok, false, JSON.stringify(report.findings));
      assert.equal(report.outcome, 'rejected');
      assert.ok(rulesOf(report).includes('schema_invalid'));
      assert.equal(rulesOf(report).includes('validator_operational_error'), false);
      const cli = runFixtureCli(runtime.file);
      assert.equal(cli.status, 1, cli.stderr);
      assert.notEqual(cli.status, 2);
      assert.equal(cli.json?.outcome, 'rejected');
      assert.ok(rulesOf(cli.json).includes('schema_invalid'));
    } finally {
      await rm(runtime.dir, { recursive: true, force: true });
    }
  });
}

test('malformed non-object collection elements are schema-invalid rejected packets', async () => {
  const handoff = await readJson('handoff.valid.json');
  const cases = [
    { key: 'commands', value: 'not-an-object' },
    { key: 'artifacts', value: 42 },
    { key: 'source_identities', value: ['nested'] },
    { key: 'acceptance_results', value: true }
  ];
  for (const { key, value } of cases) {
    const packet = structuredClone(handoff);
    packet[key] = [...packet[key], value];
    const runtime = await writeRuntimeHandoff(`nonobject-${key}.json`, packet);
    try {
      const report = await checkHandoff(runtime.file, fixtureCheckOptions());
      assert.equal(report.ok, false, key);
      assert.equal(report.outcome, 'rejected', key);
      assert.ok(rulesOf(report).includes('schema_invalid'), key);
      const cli = runFixtureCli(runtime.file);
      assert.equal(cli.status, 1, `${key}: ${cli.stderr}`);
      assert.equal(cli.json?.outcome, 'rejected', key);
    } finally {
      await rm(runtime.dir, { recursive: true, force: true });
    }
  }

  const valid = await checkHandoff(fixture('handoff.valid.json'), fixtureCheckOptions());
  assert.equal(valid.ok, true, JSON.stringify(valid.findings));
  assert.equal(valid.outcome, 'accepted');
  const validCli = runFixtureCli(fixture('handoff.valid.json'));
  assert.equal(validCli.status, 0, validCli.stderr);
  assert.equal(validCli.json?.outcome, 'accepted');
});

test('file and Git operational failures remain typed and are not packet success', async () => {
  const missing = path.join(FIXTURE_DIR, 'pr003-r3-missing-handoff.json');
  const missingReport = await checkHandoff(missing, fixtureCheckOptions());
  assert.equal(missingReport.ok, false);
  assert.notEqual(missingReport.outcome, 'accepted');
  assert.ok(rulesOf(missingReport).includes('handoff_missing'));
  const missingCli = runFixtureCli(missing);
  assert.notEqual(missingCli.status, 0);
  assert.notEqual(missingCli.json?.outcome, 'accepted');

  const handoff = await readJson('handoff.valid.json');
  const runtime = await writeRuntimeHandoff('missing-git-path.json', handoff);
  handoff.source_identities.push({
    kind: 'frozen-cohort-snapshot',
    id: 'evaluation/research-program/cohorts.json',
    location: 'external',
    sha256: '89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543',
    git_commit: 'f62ce35481cc572e9aad054049c700aac6378f58',
    git_path: 'evaluation/research-program/pr003-r3-missing-cohorts.json'
  });
  await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
  try {
    const report = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(report.ok, false);
    assert.notEqual(report.outcome, 'accepted');
    assert.ok(rulesOf(report).includes('source_git_path_missing_at_commit'));
    assert.equal(rulesOf(report).includes('schema_invalid'), false);
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('unresolved changed-file symlink is not counted as a deletion', async () => {
  const handoff = await readJson('handoff.valid.json');
  const runtime = await writeRuntimeHandoff('dangling-changed-link.json', handoff);
  const link = path.join(runtime.dir, 'pr003-r2-unresolved-changed-link');
  await symlink(path.join(runtime.dir, 'pr003-r2-missing-symlink-target'), link);
  handoff.changed_files = [path.relative(REPO_ROOT, link)];
  await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
  try {
    const report = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(report.ok, false);
    assert.ok(rulesOf(report).includes('changed_file_symlink_unresolved'));
    assert.equal(report.notes.some(note => note.rule === 'changed_file_not_present'), false);
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('absent changed files remain typed deletions', async () => {
  const handoff = await readJson('handoff.valid.json');
  const runtime = await writeRuntimeHandoff('deleted-changed-file.json', handoff);
  handoff.changed_files = [
    'verification/research-program/pr-003/fixtures/pr003-r2-absent-changed-file.json'
  ];
  await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
  try {
    const report = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.ok(report.notes.some(note => note.rule === 'changed_file_not_present'));
    assert.equal(rulesOf(report).includes('changed_file_symlink_unresolved'), false);
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('completed packets must match task-binding owner, branch and owned paths', async () => {
  const handoff = await readJson('handoff.valid.json');
  const runtime = await writeRuntimeHandoff('task-scope.json', handoff);
  try {
    handoff.owner = 'Not the bound owner';
    await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
    const ownerReport = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(ownerReport.ok, false);
    assert.ok(rulesOf(ownerReport).includes('handoff_owner_mismatch'));

    handoff.owner = 'Luna Max (gpt-5.6-luna-max, reasoning high)';
    handoff.branch = 'codex/not-the-bound-branch';
    await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
    const branchReport = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(branchReport.ok, false);
    assert.ok(rulesOf(branchReport).includes('handoff_branch_mismatch'));

    handoff.branch = 'codex/ushso-pr003-integrity-recovery-20260910';
    handoff.changed_files = ['package.json'];
    await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
    const scopeReport = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(scopeReport.ok, false);
    assert.ok(rulesOf(scopeReport).includes('changed_file_outside_owned_paths'));
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('completed packet scope honors slash-aware wildcards', async () => {
  const handoff = await readJson('handoff.valid.json');
  const binding = JSON.parse(await readFile(fixture('task-binding.json'), 'utf8'));
  const runtime = await writeRuntimeHandoff('wildcard-scope.json', handoff, {
    copyFixtureBinding: false
  });
  try {
    binding.owned_paths = ['tests/*.mjs', 'docs/research-program/handoffs/schema/**'];
    await writeFile(path.join(runtime.dir, 'task-binding.json'), `${JSON.stringify(binding, null, 2)}\n`);

    handoff.changed_files = ['tests/one.mjs'];
    await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
    const single = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(statusOf(single, 'task_scope_binding'), 'passed', JSON.stringify(single.findings));
    assert.equal(rulesOf(single).includes('changed_file_outside_owned_paths'), false);

    handoff.changed_files = ['tests/nested/one.mjs'];
    await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
    const nested = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.ok(rulesOf(nested).includes('changed_file_outside_owned_paths'));

    binding.owned_paths = ['tests/**/*.mjs'];
    await writeFile(path.join(runtime.dir, 'task-binding.json'), `${JSON.stringify(binding, null, 2)}\n`);

    handoff.changed_files = ['tests/one.mjs'];
    await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
    const globZero = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(statusOf(globZero, 'task_scope_binding'), 'passed', JSON.stringify(globZero.findings));

    handoff.changed_files = ['tests/nested/one.mjs'];
    await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
    const globNested = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.equal(statusOf(globNested, 'task_scope_binding'), 'passed', JSON.stringify(globNested.findings));

    handoff.changed_files = ['lib/one.mjs'];
    await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
    const outside = await checkHandoff(runtime.file, fixtureCheckOptions());
    assert.ok(rulesOf(outside).includes('changed_file_outside_owned_paths'));
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('completed packet scope honors composite slash-aware wildcards', async () => {
  const handoff = await readJson('handoff.valid.json');
  const binding = JSON.parse(await readFile(fixture('task-binding.json'), 'utf8'));
  const runtime = await writeRuntimeHandoff('composite-wildcard-scope.json', handoff, {
    copyFixtureBinding: false
  });
  try {
    const cases = [
      {
        pattern: 'tests/*/**',
        accepted: ['tests/unit/one.mjs', 'tests/unit'],
        rejected: ['lib/unit/one.mjs']
      },
      {
        pattern: 'docs/**/fixtures/**',
        accepted: ['docs/pr003/fixtures/nested/one.json', 'docs/fixtures/one.json', 'docs/fixtures'],
        rejected: ['docs/pr003/fixture/one.json']
      },
      {
        pattern: 'tests/*/',
        accepted: ['tests/unit/one.mjs'],
        rejected: ['test/unit/one.mjs']
      }
    ];

    for (const { pattern, accepted, rejected } of cases) {
      binding.owned_paths = [pattern];
      await writeFile(path.join(runtime.dir, 'task-binding.json'), `${JSON.stringify(binding, null, 2)}\n`);

      for (const changedFile of accepted) {
        handoff.changed_files = [changedFile];
        await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
        const report = await checkHandoff(runtime.file, fixtureCheckOptions());
        assert.equal(
          statusOf(report, 'task_scope_binding'),
          'passed',
          `${pattern} should accept ${changedFile}: ${JSON.stringify(report.findings)}`
        );
      }

      for (const changedFile of rejected) {
        handoff.changed_files = [changedFile];
        await writeFile(runtime.file, `${JSON.stringify(handoff, null, 2)}\n`);
        const report = await checkHandoff(runtime.file, fixtureCheckOptions());
        assert.ok(
          rulesOf(report).includes('changed_file_outside_owned_paths'),
          `${pattern} should reject ${changedFile}: ${JSON.stringify(report.findings)}`
        );
      }
    }
  } finally {
    await rm(runtime.dir, { recursive: true, force: true });
  }
});

test('CLI exits 0 for accepted packets and 1 for rejected packets', () => {
  for (const name of ['handoff.valid.json', 'handoff.valid-expected-negative.json', 'handoff.valid-unavailable.json']) {
    const valid = runFixtureCli(fixture(name));
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
    'handoff.reject-stale-base-sha.json',
    'handoff.reject-invalid-timing.json',
    'handoff.reject-fractional-timing.json'
  ]) {
    const result = runFixtureCli(fixture(name));
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

  const contextWithoutDir = runCli('--context');
  assert.equal(contextWithoutDir.status, 2);
});

test('controlled fixture context stays valid while a later live ledger would not bind the fixture base', async () => {
  const report = await checkHandoff(fixture('handoff.valid.json'), fixtureCheckOptions());
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.equal(statusOf(report, 'base_sha_binding'), 'passed');
  assert.match(report.authorities.execution_ledger.path, /\.context\/matching\/docs\/research-program\/execution-ledger\.json$/);
});

test('the observed combined-head ledger base conflicts with the historical fixture binding', async () => {
  const captured = JSON.parse(await readFile(CAPTURED_LEDGER_FIXTURE, 'utf8'));
  assert.equal(captured.extraction.git_commit, OBSERVED_LEDGER_COMMIT);
  assert.equal(captured.extraction.git_path, OBSERVED_LEDGER_PATH);
  assert.equal(captured.extraction.git_blob, OBSERVED_LEDGER_BLOB);
  assert.equal(captured.extraction.source_sha256, OBSERVED_LEDGER_SOURCE_SHA256);
  assert.equal(captured.extraction.source_bytes, OBSERVED_LEDGER_SOURCE_BYTES);
  const task = captured.tasks.find(entry => entry.pr_id === 'PR-003');
  assert.ok(task);
  assert.equal(task.base_sha, OBSERVED_LEDGER_BASE_SHA);

  const tmpDir = await ownedTempDir('pr003-r6-observed-ledger-');
  const contextName = `observed-${path.basename(tmpDir)}`;
  try {
    const capturedPath = path.join(tmpDir, 'execution-ledger.json');
    await writeFile(
      capturedPath,
      `${JSON.stringify({ format: captured.format, tasks: captured.tasks }, null, 2)}\n`
    );
    const contextRoot = await materializeLedgerContext(contextName, await readFile(capturedPath));
    const report = await checkHandoff(fixture('handoff.valid.json'), {
      repoRoot: REPO_ROOT,
      contextRoot
    });
    assert.equal(report.ok, false);
    const conflict = report.findings.find(finding => finding.rule === 'binding_conflict');
    assert.ok(conflict);
    assert.match(conflict.detail, new RegExp(FIXTURE_BASE_SHA));
    assert.match(conflict.detail, new RegExp(OBSERVED_LEDGER_BASE_SHA));
    assert.equal(statusOf(report, 'base_sha_binding'), 'failed');
  } finally {
    await removeOwnedTempDir(tmpDir);
    await rm(path.join(CONTEXT_PARENT, contextName), { recursive: true, force: true });
  }
});

test('fixture temporary-root helper selects TMPDIR, RUNNER_TEMP, then the in-repository fallback', () => {
  assert.equal(
    resolveFixtureTempRoot({ TMPDIR: '/mnt/d/tmp/plumbob/job' }),
    '/mnt/d/tmp/plumbob/job'
  );
  assert.equal(resolveFixtureTempRoot({ RUNNER_TEMP: '/runner/_temp' }), '/runner/_temp');
  assert.equal(
    resolveFixtureTempRoot({ TMPDIR: '/tmp', RUNNER_TEMP: '/runner/_temp' }),
    '/runner/_temp'
  );
  assert.equal(resolveFixtureTempRoot({ TMPDIR: '/tmp', RUNNER_TEMP: '/home' }), LOCAL_SCRATCH_ROOT);
  assert.equal(resolveFixtureTempRoot({ TMPDIR: 'relative', RUNNER_TEMP: '' }), LOCAL_SCRATCH_ROOT);
  assert.equal(resolveFixtureTempRoot({}), LOCAL_SCRATCH_ROOT);
});

test('owned fixture temps are cleaned without recursively removing an unrelated directory', async () => {
  await mkdir(LOCAL_SCRATCH_ROOT, { recursive: true });
  const unrelated = path.join(LOCAL_SCRATCH_ROOT, 'unrelated-keep-me');
  await mkdir(unrelated, { recursive: true });
  const sentinel = path.join(unrelated, 'sentinel.txt');
  await writeFile(sentinel, 'keep\n');
  const owned = await ownedTempDir('pr003-r6-owned-');
  assert.notEqual(path.resolve(owned), path.resolve(unrelated));
  assert.equal(path.resolve(owned).startsWith(`${path.resolve(unrelated)}${path.sep}`), false);
  await assert.rejects(
    () => removeOwnedTempDir(unrelated),
    /refusing to remove untracked path/
  );
  await removeOwnedTempDir(owned);
  assert.equal(await readFile(sentinel, 'utf8'), 'keep\n');
  await rm(unrelated, { recursive: true, force: true });
});

test('a different plausible ledger base in the controlled context still rejects with binding_conflict', async () => {
  const contextRoot = await materializeLedgerContext('other-base', {
    format: 'ushso.pr003.fixture-execution-ledger.v1',
    tasks: [
      {
        pr_id: 'PR-003',
        base_sha: OTHER_LEDGER_BASE_SHA,
        dependency_merge_shas: {
          'PR-001': '035465f3f16d15f02467679d96451d4440a36ca8',
          'PR-002': '5647e81457b606bb36456e75c48f990ce21e9c6c'
        }
      }
    ]
  });
  try {
    const report = await checkHandoff(fixture('handoff.valid.json'), {
      repoRoot: REPO_ROOT,
      contextRoot
    });
    assert.equal(report.ok, false);
    const conflict = report.findings.find(finding => finding.rule === 'binding_conflict');
    assert.ok(conflict);
    assert.match(conflict.detail, new RegExp(FIXTURE_BASE_SHA));
    assert.match(conflict.detail, new RegExp(OTHER_LEDGER_BASE_SHA));
    assert.equal(conflict.detail.includes(OBSERVED_LEDGER_BASE_SHA), false);
    const matching = await checkHandoff(fixture('handoff.valid.json'), fixtureCheckOptions());
    assert.equal(matching.ok, true, JSON.stringify(matching.findings));
  } finally {
    await rm(contextRoot, { recursive: true, force: true });
  }
});

test('default live-ledger validation ignores a conflicting fixture context', async () => {
  const conflicting = await materializeLedgerContext('conflicting-default', {
    format: 'ushso.pr003.fixture-execution-ledger.v1',
    tasks: [
      {
        pr_id: 'PR-003',
        base_sha: OTHER_LEDGER_BASE_SHA,
        dependency_merge_shas: {
          'PR-001': '035465f3f16d15f02467679d96451d4440a36ca8',
          'PR-002': '5647e81457b606bb36456e75c48f990ce21e9c6c'
        }
      }
    ]
  });
  try {
    const live = await checkHandoff(PRODUCTION_HANDOFF, { repoRoot: REPO_ROOT });
    assert.equal(live.ok, true, JSON.stringify(live.findings));
    assert.equal(live.authorities.execution_ledger.path, 'docs/research-program/execution-ledger.json');
    assert.equal(live.notes.some(note => note.rule === 'validation_context'), false);

    const liveCli = runCli(PRODUCTION_HANDOFF);
    assert.equal(liveCli.status, 0, liveCli.stderr);
    assert.equal(liveCli.json?.ok, true);
    assert.equal(liveCli.json?.authorities?.execution_ledger?.path, 'docs/research-program/execution-ledger.json');

    const isolatedConflict = await checkHandoff(fixture('handoff.valid.json'), {
      repoRoot: REPO_ROOT,
      contextRoot: conflicting
    });
    assert.equal(isolatedConflict.ok, false);
    assert.ok(rulesOf(isolatedConflict).includes('binding_conflict'));
  } finally {
    await rm(conflicting, { recursive: true, force: true });
  }
});

test('CLI --context isolates fixtures and omitting it keeps the live ledger', () => {
  const isolated = runFixtureCli(fixture('handoff.valid.json'));
  assert.equal(isolated.status, 0, isolated.stderr);
  assert.equal(isolated.json?.ok, true);
  assert.match(
    isolated.json?.authorities?.execution_ledger?.path ?? '',
    /\.context\/matching\/docs\/research-program\/execution-ledger\.json$/
  );

  const live = runCli(PRODUCTION_HANDOFF);
  assert.equal(live.status, 0, live.stderr);
  assert.equal(live.json?.ok, true);
  assert.equal(live.json?.authorities?.execution_ledger?.path, 'docs/research-program/execution-ledger.json');
});

test('an explicit context outside the repository is rejected and does not load the live ledger', async () => {
  const report = await checkHandoff(fixture('handoff.valid.json'), {
    repoRoot: REPO_ROOT,
    contextRoot: path.resolve(REPO_ROOT, '..', 'pr003-r5-outside-context')
  });
  assert.equal(report.ok, false);
  assert.ok(rulesOf(report).includes('validation_context_escapes_root'));
  assert.equal(report.authorities.execution_ledger, null);
});

test('a conflicting ledger inside the controlled context still rejects with binding_conflict', async () => {
  const contextRoot = await materializeLedgerContext('deliberate-conflict', {
    format: 'ushso.pr003.fixture-execution-ledger.v1',
    tasks: [
      {
        pr_id: 'PR-003',
        base_sha: FIXTURE_BASE_SHA,
        dependency_merge_shas: {
          'PR-001': '035465f3f16d15f02467679d96451d4440a36ca8',
          'PR-002': '0000000000000000000000000000000000000000'
        }
      }
    ]
  });
  try {
    const report = await checkHandoff(fixture('handoff.valid.json'), {
      repoRoot: REPO_ROOT,
      contextRoot
    });
    assert.equal(report.ok, false);
    const conflict = report.findings.find(finding => finding.rule === 'binding_conflict');
    assert.ok(conflict);
    assert.match(conflict.detail, /dependency_merge_shas/);
    assert.equal(statusOf(report, 'dependency_sha_binding'), 'failed');
  } finally {
    await rm(contextRoot, { recursive: true, force: true });
  }
});
