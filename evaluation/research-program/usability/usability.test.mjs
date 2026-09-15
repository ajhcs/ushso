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

// Synthetic records below exercise validation only; they are not acceptance witnesses.
function syntheticSessions() {
  const assignments = JSON.parse(fs.readFileSync(path.join(ROOT, 'evaluation/research-program/usability/assignments.json'), 'utf8'));
  const sessions = { consented_sessions: [], critical_misinterpretations: [] };
  for (const group of ['novice_slots', 'advanced_slots']) {
    for (const row of assignments[group]) {
      Object.assign(row, { participant_id: `synthetic-${row.slot_id}`, distinct_from_implementers: true,
        session_id: `synthetic-session-${row.slot_id}`, session_status: 'completed', completed: true });
      sessions.consented_sessions.push({ ...row, generation: LAST_GOOD_GENERATION, consented: true,
        simulated: false, evidence_reference: 'fixture-only://validation', evidence_sha256: 'a'.repeat(64) });
    }
  }
  return { assignments, sessions };
}

test('assignment IDs and completion flags cannot replace consented session evidence', () => {
  const fixture = syntheticSessions();
  fixture.sessions.consented_sessions = [];
  const score = scoreUsability(fixture);
  for (const group of ['novice', 'advanced']) {
    assert.equal(score.r12[group].actual_participants, 0);
    assert.equal(score.r12[group].completed, 0);
    assert.equal(score.r12[group].missing_or_untested, 8);
    assert.equal(score.r12[group].pass_completion, false);
  }
});

test('only explicitly consented, distinct, bound sessions contribute to metrics, never acceptance', () => {
  const fixture = syntheticSessions();
  const scored = scoreUsability(fixture);
  assert.equal(scored.r12.novice.actual_participants, 8);
  assert.equal(scored.r12.novice.completed, 8);
  assert.equal(scored.r12.accepted, false);
  assert.equal(scored.r12.advanced.actual_participants, 8);
  for (const patch of [
    {consented: false}, {distinct_from_implementers: null}, {simulated: true},
    {generation: 'retired'}, {task_id: 'T-unknown'}, {slot_id: 'other'},
    {participant_id: 'other'}, {evidence_reference: ''}, {evidence_sha256: ''},
  ]) {
    const changed = syntheticSessions();
    Object.assign(changed.sessions.consented_sessions[0], patch);
    const result = scoreUsability(changed).r12.novice;
    assert.equal(result.actual_participants, 7, JSON.stringify(patch));
    assert.equal(result.completed, 7);
    assert.equal(result.pass_participants, false);
  }
  const incomplete = syntheticSessions();
  incomplete.sessions.consented_sessions[0].completed = false;
  assert.equal(scoreUsability(incomplete).r12.novice.completed, 7);
});

test('duplicate evidence and overlapping participant groups cannot satisfy 8+8', () => {
  const duplicate = syntheticSessions();
  duplicate.sessions.consented_sessions.push(duplicate.sessions.consented_sessions[0]);
  assert.throws(() => scoreUsability(duplicate), {code: 'DUPLICATE_OR_MISSING_EVIDENCE_ID'});
  const overlap = syntheticSessions();
  overlap.assignments.advanced_slots[0].participant_id = overlap.assignments.novice_slots[0].participant_id;
  assert.throws(() => scoreUsability(overlap), {code: 'PARTICIPANT_IN_BOTH_GROUPS'});
  const reused = syntheticSessions();
  reused.assignments.novice_slots[1].session_id = reused.assignments.novice_slots[0].session_id;
  assert.throws(() => scoreUsability(reused), {code: 'SESSION_REUSED'});
  const stale = syntheticSessions();
  stale.assignments.generation = 'retired';
  assert.throws(() => scoreUsability(stale), {code: 'USABILITY_GENERATION_MISMATCH'});
});
