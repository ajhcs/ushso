import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createPublishedEngine } from '../../../../packages/retrieval/tools/load-corpus.mjs';
import { PACKAGE_ROOT } from '../tools/baseline-adapter.mjs';

test('Pennsylvania finance and utilization resolves the required MVP bundle', async () => {
  const engine = await createPublishedEngine();
  const result = engine.retrieve({ question: 'I need hospital financial and utilization data for Pennsylvania', limit: 15 });
  const ids = result.results.map(item => item.record.identity?.match_fields?.source_id ?? item.record.record_id);
  assert.ok(ids.includes('cms_hcris_cost_reports'));
  assert.ok(ids.includes('pa_phc4_financial_ownership'));
  assert.ok(result.join_routes.length > 0);
  assert.equal(result.corpus.record_count, 143);
});

test('geography alone cannot turn nonsense into relevant results', async () => {
  const engine = await createPublishedEngine();
  const result = engine.retrieve({ question: 'Pennsylvania flibbertigibbet qzxwvu', limit: 15 });
  assert.equal(result.result_count, 0);
  assert.match(result.warnings.join(' '), /not evidence that no source exists/i);
});

test('published baseline covers all frozen questions without external work', async () => {
  const report = JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, 'outputs', 'evaluation-report.json'), 'utf8'));
  assert.equal(report.question_count, 60);
  assert.equal(report.external_requests, 0);
  assert.equal(report.ranking_optimized, false);
  assert.equal(report.llm_used, false);
  assert.equal(report.identity_work_performed, false);
  assert.equal(report.coverage_execution_performed, false);
  assert.equal(report.heavy_analysis_lock_touched, false);
});
