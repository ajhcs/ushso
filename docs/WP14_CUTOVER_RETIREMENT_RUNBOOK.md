# WP14 cutover, rollback, soak, and JSONL-retirement runbook

Status: local, zero-traffic foundation only. No deployment, provider mutation, managed recovery drill, internal canary, public cutover, production-like load, soak clock, or runtime JSONL retirement has occurred.

## Safety boundary

This runbook implements the release control plane described by section 24 and WP14 of the Research Navigator implementation plan. It does not authorize an operation. USHSO remains a public-source research navigator that recommends, explains, and compiles bounded research plans; this tooling never fetches source data, executes analysis, calculates market share, produces a financial benchmark, stores a raw research question, or becomes a general analytics system.

The current Worker entry point and `apps/web/public/corpus-v1.1.0/*.jsonl` are intentionally untouched. Until every retirement gate passes, static JSONL remains the public runtime and emergency fallback. A fixture rehearsal can test state transitions but cannot advance a production stage, start a soak clock, satisfy a live-cycle denominator, authorize traffic, or retire JSONL.

## Operator commands

All commands are non-mutating and run from the repository root:

```sh
npm test --prefix verification/wp14/v1.0.0
npm run verify --prefix verification/wp14/v1.0.0
npm run inspect --prefix verification/wp14/v1.0.0
npm run rehearse --prefix verification/wp14/v1.0.0
```

`inspect` prints the exact local base commit/tree, the byte digests of configuration, migrations, search, static corpus, coverage, planner, toolkit, SEO, authorization register, and Worker artifacts, and every blocking gate. `rehearse` prints a sealed fixture-only receipt. Neither command writes external state or sends traffic.

For a future stable integrated release candidate, first make the candidate exact and reviewable. The local plan discovered by the release-gate tooling currently has fingerprint `sha256:886170d2355e59531b1647795b298eeb7d503eaa0b22ee487a4be26bd5c3b0fc` and no repository-declared policy. Do not treat that plan as a release receipt. On a clean, stable tree, review the detected commands or add a reviewed repository policy, then capture and test the exact candidate once:

```sh
release-gate plan --repo '/mnt/d/Coding Projects/ushso' --authority local-exact-tree
release-gate run --repo '/mnt/d/Coding Projects/ushso' --authority local-exact-tree --receipt /reviewed/absolute/path/release-gate-receipt.json
```

The resulting receipt must be pinned in a new candidate envelope. A diagnostic rerun is not independent release evidence. Do not use a shared moving dirty worktree as a production candidate.

## Fail-closed state model

The machine state is sealed after every event and bound to one candidate digest. Candidate drift, state tampering, a missing artifact role, an unsealed Git tree, a non-passing exact-candidate release receipt, a component gate that is not `PASS`, a false central authorization, a missing candidate-scoped authorization receipt, or an abort threshold prevents the transition.

The production states are:

1. `foundation_local`
2. `expand_ready`
3. `expand_applied`
4. `backfill_complete`
5. `shadow_complete`
6. `internal_canary`
7. `public_promotion`
8. `public_100_percent`
9. `soak_active`
10. `soak_complete`
11. `retirement_eligible`
12. `retired`

Fixture states use the same names only to exercise guards in memory. Their `mode` is permanently `fixture_rehearsal`, every event must say `simulated: true`, all execution-boundary counters must be zero, and their cycles have `counts_toward_production_soak: false`.

## Candidate and authorization binding

A release candidate must pin all of the following before any production transition:

- exact candidate digest, Git commit, and Git tree OID;
- exact-candidate release-gate receipt;
- environment/configuration and binding manifests;
- forward-only migration bundle and compatibility watermark;
- immutable search publication manifest/generation;
- current and emergency static artifacts;
- coverage snapshot and accounting receipt;
- planner contract, benchmark, evaluator, and compiler receipt;
- machine-toolkit contract and activation receipt;
- SEO/discoverability artifact and safety receipt;
- exact authorization-register bytes and every separate signed/reviewable authorization receipt.

The central authorization register is necessary but not sufficient. Each transition also requires an exact candidate- and environment-bound authorization receipt with review-evidence digest. The current statuses are all `not_requested` and `authorized: false`:

| Gate | Environment | Blocks |
| --- | --- | --- |
| AUTH-03 | staging | managed staging apply, shadow, and downstream promotion |
| AUTH-05 | production-like isolated recovery | managed failover/PITR/Hyperdrive/static recovery acceptance and public promotion |
| AUTH-06 | production internal canary | internal database-backed candidate traffic |
| AUTH-07 | production public | gradual public promotion |
| AUTH-08 | production soak | operating and evidencing the rollback-support window |
| AUTH-09 | production runtime | runtime JSONL retirement |
| AUTH-11 | zero-traffic production foundation | production foundation and forward migration apply |

AUTH-12, AUTH-13, AUTH-14, and AUTH-15 remain downstream quality/governance dependencies through planner, search, identity, coverage, and toolkit release gates. Their presence elsewhere never substitutes for the seven operational authorizations above.

## Stage procedures

### Stage 1 — expand

Entry: exact candidate; additive migration validation; N-1 compatibility; backwards-compatible routes/contracts; reviewed no-traffic plan; AUTH-11 before any managed production apply.

Action: add repository interfaces, migrations, resources, and workers without changing public reads. The public backend remains the unchanged static Worker.

Abort/rollback: stop before apply on any digest or compatibility drift. After an additive apply, leave the new unused structures in place and keep static reads. Never use a destructive down migration.

### Stage 2 — backfill

Entry: expand receipt and exact migration watermark.

Action: import corpus v1.1.0, live evidence metadata, Use/Access data, vocabularies, and join structures into isolated staging/backfill objects. Preserve aliases and unresolved identity candidates. Pin an import/reconciliation receipt.

Abort/rollback: reject the batch and rebuild isolated objects. Do not discard shared PostgreSQL database history, ingest runs, outbox, audit, evidence, or R2 captures. Public reads remain static.

### Stage 3 — shadow

Entry: reconciled backfill and AUTH-03 for managed staging work.

Action: run connectors/projectors into non-public stores and generations. Compare static and candidate dataset detail, browse, search, coverage, and disabled planner behavior against frozen fixtures/benchmarks. Planner inputs must be frozen or synthetic; raw production questions are prohibited.

Abort/rollback: pause connectors and projectors. Freeze publication pointer changes. Public reads remain static.

The checked-in WP14 shadow comparison is fixture-only. It is not live-source, load, quality, or public parity evidence.

### Stage 4 — internal canary

Entry: candidate deployed at zero percent, shadow gates, static fallback and generation rollback rehearsals, AUTH-03, AUTH-06, and AUTH-11.

Action: only an Access-protected internal hostname or trusted facade may inject the candidate version. Public request/header/cookie/query overrides are forbidden. Enable surfaces in order: dataset detail, browse, discover/search, then plan only after the independent planner gate passes.

Monitor: contract errors, search/planner latency, visibility safety, coverage reconciliation, generation consistency, and asset compatibility.

Abort/rollback: disable the server-side feature flag/version and return internal reads to static. A request-selected version is always a security failure.

### Stage 5 — gradual public promotion

Entry: all held-out/release/coverage/planner/toolkit/SEO gates; a measured 30-minute 2x workload; AUTH-05 measured recovery; AUTH-07; complete N-1 bundle; current schema/bindings tested with the N-1 Worker; cross-version asset matrix at zero 404; v1 translation compatibility.

Traffic steps are exactly `0 → 1 → 5 → 25 → 50 → 100` percent. Skipping or moving outside the sequence is denied. Every step must be bound to the same candidate and fresh telemetry receipt.

The rollback window begins at the first public database canary. It ends no earlier than 30 days after 100 percent and only after two qualifying live connector reconciliation cycles and two qualifying live rebuild/promote/rollback cycles. During the full window, prohibit destructive schema changes and retain every N-1 Worker, binding, physical resource, additive schema, immutable generation/manifest, asset bundle, and static artifact.

Abort/rollback:

- bad generation: atomically flip the active pointer to the retained exact N-1 publication; do not revert canonical storage;
- bad Worker: restore the prior Worker version and its assets together; do not revert PostgreSQL or R2;
- database/Hyperdrive failure: activate the pinned database-independent immutable static emergency artifact on every public surface.

### Stage 6 — soak

Entry: 100 percent timestamp, AUTH-08, support-retention lock, alert/on-call ownership, and incident process.

Completion requires all of the following, with real timestamps and live receipts:

- at least 30 full days after the 100 percent timestamp;
- two live connector reconciliation cycles;
- two live full rebuild/promote/rollback cycles;
- no unresolved coverage or visibility incident;
- queue/outbox age within SLO;
- every DLQ/workflow failure resolved, quarantined, or explicitly accepted with owner and deadline;
- managed PostgreSQL/backups/PITR, Hyperdrive, R2, and static artifact health and alerts exercised;
- no unresolved Sev1/Sev2 incident in the final interval.

Fixture time, fixture traffic, and fixture cycles count as zero for these denominators.

### Stage 7 — retire runtime JSONL

Entry: completed soak receipt, AUTH-09, N-1 dependency audit, healthy periodically rebuilt static emergency artifact, and measured managed failover/PITR/static drills.

Action: a separate reviewed change may remove runtime static loading and the production `stage:corpus` dependency. Retain JSONL for fixtures, evaluation, audit, correctness archives, and disaster recovery. Normal operational rollback remains immutable generation rollback.

Current status: ineligible. Runtime JSONL remains intact and active.

## Abort thresholds

The exact versioned thresholds live in `verification/wp14/v1.0.0/policy/cutover-policy.v1.0.0.json`. Promotion aborts on any contract error, visibility leak, generation mismatch, asset 404, coverage partition reconciliation failure, raw-question persistence, source/analysis action, unresolved DLQ, or five-minute workflow terminal error. It also aborts above 1% public error rate, search p95/p99 of 600/1500 ms, enabled-planner p95/p99 of 1200/3000 ms, or 300 seconds of oldest pending outbox age.

These are operator abort rules. The passing fixture sample is not production-like performance evidence.

## Required rollback receipt

Every real rollback receipt must pin:

- old/new Worker version IDs;
- all old/new binding and physical-resource IDs;
- additive database compatibility watermark and N-1/current-schema result;
- old/new publication manifests and search generations;
- complete asset bundle and zero-404 skew result;
- pinned static emergency export;
- support-expiry timestamp and minimum 30-day window;
- reason, operator, exact verification receipt, and incident link if applicable;
- explicit `storage_rollback_claimed: false` and `destructive_down_migration_included: false`.

Rollback of a Worker or pointer never claims PostgreSQL or R2 rollback. PITR targets must be isolated and must never overwrite the source system.

## Current evidence and pending external work

`verification/wp14/v1.0.0/receipts/zero-traffic-dry-run.json` records the exact local bytes and two fixture cycles. It ends at zero traffic on static fallback with runtime JSONL active. `verification/wp14/v1.0.0/evidence-ledger.json` and `requirements-dod-mapping.json` distinguish locally verified foundations from externally blocked acceptance criteria.

Before any live action, obtain the applicable exact authorization, capture a clean exact candidate, apply reviewed staging/production plans, satisfy every quality and compatibility gate, and create the stage receipt. Nothing in this package is a deployment command or implicit approval.
