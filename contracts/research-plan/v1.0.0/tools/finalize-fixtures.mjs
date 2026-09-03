import path from 'node:path';

import { PACKAGE_ROOT, readJson, writeAtomic } from './common.mjs';
import { planTemplates } from './fixture-source.mjs';
import { finalizePlan } from './semantics.mjs';

const claimManifest = await readJson(path.join(PACKAGE_ROOT, 'contracts', 'claim-manifest.json'));
const templates = planTemplates();
const plans = templates.map(plan => finalizePlan(plan, claimManifest));
const initial = plans.find(plan => plan.plan_status === 'clarification_required');
const initialTemplate = templates.find(plan => plan.plan_status === 'clarification_required');

function resolvedClarification(baseTemplate, value) {
  const plan = structuredClone(baseTemplate);
  const questions = structuredClone(initialTemplate.clarifications.questions).map(question => ({ ...question, answered: true }));
  plan.clarifications = {
    state: 'answered',
    question_set_hash: initialTemplate.clarifications.question_set_hash,
    questions,
    answers: [{ question_id: 'clarify:grain', values: [value] }],
    prior_plan_id: initial.plan_id,
    evidence_reference_ids: ['ev-main']
  };
  return finalizePlan(plan, claimManifest);
}

const resolvedReady = resolvedClarification(templates.find(plan => plan.plan_status === 'ready'), 'facility');
const resolvedIncomplete = resolvedClarification(templates.find(plan => plan.plan_status === 'incomplete'), 'system');
plans.push(resolvedReady, resolvedIncomplete);
const output = {
  contract_version: 'observatory-research-plan-fixtures.v1.0.0',
  plans
};

await writeAtomic(path.join(PACKAGE_ROOT, 'fixtures', 'valid-plans.json'), `${JSON.stringify(output, null, 2)}\n`);
const transitions = {
  contract_version: 'observatory-clarification-roundtrips.v1.0.0',
  transitions: [resolvedReady, resolvedIncomplete].map((plan, index) => ({
    transition_id: index === 0 ? 'clarification:to-ready' : 'clarification:to-incomplete',
    initial_plan_id: initial.plan_id,
    initial_status: 'clarification_required',
    answer_question_ids: ['clarify:grain'],
    expected_generation: plan.generated_from.index_generation,
    result_plan_id: plan.plan_id,
    result_status: plan.plan_status
  }))
};
await writeAtomic(path.join(PACKAGE_ROOT, 'fixtures', 'clarification-roundtrips.json'), `${JSON.stringify(transitions, null, 2)}\n`);
process.stdout.write(`wrote ${plans.length} valid plans and ${transitions.transitions.length} clarification transitions\n`);
