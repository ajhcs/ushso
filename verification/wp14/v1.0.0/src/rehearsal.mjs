import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { packageRoot, readJson, sha256Json, withCanonicalDigest } from "./common.mjs";
import { buildCandidateSnapshot } from "./candidate-snapshot.mjs";
import { buildEvidenceReceipt, createFixtureReceiptAuthority } from "./evidence-receipts.mjs";
import {
  CutoverDeniedError,
  MODES,
  applyEvent,
  evaluateTelemetry,
  makeInitialState,
  sealState,
  verifyRollbackBundle,
} from "./release-state-machine.mjs";

export function loadPolicy() {
  return readJson(resolve(packageRoot, "policy/cutover-policy.v1.0.0.json"));
}

export function loadAuthorizationRegister() {
  return readJson(resolve(packageRoot, "../../external-authorization/v1.0.0/register.json"));
}

export function loadAuthorizationRegisterBytes() {
  return readFileSync(resolve(packageRoot, "../../external-authorization/v1.0.0/register.json"));
}

function digestFixture(value) {
  return `sha256:${sha256Json(value)}`;
}

export function passingTelemetry(evidenceClass = "fixture_only_not_load_evidence") {
  return {
    evidence_class: evidenceClass,
    planner_enabled: false,
    contract_error_count: 0,
    visibility_safety_violation_count: 0,
    generation_consistency_error_count: 0,
    asset_404_count: 0,
    coverage_partition_reconciliation_failures: 0,
    raw_user_question_persist_count: 0,
    source_or_analysis_action_count: 0,
    public_error_rate: 0,
    search_p95_ms: 420,
    search_p99_ms: 900,
    outbox_oldest_pending_seconds: 30,
    dlq_unresolved_count: 0,
    workflow_terminal_error_count_5m: 0,
  };
}

export function runShadowParity() {
  const fixture = readJson(resolve(packageRoot, "fixtures/shadow-parity-cases.json"));
  const results = fixture.cases.map((item) => ({
    case_id: item.case_id,
    surface: item.surface,
    pass: sha256Json(item.static) === sha256Json(item.candidate),
    static_sha256: digestFixture(item.static),
    candidate_sha256: digestFixture(item.candidate),
  }));
  return {
    evidence_class: fixture.evidence_class,
    contains_raw_user_queries: fixture.contains_raw_user_queries,
    contains_source_payloads: fixture.contains_source_payloads,
    case_count: results.length,
    passed: results.every((result) => result.pass),
    results,
  };
}

export function createManualClock(initial = "2026-08-30T00:00:00.000Z", trustClass = "fixture_only") {
  let value = initial;
  return {
    trust_class: trustClass,
    now: () => value,
    set: (next) => { value = next; },
  };
}

function baseContext(candidate, policy, register) {
  const authority = createFixtureReceiptAuthority();
  return {
    candidate,
    policy,
    authorization_register: register,
    authorization_register_bytes: loadAuthorizationRegisterBytes(),
    authorization_receipts: {},
    production_gate_receipts: {},
    release_candidate_receipt: null,
    receipt_verifier: authority,
    receipt_authority: authority,
    clock: createManualClock(),
    execution_boundary: {
      network_requests: 0,
      provider_mutations: 0,
      deployments: 0,
      public_requests: 0,
      source_requests: 0,
      payload_downloads: 0,
      analyses_executed: 0,
      raw_user_queries_persisted: 0,
    },
  };
}

function timestamp(baseMinute) {
  return new Date(Date.UTC(2026, 7, 30) + baseMinute * 60_000).toISOString();
}

function event(type, minute, extra = {}) {
  return { type, event_id: `fixture:${type}:${minute}`, occurred_at: timestamp(minute), simulated: true, ...extra };
}

function applyAt(state, nextEvent, context) {
  context.clock.set(nextEvent.occurred_at);
  return applyEvent(state, nextEvent, context);
}

function fixtureReceipt(context, candidate, {
  id,
  kind,
  subject,
  environment = "local_fixture_only",
  decision = "PASS",
  evidence_sha256,
  at,
}) {
  const issued = new Date(Date.parse(at) - 1000).toISOString();
  const maxSeconds = context.policy.receipt_max_validity_seconds[kind];
  const expires = new Date(Date.parse(issued) + Math.min(maxSeconds, 300) * 1000).toISOString();
  return buildEvidenceReceipt({
    receipt_id: `fixture-receipt:${id}`,
    receipt_kind: kind,
    subject_id: subject,
    candidate_digest_sha256: candidate.candidate_digest_sha256,
    environment,
    issued_at: issued,
    expires_at: expires,
    nonce: `fixture-nonce:${id}:v1`,
    decision,
    evidence_sha256,
    authority: context.receipt_authority,
  });
}

const RESOURCE_ROLES = [
  "worker_n_minus_one", "worker_n", "hyperdrive_correctness", "hyperdrive_immutable_read",
  "r2_capture", "r2_archive", "queue_primary", "queue_dlq", "workflow",
  "publication_manifest_n_minus_one", "publication_manifest_n", "search_generation_n_minus_one",
  "search_generation_n", "asset_bundle_n_minus_one", "asset_bundle_n", "static_emergency_artifact",
];

export function buildRollbackBundle(candidate, {
  anchor_at = "2026-08-30T00:00:00.000Z",
  prepared_at = anchor_at,
  support_window_days = 45,
  suffix = "fixture",
} = {}) {
  const oldPublication = `fixture:publication-manifest:n-1:${suffix}`;
  const newPublication = `fixture:publication-manifest:n:${suffix}`;
  const exactIds = {
    worker_n_minus_one: candidate.fixture_topology.worker_version_n_minus_one,
    worker_n: candidate.fixture_topology.worker_version_n,
    hyperdrive_correctness: `fixture:hyperdrive:correctness:${suffix}`,
    hyperdrive_immutable_read: `fixture:hyperdrive:immutable:${suffix}`,
    r2_capture: `fixture:r2:capture:${suffix}`,
    r2_archive: `fixture:r2:archive:${suffix}`,
    queue_primary: `fixture:queue:primary:${suffix}`,
    queue_dlq: `fixture:queue:dlq:${suffix}`,
    workflow: `fixture:workflow:harvest:${suffix}`,
    publication_manifest_n_minus_one: oldPublication,
    publication_manifest_n: newPublication,
    search_generation_n_minus_one: candidate.fixture_topology.search_generation_n_minus_one,
    search_generation_n: candidate.fixture_topology.search_generation_n,
    asset_bundle_n_minus_one: candidate.fixture_topology.asset_bundle_n_minus_one_sha256,
    asset_bundle_n: candidate.fixture_topology.asset_bundle_n_sha256,
    static_emergency_artifact: candidate.fixture_topology.static_artifact_sha256,
  };
  const bindingRoles = new Set(["hyperdrive_correctness", "hyperdrive_immutable_read", "r2_capture", "r2_archive", "queue_primary", "queue_dlq", "workflow"]);
  const draft = {
    schema_version: "ushso-wp14-rollback-bundle.v1.0.0",
    bundle_id: `rollback-bundle:${suffix}`,
    candidate_digest_sha256: candidate.candidate_digest_sha256,
    prepared_at,
    support_window_anchor_at: anchor_at,
    support_window_days,
    support_expires_at: new Date(Date.parse(anchor_at) + support_window_days * 86_400_000).toISOString(),
    old_worker_version_id: candidate.fixture_topology.worker_version_n_minus_one,
    new_worker_version_id: candidate.fixture_topology.worker_version_n,
    database_compatibility_watermark: `fixture:additive-schema:${suffix}`,
    old_publication_manifest_id: oldPublication,
    new_publication_manifest_id: newPublication,
    old_search_generation_id: candidate.fixture_topology.search_generation_n_minus_one,
    new_search_generation_id: candidate.fixture_topology.search_generation_n,
    old_asset_bundle_sha256: candidate.fixture_topology.asset_bundle_n_minus_one_sha256,
    new_asset_bundle_sha256: candidate.fixture_topology.asset_bundle_n_sha256,
    static_export_sha256: candidate.fixture_topology.static_artifact_sha256,
    resources: RESOURCE_ROLES.map((role) => ({ role, resource_id: exactIds[role], binding_name: bindingRoles.has(role) ? `BINDING_${role.toUpperCase()}` : null })),
    reason: "fixture-only exact rollback bundle",
    operator: "fixture:release-operator",
    verification_receipt_sha256: digestFixture({ suffix, verification: "fixture-only" }),
    n_minus_one_current_schema_compatible: true,
    cross_version_asset_404_count: 0,
    storage_rollback_claimed: false,
    destructive_down_migration_included: false,
  };
  return withCanonicalDigest(draft, "bundle_sha256");
}

function bundleFields(context, candidate, minute, suffix, anchorAt = timestamp(minute)) {
  const at = timestamp(minute);
  const rollback_bundle = buildRollbackBundle(candidate, { anchor_at: anchorAt, prepared_at: anchorAt, suffix });
  const rollback_bundle_receipt = fixtureReceipt(context, candidate, {
    id: `bundle:${suffix}:${minute}`,
    kind: "rollback_bundle",
    subject: rollback_bundle.bundle_id,
    evidence_sha256: rollback_bundle.bundle_sha256,
    at,
  });
  return { rollback_bundle, rollback_bundle_receipt };
}

function telemetryFields(context, candidate, minute, percent, sample = passingTelemetry()) {
  const at = timestamp(minute);
  return {
    telemetry_sample: sample,
    telemetry_receipt: fixtureReceipt(context, candidate, {
      id: `telemetry:${minute}:${percent}`,
      kind: "promotion_telemetry",
      subject: `public-promotion:${percent}`,
      evidence_sha256: digestFixture(sample),
      at,
    }),
  };
}

function rollbackFields(context, candidate, state, minute, id) {
  const bundle = buildRollbackBundle(candidate, {
    anchor_at: state.rollback_bundle.support_window_anchor_at,
    prepared_at: state.rollback_bundle.support_window_anchor_at,
    suffix: state.rollback_bundle.bundle_id.replace("rollback-bundle:", ""),
  });
  if (bundle.bundle_sha256 !== state.rollback_bundle.bundle_sha256) throw new Error("fixture rollback bundle reconstruction drifted");
  return {
    rollback_bundle: bundle,
    rollback_bundle_receipt: fixtureReceipt(context, candidate, {
      id: `bundle-use:${id}:${minute}`,
      kind: "rollback_bundle",
      subject: bundle.bundle_id,
      evidence_sha256: bundle.bundle_sha256,
      at: timestamp(minute),
    }),
  };
}

function stageFixtureFoundation(state, context, offset) {
  let next = applyAt(state, event("prepare_expand", offset + 1), context);
  next = applyAt(next, event("apply_expand", offset + 2), context);
  next = applyAt(next, event("complete_backfill", offset + 3, {
    backfill: { aliases_preserved: true, unresolved_identity_preserved: true, shared_history_discarded: false, import_receipt_sha256: digestFixture({ offset, operation: "fixture_backfill" }) },
  }), context);
  return applyAt(next, event("complete_shadow", offset + 4, {
    shadow: { public_reads_remained_static: true, static_candidate_fixture_parity: true, planner_inputs: "frozen_or_synthetic_only" },
  }), context);
}

function stageCanaryAndPromote(state, context, candidate, offset) {
  let next = applyAt(state, event("start_internal_canary", offset + 5, {
    canary: { candidate_exists_at_zero_percent: true, access_protected: true, version_selection: "server_injected", public_override_headers_allowed: false },
  }), context);
  const cutoverAnchor = timestamp(offset + 6);
  for (const [index, percent] of [1, 5, 25, 50, 100].entries()) {
    const minute = offset + 6 + index;
    next = applyAt(next, event("promote_public", minute, {
      percent,
      ...telemetryFields(context, candidate, minute, percent),
      ...bundleFields(context, candidate, minute, `cycle-${offset}-${percent}`, cutoverAnchor),
    }), context);
  }
  return next;
}

function recordFixtureCycle(state, context, candidate, minute, cycle, kind) {
  const connector = kind === "connector_reconciliation";
  const extra = {
    cycle_kind: kind,
    cycle_id: `fixture-${kind}-${cycle}`,
    connector_run_id: connector ? `fixture-connector-run-${cycle}` : undefined,
    index_generation_id: connector ? undefined : `fixture-index-generation-${cycle}`,
    evidence_class: "fixture_rehearsal_only",
    environment: "local_fixture_only",
    outcome: { attempted: 1, succeeded: 1, failed: 0 },
  };
  const descriptor = {
    cycle_kind: extra.cycle_kind,
    cycle_id: extra.cycle_id,
    connector_run_id: extra.connector_run_id ?? null,
    index_generation_id: extra.index_generation_id ?? null,
    candidate_digest_sha256: candidate.candidate_digest_sha256,
    environment: extra.environment,
    occurred_at: timestamp(minute),
    outcome: extra.outcome,
  };
  extra.cycle_receipt = fixtureReceipt(context, candidate, {
    id: `cycle:${kind}:${cycle}`,
    kind: "launch_cycle",
    subject: extra.cycle_id,
    evidence_sha256: digestFixture(descriptor),
    at: timestamp(minute),
  });
  return applyAt(state, event("record_cycle", minute, extra), context);
}

function runOneFixtureCycle(candidate, policy, register, cycle) {
  const context = baseContext(candidate, policy, register);
  const offset = cycle * 100;
  let state = makeInitialState({ mode: MODES.FIXTURE, candidate, policy });
  state = stageFixtureFoundation(state, context, offset);
  const shadowState = state;
  state = stageCanaryAndPromote(state, context, candidate, offset);
  const publicState = state;
  state = recordFixtureCycle(state, context, candidate, offset + 20, cycle, "connector_reconciliation");
  state = recordFixtureCycle(state, context, candidate, offset + 21, cycle, "rebuild_promote_rollback");
  const recordedState = state;
  const generationMinute = offset + 30;
  state = applyAt(state, event("rollback_generation", generationMinute, {
    expected_from_generation: candidate.fixture_topology.search_generation_n,
    to_generation: candidate.fixture_topology.search_generation_n_minus_one,
    canonical_storage_reverted: false,
    ...rollbackFields(context, candidate, state, generationMinute, `generation-${cycle}`),
    reason: "fixture failure injection: candidate generation mismatch",
  }), context);
  const afterGenerationRollback = state;
  const workerMinute = offset + 31;
  state = applyAt(state, event("rollback_worker", workerMinute, {
    expected_candidate_worker: candidate.fixture_topology.worker_version_n,
    to_worker_version: candidate.fixture_topology.worker_version_n_minus_one,
    assets_rolled_back_with_worker: true,
    storage_reverted: false,
    ...rollbackFields(context, candidate, state, workerMinute, `worker-${cycle}`),
    reason: "fixture failure injection: bad Worker candidate",
  }), context);
  const afterWorkerRollback = state;
  const staticMinute = offset + 32;
  state = applyAt(state, event("activate_static_fallback", staticMinute, {
    all_public_surfaces: true,
    database_independent: true,
    static_artifact_sha256: candidate.fixture_topology.static_artifact_sha256,
    ...rollbackFields(context, candidate, state, staticMinute, `static-${cycle}`),
    reason: "fixture failure injection: database path unavailable",
  }), context);
  return { context, shadowState, publicState, recordedState, afterGenerationRollback, afterWorkerRollback, finalState: state };
}

export function crossVersionAssetMatrix() {
  const rows = [
    ["N-1 Worker", "N-1 HTML", "N-1 assets"],
    ["N-1 Worker", "cached N HTML", "N assets"],
    ["N Worker", "cached N-1 HTML", "N-1 assets"],
    ["N Worker", "N HTML", "N assets"],
  ].map(([worker, html, assets]) => ({ worker, html, assets, fixture_requests: 3, asset_404_count: 0, status: "pass_fixture_shape_only" }));
  return { evidence_class: "fixture_shape_only_not_asset_fetch_evidence", rows, total_fixture_requests: 12, asset_404_count: 0, production_traffic_requests: 0 };
}

function expectDenied(id, fn, expectedCode) {
  try {
    fn();
    return { id, pass: false, expected_code: expectedCode, actual_code: "NO_DENIAL" };
  } catch (error) {
    if (!(error instanceof CutoverDeniedError)) throw error;
    return { id, pass: error.code === expectedCode, expected_code: expectedCode, actual_code: error.code };
  }
}

export function runFailureInjectionMatrix({ candidate, policy, first, second }) {
  const cases = [];
  const { context, shadowState, publicState, recordedState, afterGenerationRollback, afterWorkerRollback, finalState } = second;
  cases.push(expectDenied("promotion-step-skip", () => {
    const canaryEvent = event("start_internal_canary", 390, { canary: { candidate_exists_at_zero_percent: true, access_protected: true, version_selection: "server_injected", public_override_headers_allowed: false } });
    const canary = applyAt(shadowState, canaryEvent, context);
    const minute = 391;
    return applyAt(canary, event("promote_public", minute, { percent: 25, ...telemetryFields(context, candidate, minute, 25), ...bundleFields(context, candidate, minute, "skip") }), context);
  }, "PROMOTION_STEP_INVALID"));
  cases.push(expectDenied("missing-receipt-verifier", () => {
    const localContext = { ...context, receipt_verifier: undefined, clock: createManualClock() };
    const canary = applyAt(shadowState, event("start_internal_canary", 392, { canary: { candidate_exists_at_zero_percent: true, access_protected: true, version_selection: "server_injected", public_override_headers_allowed: false } }), localContext);
    const minute = 393;
    return applyAt(canary, event("promote_public", minute, { percent: 1, ...telemetryFields(context, candidate, minute, 1), ...bundleFields(context, candidate, minute, "missing-verifier") }), localContext);
  }, "RECEIPT_VERIFIER_MISSING"));
  cases.push(expectDenied("future-event", () => {
    const nextEvent = event("record_cycle", 399, {});
    context.clock.set(timestamp(398));
    return applyEvent(publicState, nextEvent, context);
  }, "EVENT_TIME_FUTURE"));
  cases.push(expectDenied("event-id-replay", () => {
    const replay = { ...event("record_cycle", 400), event_id: recordedState.history.at(-1).event_id };
    return applyAt(recordedState, replay, context);
  }, "EVENT_ID_REPLAY"));
  cases.push(expectDenied("generation-rollback-noop", () => {
    const minute = 401;
    return applyAt(afterGenerationRollback, event("rollback_generation", minute, { expected_from_generation: candidate.fixture_topology.search_generation_n, to_generation: candidate.fixture_topology.search_generation_n_minus_one, canonical_storage_reverted: false, ...rollbackFields(context, candidate, afterGenerationRollback, minute, "noop-generation") }), context);
  }, "GENERATION_ROLLBACK_NOOP"));
  cases.push(expectDenied("worker-rollback-noop", () => {
    const minute = 402;
    return applyAt(afterWorkerRollback, event("rollback_worker", minute, { expected_candidate_worker: candidate.fixture_topology.worker_version_n, to_worker_version: candidate.fixture_topology.worker_version_n_minus_one, assets_rolled_back_with_worker: true, storage_reverted: false, ...rollbackFields(context, candidate, afterWorkerRollback, minute, "noop-worker") }), context);
  }, "WORKER_ROLLBACK_NOOP"));
  cases.push(expectDenied("static-fallback-noop", () => {
    const minute = 403;
    return applyAt(finalState, event("activate_static_fallback", minute, { all_public_surfaces: true, database_independent: true, static_artifact_sha256: candidate.fixture_topology.static_artifact_sha256, ...rollbackFields(context, candidate, finalState, minute, "noop-static") }), context);
  }, "STATIC_FALLBACK_NOOP"));
  cases.push(expectDenied("cycle-id-replay", () => {
    const prior = recordedState.cycles.connector_reconciliation[0];
    const minute = 404;
    return recordFixtureCycle(recordedState, context, candidate, minute, prior.cycle_id.replace("fixture-connector_reconciliation-", ""), "connector_reconciliation");
  }, "CYCLE_ID_REPLAY"));
  cases.push(expectDenied("fixture-soak-clock", () => applyAt(publicState, event("start_soak", 405), context), "FIXTURE_CANNOT_START_PRODUCTION_SOAK"));
  cases.push(expectDenied("state-tamper", () => {
    const tampered = structuredClone(publicState);
    tampered.public_traffic_percent = 50;
    return applyAt(tampered, event("start_soak", 406), context);
  }, "STATE_DIGEST_MISMATCH"));
  const invalidBundles = [
    ["missing-support-days", (copy) => { delete copy.support_window_days; }],
    ["nonsense-expiry", (copy) => { copy.support_expires_at = "not-a-date"; }],
    ["expired-window", (copy) => { copy.support_expires_at = "2000-01-01T00:00:00.000Z"; }],
    ["incomplete-inventory", (copy) => { copy.resources.pop(); }],
    ["duplicate-resource-id", (copy) => { copy.resources[1].resource_id = copy.resources[0].resource_id; }],
  ];
  const base = buildRollbackBundle(candidate, { anchor_at: timestamp(410), prepared_at: timestamp(410), suffix: "adversarial" });
  for (const [id, mutate] of invalidBundles) {
    const copy = structuredClone(base);
    mutate(copy);
    const result = verifyRollbackBundle(copy, candidate, policy, { now: timestamp(410), expected_anchor_at: timestamp(410) });
    cases.push({ id: `rollback-bundle:${id}`, pass: result.ok === false, expected_code: "ROLLBACK_BUNDLE_INVALID", actual_code: result.ok ? "NO_DENIAL" : "ROLLBACK_BUNDLE_INVALID" });
  }
  for (const [metric, threshold] of Object.entries(policy.observability_abort_thresholds)) {
    const sample = passingTelemetry();
    if (metric.includes("planner_")) {
      sample.planner_enabled = true;
      sample.planner_p95_ms_if_enabled = 100;
      sample.planner_p99_ms_if_enabled = 100;
    }
    sample[metric] = threshold.value + (Number.isInteger(threshold.value) ? 1 : 0.001);
    const evaluation = evaluateTelemetry(sample, policy);
    cases.push({ id: `abort-threshold:${metric}`, pass: evaluation.abort && evaluation.abort_reasons.includes(metric), expected_code: "ABORT_THRESHOLD_EXCEEDED", actual_code: evaluation.abort ? "ABORT_THRESHOLD_EXCEEDED" : "NO_ABORT" });
  }
  return cases;
}

export function runFixtureRehearsal() {
  const policy = loadPolicy();
  const register = loadAuthorizationRegister();
  const candidate = buildCandidateSnapshot();
  const shadowParity = runShadowParity();
  const first = runOneFixtureCycle(candidate, policy, register, 1);
  const second = runOneFixtureCycle(candidate, policy, register, 2);
  const connectorCycles = [...first.recordedState.cycles.connector_reconciliation, ...second.recordedState.cycles.connector_reconciliation];
  const rebuildCycles = [...first.recordedState.cycles.rebuild_promote_rollback, ...second.recordedState.cycles.rebuild_promote_rollback];
  const failureInjection = runFailureInjectionMatrix({ candidate, policy, first, second });
  const finalState = second.finalState;
  const retainedBundle = buildRollbackBundle(candidate, {
    anchor_at: second.recordedState.rollback_bundle.support_window_anchor_at,
    prepared_at: second.recordedState.rollback_bundle.support_window_anchor_at,
    suffix: second.recordedState.rollback_bundle.bundle_id.replace("rollback-bundle:", ""),
  });
  const retainedBundleVerification = verifyRollbackBundle(retainedBundle, candidate, policy, {
    now: second.recordedState.rollback_bundle.support_window_anchor_at,
    expected_anchor_at: second.recordedState.rollback_bundle.support_window_anchor_at,
  });
  return withCanonicalDigest({
    schema_version: "ushso-wp14-zero-traffic-rehearsal-receipt.v1.0.0",
    receipt_id: "wp14-local-fixture-rehearsal-2026-08-30",
    generated_at: "2026-08-30T00:00:00.000Z",
    evidence_class: "fixture_only_local_zero_traffic",
    candidate_digest_sha256: candidate.candidate_digest_sha256,
    candidate_content_manifest_sha256: candidate.candidate_content_manifest_sha256,
    git_head_commit: candidate.git.head_commit,
    git_head_tree_oid: candidate.git.head_tree_oid,
    exact_production_candidate_sealed: false,
    release_gate_status: candidate.release_gate.status,
    shadow_parity: shadowParity,
    rehearsals: {
      connector_refresh_cycles: connectorCycles,
      rebuild_promote_rollback_cycles: rebuildCycles,
      connector_refresh_cycle_count: connectorCycles.length,
      rebuild_promote_rollback_cycle_count: rebuildCycles.length,
      fixture_cycles_count_toward_production_soak: false,
      generation_pointer_rollback_rehearsed: [first, second].every((cycle) => cycle.publicState.active_search_generation === candidate.fixture_topology.search_generation_n && cycle.afterGenerationRollback.active_search_generation === candidate.fixture_topology.search_generation_n_minus_one),
      worker_and_asset_rollback_rehearsed: [first, second].every((cycle) => cycle.publicState.worker_traffic_percent.candidate === 100 && cycle.afterWorkerRollback.worker_traffic_percent.n_minus_one === 100 && cycle.afterWorkerRollback.active_asset_bundle_sha256 === candidate.fixture_topology.asset_bundle_n_minus_one_sha256),
      static_fallback_rehearsed: [first, second].every((cycle) => cycle.afterWorkerRollback.public_read_backend === "n_minus_one_worker" && cycle.finalState.public_read_backend === "immutable_static_jsonl" && cycle.finalState.worker_traffic_percent.static_emergency === 100),
      pointer_changes_non_noop: true,
      final_public_backend: finalState.public_read_backend,
      final_public_traffic_percent: finalState.public_traffic_percent,
      runtime_jsonl_active: finalState.runtime_jsonl_active,
    },
    n_minus_one: {
      rollback_bundle: retainedBundle,
      rollback_bundle_verification: retainedBundleVerification,
      cross_version_asset_matrix: crossVersionAssetMatrix(),
    },
    failure_injection: { case_count: failureInjection.length, passed: failureInjection.every((item) => item.pass), cases: failureInjection },
    transition_audit: {
      cycle_state_digests: [first.finalState.state_digest_sha256, second.finalState.state_digest_sha256],
      final_cycle_event_count: finalState.history.length,
      final_cycle_history_sha256: digestFixture(finalState.history),
      final_cycle_history: finalState.history,
    },
    final_state_digest_sha256: finalState.state_digest_sha256,
    final_state_history_count: finalState.history.length,
    production_status: { production_like_load_executed: false, live_canary_executed: false, public_cutover_executed: false, soak_started: false, soak_elapsed: false, managed_recovery_executed: false, jsonl_retired: false },
    external_authorization_status: Object.fromEntries(["AUTH-03", "AUTH-05", "AUTH-06", "AUTH-07", "AUTH-08", "AUTH-09", "AUTH-11"].map((id) => { const entry = register.entries.find((item) => item.id === id); return [id, { status: entry.status, authorized: entry.authorized, environment: entry.environment }]; })),
    execution_boundary: first.context.execution_boundary,
    claims_denied: ["production-like load passed", "live internal canary ran", "public traffic was promoted", "30-day soak started or elapsed", "managed recovery ran", "runtime JSONL was retired", "fixture cycles satisfy the production soak denominator"],
  }, "receipt_sha256");
}
