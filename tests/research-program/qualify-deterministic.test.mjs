import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_RECORD_COUNT,
  LAST_GOOD_GENERATION,
  LAST_GOOD_MANIFEST_SHA256,
  blockedFetch,
  createResidualTasks,
  qualifyDeterministic,
  reconcileEvidence,
} from '../../packages/coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';
import { runCli } from '../../scripts/research-program/qualify-deterministic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('successful results require capture/parser receipts and missing evidence cannot promote', async () => {
  const result = await qualifyDeterministic({ repoRoot: root });
  assert.equal(result.reconciliation.record_count, BASELINE_RECORD_COUNT);
  assert.ok(result.reconciliation.rows.every((row) => row.success !== true || (row.capture_receipt && row.parser_receipt)));
  assert.ok(result.reconciliation.rows.every((row) => row.missing_evidence !== true || row.promoted === false));
  assert.ok(result.reconciliation.rows.some((row) => row.partial_dictionary === true));
  assert.ok(result.reconciliation.rows.some((row) => row.stale_observation === true && row.stale_reason));
  assert.equal(result.reconciliation.last_good_unchanged, true);
});

test('residual queue is bounded, excludes credentials, and never asks an LLM to recall a missing fact', async () => {
  const result = await qualifyDeterministic({ repoRoot: root, maxResiduals: 12 });
  assert.ok(result.residuals.task_count > 0);
  assert.ok(result.residuals.task_count < BASELINE_RECORD_COUNT);
  assert.equal(result.residuals.not_entire_corpus, true);
  assert.ok(result.residuals.tasks.every((task) => task.excludes_credentials === true));
  assert.ok(result.residuals.tasks.every((task) => task.llm_from_memory_forbidden === true));
  assert.ok(result.residuals.tasks.every((task) => task.evidence.kind === 'public_passage' || task.evidence.kind === 'insufficient_evidence'));
  assert.ok(result.residuals.tasks.some((task) => task.evidence.kind === 'public_passage' && task.evidence.quote));
  assert.equal(result.residuals.tasks.some((task) => task.cause === 'census_key_required'), false);
});

test('readout denominators are reproducible, failed thresholds stay failed, and last-good generation is unchanged', async () => {
  const first = await qualifyDeterministic({ repoRoot: root });
  const second = await qualifyDeterministic({ repoRoot: root });
  assert.equal(first.readout.r03_denominator, BASELINE_RECORD_COUNT);
  assert.equal(first.readout.r06_denominator, BASELINE_RECORD_COUNT);
  assert.equal(first.readout.attempt_coverage.denominator, second.readout.attempt_coverage.denominator);
  assert.equal(first.readout.unresolved_essential_fields.denominator, second.readout.unresolved_essential_fields.denominator);
  assert.equal(first.readout.last_good_generation, LAST_GOOD_GENERATION);
  assert.equal(first.readout.last_good_manifest_sha256, LAST_GOOD_MANIFEST_SHA256);
  assert.equal(first.readout.publication_authorized, false);
  assert.deepEqual(first.readout.requirements_accepted, []);
  assert.equal(first.readout.failed_thresholds.undocumented_exception, false);
  assert.ok(first.readout.failed_thresholds.failed_ids.includes('R03'));
  assert.ok(first.readout.failed_thresholds.failed_ids.includes('R06'));
  assert.equal(first.readout.empirical_targets.r03_attempt_coverage.pass, false);
  const corpus = JSON.parse(await fs.readFile(path.join(root, 'packages/retrieval/versions/v1.2.0/corpus/corpus.json'), 'utf8'));
  assert.equal(corpus.publication.generation, LAST_GOOD_GENERATION);
  assert.equal(corpus.manifest_sha256, LAST_GOOD_MANIFEST_SHA256);
});

test('CLI stays fixture-only and live fetch is forbidden', async () => {
  assert.equal(runCli([]).error, 'DETERMINISTIC_CLI_FIXTURE_ONLY');
  assert.equal(runCli(['--publish']).error, 'DETERMINISTIC_PUBLICATION_FORBIDDEN');
  await assert.rejects(() => blockedFetch('https://data.cms.gov'), { code: 'DETERMINISTIC_LIVE_NETWORK_FORBIDDEN' });
  assert.throws(() => createResidualTasks({ rows: Array.from({ length: BASELINE_RECORD_COUNT }, (_, i) => ({ record_id: 'x'+i, source_id: 'cdc-socrata', cause: 'html_not_json_success', missing_evidence: false })) }, { maxResiduals: BASELINE_RECORD_COUNT }), { code: 'RESIDUAL_IS_ENTIRE_CORPUS' });
});
