import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReceipt } from './build-receipt.mjs';
import { canonicalJson, deepEqual, sha256Id } from '../../../../evaluation/planner/v1.0.0/tools/common.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function validateReceipt() {
  const expected = await buildReceipt({ write: false });
  const actual = JSON.parse(await fs.readFile(path.join(packageRoot, 'receipts/wp10a-receipt.json'), 'utf8'));
  assert(deepEqual(actual, expected), 'WP10A receipt differs from deterministic build');
  const withoutDigest = { ...actual };
  delete withoutDigest.receipt_digest;
  assert.equal(actual.receipt_digest, sha256Id(canonicalJson(withoutDigest)), 'WP10A receipt digest mismatch');
  assert.equal(actual.technical_status, 'PASS');
  assert.equal(actual.governance_status, 'PENDING_REQUIRED_OWNER_RATIFICATION');
  assert.equal(actual.wp10a_artifact_freeze_complete, true);
  assert.equal(actual.wp10b_authorized, false);
  assert.deepEqual(actual.benchmark.split_counts, { development: 50, validation: 50, held_out: 50 });
  assert(actual.benchmark.held_out_actual_cases >= actual.benchmark.held_out_case_floor);
  assert(actual.benchmark.held_out_minimum_safety_stratum_count >= actual.benchmark.held_out_safety_stratum_floor);
  assert.equal(actual.benchmark.held_out_scoring_performed, false);
  assert.equal(actual.evaluator.usefulness_metric_count, 12);
  assert.match(actual.evaluator.formula_contract_sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.match(actual.evaluator.safety_formula_contract_sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(actual.evaluator.zero_tolerance_violation_categories.length, 9);
  assert.equal(actual.verification.deterministic_rebuild_samples, 3);
  assert.equal(actual.verification.deterministic_rebuild_digests_identical, true);
  assert.equal(actual.privacy_and_leakage.production_runtime_import, 'prohibited');
  assert.equal(actual.privacy_and_leakage.raw_user_query_persistence, 'prohibited');
  assert.deepEqual(actual.governance.required_roles, ['product', 'research_methods', 'engineering']);
  assert(Object.values(actual.governance.role_statuses).every(status => status === 'pending'));
  assert.equal(actual.governance.external_authorization_id, 'AUTH-12');
  assert.deepEqual(Object.keys(actual.governance.exact_approval_digests), ['benchmark_manifest_digest', 'evaluator_contract_digest', 'review_subject_digest']);
  assert.match(actual.governance.owner_review_packet_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(actual.governance.applicator_reads_held_out_gold, false);
  assert(actual.governance.mechanical_application_command.includes('apply-owner-ratification.mjs'));
  assert.deepEqual(actual.external_actions, {
    network_requests: 0,
    production_actions: 0,
    paid_infrastructure_actions: 0,
    held_out_scoring_runs: 0,
    raw_user_queries_persisted: 0
  });
  return {
    status: 'PASS',
    receipt_digest: actual.receipt_digest,
    benchmark_manifest_digest: actual.benchmark.benchmark_manifest_digest,
    package_manifest_digest: actual.benchmark.package_manifest_digest,
    technical_status: actual.technical_status,
    governance_status: actual.governance_status,
    held_out_scoring_performed: actual.benchmark.held_out_scoring_performed,
    wp10b_authorized: actual.wp10b_authorized,
    check_count: 26
  };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.stdout.write(`${JSON.stringify(await validateReceipt())}\n`);
}
