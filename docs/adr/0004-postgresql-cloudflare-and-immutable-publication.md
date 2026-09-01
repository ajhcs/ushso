# ADR 0004: PostgreSQL, Cloudflare, and immutable publication

- **Status:** Accepted
- **Implementation state:** `in_progress`
- **Decision date:** 2026-08-30
- **Decision owners:** Platform, Data, Operations, Security
- **Accountable approver role:** Platform architecture owner
- **Acceptance basis:** Authoritative plan-execution directive dated 2026-08-30
- **Plan authority:** `docs/RESEARCH_NAVIGATOR_IMPLEMENTATION_PLAN.md` §§5–9,
  13, 17–18, 20 (WP3–WP4), 23.5, and 24
- **Supersedes:** No prior ADR
- **External state:** No production or paid resource has been authorized or
  provisioned by this decision

## Mapped requirements and tests

| Source | Requirement or test |
|---|---|
| Plan | §§5–9, 13, 17–18, 20 (WP3–WP4, WP8, WP14), 23.4–23.5, 23.8, and 24 |
| Tester requirements | TST-COV-02, TST-TRUST-01, TST-MCP-03, TST-MCP-04 |
| Acceptance tests | `environment-isolation`, `least-privilege`, `hyperdrive-correctness`, `r2-capture-protocol`, `publication-lifecycle`, `recovery-drills`, `rollback-bundle` |

## Context

The existing public runtime loads an immutable JSONL corpus. The Research
Navigator needs a canonical and operational store, durable ingestion control,
bounded evidence capture, and replaceable search projections without weakening
the emergency-static rollback path. Public requests must see one coherent
canonical/search/SEO/coverage view even while harvesting and normalization
continue.

The platform must also preserve these non-negotiable boundaries:

- PostgreSQL, not a search projection or R2 object, is the canonical and
  operational source of truth.
- R2 may contain bounded public metadata and documentation evidence. It may not
  contain source dataset payloads, healthcare rows, credentials, cookies,
  authorization material, or secret-bearing URLs.
- A failed or incomplete pipeline run cannot replace the last-known-good public
  publication.
- Public routes never harvest an authoritative source and never receive source
  credentials.
- Staging and production resources, identities, bindings, and secrets must be
  visibly and technically distinct.
- Operational rollback is a publication-pointer, Worker-version, or static
  fallback operation. It must not rely on destructive down-migrations.

## Decision

### 1. Managed PostgreSQL target

The initial managed database target is **Neon Business/Scale-class PostgreSQL in
AWS `us-east-1`**. Business is the baseline procurement class; Scale is used if
the security, contractual SLA, support, or measured capacity review requires
it. A lower service class is not an implicit substitute.

Production and staging use separate Neon projects and separately scoped
credentials. Staging must not be a shared production database, schema, or
credential set. The production compute has scale-to-zero disabled. Application
traffic uses a standard, direct, non-pooled PostgreSQL endpoint over TLS through
Cloudflare Hyperdrive; it does not use the Neon serverless driver or a Neon
pooled endpoint behind Hyperdrive.

The initial sizing assumption is a **1–4 compute-unit autoscaling range** for the
production application endpoint. This is a planning input, not a capacity
claim. WP3 must replace it with a versioned workload manifest, measured
connection budget, storage/IO forecast, and a 2× capacity receipt before public
database-backed traffic. Connection caps, statement duration, Worker Placement,
and autoscaling bounds are set from the then-current Neon and Cloudflare limits
and measured query behavior.

The target backup posture is a **30-day point-in-time restore window**. Initial
service-recovery objectives are **RPO ≤ 5 minutes** and **RTO ≤ 30 minutes**.
They remain provisional until a provider failover and an isolated PITR restore
are timed and receipted. Provider high availability, automatic compute
recovery, contractual SLA, support response, region/residency, backup semantics,
connection limits, and restore behavior must be confirmed against the procured
plan; this ADR does not treat marketing or documentation as an executed drill.

Schema migration, PITR recovery, bulk backfill, and controlled maintenance use a
separately secured direct-database path. Public Worker credentials can never be
reused for that path.

### 2. Reproducible infrastructure and environment isolation

Terraform is the infrastructure-as-code authority for provisioned Neon and
Cloudflare resources. Provider versions are pinned. Production and staging use
different environment inputs, state scopes, resource names, bindings, secrets,
database projects, R2 buckets, Queues, DLQs, Workflows, and service identities.
An encrypted, access-controlled remote state backend and its recovery procedure
must be approved before the first apply.

Terraform plans are reviewed artifacts. Production apply, paid service
procurement, secrets creation, DNS changes, and traffic changes require explicit
external authorization. CI may validate and produce redacted plans, but it may
not apply production changes.

Internal operations routes are protected by **Cloudflare Access**, use a
dedicated operations service identity/role, and append an audit record for
pause, replay, review, promotion, rollback, retention override, and deletion
actions. An untrusted public request cannot select a candidate Worker version or
invoke an operations route.

### 3. Worker and database-role separation

The deployment keeps separate Worker roles, with bindings and PostgreSQL grants
limited to their functions:

| Worker | Allowed capabilities | Explicitly denied |
|---|---|---|
| `ushso-public` | Read published generation views and immutable assets | Connector credentials, source egress, R2 writes, Queue production, canonical writes |
| `ushso-scheduler` | Read schedules, lease due work, create runs/outbox events, start Workflows | Public promotion, capture reads, source credentials |
| `ushso-harvest` | Fetch allowlisted authoritative endpoints, write bounded captures to R2, update ingestion state | Public promotion, canonical acceptance |
| `ushso-normalize` | Read referenced captures, write canonical proposals/revisions, enqueue enrichment | Source-network requests, public promotion |
| `ushso-projector` | Read accepted canonical revisions, build and validate candidate projections | Source-network requests, source credentials, mutable edits to an active generation |
| `ushso-ops` | Access-protected review, pause, replay, promotion, rollback, and audited maintenance controls | Unauthenticated public access |

Database roles mirror these boundaries. Grant tests, not naming conventions,
must prove the denials.

### 4. Hyperdrive connection and cache semantics

Each environment has at least two deliberately different Hyperdrive bindings:

1. A **cache-disabled correctness binding** for writes, leases,
   read-after-write operations, publication-history writes, and resolving or
   changing the active-publication pointer.
2. A normal read binding whose query cache is used only for immutable,
   generation-pinned reads.

Every public request resolves the active publication manifest exactly once via
the cache-disabled binding, then passes the explicit manifest, generation,
canonical-revision, SEO, and coverage IDs through all downstream reads. A cached
view must not dereference the mutable active pointer internally, and every cache
key includes all relevant immutable publication IDs.

Workers use the standard PostgreSQL `pg` client. Transactions are short and
chunked. A Workflow creates a fresh client inside each durable `step.do`; no
database connection, transaction, or session state survives Workflow
hibernation. Coordination uses unique constraints, bounded row leases, polling,
and `FOR UPDATE SKIP LOCKED`, not advisory locks or `LISTEN/NOTIFY` through
Hyperdrive.

### 5. Private, content-addressed R2 evidence

Raw evidence is written to a private R2 bucket under a content-addressed key
derived from the SHA-256 of the captured bytes. The write protocol is:

1. Fetch only an allowlisted, bounded metadata/document response.
2. Validate content type and compressed/decompressed byte limits before
   acceptance.
3. Hash the exact bytes and conditionally write the content-addressed object.
4. Commit the PostgreSQL capture reference only after R2 confirms the object.
5. Persist the source locator, safe response metadata, observation time, media
   type, byte count, digest, connector version, and R2 key in PostgreSQL.

An R2 write followed by a database failure creates an unreferenced but harmless
object; an audited orphan reconciler handles it. An R2 object is never treated
as canonical merely because it exists.

The default active retention for a raw metadata/documentation capture is **90
days**. A versioned source-policy class may set a shorter or longer period for
legal, evidence, refresh, or operational reasons. Policy overrides require an
owner, rationale, review date, and audit event. Capture hashes, safe provenance,
and evidence-lineage references are retained longer and cannot be pruned while
canonical evidence, a publication, a review decision, a replay, or a rollback
receipt depends on them.

Security and audit receipts are retained for at least **one year**. The planner
correctness ledger remains online for at least **90 days** and contains no raw
public question or user identifier; later archival/deletion follows the
approved privacy and evidence policy. Physical deletion is a separate audited
action and must pass legal, backup/PITR, lineage, replay, and rollback dependency
checks.

### 6. Exact-revision publication and atomic promotion

USHSO uses the plan's **exact immutable canonical-revision manifest** option for
`W1`, followed by a complete full snapshot build. It does not infer a watermark
from `MAX(sequence)` and does not depend on replaying a possibly non-contiguous
event interval.

For each candidate publication:

1. Complete the required connector, normalization, and review barriers for the
   included scope.
2. Seal and hash an explicit manifest of every included canonical object ID and
   exact revision ID. That manifest is `W1`; work committed outside it belongs
   to a later candidate.
3. Build a complete asset, release/distribution, schema-field, source, join,
   SEO, and coverage snapshot from exactly the `W1` manifest. Incremental work
   may accelerate construction of a candidate, but the reconciled output must
   equal the complete as-of-`W1` build.
4. Persist deterministic document checksums, acknowledgements, component
   generations, projector version, workload/corpus pins, and the selected full
   snapshot strategy in the build receipt.
5. Reject the candidate unless reference, membership, visibility, count,
   checksum, coverage, quality, security, and performance gates pass.
6. In one PostgreSQL transaction, append the immutable publication history and
   change the singleton active-publication pointer to one manifest that pins all
   component generations and `W1`.

An active generation is immutable. A partial or failed build has no operation
that can change the active pointer. Every public response returns the resolved
index generation, canonical as-of time, and coverage snapshot ID.

Two same-input builds must produce identical checksums. A warm-cache pointer
flip test must prove that no response combines an old manifest with new content
or a new manifest with cached old content.

### 7. Rollback and retention

At least the current and previous validated publication manifests and all of
their referenced component generations remain available for immediate pointer
rollback. The complete N−1 support bundle includes the prior Worker version,
binding/resource IDs, additive database compatibility watermark, immutable
assets, publication generations, static export, and verification receipt.

The N−1 bundle is retained from the first database-backed canary until at least
30 days after 100% cutover and two complete launch connector/reconciliation and
publication cycles. During that window, release policy blocks destructive
schema changes and deletion or renaming of an N−1 dependency. A retired public
generation remains queryable for at least 48 hours; shorter cursor lifetimes can
never extend beyond its retention. Exceptional safety revocation returns a
typed generation error rather than silently repinning.

Rollback is failure-specific:

- Bad search, coverage, or SEO state: atomically restore the prior publication
  manifest.
- Bad Worker code: restore the compatible prior Worker version and immutable
  assets.
- PostgreSQL/Hyperdrive unavailability: activate the co-resident immutable
  static emergency Worker artifact.

A Worker rollback never claims to undo PostgreSQL or R2 state. Forward-only,
additive migrations preserve compatibility throughout the support window.

## Consequences

### Positive

- Canonical history, ingestion correctness, identity uncertainty, and
  publication state have one transactional authority.
- Search, HTML, JSON API, WebMCP, SEO, coverage, and planner requests can share
  one immutable semantic pin.
- The dual Hyperdrive bindings make mutable-pointer correctness explicit while
  still permitting cacheable immutable reads.
- Exact revision manifests avoid transaction-order gaps and make every factual
  response traceable to the revisions actually projected.
- Separate Workers and roles make least privilege testable.
- Content addressing makes duplicate evidence capture safe and supports
  checksum reconciliation.
- N−1 plus static rollback covers projection, code, database-connectivity, and
  asset-skew failure classes without destructive database recovery.

### Costs and constraints

- The platform requires paid managed PostgreSQL and Cloudflare capabilities,
  operational ownership, Terraform state, backup drills, and on-call alerts.
- A complete as-of-manifest build may do more work than an event-only replay;
  correctness and deterministic reconciliation take priority. Incremental
  acceleration remains an implementation optimization.
- Two Hyperdrive bindings and separate Worker roles add configuration and
  contract-test surface.
- R2 lifecycle deletion cannot be a blind bucket rule; it must be reconciled
  with PostgreSQL dependencies and source-specific policy.
- Pointer rollback preserves canonical writes made after the old publication;
  operators must understand that it changes the public view, not database
  history.

## Compatibility and rollout

WP3 declares and validates isolated staging infrastructure before any paid or
production apply. WP4 introduces the control plane behind the unchanged static
public adapter. WP6–WP9 populate canonical and immutable publication candidates;
WP14 alone may move reads through shadow, protected canary, gradual promotion,
the full rollback window, and retirement. All migrations remain additive while
N−1 is supported, v1 translation remains available, and the static artifact is
kept deployable until its explicit retirement gate passes.

## Alternatives considered

| Alternative | Disposition | Reason |
|---|---|---|
| Keep JSONL as the production source of truth | Rejected for the target state | Cannot provide transactional ingestion ledgers, append-only review history, durable work recovery, or bounded indexed hydration. Retained only as fixtures and emergency fallback. |
| Self-host PostgreSQL on the Plumbob host | Rejected | Conflicts with production isolation and creates avoidable HA, backup, security, and operational burden. |
| Select another managed PostgreSQL provider immediately | Deferred fallback | Neon meets the chosen architecture on paper. A superseding ADR is required if procurement, residency, SLA, restore, or measured connectivity evidence fails. |
| Put canonical state in R2, KV, D1, or a search vendor | Rejected | Canonical relational history, review state, constraints, and transactional outbox require PostgreSQL semantics; projections remain replaceable. |
| One Worker with every binding | Rejected | Violates least privilege and lets public-path defects reach source credentials or mutation capabilities. |
| One cache-enabled Hyperdrive binding for all operations | Rejected | Unsafe for leases, read-after-write, and the mutable publication pointer. |
| Seal `W1` with a raw maximum sequence and replay `(W0, W1]` | Rejected | Sequence allocation and commit order can differ, creating a missed lower-sequence transaction. |
| Mutate the active generation incrementally | Rejected | Makes mixed public views and partial publication possible. |
| Destructive down-migrations as rollback | Rejected | Endangers shared correctness history and does not roll back Cloudflare-bound resources. |

## Implementation and verification

The following are release requirements, not claims that infrastructure already
exists:

| Control | Required verification | Receipt target |
|---|---|---|
| Provider capability | Procured tier/region, SLA, HA/failover behavior, PITR window, TLS, connection caps, support, and residency review | `verification/wp3/v1.0.0/receipts/provider-capability-review.json` |
| Environment isolation | Terraform state/resource diff and negative cross-environment binding/credential tests | `verification/wp3/v1.0.0/receipts/environment-isolation.json` |
| Least privilege | Grant matrix tests for public, scheduler, harvest, normalize, projector, ops, and maintenance roles | `verification/wp3/v1.0.0/receipts/least-privilege.json` |
| Hyperdrive correctness | Read-after-write, lease, pointer, disconnect/reconnect, and warm-cache pointer-flip tests | `verification/wp3/v1.0.0/receipts/hyperdrive-correctness.json` |
| Capacity | Versioned workload manifest, connection budget, storage/IO forecast, and 30-minute 2× load test | `verification/wp3/v1.0.0/receipts/capacity-and-connection-budget.json` |
| Recovery | Measured provider failover, isolated 30-day-window PITR restore, and emergency-static activation against RPO/RTO | `verification/wp3/v1.0.0/receipts/recovery-drills.json` |
| R2 protocol | Content hash, conditional write, checksum mismatch, orphan, redaction, payload-sentinel, and retention dependency tests | `verification/wp5/v1.0.0/receipts/r2-capture-protocol.json` |
| Publication | Same-input determinism, full/incremental convergence, barrier rejection, atomic promotion, and N−1 pointer rollback | `verification/wp8/v1.0.0/receipts/publication-lifecycle.json` |
| Rollback bundle | Worker/binding/schema/asset/generation/static pins and N−1 compatibility rehearsal | `verification/wp14/v1.0.0/receipts/rollback-bundle.json` |
| Retention | Raw-capture/source overrides, evidence dependencies, one-year security/audit receipts, 90-day planner ledger, and deletion audit | `verification/wp14/v1.0.0/receipts/retention-reconciliation.json` |

The publication receipt must enumerate every required inclusion barrier and
acknowledgement; missing evidence is a failed candidate, never an implicit pass.

## External authorization and unresolved evidence

This ADR settles the architecture choice but does **not** authorize or verify:

- Neon or Cloudflare procurement, account changes, paid usage, DNS, secrets,
  production Terraform apply, or traffic promotion.
- The provider's contracted SLA, support terms, exact 30-day PITR setting,
  region/residency approval, connection caps, or backup recoverability for the
  account that will actually be used.
- The initial 1–4 compute-unit range, RPO, RTO, Worker Placement, or connection
  budget under the versioned USHSO workload.
- Cloudflare Access identity-provider policy and operator membership.
- Live failover, PITR, disconnect/reconnect, static activation, N−1, and rollback
  support-window drills.

Those items remain blocking gates for WP3 acceptance or public
database-backed traffic, as applicable. If procurement or measured evidence
cannot satisfy this decision, a superseding ADR must preserve the product,
truth, publication, privacy, and rollback boundaries above.

## Evidence consulted

- [Neon architecture overview](https://neon.com/docs/introduction/architecture-overview)
- [Neon compute endpoints](https://neon.com/docs/manage/endpoints/)
- [Neon service-level agreement](https://neon.com/sla)
- [Neon and Cloudflare Hyperdrive FAQ](https://neon.com/blog/hyperdrive-neon-faq)
- [Cloudflare Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)
- [Cloudflare Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)
- [Cloudflare Queues batching and retries](https://developers.cloudflare.com/queues/configuration/batching-retries/)
- [Cloudflare R2 limits](https://developers.cloudflare.com/r2/platform/limits/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Terraform function-call timing](https://developer.hashicorp.com/terraform/language/expressions/function-calls)
- [Terraform `timestamp` function](https://developer.hashicorp.com/terraform/language/functions/timestamp)

Provider and platform facts are time-sensitive and must be rechecked at
procurement, infrastructure-plan review, and each production rehearsal.

## 2026-08-30 security addendum: Worker-login creation

This addendum preserves the architecture above but supersedes any implementation
assumption that Worker LOGIN roles can be created through the Neon Console,
CLI, API, or Terraform `neon_role` resource. Neon's current
[PostgreSQL compatibility documentation](https://neon.com/docs/reference/compatibility)
(checked 2026-08-30) states that roles created through those control-plane
paths automatically become members of `neon_superuser`. That membership and
its elevated capabilities, including row-security bypass and replication
capabilities, violate the public/scheduler/harvest/normalize/projector/ops
least-privilege boundary. The briefly proposed six-`neon_role` design is
therefore rejected and must not be applied.

Terraform creates only the isolated Neon project, protected default branch,
direct read-write endpoint, and direct-only bootstrap owner. After additive
database bootstrap creates the NOLOGIN capability roles, an authorized
operator creates the six environment-and-role-scoped LOGIN identities through
the reviewed direct-SQL template. Passwords come from an approved ephemeral
secret channel. The transaction explicitly disables superuser, database/role
creation, BYPASSRLS, and replication attributes; revokes `neon_superuser`; and
grants each login only its matching `ushso_<worker>` capability role.

No Worker credential is bindable to Hyperdrive until a second reviewed catalog
query emits a hashed six-role attestation proving `rolsuper = false`,
`rolbypassrls = false`, `rolreplication = false`, `rolcreatedb = false`,
`rolcreaterole = false`, the exact capability membership, zero
`neon_superuser` membership, and zero unexpected membership. Terraform checks
the attestation template digest, environment, login names, capability mapping,
and negative privilege fields before materializing every Hyperdrive config.
The bootstrap owner remains direct-only, assumes `ushso_maintenance` for
authorized maintenance, and is never a Worker or Hyperdrive credential.

The attestation is not permanent. Its envelope binds the environment, exact
Neon project, branch, and endpoint IDs, exact direct TLS hostname, all six login
names and catalog fields, reviewed template digest, recomputed evidence digest,
verification time, and an expiry no more than fifteen minutes later. The
attestation runner accepts only the environment name: it constructs the
`verify-full` PostgreSQL connection and every identity label from that isolated
root's Neon/Terraform outputs. This follows Neon's current
[endpoint-object model](https://neon.com/docs/manage/endpoints/) (checked
2026-08-30), where the endpoint carries project, branch, endpoint ID, and host.
It does not accept free-form host, project, branch, or endpoint claims.

Terraform independently reconstructs a versioned, fixed-order canonical
representation of every bound field and requires its SHA-256 to equal
`evidence_sha256`. Phase-two apply compares apply-time `timestamp()` with the
receipt interval. This supersedes the earlier plan-time `plantimestamp()`
check: HashiCorp's current function-call and `timestamp` documentation (checked
2026-08-30) describes the value as unknown during planning and fixed when apply
begins, preventing a saved plan from being applied after the receipt expires. A
changed envelope with a reused digest, a wrong endpoint or host, or a late apply
fails closed. Any later apply must rerun the direct catalog query and admit new
evidence after the role graph is re-read.

If an unsafe attribute or membership is ever observed, stop before binding or
remove the affected zero-traffic Hyperdrive config, revoke/rotate the login,
drop and recreate it through SQL when necessary, rerun the catalog attestation,
and bind only after a new PASS receipt. This is a credential/config rollback;
it does not rewrite database history, migrations, publication generations, or
traffic. Any future API-created Worker-role proposal requires new primary-source
evidence and a superseding ADR.
