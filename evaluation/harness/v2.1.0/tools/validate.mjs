import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../../..');
const contract = JSON.parse(await fs.readFile(path.join(packageRoot, 'metric-contract.json'), 'utf8'));
const parentBytes = await fs.readFile(path.join(repositoryRoot, contract.parent_contract.path));
const parentSha256 = crypto.createHash('sha256').update(parentBytes).digest('hex');

assert.equal(contract.contract_version, 'ushso-retrieval-evaluator-metric-contract.v2.1.0');
assert.equal(parentSha256, contract.parent_contract.sha256);
assert.equal(contract.parent_contract.preserved, true);
assert.equal(contract.metric.id, 'present_source_normalized_dcg_at_5');
assert.equal(contract.metric.k, 5);
assert.equal(contract.metric.target.value, 0.7);
assert.deepEqual(contract.metric.target.required_cohorts, ['development', 'validation', 'combined']);
assert.equal(contract.unchanged_gates.safety_zero_tolerance, true);
assert.equal(contract.unchanged_gates.held_out_single_use, true);
assert.equal(contract.unchanged_gates.auth_13_required, true);
assert.equal(contract.unchanged_gates.production_authorization, false);

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  contract_version: contract.contract_version,
  parent_contract_sha256: parentSha256,
  external_requests: 0,
  held_out_questions_evaluated: 0,
  production_actions: 0
})}\n`);
