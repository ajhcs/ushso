import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assembleAcceptanceIndex, LAST_GOOD_GENERATION, REVIEW_AUTHORITY } from './assemble-index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('requirement and finding outcomes stay open when witnesses are missing or requirements fail', () => {
  const index = assembleAcceptanceIndex();
  assert.equal(index.generation, LAST_GOOD_GENERATION);
  assert.equal(index.requirements.length, 16);
  assert.equal(index.findings.length, 33);
  assert.ok(index.requirements.every((row) => row.accepted === false && row.closed === false && row.missing_witness_keeps_open === true));
  assert.ok(index.findings.every((row) => row.closed === false && row.no_longer_reproduces === false));
  assert.equal(index.requirements.find((row) => row.id === 'R03').result, 'fail');
  assert.equal(index.requirements.find((row) => row.id === 'R08').result, 'fail');
  assert.equal(index.requirements.find((row) => row.id === 'R12').result, 'unverified');
  assert.equal(index.requirements.find((row) => row.id === 'R15').result, 'fail');
  assert.equal(index.requirements.find((row) => row.id === 'R16').result, 'unverified');
  assert.equal(index.findings.find((row) => row.id === 'F25').status, 'open');
  assert.equal(index.findings.find((row) => row.id === 'F31').status, 'open');
  assert.ok(index.findings.find((row) => row.id === 'F31').remaining_limitation.includes('historical'));
});

test('review cannot grant owner authority or send an incomplete candidate to release preparation', () => {
  const index = assembleAcceptanceIndex();
  assert.equal(REVIEW_AUTHORITY.can_grant_owner_authority, false);
  assert.equal(index.owner_authority_granted_by_this_review, false);
  assert.equal(index.fully_evidenced_candidate, false);
  assert.equal(index.proceeds_to_release_preparation, false);
  assert.equal(index.readiness_is_not_commit_count, true);
  assert.deepEqual(index.planned_remaining, []);
  assert.equal(index.c0091, 'unresolved');
  assert.equal(index.production_spend_decisions.separate_from_this_review, true);
  assert.equal(index.production_spend_decisions.production_changed, false);
  const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'verification/research-program/acceptance/index.json'), 'utf8'));
  assert.equal(onDisk.proceeds_to_release_preparation, false);
  assert.equal(onDisk.requirements.length, 16);
  assert.equal(onDisk.findings.length, 33);
});


test('planning status follows the supplied ledger without converting integration into acceptance', () => {
  const tasks = ['PR-082', 'PR-083', 'PR-084'].map((pr_id) => ({pr_id, status: 'planned'}));
  const planned = assembleAcceptanceIndex({ledger: {tasks}});
  assert.deepEqual(planned.planned_remaining, ['PR-082', 'PR-083', 'PR-084']);
  const integrated = assembleAcceptanceIndex({ledger: {tasks: tasks.map((row) => ({...row, status: 'integrated'}))}});
  assert.deepEqual(integrated.planned_remaining, []);
  assert.equal(integrated.integrated_pr_count, 3);
  assert.equal(integrated.fully_evidenced_candidate, false);
  assert.ok(integrated.requirements.every((row) => row.accepted === false));
});
