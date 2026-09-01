import { applyEvent } from "./release-state-machine.mjs";
import { canonicalJson, clone, isSha256, sha256Json, verifyCanonicalDigest, withCanonicalDigest } from "./common.mjs";

const EMPTY_LEDGER_SHA256 = `sha256:${sha256Json([])}`;

export class DurableTransitionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DurableTransitionError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new DurableTransitionError(code, message, details);
}

function requirePort(condition, code, message, details = {}) {
  if (!condition) fail(code, message, details);
}

function sealLedgerEntry(entry) {
  return withCanonicalDigest(entry, "ledger_entry_sha256");
}

function buildLedgerEntry(snapshot, nextState, event) {
  const committedHistory = nextState.history.at(-1);
  requirePort(committedHistory?.event_id === event.event_id, "EVENT_HISTORY_BINDING_INVALID", "the evaluated state does not end with the requested event");
  return sealLedgerEntry({
    schema_version: "ushso-wp14-transition-ledger-entry.v1.0.0",
    sequence: snapshot.revision + 1,
    event_id: event.event_id,
    occurred_at: event.occurred_at,
    candidate_digest_sha256: nextState.candidate_digest_sha256,
    previous_candidate_digest_sha256: nextState.previous_candidate_digest_sha256,
    prior_state_digest_sha256: snapshot.state.state_digest_sha256,
    next_state_digest_sha256: nextState.state_digest_sha256,
    prior_ledger_entry_sha256: snapshot.ledger_head_sha256,
    state_history_event_sha256: committedHistory.event_sha256,
    event_payload_sha256: committedHistory.event_payload_sha256,
    evidence_receipt_sha256s: committedHistory.evidence_receipts.map((item) => item.receipt_sha256),
    verifier_receipt_sha256s: committedHistory.evidence_receipts.map((item) => item.verifier_receipt_sha256),
  });
}

function validateSnapshot(snapshot) {
  requirePort(snapshot && Number.isInteger(snapshot.revision) && snapshot.revision >= 0, "DURABLE_SNAPSHOT_INVALID", "durable state snapshot needs a nonnegative integer revision");
  requirePort(snapshot.state && isSha256(snapshot.state.state_digest_sha256), "DURABLE_SNAPSHOT_INVALID", "durable state snapshot needs a sealed state");
  requirePort(Array.isArray(snapshot.ledger), "DURABLE_SNAPSHOT_INVALID", "durable state snapshot needs an append-only ledger array");
  requirePort(snapshot.ledger.length === snapshot.revision, "DURABLE_LEDGER_REVISION_MISMATCH", "ledger length must equal the committed revision");
  const expectedHead = snapshot.ledger.at(-1)?.ledger_entry_sha256 ?? EMPTY_LEDGER_SHA256;
  requirePort(snapshot.ledger_head_sha256 === expectedHead, "DURABLE_LEDGER_HEAD_MISMATCH", "durable ledger head does not match its final entry");
  let prior = EMPTY_LEDGER_SHA256;
  const ids = new Set();
  for (let index = 0; index < snapshot.ledger.length; index += 1) {
    const entry = snapshot.ledger[index];
    requirePort(verifyCanonicalDigest(entry, "ledger_entry_sha256").ok, "DURABLE_LEDGER_ENTRY_DIGEST_MISMATCH", "durable ledger entry digest mismatch", { index });
    requirePort(entry.sequence === index + 1, "DURABLE_LEDGER_SEQUENCE_INVALID", "durable ledger sequence is not contiguous", { index, sequence: entry.sequence });
    requirePort(entry.prior_ledger_entry_sha256 === prior, "DURABLE_LEDGER_CHAIN_INVALID", "durable ledger chain is broken", { index });
    requirePort(!ids.has(entry.event_id), "DURABLE_LEDGER_EVENT_REPLAY", "durable ledger contains a duplicate event ID", { event_id: entry.event_id });
    ids.add(entry.event_id);
    prior = entry.ledger_entry_sha256;
  }
}

export function createDurableTransitionAdapter(store) {
  requirePort(store && typeof store.readSnapshot === "function" && typeof store.atomicCompareAndSwapAppend === "function", "DURABLE_STORE_PORT_INVALID", "the injected durable store must expose readSnapshot and atomicCompareAndSwapAppend");
  requirePort(["fixture_atomic", "authoritative_transactional"].includes(store.durability_class), "DURABILITY_CLASS_INVALID", "the durable store must declare its durability class");
  return Object.freeze({
    durability_class: store.durability_class,
    async readSnapshot() {
      const snapshot = await store.readSnapshot();
      validateSnapshot(snapshot);
      return clone(snapshot);
    },
    async compareAndSwapAppend(request) {
      const storeRequest = clone({ ...request, failure_injector: undefined });
      storeRequest.failure_injector = request.failure_injector;
      const result = await store.atomicCompareAndSwapAppend(storeRequest);
      validateSnapshot(result);
      requirePort(result.revision === request.expected_revision + 1, "DURABLE_COMMIT_REVISION_INVALID", "one transition must advance the durable revision exactly once");
      requirePort(result.state.state_digest_sha256 === request.next_state.state_digest_sha256, "DURABLE_COMMIT_STATE_MISMATCH", "committed state differs from the evaluated next state");
      requirePort(result.ledger_head_sha256 === request.ledger_entry.ledger_entry_sha256, "DURABLE_COMMIT_LEDGER_MISMATCH", "committed ledger head differs from the requested append");
      return clone(result);
    },
  });
}

export function createInMemoryAtomicStore(initialState) {
  let committed = {
    revision: 0,
    state: clone(initialState),
    ledger: [],
    ledger_head_sha256: EMPTY_LEDGER_SHA256,
  };
  validateSnapshot(committed);
  return {
    durability_class: "fixture_atomic",
    async readSnapshot() {
      return clone(committed);
    },
    async atomicCompareAndSwapAppend(request) {
      const { expected_revision, expected_state_digest_sha256, expected_ledger_head_sha256, next_state, ledger_entry, failure_injector } = request;
      if (committed.revision !== expected_revision || committed.state.state_digest_sha256 !== expected_state_digest_sha256 || committed.ledger_head_sha256 !== expected_ledger_head_sha256) {
        fail("DURABLE_CAS_CONFLICT", "durable state changed before this transition could commit", {
          expected_revision,
          actual_revision: committed.revision,
          expected_state_digest_sha256,
          actual_state_digest_sha256: committed.state.state_digest_sha256,
          expected_ledger_head_sha256,
          actual_ledger_head_sha256: committed.ledger_head_sha256,
        });
      }
      requirePort(ledger_entry.sequence === committed.revision + 1, "DURABLE_LEDGER_SEQUENCE_INVALID", "ledger append sequence must be the next committed revision");
      requirePort(ledger_entry.prior_state_digest_sha256 === committed.state.state_digest_sha256, "DURABLE_LEDGER_STATE_CHAIN_INVALID", "ledger append is not chained to the committed state");
      requirePort(ledger_entry.prior_ledger_entry_sha256 === committed.ledger_head_sha256, "DURABLE_LEDGER_CHAIN_INVALID", "ledger append is not chained to the committed ledger head");
      requirePort(ledger_entry.next_state_digest_sha256 === next_state.state_digest_sha256, "DURABLE_LEDGER_NEXT_STATE_INVALID", "ledger append does not bind the next state");
      requirePort(!committed.ledger.some((entry) => entry.event_id === ledger_entry.event_id), "DURABLE_LEDGER_EVENT_REPLAY", "event ID already exists in the durable ledger");
      requirePort(!committed.ledger.some((entry) => entry.ledger_entry_sha256 === ledger_entry.ledger_entry_sha256), "DURABLE_LEDGER_RECEIPT_REPLAY", "ledger entry digest already exists");
      requirePort(verifyCanonicalDigest(ledger_entry, "ledger_entry_sha256").ok, "DURABLE_LEDGER_ENTRY_DIGEST_MISMATCH", "ledger append digest mismatch");

      const prepared = {
        revision: committed.revision + 1,
        state: clone(next_state),
        ledger: [...clone(committed.ledger), clone(ledger_entry)],
        ledger_head_sha256: ledger_entry.ledger_entry_sha256,
      };
      validateSnapshot(prepared);
      if (failure_injector) await failure_injector("after_prepare", clone(prepared));
      if (failure_injector) await failure_injector("before_commit", clone(prepared));
      committed = prepared;
      return clone(committed);
    },
  };
}

export function createInMemoryTransitionAdapter(initialState) {
  return createDurableTransitionAdapter(createInMemoryAtomicStore(initialState));
}

export async function applyEventDurably({ adapter, event, context, failure_injector }) {
  requirePort(adapter && typeof adapter.readSnapshot === "function" && typeof adapter.compareAndSwapAppend === "function", "DURABLE_ADAPTER_REQUIRED", "transitions require an injected durable compare-and-swap/append adapter");
  const snapshot = await adapter.readSnapshot();
  if (snapshot.state.mode === "production") {
    requirePort(adapter.durability_class === "authoritative_transactional", "AUTHORITATIVE_DURABLE_ADAPTER_REQUIRED", "production transitions require an authoritative transactional durable adapter");
  }
  const nextState = applyEvent(snapshot.state, event, context);
  const ledgerEntry = buildLedgerEntry(snapshot, nextState, event);
  const committed = await adapter.compareAndSwapAppend({
    expected_revision: snapshot.revision,
    expected_state_digest_sha256: snapshot.state.state_digest_sha256,
    expected_ledger_head_sha256: snapshot.ledger_head_sha256,
    next_state: nextState,
    ledger_entry: ledgerEntry,
    failure_injector,
  });
  requirePort(canonicalJson(committed.state) === canonicalJson(nextState), "DURABLE_COMMIT_STATE_MISMATCH", "durable adapter returned different committed state bytes");
  return committed;
}

export const durableTransitionConstants = Object.freeze({ EMPTY_LEDGER_SHA256 });
