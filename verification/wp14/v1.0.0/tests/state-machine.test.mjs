import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateSnapshot } from "../src/candidate-snapshot.mjs";
import { buildRollbackBundle, createManualClock, loadAuthorizationRegister, loadPolicy, passingTelemetry } from "../src/rehearsal.mjs";
import { CutoverDeniedError, MODES, applyEvent, makeInitialState } from "../src/release-state-machine.mjs";
import {
  advanceInstant,
  buildProductionCandidate,
  buildReceipt,
  createProductionContext,
  digest,
  productionEvent,
  refreshProductionReceipts,
} from "./helpers.mjs";

const FOUNDATION_GATES = ["additive_migration_validation", "backwards_compatibility_validation", "n_minus_one_compatibility"];
const PROMOTION_GATES = [
  "migration_applied_and_compatible", "backfill_reconciled", "shadow_parity_pass", "search_quality_release_gate",
  "coverage_release_gate", "planner_release_gate", "machine_toolkit_release_gate", "seo_release_gate",
  "production_like_2x_load_gate", "managed_recovery_gate", "n_minus_one_compatibility",
  "cross_version_asset_matrix_zero_404", "v1_translation_compatibility",
];

function at(seconds) {
  return new Date(Date.parse("2026-08-30T00:00:00.000Z") + seconds * 1000).toISOString();
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof CutoverDeniedError && error.code === code, code);
}

function applyProduction(state, context, nextEvent, gateEnvironment, gateNames = []) {
  refreshProductionReceipts(context, nextEvent.occurred_at, { gateEnvironment, gateNames });
  return applyEvent(state, nextEvent, context);
}

function telemetryAndBundle(context, candidate, percent, eventAt, anchorAt, suffix) {
  const telemetry_sample = passingTelemetry("live_production_test_port_evidence");
  const rollback_bundle = buildRollbackBundle(candidate, {
    anchor_at: anchorAt,
    prepared_at: anchorAt,
    support_window_days: 45,
    suffix,
  });
  return {
    telemetry_sample,
    telemetry_receipt: buildReceipt(context, {
      id: `telemetry:${percent}:${suffix}`,
      kind: "promotion_telemetry",
      subject: `public-promotion:${percent}`,
      environment: "production_public",
      evidence_sha256: digest(telemetry_sample),
      at: eventAt,
    }),
    rollback_bundle,
    rollback_bundle_receipt: buildReceipt(context, {
      id: `bundle:${percent}:${suffix}`,
      kind: "rollback_bundle",
      subject: rollback_bundle.bundle_id,
      environment: "production_public",
      evidence_sha256: rollback_bundle.bundle_sha256,
      at: eventAt,
    }),
  };
}

function driveToPublic100() {
  const { candidate, context } = createProductionContext();
  let state = makeInitialState({ mode: MODES.PRODUCTION, candidate, policy: context.policy });
  state = applyProduction(state, context, productionEvent("prepare_expand", at(1), "1"), "production_foundation_no_traffic", FOUNDATION_GATES);
  state = applyProduction(state, context, productionEvent("apply_expand", at(2), "2"));
  state = applyProduction(state, context, productionEvent("complete_backfill", at(3), "3", {
    backfill: { aliases_preserved: true, unresolved_identity_preserved: true, shared_history_discarded: false, import_receipt_sha256: digest({ import: "production-test" }) },
  }), "staging", ["migration_applied_and_compatible", "backfill_reconciled"]);
  state = applyProduction(state, context, productionEvent("complete_shadow", at(4), "4", {
    shadow: { public_reads_remained_static: true, static_candidate_fixture_parity: true, planner_inputs: "frozen_or_synthetic_only" },
  }), "staging", ["shadow_parity_pass"]);
  state = applyProduction(state, context, productionEvent("start_internal_canary", at(5), "5", {
    canary: { candidate_exists_at_zero_percent: true, access_protected: true, version_selection: "server_injected", public_override_headers_allowed: false },
  }), "production_internal_canary", ["shadow_parity_pass", "static_fallback_rehearsed", "generation_rollback_rehearsed"]);
  const anchorAt = at(6);
  for (const [index, percent] of [1, 5, 25, 50, 100].entries()) {
    const eventAt = at(6 + index);
    refreshProductionReceipts(context, eventAt, { gateEnvironment: "production_public", gateNames: PROMOTION_GATES });
    const fields = telemetryAndBundle(context, candidate, percent, eventAt, anchorAt, `production-${percent}`);
    state = applyEvent(state, productionEvent("promote_public", eventAt, `promotion-${percent}`, { percent, ...fields }), context);
  }
  return { candidate, context, state, anchorAt };
}

function recordLiveCycle(state, context, candidate, { kind, cycle, eventAt }) {
  refreshProductionReceipts(context, eventAt);
  const connector = kind === "connector_reconciliation";
  const extra = {
    cycle_kind: kind,
    cycle_id: `production-${kind}-${cycle}`,
    connector_run_id: connector ? `production-connector-run-${cycle}` : undefined,
    index_generation_id: connector ? undefined : `production-index-generation-${cycle}`,
    evidence_class: "live_launch_cycle",
    environment: "production_public",
    outcome: { attempted: 1, succeeded: 1, failed: 0 },
  };
  const descriptor = {
    cycle_kind: extra.cycle_kind,
    cycle_id: extra.cycle_id,
    connector_run_id: extra.connector_run_id ?? null,
    index_generation_id: extra.index_generation_id ?? null,
    candidate_digest_sha256: candidate.candidate_digest_sha256,
    environment: extra.environment,
    occurred_at: eventAt,
    outcome: extra.outcome,
  };
  extra.cycle_receipt = buildReceipt(context, {
    id: `cycle:${kind}:${cycle}`,
    kind: "launch_cycle",
    subject: extra.cycle_id,
    environment: "production_public",
    evidence_sha256: digest(descriptor),
    at: eventAt,
  });
  return applyEvent(state, productionEvent("record_cycle", eventAt, `${kind}-${cycle}`, extra), context);
}

test("current local candidate and missing trusted ports fail closed", () => {
  const candidate = buildCandidateSnapshot();
  const policy = loadPolicy();
  const state = makeInitialState({ mode: MODES.PRODUCTION, candidate, policy });
  const nextEvent = productionEvent("prepare_expand", at(1), "local");
  expectCode(() => applyEvent(state, nextEvent, { candidate, policy }), "TRUSTED_CLOCK_MISSING");
  expectCode(() => applyEvent(state, nextEvent, {
    candidate,
    policy,
    clock: createManualClock(nextEvent.occurred_at, "production"),
  }), "PRODUCTION_CANDIDATE_UNSEALED");
});

test("canonical receipts require a trusted verifier and exact register bytes", () => {
  const { candidate, context } = createProductionContext();
  let state = makeInitialState({ mode: MODES.PRODUCTION, candidate, policy: context.policy });
  const prepare = productionEvent("prepare_expand", at(1), "prepare");
  refreshProductionReceipts(context, prepare.occurred_at, { gateEnvironment: "production_foundation_no_traffic", gateNames: FOUNDATION_GATES });
  const verifier = context.receipt_verifier;
  context.receipt_verifier = undefined;
  expectCode(() => applyEvent(state, prepare, context), "RECEIPT_VERIFIER_MISSING");
  context.receipt_verifier = verifier;
  state = applyEvent(state, prepare, context);

  const apply = productionEvent("apply_expand", at(2), "apply");
  refreshProductionReceipts(context, apply.occurred_at);
  const exactBytes = context.authorization_register_bytes;
  context.authorization_register_bytes = Buffer.from("{}\n");
  expectCode(() => applyEvent(state, apply, context), "AUTHORIZATION_REGISTER_BYTES_DRIFT");
  context.authorization_register_bytes = exactBytes;
  context.authorization_register = structuredClone(loadAuthorizationRegister());
  expectCode(() => applyEvent(state, apply, context), "AUTHORIZATION_REGISTER_OBJECT_DRIFT");
});

test("receipt digest, candidate/environment binding, expiry, nonce replay, and trusted time are enforced", () => {
  const { candidate, context } = createProductionContext();
  const state = makeInitialState({ mode: MODES.PRODUCTION, candidate, policy: context.policy });
  const prepare = productionEvent("prepare_expand", at(1), "receipt-check");
  refreshProductionReceipts(context, prepare.occurred_at, { gateEnvironment: "production_foundation_no_traffic", gateNames: FOUNDATION_GATES });

  const altered = structuredClone(context.release_candidate_receipt);
  altered.environment = "staging";
  context.release_candidate_receipt = altered;
  expectCode(() => applyEvent(state, prepare, context), "EVIDENCE_RECEIPT_DIGEST_MISMATCH");

  const { candidate: otherCandidate } = buildProductionCandidate({ id: "wp14-cross-candidate-receipt" });
  context.release_candidate_receipt = buildReceipt(context, {
    id: "cross-candidate",
    kind: "release_candidate",
    subject: candidate.candidate_id,
    environment: "production",
    evidence_sha256: candidate.release_gate.receipt_sha256,
    candidate: otherCandidate,
    at: prepare.occurred_at,
  });
  expectCode(() => applyEvent(state, prepare, context), "EVIDENCE_RECEIPT_BINDING_INVALID");
  context.release_candidate_receipt = buildReceipt(context, {
    id: "cross-environment",
    kind: "release_candidate",
    subject: candidate.candidate_id,
    environment: "staging",
    evidence_sha256: candidate.release_gate.receipt_sha256,
    at: prepare.occurred_at,
  });
  expectCode(() => applyEvent(state, prepare, context), "EVIDENCE_RECEIPT_BINDING_INVALID");

  refreshProductionReceipts(context, prepare.occurred_at, { gateEnvironment: "production_foundation_no_traffic", gateNames: FOUNDATION_GATES });
  context.clock.set(at(120));
  expectCode(() => applyEvent(state, { ...prepare, occurred_at: at(120) }, context), "EVIDENCE_RECEIPT_BINDING_INVALID");

  refreshProductionReceipts(context, at(1), { gateEnvironment: "production_foundation_no_traffic", gateNames: FOUNDATION_GATES });
  context.clock.set(at(1));
  expectCode(() => applyEvent(state, { ...prepare, occurred_at: at(2) }, context), "EVENT_TIME_FUTURE");

  const usedReleaseReceipt = context.release_candidate_receipt;
  const committed = applyEvent(state, prepare, context);
  const replay = { ...productionEvent("prepare_expand", at(2), "new-event"), event_id: prepare.event_id };
  refreshProductionReceipts(context, replay.occurred_at, { gateEnvironment: "production_foundation_no_traffic", gateNames: FOUNDATION_GATES });
  expectCode(() => applyEvent(committed, replay, context), "EVENT_ID_REPLAY");

  const apply = productionEvent("apply_expand", at(2), "receipt-replay");
  refreshProductionReceipts(context, apply.occurred_at);
  context.release_candidate_receipt = usedReleaseReceipt;
  expectCode(() => applyEvent(committed, apply, context), "RECEIPT_REPLAY");
});

test("promotion selects generation N and generation, Worker, and static rollbacks are distinct non-noop operations", () => {
  const { candidate, context, state } = driveToPublic100();
  assert.equal(state.active_search_generation, candidate.fixture_topology.search_generation_n);
  assert.equal(state.active_worker_version, candidate.fixture_topology.worker_version_n);
  assert.equal(state.worker_traffic_percent.candidate, 100);
  assert.equal(state.public_read_backend, "database_generation_pinned");

  const storedBundle = buildRollbackBundle(candidate, {
    anchor_at: state.rollback_bundle.support_window_anchor_at,
    prepared_at: state.rollback_bundle.support_window_anchor_at,
    support_window_days: 45,
    suffix: "production-100",
  });
  const generationAt = at(20);
  refreshProductionReceipts(context, generationAt);
  const generationReceipt = buildReceipt(context, { id: "generation-rollback-bundle", kind: "rollback_bundle", subject: storedBundle.bundle_id, environment: "production_public", evidence_sha256: storedBundle.bundle_sha256, at: generationAt });
  let rolled = applyEvent(state, productionEvent("rollback_generation", generationAt, "generation", {
    expected_from_generation: candidate.fixture_topology.search_generation_n,
    to_generation: candidate.fixture_topology.search_generation_n_minus_one,
    canonical_storage_reverted: false,
    rollback_bundle: storedBundle,
    rollback_bundle_receipt: generationReceipt,
  }), context);
  assert.equal(rolled.active_search_generation, candidate.fixture_topology.search_generation_n_minus_one);
  assert.equal(rolled.active_worker_version, candidate.fixture_topology.worker_version_n);
  assert.equal(rolled.public_read_backend, "database_generation_pinned");
  refreshProductionReceipts(context, at(21));
  expectCode(() => applyEvent(rolled, productionEvent("rollback_generation", at(21), "generation-noop", {
    expected_from_generation: candidate.fixture_topology.search_generation_n,
    to_generation: candidate.fixture_topology.search_generation_n_minus_one,
    canonical_storage_reverted: false,
    rollback_bundle: storedBundle,
    rollback_bundle_receipt: buildReceipt(context, { id: "generation-noop", kind: "rollback_bundle", subject: storedBundle.bundle_id, environment: "production_public", evidence_sha256: storedBundle.bundle_sha256, at: at(21) }),
  }), context), "GENERATION_ROLLBACK_NOOP");

  const workerAt = at(22);
  refreshProductionReceipts(context, workerAt);
  rolled = applyEvent(rolled, productionEvent("rollback_worker", workerAt, "worker", {
    expected_candidate_worker: candidate.fixture_topology.worker_version_n,
    to_worker_version: candidate.fixture_topology.worker_version_n_minus_one,
    assets_rolled_back_with_worker: true,
    storage_reverted: false,
    rollback_bundle: storedBundle,
    rollback_bundle_receipt: buildReceipt(context, { id: "worker-rollback", kind: "rollback_bundle", subject: storedBundle.bundle_id, environment: "production_public", evidence_sha256: storedBundle.bundle_sha256, at: workerAt }),
  }), context);
  assert.equal(rolled.active_worker_version, candidate.fixture_topology.worker_version_n_minus_one);
  assert.equal(rolled.public_read_backend, "n_minus_one_worker");

  const staticAt = at(23);
  refreshProductionReceipts(context, staticAt);
  rolled = applyEvent(rolled, productionEvent("activate_static_fallback", staticAt, "static", {
    all_public_surfaces: true,
    database_independent: true,
    static_artifact_sha256: candidate.fixture_topology.static_artifact_sha256,
    rollback_bundle: storedBundle,
    rollback_bundle_receipt: buildReceipt(context, { id: "static-fallback", kind: "rollback_bundle", subject: storedBundle.bundle_id, environment: "production_public", evidence_sha256: storedBundle.bundle_sha256, at: staticAt }),
  }), context);
  assert.equal(rolled.active_worker_version, candidate.fixture_topology.static_emergency_worker_version);
  assert.equal(rolled.worker_traffic_percent.static_emergency, 100);
  assert.equal(rolled.public_read_backend, "immutable_static_jsonl");
  refreshProductionReceipts(context, at(24));
  expectCode(() => applyEvent(rolled, productionEvent("activate_static_fallback", at(24), "static-noop"), context), "STATIC_FALLBACK_NOOP");
});

test("production cycles use distinct IDs, exact time windows and successful denominators before independent post-removal retirement", () => {
  const { candidate, context, state: publicState } = driveToPublic100();
  let state = applyProduction(publicState, context, productionEvent("start_soak", at(11), "soak-start"), "production_soak", ["support_retention_lock", "alert_oncall_ownership", "incident_process_ready"]);
  state = recordLiveCycle(state, context, candidate, { kind: "connector_reconciliation", cycle: 1, eventAt: at(12) });
  const firstCycleState = state;
  state = recordLiveCycle(state, context, candidate, { kind: "connector_reconciliation", cycle: 2, eventAt: at(13) });
  state = recordLiveCycle(state, context, candidate, { kind: "rebuild_promote_rollback", cycle: 1, eventAt: at(14) });
  state = recordLiveCycle(state, context, candidate, { kind: "rebuild_promote_rollback", cycle: 2, eventAt: at(15) });
  assert.equal(state.cycles.connector_reconciliation.length, 2);
  assert.equal(state.cycles.rebuild_promote_rollback.length, 2);
  assert.equal(new Set([...state.cycles.connector_reconciliation, ...state.cycles.rebuild_promote_rollback].map((item) => item.receipt_sha256)).size, 4);

  const duplicateAt = at(16);
  refreshProductionReceipts(context, duplicateAt);
  const prior = firstCycleState.cycles.connector_reconciliation[0];
  expectCode(() => applyEvent(firstCycleState, productionEvent("record_cycle", duplicateAt, "duplicate-cycle", {
    cycle_kind: "connector_reconciliation",
    cycle_id: prior.cycle_id,
  }), context), "CYCLE_ID_REPLAY");

  refreshProductionReceipts(context, duplicateAt);
  expectCode(() => applyEvent(state, productionEvent("record_cycle", duplicateAt, "connector-run-replay", {
    cycle_kind: "connector_reconciliation",
    cycle_id: "production-connector-new-cycle",
    connector_run_id: state.cycles.connector_reconciliation[0].connector_run_id,
    evidence_class: "live_launch_cycle",
    environment: "production_public",
    outcome: { attempted: 1, succeeded: 1, failed: 0 },
  }), context), "CONNECTOR_RUN_ID_REPLAY");
  refreshProductionReceipts(context, duplicateAt);
  expectCode(() => applyEvent(state, productionEvent("record_cycle", duplicateAt, "generation-replay", {
    cycle_kind: "rebuild_promote_rollback",
    cycle_id: "production-rebuild-new-cycle",
    index_generation_id: state.cycles.rebuild_promote_rollback[0].index_generation_id,
    evidence_class: "live_launch_cycle",
    environment: "production_public",
    outcome: { attempted: 1, succeeded: 1, failed: 0 },
  }), context), "INDEX_GENERATION_ID_REPLAY");
  refreshProductionReceipts(context, duplicateAt);
  expectCode(() => applyEvent(state, productionEvent("record_cycle", duplicateAt, "failed-denominator", {
    cycle_kind: "connector_reconciliation",
    cycle_id: "production-failed-denominator",
    connector_run_id: "production-connector-run-failed",
    evidence_class: "live_launch_cycle",
    environment: "production_public",
    outcome: { attempted: 2, succeeded: 1, failed: 1 },
  }), context), "CYCLE_OUTCOME_NOT_SUCCESSFUL");

  const outsideAt = advanceInstant(state.rollback_bundle.support_expires_at);
  refreshProductionReceipts(context, outsideAt);
  expectCode(() => applyEvent(state, productionEvent("record_cycle", outsideAt, "outside-window", {
    cycle_kind: "connector_reconciliation",
    cycle_id: "production-outside-window",
    connector_run_id: "production-connector-run-outside",
    evidence_class: "live_launch_cycle",
    environment: "production_public",
    outcome: { attempted: 1, succeeded: 1, failed: 0 },
  }), context), "CYCLE_OUTSIDE_SOAK_WINDOW");

  const completeAt = new Date(Date.parse(publicState.rollback_window.one_hundred_percent_at) + 30 * 86_400_000 + 1000).toISOString();
  refreshProductionReceipts(context, completeAt, {
    gateEnvironment: "production_soak",
    gateNames: ["no_unresolved_coverage_or_visibility_incident", "queue_and_outbox_age_slo", "all_dlq_and_workflows_resolved_or_owned", "managed_alerts_exercised", "no_unresolved_sev1_or_sev2_final_interval"],
  });
  const soakEvidence = {
    candidate_digest_sha256: candidate.candidate_digest_sha256,
    one_hundred_percent_at: state.rollback_window.one_hundred_percent_at,
    completed_at: completeAt,
    connector_cycle_receipts: state.cycles.connector_reconciliation.map((cycle) => cycle.receipt_sha256),
    rebuild_cycle_receipts: state.cycles.rebuild_promote_rollback.map((cycle) => cycle.receipt_sha256),
    rollback_bundle_sha256: state.rollback_bundle.bundle_sha256,
  };
  state = applyEvent(state, productionEvent("complete_soak", completeAt, "soak-complete", {
    soak_receipt: buildReceipt(context, { id: "soak-complete", kind: "production_gate", subject: "complete_soak", environment: "production_soak", evidence_sha256: digest(soakEvidence), at: completeAt }),
  }), context);

  const eligibleAt = advanceInstant(completeAt);
  state = applyProduction(state, context, productionEvent("mark_retirement_eligible", eligibleAt, "retirement-eligible"), "production_runtime", ["n_minus_one_dependency_audit", "static_emergency_artifact_healthy", "managed_failover_measured", "pitr_measured", "static_drill_measured"]);
  const retireAt = advanceInstant(eligibleAt);
  refreshProductionReceipts(context, retireAt);
  expectCode(() => applyEvent(state, productionEvent("retire_runtime_jsonl", retireAt, "retire-self-attested", {
    post_removal_candidate: candidate,
    runtime_loader_removed: true,
    post_removal_release_receipt: digest({ formatted: "sha-only" }),
    retirement_receipt: digest({ formatted: "sha-only" }),
  }), context), "POST_REMOVAL_CANDIDATE_INVALID");

  const { candidate: postCandidate } = buildProductionCandidate({ id: "wp14-post-removal-production-candidate", postRemoval: true });
  refreshProductionReceipts(context, retireAt);
  expectCode(() => applyEvent(state, productionEvent("retire_runtime_jsonl", retireAt, "retire-sha-only", {
    post_removal_candidate: postCandidate,
    post_removal_release_receipt: digest({ formatted: "sha-only" }),
    retirement_receipt: digest({ formatted: "sha-only" }),
  }), context), "EVIDENCE_RECEIPT_SCHEMA_INVALID");

  refreshProductionReceipts(context, retireAt);
  const postReleaseReceipt = buildReceipt(context, {
    id: "post-removal-release",
    kind: "release_candidate",
    subject: postCandidate.candidate_id,
    environment: "production",
    evidence_sha256: postCandidate.release_gate.receipt_sha256,
    candidate: postCandidate,
    at: retireAt,
  });
  const retirementEvidence = {
    prior_candidate_digest_sha256: candidate.candidate_digest_sha256,
    post_removal_candidate_digest_sha256: postCandidate.candidate_digest_sha256,
    soak_receipt_sha256: state.soak_receipt_sha256,
    authorization_receipt_sha256: state.retirement_authorization_receipt_sha256,
    post_removal_release_receipt_sha256: postReleaseReceipt.receipt_sha256,
    runtime_boundary: postCandidate.runtime_boundary,
  };
  state = applyEvent(state, productionEvent("retire_runtime_jsonl", retireAt, "retire", {
    post_removal_candidate: postCandidate,
    post_removal_release_receipt: postReleaseReceipt,
    retirement_receipt: buildReceipt(context, { id: "runtime-jsonl-retirement", kind: "retirement", subject: "runtime-jsonl-retirement", environment: "production_runtime", evidence_sha256: digest(retirementEvidence), candidate: postCandidate, at: retireAt }),
  }), context);
  assert.equal(state.stage, "retired");
  assert.equal(state.runtime_jsonl_active, false);
  assert.equal(state.candidate_digest_sha256, postCandidate.candidate_digest_sha256);
  assert.equal(state.previous_candidate_digest_sha256, candidate.candidate_digest_sha256);
});

test("policy maps all seven central authorizations to a blocking stage", () => {
  const policy = loadPolicy();
  const mapped = new Set(Object.values(policy.central_authorization_gates).flat());
  assert.deepEqual(mapped, new Set(["AUTH-03", "AUTH-05", "AUTH-06", "AUTH-07", "AUTH-08", "AUTH-09", "AUTH-11"]));
});
