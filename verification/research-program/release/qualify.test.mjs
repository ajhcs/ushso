import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CAPTURED_HEAD, CAPTURED_TREE, LAST_GOOD_GENERATION, qualifyRelease } from './qualify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('captured candidate is pinned; skipped checks are not passes; rebuild creates a new candidate', () => {
  const q = qualifyRelease();
  assert.equal(q.generation, LAST_GOOD_GENERATION);
  assert.equal(q.captured_candidate.head_sha, CAPTURED_HEAD);
  assert.equal(q.captured_candidate.tree_sha, CAPTURED_TREE);
  assert.equal(q.captured_candidate.copied_into_git, false);
  assert.equal(q.captured_candidate.rebuild_creates_new_candidate, true);
  assert.equal(q.captured_candidate.old_approvals_cannot_be_copied_onto_changed_bytes, true);
  assert.equal(q.skipped_checks_are_not_passes, true);
  assert.ok(q.skipped.every((row) => row.skipped === true && row.pass === false));
  assert.equal(q.staging.deployed, false);
  assert.equal(q.staging.authorized, false);
});

test('unresolved C-009-1 and missing witnesses reject R16; merged engineering is not full acceptance', () => {
  const q = qualifyRelease();
  assert.equal(q.c0091.status, 'unresolved');
  assert.equal(q.c0091.measured_cheapest_new_topology, null);
  assert.equal(q.c0091.rejected_as_full_acceptance, true);
  assert.equal(q.r16.accepted, false);
  assert.equal(q.r16.result, 'fail');
  assert.equal(q.requirements.find((row) => row.id === 'R16').result, 'fail');
  assert.equal(q.release_qualified, false);
  assert.equal(q.proceeds_to_production, false);
  assert.equal(q.public_traffic_changed, false);
  assert.equal(q.paid_resource_changed, false);
  assert.equal(q.secret_changed, false);
  assert.equal(q.production_changed, false);
  assert.equal(q.requirements.length, 16);
  assert.ok(q.requirements.every((row) => row.accepted === false));
  const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'verification/research-program/release/qualification.json'), 'utf8'));
  assert.equal(onDisk.release_qualified, false);
  assert.equal(onDisk.r16.result, 'fail');
});
