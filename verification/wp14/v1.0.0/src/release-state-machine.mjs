import {
  assert,
  canonicalJson,
  clone,
  isSha256,
  sha256Bytes,
  sha256Json,
  verifyCanonicalDigest,
  withCanonicalDigest,
} from "./common.mjs";
import { verifyEvidenceReceipt } from "./evidence-receipts.mjs";
import { validateSchema } from "./schema-validation.mjs";

export const MODES = Object.freeze({ FIXTURE: "fixture_rehearsal", PRODUCTION: "production" });

export const STAGES = Object.freeze([
  "foundation_local",
  "expand_ready",
  "expand_applied",
  "backfill_complete",
  "shadow_complete",
  "internal_canary",
  "public_promotion",
  "public_100_percent",
  "soak_active",
  "soak_complete",
  "retirement_eligible",
  "retired",
]);

export class CutoverDeniedError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CutoverDeniedError";
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details = {}) {
  throw new CutoverDeniedError(code, message, details);
}

function requireCondition(condition, code, message, details = {}) {
  if (!condition) deny(code, message, details);
}

function exactInstant(value, code, field) {
  const milliseconds = Date.parse(value);
  requireCondition(Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value, code, `${field} must be an exact UTC instant`, { field, value });
  return milliseconds;
}

function trustedNow(context, candidate) {
  const clock = context.clock;
  requireCondition(clock && typeof clock.now === "function", "TRUSTED_CLOCK_MISSING", "an injected trusted clock port is required");
  if (candidate.candidate_class === "production_release_candidate") {
    requireCondition(clock.trust_class === "production", "TRUSTED_CLOCK_NOT_PRODUCTION", "production transitions require a production-trusted clock port");
  }
  const value = clock.now();
  exactInstant(value, "TRUSTED_CLOCK_INVALID", "trusted clock");
  return value;
}

function stateWithoutDigest(state) {
  const copy = clone(state);
  delete copy.state_digest_sha256;
  return copy;
}

export function sealState(state) {
  return withCanonicalDigest(stateWithoutDigest(state), "state_digest_sha256");
}

function assertSchemaOrDeny(schemaFile, value, code) {
  const result = validateSchema(schemaFile, value);
  requireCondition(result.ok, code, `${schemaFile} validation failed`, result);
}

export function validateCandidate(candidate, policy) {
  requireCondition(candidate && typeof candidate === "object", "CANDIDATE_MISSING", "candidate envelope is required");
  assertSchemaOrDeny("candidate-envelope.schema.json", candidate, "CANDIDATE_SCHEMA_INVALID");
  const digest = verifyCanonicalDigest(candidate, "candidate_digest_sha256");
  requireCondition(digest.ok, "CANDIDATE_DIGEST_MISMATCH", "candidate envelope digest does not match its canonical content", digest);
  requireCondition(candidate.artifact_pin_count === candidate.artifact_pins.length, "ARTIFACT_PIN_COUNT_MISMATCH", "artifact pin count must equal the exact pin array length");
  const paths = candidate.artifact_pins.map((pin) => pin.path);
  requireCondition(new Set(paths).size === paths.length, "ARTIFACT_PATH_DUPLICATE", "candidate artifact paths must be unique");
  const expectedManifest = `sha256:${sha256Bytes(canonicalJson(candidate.artifact_pins))}`;
  requireCondition(candidate.candidate_content_manifest_sha256 === expectedManifest, "ARTIFACT_MANIFEST_DIGEST_MISMATCH", "candidate content manifest does not bind the artifact pins", { expected: expectedManifest, actual: candidate.candidate_content_manifest_sha256 });
  const roles = new Set(candidate.artifact_pins.map((pin) => pin.role));
  const missingRoles = policy.required_digest_roles.filter((role) => !roles.has(role));
  requireCondition(missingRoles.length === 0, "REQUIRED_DIGEST_ROLE_MISSING", "candidate is missing required digest roles", { missing_roles: missingRoles });
  const authorizationPins = candidate.artifact_pins.filter((pin) => pin.role === "authorization_register");
  requireCondition(authorizationPins.length === 1 && authorizationPins[0].sha256 === candidate.authorization_register_sha256, "AUTHORIZATION_REGISTER_PIN_INVALID", "candidate must contain exactly one matching authorization-register byte pin");
  requireCondition(candidate.fixture_topology.worker_version_n !== candidate.fixture_topology.worker_version_n_minus_one, "WORKER_VERSION_PINS_NOT_DISTINCT", "N and N-1 Worker versions must differ");
  requireCondition(candidate.fixture_topology.search_generation_n !== candidate.fixture_topology.search_generation_n_minus_one, "GENERATION_PINS_NOT_DISTINCT", "N and N-1 search generations must differ");
  requireCondition(candidate.fixture_topology.asset_bundle_n_sha256 !== candidate.fixture_topology.asset_bundle_n_minus_one_sha256, "ASSET_BUNDLE_PINS_NOT_DISTINCT", "N and N-1 asset bundles must differ");
  return true;
}

function verifyReceipt(receipt, expected, candidate, context, now, evidence) {
  try {
    const verified = verifyEvidenceReceipt(receipt, { candidate, context, now, ...expected });
    evidence.push(verified);
    return verified;
  } catch (error) {
    if (error instanceof CutoverDeniedError) throw error;
    deny(error.code ?? "EVIDENCE_RECEIPT_INVALID", error.message, error.details ?? {});
  }
}

function requireProductionCandidate(candidate, context, now, evidence) {
  const checks = {
    candidate_class: candidate.candidate_class === "production_release_candidate",
    environment: candidate.environment === "production",
    exact_candidate_tree_sealed: candidate.git.exact_candidate_tree_sealed === true,
    clean_candidate_tree: candidate.git.working_tree_status === "clean_exact_candidate",
    exact_release_gate_pass: candidate.release_gate?.status === "PASS" && isSha256(candidate.release_gate?.receipt_sha256),
    component_gate_pass: Object.values(candidate.component_gates ?? {}).every((value) => value === "PASS"),
    production_eligibility: candidate.production_eligibility === true,
    production_blockers_empty: candidate.production_blockers?.length === 0,
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  requireCondition(failed.length === 0, "PRODUCTION_CANDIDATE_UNSEALED", "production transitions require one clean, exact, release-gated candidate", { failed });
  verifyReceipt(context.release_candidate_receipt, {
    expected_kind: "release_candidate",
    expected_subject: candidate.candidate_id,
    expected_environment: "production",
    expected_decision: "PASS",
    expected_evidence_sha256: candidate.release_gate.receipt_sha256,
  }, candidate, context, now, evidence);
}

function requireAuthorizationRegisterBinding(context, candidate) {
  const bytes = context.authorization_register_bytes;
  requireCondition(typeof bytes === "string" || bytes instanceof Uint8Array, "AUTHORIZATION_REGISTER_BYTES_MISSING", "exact authorization-register bytes are required");
  const byteDigest = `sha256:${sha256Bytes(bytes)}`;
  requireCondition(byteDigest === candidate.authorization_register_sha256, "AUTHORIZATION_REGISTER_BYTES_DRIFT", "active authorization-register bytes do not match the candidate pin", { expected: candidate.authorization_register_sha256, actual: byteDigest });
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (error) {
    deny("AUTHORIZATION_REGISTER_JSON_INVALID", "authorization-register bytes are not valid JSON", { message: error.message });
  }
  requireCondition(canonicalJson(parsed) === canonicalJson(context.authorization_register), "AUTHORIZATION_REGISTER_OBJECT_DRIFT", "parsed authorization register differs from the exact pinned bytes");
}

function findRegisterEntry(context, authorizationId) {
  return context.authorization_register?.entries?.find((entry) => entry.id === authorizationId);
}

function requireAuthorization(context, candidate, policy, authorizationId, now, evidence) {
  requireAuthorizationRegisterBinding(context, candidate);
  const entry = findRegisterEntry(context, authorizationId);
  requireCondition(entry?.authorized === true && entry?.status === "authorized", "AUTHORIZATION_REQUIRED", `${authorizationId} is not authorized in the exact pinned register`, { authorization_id: authorizationId });
  verifyReceipt(context.authorization_receipts?.[authorizationId], {
    expected_kind: "authorization",
    expected_subject: authorizationId,
    expected_environment: policy.authorization_environments[authorizationId],
    expected_decision: "authorized",
    expected_evidence_sha256: `sha256:${sha256Json(entry)}`,
  }, candidate, context, now, evidence);
}

function requireAuthorizations(context, candidate, policy, ids, now, evidence) {
  for (const id of ids) requireAuthorization(context, candidate, policy, id, now, evidence);
}

function requireGate(context, candidate, gate, environment, now, evidence) {
  const receipt = context.production_gate_receipts?.[gate];
  verifyReceipt(receipt, {
    expected_kind: "production_gate",
    expected_subject: gate,
    expected_environment: environment,
    expected_decision: "PASS",
  }, candidate, context, now, evidence);
}

function requireGates(context, candidate, gates, environment, now, evidence) {
  for (const gate of gates) requireGate(context, candidate, gate, environment, now, evidence);
}

export function makeInitialState({ mode, candidate, policy }) {
  requireCondition(Object.values(MODES).includes(mode), "MODE_INVALID", "state mode must be fixture_rehearsal or production");
  validateCandidate(candidate, policy);
  const state = sealState({
    schema_version: "ushso-wp14-cutover-state.v1.0.0",
    mode,
    stage: "foundation_local",
    candidate_digest_sha256: candidate.candidate_digest_sha256,
    previous_candidate_digest_sha256: null,
    policy_digest_sha256: `sha256:${sha256Json(policy)}`,
    public_read_backend: "immutable_static_jsonl",
    public_traffic_percent: 0,
    runtime_jsonl_active: true,
    active_search_generation: candidate.fixture_topology.search_generation_n_minus_one,
    candidate_search_generation: candidate.fixture_topology.search_generation_n,
    active_worker_version: candidate.fixture_topology.worker_version_n_minus_one,
    candidate_worker_version: candidate.fixture_topology.worker_version_n,
    active_asset_bundle_sha256: candidate.fixture_topology.asset_bundle_n_minus_one_sha256,
    worker_traffic_percent: { n_minus_one: 100, candidate: 0, static_emergency: 0 },
    rollback_bundle: null,
    rollback_window: { first_public_database_canary_at: null, one_hundred_percent_at: null, support_expires_no_earlier_than: null },
    cycles: { connector_reconciliation: [], rebuild_promote_rollback: [] },
    history: [],
    event_ledger_head_sha256: `sha256:${sha256Json([])}`,
    soak_receipt_sha256: null,
    retirement_authorization_receipt_sha256: null,
    consumed_single_use_receipts: [],
    production_action_authorized: false,
  });
  assertSchemaOrDeny("cutover-state.schema.json", state, "STATE_SCHEMA_INVALID");
  return state;
}

function validateState(state, candidate, policy) {
  assertSchemaOrDeny("cutover-state.schema.json", state, "STATE_SCHEMA_INVALID");
  const digest = verifyCanonicalDigest(state, "state_digest_sha256");
  requireCondition(digest.ok, "STATE_DIGEST_MISMATCH", "cutover state digest mismatch", digest);
  requireCondition(STAGES.includes(state.stage), "STATE_STAGE_INVALID", "unknown cutover stage", { stage: state.stage });
  requireCondition(state.policy_digest_sha256 === `sha256:${sha256Json(policy)}`, "POLICY_STATE_DRIFT", "state is bound to a different cutover policy");
  requireCondition(state.candidate_digest_sha256 === candidate.candidate_digest_sha256, "CANDIDATE_STATE_DRIFT", "state is bound to a different candidate", { state_candidate: state.candidate_digest_sha256, supplied_candidate: candidate.candidate_digest_sha256 });
  const traffic = state.worker_traffic_percent;
  requireCondition(traffic.n_minus_one + traffic.candidate + traffic.static_emergency === 100, "WORKER_TRAFFIC_TOTAL_INVALID", "Worker traffic allocation must total 100 percent");
  const eventIds = new Set();
  const evidenceReceiptIds = new Set();
  const verifierReceiptIds = new Set();
  let priorEventSha256 = `sha256:${sha256Json([])}`;
  let priorOccurredAt = null;
  for (const [index, entry] of state.history.entries()) {
    requireCondition(entry.sequence === index + 1, "STATE_HISTORY_SEQUENCE_INVALID", "state history sequence is not contiguous", { index, sequence: entry.sequence });
    requireCondition(!eventIds.has(entry.event_id), "STATE_HISTORY_EVENT_ID_DUPLICATE", "state history contains a duplicate event ID", { event_id: entry.event_id });
    eventIds.add(entry.event_id);
    requireCondition(entry.previous_event_sha256 === priorEventSha256, "STATE_HISTORY_CHAIN_INVALID", "state history hash chain is broken", { index });
    const eventDigest = verifyCanonicalDigest(entry, "event_sha256");
    requireCondition(eventDigest.ok, "STATE_HISTORY_DIGEST_MISMATCH", "state history entry digest mismatch", { index, ...eventDigest });
    const occurredAt = exactInstant(entry.occurred_at, "STATE_HISTORY_TIME_INVALID", `history[${index}].occurred_at`);
    if (priorOccurredAt !== null) requireCondition(occurredAt > priorOccurredAt, "STATE_HISTORY_TIME_NON_MONOTONIC", "state history times must advance strictly", { index });
    for (const receipt of entry.evidence_receipts) {
      requireCondition(!evidenceReceiptIds.has(receipt.receipt_sha256), "STATE_HISTORY_RECEIPT_DUPLICATE", "state history contains a replayed evidence receipt", { receipt_sha256: receipt.receipt_sha256 });
      requireCondition(!verifierReceiptIds.has(receipt.verifier_receipt_sha256), "STATE_HISTORY_VERIFIER_RECEIPT_DUPLICATE", "state history contains a replayed verifier receipt", { verifier_receipt_sha256: receipt.verifier_receipt_sha256 });
      evidenceReceiptIds.add(receipt.receipt_sha256);
      verifierReceiptIds.add(receipt.verifier_receipt_sha256);
    }
    priorOccurredAt = occurredAt;
    priorEventSha256 = entry.event_sha256;
  }
  requireCondition(state.event_ledger_head_sha256 === priorEventSha256, "STATE_HISTORY_HEAD_MISMATCH", "state event-ledger head does not match the history chain");
  const consumedReceiptIds = state.consumed_single_use_receipts.map((item) => item.receipt_sha256);
  const consumedNonces = state.consumed_single_use_receipts.map((item) => item.nonce);
  requireCondition(new Set(consumedReceiptIds).size === consumedReceiptIds.length, "STATE_CONSUMED_RECEIPT_DUPLICATE", "state contains duplicate consumed receipt hashes");
  requireCondition(new Set(consumedNonces).size === consumedNonces.length, "STATE_CONSUMED_NONCE_DUPLICATE", "state contains duplicate consumed receipt nonces");
  requireCondition(consumedReceiptIds.length === evidenceReceiptIds.size && consumedReceiptIds.every((receipt) => evidenceReceiptIds.has(receipt)), "STATE_RECEIPT_LEDGER_MISMATCH", "consumed receipts and event-history evidence do not match exactly");
  const allCycles = [...state.cycles.connector_reconciliation, ...state.cycles.rebuild_promote_rollback];
  requireCondition(new Set(allCycles.map((cycle) => cycle.cycle_id)).size === allCycles.length, "STATE_CYCLE_ID_DUPLICATE", "state contains duplicate cycle IDs");
  const operationalIds = allCycles.flatMap((cycle) => [cycle.connector_run_id, cycle.index_generation_id]).filter(Boolean);
  requireCondition(new Set(operationalIds).size === operationalIds.length, "STATE_CYCLE_OPERATION_ID_DUPLICATE", "state contains duplicate connector-run or generation IDs");
  requireCondition(new Set(allCycles.map((cycle) => cycle.receipt_sha256)).size === allCycles.length, "STATE_CYCLE_RECEIPT_DUPLICATE", "state contains duplicate cycle receipt hashes");
  for (const cycle of allCycles) requireCondition(evidenceReceiptIds.has(cycle.receipt_sha256), "STATE_CYCLE_RECEIPT_UNLEDGERED", "cycle receipt is absent from the event evidence ledger", { cycle_id: cycle.cycle_id });
}

function requireFixtureBoundary(event, context) {
  requireCondition(event.simulated === true, "FIXTURE_EVENT_NOT_MARKED_SIMULATED", "fixture transitions must be explicitly marked simulated");
  const boundary = context.execution_boundary ?? {};
  for (const key of ["network_requests", "provider_mutations", "deployments", "public_requests", "source_requests", "payload_downloads", "analyses_executed", "raw_user_queries_persisted"]) {
    requireCondition(boundary[key] === 0, "FIXTURE_BOUNDARY_VIOLATION", `fixture rehearsal requires ${key}=0`, { key, actual: boundary[key] });
  }
}

function validateEventEnvelope(state, event, context, candidate) {
  requireCondition(event && typeof event.type === "string", "EVENT_TYPE_REQUIRED", "transition event type is required");
  requireCondition(typeof event.event_id === "string" && event.event_id.length > 0, "EVENT_ID_REQUIRED", "every transition needs an event_id");
  requireCondition(!state.history.some((entry) => entry.event_id === event.event_id), "EVENT_ID_REPLAY", "event_id has already been committed", { event_id: event.event_id });
  const now = trustedNow(context, candidate);
  const nowMs = exactInstant(now, "TRUSTED_CLOCK_INVALID", "trusted clock");
  const eventMs = exactInstant(event.occurred_at, "EVENT_TIME_REQUIRED", "occurred_at");
  requireCondition(eventMs <= nowMs, "EVENT_TIME_FUTURE", "event time may not be in the future", { event: event.occurred_at, now });
  const skewSeconds = context.policy.event_clock_skew_seconds;
  requireCondition(Number.isInteger(skewSeconds) && nowMs - eventMs <= skewSeconds * 1000, "EVENT_TIME_STALE", "event time is outside the trusted-clock skew window", { event: event.occurred_at, now, skew_seconds: skewSeconds });
  const previous = state.history.at(-1)?.occurred_at;
  if (previous) requireCondition(eventMs > Date.parse(previous), "EVENT_TIME_NON_MONOTONIC", "event time must advance strictly", { previous, event: event.occurred_at });
  return now;
}

function requireStage(state, allowed) {
  const values = Array.isArray(allowed) ? allowed : [allowed];
  requireCondition(values.includes(state.stage), "INVALID_STAGE_TRANSITION", `event cannot run from ${state.stage}`, { allowed: values, actual: state.stage });
}

function addHistory(next, event, fromStage, evidence) {
  const priorEventSha = next.history.at(-1)?.event_sha256 ?? `sha256:${sha256Json([])}`;
  const entry = {
    sequence: next.history.length + 1,
    event: event.type,
    event_id: event.event_id,
    occurred_at: event.occurred_at,
    from_stage: fromStage,
    to_stage: next.stage,
    outcome: "applied",
    simulated: event.simulated === true,
    reason: event.reason ?? null,
    previous_event_sha256: priorEventSha,
    event_payload_sha256: `sha256:${sha256Json(event)}`,
    evidence_receipts: evidence.map((item) => ({ receipt_sha256: item.receipt_sha256, verifier_receipt_sha256: item.verifier_receipt_sha256 })),
  };
  const sealed = { ...entry, event_sha256: `sha256:${sha256Json(entry)}` };
  next.history.push(sealed);
  next.event_ledger_head_sha256 = sealed.event_sha256;
}

function nextPromotionStep(current, policy) {
  const index = policy.production_promotion_steps_percent.indexOf(current);
  return index >= 0 ? policy.production_promotion_steps_percent[index + 1] : undefined;
}

export function evaluateTelemetry(sample, policy) {
  const reasons = [];
  const results = [];
  for (const [metric, threshold] of Object.entries(policy.observability_abort_thresholds)) {
    if (metric.includes("planner_") && sample.planner_enabled !== true) {
      results.push({ metric, status: "not_applicable_planner_disabled", observed: null, threshold });
      continue;
    }
    const observed = sample[metric];
    const pass = Number.isFinite(observed) && observed >= 0 && threshold.operator === "<=" && observed <= threshold.value;
    results.push({ metric, status: pass ? "pass" : "abort", observed: observed ?? null, threshold });
    if (!pass) reasons.push(metric);
  }
  return { schema_version: "ushso-wp14-telemetry-evaluation.v1.0.0", evidence_class: sample.evidence_class ?? "unspecified", abort: reasons.length > 0, abort_reasons: reasons, results };
}

function consumeSingleUseReceipt(next, verified) {
  requireCondition(!next.consumed_single_use_receipts.some((item) => item.receipt_sha256 === verified.receipt_sha256), "RECEIPT_REPLAY", "single-use receipt digest has already been consumed");
  requireCondition(!next.consumed_single_use_receipts.some((item) => item.nonce === verified.nonce), "RECEIPT_NONCE_REPLAY", "single-use receipt nonce has already been consumed");
  next.consumed_single_use_receipts.push({ receipt_sha256: verified.receipt_sha256, nonce: verified.nonce });
}

function requireTelemetry(event, state, candidate, context, now, evidence) {
  const expectedEnvironment = state.mode === MODES.PRODUCTION ? "production_public" : "local_fixture_only";
  const evidenceSha = `sha256:${sha256Json(event.telemetry_sample)}`;
  const verified = verifyReceipt(event.telemetry_receipt, {
    expected_kind: "promotion_telemetry",
    expected_subject: `public-promotion:${event.percent}`,
    expected_environment: expectedEnvironment,
    expected_decision: "PASS",
    expected_evidence_sha256: evidenceSha,
  }, candidate, context, now, evidence);
  const telemetry = evaluateTelemetry(event.telemetry_sample ?? {}, context.policy);
  requireCondition(!telemetry.abort, "ABORT_THRESHOLD_EXCEEDED", "promotion telemetry exceeded an abort threshold", telemetry);
  return verified;
}

function resourceProjection(bundle) {
  return Object.fromEntries(bundle.resources.map((item) => [item.role, item.resource_id]));
}

export function verifyRollbackBundle(bundle, candidate, policy, { now, expected_anchor_at } = {}) {
  const errors = [];
  const schema = validateSchema("rollback-bundle.schema.json", bundle);
  if (!schema.ok) errors.push(...schema.errors.map((item) => `schema:${item.instance_path}:${item.keyword}`));
  if (!bundle || typeof bundle !== "object") return { ok: false, errors };
  const digest = verifyCanonicalDigest(bundle, "bundle_sha256");
  if (!digest.ok) errors.push("bundle_digest_mismatch");
  if (bundle.candidate_digest_sha256 !== candidate.candidate_digest_sha256) errors.push("candidate_digest_mismatch");
  const expectedRoles = [...policy.required_rollback_resource_roles].sort();
  const actualRoles = (bundle.resources ?? []).map((item) => item.role).sort();
  if (canonicalJson(actualRoles) !== canonicalJson(expectedRoles)) errors.push("resource_role_inventory_mismatch");
  const ids = (bundle.resources ?? []).map((item) => item.resource_id);
  if (new Set(ids).size !== ids.length) errors.push("resource_id_duplicate");
  const projection = resourceProjection({ resources: bundle.resources ?? [] });
  const expectedProjection = {
    worker_n_minus_one: candidate.fixture_topology.worker_version_n_minus_one,
    worker_n: candidate.fixture_topology.worker_version_n,
    publication_manifest_n_minus_one: bundle.old_publication_manifest_id,
    publication_manifest_n: bundle.new_publication_manifest_id,
    search_generation_n_minus_one: candidate.fixture_topology.search_generation_n_minus_one,
    search_generation_n: candidate.fixture_topology.search_generation_n,
    asset_bundle_n_minus_one: candidate.fixture_topology.asset_bundle_n_minus_one_sha256,
    asset_bundle_n: candidate.fixture_topology.asset_bundle_n_sha256,
    static_emergency_artifact: candidate.fixture_topology.static_artifact_sha256,
  };
  for (const [role, expected] of Object.entries(expectedProjection)) if (projection[role] !== expected) errors.push(`resource_pin_mismatch:${role}`);
  if (bundle.old_worker_version_id !== candidate.fixture_topology.worker_version_n_minus_one) errors.push("n_minus_one_worker_mismatch");
  if (bundle.new_worker_version_id !== candidate.fixture_topology.worker_version_n) errors.push("candidate_worker_mismatch");
  if (bundle.old_search_generation_id !== candidate.fixture_topology.search_generation_n_minus_one) errors.push("n_minus_one_generation_mismatch");
  if (bundle.new_search_generation_id !== candidate.fixture_topology.search_generation_n) errors.push("candidate_generation_mismatch");
  if (bundle.old_asset_bundle_sha256 !== candidate.fixture_topology.asset_bundle_n_minus_one_sha256) errors.push("n_minus_one_asset_mismatch");
  if (bundle.new_asset_bundle_sha256 !== candidate.fixture_topology.asset_bundle_n_sha256) errors.push("candidate_asset_mismatch");
  if (bundle.static_export_sha256 !== candidate.fixture_topology.static_artifact_sha256) errors.push("static_export_not_candidate_pin");
  if (bundle.old_publication_manifest_id === bundle.new_publication_manifest_id) errors.push("publication_manifests_not_distinct");
  if (bundle.n_minus_one_current_schema_compatible !== true) errors.push("n_minus_one_schema_not_compatible");
  if (bundle.cross_version_asset_404_count !== 0) errors.push("cross_version_asset_404");
  if (bundle.storage_rollback_claimed !== false) errors.push("storage_rollback_claim_forbidden");
  if (bundle.destructive_down_migration_included !== false) errors.push("destructive_down_migration_forbidden");
  if (!Number.isInteger(bundle.support_window_days) || bundle.support_window_days < policy.soak.minimum_days_after_100_percent) errors.push("support_window_too_short");
  try {
    const nowMs = exactInstant(now, "ROLLBACK_BUNDLE_TIME_INVALID", "now");
    const preparedMs = exactInstant(bundle.prepared_at, "ROLLBACK_BUNDLE_TIME_INVALID", "prepared_at");
    const anchorMs = exactInstant(bundle.support_window_anchor_at, "ROLLBACK_BUNDLE_TIME_INVALID", "support_window_anchor_at");
    const expiresMs = exactInstant(bundle.support_expires_at, "ROLLBACK_BUNDLE_TIME_INVALID", "support_expires_at");
    if (preparedMs > nowMs || nowMs > expiresMs) errors.push("support_window_not_current");
    if (expected_anchor_at && bundle.support_window_anchor_at !== expected_anchor_at) errors.push("support_anchor_mismatch");
    const derived = anchorMs + bundle.support_window_days * 86_400_000;
    if (expiresMs !== derived) errors.push("support_expiry_not_derived");
  } catch (error) {
    errors.push(error.code ?? "support_time_invalid");
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)].sort() };
}

function requireRollbackBundle(event, state, candidate, context, now, evidence, expectedAnchor, requireCurrent = false) {
  const bundle = event.rollback_bundle;
  const result = verifyRollbackBundle(bundle, candidate, context.policy, { now, expected_anchor_at: expectedAnchor });
  requireCondition(result.ok, "ROLLBACK_BUNDLE_INVALID", "complete canonical rollback bundle is required", result);
  if (requireCurrent) requireCondition(state.rollback_bundle?.bundle_sha256 === bundle.bundle_sha256, "ROLLBACK_BUNDLE_STATE_DRIFT", "rollback must use the exact bundle retained by the current state");
  const environment = state.mode === MODES.PRODUCTION ? "production_public" : "local_fixture_only";
  verifyReceipt(event.rollback_bundle_receipt, {
    expected_kind: "rollback_bundle",
    expected_subject: bundle.bundle_id,
    expected_environment: environment,
    expected_decision: "PASS",
    expected_evidence_sha256: bundle.bundle_sha256,
  }, candidate, context, now, evidence);
  return {
    bundle_id: bundle.bundle_id,
    bundle_sha256: bundle.bundle_sha256,
    support_window_anchor_at: bundle.support_window_anchor_at,
    support_expires_at: bundle.support_expires_at,
    verification_receipt_sha256: event.rollback_bundle_receipt.receipt_sha256,
  };
}

function requirePromotionPrerequisites(context, candidate, policy, event, state, now, evidence) {
  requireAuthorizations(context, candidate, policy, policy.central_authorization_gates.public_promotion, now, evidence);
  requireGates(context, candidate, ["migration_applied_and_compatible", "backfill_reconciled", "shadow_parity_pass", "search_quality_release_gate", "coverage_release_gate", "planner_release_gate", "machine_toolkit_release_gate", "seo_release_gate", "production_like_2x_load_gate", "managed_recovery_gate", "n_minus_one_compatibility", "cross_version_asset_matrix_zero_404", "v1_translation_compatibility"], "production_public", now, evidence);
  return requireTelemetry(event, state, candidate, context, now, evidence);
}

function cycleEvidence(event, candidate) {
  return {
    cycle_kind: event.cycle_kind,
    cycle_id: event.cycle_id,
    connector_run_id: event.connector_run_id ?? null,
    index_generation_id: event.index_generation_id ?? null,
    candidate_digest_sha256: candidate.candidate_digest_sha256,
    environment: event.environment,
    occurred_at: event.occurred_at,
    outcome: event.outcome,
  };
}

export function applyEvent(state, event, context) {
  const { candidate, policy } = context;
  validateCandidate(candidate, policy);
  validateState(state, candidate, policy);
  const now = validateEventEnvelope(state, event, context, candidate);
  const evidence = [];
  if (state.mode === MODES.FIXTURE) requireFixtureBoundary(event, context);
  if (state.mode === MODES.PRODUCTION) requireProductionCandidate(candidate, context, now, evidence);
  const next = clone(stateWithoutDigest(state));
  const fromStage = state.stage;

  switch (event.type) {
    case "prepare_expand":
      requireStage(state, "foundation_local");
      if (state.mode === MODES.PRODUCTION) requireGates(context, candidate, ["additive_migration_validation", "backwards_compatibility_validation", "n_minus_one_compatibility"], "production_foundation_no_traffic", now, evidence);
      next.stage = "expand_ready";
      break;
    case "apply_expand":
      requireStage(state, "expand_ready");
      if (state.mode === MODES.PRODUCTION) requireAuthorizations(context, candidate, policy, policy.central_authorization_gates.expand_apply, now, evidence);
      next.stage = "expand_applied";
      break;
    case "complete_backfill":
      requireStage(state, "expand_applied");
      requireCondition(event.backfill?.aliases_preserved === true, "BACKFILL_ALIAS_LOSS", "backfill must preserve aliases");
      requireCondition(event.backfill?.unresolved_identity_preserved === true, "BACKFILL_UNRESOLVED_IDENTITY_LOSS", "backfill must preserve unresolved identity candidates");
      requireCondition(event.backfill?.shared_history_discarded === false, "BACKFILL_DESTRUCTIVE", "backfill may not discard shared history or evidence");
      requireCondition(isSha256(event.backfill?.import_receipt_sha256), "BACKFILL_RECEIPT_MISSING", "backfill needs an exact import receipt digest");
      if (state.mode === MODES.PRODUCTION) {
        requireAuthorizations(context, candidate, policy, policy.central_authorization_gates.backfill, now, evidence);
        requireGates(context, candidate, ["migration_applied_and_compatible", "backfill_reconciled"], "staging", now, evidence);
      }
      next.stage = "backfill_complete";
      break;
    case "complete_shadow":
      requireStage(state, "backfill_complete");
      requireCondition(event.shadow?.public_reads_remained_static === true, "SHADOW_PUBLIC_READ_CHANGE", "shadow may not change public reads");
      requireCondition(event.shadow?.static_candidate_fixture_parity === true, "SHADOW_PARITY_MISSING", "shadow requires static/candidate fixture parity");
      requireCondition(event.shadow?.planner_inputs === "frozen_or_synthetic_only", "SHADOW_PLANNER_LEAKAGE", "shadow planner inputs must be frozen or synthetic only");
      if (state.mode === MODES.PRODUCTION) {
        requireAuthorizations(context, candidate, policy, policy.central_authorization_gates.managed_staging_and_shadow, now, evidence);
        requireGate(context, candidate, "shadow_parity_pass", "staging", now, evidence);
      }
      next.stage = "shadow_complete";
      break;
    case "start_internal_canary":
      requireStage(state, "shadow_complete");
      requireCondition(event.canary?.candidate_exists_at_zero_percent === true, "CANARY_ZERO_PERCENT_MISSING", "candidate must exist at zero percent before internal canary");
      requireCondition(event.canary?.access_protected === true, "CANARY_ACCESS_MISSING", "internal canary must be Access protected");
      requireCondition(event.canary?.version_selection === "server_injected", "CANARY_SELECTION_UNTRUSTED", "canary version must be server-injected");
      requireCondition(event.canary?.public_override_headers_allowed === false, "PUBLIC_OVERRIDE_FORBIDDEN", "public override headers are forbidden");
      if (state.mode === MODES.PRODUCTION) {
        requireAuthorizations(context, candidate, policy, policy.central_authorization_gates.internal_canary, now, evidence);
        requireGates(context, candidate, ["shadow_parity_pass", "static_fallback_rehearsed", "generation_rollback_rehearsed"], "production_internal_canary", now, evidence);
      }
      next.stage = "internal_canary";
      break;
    case "promote_public": {
      requireStage(state, ["internal_canary", "public_promotion"]);
      const expected = nextPromotionStep(state.public_traffic_percent, policy);
      requireCondition(event.percent === expected, "PROMOTION_STEP_INVALID", "public promotion must follow the configured gradual steps", { expected, requested: event.percent });
      if (state.mode === MODES.PRODUCTION) requirePromotionPrerequisites(context, candidate, policy, event, state, now, evidence);
      else requireTelemetry(event, state, candidate, context, now, evidence);
      const supportAnchor = state.rollback_window.first_public_database_canary_at ?? event.occurred_at;
      const bundleSnapshot = requireRollbackBundle(event, state, candidate, context, now, evidence, supportAnchor);
      if (state.public_traffic_percent === 0) requireCondition(state.active_search_generation === candidate.fixture_topology.search_generation_n_minus_one, "GENERATION_PROMOTION_PRECONDITION_FAILED", "first public promotion must start from N-1 generation");
      else requireCondition(state.active_search_generation === candidate.fixture_topology.search_generation_n, "GENERATION_PROMOTION_STATE_DRIFT", "continued promotion requires candidate generation N to remain active");
      next.active_search_generation = candidate.fixture_topology.search_generation_n;
      next.active_asset_bundle_sha256 = candidate.fixture_topology.asset_bundle_n_sha256;
      next.public_traffic_percent = event.percent;
      next.worker_traffic_percent = { n_minus_one: 100 - event.percent, candidate: event.percent, static_emergency: 0 };
      next.active_worker_version = event.percent === 100
        ? candidate.fixture_topology.worker_version_n
        : `mixed:${candidate.fixture_topology.worker_version_n_minus_one}|${candidate.fixture_topology.worker_version_n}`;
      next.public_read_backend = "database_generation_pinned";
      next.rollback_bundle = bundleSnapshot;
      next.stage = event.percent === 100 ? "public_100_percent" : "public_promotion";
      if (next.rollback_window.first_public_database_canary_at === null) next.rollback_window.first_public_database_canary_at = event.occurred_at;
      if (event.percent === 100) {
        next.rollback_window.one_hundred_percent_at = event.occurred_at;
        next.rollback_window.support_expires_no_earlier_than = event.rollback_bundle.support_expires_at;
      }
      break;
    }
    case "rollback_generation": {
      requireStage(state, ["public_promotion", "public_100_percent", "soak_active"]);
      requireCondition(state.active_search_generation === candidate.fixture_topology.search_generation_n, "GENERATION_ROLLBACK_NOOP", "generation rollback requires candidate generation N to be active");
      requireCondition(event.expected_from_generation === candidate.fixture_topology.search_generation_n, "GENERATION_ROLLBACK_PRECONDITION_INVALID", "rollback must assert the exact N pointer");
      requireCondition(event.to_generation === candidate.fixture_topology.search_generation_n_minus_one, "GENERATION_ROLLBACK_TARGET_INVALID", "rollback must select the retained exact N-1 generation");
      requireCondition(event.canonical_storage_reverted === false, "CANONICAL_STORAGE_ROLLBACK_FORBIDDEN", "generation rollback must not revert canonical storage");
      requireRollbackBundle(event, state, candidate, context, now, evidence, state.rollback_bundle.support_window_anchor_at, true);
      next.active_search_generation = event.to_generation;
      next.public_read_backend = "database_generation_pinned";
      break;
    }
    case "rollback_worker": {
      requireCondition(state.worker_traffic_percent.candidate > 0, "WORKER_ROLLBACK_NOOP", "Worker rollback requires candidate Worker traffic to be nonzero");
      requireStage(state, ["public_promotion", "public_100_percent", "soak_active"]);
      requireCondition(event.expected_candidate_worker === candidate.fixture_topology.worker_version_n, "WORKER_ROLLBACK_PRECONDITION_INVALID", "rollback must assert the exact candidate Worker");
      requireCondition(event.to_worker_version === candidate.fixture_topology.worker_version_n_minus_one, "WORKER_ROLLBACK_TARGET_INVALID", "Worker rollback must select the retained exact N-1 version");
      requireCondition(event.assets_rolled_back_with_worker === true, "WORKER_ASSET_SKEW", "bad Worker rollback must include its asset bundle");
      requireCondition(event.storage_reverted === false, "STORAGE_ROLLBACK_FORBIDDEN", "Worker rollback does not roll back PostgreSQL or R2");
      requireRollbackBundle(event, state, candidate, context, now, evidence, state.rollback_bundle.support_window_anchor_at, true);
      next.active_worker_version = event.to_worker_version;
      next.active_asset_bundle_sha256 = candidate.fixture_topology.asset_bundle_n_minus_one_sha256;
      next.public_traffic_percent = 0;
      next.worker_traffic_percent = { n_minus_one: 100, candidate: 0, static_emergency: 0 };
      next.public_read_backend = "n_minus_one_worker";
      next.stage = "internal_canary";
      break;
    }
    case "activate_static_fallback":
      requireCondition(state.public_read_backend !== "immutable_static_jsonl", "STATIC_FALLBACK_NOOP", "static fallback requires a non-static active backend");
      requireStage(state, ["internal_canary", "public_promotion", "public_100_percent", "soak_active"]);
      requireCondition(event.all_public_surfaces === true, "STATIC_FALLBACK_INCOMPLETE", "static fallback must cover every public surface");
      requireCondition(event.database_independent === true, "STATIC_FALLBACK_DB_DEPENDENT", "static emergency fallback must be database-independent");
      requireCondition(event.static_artifact_sha256 === candidate.fixture_topology.static_artifact_sha256, "STATIC_ARTIFACT_DRIFT", "static fallback digest is not the pinned artifact");
      requireRollbackBundle(event, state, candidate, context, now, evidence, state.rollback_bundle.support_window_anchor_at, true);
      next.active_worker_version = candidate.fixture_topology.static_emergency_worker_version;
      next.active_asset_bundle_sha256 = candidate.fixture_topology.static_artifact_sha256;
      next.public_traffic_percent = 0;
      next.worker_traffic_percent = { n_minus_one: 0, candidate: 0, static_emergency: 100 };
      next.public_read_backend = "immutable_static_jsonl";
      next.stage = "shadow_complete";
      break;
    case "record_cycle": {
      requireStage(state, ["public_100_percent", "soak_active"]);
      requireCondition(["connector_reconciliation", "rebuild_promote_rollback"].includes(event.cycle_kind), "CYCLE_KIND_INVALID", "unknown WP14 cycle kind");
      requireCondition(typeof event.cycle_id === "string" && event.cycle_id.length > 0, "CYCLE_ID_INVALID", "cycle needs a stable ID");
      const allCycles = [...state.cycles.connector_reconciliation, ...state.cycles.rebuild_promote_rollback];
      requireCondition(!allCycles.some((cycle) => cycle.cycle_id === event.cycle_id), "CYCLE_ID_REPLAY", "cycle ID has already been counted");
      requireCondition(event.outcome?.attempted > 0 && event.outcome.succeeded === event.outcome.attempted && event.outcome.failed === 0, "CYCLE_OUTCOME_NOT_SUCCESSFUL", "only complete successful cycles count");
      const allRunAndGenerationIds = new Set(allCycles.flatMap((cycle) => [cycle.connector_run_id, cycle.index_generation_id]).filter(Boolean));
      if (event.cycle_kind === "connector_reconciliation") {
        requireCondition(typeof event.connector_run_id === "string" && event.connector_run_id.length > 0, "CONNECTOR_RUN_ID_REQUIRED", "connector cycle needs a distinct run ID");
        requireCondition(!allRunAndGenerationIds.has(event.connector_run_id), "CONNECTOR_RUN_ID_REPLAY", "connector run ID has already been counted as a run or generation ID");
      } else {
        requireCondition(typeof event.index_generation_id === "string" && event.index_generation_id.length > 0, "INDEX_GENERATION_ID_REQUIRED", "rebuild cycle needs a distinct generation ID");
        requireCondition(!allRunAndGenerationIds.has(event.index_generation_id), "INDEX_GENERATION_ID_REPLAY", "index generation ID has already been counted as a run or generation ID");
      }
      const eventMs = Date.parse(event.occurred_at);
      requireCondition(eventMs >= Date.parse(state.rollback_window.one_hundred_percent_at) && eventMs <= Date.parse(state.rollback_bundle.support_expires_at), "CYCLE_OUTSIDE_SOAK_WINDOW", "cycle must occur after 100-percent cutover and inside the retained rollback window");
      const environment = state.mode === MODES.PRODUCTION ? "production_public" : "local_fixture_only";
      requireCondition(event.environment === environment, "CYCLE_ENVIRONMENT_INVALID", "cycle environment is not the exact transition environment");
      const cycleDescriptor = cycleEvidence(event, candidate);
      const verified = verifyReceipt(event.cycle_receipt, {
        expected_kind: "launch_cycle",
        expected_subject: event.cycle_id,
        expected_environment: environment,
        expected_decision: "PASS",
        expected_evidence_sha256: `sha256:${sha256Json(cycleDescriptor)}`,
      }, candidate, context, now, evidence);
      const isLive = state.mode === MODES.PRODUCTION && event.evidence_class === "live_launch_cycle";
      if (state.mode === MODES.PRODUCTION) requireCondition(isLive, "LIVE_CYCLE_ATTESTATION_MISSING", "production soak cycles must be verified live launch cycles");
      next.cycles[event.cycle_kind].push({
        cycle_id: event.cycle_id,
        connector_run_id: event.connector_run_id ?? null,
        index_generation_id: event.index_generation_id ?? null,
        occurred_at: event.occurred_at,
        receipt_sha256: verified.receipt_sha256,
        evidence_class: event.evidence_class,
        attempted: event.outcome.attempted,
        succeeded: event.outcome.succeeded,
        failed: event.outcome.failed,
        counts_toward_production_soak: isLive,
      });
      break;
    }
    case "start_soak":
      requireStage(state, "public_100_percent");
      if (state.mode === MODES.FIXTURE) deny("FIXTURE_CANNOT_START_PRODUCTION_SOAK", "fixture promotion never starts or advances the production soak clock");
      requireAuthorizations(context, candidate, policy, policy.central_authorization_gates.production_soak, now, evidence);
      requireGates(context, candidate, ["support_retention_lock", "alert_oncall_ownership", "incident_process_ready"], "production_soak", now, evidence);
      requireCondition(Date.parse(state.rollback_bundle.support_expires_at) >= Date.parse(state.rollback_window.one_hundred_percent_at) + policy.soak.minimum_days_after_100_percent * 86_400_000, "ROLLBACK_SUPPORT_WINDOW_TOO_SHORT", "retained rollback bundle does not cover the minimum soak window");
      next.stage = "soak_active";
      break;
    case "complete_soak": {
      requireStage(state, "soak_active");
      if (state.mode === MODES.FIXTURE) deny("FIXTURE_CANNOT_COMPLETE_PRODUCTION_SOAK", "fixture time and cycles do not satisfy production soak");
      const elapsedMs = Date.parse(event.occurred_at) - Date.parse(state.rollback_window.one_hundred_percent_at);
      requireCondition(elapsedMs >= policy.soak.minimum_days_after_100_percent * 86_400_000, "SOAK_TIME_INSUFFICIENT", "30-day minimum soak has not elapsed");
      requireCondition(Date.parse(event.occurred_at) <= Date.parse(state.rollback_bundle.support_expires_at), "SOAK_OUTSIDE_RETAINED_WINDOW", "soak completion must remain inside the rollback support window");
      for (const [kind, minimum] of [["connector_reconciliation", policy.soak.minimum_live_connector_reconciliation_cycles], ["rebuild_promote_rollback", policy.soak.minimum_live_rebuild_promote_rollback_cycles]]) {
        const count = state.cycles[kind].filter((cycle) => cycle.counts_toward_production_soak).length;
        requireCondition(count >= minimum, "SOAK_CYCLES_INSUFFICIENT", `${kind} production cycle floor is not met`, { kind, count, minimum });
      }
      requireGates(context, candidate, ["no_unresolved_coverage_or_visibility_incident", "queue_and_outbox_age_slo", "all_dlq_and_workflows_resolved_or_owned", "managed_alerts_exercised", "no_unresolved_sev1_or_sev2_final_interval"], "production_soak", now, evidence);
      const soakEvidence = { candidate_digest_sha256: candidate.candidate_digest_sha256, one_hundred_percent_at: state.rollback_window.one_hundred_percent_at, completed_at: event.occurred_at, connector_cycle_receipts: state.cycles.connector_reconciliation.map((cycle) => cycle.receipt_sha256), rebuild_cycle_receipts: state.cycles.rebuild_promote_rollback.map((cycle) => cycle.receipt_sha256), rollback_bundle_sha256: state.rollback_bundle.bundle_sha256 };
      const verified = verifyReceipt(event.soak_receipt, { expected_kind: "production_gate", expected_subject: "complete_soak", expected_environment: "production_soak", expected_decision: "PASS", expected_evidence_sha256: `sha256:${sha256Json(soakEvidence)}` }, candidate, context, now, evidence);
      next.soak_receipt_sha256 = verified.receipt_sha256;
      next.stage = "soak_complete";
      break;
    }
    case "mark_retirement_eligible":
      requireStage(state, "soak_complete");
      if (state.mode === MODES.FIXTURE) deny("FIXTURE_CANNOT_AUTHORIZE_RETIREMENT", "fixture evidence cannot make runtime JSONL retirement eligible");
      requireAuthorizations(context, candidate, policy, policy.central_authorization_gates.jsonl_retirement, now, evidence);
      requireGates(context, candidate, ["n_minus_one_dependency_audit", "static_emergency_artifact_healthy", "managed_failover_measured", "pitr_measured", "static_drill_measured"], "production_runtime", now, evidence);
      next.retirement_authorization_receipt_sha256 = context.authorization_receipts["AUTH-09"].receipt_sha256;
      next.stage = "retirement_eligible";
      break;
    case "retire_runtime_jsonl": {
      requireStage(state, "retirement_eligible");
      if (state.mode === MODES.FIXTURE) deny("FIXTURE_CANNOT_RETIRE_JSONL", "fixture evidence cannot retire runtime JSONL");
      requireAuthorization(context, candidate, policy, "AUTH-09", now, evidence);
      const postCandidate = event.post_removal_candidate;
      validateCandidate(postCandidate, policy);
      requireCondition(postCandidate.candidate_class === "production_release_candidate" && postCandidate.candidate_digest_sha256 !== candidate.candidate_digest_sha256, "POST_REMOVAL_CANDIDATE_INVALID", "retirement requires a distinct exact production release candidate");
      requireCondition(postCandidate.runtime_boundary.runtime_jsonl_loader_present === false && postCandidate.runtime_boundary.stage_corpus_dependency_present === false, "POST_REMOVAL_RUNTIME_BOUNDARY_INVALID", "post-removal candidate must prove the runtime loader and stage:corpus dependency are absent");
      requireCondition(postCandidate.runtime_boundary.jsonl_archives_retained === true && postCandidate.runtime_boundary.static_emergency_artifact_deployable === true, "POST_REMOVAL_RECOVERY_BOUNDARY_INVALID", "post-removal candidate must retain JSONL archives and a deployable static emergency artifact");
      verifyReceipt(event.post_removal_release_receipt, { expected_kind: "release_candidate", expected_subject: postCandidate.candidate_id, expected_environment: "production", expected_decision: "PASS", expected_evidence_sha256: postCandidate.release_gate.receipt_sha256 }, postCandidate, context, now, evidence);
      const retirementEvidence = { prior_candidate_digest_sha256: candidate.candidate_digest_sha256, post_removal_candidate_digest_sha256: postCandidate.candidate_digest_sha256, soak_receipt_sha256: state.soak_receipt_sha256, authorization_receipt_sha256: state.retirement_authorization_receipt_sha256, post_removal_release_receipt_sha256: event.post_removal_release_receipt.receipt_sha256, runtime_boundary: postCandidate.runtime_boundary };
      const verified = verifyReceipt(event.retirement_receipt, { expected_kind: "retirement", expected_subject: "runtime-jsonl-retirement", expected_environment: "production_runtime", expected_decision: "PASS", expected_evidence_sha256: `sha256:${sha256Json(retirementEvidence)}` }, postCandidate, context, now, evidence);
      next.previous_candidate_digest_sha256 = candidate.candidate_digest_sha256;
      next.candidate_digest_sha256 = postCandidate.candidate_digest_sha256;
      next.runtime_jsonl_active = false;
      next.stage = "retired";
      break;
    }
    default:
      deny("EVENT_UNKNOWN", `unknown cutover event: ${event.type}`);
  }

  for (const verified of evidence) consumeSingleUseReceipt(next, verified);
  addHistory(next, event, fromStage, evidence);
  next.production_action_authorized = state.production_action_authorized || (state.mode === MODES.PRODUCTION && event.type !== "prepare_expand");
  const sealed = sealState(next);
  assertSchemaOrDeny("cutover-state.schema.json", sealed, "STATE_SCHEMA_INVALID");
  validateState(sealed, event.type === "retire_runtime_jsonl" ? event.post_removal_candidate : candidate, policy);
  return sealed;
}

export function assertRollbackBundle(bundle, candidate, policy, options) {
  const result = verifyRollbackBundle(bundle, candidate, policy, options);
  assert(result.ok, `rollback bundle invalid: ${result.errors.join(", ")}`);
  return result;
}
