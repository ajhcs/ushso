import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { buildSuccessorReceipts } from '../tools/build-successor.mjs';

const actualPromise = buildSuccessorReceipts();
const storedProductPromise = fs.readFile(new URL('../receipts/product-boundary.json', import.meta.url), 'utf8').then(JSON.parse);
const storedAggregatePromise = fs.readFile(new URL('../receipts/wp0-successor-aggregate.json', import.meta.url), 'utf8').then(JSON.parse);

test('the successor receipts are exact and the historical final receipt is preserved', async () => {
  const [actual, storedProduct, storedAggregate] = await Promise.all([actualPromise, storedProductPromise, storedAggregatePromise]);
  assert.deepEqual(storedProduct, actual.productBoundary);
  assert.deepEqual(storedAggregate, actual.aggregate);
  assert.equal(storedAggregate.checks[0].evidence.predecessor_overwritten, false);
});

test('the current dynamic boundary and all successor checks pass', async () => {
  const { productBoundary, aggregate } = await actualPromise;
  assert.equal(productBoundary.result, 'pass');
  assert.equal(productBoundary.test_summary.failed, 0);
  assert.ok(productBoundary.inspected_scope.file_count > 0);
  assert.ok(aggregate.checks.every(check => check.status === 'PASS'));
  assert.deepEqual(aggregate.blockers, []);
});

test('the reseal cannot imply release or production authority', async () => {
  const { aggregate } = await actualPromise;
  assert.equal(aggregate.release_gate_pass, false);
  assert.equal(aggregate.release_ready, false);
  assert.equal(aggregate.production_eligibility, false);
  assert.equal(aggregate.execution_boundary.held_out_questions_evaluated, 0);
  assert.equal(aggregate.execution_boundary.production_mutations, 0);
});
