import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUGGESTED_MONTHLY_USD,
  SUGGESTED_PILOT_USD,
  createBudgetConfig,
  createBudgetLedger,
  worstCaseUsd,
} from '../../packages/enrichment/budget-ledger.mjs';
import { createJobCache, taskIdentity } from '../../packages/enrichment/job-cache.mjs';
import snapshot from '../../packages/enrichment/model-snapshot.json' with { type: 'json' };

const prices = {
  pricePromptPerMillion: snapshot.evaluated_model.max_price_prompt_per_million,
  priceCompletionPerMillion: snapshot.evaluated_model.max_price_completion_per_million,
};

test('two workers racing for the final budget unit cannot both proceed and missing prices fail closed', async () => {
  assert.equal(SUGGESTED_PILOT_USD, 10);
  assert.equal(SUGGESTED_MONTHLY_USD, 50);
  const cfg = createBudgetConfig({ capUsd: 0.0004, period: 'pilot', suggestedPilotUsd: 12, suggestedMonthlyUsd: 60 });
  assert.equal(cfg.hidden_default, false);
  assert.equal(cfg.suggested_pilot_usd, 12);
  assert.throws(() => worstCaseUsd({ inputTokens: 10, maxOutputTokens: 10 }), { code: 'MISSING_PRICE_DATA' });
  const unit = worstCaseUsd({ inputTokens: 500, maxOutputTokens: 500, retries: 0, ...prices });
  const ledger = createBudgetLedger({ capUsd: unit * 1.5, period: 'monthly' });
  const results = await Promise.allSettled([
    ledger.reserve({ reservation_id: 'a', task_id: 't1', inputTokens: 500, maxOutputTokens: 500, retries: 0, ...prices }),
    ledger.reserve({ reservation_id: 'b', task_id: 't2', inputTokens: 500, maxOutputTokens: 500, retries: 0, ...prices }),
  ]);
  const fulfilled = results.filter((row) => row.status === 'fulfilled');
  const rejected = results.filter((row) => row.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'BUDGET_EXHAUSTED');
});

test('timeout, 402, 429, malformed usage and restart leave uncertain charges that are not free', async () => {
  const unit = worstCaseUsd({ inputTokens: 100, maxOutputTokens: 100, retries: 1, ...prices });
  const ledger = createBudgetLedger({ capUsd: unit * 10, maxRetries: 1 });
  const timeout = await ledger.reserve({ reservation_id: 'timeout', inputTokens: 100, maxOutputTokens: 100, retries: 1, ...prices });
  const timeoutCharge = await ledger.settle(timeout.reservation_id, { status: 'timeout_after_send' });
  assert.equal(timeoutCharge.state, 'uncertain');
  assert.equal(timeoutCharge.assumed_free, false);
  const pay = await ledger.reserve({ reservation_id: 'pay', inputTokens: 100, maxOutputTokens: 100, retries: 1, ...prices });
  const payCharge = await ledger.settle(pay.reservation_id, { status: '402' });
  assert.equal(payCharge.state, 'payment_required');
  const retry = await ledger.reserve({ reservation_id: 'retry', inputTokens: 100, maxOutputTokens: 100, retries: 1, ...prices });
  const wait = await ledger.settle(retry.reservation_id, { status: '429', retryAfterMs: 1000 });
  assert.equal(wait.state, 'retry_wait');
  assert.equal(wait.assumed_free, false);
  await assert.rejects(() => ledger.settle(retry.reservation_id, { status: '429', retryAfterMs: 1000 }), { code: 'RETRY_CAP_EXCEEDED' });
  const malformed = await ledger.reserve({ reservation_id: 'malformed', inputTokens: 100, maxOutputTokens: 100, retries: 1, ...prices });
  const bad = await ledger.settle(malformed.reservation_id, { status: 'malformed_usage' });
  assert.equal(bad.assumed_free, false);
  const restart = await ledger.reserve({ reservation_id: 'restart', inputTokens: 100, maxOutputTokens: 100, retries: 1, ...prices });
  const restarted = await ledger.settle(restart.reservation_id, { status: 'process_restart' });
  assert.equal(restarted.state, 'uncertain');
  const ok = await ledger.reserve({ reservation_id: 'ok', inputTokens: 100, maxOutputTokens: 100, retries: 1, ...prices });
  const settled = await ledger.settle(ok.reservation_id, { status: 'success', usage: { cost_usd: 0.0001, prompt_tokens: 10, completion_tokens: 5 }, providerId: 'gen-1' });
  assert.equal(settled.state, 'settled');
  const rejected = await ledger.reserve({ reservation_id: 'rej', inputTokens: 100, maxOutputTokens: 100, retries: 1, ...prices });
  await ledger.settle(rejected.reservation_id, { status: 'rejected' });
  const report = ledger.costReport();
  assert.equal(report.includes_failures_retries_and_rejected, true);
  assert.ok(report.failures.length >= 1);
  assert.ok(report.retries.length >= 1);
  assert.ok(report.rejected_proposals.length >= 1);
  assert.ok(ledger.snapshot().uncertain_usd > 0);
});

test('changed source or prompt invalidates cache and unchanged rerun performs no duplicate inference', () => {
  const cache = createJobCache();
  const base = {
    sourceBytes: 'passage',
    parserVersion: 'v1',
    prompt: 'extract',
    schemaVersion: 'ushso.openrouter-request.v1',
    model: snapshot.evaluated_model.id,
    providerPolicyVersion: snapshot.evaluated_model.data_use_policy_version,
    scope: 'residual:001',
  };
  const first = cache.run(taskIdentity(base), () => ({ proposal: 'A', cost_usd: 0.01 }));
  assert.equal(first.inference_performed, true);
  const second = cache.run(taskIdentity(base), () => ({ proposal: 'B', cost_usd: 0.02 }));
  assert.equal(second.inference_performed, false);
  assert.equal(second.proposal, 'A');
  const changed = cache.run(taskIdentity({ ...base, prompt: 'extract-v2' }), () => ({ proposal: 'C', cost_usd: 0.03 }));
  assert.equal(changed.inference_performed, true);
  assert.equal(changed.proposal, 'C');
  const sourceChanged = cache.run(taskIdentity({ ...base, sourceBytes: 'passage-2' }), () => ({ proposal: 'D', cost_usd: 0.04 }));
  assert.equal(sourceChanged.inference_performed, true);
});
