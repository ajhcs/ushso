#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCandidateSnapshot } from "../src/candidate-snapshot.mjs";
import { applyEventDurably, createInMemoryTransitionAdapter } from "../src/durable-transition.mjs";
import { createFixtureReceiptAuthority } from "../src/evidence-receipts.mjs";
import { readJson } from "../src/common.mjs";
import { createManualClock, loadAuthorizationRegister, loadAuthorizationRegisterBytes, loadPolicy, runFixtureRehearsal } from "../src/rehearsal.mjs";
import { evaluateTelemetry, verifyRollbackBundle } from "../src/release-state-machine.mjs";

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name} PATH`);
  return resolve(process.cwd(), process.argv[index + 1]);
}

const command = process.argv[2] ?? "inspect";

if (command === "inspect") {
  const candidate = buildCandidateSnapshot();
  print({
    command: "inspect",
    mutating: false,
    candidate,
    authorizations: Object.fromEntries(
      loadAuthorizationRegister().entries
        .filter((entry) => ["AUTH-03", "AUTH-05", "AUTH-06", "AUTH-07", "AUTH-08", "AUTH-09", "AUTH-11"].includes(entry.id))
        .map((entry) => [entry.id, { status: entry.status, authorized: entry.authorized, environment: entry.environment }]),
    ),
  });
} else if (command === "rehearse") {
  print(runFixtureRehearsal());
} else if (command === "evaluate-telemetry") {
  print(evaluateTelemetry(readJson(argument("--input")), loadPolicy()));
} else if (command === "verify-rollback-bundle") {
  const bundle = readJson(argument("--bundle"));
  print(verifyRollbackBundle(bundle, buildCandidateSnapshot(), loadPolicy(), { now: bundle.prepared_at, expected_anchor_at: bundle.support_window_anchor_at }));
} else if (command === "transition") {
  const state = readJson(argument("--state"));
  const event = readJson(argument("--event"));
  const suppliedContext = JSON.parse(readFileSync(argument("--context"), "utf8"));
  if (state.mode !== "fixture_rehearsal") {
    throw new Error("AUTHORITATIVE_DURABLE_ADAPTER_REQUIRED: this zero-action tool composes only the in-memory fixture adapter; production needs a separately reviewed authoritative transactional store");
  }
  const candidate = buildCandidateSnapshot();
  const authority = createFixtureReceiptAuthority();
  const context = {
    ...suppliedContext,
    candidate,
    policy: loadPolicy(),
    authorization_register: loadAuthorizationRegister(),
    authorization_register_bytes: loadAuthorizationRegisterBytes(),
    receipt_verifier: authority,
    clock: createManualClock(event.occurred_at, "fixture_only"),
  };
  const committed = await applyEventDurably({ adapter: createInMemoryTransitionAdapter(state), event, context });
  print({ evidence_class: "ephemeral_fixture_atomic_transition_not_runtime_state", production_action_authorized: false, committed });
} else {
  throw new Error(`unknown command ${command}; expected inspect, rehearse, evaluate-telemetry, verify-rollback-bundle, or transition`);
}
