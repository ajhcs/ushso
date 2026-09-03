import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSuccessorReceipts } from './build-successor.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [storedProductBoundary, storedAggregate, actual] = await Promise.all([
  fs.readFile(path.join(packageRoot, 'receipts/product-boundary.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(packageRoot, 'receipts/wp0-successor-aggregate.json'), 'utf8').then(JSON.parse),
  buildSuccessorReceipts()
]);

assert.deepEqual(storedProductBoundary, actual.productBoundary);
assert.deepEqual(storedAggregate, actual.aggregate);
assert.equal(storedAggregate.verification_status, 'PASS_SUCCESSOR_RESEAL');
assert.equal(storedAggregate.artifact_integrity_pass, true);
assert.equal(storedAggregate.provisional, false);
assert.equal(storedAggregate.release_ready, false);
assert.equal(storedAggregate.production_eligibility, false);
assert.deepEqual(storedAggregate.blockers, []);

process.stdout.write(`${JSON.stringify({
  status: storedAggregate.verification_status,
  checks: storedAggregate.checks.length,
  blockers: storedAggregate.blockers.length,
  release_ready: false,
  production_eligibility: false
})}\n`);
