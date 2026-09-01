import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateSnapshot } from "../src/candidate-snapshot.mjs";
import { withCanonicalDigest } from "../src/common.mjs";
import {
  DurableTransitionError,
  applyEventDurably,
  createDurableTransitionAdapter,
  createInMemoryAtomicStore,
  createInMemoryTransitionAdapter,
  durableTransitionConstants,
} from "../src/durable-transition.mjs";
import { createFixtureReceiptAuthority } from "../src/evidence-receipts.mjs";
import { MODES, makeInitialState } from "../src/release-state-machine.mjs";
import { createManualClock, loadAuthorizationRegister, loadPolicy } from "../src/rehearsal.mjs";
import { createProductionContext, productionEvent } from "./helpers.mjs";

const executionBoundary = Object.freeze({
  network_requests: 0,
  provider_mutations: 0,
  deployments: 0,
  public_requests: 0,
  source_requests: 0,
  payload_downloads: 0,
  analyses_executed: 0,
  raw_user_queries_persisted: 0,
});

function fixtureSetup() {
  const candidate = buildCandidateSnapshot();
  const policy = loadPolicy();
  const clock = createManualClock("2026-08-30T00:00:01.000Z");
  const authority = createFixtureReceiptAuthority();
  const context = {
    candidate,
    policy,
    clock,
    receipt_verifier: authority,
    authorization_register: loadAuthorizationRegister(),
    execution_boundary: executionBoundary,
  };
  const state = makeInitialState({ mode: MODES.FIXTURE, candidate, policy });
  return { candidate, policy, clock, context, state };
}

function fixtureEvent(type, second, id = type) {
  return {
    type,
    event_id: `durable-fixture:${id}`,
    occurred_at: new Date(Date.parse("2026-08-30T00:00:00.000Z") + second * 1000).toISOString(),
    simulated: true,
  };
}

function minimalFixtureState(marker) {
  return withCanonicalDigest({
    marker,
    history: [],
    event_ledger_head_sha256: durableTransitionConstants.EMPTY_LEDGER_SHA256,
  }, "state_digest_sha256");
}

test("durable transition commits state CAS and append-only ledger in one revision", async () => {
  const { context, clock, state } = fixtureSetup();
  const adapter = createInMemoryTransitionAdapter(state);
  const prepare = fixtureEvent("prepare_expand", 1);
  clock.set(prepare.occurred_at);
  let committed = await applyEventDurably({ adapter, event: prepare, context });
  assert.equal(committed.revision, 1);
  assert.equal(committed.state.stage, "expand_ready");
  assert.equal(committed.ledger.length, 1);
  assert.equal(committed.ledger[0].prior_state_digest_sha256, state.state_digest_sha256);
  assert.equal(committed.ledger[0].next_state_digest_sha256, committed.state.state_digest_sha256);
  assert.equal(committed.ledger_head_sha256, committed.ledger[0].ledger_entry_sha256);

  const apply = fixtureEvent("apply_expand", 2);
  clock.set(apply.occurred_at);
  committed = await applyEventDurably({ adapter, event: apply, context });
  assert.equal(committed.revision, 2);
  assert.equal(committed.ledger.length, 2);
  assert.equal(committed.ledger[1].prior_ledger_entry_sha256, committed.ledger[0].ledger_entry_sha256);
  assert.deepEqual(committed.ledger.map((entry) => entry.sequence), [1, 2]);
  assert.equal(new Set(committed.ledger.map((entry) => entry.event_id)).size, 2);
});

test("stale compare-and-swap is rejected without a second append", async () => {
  const { context, clock, state } = fixtureSetup();
  const underlying = createInMemoryAtomicStore(state);
  let committedRequest;
  const store = {
    durability_class: underlying.durability_class,
    readSnapshot: () => underlying.readSnapshot(),
    async atomicCompareAndSwapAppend(request) {
      committedRequest = structuredClone({ ...request, failure_injector: undefined });
      return underlying.atomicCompareAndSwapAppend(request);
    },
  };
  const adapter = createDurableTransitionAdapter(store);
  const prepare = fixtureEvent("prepare_expand", 1);
  clock.set(prepare.occurred_at);
  await applyEventDurably({ adapter, event: prepare, context });
  await assert.rejects(
    () => underlying.atomicCompareAndSwapAppend(committedRequest),
    (error) => error instanceof DurableTransitionError && error.code === "DURABLE_CAS_CONFLICT",
  );
  const after = await adapter.readSnapshot();
  assert.equal(after.revision, 1);
  assert.equal(after.ledger.length, 1);
});

for (const failurePoint of ["after_prepare", "before_commit"]) {
  test(`failure injection at ${failurePoint} leaves state and ledger wholly uncommitted`, async () => {
    const { context, clock, state } = fixtureSetup();
    const adapter = createInMemoryTransitionAdapter(state);
    const before = await adapter.readSnapshot();
    const prepare = fixtureEvent("prepare_expand", 1, failurePoint);
    clock.set(prepare.occurred_at);
    await assert.rejects(
      () => applyEventDurably({
        adapter,
        event: prepare,
        context,
        failure_injector(point) {
          if (point === failurePoint) throw new Error(`injected:${failurePoint}`);
        },
      }),
      new RegExp(`injected:${failurePoint}`),
    );
    const after = await adapter.readSnapshot();
    assert.deepEqual(after, before);
  });
}

test("async failure-injector yield cannot interleave fixture CAS appends", async () => {
  const placeholderSha = `sha256:${"ab".repeat(32)}`;
  const initial = minimalFixtureState("fixture-cas-initial");
  const store = createInMemoryAtomicStore(initial);

  function buildAppendRequest(eventId, nextMarker) {
    const historyEntry = withCanonicalDigest({
      sequence: 1,
      event: "fixture_append",
      event_id: eventId,
      occurred_at: "2026-08-30T00:00:01.000Z",
      from_stage: "fixture",
      to_stage: "fixture",
      outcome: "applied",
      simulated: true,
      reason: null,
      previous_event_sha256: durableTransitionConstants.EMPTY_LEDGER_SHA256,
      event_payload_sha256: placeholderSha,
      evidence_receipts: [],
    }, "event_sha256");
    const next_state = withCanonicalDigest({
      marker: nextMarker,
      history: [historyEntry],
      event_ledger_head_sha256: historyEntry.event_sha256,
    }, "state_digest_sha256");
    const ledger_entry = withCanonicalDigest({
      schema_version: "ushso-wp14-transition-ledger-entry.v1.0.0",
      sequence: 1,
      event_id: eventId,
      occurred_at: "2026-08-30T00:00:01.000Z",
      candidate_digest_sha256: placeholderSha,
      previous_candidate_digest_sha256: null,
      prior_state_digest_sha256: initial.state_digest_sha256,
      next_state_digest_sha256: next_state.state_digest_sha256,
      prior_ledger_entry_sha256: durableTransitionConstants.EMPTY_LEDGER_SHA256,
      state_history_event_sha256: historyEntry.event_sha256,
      event_payload_sha256: historyEntry.event_payload_sha256,
      evidence_receipt_sha256s: [],
      verifier_receipt_sha256s: [],
    }, "ledger_entry_sha256");
    return {
      expected_revision: 0,
      expected_state_digest_sha256: initial.state_digest_sha256,
      expected_ledger_head_sha256: durableTransitionConstants.EMPTY_LEDGER_SHA256,
      next_state,
      ledger_entry,
    };
  }

  let releaseFirst;
  let signalFirstReached;
  const firstReached = new Promise((resolve) => {
    signalFirstReached = resolve;
  });
  const releaseGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const holdFirstAtBeforeCommit = async (point) => {
    if (point !== "before_commit") return;
    signalFirstReached();
    await releaseGate;
  };

  const firstRequest = buildAppendRequest("durable-fixture:concurrent-a", "next-a");
  const secondRequest = buildAppendRequest("durable-fixture:concurrent-b", "next-b");
  const firstPromise = store.atomicCompareAndSwapAppend({ ...firstRequest, failure_injector: holdFirstAtBeforeCommit });
  await firstReached;
  const secondPromise = store.atomicCompareAndSwapAppend(secondRequest);
  releaseFirst();
  const outcomes = await Promise.allSettled([firstPromise, secondPromise]);

  const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof DurableTransitionError);
  assert.equal(rejected[0].reason.code, "DURABLE_CAS_CONFLICT");

  const after = await store.readSnapshot();
  assert.equal(after.revision, 1);
  assert.equal(after.ledger.length, 1);
  assert.equal(
    new Set([firstRequest.ledger_entry.event_id, secondRequest.ledger_entry.event_id]).has(after.ledger[0].event_id),
    true,
  );
});

test("fixture durability class cannot be upgraded by mutating the store", () => {
  const store = createInMemoryAtomicStore(minimalFixtureState("fixture-cas-frozen"));
  assert.equal(Object.isFrozen(store), true);
  assert.throws(() => {
    store.durability_class = "authoritative_transactional";
  }, TypeError);
  assert.equal(store.durability_class, "fixture_atomic");
});

test("fixture store rejects a state history that has no durable revision", () => {
  const inconsistent = withCanonicalDigest({
    marker: "fixture-cas-inconsistent",
    history: [{ event_id: "not-durable" }],
    event_ledger_head_sha256: durableTransitionConstants.EMPTY_LEDGER_SHA256,
  }, "state_digest_sha256");
  assert.throws(
    () => createInMemoryAtomicStore(inconsistent),
    (error) => error instanceof DurableTransitionError && error.code === "DURABLE_STATE_HISTORY_REVISION_MISMATCH",
  );
});

test("event replay is rejected before a durable append and production rejects fixture durability", async () => {
  const { context, clock, state } = fixtureSetup();
  const adapter = createInMemoryTransitionAdapter(state);
  const prepare = fixtureEvent("prepare_expand", 1, "replay");
  clock.set(prepare.occurred_at);
  await applyEventDurably({ adapter, event: prepare, context });
  clock.set("2026-08-30T00:00:02.000Z");
  await assert.rejects(
    () => applyEventDurably({ adapter, event: { ...prepare, occurred_at: clock.now() }, context }),
    (error) => error.code === "EVENT_ID_REPLAY",
  );
  assert.equal((await adapter.readSnapshot()).ledger.length, 1);

  const production = createProductionContext();
  const productionState = makeInitialState({ mode: MODES.PRODUCTION, candidate: production.candidate, policy: production.context.policy });
  const fixtureAdapter = createInMemoryTransitionAdapter(productionState);
  await assert.rejects(
    () => applyEventDurably({ adapter: fixtureAdapter, event: productionEvent("prepare_expand", "2026-08-30T00:00:01.000Z", "durability"), context: production.context }),
    (error) => error instanceof DurableTransitionError && error.code === "AUTHORITATIVE_DURABLE_ADAPTER_REQUIRED",
  );
  assert.equal(Object.isFrozen(fixtureAdapter), true);
  await assert.rejects(
    () => fixtureAdapter.compareAndSwapAppend({ next_state: { mode: MODES.PRODUCTION } }),
    (error) => error instanceof DurableTransitionError && error.code === "AUTHORITATIVE_DURABLE_ADAPTER_REQUIRED",
  );
});
