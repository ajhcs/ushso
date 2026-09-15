import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  ADVANCED_MINIMUM,
  LAST_GOOD_GENERATION,
  NOVICE_MINIMUM,
  loadFrozenHumanTasks,
  scoreUsability,
} from './score.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('protocol freezes eight novice and eight advanced slots against opaque human tasks; clicking through is not completion', () => {
  const protocol = JSON.parse(fs.readFileSync(path.join(ROOT, 'evaluation/research-program/usability/protocol.json'), 'utf8'));
  const assignments = JSON.parse(fs.readFileSync(path.join(ROOT, 'evaluation/research-program/usability/assignments.json'), 'utf8'));
  const frozen = loadFrozenHumanTasks();
  assert.equal(protocol.frozen_before_sessions, true);
  assert.equal(protocol.success_criteria.clicking_through_a_page_is_not_completion, true);
  assert.equal(protocol.human_participants_separate_from_agent_simulations, true);
  assert.equal(protocol.non_phi_notes.protected_research_data_required, false);
  assert.equal(assignments.novice_slots.length, NOVICE_MINIMUM);
  assert.equal(assignments.advanced_slots.length, ADVANCED_MINIMUM);
  assert.ok(assignments.novice_slots.every((row) => frozen.novice.includes(row.task_id)));
  assert.ok(assignments.advanced_slots.every((row) => frozen.advanced.includes(row.task_id)));
  assert.ok(assignments.novice_slots.every((row) => !frozen.machine.includes(row.task_id)));
  assert.equal(assignments.invented_participants, false);
  assert.equal(assignments.generated_participants, false);
  assert.equal(assignments.implementer_self_tests, false);
  assert.ok(assignments.novice_slots.every((row) => row.participant_id === null && row.session_status === 'untested'));
  assert.ok(assignments.advanced_slots.every((row) => row.participant_id === null && row.session_status === 'untested'));
});

test('unavailable participants keep R12 unverified; missing assigned opportunities are non-completions', () => {
  const score = scoreUsability();
  assert.equal(score.generation, LAST_GOOD_GENERATION);
  assert.equal(score.r12.accepted, false);
  assert.equal(score.r12.result, 'unverified');
  assert.equal(score.r12.participants_unavailable, true);
  assert.equal(score.r12.implementer_self_tests_cannot_satisfy, true);
  assert.equal(score.r12.simulations_do_not_count, true);
  assert.equal(score.r12.novice.actual_participants, 0);
  assert.equal(score.r12.advanced.actual_participants, 0);
  assert.equal(score.r12.novice.assigned_opportunities, 8);
  assert.equal(score.r12.advanced.assigned_opportunities, 8);
  assert.equal(score.r12.novice.completed, 0);
  assert.equal(score.r12.advanced.completed, 0);
  assert.equal(score.r12.novice.missing_or_untested, 8);
  assert.equal(score.r12.advanced.missing_or_untested, 8);
  assert.equal(score.r12.novice.completion_ratio, 0);
  assert.equal(score.r12.advanced.completion_ratio, 0);
  assert.equal(score.r12.novice.pass_participants, false);
  assert.equal(score.r12.advanced.pass_participants, false);
  assert.equal(score.r13.accepted, false);
  assert.equal(score.c0091, 'unresolved');
  assert.equal(score.clicking_through_a_page_is_not_completion, true);
});

test('generated participants and implementer self-tests cannot satisfy R12', () => {
  const assignments = JSON.parse(fs.readFileSync(path.join(ROOT, 'evaluation/research-program/usability/assignments.json'), 'utf8'));
  assert.throws(() => scoreUsability({ assignments: { ...assignments, generated_participants: true } }), { code: 'GENERATED_PARTICIPANTS_FORBIDDEN' });
  assert.throws(() => scoreUsability({ assignments: { ...assignments, implementer_self_tests: true } }), { code: 'IMPLEMENTER_SELF_TESTS_CANNOT_SATISFY_R12' });
});
