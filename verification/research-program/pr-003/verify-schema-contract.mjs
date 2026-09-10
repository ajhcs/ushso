#!/usr/bin/env node
// Bounded schema-contract check for PR-003 slice C-003-1.
//
// This is the local check named by the C-003-1 slice. It is deliberately NOT
// the PR-003 producer validator: C-003-2 implements
// scripts/research-program/check-handoff.mjs, which adds CLI handling, path
// containment, on-disk file existence and SHA-256 re-hashing. This script only
// proves the C-003-1 contract: structural validity against the two JSON
// Schemas via Ajv 2020-12, plus the cross-reference rules that JSON Schema
// alone cannot express (success claim -> command result, artifact reference
// resolution, dependency SHA binding).
//
// It is read-only: it writes no files and mutates no worktree state.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const SCHEMA_DIR = path.join(REPO_ROOT, 'docs', 'research-program', 'handoffs', 'schema');
const FIXTURE_DIR = path.join(HERE, 'fixtures');

/** Acceptance states that assert success and therefore require a command result. */
export const SUCCESS_ACCEPTANCE_STATES = new Set([
  'passed',
  'producer_checked',
  'independently_verified'
]);

export const CASES = [
  { id: 'valid', file: 'handoff.valid.json', expectRejected: false },
  { id: 'valid-expected-negative', file: 'handoff.valid-expected-negative.json', expectRejected: false },
  { id: 'valid-unavailable', file: 'handoff.valid-unavailable.json', expectRejected: false },
  {
    id: 'reject-claimed-pass-without-command',
    file: 'handoff.reject-claimed-pass-without-command.json',
    expectRejected: true,
    expectedReason: /claimed_pass_without_command_result/
  },
  {
    id: 'reject-missing-artifact',
    file: 'handoff.reject-missing-artifact.json',
    expectRejected: true,
    expectedReason: /missing_artifact/
  },
  {
    id: 'reject-stale-dependency-sha',
    file: 'handoff.reject-stale-dependency-sha.json',
    expectRejected: true,
    expectedReason: /stale_dependency_sha/
  },
  {
    id: 'reject-nonzero-success',
    file: 'handoff.reject-nonzero-success.json',
    expectRejected: true,
    expectedReason: /command_outcome_mismatch/
  },
  {
    id: 'reject-duplicate-command',
    file: 'handoff.reject-duplicate-command.json',
    expectRejected: true,
    expectedReason: /duplicate_command_id/
  },
  {
    id: 'reject-empty-evidence',
    file: 'handoff.reject-empty-evidence.json',
    expectRejected: true,
    expectedReason: /minItems/
  },
  {
    id: 'reject-source-hash-omitted',
    file: 'handoff.reject-source-hash-omitted.json',
    expectRejected: true,
    expectedReason: /required/
  }
];

export async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function loadAjv2020() {
  try {
    const mod = await import('ajv/dist/2020.js');
    return mod.default;
  } catch (error) {
    throw new Error(
      'ajv/dist/2020.js is required for the schema contract check ' +
      '(declared by @ushso/observatory-retrieval): ' + error.message
    );
  }
}

function formatAjvErrors(validate) {
  return (validate.errors ?? []).map(
    error => `${error.instancePath || '/'} ${error.keyword} ${error.message}`
  );
}

/**
 * Cross-reference rules JSON Schema cannot express. Returns a list of typed
 * rule failures; an empty list means the handoff is internally consistent with
 * the task binding it claims.
 */
export function crossReferenceErrors(task, handoff) {
  const errors = [];
  if (handoff.pr_id !== task.pr_id) errors.push(`pr_id_mismatch: handoff ${handoff.pr_id} != task ${task.pr_id}`);

  const taskBase = task?.binding?.base_sha;
  if (handoff.base_sha !== taskBase) errors.push(`stale_base_sha: handoff ${handoff.base_sha} != task binding ${taskBase}`);

  const expectedDeps = task?.binding?.dependency_merge_shas ?? {};
  const actualDeps = handoff.dependency_merge_shas ?? {};
  for (const [prId, sha] of Object.entries(actualDeps)) {
    if (!(prId in expectedDeps)) errors.push(`unexpected_dependency: ${prId} not declared by the task binding`);
    else if (expectedDeps[prId] !== sha) errors.push(`stale_dependency_sha: ${prId} expected ${expectedDeps[prId]} got ${sha}`);
  }
  for (const prId of Object.keys(expectedDeps)) {
    if (!(prId in actualDeps)) errors.push(`missing_dependency_sha: ${prId} missing from the handoff`);
  }

  const commands = new Map();
  for (const command of handoff.commands ?? []) {
    if (commands.has(command.id)) errors.push(`duplicate_command_id: ${command.id}`);
    else commands.set(command.id, command);
    const expected = command.expected_outcome;
    const observed = command.observed_outcome;
    if (!expected || !observed) errors.push(`command_outcome_missing: ${command.id}`);
    else if (expected.kind !== observed.kind || (expected.kind === 'observed_exit' && expected.exit_code !== observed.exit_code)) {
      errors.push(`command_outcome_mismatch: ${command.id}`);
    }
  }

  const artifacts = new Map();
  for (const artifact of handoff.artifacts ?? []) {
    if (artifacts.has(artifact.id)) errors.push(`duplicate_artifact_id: ${artifact.id}`);
    else artifacts.set(artifact.id, artifact);
  }
  for (const command of handoff.commands ?? []) {
    const artifact = command.event_source;
    if (!artifact) continue;
    if (artifacts.has(artifact.id)) errors.push(`duplicate_artifact_id: ${artifact.id}`);
    else artifacts.set(artifact.id, artifact);
  }

  for (const result of handoff.acceptance_results ?? []) {
    const commandIds = result.command_ids ?? [];
    if (SUCCESS_ACCEPTANCE_STATES.has(result.status)) {
      if (commandIds.length === 0) errors.push(`claimed_pass_without_command_result: ${result.id} has no command_ids`);
      for (const commandId of commandIds) {
        const command = commands.get(commandId);
        if (!command) {
          errors.push(`claimed_pass_without_command_result: ${result.id} references unknown command ${commandId}`);
          continue;
        }
        const expected = command.expected_outcome;
        const observed = command.observed_outcome;
        if (!expected || !observed) {
          errors.push(`claimed_pass_without_command_result: ${result.id} command ${commandId} has no complete structured outcome`);
        } else if (!['observed_exit', 'unavailable'].includes(observed.kind)) {
          errors.push(`success_claim_backed_by_non_success_outcome: ${result.id} command ${commandId} observed ${observed.kind}`);
        } else if (expected.kind !== observed.kind || (expected.kind === 'observed_exit' && expected.exit_code !== observed.exit_code)) {
          errors.push(`command_outcome_mismatch: ${result.id} command ${commandId}`);
        }
      }
    } else {
      for (const commandId of commandIds) {
        if (!commands.has(commandId)) errors.push(`unresolved_command_reference: ${result.id} references unknown command ${commandId}`);
      }
    }
    for (const artifactId of result.artifact_ids ?? []) {
      if (!artifacts.has(artifactId)) errors.push(`missing_artifact: ${result.id} references unknown artifact ${artifactId}`);
    }
  }
  return errors;
}

async function main() {
  const Ajv2020 = await loadAjv2020();
  const ajv = new Ajv2020({ strict: true, strictSchema: true, strictTypes: true, allErrors: true });

  const taskSchema = await loadJson(path.join(SCHEMA_DIR, 'task.schema.json'));
  const handoffSchema = await loadJson(path.join(SCHEMA_DIR, 'handoff.schema.json'));
  const validateTask = ajv.compile(taskSchema);
  const validateHandoff = ajv.compile(handoffSchema);

  const task = await loadJson(path.join(FIXTURE_DIR, 'task-binding.json'));
  const taskValid = validateTask(task);
  const results = [
    {
      id: 'task-binding',
      fixture: 'verification/research-program/pr-003/fixtures/task-binding.json',
      schema_valid: taskValid,
      schema_errors: formatAjvErrors(validateTask)
    }
  ];

  let ok = taskValid;

  for (const testCase of CASES) {
    const handoff = await loadJson(path.join(FIXTURE_DIR, testCase.file));
    const schemaValid = validateHandoff(handoff);
    const schemaErrors = formatAjvErrors(validateHandoff);
    const semanticErrors = crossReferenceErrors(task, handoff);
    const combined = [...schemaErrors, ...semanticErrors];
    const rejected = !schemaValid || semanticErrors.length > 0;
    const caseOk = testCase.expectRejected
      ? rejected && testCase.expectedReason.test(combined.join('\n'))
      : !rejected;

    ok = ok && caseOk;
    results.push({
      id: testCase.id,
      fixture: `verification/research-program/pr-003/fixtures/${testCase.file}`,
      schema_valid: schemaValid,
      schema_errors: schemaErrors,
      semantic_errors: semanticErrors,
      rejected,
      expected_rejected: testCase.expectRejected,
      case_ok: caseOk
    });
  }

  const report = {
    format: 'ushso.pr003.c003-1.schema-contract-check.v1',
    node: process.version,
    validator: 'ajv/dist/2020.js',
    ok,
    results
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (invokedDirectly) {
  main().catch(error => {
    console.error(`schema-contract check failed to run: ${error.message}`);
    process.exit(2);
  });
}
