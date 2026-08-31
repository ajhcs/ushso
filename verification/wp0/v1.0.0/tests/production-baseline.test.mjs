import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_RECEIPT_PATH,
  validateProductionBaseline,
} from '../tools/validate-production-baseline.mjs';

async function loadReceipt() {
  return JSON.parse(await fs.readFile(DEFAULT_RECEIPT_PATH, 'utf8'));
}

test('production and historical evaluation baselines are byte-pinned and unambiguous', async () => {
  const result = await validateProductionBaseline();
  assert.deepEqual(result.production.records, 157);
  assert.deepEqual(result.production.join_routes, 14);
  assert.deepEqual(result.historical_evaluation.records, 143);
  assert.deepEqual(result.historical_evaluation.join_routes, 14);
  assert.deepEqual(result.historical_evaluation.questions, 60);
});

test('tester slice arithmetic restores canonical-base instead of changing the production total', async () => {
  const receipt = await loadReceipt();
  const reconciliation = receipt.tester_slice_reconciliation;
  assert.equal(reconciliation.tester_listed_sum, 153);
  assert.deepEqual(reconciliation.omitted_from_tester_arithmetic, {
    slice: 'canonical_base',
    records: 4,
  });
  assert.equal(reconciliation.corrected_production_total, 157);
  await validateProductionBaseline({ receipt });
});

test('validator fails closed when a pinned artifact hash is changed', async () => {
  const receipt = await loadReceipt();
  receipt.production_migration_seed.artifacts.records.file_sha256 = '0'.repeat(64);
  await assert.rejects(
    validateProductionBaseline({ receipt }),
    /BASELINE_FILE_HASH_MISMATCH/u,
  );
});

test('validator fails closed when a count is changed without changing corpus bytes', async () => {
  const receipt = await loadReceipt();
  receipt.historical_evaluation_baseline.counts.join_routes = 13;
  await assert.rejects(
    validateProductionBaseline({ receipt }),
    /BASELINE_(CORPUS_ROUTE_COUNT|SLICE_TOTAL)_MISMATCH/u,
  );
});

test('validator rejects unvalidated receipt fields', async () => {
  const receipt = await loadReceipt();
  receipt.unverified_claim = true;
  await assert.rejects(
    validateProductionBaseline({ receipt }),
    /BASELINE_UNEXPECTED_FIELDS/u,
  );
});
