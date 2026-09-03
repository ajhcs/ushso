# Research Navigator execution ledger — 2026-09-01

Status: working orchestration record. This file records verified local state and
bounded work in progress; it does not authorize external action or change any
authorization status.

## Checkpoint and boundaries

- Frozen implementation checkpoint / PR #3: `db6ef95372910e63e3fba5bc8d6e6f58276af9ee`
  (`codex/research-navigator-handoff`, draft PR
  <https://github.com/ajhcs/ushso/pull/3>).
- Successor worktree: branch `codex/research-navigator-successor`, based exactly
  on the frozen PR head above. This branch is for distinct deferred work and
  does not rewrite or append unrelated changes to PR #3.
- The main worktree has user-owned `RELEASE_PROVENANCE.json` modifications and
  untracked `.serena/` state. Neither is part of this work or provider context.
- The historical release-gate receipt remains a failed result for its earlier
  candidate (`20260831T170024Z-3003695ba806`, `product_test_failed`). It is
  preserved and will not be rerun or reinterpreted without a new owner decision
  and an approved successor-gate procedure.
- `verification/external-authorization/v1.0.0/register.json` remains unchanged:
  AUTH-01 through AUTH-17 are `not_requested` and `authorized:false`; this
  ledger does not grant or imply authorization.

## Verified gap matrix

| Requirement / invariant | Verified local evidence | Missing work or residual | Owning subsystem | Proposed collaborator | Boundary and verification gate | External dependency / classification |
| --- | --- | --- | --- | --- | --- | --- |
| Managed database roles, privilege proof, and environment binding | `db/bootstrap/roles.sql`, `role-matrix.v1.json`, `db/migrations/manifest.json`, WP3 least-privilege and migration receipts; local static checks pass; attestation now walks recursive membership and protected-schema ACLs | Managed-provider catalog evidence, role/grant inspection, Hyperdrive binding proof, failover/PITR/RPO/RTO and workload evidence | `db/`, `infra/terraform/`, WP3 | Hubble; Grok review for privilege/security-definer concerns | Separate infrastructure/evidence PR; static SQL/manifest/attestation tests locally, then owner-authorized managed rehearsal | Requires managed infrastructure and AUTH-01/02/03/05/11; no provider mutation authorized |
| Trusted principal binding / AP-01 | `packages/ingestion/src/audit-principal.mjs`, PostgreSQL control-store tests, forged/mismatch negative tests | Runtime-authenticated principal source, handler-to-store binding proof, owner residual-risk disposition if technical proof cannot be completed | Ingestion/auth boundary | Zeno; Grok adversarial review | Separate auth-boundary PR or decision packet; focused principal tests and exact evidence inventory | Requires genuine trusted auth context and owner/security-platform decision; AP-01 remains pending |
| Archive, restore, recovery, and rollback integrity | `db/tools/archive-partition.mjs`, `restore-archive.mjs`, operation-specific authorization verifier/schema, WP3 local Docker fixture tests, WP14 rollback state machine | Isolated managed target restore, provider backup/PITR/failover evidence, operator authorization and recovery receipts | `db/`, WP3, WP14 | Hubble; Grok review | Separate operations/evidence PR; local failure-injection, authorization-negative, checksum, and isolated-restore tests, then authorized isolated rehearsal | Requires managed infrastructure and AUTH-02/03/05/11; production evidence forbidden here |
| Durable compare-and-swap and append-only publication transitions | WP14 durable adapter contract and fixture tests; inspection found an async interleaving race in the in-memory fixture store | Serialize/recheck concurrent fixture commits, bind state history to the ledger, protect the fixture durability label, and reject direct fixture production appends; authoritative transactional adapter remains unproven | `verification/wp14/v1.0.0/` | Cursor implementation; Grok review; Zeno independent local audit | Dedicated CAS-only successor PR; concurrent `Promise.all` regression, replay/failure-injection/production-rejection tests, and an exact-code-bound local receipt. Historical WP14 attestation requires a separate owner-approved reseal procedure before aggregate CI can pass. | Local implementation/verifiable fixture hardening; authoritative durability and any attestation reseal require managed/database evidence or owner direction |
| Connector transport, DNS/redirect/egress boundaries | Connector network policy, bounded client, pinned streaming transport, route allowlists, fixture/security tests | Provider-specific production transport proof, live DNS/address pinning rehearsal, AUTH-04 canary, source payload boundary evidence | `packages/connectors/`, WP5 | Hume; Grok adversarial review | Separate connector safety PR; all fixture/negative suites and static egress audit; live transport remains disabled | Production traffic and AUTH-04; no live canary authorized |
| Terraform CLI/provider and trusted catalog attestation | Pinned Terraform/provider versions and lockfiles; static schema/attestation tests; recursive membership and protected-schema ACL checks are bound into canonical evidence; README explicitly records no provider API plan/apply | Real CLI/provider schema compatibility, provider plan/apply, managed catalog/role attestation, digest-bound execution receipt | `infra/terraform/`, WP3 infrastructure | Hume; Grok trust-boundary review | Separate infrastructure-enablement PR; local `fmt`/validation/static tests, then owner-authorized provider rehearsal | Requires credentials/managed provider and AUTH-01/02/03/05/11; no secrets or provider mutation |
| Canonical migration/import/readiness | Migrations 0001–0007 sealed in manifest; local harness through 0003; WP6 tests pass; normalization import/readiness tests pass | Managed application through 0007, rollback against isolated target, provider role/readiness receipts | `db/migrations/`, normalization, WP6 | Hubble | Migration/application vertical slice only; local checksum/N-1/idempotency/readiness suites, then managed rehearsal | Managed infrastructure and authorization; local proof cannot become managed proof |
| Search generations, migration 0010, pinning, and holdout | WP8 generation/pinning tests pass locally; SQL `0010` and offline ledger exist; WP8 evidence ledger marks managed/load/holdout pending | Apply/verify migration 0010, query-plan/load evidence, authoritative publication ledger, protected holdout and independent review | `packages/search/`, WP8 | Zeno; Grok for immutable publication/cutover concerns | Separate search/publication PR; affected suites plus exact generation/CAS tests | Requires managed database, protected holdout, expert/independent evidence (AUTH-13/17) |
| Observability, DLQ, retry, and privacy controls | Ingestion/outbox/DLQ modules and tests; source payload/raw-query restrictions and connector ledgers are present | Full fault-injection matrix, queue expiry/DLQ operational receipt, retention/deletion dependency proof, managed metrics/alerts | Ingestion, connectors, WP4, DB policies | Hubble + Hume | Operations PR aligned to WP4/WP3; local failure-injection and privacy sentinel tests, then authorized rehearsal | Managed queues/database and external operational authorization; no live action |
| Planner governance and public product boundary | Planner/toolkit contracts reject unsupported scope; WebMCP remains protected/unwired; plan docs preserve metadata-only boundary | Owner governance authorization, usability/expert evidence, runtime activation decision | Planner/WebMCP/WP10–WP12 | Zeno | Documentation/evidence packet; contract tests and redaction checks | AUTH-12/16/17 and human evidence; no planner activation |
| Cutover, retirement, release gate, and production eligibility | WP14 fixture-only state machine/rehearsal; PR #3 exact-head security/CI receipts; no production claim | Stable successor candidate, managed and human prerequisites, authorized successor release gate, soak/canary, runtime JSONL retirement | WP14/release process | Orchestrator owns integration; Grok may review bounded transition code | Each successor PR must carry exact-head receipts and rollback notes; historical failed gate stays historical | AUTH-06/07/08/09 plus explicit release authorization; production remains prohibited |

### Classification summary

Locally implementable and verifiable work includes the fixture CAS race fix on
its dedicated successor branch, negative/contract tests, static Terraform and transport checks, migration
manifest/readiness checks, documentation, and deterministic receipt tooling.
Managed-provider catalog/privilege/backup/restore/CLI evidence, live connector
transport, protected holdout results, human review, production traffic, soak,
cutover, and release-gate execution are external prerequisites. Any material
change to the architecture or independence requirements requires an owner
decision or ADR before implementation.

## Assignment ledger

Assignments use an immutable exact selected base: the frozen checkpoint for the
initial audits and CAS review, and a successor commit for the later principal
and connector slices. No assignment has access to secrets, credentials,
cookies, private keys, `.env` files,
`.serena/`, the main worktree's local state, or `RELEASE_PROVENANCE.json`.
Provider responses are proposals, not approvals.

| Provider / task | Scope and allowed files | Deliverable | State / receipt |
| --- | --- | --- | --- |
| Luna / Hubble — `01a05d0a-f895-7500-9fa8-1007c8a07e80` | Read-only `db/**`, `packages/ingestion/**`, `packages/normalization/**`, `verification/wp3/**`, `verification/wp6/**` | Evidence-led audit of privilege, recovery, migration, rollback, and CAS-adjacent gaps; separate local fixes from external blockers | Completed; normal read-only receipt; no files or commits changed |
| Luna / Hume — `01a05d0a-f4d9-7b11-b9fa-e52142d49b87` | Read-only `packages/connectors/**`, `infra/terraform/**`, `verification/wp5/**`, `verification/wp3/v1.0.0/infra/**` | Egress/transport/Terraform/provider-attestation audit with exact local verification and external dependencies | Completed; normal read-only receipt; connector tests 5/5; no files or commits changed |
| Luna / Zeno — `01a05d0a-f5d9-7010-8267-daef47052a98` | Read-only `packages/search/**`, `packages/ingestion/src/audit-principal.mjs`, `packages/ingestion/tests/**`, `verification/wp8/**`, `verification/wp14/**`, `verification/external-authorization/**` | Principal/CAS/generation/publication audit and evidence-bound implementation recommendations | Completed; normal read-only receipt; WP8 pass, WP14 stale-base failures confirmed; no files or commits changed |
| Co-Engineer mixed Grok+Cursor attempt | Intended two isolated bounded assignments; submission was rejected before dispatch because its payload was not proven to exclude full-repository exposure | No provider work or approval resulted; retained as a safety event | Rejected/unsubmitted; no receipt |
| Cursor / `ushso-cas-cursor-0901` | Sanitized mirror only; target `verification/wp14/v1.0.0/src/durable-transition.mjs` and `verification/wp14/v1.0.0/tests/durable-transition.test.mjs` | Implement fixture-only CAS serialization hardening and a concurrent regression test; run focused test and report assumptions | Completed; normal receipt; proposed two-file patch inspected, focused test 1/1 pass, mirror-wide test blocked by missing binding; not an approval |
| Grok / `ushso-cas-grok-0901` | Same sanitized mirror; read-only review of the two CAS files and directly relevant WP14 docs | Adversarial findings on concurrency, append-ledger/state invariants, failure injection, and production fixture rejection; not an approval | Completed; normal receipt after an intermediate transport-lost status; review result was bounded/truncated by provider, no files or commits changed, not an approval |
| Orchestrator local DB attestation slice — `c1a8d20` | Successor database-attestation worktree from `a57f1f5`; Terraform/PostgreSQL attestation, environment schemas/manifests, tests, README, and three digest-bound WP3 receipts | Bind recursive role-membership closure and protected-schema explicit/default ACL checks into the prebinding proof and canonical digest | Completed; WP3 infra tests 4/4 and DB static validator pass; no Terraform CLI, Docker, provider, database, or managed resource was available or used |
| Orchestrator local DB operations slice — `c0c8901` / `4992694` / `e73def8` / `34c13b7` | Operations worktree from `a09adbb`; `db/tools/**`, role reconciliation, authorization schema, WP3 authorization tests/static checks, README, and local receipts | Bind every managed database tool to an exact action, database, fingerprint, canonical scope, current expiry, and fail-closed receipt envelope; bind local evidence to the pre-refresh Git commit/tree | Completed; isolated WP3 suite 17/17, aggregate WP3 validation and static validator pass; receipts bind `e73def8` and its tree; no managed provider, credential, or external resource used |
| Luna / Zeno — resume submission `01a05d33-e623-7b70-bd08-051e32abd8b8` | Successor worktree at the CAS-hardening exact base; only `packages/ingestion/src/audit-principal.mjs` and `packages/ingestion/tests/postgres-control-store.test.mjs` | Remove claimed-ID input from trusted principal lookup, enforce actor-type allowlist, and add echo/type/binding tests; no AP-01 completion claim | Completed; normal subagent result; orchestrator inspected and committed as `55c8257`; local contract hardening only, real principal provenance and AP-01 authorization remain pending |
| Cursor / `ushso-connectors-cursor-0901` | Sanitized mirror `f518450fc2b930cb97e8a75cbad82c4dc16f0005`; only the six connector source/test files in the task prompt | Exact fixture route-key checks, raw redirect `Location` checks before URL normalization, and capture coherence/byte-bound tests | Completed; normal receipt after an intermediate transport-lost status; six-file uncommitted candidate inspected, fixture tests reported 28/28, no provider commit accepted, no live/managed claim |
| Grok / `ushso-connectors-grok-0901` | Same sanitized mirror; read-only review of the connector safety slice and WP5 evidence | Adversarial review of fixture allowlisting, raw redirects, capture bounds, socket pinning, streaming, and managed/live limitations | Completed; normal receipt after an intermediate transport-lost status; no files changed; result was provider-truncated and is review input only, not approval |

The sanitized provider mirror was created from selected tracked paths at the
frozen checkpoint and contains no excluded local-state paths. The direct
Cursor/Grok tasks are separate bounded tasks because the earlier mixed run was
rejected; they must not be represented as one coordinated independent review.

## Audit updates requiring follow-up

- Hubble found direct SQL audit/recovery/archive/GC paths broader than the
  application principal guard, completion paths that do not repeat GC
  authorization, recovery controls that are not consumed at runtime, and
  generic operation receipts that are not bound to database, fingerprint,
  candidate, scope, or expiry. These are local hardening candidates, but managed
  role/catalog, archive/restore, failover/PITR, and principal evidence remain
  external.
- Hume found that the pinned streaming wrapper cannot force an injected inner
  transport to pin the actual socket, capture storage relies on upstream
  validation, and redirect normalization weakens raw-path checks. It also found
  that Terraform attestation checks do not cover recursive membership, effective
  ACLs, or authenticity-bound runner output. Connector tests remain fixture
  evidence only; no live transport or provider API was used.
- Zeno found stale WP14 receipt/base bindings, caller-supplied SQL publication
  authorization references and digests, missing SQL visibility predicates for
  linked revisions, and the AP-01 dependency-injection limitation. These need
  separate search SQL/auth/ADR work and must not be hidden by repinning old
  receipts.
- Grok independently identified the fixture CAS race and recommended a mutex,
  state/history-to-ledger binding, direct production-append rejection, and
  additional replay/clone-isolation tests. Its result is review input only;
  the local branch implements and verifies the orchestrator-selected subset.
- The scoped CAS receipt is kept only on the dedicated CAS-only successor
  branch. It binds the focused 3/3 pass to code commit
  `f2641a3bfd5ae7249d0acffff883b312e4bdb077` and tree
  `dc80d1c0f9ff7d8c4a2a4a8beb01ed2723878675`; its canonical digest is
  `sha256:1bfc1813a2d0383c3b56a626af4c80a90b68150042e979cbfd9b79b1cef37e2d`.
  It records the full WP14 result as 10/26 passing and 16/26 blocked by the
  historical base pin, not as a pass. The AP-01/connector/database PR line
  does not carry this receipt or the CAS implementation.
- The AP-01 hardening commit `55c8257` removes the claimed operator ID from
  the trusted-source input, rejects unsupported actor types, and passes the
  ingestion package suite 6/6. It does not prove a runtime-authenticated
  principal, managed role binding, or AP-01 authorization.
- The connector safety slice is integrated on this candidate after orchestrator
  inspection. It enforces explicit fixture route keys (including the declared
  Census schema fixture route), raw redirect checks before URL normalization,
  manifest/source/final-URL capture coherence, and capture byte bounds. The
  connector suite, package validation, and WP5 local validator pass; Grok's
  review keeps actual socket pinning, streaming-time memory bounds, managed R2,
  and AUTH-04 external. The refreshed implementation fingerprint is
  `c872bc72937c2b5cfd301535e4546778a8bd9af7bdd80fbdcebfa1c4bebd9487`.
- The database-attestation slice `c1a8d20` adds recursive role-membership and
  protected-schema explicit/default ACL checks to local prebinding evidence and
  propagates `unexpected_acl` through Terraform, manifests, canonical material,
  tests, and receipt pins. It still does not prove managed role catalogs,
  provider authenticity, or a trusted runtime principal.
- The database operations slice `c0c8901` binds foundation apply, role
  reconciliation, partition management, archive, restore, and direct
  maintenance checks to an exact database authorization envelope. Its
  `4992694` receipt refresh records 17/17 local tests and continues to mark
  managed evidence as `pending_external_authorization`; it does not prove
  provider authenticity, managed execution, or recovery performance.
- The follow-up receipt-provenance commit `e73def8` records the pre-refresh
  Git commit and tree in the WP3 local result and dependent receipts;
  `34c13b7` refreshes those artifacts and the aggregate WP3 validator passes.
  The final receipt-refresh commit is intentionally not self-attested as the
  tested implementation tree.

### Operations-branch post-split provenance

The database-operations branch now includes the additive CAS split correction
after the receipt-refresh commit. The isolated Docker rerun at branch tip
`d846bcbb84b5a42e2b8ae6bbda52e4ef3cef576f` passed 17/17 tests with zero network
calls and no host ports bound. The checked-in WP3 receipts intentionally remain
bound to their earlier tested implementation commit `e73def8` and tree
`54f99603965d6e267a0c65cd4db198dd003d775d`; the later rerun is corroborating
local evidence, not a new committed receipt or a managed-provider claim.

## Evidence and authorization invariants

- Local, fixture, simulated, managed, staging, and production evidence remain
  distinct. A passing local test cannot satisfy a managed or production gate.
- No authorization register entry is changed by this ledger or by provider
  output. AP-01 through AP-12 remain request-ready/pending only.
- No human review, independent adjudication, protected holdout, canary, soak,
  managed backup/restore, managed privilege proof, or production eligibility is
  claimed.
- Any successor receipt must bind the exact commit, tree, inputs, environment,
  and artifact digests. Existing PR #3 receipts remain historical evidence for
  its exact head and are not silently repinned.
- The product remains a public-source research recommender/planner. No change
  in this work may execute analyses, calculate market share, produce financial
  benchmarks, or turn the system into a general analytics application.

## Current integration and local-gate checkpoint — 2026-09-01

The clean integration candidate is `c680fb6b035848e0d74b5ed035bb33ac35092d65`
with tree `943be7c718fce4dd102365c31d28bd468bb8cc02` on
`codex/research-navigator-integration`. It contains PR #3 through PR #7 as
ordered merges, the selectively ported PR #8 CAS successor with its original
attestation ancestry attached by `49e5658`, and the focused WP4 disabled
composition seam in `63929b3`.

The WP4 receipt was regenerated against the current implementation and now
reports `pass_local` with `service_composition: pass_static_markers` and zero
actions. The new `services/scheduler-worker/worker.mjs` and
`services/harvest-worker/worker.mjs` exports are dependency-injected and
disabled by default. They make the composition boundary testable; they are not
Cloudflare deployment roots and do not prove managed Queue, Workflow, Cron,
DLQ, Hyperdrive, or PostgreSQL behavior.

The exact local sweep in a writable isolated clone passed the root contract and
verification suites, WP4, ingestion, WP6 (14 tests with local PostgreSQL), WP8
(35 scaffolding tests), WP10A, WP11, WP12, WP13, WP14, program verification,
external-authorization validation, and CI verification. WP14 v1.1 validation
passed 24/24 checks and remains bound to `f2641a3`; it does not attest this
later integration tree. WP8 remains `FAIL_PRE_TUNING` and WP10B remains
unauthorized by design.

The candidate reconciliation packet is
`docs/research-navigator-reconciliation-2026-09-01.json`, with its schema and
human-readable companion. It explicitly separates manifest-file SHA-256 from
corpus-content and algorithm fingerprints. It records the legacy
`RELEASE_PROVENANCE.json` manifest field as a content-fingerprint alias and
preserves that historical file unchanged.

### Current Co-Engineer safety disposition

The fresh Cursor-local aggregate `ushso-cursor-wave-0901` was submitted with
six implementation/fix scopes and two read-only review scopes against the exact
candidate base. The required `decision_or_attention` wait returned all eight
lanes `dispatch_failed`; no child task, worktree, commit, artifact, or remote
mutation exists. The provider was not given candidate files.

The fresh Grok submissions were rejected by payload safety before dispatch,
first for a selected-path mirror and then for the two-file CAS mirror. No code
was sent to Grok and no indirect retry was attempted. Historical bounded Grok
and Cursor receipts remain review input only and do not constitute approval or
independent release evidence.

### Reconciliation and release boundary

- Local implementation evidence is partially complete; WP8 remains
  `FAIL_PRE_TUNING`, and the exact gate failed on the immutable WP0 aggregate
  receipt.
- Managed, live, human, holdout, canary, recovery, load, soak, public, and
  retirement evidence is blocked by the unchanged authorization register.
- `AUTH-01` through `AUTH-17` remain `not_requested` and `authorized: false`.
- No production deployment, live request, managed mutation, secret, migration,
  public pointer switch, protected holdout score, human review, remote push, or
  PR was created.
- The exact release gate was executed once against this clean frozen tree. Run
  `20260901T185317Z-773cc4870771` completed with
  `failed` / `product_test_failed` and candidate key
  `b64fa8dfc3406f4a4cade312efe4a0a5f9c16c1cfe929b1d90a9b9bb5ec01985`. Its
  first failure was the immutable WP0 v1.0.0 aggregate receipt being stale for
  this candidate (`WP0_AGGREGATE_RECEIPT_STALE`); build, browser, and artifact
  stages were skipped by the fail-fast gate. The canonical receipt is
  `/home/plumbob/.local/state/release-gate/repositories/ushso-375cca760f7dab38/runs/20260901T185317Z-773cc4870771/receipt.json`.
  The old `20260831T170024Z-3003695ba806` failure remains historical. No
  release eligibility follows from either failed run, and the WP0 v1.0.0 final
  receipt was not overwritten.
