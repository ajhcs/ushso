#!/usr/bin/env node
// PR-003 slice C-003-2 plus integrity corrections C-003-2-R1 / C-003-2-R2
// and remaining-defect corrections C-003-2-R3 / C-003-3-R3 —
// bounded handoff-packet validator.
//
// Usage:
//   node scripts/research-program/check-handoff.mjs <handoff.json>
//
// It accepts exactly one handoff JSON path and then enforces:
//   * path containment for the handoff, every artifact (including nested
//     command event-source records), every local source identity and every
//     existing changed file (lexical and symlink-resolved, always inside the
//     repository root);
//   * file existence and SHA-256 (and byte-length, when declared) binding for
//     every referenced local artifact, event-source and local source identity;
//   * explicit local vs external source identity (local requires a content
//     hash; locality is not inferred from path punctuation);
//   * unique command and artifact IDs (no silent Map last-write-wins);
//   * structured expected/observed command outcomes: a success claim needs an
//     observed outcome or explicit typed unavailability, and that outcome must
//     match the explicit expected outcome. Expected-negative checks may exit
//     nonzero. Completed observed_exit records need RFC3339 UTC timestamps
//     compared at full fractional precision;
//   * dependency SHA matching against a sibling or per-PR task-binding.json
//     and the committed execution ledger;
//   * a concrete base SHA from that task binding — a completed packet with
//     only ledger dependency SHAs is unbound, not accepted;
//   * completed-packet owner/branch and changed-file scope against that
//     concrete task binding using exact-file and directory/glob ownership;
//   * local Git commit existence and ancestry for base, dependencies and any
//     non-null head; head_sha null remains pending-head transport, not a
//     synthetic commit;
//   * streamed immutable Git snapshot hashing with typed missing-path versus
//     unreadable/size-limit diagnostics;
//   * schema-invalid JSON (including null/noniterable collections and
//     null/non-object collection items) as a rejected packet, not an
//     operational tool failure;
//   * status-specific evidence (completed packets cannot have empty evidence
//     arrays or a null owner).
//
// Exit codes: 0 accepted, 1 rejected, 2 usage/operational error.
// The validator is read-only: it writes no files and changes no repository
// state. `ok:true` means the packet is complete and evidence-bound, not that
// the work is independently verified or scientifically accepted.
//
// PR-001.json and PR-002.json predate this contract and are not rewritten.
// Historical C-003-1/2/3 and R1 receipts are preserved byte-for-byte and are
// not re-presented as runs against this corrected validator.

import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repository root, derived from this script's location. */
export const REPO_ROOT = path.resolve(HERE, '..', '..');

export const FORMAT = 'ushso.pr003.c003-r3.handoff-check.v1';

/** Hard cap for streamed `git show` hashing of immutable snapshots. */
export const GIT_SNAPSHOT_MAX_BYTES = 64 * 1024 * 1024;

/** Acceptance states that assert success and therefore require a matching command outcome. */
export const SUCCESS_ACCEPTANCE_STATES = new Set([
  'passed',
  'producer_checked',
  'independently_verified'
]);

/** Handoff statuses that advertise a completed producer packet. */
export const COMPLETED_PACKET_STATES = new Set([
  'producer_checked',
  'draft_pr',
  'independently_verified',
  'merged',
  'integrated',
  'qualified'
]);

/** Explicit typed non-execution / non-success command outcome kinds. */
export const TYPED_COMMAND_OUTCOME_KINDS = new Set([
  'observed_exit',
  'unavailable',
  'blocked',
  'failed',
  'unresolved'
]);

const SCHEMA_DIR = path.join(REPO_ROOT, 'docs', 'research-program', 'handoffs', 'schema');

/** Stable check order for the typed report. */
const CHECK_ORDER = [
  'input_path_containment',
  'handoff_readable',
  'handoff_schema',
  'task_binding',
  'dependency_sha_binding',
  'base_sha_binding',
  'task_scope_binding',
  'git_commit_binding',
  'identifier_uniqueness',
  'packet_evidence',
  'command_result_resolution',
  'artifact_reference_resolution',
  'artifact_path_containment',
  'artifact_file_existence',
  'artifact_sha256_binding',
  'source_identity_binding',
  'changed_file_containment'
];

class HandoffToolError extends Error {}

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function sha256File(filePath) {
  return sha256Buffer(await readFile(filePath));
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function isWithin(rootAbs, abs) {
  const relative = path.relative(rootAbs, abs);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function reportPath(repoRoot, abs) {
  const relative = path.relative(repoRoot, abs);
  if (relative === '') return '.';
  return isWithin(repoRoot, abs) ? toPosix(relative) : toPosix(abs);
}

function prSlug(prId) {
  return String(prId).toLowerCase();
}

/**
 * Lexically resolve `candidate` against `repoRoot` and prove it stays inside.
 * Returns a typed result instead of throwing so callers can report it.
 */
export function resolveContainedPath(repoRoot, candidate) {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    return { ok: false, rule: 'path_empty', detail: 'path is empty or not a string' };
  }
  if (path.isAbsolute(candidate)) {
    return {
      ok: false,
      rule: 'path_absolute',
      detail: `path is absolute and must be repository-relative: ${candidate}`
    };
  }
  const rootAbs = path.resolve(repoRoot);
  const absolute = path.resolve(rootAbs, candidate);
  const relative = path.relative(rootAbs, absolute);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return {
      ok: false,
      rule: 'path_escapes_root',
      detail: `path escapes the containment root: ${candidate}`
    };
  }
  return { ok: true, absolute, relative: toPosix(relative) };
}

async function existsAsFile(candidate) {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

async function loadJsonWithSha(filePath) {
  const buffer = await readFile(filePath);
  return { value: JSON.parse(buffer.toString('utf8')), sha256: sha256Buffer(buffer) };
}

async function loadAjv2020() {
  try {
    const module = await import('ajv/dist/2020.js');
    return module.default;
  } catch (error) {
    throw new HandoffToolError(
      `ajv/dist/2020.js is required for handoff validation: ${error.message}`
    );
  }
}

let validatorPromise = null;
async function loadValidators() {
  if (!validatorPromise) {
    validatorPromise = (async () => {
      const Ajv2020 = await loadAjv2020();
      const ajv = new Ajv2020({
        strict: true,
        strictSchema: true,
        strictTypes: true,
        allErrors: true
      });
      const taskSchema = JSON.parse(await readFile(path.join(SCHEMA_DIR, 'task.schema.json'), 'utf8'));
      const handoffSchema = JSON.parse(
        await readFile(path.join(SCHEMA_DIR, 'handoff.schema.json'), 'utf8')
      );
      return {
        validateTask: ajv.compile(taskSchema),
        validateHandoff: ajv.compile(handoffSchema)
      };
    })();
  }
  return validatorPromise;
}

function formatAjvErrors(validate) {
  return (validate.errors ?? []).map(
    error => `${error.instancePath || '/'} ${error.keyword} ${error.message}`
  );
}

function gitCommitExists(sha, cwd) {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, stdio: 'ignore' });
    return { ok: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ok: false, unavailable: true, detail: 'git executable is not available' };
    }
    return {
      ok: false,
      unavailable: false,
      detail: `commit ${sha} is not present in the local repository`
    };
  }
}

function gitIsAncestor(ancestor, descendant, cwd) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd,
      stdio: 'ignore'
    });
    return { ok: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ok: false, unavailable: true, detail: 'git executable is not available' };
    }
    return {
      ok: false,
      unavailable: false,
      detail: `${ancestor} is not an ancestor of ${descendant}`
    };
  }
}

function sortedDependencyEntries(record) {
  return Object.entries(record ?? {}).sort(([a], [b]) => a.localeCompare(b));
}

function createReporter() {
  const findings = [];
  const notes = [];
  const checkState = new Map();

  return {
    findings,
    notes,
    markCheck(id, status, detail) {
      if (!checkState.has(id) || status === 'failed') {
        checkState.set(id, { id, status, detail });
      }
    },
    fail(checkId, rule, detail) {
      findings.push({ rule, severity: 'error', detail });
      checkState.set(checkId, { id: checkId, status: 'failed', detail });
    },
    note(rule, status, detail) {
      notes.push({ rule, status, detail });
    },
    checks() {
      return CHECK_ORDER.map(id =>
        checkState.get(id) ?? {
          id,
          status: 'not_executed',
          detail: 'check did not run'
        }
      );
    }
  };
}

function isOutcomeObject(value) {
  return value !== null && typeof value === 'object' && TYPED_COMMAND_OUTCOME_KINDS.has(value.kind);
}

/** Structured observed execution result; narrative fields are never parsed. */
export function observedCommandOutcome(command) {
  return isOutcomeObject(command?.observed_outcome) ? command.observed_outcome : null;
}

/** Structured expected execution result; narrative fields are never parsed. */
export function expectedCommandOutcome(command) {
  return isOutcomeObject(command?.expected_outcome) ? command.expected_outcome : null;
}

export function outcomesMatch(expected, observed) {
  if (!expected || !observed || expected.kind !== observed.kind) return false;
  if (expected.kind === 'observed_exit') {
    return expected.exit_code === observed.exit_code;
  }
  return true;
}

function completionStatusOutcome(value) {
  if (typeof value !== 'string') return null;
  if (TYPED_COMMAND_OUTCOME_KINDS.has(value)) return { kind: value };
  const match = /^observed_exit[_: ](-?\d+)$/.exec(value);
  if (match) return { kind: 'observed_exit', exit_code: Number(match[1]) };
  return null;
}

const RFC3339_UTC =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;

/**
 * Parse an RFC3339 UTC instant, preserving the declared fractional digits.
 * Calendar fields are validated by Date.UTC round-trip so impossible dates
 * (e.g. 2026-02-30) are rejected. Fractional ordering does not use Date.parse,
 * which would silently truncate to milliseconds.
 */
export function parseRfc3339UtcInstant(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const match = RFC3339_UTC.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fractionDigits = match[7] ?? '';
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(utcMillis)) return null;
  const date = new Date(utcMillis);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }
  return { utcMillis, fractionDigits };
}

/** Compare two RFC3339 UTC instants at full declared fractional precision. */
export function compareRfc3339UtcInstants(left, right) {
  const a = parseRfc3339UtcInstant(left);
  const b = parseRfc3339UtcInstant(right);
  if (!a || !b) return null;
  if (a.utcMillis !== b.utcMillis) return a.utcMillis < b.utcMillis ? -1 : 1;
  const width = Math.max(a.fractionDigits.length, b.fractionDigits.length);
  const aFrac = a.fractionDigits.padEnd(width, '0');
  const bFrac = b.fractionDigits.padEnd(width, '0');
  if (aFrac === bFrac) return 0;
  return aFrac < bFrac ? -1 : 1;
}

const HAND_OFF_COLLECTION_KEYS = [
  'changed_files',
  'source_identities',
  'commands',
  'artifacts',
  'acceptance_results',
  'failures_and_skipped_checks',
  'unresolved_claims',
  'risks'
];

/** Collections whose semantic traversals dereference object fields such as `id`. */
const OBJECT_ITEM_COLLECTION_KEYS = [
  'source_identities',
  'commands',
  'artifacts',
  'acceptance_results',
  'failures_and_skipped_checks',
  'unresolved_claims',
  'risks'
];

function isPlainObjectItem(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * True when semantic checkers can traverse the packet without throwing on
 * null/noniterable collections or null/non-object collection items.
 * Schema-invalid but structurally safe packets still receive the named
 * semantic rejection rules used by the regression suite.
 */
export function isStructurallySafeHandoff(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const key of HAND_OFF_COLLECTION_KEYS) {
    if (value[key] == null) continue;
    if (!Array.isArray(value[key])) return false;
  }
  for (const key of OBJECT_ITEM_COLLECTION_KEYS) {
    const items = value[key];
    if (!Array.isArray(items)) continue;
    if (!items.every(isPlainObjectItem)) return false;
  }
  if (value.dependency_merge_shas != null) {
    if (
      typeof value.dependency_merge_shas !== 'object' ||
      Array.isArray(value.dependency_merge_shas)
    ) {
      return false;
    }
  }
  return true;
}

function escapeRegexLiteralChar(ch) {
  return /[.+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

/**
 * Translate documented `*` / `**` tokens independently of regex metacharacter
 * escaping. `*` is one slash-free segment; `**` is zero or more segments.
 * A globstar followed by a slash also matches zero intervening directories.
 */
function ownedGlobToRegExpSource(pattern) {
  let source = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] !== '*') {
      source += escapeRegexLiteralChar(pattern[i]);
      i += 1;
      continue;
    }
    let stars = 1;
    while (pattern[i + stars] === '*') stars += 1;
    i += stars;
    if (stars === 1) {
      source += '[^/]*';
      continue;
    }
    if (pattern[i] === '/') {
      i += 1;
      source += '(?:.*/)?';
    } else {
      source += '.*';
    }
  }
  return source;
}

/**
 * Exact-file and directory/glob ownership:
 * - an exact path matches only that file;
 * - `dir/` matches `dir` and any descendant;
 * - `dir/**` matches `dir` and any descendant;
 * - `*` matches one path segment; `**` matches zero or more segments.
 */
export function ownedPathMatches(ownedPath, candidatePath) {
  if (typeof ownedPath !== 'string' || typeof candidatePath !== 'string') return false;
  const owned = toPosix(ownedPath);
  const candidate = toPosix(candidatePath);
  if (owned === '' || candidate === '') return false;
  if (owned === candidate) return true;
  if (owned.endsWith('/')) {
    const prefix = owned.slice(0, -1);
    return candidate === prefix || candidate.startsWith(`${prefix}/`);
  }
  if (owned.endsWith('/**')) {
    const prefix = owned.slice(0, -3);
    return candidate === prefix || candidate.startsWith(`${prefix}/`);
  }
  if (!owned.includes('*')) return false;
  return new RegExp(`^${ownedGlobToRegExpSource(owned)}$`).test(candidate);
}

function gitPathExistsAtCommit(commit, gitPath, cwd) {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}:${gitPath}`], { cwd, stdio: 'ignore' });
    return { ok: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ok: false, unavailable: true, detail: 'git executable is not available' };
    }
    return {
      ok: false,
      unavailable: false,
      detail: `${commit}:${gitPath} is not present as a Git object`
    };
  }
}

function gitBlobSizeAtCommit(commit, gitPath, cwd) {
  try {
    const stdout = execFileSync('git', ['cat-file', '-s', `${commit}:${gitPath}`], {
      cwd,
      encoding: 'utf8'
    });
    const size = Number.parseInt(String(stdout).trim(), 10);
    if (!Number.isFinite(size) || size < 0) {
      return { ok: false, detail: `git cat-file -s returned a non-integer size: ${String(stdout).trim()}` };
    }
    return { ok: true, size };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ok: false, unavailable: true, detail: 'git executable is not available' };
    }
    return {
      ok: false,
      detail: `git cat-file -s ${commit}:${gitPath} failed (${error.status ?? error.code ?? error.message})`
    };
  }
}

function hashGitShowStream(commit, gitPath, cwd, maxBytes = GIT_SNAPSHOT_MAX_BYTES) {
  return new Promise(resolve => {
    const child = spawn('git', ['show', `${commit}:${gitPath}`], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const digest = createHash('sha256');
    let bytes = 0;
    let stderr = '';
    let settled = false;
    let sizeLimited = false;

    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        sizeLimited = true;
        child.kill('SIGTERM');
        return;
      }
      digest.update(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 4096) stderr = stderr.slice(0, 4096);
    });
    child.on('error', error => {
      finish({
        ok: false,
        rule: error.code === 'ENOENT' ? 'git_unavailable' : 'source_git_snapshot_unreadable',
        detail:
          error.code === 'ENOENT'
            ? 'git executable is not available for immutable snapshot verification'
            : `git show failed to execute (${error.code ?? error.message}) after ${bytes} byte(s)`
      });
    });
    child.on('close', (status, signal) => {
      if (sizeLimited) {
        finish({
          ok: false,
          rule: 'source_git_snapshot_size_limit',
          detail: `${commit}:${gitPath} exceeded the ${maxBytes} byte snapshot read limit after ${bytes} byte(s)`
        });
        return;
      }
      if (status === 0) {
        finish({ ok: true, sha256: digest.digest('hex'), bytes });
        return;
      }
      finish({
        ok: false,
        rule: 'source_git_snapshot_unreadable',
        detail: `${commit}:${gitPath} git show failed (status ${status ?? 'null'}, signal ${signal ?? 'none'}, bytes_read ${bytes})${stderr.trim() ? `: ${stderr.trim()}` : ''}`
      });
    });
  });
}

function collectDeclaredArtifacts(handoff) {
  const items = [];
  for (const artifact of handoff.artifacts ?? []) {
    items.push({ source: `artifacts[${artifact.id}]`, artifact });
  }
  for (const command of handoff.commands ?? []) {
    if (command?.event_source) {
      items.push({
        source: `commands[${command.id}].event_source`,
        artifact: command.event_source
      });
    }
  }
  return items;
}

function perPrBindingCandidates(repoRoot, prId) {
  const slug = prSlug(prId);
  return [
    {
      source: 'per-pr-task-binding',
      absolute: path.join(repoRoot, 'verification', 'research-program', slug, 'task-binding.json')
    },
    {
      source: 'per-pr-fixture-task-binding',
      absolute: path.join(
        repoRoot,
        'verification',
        'research-program',
        slug,
        'fixtures',
        'task-binding.json'
      )
    }
  ];
}

async function readTaskBinding(filePath, repoRoot, validators, expectedPrId, reporter) {
  const { fail } = reporter;
  try {
    const { value, sha256 } = await loadJsonWithSha(filePath);
    const record = {
      sourcePath: reportPath(repoRoot, filePath),
      sha256,
      value
    };
    if (!validators.validateTask(value)) {
      fail(
        'task_binding',
        'task_binding_invalid',
        `${record.sourcePath} failed task.schema.json: ${formatAjvErrors(validators.validateTask).join('; ')}`
      );
      return { ...record, ok: false };
    }
    if (value.pr_id !== expectedPrId) {
      fail(
        'task_binding',
        'task_binding_pr_mismatch',
        `task binding ${record.sourcePath} is for ${value.pr_id} but the handoff is ${expectedPrId}`
      );
      return { ...record, ok: false };
    }
    return { ...record, ok: true };
  } catch (error) {
    fail('task_binding', 'task_binding_unreadable', `cannot read ${reportPath(repoRoot, filePath)}: ${error.message}`);
    return { ok: false, sourcePath: reportPath(repoRoot, filePath) };
  }
}

/**
 * Resolve the authoritative task/binding records for a handoff.
 *
 * Precedence and cross-checks:
 *   1. a sibling `task-binding.json` next to the handoff (validated against
 *      task.schema.json) supplies the exact base SHA and dependency SHAs;
 *   2. `verification/research-program/pr-NNN/task-binding.json`, then that
 *      directory's `fixtures/task-binding.json` (per-PR, not a shared
 *      docs/research-program/handoffs/task-binding.json);
 *   3. the committed `docs/research-program/execution-ledger.json` supplies
 *      dependency SHAs for the handoff's PR id;
 *   4. when more than one authority exists they must agree, otherwise
 *      `binding_conflict`. Ledger-only is not a concrete base binding.
 */
async function resolveAuthorities(handoff, handoffDir, repoRoot, reporter, validators) {
  const { fail, markCheck, note } = reporter;
  const authorities = {
    task_binding: null,
    task_bindings: [],
    execution_ledger: null
  };
  const loaded = [];
  const realRoot = await realpath(repoRoot);

  async function loadCandidate(source, candidate) {
    if (!(await existsAsFile(candidate))) return;
    let candidateReal;
    try {
      candidateReal = await realpath(candidate);
    } catch (error) {
      fail('task_binding', 'task_binding_unreadable', `${source}: ${error.code ?? error.message}`);
      return;
    }
    if (!isWithin(realRoot, candidateReal)) {
      fail('task_binding', 'task_binding_path_escapes_root_via_symlink', `${source} resolves outside the repository root`);
      return;
    }
    if (loaded.some(entry => entry.realPath === candidateReal)) return;
    const record = await readTaskBinding(candidate, repoRoot, validators, handoff.pr_id, reporter);
    if (!record.ok) return;
    loaded.push({
      source,
      binding: record.value.binding,
      task: record.value,
      path: record.sourcePath,
      sha256: record.sha256,
      realPath: candidateReal
    });
  }

  // First readable authority is exclusive: a fixture sibling binding stays
  // scoped to that fixture and is not required to agree with a later per-PR
  // correction binding. A producer-written task-binding file is not a
  // self-authenticating signature; controller dispatch review remains separate.
  await loadCandidate('sibling-task-binding', path.join(handoffDir, 'task-binding.json'));
  if (loaded.length === 0) {
    for (const candidate of perPrBindingCandidates(repoRoot, handoff.pr_id)) {
      await loadCandidate(candidate.source, candidate.absolute);
      if (loaded.length > 0) break;
    }
  }

  if (loaded.length > 0) {
    authorities.task_binding = {
      source: loaded[0].source,
      path: loaded[0].path,
      sha256: loaded[0].sha256
    };
    authorities.task_bindings = loaded.map(entry => ({
      source: entry.source,
      path: entry.path,
      sha256: entry.sha256
    }));
  }

  for (let i = 1; i < loaded.length; i += 1) {
    const first = loaded[0];
    const other = loaded[i];
    if (first.binding?.base_sha !== other.binding?.base_sha) {
      fail(
        'base_sha_binding',
        'binding_conflict',
        `${first.path} base_sha ${first.binding?.base_sha} disagrees with ${other.path} ${other.binding?.base_sha}`
      );
    }
    if (
      JSON.stringify(sortedDependencyEntries(first.binding?.dependency_merge_shas)) !==
      JSON.stringify(sortedDependencyEntries(other.binding?.dependency_merge_shas))
    ) {
      fail(
        'dependency_sha_binding',
        'binding_conflict',
        `${first.path} and ${other.path} disagree on dependency_merge_shas`
      );
    }
  }

  let ledgerTask = null;
  const ledgerPath = path.join(repoRoot, 'docs', 'research-program', 'execution-ledger.json');
  if (await existsAsFile(ledgerPath)) {
    try {
      const ledgerReal = await realpath(ledgerPath);
      if (!isWithin(realRoot, ledgerReal)) {
        fail('task_binding', 'execution_ledger_path_escapes_root_via_symlink', 'execution ledger resolves outside the repository root');
      } else {
        const { value, sha256 } = await loadJsonWithSha(ledgerReal);
        const tasks = Array.isArray(value.tasks) ? value.tasks : [];
        ledgerTask = tasks.find(task => task.pr_id === handoff.pr_id) ?? null;
        authorities.execution_ledger = {
          path: reportPath(repoRoot, ledgerPath),
          sha256,
          task_found: ledgerTask !== null
        };
        if (!ledgerTask) {
          fail('task_binding', 'unknown_pr_in_execution_ledger', `execution ledger has no task for ${handoff.pr_id}`);
        }
      }
    } catch (error) {
      fail('task_binding', 'execution_ledger_unreadable', `cannot read execution ledger: ${error.message}`);
    }
  } else {
    note(
      'execution_ledger_unavailable',
      'unavailable',
      'docs/research-program/execution-ledger.json is not present, so ledger cross-checking did not run'
    );
  }

  const primary = loaded[0] ?? null;
  const bindingDeps = primary?.binding?.dependency_merge_shas ?? null;
  const ledgerDeps = ledgerTask?.dependency_merge_shas ?? null;
  if (bindingDeps && ledgerDeps && JSON.stringify(sortedDependencyEntries(bindingDeps)) !== JSON.stringify(sortedDependencyEntries(ledgerDeps))) {
    fail('dependency_sha_binding', 'binding_conflict', 'task-binding.json and the execution ledger disagree on dependency_merge_shas');
  }

  const bindingBase = primary?.binding?.base_sha ?? null;
  const ledgerBase = typeof ledgerTask?.base_sha === 'string' ? ledgerTask.base_sha : null;
  if (bindingBase && ledgerBase && bindingBase !== ledgerBase) {
    fail('base_sha_binding', 'binding_conflict', `task binding base_sha ${bindingBase} disagrees with execution-ledger base_sha ${ledgerBase}`);
  }

  let effective = null;
  let source = null;
  if (primary?.binding) {
    effective = primary.binding;
    source = primary.source;
  } else if (ledgerTask) {
    effective = {
      base_sha: ledgerBase,
      dependency_merge_shas: ledgerDeps ?? {}
    };
    source = 'execution-ledger';
  }

  if (!effective) {
    fail(
      'task_binding',
      'task_binding_missing',
      'no sibling or per-PR task-binding.json and no matching execution-ledger task could bind the handoff'
    );
  } else if (typeof effective.base_sha !== 'string') {
    fail(
      'base_sha_binding',
      'base_sha_unbound',
      'the resolved authority supplies no exact base_sha; dependency SHAs alone cannot bind a completed handoff to its starting commit'
    );
    markCheck('task_binding', 'passed', `dependency authority resolved using ${source}; exact base binding is missing`);
  } else {
    markCheck('task_binding', 'passed', `handoff bound using ${source}`);
  }

  return { authorities, effective, source, taskRecord: primary?.task ?? null };
}

async function evaluateArtifacts(declaredArtifacts, repoRoot, realRoot, reporter) {
  const { fail, markCheck } = reporter;
  let pathOk = true;
  let existenceOk = true;
  let hashOk = true;

  if (declaredArtifacts.length === 0) {
    markCheck('artifact_path_containment', 'not_applicable', 'no artifacts or command event-source records declared');
    markCheck('artifact_file_existence', 'not_applicable', 'no artifacts or command event-source records declared');
    markCheck('artifact_sha256_binding', 'not_applicable', 'no artifacts or command event-source records declared');
    return;
  }

  for (const { source, artifact } of declaredArtifacts) {
    const contained = resolveContainedPath(repoRoot, artifact?.path);
    if (!contained.ok) {
      fail('artifact_path_containment', 'artifact_path_not_contained', `${source} (${artifact?.path}): ${contained.detail}`);
      pathOk = false;
      continue;
    }

    let real;
    try {
      real = await realpath(contained.absolute);
    } catch (error) {
      fail('artifact_file_existence', 'artifact_missing_on_disk', `${source} (${artifact.path}): ${error.code ?? 'not found'}`);
      existenceOk = false;
      continue;
    }
    if (!isWithin(realRoot, real)) {
      fail('artifact_path_containment', 'artifact_path_escapes_root_via_symlink', `${source} (${artifact.path}) resolves outside the repository root`);
      pathOk = false;
      continue;
    }

    let info;
    let buffer;
    try {
      info = await stat(real);
      if (!info.isFile()) throw new Error('not a regular file');
      buffer = await readFile(real);
    } catch (error) {
      fail('artifact_file_existence', 'artifact_not_regular_file', `${source} (${artifact.path}): ${error.code ?? error.message}`);
      existenceOk = false;
      continue;
    }

    const digest = sha256Buffer(buffer);
    if (digest !== artifact.sha256) {
      fail('artifact_sha256_binding', 'artifact_hash_mismatch', `${source} (${artifact.path}) expected ${artifact.sha256} got ${digest}`);
      hashOk = false;
    } else if (typeof artifact.bytes === 'number' && artifact.bytes !== buffer.length) {
      fail('artifact_sha256_binding', 'artifact_byte_mismatch', `${source} (${artifact.path}) expected ${artifact.bytes} bytes got ${buffer.length}`);
      hashOk = false;
    }
  }

  if (pathOk) markCheck('artifact_path_containment', 'passed', 'all artifact and event-source paths stay inside the repository root');
  if (existenceOk) markCheck('artifact_file_existence', 'passed', 'all referenced artifacts and event-source files exist as regular files');
  if (hashOk) markCheck('artifact_sha256_binding', 'passed', 'all declared artifact and event-source SHA-256 (and byte) bindings match on-disk bytes');
}

async function evaluateSourceIdentities(handoff, repoRoot, realRoot, reporter) {
  const { fail, markCheck, note } = reporter;
  let sourceOk = true;
  let localChecked = 0;
  let gitChecked = 0;

  for (const identity of handoff.source_identities ?? []) {
    const hasGitBinding = identity.git_commit !== undefined || identity.git_path !== undefined;
    if (hasGitBinding) {
      gitChecked += 1;
      if (identity.location !== 'external') {
        fail(
          'source_identity_binding',
          'source_git_snapshot_external_only',
          `${identity.id}: immutable git snapshot bindings require location=external`
        );
        sourceOk = false;
      }
      if (
        typeof identity.git_commit !== 'string' ||
        typeof identity.git_path !== 'string' ||
        typeof identity.sha256 !== 'string'
      ) {
        fail(
          'source_identity_binding',
          'source_git_binding_missing',
          `${identity.id}: git_commit, git_path and sha256 are required for a git snapshot binding`
        );
        sourceOk = false;
        continue;
      }
      const contained = resolveContainedPath(repoRoot, identity.git_path);
      if (!contained.ok) {
        fail(
          'source_identity_binding',
          'source_git_path_not_contained',
          `${identity.id}: ${contained.detail}`
        );
        sourceOk = false;
        continue;
      }
      const commit = gitCommitExists(identity.git_commit, repoRoot);
      if (commit.unavailable) {
        fail(
          'source_identity_binding',
          'git_unavailable',
          `${identity.id}: git executable is not available for immutable snapshot verification`
        );
        sourceOk = false;
        continue;
      }
      if (!commit.ok) {
        fail(
          'source_identity_binding',
          'source_git_commit_not_local',
          `${identity.id}: ${commit.detail}`
        );
        sourceOk = false;
        continue;
      }
      const pathExists = gitPathExistsAtCommit(identity.git_commit, identity.git_path, repoRoot);
      if (pathExists.unavailable) {
        fail(
          'source_identity_binding',
          'git_unavailable',
          `${identity.id}: git executable is not available for immutable snapshot verification`
        );
        sourceOk = false;
        continue;
      }
      if (!pathExists.ok) {
        fail(
          'source_identity_binding',
          'source_git_path_missing_at_commit',
          `${identity.id}: ${identity.git_commit}:${identity.git_path} is not present as a Git object at that commit`
        );
        sourceOk = false;
        continue;
      }
      const sizeInfo = gitBlobSizeAtCommit(identity.git_commit, identity.git_path, repoRoot);
      if (sizeInfo.unavailable) {
        fail(
          'source_identity_binding',
          'git_unavailable',
          `${identity.id}: git executable is not available for immutable snapshot verification`
        );
        sourceOk = false;
        continue;
      }
      if (!sizeInfo.ok) {
        fail(
          'source_identity_binding',
          'source_git_snapshot_unreadable',
          `${identity.id}: ${sizeInfo.detail}`
        );
        sourceOk = false;
        continue;
      }
      if (sizeInfo.size > GIT_SNAPSHOT_MAX_BYTES) {
        fail(
          'source_identity_binding',
          'source_git_snapshot_size_limit',
          `${identity.id}: ${identity.git_commit}:${identity.git_path} is ${sizeInfo.size} bytes, above the ${GIT_SNAPSHOT_MAX_BYTES} byte snapshot read limit`
        );
        sourceOk = false;
        continue;
      }
      const hashed = await hashGitShowStream(
        identity.git_commit,
        identity.git_path,
        repoRoot,
        GIT_SNAPSHOT_MAX_BYTES
      );
      if (!hashed.ok) {
        fail('source_identity_binding', hashed.rule, `${identity.id}: ${hashed.detail}`);
        sourceOk = false;
        continue;
      }
      if (hashed.sha256 !== identity.sha256) {
        fail(
          'source_identity_binding',
          'source_git_snapshot_hash_mismatch',
          `${identity.id} at ${identity.git_commit}:${identity.git_path} expected ${identity.sha256} got ${hashed.sha256}`
        );
        sourceOk = false;
      }
      continue;
    }
    if (identity.location === 'external') {
      note('external_source_identity', 'external', `source identity ${identity.id} is external; any SHA-256 is recorded but not locally verified`);
      continue;
    }
    if (identity.location !== 'local') {
      fail('source_identity_binding', 'source_identity_location_missing', `${identity.id}: location must be explicit local or external`);
      sourceOk = false;
      continue;
    }
    if (typeof identity.sha256 !== 'string') {
      fail('source_identity_binding', 'source_identity_hash_omitted', `${identity.id}: local source identity requires sha256`);
      sourceOk = false;
      continue;
    }
    localChecked += 1;
    const contained = resolveContainedPath(repoRoot, identity.id);
    if (!contained.ok) {
      fail('source_identity_binding', 'source_identity_path_not_contained', `${identity.id}: ${contained.detail}`);
      sourceOk = false;
      continue;
    }
    let real;
    let info;
    try {
      real = await realpath(contained.absolute);
      if (!isWithin(realRoot, real)) throw Object.assign(new Error('resolved outside repository root'), { code: 'OUTSIDE_ROOT' });
      info = await stat(real);
      if (!info.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'NOT_FILE' });
    } catch (error) {
      const rule = error.code === 'OUTSIDE_ROOT' ? 'source_identity_path_escapes_root_via_symlink' : error.code === 'NOT_FILE' ? 'source_identity_not_regular_file' : 'source_identity_missing_on_disk';
      fail('source_identity_binding', rule, `${identity.id}: ${error.code ?? error.message}`);
      sourceOk = false;
      continue;
    }
    const digest = await sha256File(real);
    if (digest !== identity.sha256) {
      fail('source_identity_binding', 'stale_source_identity_sha', `${identity.id} expected ${identity.sha256} got ${digest}`);
      sourceOk = false;
    }
  }

  if (sourceOk) {
    const verified = localChecked + gitChecked;
    const detail = [
      localChecked ? `${localChecked} current local source hash(es) match on-disk bytes with resolved containment` : null,
      gitChecked ? `${gitChecked} immutable Git source snapshot hash(es) match streamed git show bytes at their bound commit/path` : null
    ].filter(Boolean).join('; ');
    markCheck('source_identity_binding', verified > 0 ? 'passed' : 'not_applicable', detail || 'no locally verifiable source identity declared');
  }
}

async function evaluateChangedFiles(handoff, repoRoot, realRoot, reporter) {
  const { fail, markCheck, note } = reporter;
  let ok = true;

  for (const changed of handoff.changed_files ?? []) {
    const contained = resolveContainedPath(repoRoot, changed);
    if (!contained.ok) {
      fail('changed_file_containment', 'changed_file_path_not_contained', `${changed}: ${contained.detail}`);
      ok = false;
      continue;
    }
    let info;
    try {
      info = await lstat(contained.absolute);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        note(
          'changed_file_not_present',
          'unresolved',
          `${changed} is recorded as changed but is not present on disk (a deletion is valid; surface it to the reviewer)`
        );
        continue;
      }
      fail(
        'changed_file_containment',
        'changed_file_unreadable',
        `${changed}: lstat failed (${error.code ?? error.message})`
      );
      ok = false;
      continue;
    }

    let real;
    try {
      real = await realpath(contained.absolute);
    } catch (error) {
      if (info.isSymbolicLink()) {
        fail(
          'changed_file_containment',
          'changed_file_symlink_unresolved',
          `${changed} exists as a symlink whose target cannot be resolved; it is not a deletion and is not verified containment (${error.code ?? error.message})`
        );
        ok = false;
        continue;
      }
      fail(
        'changed_file_containment',
        'changed_file_unreadable',
        `${changed}: realpath failed (${error.code ?? error.message})`
      );
      ok = false;
      continue;
    }
    if (!isWithin(realRoot, real)) {
      fail('changed_file_containment', 'changed_file_escapes_root_via_symlink', `${changed} resolves outside the repository root`);
      ok = false;
    }
  }

  if (ok) markCheck('changed_file_containment', 'passed', 'all changed-file records are repository-contained after symlink resolution');
}

function evaluateTaskScope(handoff, taskRecord, reporter) {
  const { fail, markCheck } = reporter;
  if (!taskRecord) {
    markCheck(
      'task_scope_binding',
      'not_applicable',
      'no concrete task schema binding was resolved, so owner/branch/owned-path scope was not compared'
    );
    return;
  }
  if (!COMPLETED_PACKET_STATES.has(handoff.status)) {
    markCheck(
      'task_scope_binding',
      'not_applicable',
      `${handoff.status} packets are not required to match completed owner/branch/owned-path scope`
    );
    return;
  }

  let ok = true;
  if (handoff.owner !== taskRecord.owner) {
    fail(
      'task_scope_binding',
      'handoff_owner_mismatch',
      `handoff owner ${JSON.stringify(handoff.owner)} does not match task binding owner ${JSON.stringify(taskRecord.owner)}`
    );
    ok = false;
  }
  if (handoff.branch !== taskRecord.branch) {
    fail(
      'task_scope_binding',
      'handoff_branch_mismatch',
      `handoff branch ${JSON.stringify(handoff.branch)} does not match task binding branch ${JSON.stringify(taskRecord.branch)}`
    );
    ok = false;
  }
  const ownedPaths = Array.isArray(taskRecord.owned_paths) ? taskRecord.owned_paths : [];
  for (const changed of handoff.changed_files ?? []) {
    if (!ownedPaths.some(pattern => ownedPathMatches(pattern, changed))) {
      fail(
        'task_scope_binding',
        'changed_file_outside_owned_paths',
        `${changed} is not within the task binding owned_paths`
      );
      ok = false;
    }
  }
  if (ok) {
    markCheck(
      'task_scope_binding',
      'passed',
      'completed handoff owner, branch and changed-file scope match the concrete task binding'
    );
  }
}

function evaluateIdentifierUniqueness(handoff, reporter) {
  const { fail, markCheck } = reporter;
  let ok = true;
  const commandIds = new Map();
  for (const command of handoff.commands ?? []) {
    if (commandIds.has(command.id)) {
      fail('identifier_uniqueness', 'duplicate_command_id', `ambiguous command id ${command.id}; duplicate records cannot be resolved safely`);
      ok = false;
    } else {
      commandIds.set(command.id, command);
    }
  }

  const artifactIds = new Map();
  for (const { source, artifact } of collectDeclaredArtifacts(handoff)) {
    if (artifactIds.has(artifact.id)) {
      fail('identifier_uniqueness', 'duplicate_artifact_id', `ambiguous artifact id ${artifact.id} (${source} collides with ${artifactIds.get(artifact.id)})`);
      ok = false;
    } else {
      artifactIds.set(artifact.id, source);
    }
  }

  const acceptanceIds = new Set();
  for (const result of handoff.acceptance_results ?? []) {
    if (acceptanceIds.has(result.id)) {
      fail('identifier_uniqueness', 'duplicate_acceptance_id', `ambiguous acceptance result id ${result.id}`);
      ok = false;
    } else {
      acceptanceIds.add(result.id);
    }
  }

  const sourceIds = new Set();
  for (const source of handoff.source_identities ?? []) {
    if (sourceIds.has(source.id)) {
      fail('identifier_uniqueness', 'duplicate_source_identity_id', `ambiguous source identity id ${source.id}`);
      ok = false;
    } else {
      sourceIds.add(source.id);
    }
  }

  if (ok) markCheck('identifier_uniqueness', 'passed', 'command, artifact, acceptance and source-identity ids are unique');
  return {
    commands: commandIds,
    artifacts: new Map((handoff.artifacts ?? []).map(entry => [entry.id, entry]))
  };
}

function evaluatePacketEvidence(handoff, reporter) {
  const { fail, markCheck } = reporter;
  const status = handoff.status;
  let ok = true;
  for (const result of handoff.acceptance_results ?? []) {
    if (result.status === 'independently_verified' && handoff.head_sha === null) {
      fail(
        'packet_evidence',
        'acceptance_head_sha_required_for_terminal_state',
        `${result.id} claims independently_verified while head_sha is null; a controller must bind the committed head first`
      );
      ok = false;
    }
  }
  if (handoff.independent_review?.status === 'independently_verified' && handoff.independent_review.reviewed_head_sha === null) {
    fail(
      'packet_evidence',
      'independent_review_head_sha_required',
      'independent_review independently_verified requires a concrete reviewed_head_sha'
    );
    ok = false;
  }

  if (COMPLETED_PACKET_STATES.has(status)) {
    if (typeof handoff.owner !== 'string' || handoff.owner.trim() === '') {
      fail('packet_evidence', 'packet_owner_missing', `${status} packets require a non-null owner`);
      ok = false;
    }
    for (const [name, value] of [
      ['changed_files', handoff.changed_files],
      ['source_identities', handoff.source_identities],
      ['commands', handoff.commands],
      ['artifacts', handoff.artifacts],
      ['acceptance_results', handoff.acceptance_results]
    ]) {
      if (!Array.isArray(value) || value.length === 0) {
        fail('packet_evidence', 'empty_evidence_array', `${status} packet has empty ${name}`);
        ok = false;
      }
    }
    if (handoff.head_sha === null) {
      const pending = (handoff.unresolved_claims ?? []).some(claim =>
        /head.*sha|sha.*head|commit/i.test(String(claim.id ?? '')) &&
        ['pending', 'unresolved', 'blocked'].includes(claim.status)
      );
      if (!pending) {
        fail('packet_evidence', 'head_sha_pending_untyped', 'completed packet with null head_sha must carry a typed pending/unresolved head claim');
        ok = false;
      }
      if (['independently_verified', 'merged', 'integrated', 'qualified'].includes(status)) {
        fail('packet_evidence', 'head_sha_required_for_terminal_state', `${status} cannot be independently accepted with a null head_sha`);
        ok = false;
      }
    }
  }
  if (ok) {
    markCheck('packet_evidence', 'passed', COMPLETED_PACKET_STATES.has(status) ? 'completed packet has attributable owner and non-empty evidence arrays' : `${status} may carry incomplete evidence by protocol state`);
  }
}

function evaluateCommandOutcomeConsistency(command, reporter) {
  const expected = expectedCommandOutcome(command);
  const observed = observedCommandOutcome(command);
  let ok = true;
  if (!expected) {
    reporter.fail('command_result_resolution', 'command_expected_outcome_missing', `command ${command.id} has no structured expected_outcome`);
    ok = false;
  }
  if (!observed) {
    reporter.fail('command_result_resolution', 'command_observed_outcome_missing', `command ${command.id} has no structured observed_outcome`);
    ok = false;
  }
  const timing = compareRfc3339UtcInstants(command.started_at, command.completed_at);
  if (timing === null) {
    reporter.fail('command_result_resolution', 'command_timestamp_invalid', `command ${command.id} requires RFC3339 UTC started_at and completed_at timestamps`);
    ok = false;
  } else if (timing > 0) {
    reporter.fail('command_result_resolution', 'command_timing_order_invalid', `command ${command.id} completed_at precedes started_at`);
    ok = false;
  }
  if (observed?.kind === 'observed_exit') {
    if (typeof command.exit_code === 'number' && command.exit_code !== observed.exit_code) {
      reporter.fail('command_result_resolution', 'command_outcome_conflict', `command ${command.id} exit_code ${command.exit_code} disagrees with observed_outcome.exit_code ${observed.exit_code}`);
      ok = false;
    }
  } else if (observed && command.exit_code !== undefined && command.exit_code !== null) {
    reporter.fail('command_result_resolution', 'command_outcome_conflict', `command ${command.id} records numeric exit_code ${command.exit_code} alongside typed ${observed.kind} outcome`);
    ok = false;
  }
  const completion = completionStatusOutcome(command.completion_status);
  if (completion && observed && !outcomesMatch(completion, observed)) {
    reporter.fail('command_result_resolution', 'command_outcome_conflict', `command ${command.id} completion_status conflicts with observed_outcome`);
    ok = false;
  }
  if (observed && observed.kind !== 'observed_exit' && (!observed.detail || observed.detail.trim() === '')) {
    reporter.fail('command_result_resolution', 'command_provider_limitation_missing', `command ${command.id} typed ${observed.kind} outcome requires detail describing the limitation or failure`);
    ok = false;
  }
  return ok;
}

function evaluateCrossReferences(handoff, commands, artifacts, reporter) {
  const { fail, markCheck } = reporter;
  let commandOk = true;
  let artifactOk = true;

  for (const command of handoff.commands ?? []) {
    if (!evaluateCommandOutcomeConsistency(command, reporter)) commandOk = false;
    if (typeof command.result !== 'string' || command.result.trim() === '') {
      fail('command_result_resolution', 'command_result_missing', `command ${command.id} has no non-empty result narrative`);
      commandOk = false;
    }
  }

  for (const result of handoff.acceptance_results ?? []) {
    const commandIds = result.command_ids ?? [];
    if (SUCCESS_ACCEPTANCE_STATES.has(result.status)) {
      if (commandIds.length === 0) {
        fail('command_result_resolution', 'claimed_pass_without_command_result', `${result.id} claims ${result.status} with an empty command_ids list`);
        commandOk = false;
      }
      for (const commandId of commandIds) {
        const command = commands.get(commandId);
        if (!command) {
          fail('command_result_resolution', 'claimed_pass_without_command_result', `${result.id} references unknown command ${commandId}`);
          commandOk = false;
          continue;
        }
        const observed = observedCommandOutcome(command);
        const expected = expectedCommandOutcome(command);
        if (!observed || !expected) {
          fail('command_result_resolution', 'claimed_pass_without_command_result', `${result.id} command ${commandId} has no complete structured expected/observed outcome`);
          commandOk = false;
          continue;
        }
        if (!['observed_exit', 'unavailable'].includes(observed.kind)) {
          fail('command_result_resolution', 'success_claim_backed_by_non_success_outcome', `${result.id} command ${commandId} observed typed ${observed.kind}; use an expected-negative observed_exit or preserve the acceptance as failed/blocked/unresolved`);
          commandOk = false;
        }
        if (!outcomesMatch(expected, observed)) {
          fail('command_result_resolution', 'command_outcome_mismatch', `${result.id} command ${commandId} expected ${expected.kind}${expected.exit_code !== undefined ? ` ${expected.exit_code}` : ''} got ${observed.kind}${observed.exit_code !== undefined ? ` ${observed.exit_code}` : ''}`);
          commandOk = false;
        }
      }
    } else {
      for (const commandId of commandIds) {
        if (!commands.has(commandId)) {
          fail('command_result_resolution', 'unresolved_command_reference', `${result.id} (${result.status}) references unknown command ${commandId}`);
          commandOk = false;
        }
      }
    }

    for (const artifactId of result.artifact_ids ?? []) {
      if (!artifacts.has(artifactId)) {
        fail('artifact_reference_resolution', 'missing_artifact', `${result.id} references unknown artifact ${artifactId}`);
        artifactOk = false;
      }
    }
  }

  if (commandOk) markCheck('command_result_resolution', 'passed', 'every command has timestamped structured outcomes and each success claim matches its expected outcome');
  if (artifactOk) markCheck('artifact_reference_resolution', 'passed', 'every referenced top-level artifact id resolves');
}

function evaluateDependencyBinding(handoff, effective, reporter) {
  const { fail, markCheck } = reporter;
  if (!effective) return;

  const expected = effective.dependency_merge_shas ?? {};
  const actual = handoff.dependency_merge_shas ?? {};
  let ok = true;

  for (const [prId, sha] of Object.entries(actual)) {
    if (!(prId in expected)) {
      fail(
        'dependency_sha_binding',
        'unexpected_dependency',
        `${prId} is declared by the handoff but not by the task binding`
      );
      ok = false;
    } else if (expected[prId] !== sha) {
      fail(
        'dependency_sha_binding',
        'stale_dependency_sha',
        `${prId} expected ${expected[prId]} got ${sha}`
      );
      ok = false;
    }
  }
  for (const prId of Object.keys(expected)) {
    if (!(prId in actual)) {
      fail(
        'dependency_sha_binding',
        'missing_dependency_sha',
        `${prId} is required by the task binding but missing from the handoff`
      );
      ok = false;
    }
  }

  if (ok) {
    markCheck(
      'dependency_sha_binding',
      'passed',
      `${Object.keys(expected).length} dependency SHA(s) match the task binding`
    );
  }

  if (typeof effective.base_sha === 'string') {
    if (handoff.base_sha !== effective.base_sha) {
      fail(
        'base_sha_binding',
        'stale_base_sha',
        `handoff ${handoff.base_sha} != task binding ${effective.base_sha}`
      );
    } else {
      markCheck('base_sha_binding', 'passed', 'handoff base_sha matches the task binding');
    }
  } else {
    fail(
      'base_sha_binding',
      'base_sha_unbound',
      'no sibling or per-PR task-binding supplied an expected base SHA; ledger dependency SHAs alone do not bind the base. Completed packets are not accepted with an unbound base.'
    );
  }
}

function evaluateGitBinding(handoff, repoRoot, reporter) {
  const { fail, markCheck, note } = reporter;
  if (typeof handoff.base_sha !== 'string') {
    markCheck('git_commit_binding', 'not_applicable', 'no base SHA to bind to the local repository');
    return;
  }

  let ok = true;
  let gitUnavailable = false;
  const markUnavailable = () => {
    if (!gitUnavailable) {
      gitUnavailable = true;
      fail('git_commit_binding', 'git_unavailable', 'git executable is not available for local commit verification');
    }
    ok = false;
  };

  const baseExists = gitCommitExists(handoff.base_sha, repoRoot);
  if (baseExists.unavailable) {
    markUnavailable();
  } else if (!baseExists.ok) {
    fail('git_commit_binding', 'base_sha_not_local_commit', baseExists.detail);
    ok = false;
  }

  if (!gitUnavailable) {
    for (const [prId, sha] of Object.entries(handoff.dependency_merge_shas ?? {})) {
      const exists = gitCommitExists(sha, repoRoot);
      if (exists.unavailable) {
        markUnavailable();
        break;
      }
      if (!exists.ok) {
        fail('git_commit_binding', 'dependency_sha_not_local_commit', `${prId}: ${exists.detail}`);
        ok = false;
        continue;
      }
      const ancestor = gitIsAncestor(sha, handoff.base_sha, repoRoot);
      if (ancestor.unavailable) {
        markUnavailable();
        break;
      }
      if (!ancestor.ok) {
        fail('git_commit_binding', 'dependency_sha_not_ancestor_of_base', `${prId}: ${ancestor.detail}`);
        ok = false;
      }
    }
  }

  if (handoff.head_sha === null) {
    note(
      'head_sha_pending',
      'unresolved',
      'head_sha is null (pending-head transport); the controller records the committed head later. A future commit cannot contain its own hash.'
    );
  } else if (typeof handoff.head_sha === 'string' && !gitUnavailable) {
    const headExists = gitCommitExists(handoff.head_sha, repoRoot);
    if (headExists.unavailable) {
      markUnavailable();
    } else if (!headExists.ok) {
      fail('git_commit_binding', 'head_sha_not_local_commit', headExists.detail);
      ok = false;
    } else if (handoff.head_sha !== handoff.base_sha) {
      const baseAncestorOfHead = gitIsAncestor(handoff.base_sha, handoff.head_sha, repoRoot);
      if (baseAncestorOfHead.unavailable) {
        markUnavailable();
      } else if (!baseAncestorOfHead.ok) {
        fail(
          'git_commit_binding',
          'head_sha_not_descendant_of_base',
          `base ${handoff.base_sha} is not an ancestor of head ${handoff.head_sha}`
        );
        ok = false;
      }
    }
  }

  if (ok) {
    markCheck(
      'git_commit_binding',
      'passed',
      handoff.head_sha === null
        ? 'base is a local commit, every dependency SHA is a local ancestor of it, and head_sha is pending'
        : 'base, head and every dependency SHA are local commits with base ancestry'
    );
  }
}

/**
 * Validate one handoff packet.
 *
 * @param {string} handoffPath path to the handoff JSON (repository-relative or absolute inside the repo)
 * @param {{repoRoot?: string}} [options]
 * @returns {Promise<object>} typed, actionable report
 */
export async function checkHandoff(handoffPath, options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? REPO_ROOT);
  const reporter = createReporter();
  const state = {
    handoffRel: null,
    inputSha: null,
    handoff: null,
    authoritySource: null,
    authorities: { task_binding: null, execution_ledger: null },
    nonPassResults: [],
    unresolvedClaims: [],
    failuresAndSkipped: [],
    headShaPending: null
  };

  const finalize = () => {
    const ok = reporter.findings.length === 0;
    return {
      format: FORMAT,
      tool: 'scripts/research-program/check-handoff.mjs',
      ok,
      outcome: ok ? 'accepted' : 'rejected',
      handoff: {
        path: state.handoffRel,
        sha256: state.inputSha,
        pr_id: state.handoff?.pr_id ?? null,
        advertised_status: state.handoff?.status ?? null
      },
      authorities: state.authorities,
      binding_source: state.authoritySource,
      checks: reporter.checks(),
      findings: reporter.findings,
      notes: reporter.notes,
      preserved_outcomes: {
        non_pass_acceptance_results: state.nonPassResults,
        declared_unresolved_claims: state.unresolvedClaims,
        declared_failures_and_skipped_checks: state.failuresAndSkipped,
        head_sha_pending: state.headShaPending
      },
      independent_review: {
        status: 'not_claimed',
        detail:
          'Producer-side packet validation only. A passing packet is complete and evidence-bound; it is not independent verification or scientific acceptance.'
      }
    };
  };

  if (typeof handoffPath !== 'string' || handoffPath.trim() === '') {
    throw new HandoffToolError('exactly one handoff JSON path is required');
  }

  // 1. Input path containment (lexical, then symlink-resolved).
  const inputAbs = path.isAbsolute(handoffPath)
    ? path.resolve(handoffPath)
    : path.resolve(repoRoot, handoffPath);
  const lexical = resolveContainedPath(repoRoot, path.relative(repoRoot, inputAbs));
  if (!lexical.ok) {
    reporter.fail(
      'input_path_containment',
      'handoff_path_out_of_containment',
      `${handoffPath}: ${lexical.detail}`
    );
    return finalize();
  }
  state.handoffRel = lexical.relative;

  if (!(await existsAsFile(inputAbs))) {
    reporter.fail('handoff_readable', 'handoff_missing', `${state.handoffRel} does not exist as a regular file`);
    return finalize();
  }

  let realRoot;
  let realInput;
  try {
    realRoot = await realpath(repoRoot);
    realInput = await realpath(inputAbs);
  } catch (error) {
    reporter.fail('handoff_readable', 'handoff_unreadable', `cannot resolve ${state.handoffRel}: ${error.message}`);
    return finalize();
  }
  if (!isWithin(realRoot, realInput)) {
    reporter.fail(
      'input_path_containment',
      'handoff_path_escapes_root_via_symlink',
      `${state.handoffRel} resolves outside the repository root`
    );
    return finalize();
  }
  reporter.markCheck('input_path_containment', 'passed', `${state.handoffRel} stays inside the repository root`);

  // 2. Read and parse.
  let handoff;
  try {
    const buffer = await readFile(realInput);
    state.inputSha = sha256Buffer(buffer);
    handoff = JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    reporter.fail('handoff_readable', 'handoff_invalid_json', `cannot parse ${state.handoffRel}: ${error.message}`);
    return finalize();
  }
  state.handoff = handoff;
  reporter.markCheck('handoff_readable', 'passed', `${state.handoffRel} parsed as JSON`);

  // 3. Schema validation (structural half).
  let validators;
  try {
    validators = await loadValidators();
  } catch (error) {
    reporter.fail('handoff_schema', 'validator_dependency_unavailable', error.message);
    return finalize();
  }
  if (!validators.validateHandoff(handoff)) {
    for (const message of formatAjvErrors(validators.validateHandoff)) {
      reporter.fail('handoff_schema', 'schema_invalid', message);
    }
  } else {
    reporter.markCheck('handoff_schema', 'passed', 'handoff.schema.json (Ajv 2020-12) accepted the packet');
  }

  if (!isStructurallySafeHandoff(handoff)) {
    if (reporter.findings.every(finding => finding.rule !== 'schema_invalid')) {
      reporter.fail(
        'handoff_schema',
        'schema_invalid',
        'top-level JSON value is not a structurally safe handoff object'
      );
    }
    return finalize();
  }

  // 4. Preserve typed outcomes before any coercion can happen.
  const acceptanceResults = Array.isArray(handoff.acceptance_results) ? handoff.acceptance_results : [];
  state.nonPassResults = acceptanceResults
    .filter(result => !SUCCESS_ACCEPTANCE_STATES.has(result.status))
    .map(result => ({ id: result.id, status: result.status }));
  state.unresolvedClaims = (handoff.unresolved_claims ?? []).map(claim => ({
    id: claim.id,
    status: claim.status
  }));
  state.failuresAndSkipped = (handoff.failures_and_skipped_checks ?? []).map(entry => ({
    id: entry.id,
    status: entry.status
  }));
  state.headShaPending = handoff.head_sha === null;

  // 5. Authoritative task binding / ledger / per-PR lookup.
  const handoffDir = path.dirname(realInput);
  const { authorities, effective, source, taskRecord } = await resolveAuthorities(
    handoff,
    handoffDir,
    repoRoot,
    reporter,
    validators
  );
  state.authorities = authorities;
  state.authoritySource = source;
  if (authorities.task_binding) {
    reporter.note(
      'task_binding_authority',
      'bound',
      `concrete task binding from ${authorities.task_binding.source} at ${authorities.task_binding.path} (sha256 ${authorities.task_binding.sha256}); this producer-written file does not authenticate itself and does not replace controller dispatch review`
    );
  }

  // 6. Dependency/base matching, uniqueness, evidence minima and cross-reference rules.
  evaluateDependencyBinding(handoff, effective, reporter);
  evaluateTaskScope(handoff, taskRecord, reporter);
  evaluatePacketEvidence(handoff, reporter);
  const { commands, artifacts } = evaluateIdentifierUniqueness(handoff, reporter);
  evaluateCrossReferences(handoff, commands, artifacts, reporter);

  // 7. On-disk existence, containment and SHA-256 binding (including event-source).
  await evaluateArtifacts(collectDeclaredArtifacts(handoff), repoRoot, realRoot, reporter);
  await evaluateSourceIdentities(handoff, repoRoot, realRoot, reporter);
  await evaluateChangedFiles(handoff, repoRoot, realRoot, reporter);

  // 8. Local Git existence/ancestry for base, dependency and non-null head SHAs.
  evaluateGitBinding(handoff, repoRoot, reporter);

  return finalize();
}

function printUsage(stream) {
  stream.write(
    'usage: node scripts/research-program/check-handoff.mjs <handoff.json>\n' +
      '  Validates one handoff packet: path containment, file existence, SHA-256\n' +
      '  binding, dependency/base SHA matching, owner/branch/owned-path scope,\n' +
      '  structured command outcomes, unique IDs, event-source artifacts and Git\n' +
      '  object binding. Exit 0 accepted, 1 rejected, 2 usage/operational error.\n'
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    printUsage(process.stdout);
    process.exit(0);
  }
  if (args.length !== 1) {
    printUsage(process.stderr);
    process.exit(2);
  }

  try {
    const report = await checkHandoff(args[0]);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(report.ok ? 0 : 1);
  } catch (error) {
    const report = {
      format: FORMAT,
      tool: 'scripts/research-program/check-handoff.mjs',
      ok: false,
      outcome: 'error',
      findings: [
        {
          rule: 'validator_operational_error',
          severity: 'error',
          detail: error instanceof Error ? error.message : String(error)
        }
      ]
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(2);
  }
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (invokedDirectly) {
  main();
}
