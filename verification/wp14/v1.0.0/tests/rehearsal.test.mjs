import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateSnapshot } from "../src/candidate-snapshot.mjs";
import { runFixtureRehearsal, loadPolicy, buildRollbackBundle, crossVersionAssetMatrix, passingTelemetry, runShadowParity } from "../src/rehearsal.mjs";
import { evaluateTelemetry, verifyRollbackBundle } from "../src/release-state-machine.mjs";
import { verifyCanonicalDigest, withCanonicalDigest } from "../src/common.mjs";

test("fixture-only shadow parity covers bounded public surfaces without raw questions or payloads", () => {
  const parity = runShadowParity();
  assert.equal(parity.passed, true);
  assert.equal(parity.case_count, 5);
  assert.equal(parity.contains_raw_user_queries, false);
  assert.equal(parity.contains_source_payloads, false);
  assert.deepEqual(new Set(parity.results.map((item) => item.surface)), new Set(["dataset_detail", "browse", "search", "coverage", "plan"]));
});

test("two connector and two rebuild/promotion rehearsals finish at zero traffic on static fallback", () => {
  const receipt = runFixtureRehearsal();
  assert.equal(verifyCanonicalDigest(receipt, "receipt_sha256").ok, true);
  assert.equal(receipt.rehearsals.connector_refresh_cycle_count, 2);
  assert.equal(receipt.rehearsals.rebuild_promote_rollback_cycle_count, 2);
  assert.equal(receipt.rehearsals.fixture_cycles_count_toward_production_soak, false);
  assert.equal(receipt.rehearsals.generation_pointer_rollback_rehearsed, true);
  assert.equal(receipt.rehearsals.worker_and_asset_rollback_rehearsed, true);
  assert.equal(receipt.rehearsals.static_fallback_rehearsed, true);
  assert.equal(receipt.rehearsals.final_public_backend, "immutable_static_jsonl");
  assert.equal(receipt.rehearsals.final_public_traffic_percent, 0);
  assert.equal(receipt.rehearsals.runtime_jsonl_active, true);
  assert.equal(receipt.failure_injection.passed, true);
  assert.equal(receipt.execution_boundary.network_requests, 0);
  assert.equal(receipt.execution_boundary.provider_mutations, 0);
  assert.equal(receipt.execution_boundary.deployments, 0);
  assert.equal(receipt.execution_boundary.public_requests, 0);
  assert.ok(Object.values(receipt.production_status).every((value) => value === false));
});

test("every abort threshold fails closed at its first violating value", () => {
  const policy = loadPolicy();
  for (const [metric, threshold] of Object.entries(policy.observability_abort_thresholds)) {
    if (metric.includes("planner_")) {
      const sample = { ...passingTelemetry(), planner_enabled: true, planner_p95_ms_if_enabled: 100, planner_p99_ms_if_enabled: 100 };
      sample[metric] = threshold.value + 1;
      assert.equal(evaluateTelemetry(sample, policy).abort, true, metric);
    } else {
      const sample = passingTelemetry();
      sample[metric] = threshold.value + (Number.isInteger(threshold.value) ? 1 : 0.001);
      assert.equal(evaluateTelemetry(sample, policy).abort, true, metric);
    }
  }
});

test("rollback bundle binds N-1 Worker, bindings, schema watermark, generations, assets, static export, support, and verification", () => {
  const candidate = buildCandidateSnapshot();
  const policy = loadPolicy();
  const bundle = buildRollbackBundle(candidate);
  const options = { now: bundle.prepared_at, expected_anchor_at: bundle.support_window_anchor_at };
  assert.deepEqual(verifyRollbackBundle(bundle, candidate, policy, options), { ok: true, errors: [] });

  for (const mutate of [
    (copy) => { copy.candidate_digest_sha256 = `sha256:${"0".repeat(64)}`; },
    (copy) => { copy.resources.pop(); },
    (copy) => { copy.resources[1].role = copy.resources[0].role; },
    (copy) => { copy.resources[1].resource_id = copy.resources[0].resource_id; },
    (copy) => { copy.n_minus_one_current_schema_compatible = false; },
    (copy) => { copy.cross_version_asset_404_count = 1; },
    (copy) => { copy.storage_rollback_claimed = true; },
    (copy) => { copy.destructive_down_migration_included = true; },
    (copy) => { copy.support_window_days = 29; },
    (copy) => { copy.support_expires_at = "2026-09-01T00:00:00.000Z"; },
    (copy) => { copy.support_window_anchor_at = "2026-08-31T00:00:00.000Z"; },
  ]) {
    const copy = structuredClone(bundle);
    mutate(copy);
    const resealed = withCanonicalDigest(copy, "bundle_sha256");
    assert.equal(verifyRollbackBundle(resealed, candidate, policy, options).ok, false);
  }
});

test("cross-version N-1 asset matrix contains both skew directions and zero fixture 404s", () => {
  const matrix = crossVersionAssetMatrix();
  assert.equal(matrix.rows.length, 4);
  assert.equal(matrix.total_fixture_requests, 12);
  assert.equal(matrix.asset_404_count, 0);
  assert.equal(matrix.production_traffic_requests, 0);
  assert.ok(matrix.rows.some((row) => row.worker === "N-1 Worker" && row.html === "cached N HTML"));
  assert.ok(matrix.rows.some((row) => row.worker === "N Worker" && row.html === "cached N-1 HTML"));
});
