#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export const NOVICE_MINIMUM = 8;
export const ADVANCED_MINIMUM = 8;
export const COMPLETION_THRESHOLD = 0.85;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function loadJson(relative) {
  return JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8'));
}

export function loadFrozenHumanTasks(tasks = loadJson('evaluation/research-program/tasks.json')) {
  const novice = tasks.tasks.filter((row) => row.audience === 'novice').map((row) => row.task_id);
  const advanced = tasks.tasks.filter((row) => row.audience === 'advanced').map((row) => row.task_id);
  const machine = tasks.tasks.filter((row) => row.audience === 'machine').map((row) => row.task_id);
  if (novice.length !== 10 || advanced.length !== 17 || machine.length !== 13) fail('FROZEN_TASK_COUNTS_CHANGED');
  if (tasks.tasks.some((row) => row.raw_prompt_included === true || row.gold_labels_included === true)) {
    fail('PRIVATE_LABELS_PUBLISHED');
  }
  return freeze({ novice, advanced, machine });
}

function scoreGroup(slots, allowedTaskIds, { minimum, audience, sessions }) {
  // An assignment is an opportunity, not proof a person attended or completed it.
  const witnessed = slots.filter((slot) => {
    const session = sessions.find((row) => row.session_id === slot.session_id);
    return typeof slot.session_id === 'string' && slot.session_id.trim().length > 0
      && typeof slot.participant_id === 'string' && slot.participant_id.trim().length > 0
      && slot.distinct_from_implementers === true
      && session?.participant_id === slot.participant_id
      && session?.slot_id === slot.slot_id && session?.task_id === slot.task_id
      && session?.audience === audience && session?.generation === LAST_GOOD_GENERATION
      && session?.consented === true && session?.distinct_from_implementers === true
      && session?.simulated === false && session?.session_status === 'completed'
      && typeof session?.evidence_reference === 'string' && session.evidence_reference.trim().length > 0
      && /^[a-f0-9]{64}$/.test(session?.evidence_sha256 ?? '');
  });
  const assigned = slots.length;
  const actualParticipants = new Set(witnessed.map((row) => row.participant_id));
  const implementerSlots = slots.filter((row) => row.distinct_from_implementers === false);
  const completed = witnessed.filter((row) => row.session_status === 'completed' && row.completed === true
    && sessions.find((session) => session.session_id === row.session_id)?.completed === true).length;
  const missingOrUntested = assigned - completed;
  if (slots.some((row) => !allowedTaskIds.includes(row.task_id))) fail('ASSIGNMENT_NOT_IN_FROZEN_HUMAN_TASKS', audience);
  if (slots.some((row) => row.session_status === 'completed' && !row.participant_id)) fail('COMPLETED_WITHOUT_PARTICIPANT');
  const ratio = assigned === 0 ? 0 : completed / assigned;
  const actualCount = actualParticipants.size;
  const passParticipants = actualCount >= minimum && implementerSlots.length === 0;
  const passCompletion = passParticipants && ratio >= COMPLETION_THRESHOLD && missingOrUntested === assigned - completed;
  return freeze({
    audience,
    assigned_opportunities: assigned,
    completed,
    missing_or_untested: missingOrUntested,
    completion_ratio: ratio,
    actual_participants: actualCount,
    participant_minimum: minimum,
    implementer_slots: implementerSlots.length,
    simulations_counted: false,
    pass_participants: passParticipants,
    pass_completion: passCompletion,
  });
}

export function scoreUsability({
  protocol = loadJson('evaluation/research-program/usability/protocol.json'),
  assignments = loadJson('evaluation/research-program/usability/assignments.json'),
  sessions = loadJson('evaluation/research-program/usability/sessions.json'),
  tasks = loadJson('evaluation/research-program/tasks.json'),
} = {}) {
  if (protocol.frozen_before_sessions !== true) fail('PROTOCOL_NOT_FROZEN_BEFORE_SESSIONS');
  if (assignments.invented_participants === true || assignments.generated_participants === true) fail('GENERATED_PARTICIPANTS_FORBIDDEN');
  if (assignments.implementer_self_tests === true) fail('IMPLEMENTER_SELF_TESTS_CANNOT_SATISFY_R12');
  if (protocol.non_phi_notes.protected_research_data_required === true) fail('PHI_REQUIRED');
  const frozen = loadFrozenHumanTasks(tasks);
  if (assignments.generation !== LAST_GOOD_GENERATION || protocol.generation !== LAST_GOOD_GENERATION) fail('USABILITY_GENERATION_MISMATCH');
  if (assignments.frozen_before_sessions !== true) fail('ASSIGNMENTS_NOT_FROZEN');
  const consented = sessions.consented_sessions;
  if (!Array.isArray(consented)) fail('CONSENTED_SESSIONS_REQUIRED');
  const slots = [...assignments.novice_slots, ...assignments.advanced_slots];
  for (const [rows, key] of [[slots, 'slot_id'], [consented, 'session_id']]) {
    const ids = rows.map((row) => row[key]);
    if (ids.some((id) => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) fail('DUPLICATE_OR_MISSING_EVIDENCE_ID', key);
  }
  const assignedSessions = slots.map((row) => row.session_id).filter((id) => id != null);
  if (new Set(assignedSessions).size !== assignedSessions.length) fail('SESSION_REUSED');
  const noviceIds = new Set(assignments.novice_slots.map((row) => row.participant_id).filter(Boolean));
  if (assignments.advanced_slots.some((row) => row.participant_id && noviceIds.has(row.participant_id))) fail('PARTICIPANT_IN_BOTH_GROUPS');
  const novice = scoreGroup(assignments.novice_slots, frozen.novice, { minimum: NOVICE_MINIMUM, audience: 'novice', sessions: consented });
  const advanced = scoreGroup(assignments.advanced_slots, frozen.advanced, { minimum: ADVANCED_MINIMUM, audience: 'advanced', sessions: consented });
  const critical = sessions.critical_misinterpretations ?? [];
  const participantsUnavailable = novice.actual_participants < NOVICE_MINIMUM || advanced.actual_participants < ADVANCED_MINIMUM;
  const r12 = freeze({
    id: 'R12',
    accepted: false,
    result: participantsUnavailable ? 'unverified' : 'fail',
    novice,
    advanced,
    critical_misinterpretations: critical.length,
    participants_unavailable: participantsUnavailable,
    implementer_self_tests_cannot_satisfy: true,
    simulations_do_not_count: true,
    tiny_group_is_not_population_claim: true,
    note: 'Eight actual novice and eight actual advanced participants are required. Empty slots cannot pass. This scorer never accepts R12.',
  });
  const r13 = freeze({
    id: 'R13',
    accepted: false,
    result: 'unverified',
    note: 'Guide artifacts are owned by PR-070/071/072. This PR does not accept R13 from protocol publication.',
  });
  return freeze({
    format: 'ushso.pr080-usability-score.v1',
    generation: LAST_GOOD_GENERATION,
    protocol_frozen_before_sessions: true,
    human_participants_separate_from_agent_simulations: protocol.human_participants_separate_from_agent_simulations === true,
    clicking_through_a_page_is_not_completion: protocol.success_criteria.clicking_through_a_page_is_not_completion === true,
    r12,
    r13,
    c0091: 'unresolved',
    http_200_is_completed_research_task: false,
    production_changed: false,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(scoreUsability(), null, 2)}\n`);
}
