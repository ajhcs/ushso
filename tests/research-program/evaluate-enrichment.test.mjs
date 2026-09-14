import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  freezeClaimTargets,
  loadHeldOutLabels,
  loadPublicTasks,
  runPairedEvaluation,
  selectPolicy,
} from '../../evaluation/enrichment/harness.mjs';
import { runCli } from '../../scripts/research-program/evaluate-enrichment.mjs';

const evalDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../evaluation/enrichment');

test('independently adjudicated labels include critical errors and disagreement; model output is not gold', () => {
  const freeze = freezeClaimTargets({ evalDir });
  assert.equal(freeze.frozen_before_scoring, true);
  assert.equal(freeze.model_output_is_gold, false);
  assert.equal(freeze.labels_outside_prompts, true);
  const publicTasks = loadPublicTasks(evalDir);
  assert.equal(publicTasks.held_out_labels_included, false);
  const labels = loadHeldOutLabels(evalDir);
  assert.ok(labels.labels.some((row) => row.reviewer_disagreement === true));
  const classes = new Set(labels.labels.map((row) => row.critical_error_class));
  assert.ok(classes.has('guessed_missing_document'));
  assert.ok(classes.has('date_role_confusion'));
  const publicBytes = readFileSync(path.join(evalDir, 'tasks.public.json'), 'utf8');
  assert.equal(publicBytes.includes('expected_value'), false);
  assert.equal(publicBytes.includes('critical_error_class'), false);
});

test('offline harness works without credentials and live attempts report model/endpoint/spend without calling the network', () => {
  const result = runPairedEvaluation({ evalDir });
  assert.equal(result.offline, true);
  assert.equal(result.credentials_used, false);
  assert.equal(result.model_output_is_gold, false);
  const deepseek = result.per_model.deepseek.summary;
  const muse = result.per_model.muse.summary;
  assert.ok(typeof deepseek.tokens === 'number');
  assert.ok(typeof deepseek.actual_price_usd === 'number');
  assert.ok(deepseek.rejected_claims >= 0);
  assert.ok(muse.abstentions + muse.rejected_claims >= 1);
  const live = runCli(['--live']);
  assert.equal(live.ok, false);
  assert.equal(live.error, 'LIVE_EVAL_FORBIDDEN');
  assert.match(live.message, /deepseek\/deepseek-chat/);
  assert.match(live.message, /openrouter\.ai\/api\/v1\/chat\/completions/);
  assert.match(live.message, /total_spend_usd/);
});

test('failing task classes are disabled; cheap tokens and agreement do not override the gate; deterministic collection stays up', () => {
  const result = runPairedEvaluation({ evalDir });
  const policy = selectPolicy(result);
  assert.equal(result.inter_model_agreement_overrides_gate, false);
  assert.equal(policy.cheap_tokens_override, false);
  assert.equal(policy.inter_model_agreement_override, false);
  assert.equal(policy.deterministic_collection_operational, true);
  assert.equal(policy.r14_accepted, false);
  assert.ok(result.per_model.deepseek.summary.disabled_task_classes.includes('date_role'));
  assert.ok(result.per_model.muse.summary.disabled_task_classes.includes('insufficient_evidence'));
  assert.equal(result.publication_eligible, false);
  assert.equal(result.selected_model, null);
  assert.ok(result.per_model.muse.summary.actual_price_usd < result.per_model.deepseek.summary.actual_price_usd);
  assert.equal(result.per_model.muse.summary.publication_eligible, false);
});
