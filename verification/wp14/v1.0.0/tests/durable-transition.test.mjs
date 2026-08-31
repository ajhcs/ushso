import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateSnapshot } from "../src/candidate-snapshot.mjs";
import {
  DurableTransitionError,
  applyEventDurably,
  createDurableTransitionAdapter,
  createInMemoryAtomicStore,
  createInMemoryTransitionAdapter,
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
});
