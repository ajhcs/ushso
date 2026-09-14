import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_RECORD_COUNT,
  ISOLATED_RECORDS,
  ORIGINAL_AUDIT_GAPS,
  blockedFetch,
  compileSweepJobs,
  loadBaselineInventory,
  runFixtureSweep,
  runResumableBatch,
  resumeBatch,
  writeDeficitManifest,
} from '../../packages/coverage/research-program/v1.0.0/src/sweep.mjs';
import { runCli } from '../../scripts/research-program/sweep.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function selectIds(inventory, source, count) {
  return inventory.records.filter((row) => row.source_id === source).slice(0, count).map((row) => row.record_id);
}

test('inventory count equals the sum of disjoint dispositions and unknown is not attempted', async () => {
  const inventory = await loadBaselineInventory({ repoRoot: root });
  assert.equal(inventory.records.length, BASELINE_RECORD_COUNT);
  assert.deepEqual(inventory.source_slices, { 'cdc-socrata': 1472, 'census-api': 1803, 'cms-data-catalog': 159 });
  const unknownIds = selectIds(inventory, 'cdc-socrata', 2).filter((id) => !ISOLATED_RECORDS.some((row) => row.record_id === id));
  const blockedIds = selectIds(inventory, 'cms-data-catalog', 1);
  const notApplicableIds = selectIds(inventory, 'census-api', 1);
  const compiled = compileSweepJobs(inventory, {
    unknownIds,
    blockedIds,
    notApplicableIds,
    budget: { max_attempts: 3, max_capture_charges: 3 },
  });
  const sum = Object.values(compiled.counts).reduce((total, n) => total + n, 0);
  assert.equal(sum, BASELINE_RECORD_COUNT);
  assert.equal(compiled.counts.isolated, 4);
  assert.equal(compiled.counts.unknown_eligibility, unknownIds.length);
  assert.equal(compiled.unknown_not_attempted, true);
  assert.ok(compiled.jobs.filter((job) => job.disposition === 'unknown_eligibility').every((job) => job.attempted === false));
});

test('stopped and restarted batch matches uninterrupted membership without duplicate capture charges', async () => {
  const inventory = await loadBaselineInventory({ repoRoot: root });
  const compiled = compileSweepJobs(inventory, {
    unknownIds: [],
    blockedIds: [],
    notApplicableIds: [],
    budget: { max_attempts: 3, max_capture_charges: 3 },
  });
  const partial = runResumableBatch(compiled, { stopAfter: 1 });
  const resumed = resumeBatch(compiled, partial);
  const uninterrupted = runResumableBatch(compiled);
  const attempted = (batch) => batch.outcomes.filter((row) => row.disposition === 'eligible_attempted').map((row) => row.record_id).sort();
  assert.deepEqual(resumed.membership, uninterrupted.membership);
  assert.deepEqual(attempted(resumed), attempted(uninterrupted));
  assert.equal(resumed.duplicate_capture_charges, false);
  assert.equal(uninterrupted.duplicate_capture_charges, false);
  assert.deepEqual([...resumed.capture_charges].sort(), [...uninterrupted.capture_charges].sort());
  assert.equal(resumed.capture_charges.length, compiled.reserved_attempts);
});

test('all original audit gaps have an observed disposition and completion stays false while eligible records remain', async () => {
  const result = await runFixtureSweep({
    repoRoot: root,
    unknownIds: [],
    blockedIds: [],
    notApplicableIds: [],
    budget: { max_attempts: 3, max_capture_charges: 3 },
    stopAfter: 1,
  });
  assert.equal(result.receipt.record_count, BASELINE_RECORD_COUNT);
  assert.equal(result.receipt.all_ids_present, true);
  assert.equal(result.receipt.ids.length, BASELINE_RECORD_COUNT);
  assert.equal(result.deficits.completion_asserted, false);
  assert.equal(result.deficits.completion_allowed, false);
  assert.ok(result.deficits.unattempted_eligible > 0);
  for (const gap of ORIGINAL_AUDIT_GAPS) {
    assert.ok(Object.hasOwn(result.deficits.counts_by_cause, gap) || result.deficits.rows.some((row) => row.cause === gap), gap);
  }
  assert.equal(result.compiled.counts.isolated, 4);
  assert.equal(result.receipt.live_source_traffic, false);
});

test('CLI stays fixture-only and live fetch is forbidden', async () => {
  const cli = runCli([]);
  assert.equal(cli.ok, false);
  assert.equal(cli.error, 'SWEEP_CLI_FIXTURE_ONLY');
  assert.equal(runCli(['--live']).error, 'SWEEP_LIVE_NETWORK_FORBIDDEN');
  await assert.rejects(() => blockedFetch('https://data.cms.gov'), { code: 'SWEEP_LIVE_NETWORK_FORBIDDEN' });
});
