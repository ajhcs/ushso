# ADR 0005: PostgreSQL search backend and benchmark-based escalation

- **Status:** Accepted
- **Implementation state:** `in_progress`
- **Decision date:** 2026-08-30
- **Decision owners:** Search, Data, Platform, Product
- **Accountable approver role:** Search architecture owner
- **Acceptance basis:** Authoritative plan-execution directive dated 2026-08-30
- **Plan authority:** `docs/RESEARCH_NAVIGATOR_IMPLEMENTATION_PLAN.md` §§5,
  6.4, 13, 18.4, 20 (WP8), 22.5, 23.1, 23.5, and 24
- **Depends on:** ADR 0004; frozen evaluator/cohort contracts from WP2
- **External state:** No managed database/search service or production-like
  benchmark environment has been authorized or provisioned by this decision

## Mapped requirements and tests

| Source | Requirement or test |
|---|---|
| Plan | §§5, 6.4, 13, 18.4, 20 (WP2, WP8, WP14), 22.4, 23.1, 23.5, and 24 |
| Tester requirements | TST-RET-01, TST-TRUST-01, TST-MCP-01, TST-MCP-03 |
| Acceptance tests | `retrieval-quality.v2`, `search-backend.contract`, `query-plan-gate`, `search-determinism`, `search-failure-containment`, `search-performance`, `generation-rollback` |

## Context

The current Worker loads the complete static corpus into memory. That path is a
useful emergency artifact but cannot be the production search architecture for
the persistent Research Navigator. Search must read bounded, generation-pinned
projections, hydrate the exact canonical revisions used to build them, preserve
scoped absence, and never become another source of truth.

The physical backend must not leak into public schemas. Search quality work will
change intent decomposition, fields, weights, synonyms, priors, hard gates,
near-miss handling, and graph expansion. A vendor migration must remain possible
without changing the canonical domain or the HTML, JSON API, WebMCP, coverage,
or planner truth boundary.

## Decision

### 1. PostgreSQL FTS/GIN is the first production backend

The first production `SearchBackend` implementation uses PostgreSQL:

- versioned, immutable search documents tied to a building or published
  generation;
- `tsvector` full-text indexes backed by GIN for lexical retrieval;
- normalized facet and membership tables with appropriate B-tree/GIN indexes;
- explicit asset, release/distribution, schema-field, join-edge, and source
  projections;
- bounded indexed candidate queries followed by deterministic post-ranking; and
- exact canonical-revision hydration from the selected publication manifest.

Search projections set `source_of_truth: false`. They contain canonical IDs and
revisions, input/evidence references, projection schema/projector versions,
visibility state, generation, projection time, and deterministic document
checksums.

The public query path may not load JSONL, scan every canonical record, or filter
an unbounded result set in a Worker. It compiles structured intent, issues a
bounded indexed query for candidate IDs, applies deterministic compatibility and
ranking rules only to those candidates, hydrates exact in-generation canonical
revisions, and returns the resolved generation and coverage scope.

### 2. `SearchBackend` is a vendor-neutral application boundary

Application services depend on a repository-owned `SearchBackend` contract, not
PostgreSQL SQL shapes. The boundary accepts structured intent, projection type,
scope/facets, visibility, an explicit generation pin, deterministic ordering,
and bounded pagination. It returns stable IDs, rank inputs/reasons, near-miss
state, generation, coverage scope, and truncation/cursor metadata needed by the
shared semantic service.

The interface must not expose `tsquery`, GIN details, vendor scores, index names,
or vendor-specific pagination tokens in public contracts. Adapter-specific
diagnostics stay internal. Public ordering, evidence hydration, typed errors,
generation semantics, visibility, and zero-result language are owned above the
physical adapter and tested identically for every implementation.

A `StaticSearchBackend` remains available only for fixtures and the emergency
static rollback artifact. It is not the target production runtime.

### 3. Immutable lifecycle and failure containment

PostgreSQL search follows ADR 0004's exact-revision publication model:

1. Deterministically project exactly the canonical revisions in sealed `W1`
   into a `building` generation.
2. Record one acknowledgement and checksum per eligible projection.
3. Reconcile expected membership, references, visibility, counts, and coverage.
4. Seal and benchmark the candidate without mutating the active generation.
5. Atomically promote one publication manifest only after all gates pass.
6. Retain the prior validated manifest/generations for pointer rollback.

A build, benchmark, or reconciler failure leaves the active generation
unchanged. Two full builds from the same manifest and projector version must
have identical checksums. Incremental catch-up may accelerate a candidate but
must converge to the complete full rebuild.

### 4. Evaluator and corpus freeze precede tuning

No retrieval tuning starts until WP2 publishes the evaluator-v2 metric contract,
gold-equivalence policy, 143/157 bridge matrix, frozen present-source cohort,
development/validation/held-out split, corpus/index pins, and a freeze receipt.

All quality receipts report numerator, denominator, macro/micro designation,
`null_gold`, short-list count, missing/excluded partitions, cohort-manifest hash,
generation/corpus hash, evaluator version, and projector/ranker fingerprint.
Development and validation splits may be used for tuning. The sealed 20-question
held-out split is run only at the final gate; a failed held-out result remains
published and cannot be tuned against.

PostgreSQL promotion requires all retrieval targets from §23.1:

- The exact historical 143-record bridge lane remains at or above 0.50 macro
  must-not-miss recall@10.
- The current-generation full benchmark reaches macro must-not-miss recall@10
  of at least 0.65 before planner beta.
- Full-benchmark macro must-not-miss recall@3 is at least 0.45 and graded
  acceptable-source coverage@3 is at least 0.40, each more than 0.10 absolute
  above its historical 0.331349/0.288462 baseline.
- Frozen present-source essential macro recall is at least 0.70 at rank 3, 0.80
  at rank 5, and 0.90 at rank 10.
- Frozen present-source graded acceptable-source precision@5 is at least 0.70;
  strict exact-gold precision@5 is reported separately and does not regress
  from the frozen pre-tuning bridge.
- Required multi-source role coverage is at least 0.90.
- Prohibited-by-access recommendations, unsupported join upgrades, unresolved
  identities presented as exact, and zero-result absence claims are all zero.
- Every top-five result has a defensible match reason or an explicit near-miss
  label.

Thresholds may not be weakened after seeing held-out output. A reviewed ADR is
required to change metric semantics, cohort membership rules, or release
thresholds.

### 5. Production-like performance and operations gates

Before public cutover, the PostgreSQL adapter is benchmarked at the versioned
maximum planned asset, release/distribution, field, join-edge, and source
cardinalities. The workload manifest includes public HTML, JSON API, WebMCP, and
planner route mix; cold and warm cache ratios; query/facet mixes; concurrent
harvest/normalize/project work; expected growth; and the exact PostgreSQL,
Hyperdrive, Worker, projector, and schema versions.

The gate requires:

- record-search latency p95 ≤ 600 ms and p99 ≤ 1.5 s;
- bundle-plan end-to-end latency p95 ≤ 1.2 s and p99 ≤ 3 s, with the search
  component separately attributed;
- a 30-minute test at 2× the workload-manifest peak within latency, error,
  database connection, Queue-age, and documented resource-headroom objectives;
- production-like query plans that use the intended indexes for the bounded
  high-cardinality paths and do not rely on a full canonical-inventory scan;
- 100% acknowledgement of eligible projections at the promoted `W1`;
- deterministic rebuild checksums and full/incremental convergence;
- failed-candidate containment and previous-generation restoration within 15
  minutes; and
- rebuild duration, index/storage growth, write amplification, autovacuum,
  connection use, and concurrent-projector impact within numeric budgets frozen
  in the workload manifest before the public WP8 build.

The workload manifest supplies the rebuild-duration and resource-headroom
numbers; this ADR does not invent an unmeasured duration. Weakening a ratified
target requires an explicit reliability decision, not a benchmark exception.

### 6. Escalation to a dedicated managed search service

PostgreSQL remains the selected backend unless production-like evidence shows
that it cannot satisfy a gate without weakening semantic correctness, quality,
visibility, determinism, recovery, or the product boundary.

A physical-backend escalation review is mandatory if, after documented bounded
PostgreSQL query/index tuning against the frozen workload and evaluator, any of
these remains true:

- record-search p95/p99 or the 30-minute 2× capacity gate fails;
- required query plans cannot remain bounded at maximum planned cardinality;
- rebuild, index growth, connection, autovacuum, concurrent-ingestion impact, or
  rollback misses its ratified workload budget;
- PostgreSQL resource contention threatens the canonical/control-plane SLOs; or
- the backend prevents the frozen retrieval quality behavior from being served
  within the performance and operational gates.

Escalation is not an automatic vendor purchase. It requires a superseding ADR,
production-like comparison receipt, cost/security/privacy/residency review,
least-privilege and failure analysis, migration/dual-read plan, and explicit
authorization for any paid infrastructure. The candidate adapter must pass the
same `SearchBackend` contract, evaluator, generation pin, parity, visibility,
determinism, failure-injection, rollback, and redaction suites. PostgreSQL and
the prior active generation remain the rollback path until the full cutover and
soak rules are satisfied.

## Consequences

### Positive

- The first production index stays in the same transactional system as
  publication acknowledgements and manifests while remaining explicitly
  non-authoritative.
- PostgreSQL FTS/GIN removes the Worker memory scan without introducing a search
  vendor before scale evidence requires one.
- The adapter boundary lets every UI and machine interface share semantic
  behavior and generation pins.
- Benchmark-triggered escalation prevents both premature vendor lock-in and
  indefinite attachment to an inadequate backend.
- Frozen evaluator semantics and immutable candidate generations make quality
  claims reproducible and keep failed tuning away from public traffic.

### Costs and constraints

- PostgreSQL carries both canonical/control-plane and initial search load, so
  indexes, autovacuum, connections, and projector concurrency require careful
  capacity isolation and measurement.
- Multiple projection types and normalized facets add schema, migration, and
  reconciliation work.
- Full deterministic rebuilds and N−1 retention consume additional database
  storage.
- Vendor-neutral public contracts require internal translation instead of
  exposing convenient backend scores or cursors.
- A later dedicated-service migration will require a dual-build/shadow/canary
  cycle; the abstraction reduces semantic churn but does not remove operational
  work.

## Compatibility and rollout

WP1 first provides a static `SearchBackend` adapter with unchanged v1 behavior.
WP2 freezes evaluator and cohort semantics before tuning. WP8 builds PostgreSQL
projections in shadow, compares them against the pinned static lane, and promotes
only immutable generations that pass quality, determinism, visibility, and load
gates. WP14 retains v1 translation, N−1 PostgreSQL generations, and the static
emergency adapter through the complete rollback window. A dedicated search
service, if later justified, repeats the same dual-build, parity, canary, and
rollback sequence behind the unchanged port.

## Alternatives considered

| Alternative | Disposition | Reason |
|---|---|---|
| Adopt a dedicated managed search service before benchmarking | Rejected for the first production implementation | Adds cost, security surface, replication lag, and operations without evidence that PostgreSQL misses a target. |
| Continue the in-Worker full-corpus/static index | Rejected for target production | Violates bounded indexed retrieval, persistent generation lifecycle, and planned scale. Retained only for tests and emergency fallback. |
| Query canonical tables directly and filter in application code | Rejected | Risks unbounded scans, couples ranking to truth tables, and cannot provide immutable deterministic projections. |
| Make backend relevance scores part of public contracts | Rejected | Locks public semantics to a vendor and makes parity or migration unreliable. |
| Mutate one live PostgreSQL index in place | Rejected | Allows mixed canonical revisions, partial publication, and irreproducible rollback. |
| Add vector/semantic retrieval as the initial physical dependency | Deferred | Not required by the authoritative plan or current evidence. Any later candidate must remain controlled, deterministic at the published boundary, benchmarked, and covered by a superseding decision. |

## Implementation and verification

| Control | Required verification | Receipt target |
|---|---|---|
| Interface neutrality | Contract suite runs the same semantics against PostgreSQL and static fixture adapters; generated API schemas contain no PostgreSQL details | `verification/wp8/v1.0.0/receipts/search-backend-contract.json` |
| Tuning freeze | Evaluator v2, 143/157 bridge, equivalence rules, present-source cohort, split hashes, and fingerprints validated before tuning | `verification/wp2/v1.0.0/receipts/retrieval-freeze.json` |
| Retrieval quality | Full, present-source, bridge, forbidden-result, join, identity, scoped-zero, and near-miss gates with complete denominators | `verification/wp8/v1.0.0/receipts/retrieval-quality.json` |
| Indexed boundedness | Production-cardinality `EXPLAIN (ANALYZE, BUFFERS)` fixtures and request counters prove intended indexes and no full canonical scan on public paths | `verification/wp8/v1.0.0/receipts/query-plan-gate.json` |
| Determinism | Same `W1`/projector builds have identical documents/checksums; incremental and full builds converge | `verification/wp8/v1.0.0/receipts/search-determinism.json` |
| Failure containment | Injected projection, reconciliation, benchmark, and promotion failures leave active pointer/content unchanged | `verification/wp8/v1.0.0/receipts/search-failure-containment.json` |
| Performance/capacity | Versioned cardinalities and route mix; cold/warm 30-minute 2× test; latency, error, connections, Queue age, storage, IO, and headroom | `verification/wp8/v1.0.0/receipts/search-performance.json` |
| Generation rollback | N−1 queryability, pointer rollback within 15 minutes, retired-generation pins, and static fallback | `verification/wp14/v1.0.0/receipts/search-rollback.json` |
| Shared truth boundary | HTML, search API, JSON API, WebMCP, coverage, and planner resolve identical publication/canonical/evidence pins | `verification/wp12/v1.0.0/receipts/search-semantic-parity.json` |
| Tester feedback | TST-RET-01 thresholds and named evaluator/cohort receipt are verified | `verification/wp8/v1.0.0/receipts/TST-RET-01.json` |

No receipt may claim a pass from a development-sized dataset when the gate calls
for production-like cardinality or concurrency. Plans and `EXPLAIN` output must
be stored in a redacted, versioned form that identifies schema, statistics,
database, Hyperdrive, Worker, workload, and code revisions.

## External authorization and unresolved evidence

The architecture and escalation rule are settled. These facts remain unverified
until WP3/WP8 infrastructure and authorization exist:

- PostgreSQL FTS/GIN performance at the maximum planned production cardinality,
  route mix, concurrent pipeline load, and 2× peak.
- The final connection, storage/IO, autovacuum, rebuild-duration, and resource-
  headroom budgets.
- Query latency through the procured Neon/Hyperdrive topology and chosen Worker
  Placement.
- Live N−1 rollback and emergency-static activation timing.
- Whether a dedicated managed search service is needed. No such purchase or
  migration is authorized by this ADR.

Failure of any measured gate blocks public promotion. It does not permit a
silent threshold reduction, unbounded Worker fallback, or semantic divergence
between the UI and machine interfaces.
