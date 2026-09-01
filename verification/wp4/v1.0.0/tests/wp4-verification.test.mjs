import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { packageRoot, repositoryRoot } from '../tools/common.mjs';
import { buildWp4Receipt, verifyWp4 } from '../tools/wp4-verification.mjs';

test('WP4 source-bound receipt is deterministic and honest about external work', async () => {
  const first = await buildWp4Receipt();
  const second = await buildWp4Receipt();
  assert.deepEqual(second, first);
  assert.equal(first.receipt_version, 'ushso-wp4-offline-verification-receipt.v1.0.0');
  assert.equal(first.status, 'pass_local');
  assert.equal(first.determinism, 'source_bound_no_wall_clock');
  assert.match(first.implementation_fingerprint, /^[a-f0-9]{64}$/);
  assert.match(first.verifier_fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(first.verified_file_count >= 20);
  assert.ok(first.verifier_file_count >= 8);
  assert.equal(first.managed_integration.status, 'pending_external_authorization');
  assert.equal(first.managed_integration.deployment_performed, false);
  assert.equal(first.managed_integration.paid_infrastructure_used, false);
  assert.ok(Object.values(first.zero_action).every(value => value === 0));
});

test('WP4 executable controls prove retry, identity, capture, pause, unknown-send, and DLQ invariants', async () => {
  const receipt = await verifyWp4();
  const controls = receipt.controls;
  assert.deepEqual(
    {
      retries: controls.transport_retry_and_non_recursive_dlq.transport_retries,
      deliveries: controls.transport_retry_and_non_recursive_dlq.maximum_delivery_attempts,
      recursive: controls.transport_retry_and_non_recursive_dlq.recursive_dead_letter_queue_allowed,
    },
    { retries: 5, deliveries: 6, recursive: false },
  );
  assert.equal(controls.workflow_identity_v1_1.policy_version, 'workflow-instance.v1.1');
  assert.equal(controls.workflow_identity_v1_1.runtime_and_sql_fenced, true);
  assert.equal(controls.per_capture_normalization.unique_normalization_jobs, 2);
  assert.equal(controls.per_capture_normalization.zero_capture_run_required_captures, 0);
  assert.equal(controls.pause_zero_fetch.source_fetches_after_pause, 0);
  assert.equal(controls.unknown_send_retention.physical_sends, 1);
  assert.equal(controls.unknown_send_retention.immediate_resends, 0);
  assert.equal(controls.dlq_final_page_and_reconstruction.final_configured_delivery, true);
  assert.equal(controls.dlq_final_page_and_reconstruction.reconstructed_dead_letter_committed, true);
  assert.equal(controls.sql_query_parity.workflow_start_owned_only_by_reconciler, true);
  assert.equal(controls.sql_query_parity.inclusive_job_lease_expiry, true);
  assert.equal(controls.sql_query_parity.cron_scheduled_slot_is_caller_supplied, true);
  assert.ok(['pass_static_markers', 'pending_local_implementation'].includes(controls.service_composition.status));
});

test('receipt CLI is a write-free wrapper around the deterministic generator', () => {
  const source = readFileSync(path.resolve(packageRoot, 'tools/build-receipt.mjs'), 'utf8');
  assert.match(source, /buildWp4Receipt/);
  assert.match(source, /process\.stdout\.write/);
  assert.doesNotMatch(source, /writeFile|appendFile|createWriteStream/);
});

test('the complete ingestion package fault-injection suite remains explicitly discoverable', () => {
  const testFiles = readdirSync(path.resolve(repositoryRoot, 'packages/ingestion/tests'))
    .filter(name => name.endsWith('.test.mjs'))
    .sort()
    .map(name => path.resolve(repositoryRoot, 'packages/ingestion/tests', name));
  assert.ok(testFiles.length >= 5, 'ingestion test discovery must not be empty or silently shrink');
  const packageJson = JSON.parse(readFileSync(path.resolve(repositoryRoot, 'packages/ingestion/package.json'), 'utf8'));
  assert.equal(packageJson.scripts.test, 'node --test tests/*.test.mjs');
  assert.equal(packageJson.scripts.verify, 'node ../../verification/wp4/v1.0.0/tools/verify-wp4.mjs');
  const verificationPackage = JSON.parse(readFileSync(path.resolve(packageRoot, 'package.json'), 'utf8'));
  assert.equal(verificationPackage.scripts.validate, 'node tools/verify-wp4.mjs');
});
