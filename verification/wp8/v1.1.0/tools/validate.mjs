import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDevelopmentValidation } from './development-validation.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const receipt = JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, 'validation/validation-receipt.json'), 'utf8'));
const actual = await buildDevelopmentValidation();

assert.equal(receipt.receipt_version, 'ushso-wp8-development-validation-receipt.v1.0.0');
assert.equal(receipt.package_id, '@ushso/verification-wp8-candidate@1.1.0');
assert.equal(receipt.status, 'PASS_DEVELOPMENT_VALIDATION');
assert.equal(receipt.quality_status, 'FAIL_TARGET_PRECISION');
assert.equal(receipt.release_gate_pass, false);
assert.equal(receipt.release_ready, false);
assert.equal(receipt.algorithm_version, actual.algorithm_version);
assert.deepEqual(receipt.split_counts, actual.summary.split_counts);
assert.equal(receipt.question_count, actual.summary.question_count);
assert.deepEqual(receipt.quality, actual.summary.quality);
assert.deepEqual(receipt.safety, actual.summary.safety);
assert.deepEqual(receipt.pins, actual.pins);
assert.deepEqual(receipt.execution_boundary, actual.summary.execution_boundary);
assert.equal(receipt.execution_boundary.held_out_rows_parsed, 0);
assert.equal(receipt.execution_boundary.held_out_questions_evaluated, 0);
assert.equal(receipt.execution_boundary.tuning_scope, 'development_and_validation_only');
assert.equal(receipt.open_gates.find(gate => gate.gate_id === 'AUTH-13')?.status, 'blocked_external_authorization');

process.stdout.write(`${JSON.stringify({
  ok: true,
  status: receipt.status,
  quality_status: receipt.quality_status,
  release_gate_pass: receipt.release_gate_pass,
  question_count: receipt.question_count,
  split_counts: receipt.split_counts,
  safety_zero_tolerance_pass: receipt.safety.zero_tolerance_pass
})}\n`);
