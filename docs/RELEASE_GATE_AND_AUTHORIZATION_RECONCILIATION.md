# Release-gate and authorization reconciliation

Status: unresolved; no release-gate pass or production eligibility is claimed.

This record separates implementation evidence, release-gate evidence, and
external authorization. It is a review packet, not an approval to deploy,
contact live sources, apply migrations, or expose a candidate.

## Release-gate disposition

The one independent repository release-gate execution was:

| Field | Value |
| --- | --- |
| Run | `20260831T170024Z-3003695ba806` |
| Result | `failed` / `product_test_failed` |
| Candidate key | `84ef663271813687577992669dfca47981d4e1f18f12b9e65ade4fa15f290e6` |
| Candidate HEAD | `40f44fc9f586d1cae6d75292731382229df2278e` |
| Captured tree | `8a3f1655be1a7a551641da89d767be4f01f36660` |
| Receipt | `/home/plumbob/.local/state/release-gate/repositories/ushso-375cca760f7dab38/runs/20260831T170024Z-3003695ba806/receipt.json` |
| Independent evidence | `true` |

That candidate predates implementation commit
`f6edbb0b31530cdcf3391e8bddf85015d5d30265` and the separate attestation
commit `85c11018622079e35dc6a5736e7e8b3c6e5ac6ff`. Its root test stage failed;
downstream build, browser, artifact, and readback stages were skipped. The
focused WP3, WP6, and WP14 validations run after the failure are useful
diagnostics, but they are not a passing exact-candidate release gate.

The reconciliation path is the changed-candidate path, but the post-fix tree
is not yet frozen for a gate run:

1. The implementation subject remains
   `f6edbb0b31530cdcf3391e8bddf85015d5d30265`. Its separate WP14 attestation
   commit is `85c11018622079e35dc6a5736e7e8b3c6e5ac6ff`; the five attestation
   files attest `f6edbb0`, not the attestation commit or any later fix commit.
2. Subsequent bounded fixes and evidence refreshes are intentionally separate
   from those attestations. They include connector egress (`c73343d`), identity
   review state (`a095374`), generation-bound promotion evidence (`5ad4d61`),
   release-gate reconciliation (`6b1facc`), the Grok-reviewed PostgreSQL
   portability fix (`626bd4a`), the synthetic-fixture audit correction
   (`0a7598e`), and the CI/moving-checkout compatibility fix (`e790121`). A
   future gate candidate must therefore be frozen after those fixes, with its
   exact commit, tree, artifact manifest, environment, and scope recorded from
   a clean stable checkout.
3. That newly frozen candidate may receive one fresh normal release-gate
   execution only after a release owner records approval. No such second
   execution has been performed or authorized by this record. Focused tests
   after the failed run do not consume or satisfy that exact-candidate gate.
4. Until a fresh run exists and passes, the release-gate state is unresolved
   and must not be represented as `PASS`.

## Remote CI discrepancy and remediation

The first pushed CI attempt stopped in `release:audit` because the synthetic
AWS-shaped fixture literal in
`packages/web-discoverability/tests/bounds-and-portability.test.mjs` was
correctly classified as a credential-shaped repository string. That fixture
was rewritten without changing the runtime security assertion in `0a7598e`.

The next observed CI run (`33432383865`, job `99620584375`) reached the root
contract runner on merge checkout
`4b81f91461e4667840fff8175dc2be83c046d224`, but failed for four distinct
reasons:

- WP2 and WP14 invoked the Node 22-incompatible `--test-isolation=none` flag.
- WP3 required `rg`, which is not installed on the runner.
- WP6 treated the unavailable local `postgres:16-alpine` image as a hard
  failure even though network pulls are forbidden.
- WP14's exact-base checker rejected the merge checkout because its
  attestation is intentionally bound to `f6edbb0`, not to the moving merge
  commit.

Commit `e790121` addresses those discrepancies by using the supported Node 22
test-concurrency flag, POSIX `grep -Fq`, an explicit WP6 preflight-unavailable
classification that still fails real database errors, and a read-only
moving-checkout verifier that rechecks the five WP14 receipts against
`f6edbb0` and the attested tree. The generated receipt refresh is `e153bc3`.
It does not relabel the attestation, modify attestation-bound files, or turn
the historical attestation into a release-gate receipt.

Remote CI run `33436494328` passed at `e153bc3`: the Node 22 compatibility
job (`99634093033`) passed the full root test sequence and release audit, and
the dependent build/artifact-only Wrangler dry-run job (`99635181925`) passed.
The CI environment still lacks an available local PostgreSQL image, so WP6's
database evidence remains an explicit preflight-unavailable condition rather
than production-like database evidence. Any future local/CI receipt
discrepancy reopens the affected receipt rather than being silently accepted.

## Focused review disposition

The bounded reviews prioritized the requested high-risk surfaces. The
following fixes are present after the `f6edbb0` implementation and its
separate attestation:

- Connector egress now rejects non-active sources at the low-level HTTP
  boundary, blocks encoded dot-segment redirects and bracketed secret query
  names, and requires an explicit adapter profile before accepting JSON,
  HTML, XML, CSV, or plain-text bodies. Vendor media types fail closed.
- Identity projection and review-queue logic retain accepted-but-unbound
  automatic candidates and current deferred decisions. The review ledger
  rejects a second current decision unless it explicitly supersedes the
  current decision.
- Search promotion evidence now requires structured, generation-bound,
  digest-bound receipts rather than opaque non-empty evidence references. The
  follow-up fix replaces unavailable PostgreSQL `jsonb_object_length` calls
  with portable `jsonb_object_keys` counts and refreshes the affected package
  and WP8 receipts.

The final bounded Grok review independently rechecked these surfaces and made
only that portable SQL correction. It did not silently close the remaining
blockers: WP3 restore/privilege and role-reconciliation concerns, identity
reversal and load-path fail-closed behavior, the connector's positive
source-specific allowlist and transport pre-connect/streaming contract, and
toolkit schema/no-action-boundary gaps. The deferred principal-binding issue
remains AP-01.

The reviews also leave explicit blockers for human disposition rather than
turning local synthetic evidence into production claims:

- WP3 requires focused review of managed authorization binding, direct outbox
  updates and worker privileges, operator-forgeable recovery/archive/GC/job
  evidence, archive/restore proof, role reconciliation, and the mismatch
  between the local migration harness (through `0003`) and receipt wording
  that names `0001-0007`.
- The connector design still needs a positive source-specific metadata-route
  allowlist, a production transport contract that pins addresses before
  connect and streams response limits, and a bounded policy for embedded
  hostnames. Residual secret-key denylist coverage also needs an explicit
  activation decision. Current source manifests remain paused/fixture-only, so
  these are activation blockers, not evidence of live exploitation.
- The machine-toolkit planner is not wired into the public runtime, but its
  contract still needs to reconcile the disabled planner state with the
  successful response branch. Runtime/semantic response scanning also needs
  explicit coverage for embedded private or secret-bearing URLs and adapter
  error-envelope shape. These remain publication blockers while the toolkit is
  unwired.
- Identity still needs a fail-closed reversal rule for a later human
  `not_same_identity` or `defer` decision and a load-path check for duplicate
  current decisions. These remain distinct from the already-fixed write-path
  uniqueness guard.
- The deferred `privileged-control-plane-principal-binding` issue remains
  AP-01. No production eligibility, full attribution, live source activation,
  or managed migration authorization is implied by the local receipts.

## Packet rules

Each packet below is request-ready but unauthorized. A future approval must
record, at minimum:

- packet ID, decision owner, approver, timestamp, and decision;
- exact candidate commit, tree, artifact manifest, environment, and scope;
- prerequisite receipt digests and the evidence custodian;
- permitted action, expiration, stop conditions, and rollback/retention plan;
- the resulting execution receipt and any unresolved exception.

The central register at
`verification/external-authorization/v1.0.0/register.json` remains the
authoritative blocker register. Its entries remain `not_requested` and
`authorized: false`; a packet never self-authorizes an action.

## Ordered authorization packets

### AP-01 — Principal-binding disposition

- Decision owner: Security and Platform owners.
- Scope: deferred `privileged-control-plane-principal-binding` issue.
- Decision: remediate caller-supplied audit IDs/principal values by deriving
  them from a trusted authenticated context, or document a bounded residual
  risk with owner, expiry, non-public boundary, and compensating controls.
- Required evidence: handler inventory; trust-boundary diagram; authenticated
  principal source; audit-ID derivation test; privilege and negative tests;
  reviewer disposition receipt.
- Forbidden before disposition: production use of caller-supplied principal or
  audit identity, and any claim that the privileged control plane is fully
  attributable.

### AP-02 — Planner-governance decision (`AUTH-12`)

- Decision owner: Product, research-methods, and engineering owners.
- Scope: ratify formulas, thresholds, strata, denominator floors, and the
  prohibition on held-out-result tuning.
- Required evidence: sealed WP10A package, three-split manifest, owner review,
  deterministic compiler contract, and no-held-out-scoring attestation.
- Forbidden before authorization: WP10B compiler implementation or activation,
  `/api/plan` activation, and live compiled-plan injection.

### AP-03 — Researcher usability study

- Decision owner: Research UX/Product owner.
- Scope: at least five representative health-services researchers perform the
  result-card source-choice task.
- Required evidence: preregistered protocol, participant/consent handling,
  aggregate-only results, task timing, intended-source selection rate of at
  least 80% within 30 seconds, and zero analytics-result
  misinterpretations.
- Forbidden before evidence: a beta usability claim or a claim that card order
  is understood as non-analytic.

### AP-04 — Expert asset and Use-Card review

- Decision owner: Research-methods/Product owner.
- Scope: two independent reviewers assess 12 stratified assets.
- Required evidence: reviewer independence/conflict record, review rubric,
  per-asset critical-field result, 100% critical-field accuracy, zero
  unsupported claims, and aggregate review receipt.
- Forbidden before evidence: approval of decision-summary, Use-Card, or Access
  Plan claims as expert-reviewed.

### AP-05 — Protected retrieval holdout (`AUTH-13`)

- Decision owner: Search/Evaluation owner and independent custodian.
- Scope: one-time aggregate-only evaluation of a fresh 20-item holdout against
  the frozen candidate.
- Required evidence: never-published/never-evaluated custodian attestation,
  frozen ranking fingerprint, durable single-use ledger, aggregate-only output,
  and no-post-result-tuning attestation.
- Forbidden before authorization: protected-holdout scoring, tuning after the
  result, or a final retrieval-pass claim.

### AP-06 — Identity adjudication (`AUTH-14`)

- Decision owner: Identity owner and independent reviewers.
- Scope: sealed 720-case benchmark, required double-review sample, and
  per-stratum adjudication.
- Required evidence: reviewer instructions, conflict policy, reviewer
  identities, controlled-fixture exclusion, per-stratum receipt, and explicit
  preservation of unresolved/reversible matches.
- Forbidden before authorization: production auto-resolution enablement or a
  claim that uncertain identities were adjudicated.

### AP-07 — Coverage wording approval (`AUTH-15`)

- Decision owner: Product owner.
- Scope: digest-bound approval of WP9 coverage and zero-result wording.
- Required evidence: sealed coverage snapshot, 51-by-6 not-assessed matrix,
  three-digest review packet, and exact non-exhaustive wording.
- Forbidden before authorization: representing preview wording as approved
  exhaustive coverage or collapsing scoped absence into `not_found`.

### AP-08 — Production-like load and isolated recovery

- Decision owner: Operations/Platform owner.
- Register references: `AUTH-01`, `AUTH-02`, `AUTH-03`, `AUTH-05`, and
  `AUTH-11`.
- Scope: provision only approved isolated resources, run the measured 30-minute
  2x workload, and perform failover/PITR/Hyperdrive/static recovery against an
  isolated target.
- Required evidence: provider/IaC plan, least-privilege bindings, RPO/RTO,
  capacity and latency/error/headroom receipt, restore receipt, complete
  rollback bundle, and environment-isolation proof.
- Forbidden before authorization: paid provisioning, secret creation, managed
  migration apply, production-like load against shared systems, or overwrite
  of a source database during restore.

### AP-09 — Live metadata canary (`AUTH-04`)

- Decision owner: Connectors/Operations owner.
- Scope: bounded metadata-only canaries against an approved source-by-source
  allowlist.
- Required evidence: fixture matrix, SSRF/payload-sentinel result, route/object
  allowlist, pause/DLQ controls, denominator accounting, and source-specific
  stop/retention receipt.
- Forbidden before authorization: source-data payload routes, row inspection,
  credentials, forms, payments, or unrestricted connector traffic.

### AP-10 — Internal canary and public cutover (`AUTH-06`, `AUTH-07`)

- Decision owner: Release/Security owner.
- Scope: exact version-selected internal traffic followed, if accepted, by
  `0 → 1 → 5 → 25 → 50 → 100` percent public promotion.
- Required evidence: clean exact candidate, all quality gates, N-1 asset/schema
  compatibility, zero-404 matrix, measured load/recovery, protected version
  selection, and operator-approved rollback bundle.
- Forbidden before authorization: request-selected versions, public traffic,
  or a claim that the database-backed candidate is active.

### AP-11 — Soak and rollback-support window (`AUTH-08`)

- Decision owner: Operations/on-call owner.
- Scope: at least 30 days after 100% cutover and two qualifying live cycles of
  each required reconciliation/rebuild kind.
- Required evidence: 100% timestamp, alert/on-call ownership, retention lock,
  incident process, live queue/DLQ/recovery receipts, and no unresolved Sev1/2
  or visibility/coverage incident.
- Forbidden before completion: shortening the window with fixture time or
  claiming fixture cycles as production soak.

### AP-12 — Runtime JSONL retirement (`AUTH-09`)

- Decision owner: Release/Operations owner.
- Scope: separate reviewed change after the completed soak and rollback
  window.
- Required evidence: completed AP-11 receipt, two live rebuild/promote/rollback
  cycles, two live connector reconciliations, healthy static emergency artifact,
  N-1 dependency audit, and retention plan for fixtures/evaluation/audit/DR.
- Forbidden before authorization: removing runtime static JSONL, deleting
  rollback artifacts, or using destructive down migrations as rollback.

## Current authorization state

All packets are pending. No packet authorizes external traffic, provider
mutation, production migration, canary, cutover, soak, retirement, planner
activation, holdout evaluation, identity adjudication, or approved coverage
wording. The only separately authorized external action in the current task is
publishing this review branch and updating draft PR #3; that scope does not
authorize any production action.
