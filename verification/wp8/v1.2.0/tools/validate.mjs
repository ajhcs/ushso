import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMetricSuccessorValidation } from './development-validation.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stored = JSON.parse(await fs.readFile(path.join(packageRoot, 'validation/validation-receipt.json'), 'utf8'));
const actual = await buildMetricSuccessorValidation();

assert.deepEqual(stored, actual);
assert.equal(stored.status, 'PASS_DEVELOPMENT_VALIDATION_METRIC_SUCCESSOR');
assert.equal(stored.quality_gate_pass, true);
assert.equal(stored.safety_gate_pass, true);
assert.equal(stored.release_gate_pass, false);
assert.equal(stored.release_ready, false);
assert.equal(stored.production_eligibility, false);
assert.equal(stored.open_gates.find(gate => gate.gate_id === 'AUTH-13')?.status, 'not_authorized');

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  metric: stored.metric_contract.id,
  score: stored.feasibility.successor_metric.combined.macro_score,
  historical_ceiling: stored.feasibility.historical_fixed_slot_metric.mathematical_ceiling,
  release_ready: false,
  external_requests: 0
})}\n`);
