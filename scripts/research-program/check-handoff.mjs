#!/usr/bin/env node
// PR-003 slice C-003-2 — bounded handoff-packet validator.
//
// Usage:
//   node scripts/research-program/check-handoff.mjs <handoff.json>
//
// It accepts exactly one handoff JSON path and then enforces:
//   * path containment for the handoff, every artifact, every source identity
//     and every changed file (lexical and symlink-resolved, always inside the
//     repository root);
//   * file existence for every referenced local artifact and source identity;
//   * SHA-256 (and byte-length, when declared) binding for every artifact and
//     every repository-path source identity;
//   * dependency SHA matching against the committed task binding (a sibling
//     task-binding.json, when present) and the committed execution ledger;
//   * local Git commit existence and dependency ancestry for base/dependency
//     SHAs — never an invented commit;
//   * the C-003-1 cross-reference rules: a claimed success needs a resolvable
//     command result, artifact references must resolve, and success is never
//     inferred from missing, stale, blocked, unavailable or unresolved data.
//
// Exit codes: 0 accepted, 1 rejected, 2 usage/operational error.
// The validator is read-only: it writes no files and changes no repository
// state. `ok:true` means the packet is complete and evidence-bound, not that
// the work is independently verified.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repository root, derived from this script's location. */
export const REPO_ROOT = path.resolve(HERE, '..', '..');

export const FORMAT = 'ushso.pr003.c003-2.handoff-check.v1';

/** Acceptance states that assert success and therefore require a command result. */
export const SUCCESS_ACCEPTANCE_STATES = new Set([
  'passed',
  'producer_checked',
  'independently_verified'
]);

const SCHEMA_DIR = path.join(REPO_ROOT, 'docs', 'research-program', 'handoffs', 'schema');
const LEDGER_PATH = path.join(REPO_ROOT, 'docs', 'research-program', 'execution-ledger.json');

/** Stable check order for the typed report. */
const CHECK_ORDER = [
  'input_path_containment',
  'handoff_readable',
  'handoff_schema',
  'task_binding',
  'dependency_sha_binding',
  'base_sha_binding',
  'git_commit_binding',
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

/**
 * Resolve the authoritative task/binding records for a handoff.
 *
 * Precedence and cross-checks:
 *   1. a sibling `task-binding.json` next to the handoff (validated against
 *      task.schema.json) supplies the exact base SHA and dependency SHAs;
 *   2. the committed `docs/research-program/execution-ledger.json` supplies the
 *      dependency SHAs for the handoff's PR id (the protocol's dependency
 *      pointer store);
 *   3. when both exist they must agree, otherwise `binding_conflict`.
 */
async function resolveAuthorities(handoff, handoffDir, repoRoot, reporter, validators) {
  const { fail, markCheck, note } = reporter;
  const authorities = {
    task_binding: null,
    execution_ledger: null
  };

  const siblingCandidate = path.join(handoffDir, 'task-binding.json');
  let sibling = null;
  if (await existsAsFile(siblingCandidate)) {
    try {
      const { value, sha256 } = await loadJsonWithSha(siblingCandidate);
      authorities.task_binding = {
        source: 'sibling-task-binding',
        path: reportPath(repoRoot, siblingCandidate),
        sha256
      };
      if (!validators.validateTask(value)) {
        fail(
          'task_binding',
          'task_binding_invalid',
          `task-binding.json failed task.schema.json: ${formatAjvErrors(validators.validateTask).join('; ')}`
        );
      } else if (value.pr_id !== handoff.pr_id) {
        fail(
          'task_binding',
          'task_binding_pr_mismatch',
          `task binding is for ${value.pr_id} but the handoff is ${handoff.pr_id}`
        );
      } else {
        sibling = value;
      }
    } catch (error) {
      fail('task_binding', 'task_binding_unreadable', `cannot read task-binding.json: ${error.message}`);
    }
  }

  let ledgerTask = null;
  if (await existsAsFile(LEDGER_PATH)) {
    try {
      const { value, sha256 } = await loadJsonWithSha(LEDGER_PATH);
      const tasks = Array.isArray(value.tasks) ? value.tasks : [];
      ledgerTask = tasks.find(task => task.pr_id === handoff.pr_id) ?? null;
      authorities.execution_ledger = {
        path: reportPath(repoRoot, LEDGER_PATH),
        sha256,
        task_found: ledgerTask !== null
      };
      if (!ledgerTask) {
        fail(
          'task_binding',
          'unknown_pr_in_execution_ledger',
          `execution ledger has no task for ${handoff.pr_id}`
        );
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

  const siblingDeps = sibling?.binding?.dependency_merge_shas ?? null;
  const ledgerDeps = ledgerTask?.dependency_merge_shas ?? null;
  if (siblingDeps && ledgerDeps) {
    if (
      JSON.stringify(sortedDependencyEntries(siblingDeps)) !==
      JSON.stringify(sortedDependencyEntries(ledgerDeps))
    ) {
      fail(
        'dependency_sha_binding',
        'binding_conflict',
        'sibling task-binding.json and the execution ledger disagree on dependency_merge_shas'
      );
    }
  }

  let effective = null;
  let source = null;
  if (sibling?.binding) {
    effective = sibling.binding;
    source = 'sibling-task-binding';
  } else if (ledgerDeps) {
    effective = { base_sha: null, dependency_merge_shas: ledgerDeps };
    source = 'execution-ledger';
  }

  if (!effective) {
    fail(
      'task_binding',
      'task_binding_missing',
      'no sibling task-binding.json and no matching execution-ledger task could bind the handoff'
    );
  } else {
    markCheck('task_binding', 'passed', `handoff bound using ${source}`);
  }

  return { authorities, effective, source };
}

async function evaluateArtifacts(handoff, repoRoot, realRoot, reporter) {
  const { fail, markCheck } = reporter;
  let pathOk = true;
  let existenceOk = true;
  let hashOk = true;

  for (const artifact of handoff.artifacts ?? []) {
    const contained = resolveContainedPath(repoRoot, artifact.path);
    if (!contained.ok) {
      fail(
        'artifact_path_containment',
        'artifact_path_not_contained',
        `${artifact.id} (${artifact.path}): ${contained.detail}`
      );
      pathOk = false;
      continue;
    }

    let real;
    try {
      real = await realpath(contained.absolute);
    } catch (error) {
      fail(
        'artifact_file_existence',
        'artifact_missing_on_disk',
        `${artifact.id} (${artifact.path}): ${error.code ?? 'not found'}`
      );
      existenceOk = false;
      continue;
    }

    if (!isWithin(realRoot, real)) {
      fail(
        'artifact_path_containment',
        'artifact_path_escapes_root_via_symlink',
        `${artifact.id} (${artifact.path}) resolves outside the repository root`
      );
      pathOk = false;
      continue;
    }

    const info = await stat(real);
    if (!info.isFile()) {
      fail(
        'artifact_file_existence',
        'artifact_not_regular_file',
        `${artifact.id} (${artifact.path}) is not a regular file`
      );
      existenceOk = false;
      continue;
    }

    const buffer = await readFile(real);
    const digest = sha256Buffer(buffer);
    if (digest !== artifact.sha256) {
      fail(
        'artifact_sha256_binding',
        'artifact_hash_mismatch',
        `${artifact.id} (${artifact.path}) expected ${artifact.sha256} got ${digest}`
      );
      hashOk = false;
    } else if (typeof artifact.bytes === 'number' && artifact.bytes !== buffer.length) {
      fail(
        'artifact_sha256_binding',
        'artifact_byte_mismatch',
        `${artifact.id} (${artifact.path}) expected ${artifact.bytes} bytes got ${buffer.length}`
      );
      hashOk = false;
    }
  }

  if (pathOk) markCheck('artifact_path_containment', 'passed', 'all artifact paths stay inside the repository root');
  if (existenceOk) markCheck('artifact_file_existence', 'passed', 'all referenced artifacts exist as regular files');
  if (hashOk) markCheck('artifact_sha256_binding', 'passed', 'all declared artifact SHA-256 (and byte) bindings match on-disk bytes');
}

async function evaluateSourceIdentities(handoff, repoRoot, reporter) {
  const { fail, markCheck, note } = reporter;
  let sourceOk = true;
  let checked = 0;

  for (const identity of handoff.source_identities ?? []) {
    if (typeof identity.sha256 !== 'string') continue;
    const looksLikeRepositoryPath = identity.id.includes('/') || identity.id.startsWith('.');
    if (!looksLikeRepositoryPath) {
      note(
        'external_source_identity',
        'external',
        `source identity ${identity.id} is not a repository path, so its declared SHA-256 is not locally verifiable`
      );
      continue;
    }
    checked += 1;
    const contained = resolveContainedPath(repoRoot, identity.id);
    if (!contained.ok) {
      fail(
        'source_identity_binding',
        'source_identity_path_not_contained',
        `${identity.id}: ${contained.detail}`
      );
      sourceOk = false;
      continue;
    }
    try {
      const digest = await sha256File(contained.absolute);
      if (digest !== identity.sha256) {
        fail(
          'source_identity_binding',
          'stale_source_identity_sha',
          `${identity.id} expected ${identity.sha256} got ${digest}`
        );
        sourceOk = false;
      }
    } catch (error) {
      fail(
        'source_identity_binding',
        'source_identity_missing_on_disk',
        `${identity.id}: ${error.code ?? 'not found'}`
      );
      sourceOk = false;
    }
  }

  if (sourceOk) {
    markCheck(
      'source_identity_binding',
      checked > 0 ? 'passed' : 'not_applicable',
      checked > 0
        ? `${checked} repository-path source identity hash(es) match on-disk bytes`
        : 'no repository-path source identity with a declared hash'
    );
  }
}

async function evaluateChangedFiles(handoff, repoRoot, reporter) {
  const { fail, markCheck, note } = reporter;
  let ok = true;

  for (const changed of handoff.changed_files ?? []) {
    const contained = resolveContainedPath(repoRoot, changed);
    if (!contained.ok) {
      fail('changed_file_containment', 'changed_file_path_not_contained', `${changed}: ${contained.detail}`);
      ok = false;
      continue;
    }
    if (!(await existsAsFile(contained.absolute))) {
      note(
        'changed_file_not_present',
        'unresolved',
        `${changed} is recorded as changed but is not present on disk (a deletion is valid; surface it to the reviewer)`
      );
    }
  }

  if (ok) markCheck('changed_file_containment', 'passed', 'all changed-file records are repository-contained');
}

function evaluateCrossReferences(handoff, reporter) {
  const { fail, markCheck } = reporter;
  const commands = new Map((handoff.commands ?? []).map(entry => [entry.id, entry]));
  const artifacts = new Map((handoff.artifacts ?? []).map(entry => [entry.id, entry]));
  let commandOk = true;
  let artifactOk = true;

  for (const result of handoff.acceptance_results ?? []) {
    const commandIds = result.command_ids ?? [];
    if (SUCCESS_ACCEPTANCE_STATES.has(result.status)) {
      if (commandIds.length === 0) {
        fail(
          'command_result_resolution',
          'claimed_pass_without_command_result',
          `${result.id} claims ${result.status} with an empty command_ids list`
        );
        commandOk = false;
      }
      for (const commandId of commandIds) {
        const command = commands.get(commandId);
        if (!command) {
          fail(
            'command_result_resolution',
            'claimed_pass_without_command_result',
            `${result.id} references unknown command ${commandId}`
          );
          commandOk = false;
          continue;
        }
        if (typeof command.result !== 'string' || command.result.trim() === '') {
          fail(
            'command_result_resolution',
            'claimed_pass_without_command_result',
            `${result.id} command ${commandId} has no result`
          );
          commandOk = false;
        }
      }
    } else {
      for (const commandId of commandIds) {
        if (!commands.has(commandId)) {
          fail(
            'command_result_resolution',
            'unresolved_command_reference',
            `${result.id} (${result.status}) references unknown command ${commandId}`
          );
          commandOk = false;
        }
      }
    }

    for (const artifactId of result.artifact_ids ?? []) {
      if (!artifacts.has(artifactId)) {
        fail(
          'artifact_reference_resolution',
          'missing_artifact',
          `${result.id} references unknown artifact ${artifactId}`
        );
        artifactOk = false;
      }
    }
  }

  if (commandOk) markCheck('command_result_resolution', 'passed', 'every success claim resolves to a command with a non-empty result');
  if (artifactOk) markCheck('artifact_reference_resolution', 'passed', 'every referenced artifact id resolves');
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
    markCheck(
      'base_sha_binding',
      'not_applicable',
      'the resolved authority has no base SHA; base is verified only as a local commit'
    );
    reporter.note(
      'base_sha_unbound_to_task_binding',
      'unresolved',
      'no task binding supplied an expected base SHA, so exact base matching did not run'
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

  if (ok) {
    markCheck(
      'git_commit_binding',
      'passed',
      'base is a local commit and every dependency SHA is a local ancestor of it'
    );
  }
  if (handoff.head_sha === null) {
    note(
      'head_sha_pending',
      'unresolved',
      'head_sha is null (one-shot slice); the controller records the committed head later'
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
          'Producer-side packet validation only. A passing packet is complete and evidence-bound; it is not independent verification.'
      }
    };
  };

  if (typeof handoffPath !== 'string' || handoffPath.trim() === '') {
    throw new HandoffToolError('exactly one handoff JSON path is required');
  }

  // 1. Input path containment (lexical, then symlink-resolved).
  const inputAbs = path.resolve(process.cwd(), handoffPath);
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

  // 5. Authoritative task binding / ledger.
  const handoffDir = path.dirname(realInput);
  const { authorities, effective, source } = await resolveAuthorities(
    handoff,
    handoffDir,
    repoRoot,
    reporter,
    validators
  );
  state.authorities = authorities;
  state.authoritySource = source;

  // 6. Dependency/base matching and cross-reference rules.
  evaluateDependencyBinding(handoff, effective, reporter);
  evaluateCrossReferences(handoff, reporter);

  // 7. On-disk existence, containment and SHA-256 binding.
  await evaluateArtifacts(handoff, repoRoot, realRoot, reporter);
  await evaluateSourceIdentities(handoff, repoRoot, reporter);
  await evaluateChangedFiles(handoff, repoRoot, reporter);

  // 8. Local Git existence/ancestry for base and dependency SHAs.
  evaluateGitBinding(handoff, repoRoot, reporter);

  return finalize();
}

function printUsage(stream) {
  stream.write(
    'usage: node scripts/research-program/check-handoff.mjs <handoff.json>\n' +
      '  Validates one handoff packet: path containment, file existence, SHA-256\n' +
      '  binding, dependency SHA matching and command/artifact resolution.\n' +
      '  Exit 0 accepted, 1 rejected, 2 usage/operational error.\n'
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
