# USHSO research navigator and catalog platform implementation plan

**Status:** Approved for implementation; the WP0 tester-source copies, hashes,
and paragraph reconciliation are verified in
[`docs/feedback/v1.0.0/`](feedback/v1.0.0/README.md)

**Date:** 2026-08-30

**Scope:** Product evolution, persistent catalog infrastructure, connector harvesting, search, research-plan generation, public coverage accounting, and production migration

**Production baseline:** Corpus v1.1.0, 157 records, 14 join routes

## 1. Executive decision

USHSO will evolve from a static searchable directory into an evidence-bound
research navigator. Its primary value will be the ability to translate a health
systems research question into the smallest defensible bundle of authoritative
sources, explain the role and limitations of each source, identify exact releases
and access routes, describe join and transformation requirements, and emit a
machine-readable research plan.

USHSO will not become an analytics application. It will not acquire source data
on a user's behalf, host healthcare data payloads, execute joins, calculate
measures, rank hospitals, or display analytical results.

The product promise is:

> USHSO tells you what to use, why it fits, how the sources connect, and exactly
> how to obtain them. It does not use the data for you.

The platform decision is:

1. Replace the static JSONL production data path with connector-based,
   asynchronous metadata harvesting.
2. Store source-native observations, canonical metadata, identity candidates,
   access observations, and operational state in managed PostgreSQL.
3. Store immutable raw metadata and documentation captures in private R2.
4. Use Cloudflare Cron Triggers, Workflows, Queues, and dead-letter queues for
   scheduling, durable orchestration, fan-out, retries, and recovery.
5. Publish normalized, versioned search projections into a production index.
6. Keep the public Worker read-only and isolated from connector secrets and
   source-network activity.
7. Add a strict research-plan contract and deterministic bundle planner above
   the search and canonical metadata layers.
8. Publish public coverage metrics with explicit units, denominators, scope, and
   unknown states.
9. Expose bounded, composable research-inspection capabilities through the JSON
   API and WebMCP over the same canonical services, with `llms.txt` and human
   documentation serving only as discovery/bootstrap material.

## 2. Why this program is necessary

The current system has excellent safety and evidence semantics, but its runtime
and product unit are still MVP-shaped:

- The Worker loads records, search documents, join routes, vocabulary, corpus
  metadata, and a verification receipt from static assets into memory
  ([worker/index.mjs](../worker/index.mjs)).
- Retrieval scans a frozen corpus and returns independently ranked records.
  Complementary identity or crosswalk sources cannot be added simply because
  they complete a research bundle.
- Search projections omit much of the field-level, access, freshness, release,
  and documentation material needed for research planning.
- Use Cards and Access Recipes model valuable researcher guidance, but are not
  loaded into the production discovery path.
- The current readiness summary mixes jurisdictions, routes, and records rather
  than reporting stage-specific coverage with explicit denominators.
- The catalog cannot scale past the current browser-side pagination and facet
  model without incomplete counts.
- Stable dataset pages are client-rendered and are not fully discoverable by
  conventional crawlers.

The production corpus also needs much clearer positioning. Corpus v1.1.0 contains:

| Slice | Records |
|---|---:|
| Harvard Dataverse | 52 |
| DataCite | 50 |
| Pennsylvania catalog | 22 |
| Curated authoritative registry | 15 |
| Federal baseline sources with live-metadata validation | 14 |
| Canonical base | 4 |
| **Total** | **157** |

Only one state overlay is currently published. Thirty-four jurisdictions are
effectively navigation-only, eight are bounded evidence gaps, and several others
are candidate or partial states. Until the connector program changes this, the
public product must say **14-source, live-metadata-validated federal baseline plus
selected state coverage**, not imply that recognizing 51 jurisdictions means
comprehensively indexing them.

Retrieval quality is also below the trust threshold required for plan-first
recommendations. The frozen benchmark currently reports must-not-miss recall of
0.50 at rank 10 and 0.548 at rank 20, calculated as macro-averaged
question-level recall, and approximately 0.46/0.53 acceptable-source coverage at
ranks 10/20. Improving the first three to five choices is a core program goal,
not a polish task.

Those scores came from the immutable **143-record** retrieval corpus v1.0.1,
not the 157-record production corpus. Pin the historical bridge lane to corpus
manifest SHA-256
`5622272ded52b0cbf039da47114142f8cb35ba634e8a6bbb9ee55b0ecd70511c`
and content fingerprint
`0e676ada3d601275083615a3f7804781eef1c183cb1b7efcf7ec8044fce33b3d`
([build receipt](../packages/retrieval/receipts/build-receipt.json)). Before
retrieval tuning, run evaluator v2 against the pinned 157-record migration seed
and publish a bridge matrix that separates corpus changes from algorithm changes.
Only scores sharing corpus, evaluator, and cohort pins are directly comparable.

## 3. Product boundary

### 3.1 Supported product jobs

USHSO will expose three distinct jobs:

| Mode | User intent | Output |
|---|---|---|
| Browse | “Show me what is indexed.” | Sources, assets, releases, facets, families, and coverage scope |
| Discover | “Which sources may match this question?” | Ranked, evidence-backed candidates and explicit near misses |
| Plan | “Which sources and steps do I need?” | A minimal source bundle, compatibility assessment, acquisition plan, and machine-readable handoff |

Browse must not infer a research objective. Discover must not imply that a ranked
list is a coherent research design. Plan must not execute the analysis.

### 3.2 In scope

- Enumerating explicitly configured authoritative catalogs and inventories.
- Preserving source-native metadata and evidence.
- Normalizing sources, assets, releases, distributions, documentation, schemas,
  fields, access routes, and observations.
- Conservative duplicate detection and family/version grouping.
- Typed identity and join graphs with unresolved conflicts.
- Researcher-oriented fitness, limitations, and access guidance.
- Exact release and distribution selection.
- Coverage, grain, geography, time, and access compatibility checks.
- Join, crosswalk, aggregation, temporal-alignment, and measure-harmonization
  instructions.
- Ordered acquisition instructions with authorization gates and stop conditions.
- Human-readable and machine-readable plans generated from one canonical object.
- Public processing and coverage accounting.
- Crawlable public metadata pages and structured metadata.

### 3.3 Explicit non-goals

- Downloading or storing underlying healthcare datasets.
- Inspecting or profiling source data rows as part of catalog ingestion.
- Submitting registrations, applications, DUAs, payments, or login forms.
- Joining, aggregating, harmonizing, or calculating source data.
- Computing market share, benchmarks, rankings, trends, or forecasts.
- User uploads, notebooks, SQL workspaces, dashboards, or chart builders.
- A magical universal hospital or health-system identity table.
- Claiming exhaustive coverage of all public U.S. healthcare data.
- Treating a public catalog listing as proof of public data access.

## 4. Program success conditions

The program is successful when all of the following are true:

1. The public Worker no longer loads every catalog record from static JSONL.
2. Every public record is backed by canonical metadata and evidence in the
   persistent registry.
3. Connector refreshes are incremental, idempotent, observable, recoverable,
   and isolated from the query path.
4. Uncertain duplicate or identity matches remain separate and visible for review.
5. Search operates over normalized, versioned projections and returns bounded
   candidates.
6. A multi-source question can intentionally retrieve complementary role,
   identity, and crosswalk sources.
7. The first three to five search choices are defensible research choices rather
   than lexical near misses.
8. A research plan can identify exact source roles, releases, common coverage,
   join constraints, acquisition steps, and unresolved gaps without returning
   data rows or computed values.
9. Public coverage reporting states exactly what was discovered, ingested,
   normalized, schema-indexed, checked, stale, failed, excluded, or unknown—and
   against which denominator.
10. Every stable dataset page is crawlable without client JavaScript and exposes
    canonical, schema.org/DCAT-style metadata.
11. The current static corpus remains a tested rollback artifact until the new
    platform completes its soak period.
12. Browser-native agents can use a small, composable WebMCP toolkit backed by
    the same canonical services and critical-field semantics as the JSON API
    and human interface.

## 5. Non-negotiable invariants

These rules apply across database constraints, contracts, code, tests, and UI:

1. **Metadata only.** Raw catalog metadata, documentation, schema descriptions,
   and access observations may be captured; underlying healthcare dataset rows
   may not.
2. **Evidence before claims.** Every public assertion, relationship, access state,
   plan contribution, and operation references evidence and observation time.
3. **Visibility is not access.** Catalog visibility, payload access, requirements,
   authorization, and infrastructure status remain separate.
4. **Unknown remains unknown.** Missing, unresolved, failed, blocked, stale, and
   excluded states never collapse into `not_found`.
5. **No silent identity merge.** Similar titles, organizations, or URLs can create
   candidates, never automatic identity equality.
6. **Identity, family, and join compatibility are distinct.** One never implies
   another.
7. **Append-only truth history.** Evidence, assertions, relationships, access
   observations, and review decisions are superseded, not destructively rewritten.
8. **Immutable contract versions.** Existing v1 contracts and fixtures remain
   frozen; production-capable successors receive new versions.
9. **Deterministic publication.** The same canonical snapshot and projector
   version produce identical search documents and checksums.
10. **Deterministic plans.** The same normalized request, registry/index pin, and
    planner fingerprint produce the same canonical plan payload and digest.
    Transport fields such as request IDs, trace IDs, and response timestamps are
    excluded from canonicalization.
11. **Scoped absence.** Zero results mean no eligible result in the named index
    generation and scope, never that no source exists.
12. **No request-time harvesting.** The public request path never contacts source
    catalogs.
13. **No raw query persistence by default.** Operational telemetry excludes user
    question text and user identifiers.
14. **Last-known-good publication.** Source, parser, normalization, or index
    failures do not replace a valid public generation with a partial one.

## 6. Target architecture

### 6.1 Logical planes

| Plane | Responsibility | Authoritative for |
|---|---|---|
| Source registry | Configured catalogs, endpoints, scopes, policies, credentials references | Observable source universe and refresh policy |
| Ingestion control | Runs, jobs, cursors, attempts, retries, failures, checkpoints | What the pipeline did |
| Raw evidence | Immutable bounded source metadata and documentation captures | What was observed |
| Canonical registry | Typed objects, assertions, relationships, schemas, access observations | Current and historical metadata truth |
| Identity and review | Candidates, families, clusters, review decisions | Resolution state and uncertainty |
| Publication | Projection generations, manifests, receipts, active pointer | Which coherent view is public |
| Search | Asset, release/distribution, field, source, and join projections | Replaceable retrieval views only |
| Coverage | Stage facts, metric definitions, membership manifests, snapshots | Public numerator/denominator accounting |
| Planner | Intent, roles, candidate bundles, compatibility, acquisition DAG | Derived research guidance only |
| Public query | Browse, discover, detail, plan, coverage, crawler pages | Read-only delivery |

### 6.2 Cloudflare and storage decisions

The default implementation target is:

- **PostgreSQL:** canonical registry, ingestion ledger, identity/review state,
  outbox, coverage facts, and the first production search index.
- **Hyperdrive:** PostgreSQL connectivity from Workers.
- **R2:** private, content-addressed raw metadata/documentation captures.
- **Cron Trigger:** one frequent dispatcher schedule, not one cron expression per
  source.
- **Workflows:** one durable orchestration instance per source run attempt.
- **Queues:** page, normalization, schema, access-check, and projection fan-out.
- **Dead-letter queues:** transport isolation, always drained into a durable
  PostgreSQL incident ledger.
- **Workers:** separate public, scheduler, harvesting, normalization, projection,
  and operations roles.

Cloudflare Workflows are appropriate because they provide durable, retriable,
multi-step orchestration. Queue delivery is at least once, so correctness must
come from database idempotency rather than delivery assumptions. See the current
Cloudflare documentation for [Workflows](https://developers.cloudflare.com/workflows/),
[Workflow rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/),
[Queue delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/),
[dead-letter queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/),
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
[Hyperdrive](https://developers.cloudflare.com/hyperdrive/), and
[R2](https://developers.cloudflare.com/r2/).

### 6.3 Worker separation and least privilege

| Worker | Permissions |
|---|---|
| `ushso-public` | Read published index/canonical views; static assets; no connector credentials; no R2 writes; no queues |
| `ushso-scheduler` | Read source schedules; create runs/outbox events; start Workflows |
| `ushso-harvest` | Fetch allowlisted authoritative endpoints; write R2; write ingestion state |
| `ushso-normalize` | Read captures; write canonical proposals/revisions; enqueue enrichment |
| `ushso-projector` | Read accepted canonical state; write search generations and coverage snapshots |
| `ushso-ops` | Access-protected pause, review, replay, promotion, and rollback operations |

Use a cache-disabled Hyperdrive binding for control-plane writes,
read-after-write operations, leases, and the active-publication pointer. A
separate read binding may cache immutable generation reads. Do not rely on
PostgreSQL advisory locks or `LISTEN/NOTIFY` through Hyperdrive; use unique
constraints, short row leases, polling, and `FOR UPDATE SKIP LOCKED`.

Each public request resolves the active publication manifest once through the
cache-disabled binding, then passes its explicit immutable generation,
canonical-revision, SEO, and coverage IDs into every cacheable query. Cached
`published_*` views must not internally dereference the mutable active pointer,
and cache keys include all publication IDs. A warm-cache pointer-flip test must
prove that no response combines the old manifest with newly active content or
the new manifest with cached old content.

At implementation time, budget connections and statement duration against the
then-current Hyperdrive and PostgreSQL limits. Use short, chunked transactions
and a fresh database client inside each Workflow `step.do`; do not retain a
connection across Workflow hibernation. Run schema migrations, restore work,
large maintenance, and controlled backfills through a separately secured direct
database path rather than the public Worker. Provider selection must document
high availability, failover, PITR retention, connection caps, TLS/private
connectivity, Worker Placement strategy, RPO, RTO, and a measured restore drill.

### 6.4 Publication model

Canonical state may change continuously, but public search must always refer to
one coherent generation:

1. Record the prior published watermark `W0`. Establish `W1` as a sealed,
   contiguous prefix of **committed** canonical/outbox work, or as an exact
   immutable manifest of included canonical revisions. Never derive `W1` from a
   raw `MAX(sequence)`: a lower sequence allocated by an in-flight transaction
   could otherwise commit after the cutoff and be skipped.
2. Choose one explicit build path: either clone the `W0` generation and replay
   every committed event in `(W0, W1]`, or build a complete as-of-`W1` snapshot
   and perform no replay. Persist the chosen strategy in the build receipt.
3. Reconcile the sealed prefix/revision manifest, then seal the candidate at
   `W1`; events committed outside that fence belong to a later generation.
4. Validate references, counts, visibility, checksums, benchmark behavior, and
   coverage association against the bounded `W1` state.
5. Atomically switch one publication manifest—containing every search/SEO index,
   coverage snapshot, and `W1`—to active.
6. Retain at least the previous validated manifest/generations for immediate
   rollback.

Every API result includes the index generation, canonical as-of time, and
coverage snapshot ID. Search projections remain explicitly non-authoritative.

## 7. Canonical domain model

### 7.1 Primary objects

| Object | Definition |
|---|---|
| `Organization` | Publisher, regulator, maintainer, repository operator, or other responsible body |
| `Source` | A configured, harvestable catalog, portal, repository, regulator inventory, or registry |
| `Asset` | An enduring logical dataset, product, report series, registry, or collection |
| `Release` | An immutable edition, vintage, snapshot, filing period, or API version of an asset |
| `Distribution` | A downloadable representation, API surface, query service, or other retrievable manifestation |
| `Documentation` | Codebook, methodology, schema, data dictionary, license, landing page, or access guide |
| `SchemaSnapshot` | An immutable schema observed for a specific release/distribution context |
| `SchemaField` | A source-native field belonging to one exact schema snapshot |
| `AccessRoute` | A procedure or endpoint through which a distribution may be obtained |
| `AccessObservation` | Append-only evidence of catalog visibility, access status, requirements, and infrastructure outcome |

`Source` is not synonymous with `Organization`. CMS may be an organization while
Data.CMS.gov and Provider Data Catalog are separate sources. A stable URL is not
a release identity. A field name is not globally meaningful without its schema,
release, distribution, and identifier namespace.

### 7.2 Common object envelope

Every truth-bearing object or revision should carry:

- Immutable opaque ID.
- Object type and schema version.
- Source-native identifier(s), namespace, source, and case behavior.
- Lifecycle state.
- Current revision ID and canonical content hash.
- First-seen, observed-at, recorded-at, and superseded-at timestamps.
- Source release/modified time when present.
- Data coverage interval(s), including fiscal/calendar semantics.
- Evidence and assertion references.
- Import/connector run and normalizer lineage.

Do not derive IDs from mutable titles or URLs. Preserve legacy public identifiers
as permanent aliases.

### 7.3 Four clocks

Keep these clocks distinct:

1. **Data coverage:** the period described by the data.
2. **Publisher time:** release or source modification time.
3. **Observation time:** when USHSO observed the source.
4. **System time:** when USHSO recorded or superseded the claim.

Freshness, historical validity, and as-of queries depend on this separation.

### 7.4 Database namespaces

Use one PostgreSQL database initially, separated by schemas and roles:

- `registry`: sources, endpoints, scopes, policies, credentials references,
  refresh schedules, checkpoints.
- `ingest`: harvest runs, page jobs, attempts, captures, discoveries,
  normalization runs, stage counters.
- `catalog`: objects, revisions, identifiers, evidence, assertions,
  relationships, access routes/observations, releases, distributions,
  documentation, schema snapshots, fields.
- `identity`: candidates, features, clusters, families, memberships, decisions,
  aliases, join routes, transform steps.
- `search`: projected documents, facet tables, FTS vectors, generation manifests,
  acknowledgements, publication pointer.
- `ops`: outbox, processed events, durable dead letters, audit log, heartbeats,
  coverage facts and snapshots.

### 7.5 Migration order

Create forward-only migrations in this sequence:

1. `0001_registry_sources_endpoints_scopes`
2. `0002_ingest_runs_jobs_captures`
3. `0003_ops_outbox_processed_events_dead_letters`
4. `0004_catalog_objects_identifiers_evidence`
5. `0005_assets_releases_distributions_documentation`
6. `0006_schema_snapshots_fields_access`
7. `0007_assertions_relationships_temporal_history`
8. `0008_identity_candidates_families_reviews`
9. `0009_join_routes_transform_steps_applicability`
10. `0010_projection_generations_manifests`
11. `0011_coverage_facts_definitions_snapshots`

Operational rollback switches the public read path or generation pointer. It
must not depend on destructive down-migrations.

## 8. Contracts and versioning

### 8.1 Contract packages

Create production-capable successor packages rather than changing v1 fixtures:

- `contracts/core/v2.0.0`
- `contracts/ingestion/v1.0.0`
- `contracts/identity/v1.0.0`
- `contracts/publication/v1.0.0`
- `contracts/coverage/v1.0.0`
- `contracts/research-plan/v1.0.0`
- `contracts/machine-toolkit/v1.0.0`

The first milestone may use `v0.1.0` development contracts, but public promotion
requires immutable `v1.0.0` packages, manifests, fixtures, semantic validators,
and validation receipts.

### 8.2 Required machine contracts

- Connector descriptor and source scope.
- Native metadata envelope and raw capture reference.
- Harvest plan, run, page, checkpoint, and attempt.
- Typed failure and access observation.
- Canonical objects and revisions.
- Identity candidate and review decision.
- Family membership and resolution state.
- Join route and transformation step.
- Use Card, Access Plan, and technical Retrieval Recipe, with separate policy,
  procedure, and execution-state fields.
- Projection document and generation manifest.
- Coverage definition, fact, metric, and snapshot.
- Research-plan request, response, asset contribution, operation, acquisition
  DAG, evidence reference, and truth boundary.
- Machine-tool manifest, per-tool inputs/outputs, common response envelope,
  pagination cursor, error, and capability declaration.

JSON Schema alone is insufficient. Add semantic validators for temporal
intersection, supersession cycles, evidence resolution, access overclaims,
identity states, operation graph acyclicity, denominator units, and plan safety.

## 9. Connector platform

### 9.1 Connector SDK boundary

Connectors enumerate and parse source-native metadata. They do not write
canonical tables or search projections directly.

The conceptual interface is:

```ts
interface CatalogConnector {
  descriptor(): ConnectorDescriptor
  plan(checkpoint: Checkpoint | null): Promise<HarvestPlan>
  enumerate(plan: HarvestPlan, resume?: RunCursor): AsyncIterable<NativeMetadataPage>
  fetchDetail?(ref: NativeRef, validators?: HttpValidators): Promise<MetadataFetch>
  normalize(observation: RawMetadataObservation): NormalizeResult
  schemaTargets(result: NormalizeResult): SchemaTarget[]
  probe(target: ProbeTarget, validators?: HttpValidators): Promise<ProbeResult>
  proposeCheckpoint(completedRun: HarvestRun): Checkpoint
}
```

The shared runner owns persistence, R2 capture, retries, outbox writes,
checkpoint commits, and canonical promotion. Normalization functions must be
pure and deterministic for the same input and normalizer version.

### 9.2 Connector descriptor

Every configured source declares:

- Connector and configuration version.
- Authority type and responsible organization.
- Allowed hosts and redirect policy.
- Allowed route templates labeled
  `catalog_metadata|documentation|schema|access_probe`; methods, parameters,
  expected content classes, and explicit forbidden payload/query routes.
- Exact scope and denominator definition.
- Native identifier namespace.
- Cursor/checkpoint strategy.
- Full-enumeration cadence.
- Refresh interval, jitter, and staleness policy.
- Maximum pages, bytes, duration, and decompressed size.
- Per-origin concurrency and rate limits.
- Authentication secret reference, never the secret itself.
- Supported object roles and schema/documentation capabilities.
- Exclusion policy and policy version.
- Legal/terms review state.

Keyword searches may generate leads, but never serve as completeness
denominators.

Every outbound request is compiled from the labeled route manifest and recorded
with purpose, normalized template ID, final host/path class, byte counts, and
capture classification. The egress client rejects any unmanifested route or
`source_data_payload` purpose before sending it. Source-specific response
classifiers quarantine unexpected row-oriented payloads, query results, archive
members, or form/login content; catalog item records, data dictionaries, and
schema metadata remain allowed evidence classes. Fixtures include sentinel
payload endpoints and misleading content types to prove the boundary fails
closed.

### 9.3 Harvest Workflow

Use one Workflow instance per source run attempt:

1. Scheduler transaction creates the run and a `workflow_start_requested`
   outbox event.
2. The dispatcher creates or reconciles deterministic Workflow instance
   `harvest-{run_id}-{attempt}` and records the attempt mapping. Unknown create
   outcomes use create/get reconciliation, and same-attempt platform restart
   resumes that instance rather than allocating a second one. A unique
   constraint permits at most one active attempt per run.
3. Validate the source and configuration revision.
4. Create or confirm the initial page job through the outbox.
5. Enumerate pages through the harvest queue.
6. Persist and hash raw metadata captures.
7. Seal the discovered population only after complete enumeration.
8. In one transaction, compare-and-swap the prior checkpoint, commit the sealed
   membership, and insert every required normalization job/outbox event. The
   checkpoint cannot advance without durable downstream work.
9. Wait for required normalization and publication barriers using durable
   sleeps/events, explicit deadlines, and the terminal outcome policy below.
10. Calculate run coverage facts.
11. Request projection into the next building generation. Incremental events may
    reduce rebuild work, but they never mutate the active generation in place.
12. Mark the run `succeeded`, `succeeded_with_optional_degradation`,
    `partial_unpublished`, `failed`, or `cancelled`.

Workflows coordinate; Queues own page/record processing retries. Avoid nested
retry multiplication. Step names are stable across deploys for a given Workflow
version, step state comes only from persisted returns/ledgers, and every external
call is isolated in an appropriately retryable step. An operator replay after a
terminal outcome creates a new logical run with `replay_of_run_id`, never another
attempt on the terminal run. Consumers fence stale queue work by run ID, attempt,
lease epoch, and active-run state before applying any effect.

Configure the maximum supported Workflow instance retention and persist
`workflow_instance_id`, Workflow version, terminal state, creation time, and
`workflow_retention_expires_at` in PostgreSQL. The dispatcher checks DB run state
before every create/get operation. Unknown-create reconciliation may resume the
same deterministic instance only inside that retention window; it may not
recreate the same run attempt after history expires. A nonterminal DB run that
outlives instance retention is failed through an audited reconciliation and can
continue only as a new `replay_of_run_id` run. Test unknown create/get outcomes
immediately before, at, and after the configured retention boundary against the
current [Workers API behavior](https://developers.cloudflare.com/workflows/build/workers-api/).

### 9.4 State machines

- Run happy path: `scheduled → starting → enumerating → enumerated → normalizing → projecting → published → succeeded|succeeded_with_optional_degradation`
- Run terminal path: any active state may enter `failed|cancelled` through an
  audited transition; an incomplete but accounted run enters
  `partial_unpublished`. Terminal runs are immutable; recovery creates a new run
  with `replay_of_run_id` and attempt lineage pointing to the terminal run.
- Job: `pending → leased → succeeded|retry_wait|quarantined|dead`;
  `retry_wait → pending` when due, and an expired lease returns safely to
  `pending`.
- Outbox: `pending → leased → published|retry_wait|dead`; retry and lease-expiry
  transitions mirror jobs.
- Index: `building → validated → published → retired`; `rejected` branches from
  `building` or `validated`. Serving activation is recorded only in the atomic
  publication-manifest pointer and append-only publication history. A retired
  immutable generation remains pointer-rollback eligible until its declared
  retention deadline; physical expiry is a separate audited action.
- Source: `active → pause_requested → draining → paused`, plus
  `auth_blocked|schema_drift|retired`; pause is not effective until in-flight work
  is drained or safely re-ledgered. `paused → active` requires an audited resume
  after drain reconciliation. `auth_blocked|schema_drift → pause_requested|active`
  requires a recorded remediation and new configuration/connector version;
  `retired` is terminal.

`partial_unpublished` is a run outcome, never a partial publication. Required
publication barriers are: complete sealed enumeration for every included scope;
membership/checkpoint commit; a terminal normalized/excluded decision for every
observed revision; a sealed `W1`; acknowledgement of every inclusion-eligible
projection; resolved references/checksums/visibility; and exact search/SEO/
coverage reconciliation. A page/enumeration DLQ, unsealed membership, unresolved
required normalization, missing eligible projection, broken reference, or
coverage mismatch blocks `published` and leaves the last-known-good manifest
active.

`succeeded_with_optional_degradation` is allowed only for a failure class marked
optional **before the run** by a versioned policy: non-required schema-field
enrichment, supplementary documentation enrichment, a scheduled access re-probe
whose prior observation can honestly become stale/unknown, or candidate-only
identity/family scoring that cannot change accepted truth. It may not cover page
enumeration, canonical normalization, visibility, required access evidence,
projection, or coverage accounting. The publication receipt enumerates every
degraded optional stage, affected IDs, inherited/unknown state, and authorizing
policy version.

Invalid transitions fail closed and are covered by contract tests.

### 9.5 Queue topology

- `harvest-page` → `harvest-page-dlq`
- `normalize-record` → `normalize-record-dlq`
- `enrich-schema` → `enrich-schema-dlq`
- `access-check` → `access-check-dlq`
- `project-index` → `project-index-dlq`

Queue messages contain IDs, cursor references, R2 keys, schema versions, and
trace IDs—not source response bodies.

Every DLQ has a sink consumer that persists the durable failure, attempts,
source/run identifiers, and replay lineage in PostgreSQL. The sink acknowledges
the DLQ message only after the incident transaction commits. PostgreSQL remains
the replay source if Queue messages expire. Queue consumers acknowledge or retry
each message only after its database transaction commits.

Use a shared per-origin rate limiter and circuit breaker across connectors.
Queue consumer concurrency is not a substitute for origin-specific pacing.

### 9.6 Transactional outbox and idempotency

Canonical changes and downstream outbox events commit in the same transaction.
Network, R2, Queue, and Workflow calls never occur inside a database transaction.

Each consumer transaction first inserts `(consumer_name, event_id)` into a unique
processed-event table, then writes the business effect and every downstream
outbox event in that **same transaction**. A duplicate guard insert means the
complete effect already committed and the message can be acknowledged. Queue
acknowledgement occurs only after commit; a crash after commit and before ack is a
safe duplicate delivery.

Recommended unique keys:

- Run: endpoint + scheduled slot + mode + registry revision.
- Page: run + cursor hash.
- Capture: SHA-256 of bounded raw bytes.
- Discovery: source + native namespace + native ID + source revision.
- Canonical revision: canonical JSON hash + normalizer version.
- Access check: distribution + check recipe + scheduled slot.
- Projection: canonical ID + canonical revision + projection version.
- Consumer effect: consumer name + event ID.

### 9.7 Checkpoints and deletion

- Keep per-run cursors separate from the committed connector checkpoint.
- Advance the global checkpoint only after complete enumeration is sealed.
- Prefer `(modified_at, native_id)` plus an overlap window when supported.
- Treat opaque cursors as run-local unless the source explicitly guarantees
  durable continuation.
- Run periodic full membership sweeps even when incremental feeds exist.
- One missing observation never withdraws an asset.
- Require an explicit tombstone, an admissible 404/410 from an exact
  item/distribution target, or the configured number of consecutive complete
  misses before lifecycle change.
- A 404/410 from a catalog root, list page, API collection, pagination cursor, or
  checkpoint endpoint is a terminal configuration/enumeration failure: do not
  seal membership, advance the checkpoint, or infer withdrawal.
- An exact distribution 404/410 may update that distribution/access observation;
  it does not withdraw the parent asset unless the source-specific evidence
  policy independently supports that conclusion.
- Fixtures cover root, list, cursor, exact item, exact distribution, and
  documentation target classes separately.

### 9.8 R2 capture protocol

For each successful metadata or documentation fetch:

1. Validate host, redirects, type, size, decompression, and timeout.
2. Compute a raw byte hash and semantic hash.
3. Write to a content-addressed R2 key with checksum/conditional semantics.
4. Commit the capture reference only after R2 confirms the object.
5. Store the redacted source locator/final URL, an allowlist of safe response
   headers, observation time, content type, size, hash, and R2 key in PostgreSQL.
   Never persist cookies, authorization material, or signed query parameters.

A crash after R2 write and before DB commit creates an unreferenced but harmless
object. Redelivery links it; delayed garbage collection may remove old orphans.

### 9.9 Typed failures

At minimum, distinguish:

- `rate_limited`
- `upstream_5xx`
- `timeout`
- `dns_failure`
- `tls_failure`
- `catalog_auth_misconfigured`
- `expected_access_restriction`
- `not_found`
- `gone`
- `redirect_unapproved`
- `schema_drift`
- `parse_failure`
- `unexpected_content_type`
- `response_too_large`
- `policy_blocked`
- `canonical_invariant_failure`
- `internal_failure`

A 401/403 may be a valid restricted-access observation for an asset but a
configuration failure for a supposedly public catalog endpoint. An HTTP 200
login or bot-challenge page is not successful access.

### 9.10 Retry, quarantine, and circuit-breaker policy

Queue retry behavior is contract data, not a Cloudflare default. Each message
records `attempt`, `first_attempt_at`, `next_eligible_at`, policy version, and
retry-budget consumption. Initial defaults, to be checked against then-current
Queue limits, are:

| Stage | Maximum delivery attempts | Exponential full-jitter class | Exhausted outcome |
|---|---:|---|---|
| Harvest page | 6 | 5 seconds to 15 minutes; honor bounded `Retry-After` | Durable DLQ + failed/`partial_unpublished` run |
| Normalize record | 5 | 2 seconds to 5 minutes | Quarantine record + durable DLQ |
| Schema enrichment | 4 | 10 seconds to 30 minutes | Schema unknown/quarantined + durable DLQ |
| Access check | 4 | 30 seconds to 30 minutes | Typed stale/failed observation + durable DLQ |
| Index projection | 5 | 2 seconds to 5 minutes | Reject candidate generation + durable DLQ |

`rate_limited`, transient `upstream_5xx`, timeout, DNS/TLS, and classified
transient internal failures consume the bounded retry budget. A valid
`Retry-After` overrides the computed delay only within the source policy's
minimum/maximum delay bounds. `expected_access_restriction`, authoritative
`not_found|gone` on an exact item/distribution target, and policy-defined
terminal outcomes are acknowledged as typed observations rather than retried.
The same status on a catalog/list/cursor target is an enumeration failure that
prevents sealing. `schema_drift`, parse/content/size violations,
canonical invariant failures, and unapproved redirects quarantine the affected
work; catalog authentication misconfiguration, repeated drift, or a policy
block also opens the source circuit and requests pause. No terminal class is
blindly retried.

Per-message retries and the shared per-origin circuit breaker consume one
coordinated database budget. Cloudflare Queue `retry()` consumes a delivery
attempt, so configure transport `max_retries = maximum delivery attempts - 1`.
When a breaker is already open, do not call `retry()`: atomically move the DB job
to `retry_wait` with `next_eligible_at`, write a delayed-redelivery outbox event,
and acknowledge the current message. The dispatcher publishes a fresh transport
delivery only when eligible and only while the DB attempt budget remains. This
prevents a retry storm without pretending Cloudflare retries are free. Closing
the breaker requires an audited half-open probe or remediation. DLQ replay
creates new lineage pointing to the original message and policy version; it
never resets history in place.
Fixtures assert attempt count, delay class, `Retry-After` handling, circuit state,
final job/run state, acknowledgment behavior, and DLQ/replay lineage for every
typed failure.

### 9.11 Correctness-ledger lifecycle

The run/job/attempt, outbox, processed-event, Workflow mapping, durable-DLQ,
publication-history, and audit tables are correctness state, not disposable
telemetry. Partition high-volume ledgers by bounded time/source keys, create the
indexes used by leases/reconciliation/replay, and tune autovacuum/analyze with
measured write volume.

Initial production policy keeps replay/idempotency ledgers online for at least
90 days and never less than the maximum of Queue redelivery and DLQ replay
horizons, Workflow retention plus reconciliation grace, operator replay policy,
publication rollback window, and audit requirements. Publication/rollback and
security audit receipts are retained for at least one year unless a stricter
policy applies.

Archival and garbage collection advance only through an audited per-partition
watermark after proving:

- No active run, lease, outbox event, Workflow, DLQ case, or replay references
  the rows.
- No unexpired idempotency key could still suppress a valid delivery or permit a
  duplicate logical effect.
- No retained publication generation, rollback bundle, evidence lineage, or
  pending review depends on them.
- The archive is checksum-verified, access-controlled, and restore-tested.
- The deletion is compatible with backup/PITR retention and the approved legal
  policy.

Pruning never edits history in place; it records source partition, lower/upper
watermarks, counts, hashes, policy version, operator, and archive locator.

## 10. Connector delivery waves

Each connector instance advances through:

`fixture_only → local_integration → live_shadow → index_shadow → canary → active`

Promotion is source-specific. Do not cut over all catalogs together.

### Wave 0 — Shared foundation

Deliver the source registry, connector SDK, bounded HTTP client, rate limiter,
circuit breaker, fixtures, run/job/checkpoint state, R2 capture, outbox, queues,
DLQ sink, and promotion controls.

Exit criteria:

- Replaying any job produces one logical effect.
- Incomplete enumeration cannot advance the global checkpoint.
- Crash injection at every page/stage boundary resumes without gaps.
- Per-source pause and global scheduler kill switches work.
- No underlying dataset payload reaches R2 or PostgreSQL.
- Public Worker has no connector network or secret access.

### Wave 1 — Reusable protocols

Implement:

- `DcatDataJsonConnector`
- `CkanCatalogConnector`
- `SocrataCatalogConnector`
- `HtmlReleaseInventoryConnector`
- Shared documentation and schema extractors

Required fixtures include initial full scan, unchanged/304, insert, update,
no-op, duplicate delivery, late update, expired cursor, source shrink, 429,
transient network errors, access restrictions, unapproved redirects, HTML login
pages, schema drift, oversize responses, and suspected deletion.

### Wave 2 — National machine-readable catalogs

Implement and canary:

1. Data.gov Catalog API v4.
2. Data.CMS.gov API/data.json.
3. CMS Provider Data Catalog.
4. CDC Socrata and separately scoped non-Socrata catalogs.
5. Census discovery and variables metadata.

Rules:

- Preserve the originating agency behind Data.gov aggregator records.
- Model CMS `latest` URLs separately from immutable releases.
- Harvest Socrata metadata/schema, not SODA data rows.
- Bound Census field extraction to configured datasets; do not query
  observations.

### Wave 3 — Heterogeneous federal inventories

Implement:

- HRSA product/download inventories.
- AHRQ product-family registries.
- IRS TEOS/EO-BMF/Form 990 manifests, indexes, and XSDs.
- IRS SOI inventory where useful.

Restricted, application-based, licensed, or paid access is a valid documented
state, not a connector failure. The IRS catalog pipeline must not unpack bulk
Form 990 filing archives.

### Wave 4 — State portal canaries and matrix expansion

Implement `ArcGisCatalogConnector` and declarative instances for representative
Socrata, CKAN, ArcGIS, and static state inventories.

Start with Pennsylvania and a canary set spanning different platform and
readiness conditions, then expand by jurisdiction/source-class cells.

This wave is a top-tier product priority because the present state/federal matrix
is the largest source of user trust risk. Every cell must identify:

- Jurisdiction and source class.
- Responsible agency/operator.
- Scope and denominator type.
- Connector/manual-review disposition.
- Current canonical `coverage_cell_state`.
- Last complete enumeration and next action.

Use one versioned `coverage_cell_state` enum everywhere:

- `integrated`: eligible assets have been normalized and published from a
  production connector scope; freshness and current connector health remain
  separate axes.
- `candidate`: an authoritative lead awaits connector/evidence review and is not
  counted as integrated.
- `navigation_only`: USHSO can point to a portal or workflow but has no
  asset-ready enumeration for the cell.
- `evidence_gap`: a bounded, documented investigation failed to establish the
  required authoritative inventory/evidence.
- `inaccessible`: a known scoped inventory cannot currently be enumerated under
  the documented technical or policy conditions.
- `unknown`: the bounded assessment evidence is conflicting or otherwise
  insufficient to classify; an ordinary refresh failure alone does not erase a
  previously evidenced integration state.
- `not_assessed`: no bounded assessment has been completed.

The API uses these exact snake-case values; UI labels may be humanized but cannot
merge them.

Public UI must never convert navigation candidates into indexed-source counts.

### Wave 5 — Regulators and APCDs

Build a regulator/APCD registry dispatcher over protocol adapters and curated
workflow inventories. Its source classes explicitly include state hospital
licensing and inspection agencies, health departments, cost-report/rate-setting
authorities, discharge-data regulators, APCD agencies/councils, and other
authoritative hospital oversight catalogs. Do not automate applications, logins,
agreements, identity checks, payments, or licensed transfers.

Navigation-only pages remain workflow or documentation objects. “No source
identified,” “not assessed,” transport failure, and source absence remain
distinct.

### Wave 6 — Existing repository lanes and extensions

Add Dataverse, DataCite, OAI-PMH, and other justified protocols. Migrate the
existing 52 Harvard Dataverse and 50 DataCite records with stable-ID and evidence
parity receipts. These records should not dominate public authority ranking over
first-party government sources merely because they are numerous.

### Per-connector activation gate

Activation requires:

- Common and adapter-specific suites pass.
- Two complete reconciliations and one incremental cycle succeed.
- Zero unclassified failures.
- No checkpoint gaps or false withdrawals.
- Every discovered item is accounted as normalized, excluded, failed,
  quarantined, or review-pending.
- The request-manifest diff and capture-classification receipt show zero
  source-data-payload routes, responses, healthcare rows, forms, credential
  submissions, or unauthorized access; payload-sentinel fixtures were blocked
  before egress.
- Backlog remains within the declared freshness policy.
- Search projections are traceable and schema-valid.
- Rollback to the prior public generation has been exercised.

## 11. Identity, family, and join graph

### 11.1 Separate questions

The model must answer three independent questions:

1. Are two observations the same canonical object?
2. Are two assets members of a version, mirror, successor, format, or collection
   family?
3. Can two releases be joined for a named research purpose?

### 11.2 Identity candidates

Store:

- Ordered object pair.
- Candidate type.
- Algorithm and feature version.
- Feature evidence.
- Match score, separate from epistemic confidence.
- State: `open|accepted|rejected|deferred|superseded`.
- Created and reviewed timestamps.

Only an exact identifier may auto-resolve, and only when the namespace registry
defines its issuing authority, entity/grain scope, normalization/check rules,
uniqueness/reuse policy, and effective dates. The two assertions must use the
same namespace and normalized value, compatible entity types, and overlapping
effective periods, with no conflicting authoritative identifier. A source-native
ID is exact only inside that source unless an authoritative cross-source mapping
exists. Missing dates, namespace reuse, recycled CCNs/licenses, parent/campus
ambiguity, or conflicting identifiers force a review candidate. Title,
publisher, description, URL similarity, or embedding similarity always remain
review candidates.

Candidate generation runs automatically after normalization and on scheduled
algorithm-version backfills. It uses deterministic blocking plus separately
versioned identifier, locator, title/publisher, temporal, lineage, and semantic
features to propose `same_identity`, mirror, successor, collection, and version
relationships. Exact source-declared release lineage may group releases within
one asset automatically when namespace and temporal constraints agree; a
cross-source family or identity proposal requires the evidence policy above.
Conflicting exact identifiers quarantine the proposal rather than selecting a
winner. Only accepted or exact-policy relationships collapse public search;
open, ambiguous, deferred, and rejected candidates remain separate and
reviewable with their algorithm inputs preserved.

### 11.3 Review decisions

Supported decisions:

- `same_identity`
- `not_same_identity`
- `family_member`
- `mirror_of`
- `successor_of`
- `defer`
- `needs_more_evidence`

Every decision records reviewer, rationale, evidence, algorithm version, time,
and supersession. Accepted identity creates a projection cluster; it does not
delete either source-native observation. Reversing a decision rebuilds the view
without restoring deleted data.

### 11.4 Identity graph semantics

The graph must support source-specific identifiers and effective dates,
including CCN, NPI, EIN, FIPS, state license IDs, legal entity IDs, campus IDs,
and parent-system relationships. It must make clear that a Medicare-certified
facility, legal filer, licensed hospital, NPI organization, campus, and
consolidated health system are not interchangeable.

### 11.5 Join and transformation model

Join routes reference exact `SchemaField` IDs and release/schema applicability.
Represent these operations separately:

- `join`
- `crosswalk`
- `aggregate`
- `filter`
- `temporal_alignment`
- `measure_harmonization`

Each operation includes source/target grain, identifier namespace, direction,
cardinality, lossiness, preconditions, validation checks, and evidence. Its
semantics are orthogonal rather than compressed into one overloaded status:

- `operation_kind`: `join|crosswalk|aggregate|filter|temporal_alignment|measure_harmonization`.
- `evidence_state`: `unknown|candidate|ambiguous|documented|observed|executed|proven`,
  with a definition and admissible evidence classes for each value. `executed`
  and `proven` require explicit external or controlled-test evidence and never
  mean USHSO executed a public user's plan.
- `compatibility`: `compatible|conditional|incompatible|unknown`.
- `requirements[]`: crosswalks, aggregation, normalization, authorization,
  temporal alignment, and other prerequisites, each with a satisfaction state.
- `blockers[]`: unresolved conditions that prevent a ready recommendation.

Thus `crosswalk_required` is a requirement, `blocked` is derived from unresolved
blockers, and neither is a compatibility or evidence value. A candidate exact-key
route is not documented merely because both fields are called CCN. Aggregation
never substitutes for an identity crosswalk.

## 12. Researcher-oriented metadata

Create a production Use Card successor for assets eligible for recommendation.
Near the top of each details page and in plan source cards, expose:

- **Best for**
- **Not sufficient for**
- **Key analytic cautions**
- **Typical unit of observation**
- **Known breaks in series**
- **Update frequency and expected lag**
- **Suppression and completeness notes**
- **Identifier stability over time**
- **Source-reported versus derived/proxy measures**
- **Compatible geography, time, and grain**
- **Known join/crosswalk requirements**

Access Recipes should additionally capture, when evidenced:

- Public, registration, application, DUA, licensed, or paid status.
- Who qualifies.
- Request process.
- Human authorization gates.
- Approximate turnaround category, not invented point estimates.
- Fee basis.
- Delivery mechanism and format.
- Required inputs.
- Expected artifacts.
- Stop conditions and typed failures.

These fields explain whether a researcher can actually use the source for a
question; they must not imply that USHSO has acquired or is authorized to acquire
the data.

### 12.1 Machine-readiness classification

Each release/distribution should expose evidence-backed machine-readiness
capabilities:

- Human-readable only.
- Direct downloadable file.
- Documented API or query service.
- Machine interface plus indexed schema.
- Verified retrieval recipe.
- Compatible join/validation guidance.

Do not reduce these capabilities to an unexplained quality score. Publish the
underlying flags—interface, authentication, schema, pagination, recipe,
verification, and join evidence—alongside an optional convenience label such as
`human_only`, `downloadable`, `api_documented`, `schema_indexed`,
`retrieval_ready`, or `join_ready`. Every label carries evidence and observation
time.

Search and plan requests may require machine-accessible sources and prefer
better-documented access paths, but must not equate machine readiness with
analytical quality or authorization.

## 13. Search and publication

### 13.1 Search backend decision

Implement a `SearchBackend` interface. The first production implementation will
use PostgreSQL full-text search (`tsvector` + GIN), normalized facet tables, and
bounded indexed queries. This is sufficient to eliminate Worker corpus loading
and permits one operational system of record.

Before public cutover, benchmark production-like asset, release, distribution,
and field counts. Move to a dedicated managed search service if PostgreSQL cannot
meet quality, latency, rebuild, or operational targets. Domain contracts and API
responses must not depend on the physical search vendor.

### 13.2 Projection types

#### Asset search document

One per canonical asset, containing:

- Titles, aliases, abbreviations, descriptions.
- Publisher, source, authority tier, and native IDs.
- Subjects, constructs, use cases, and researcher roles.
- Geography, unit/grain, population, and temporal envelope.
- Access and freshness summaries.
- Family and identity resolution state.
- Schema concepts and identifier namespaces.
- Use Card summary and evidence references.

#### Release/distribution search document

One per eligible release/distribution combination, containing exact time
coverage, release date, format, interface, access route, current access
observation, documentation, schema snapshot, and freshness policy.

#### Schema-field search document

One per field, containing native name, label, description, aliases, type, unit,
code system, entity grain, semantic roles, identifier namespace, and exact
schema/release/distribution parents.

#### Join-edge document

One per release-compatible route, containing field references, namespaces,
normalization, cardinality, applicability, operation kind, evidence state,
compatibility, requirements, blockers, temporal rules, confidence, evidence, and
caveats.

#### Source search document

One per catalog/source for source browsing, authority filters, connector state,
and source-specific coverage. Source documents do not substitute for assets in
research results.

### 13.3 Common projection envelope

Every document includes:

- Document type and projection schema version.
- Canonical IDs and revisions.
- Projection input references.
- Index generation and projection time.
- Visibility state.
- Document checksum.
- Evidence, assertion, access, documentation, and relationship references.
- `source_of_truth: false`.

### 13.4 Index lifecycle

1. Canonical commit creates an outbox event.
2. Projector deterministically writes affected documents into a `building`
   generation. The published generation is immutable.
3. Index acknowledges canonical revision and document checksum within that
   building generation.
4. Reconciler compares eligible canonical objects with acknowledgements.
5. Periodic full rebuilds correct drift; incremental catch-up may populate a new
   candidate generation but never updates the active one.
6. One publication manifest atomically pins the asset, release/distribution,
   field, source, join, SEO, and coverage projection generations plus their
   canonical watermark.
7. After all components validate, the manifest is promoted in one database
   transaction.
8. Previous immutable manifests and generations remain available for rollback.

### 13.5 Retrieval-quality workstream

Search improvement must explicitly include:

- Intent decomposition into analytical roles.
- Source-class and authority priors.
- Controlled concept, construct, acronym, and synonym expansion.
- Negative constraints and prohibited-access handling.
- Exact field/identifier matching.
- Geography, grain, time, and access hard gates.
- First-party authoritative-source boosting.
- Family diversification and duplicate collapse only for confirmed identities.
- Explicit near-miss detection and explanation.
- Graph expansion for identity, crosswalk, and supporting sources.
- Candidate generation per role instead of one conjunctive top-k list.

Do not label results “best available sources” until the retrieval quality gates
in section 23 pass.

### 13.6 Query path

The public Worker:

1. Compiles structured intent.
2. Queries the relevant indexed projection types.
3. Receives bounded candidate IDs.
4. Applies deterministic post-ranking and compatibility logic only to candidates.
5. Hydrates the exact canonical revisions recorded by the selected generation,
   not whichever revisions happen to be current at request time.
6. Returns the pinned generation and coverage scope.

It does not load the catalog or scan every canonical record.

## 14. Research-plan compiler

### 14.1 Contract

Create `observatory-research-plan.v1.0.0` with strict
`additionalProperties: false` boundaries. Required top-level sections:

- `contract_version`
- `plan_id`
- `plan_status`
- `generated_from`
- `interpreted_need`
- `clarifications`
- `response`
- `asset_contributions`
- `bundle_assessment`
- `operations`
- `acquisition_plan`
- `downstream_handoff`
- `important_limitations`
- `unresolved_gaps`
- `conditions_not_recommend`
- `evidence_references`
- `truth_boundary`

`plan_status` is required and follows this decision table:

| Status | Required condition | Recommendation behavior |
|---|---|---|
| `unsupported` | The interpreted request is outside the source-planning boundary or no permissible plan can address it | No confident source bundle; explain the boundary |
| `clarification_required` | A missing bounded answer materially changes essential roles, bundle, coverage, access, or safety | Return stable questions; no confident recommendation |
| `incomplete` | The request is interpretable and in scope, but an essential role, exact release/distribution/access route, admissible evidence, or required operation is missing/blocked | Return evidenced partial findings and explicit gaps, never a ready bundle |
| `ready_with_constraints` | Every essential role has an exact asset contribution, but a conditional compatibility, external authorization/human gate, bounded coverage limitation, or unresolved non-fatal prerequisite remains | Recommend with the constraint adjacent to the affected asset/operation |
| `ready` | Every essential role and exact distribution/route resolves; essential operations are compatible with satisfied requirements; evidence is current/admissible; the acquisition DAG is complete | Return the smallest defensible bundle and full non-executed handoff |

When more than one condition applies, precedence is
`unsupported → clarification_required → incomplete → ready_with_constraints → ready`.
Every plan includes machine-readable `plan_status_reason_codes`; templates may
not override the computed status.

Each `asset_contributions[]` entry is typed and carries role, canonical
`asset_id`, exact `release_id`, `distribution_id`, `access_route_id`, originating
catalog `source_id`, coverage, fitness/limitations, and evidence references. The
human answer may colloquially say “sources,” but the machine contract never uses
canonical `Source` as a synonym for a dataset Asset.

The canonical plan pins registry revision, index generation, coverage snapshot,
content-addressed `candidate_snapshot_id`, source manifests, and planner
fingerprint. A transport `request_id` is returned outside the canonical plan and
excluded from its digest. `plan_id` is the SHA-256 of the canonical plan body
with `plan_id` and all transport fields omitted, then inserted after hashing.
The narrative and JSON are projections of the same canonical plan object.

### 14.2 Deterministic planner stages

1. Validate the request and preserve input bounds.
2. Compile geography, subject, time, unit, access, and intended-analysis intent.
3. Ask for clarification only when the missing choice materially changes source
   selection.
4. Decompose the question into roles such as ownership/change, utilization,
   finance, denominator, organization identity, geography, or crosswalk.
5. Retrieve candidates separately for each required role.
6. Apply hard authority, access, geography, time, grain, and evidence gates.
7. Resolve exact assets, releases, distributions, and access routes.
8. Expand the join graph by a bounded number of hops.
9. Select the smallest eligible bundle covering all roles.
10. Calculate requested, source-supported, and common-supported coverage.
11. Compile joins, crosswalks, aggregations, and other transformations.
12. Assemble an ordered acquisition DAG from Access Recipes.
13. Classify intended analyses as supported, conditional, blocked, or unsupported.
14. Attach evidence to every auditable claim.
15. Canonicalize and hash the output.

Use deterministic bounded set-cover/graph search. Prefer lexicographic rules over
an opaque aggregate score:

1. Cover every required role.
2. Reject hard incompatibilities.
3. Minimize unresolved prerequisites.
4. Maximize complete temporal coverage.
5. Prefer documented evidence over candidate/ambiguous evidence, and prefer
   routes whose compatibility requirements are already satisfied.
6. Prefer authoritative, accessible, reviewed sources.
7. Minimize source count and access burden.
8. Break any remaining tie by canonical asset ID, release ID, distribution ID,
   and access-route ID in bytewise ascending order.

Do not force exactly three datasets. Recommend the smallest defensible bundle.

### 14.3 Semantic safety rules

- Every selected source and recipe resolves in the pinned generation.
- Every required role has an eligible source or an explicit gap.
- Every recommendation in a `ready` or `ready_with_constraints` plan is backed
  by evidence that is admissible for that claim, current under the applicable
  staleness policy, and human-reviewed where the policy requires review. Each
  claim carries observation time, evidence state, staleness state, and complete
  derivation lineage; mere referential resolvability is insufficient.
- Common coverage cannot exceed the intersection of essential sources.
- Fiscal and calendar periods remain explicit.
- Candidate joins never become documented or proven.
- Aggregation does not resolve identity.
- Public metadata does not imply data access.
- Clarification and unsupported plans contain no confident recommendation.
- Operation and acquisition graphs are acyclic.
- No fields for payloads, rows, computed measures, rankings, or analytical results
  are allowed.

### 14.4 API and agent surface

Keep existing v1 routes during migration. Add:

- `POST /api/plan`
- `GET /api/contracts/research-plan/v1.0.0`
- `GET /api/access-recipes/{recipe_id}` if plans reference rather than embed steps
- Read-only WebMCP tool `observatory.plan_research` as the composed capability in
  the machine toolkit described in section 15.6

Do not overload `/api/discover` with a plan mode flag. Ranking and research
recommendation are different contracts.

`POST /api/plan` performs no request-time source fetch, persists no question by
default, and always declares:

- `source_requests_made: false`
- `execution_authorized_by_ushso: false`
- `retrieval_executed: false`
- `analysis_executed: false`
- `payloads_acquired: false`
- `identity_merges_performed: false`

The truth-boundary terms use the source-payload and source-data definitions in
section 15.6.2; metadata retrieval, ranking, and deterministic plan compilation
do not contradict those declarations.

Clarification is a stateless, generation-pinned round trip. The initial response
returns stable question IDs, a bounded answer schema, the normalized-request
hash, an optional `prior_plan_id`, and a signed opaque `clarification_token`. The
token contains no raw question or user identifier; it binds contract/key version,
request hash, question-set hash, generation, `issued_at`, and `expires_at` (at
most 24 hours). A follow-up resubmits the original question,
`clarification_answers`, request hash, token, and `expected_generation`; the
service verifies signature, expiry, question IDs, request hash, and generation
without persisted issuance state or question text. Key rotation retains verify-
only keys through the maximum token TTL. Unknown/tampered questions, changed
hashes, expired tokens, or unavailable generations fail with typed errors. Token
reuse is idempotent, not side-effectful. Tests cover tamper/expiry/key rotation,
`clarification_required → ready`, `clarification_required → incomplete`,
idempotent resubmission, and a generation change between rounds.

### 14.5 Initial acceptance case

Use the Pennsylvania hospital finance/utilization/identity question as the first
vertical slice. The initial correct response may be constrained:

- Evidenced overlap through 2024 unless 2025 is reconciled into normalized source
  truth.
- Candidate CCN linkage where evidence remains candidate.
- PHC4 row-level linkage blocked without a label-to-CCN crosswalk.
- Facility-to-system aggregation treated as a separate, non-executed operation.

The slice passes only when it emits exact assets, releases, distributions,
access routes, roles, coverage, operations, access steps, evidence, gaps, and a
machine plan—with no data or metrics.

## 15. Product and UI plan

### 15.1 Coverage positioning

Immediately and throughout migration:

- Describe USHSO as a **14-source, live-metadata-validated federal baseline plus
  selected state coverage**.
- Show the corpus composition by source class and authority.
- Describe the federal backbone as a **14-source, live-metadata-validated federal
  baseline**, not 14 universally usable or exhaustively indexed sources. State
  that live-metadata validation confirms the scoped catalog/landing route at the
  recorded time; it does not prove payload availability, row coverage, schema
  completeness, access authorization, or fitness for a research question.
  Expose applicability modes: 11 direct, 2 crosswalk-required, and 1 unknown in
  the current readiness artifact.
- Render every canonical `coverage_cell_state` separately: integrated,
  candidate, navigation-only, evidence-gap, inaccessible, unknown, and
  not-assessed.
- Do not headline “51 jurisdictions” without the accompanying coverage-state
  distribution and denominator explanation.
- Display the active registry/index snapshot and as-of time.

### 15.2 Search results

Finish and validate the current in-progress result-card simplification rather
than redesigning the page again. A result should primarily show:

1. Title.
2. One-sentence description.
3. Why it matches.
4. Geography, grain, and time.
5. Access and evidence status.
6. One details action.

Rank, relationship internals, full access recipes, field lists, family detail,
and provenance belong on the details page or plan, not on every search card.
Returned counts must remain explicitly bounded to the current API page/index
scope.

The result-card contract test allows only those six primary regions in the
default card and asserts that rank internals, family/relationship detail, field
lists, recipe steps, and provenance are absent until detail navigation. Before
beta, at least five representative health-services researchers complete a
search-choice task; at least 80% must identify the intended source to inspect
within 30 seconds without interpreting card order as an analytical ranking.

### 15.3 Details page

Add a concise researcher decision summary above the existing factual detail:

- Best for.
- Not sufficient for.
- Key analytic cautions.
- Unit of observation.
- Coverage and breaks in series.
- Update lag.
- Suppression/completeness.
- Identifier stability.
- Access process and practical requirements.

Keep evidence, variables, access, and join detail below. Replace generic
“verified” language with the exact checked target, such as metadata route,
distribution endpoint, or schema endpoint.

Validate “Can I use this?” on a stratified set of at least 12 open, restricted,
application, report-only, stale, and schema-incomplete assets. Two reviewers must
be able to determine intended use, insufficiency, grain, coverage, access steps,
human gates, and key cautions from the rendered summary, with 100% critical-field
coverage and zero access/authorization overclaims.

### 15.4 Plan page

Use a distinct route such as `/plan`. Render in this order:

1. Lead answer: “You need these sources.”
2. Essential, supporting, conditional, rejected, or unavailable source roles.
3. Requested versus supported coverage and gaps.
4. Join/crosswalk/aggregation map with exact evidence states.
5. Ordered acquisition instructions and human gates.
6. Supported and unsupported downstream analyses.
7. Limitations, unresolved facts, and plan pins.
8. Copy/download machine-readable JSON.

Do not add saved plans, accounts, uploads, or analysis workspaces in v1.

### 15.5 Conventional web discoverability

Make every stable public asset page crawlable without JavaScript:

1. Add an `seo_record_document` projection containing title, description,
   canonical URL, publisher, temporal/spatial coverage, access, distribution,
   and evidence summary.
2. Intercept `/datasets/{id}` HTML requests in the Worker and return crawlable
   record-specific HTML from the active published generation.
3. Include record-specific `<title>`, description, canonical URL, robots policy,
   and social metadata.
4. Emit schema.org `Dataset` JSON-LD and compatible DCAT/DCAT-US metadata where
   the canonical facts support it.
5. Include every public stable dataset URL in a generated sitemap; use sitemap
   indexes if necessary.
6. Preserve permanent redirects/canonical tags for legacy aliases.
7. Return 404 for never-public/unknown URLs. Return 410 only for a formerly
   public stable URL whose `public_withdrawn` lifecycle assertion is itself
   admissible for disclosure; use a generic tombstone page and expose no internal
   withdrawal reason.
8. Ensure a crawler with JavaScript disabled can read the title, summary,
   publisher, coverage, access boundary, evidence status, and canonical source
   link.

SEO publication must use the same generation pointer as search so crawlers never
receive a page assembled from mismatched metadata revisions.

The public 410 is a deliberate HTML lifecycle exception to API/WebMCP
non-enumeration: it applies only to URLs proven previously public and explicitly
approved for a public withdrawal assertion. Excluded, private, quarantined,
candidate, or never-published IDs remain indistinguishable 404/non-resolution
cases and never receive a 410 tombstone.

### 15.6 Machine interfaces and WebMCP toolkit

USHSO will expose its canonical capabilities through three machine-facing
surfaces:

1. **WebMCP** for browser-native agents operating on `ushso.org`.
2. **JSON API** for autonomous and server-side software.
3. **`llms.txt` plus human documentation** as non-executable discovery,
   bootstrap, and contract-navigation material.

These are adapters over shared services, not separate backends. Search, record
hydration, variables, access, joins, comparison, coverage, and planning must
have semantic and critical-field parity between UI, JSON API, and WebMCP, while
adapter envelopes may intentionally differ. No adapter may invent facts, upgrade
evidence, or weaken a safety boundary. `llms.txt` describes and links to the
executable API/WebMCP contracts; it is not itself an interface that can execute
them.

WebMCP is currently a draft Web Machine Learning Community Group report rather
than a W3C Standard. At this plan's date, the current community-group draft is
dated 2026-08-26. Pin an immutable specification revision/commit in the machine
toolkit manifest rather than the mutable latest URL, feature-detect the browser
surface, and isolate imperative registration behind a compatibility adapter.
Specification changes must update the pin, browser tests, and tool manifest
together. See the current [WebMCP draft](https://webmachinelearning.github.io/webmcp/).

#### 15.6.1 Tool vocabulary

Target a small toolkit with eight composable inspection tools and one composed
planner tool. Do not proliferate one tool per field or screen.

| Tool | Purpose | Corresponding canonical/API capability |
|---|---|---|
| `observatory.search_assets` | Browse or identify relevant data assets; return bounded summaries | Indexed asset discovery/browse |
| `observatory.get_asset` | Dereference one stable canonical asset/release view | `GET /api/datasets/{record_id}` |
| `observatory.get_access_plan` | Explain access class, source eligibility criteria, requirements, human gates, and process | Access Plan/Recipe policy view |
| `observatory.get_retrieval_recipe` | Explain the technical request, endpoint, parameters, pagination, formats, and parser hints | Retrieval Recipe technical view |
| `observatory.get_variables` | Search or page through fields for one exact schema/release/distribution | Schema-field search |
| `observatory.get_join_routes` | Return direct and explicitly requested bounded join/crosswalk routes | Join graph query |
| `observatory.compare_assets` | Compare two to five research assets across metadata dimensions | Deterministic asset-comparison projection |
| `observatory.get_coverage_status` | Explain what USHSO has and has not indexed for a scope | Coverage query |
| `observatory.plan_research` | Compose roles, asset contributions, operations, access, and gaps into one plan | `POST /api/plan` |

`observatory.plan_research` is feature-gated until the retrieval, planner safety,
planner usefulness, coverage, identity-resolution, machine-interface, and
security/privacy gates all pass. The core inspection toolkit may ship before the
planner, but **no** tool is publicly registered until the publication/runtime,
applicable machine-interface, and security/privacy gates pass, including
redaction and zero-authoritative-egress tests. `search_assets` additionally
requires the retrieval gate; `get_coverage_status` requires the coverage gate;
`get_join_routes` requires the identity-resolution gate; and each dereference,
access, retrieval, variable, or comparison tool requires its own canonical
contract/evidence fixtures to pass. Cap the default public registration at these
tools unless a new capability cannot be expressed through the existing
contracts.

The current `observatory.discover_sources` tool remains compatible during a
documented transition. The v2 manifest should name `search_assets` as the
preferred summary-first tool—because canonical `Source` means a portal/catalog,
while search results are Assets—and define whether the old name is an alias,
versioned legacy registration, or deprecation. Do not register two visually
indistinguishable search tools by default.

Audit the already deployed `discover_sources` surface immediately against the
redaction, input/output-bound, untrusted-content, and zero-authoritative-egress
requirements. Keep it only if that legacy audit passes; otherwise disable it
until the safe compatibility adapter is ready. The gate above controls every new
or changed public registration.

#### 15.6.2 Shared tool response envelope

Every tool returns:

- Tool contract version.
- Transport `request_id`, excluded from canonical content/digests, plus a
  content-addressed `result_snapshot_id` or `candidate_snapshot_id` where the
  capability produces a reusable result set.
- Registry revision and index generation.
- Canonical as-of time and coverage snapshot ID where relevant.
- Result state.
- Bounded metadata result.
- For every public factual field or derived claim: resolvable evidence references,
  observation time, evidence state, staleness state, and derivation/policy
  reference; maintained product copy cites its contract/policy version.
- Warnings, including corpus/scope boundaries.
- Opaque next-page cursor where applicable.
- `truncated`, `omitted_sections`, and `next_cursor` fields, with explicit null
  or empty values when nothing was omitted.
- A `truth_boundary` object that always declares
  `source_requests_made: false`, `execution_authorized_by_ushso: false`,
  `retrieval_executed: false`, `payloads_acquired: false`,
  `analysis_executed: false`, and `identity_merges_performed: false`.

These booleans have contract-level meanings. `source_requests_made` means calls
to an external authoritative-source origin, not a same-origin canonical API
read. `retrieval_executed` means executing a Retrieval Recipe against the source
to acquire healthcare/source-data payloads, not retrieving USHSO metadata.
`payloads_acquired` means source-data rows/files/bodies, not this metadata
response. `analysis_executed` means computing statistics, measures, joins,
rankings, or other results over source data, not metadata search, deterministic
comparison, or plan compilation. `identity_merges_performed` means mutating the
canonical identity graph, not reading an existing assertion. Authorization means
USHSO granted or satisfied an external access requirement; describing the
requirement never makes it true. These definitions are part of the API, plan,
and WebMCP schemas and fixtures.

Public responses redact credentials, cookies, signed or presigned URLs,
authorization headers, private source locators, and any secret-bearing query
parameter. Source-derived metadata remains untrusted data and cannot alter tool
instructions, titles, descriptions, schemas, or the truth boundary.

Tool responses use stable canonical IDs so an agent can follow the intended
workflow:

`search → choose → dereference → inspect access/variables/joins → compare or plan`

#### 15.6.3 Summary-first and token-bounded behavior

WebMCP responses must be designed for agent context efficiency:

- Search returns concise asset summaries, not complete canonical records.
- Default search limit is small; maximum is bounded by contract.
- `get_asset` is the explicit full-record dereference.
- Variables support `record_id`, optional release/distribution/schema IDs,
  semantic query, filters, and opaque cursor pagination.
- Join lookup accepts exact endpoints and optional release constraints; indirect
  paths require an explicit bounded-hop option.
- Comparison accepts two to five stable IDs and a bounded dimension list.
- Coverage returns the denominator, unknown state, and whether an absence claim
  is permitted.
- Plans return the canonical plan, not duplicate embedded full records.

The decoded input arguments for every tool are at most 20 KiB. Contract-level
output bounds are measured on serialized JSON before transport compression:

| Tool | Cardinality bounds | Maximum response |
|---|---|---:|
| `search_assets` | default 5, maximum 20 summaries | 64 KiB |
| `get_asset` | one bounded core view; nested collections default 20, maximum 50 each | 128 KiB |
| `get_access_plan` | maximum 50 ordered steps/requirements | 64 KiB |
| `get_retrieval_recipe` | maximum 100 parameters/parser hints | 64 KiB |
| `get_variables` | default 25, maximum 100 fields; maximum 100 displayed allowed values per field | 128 KiB |
| `get_join_routes` | maximum 50 routes and two hops | 128 KiB |
| `compare_assets` | 2–5 assets and maximum 12 dimensions | 96 KiB |
| `get_coverage_status` | maximum 100 cohort cells | 128 KiB |
| `plan_research` | maximum 12 asset contributions and 50 operations | 256 KiB |

The versioned machine-toolkit JSON Schemas and generated manifest are normative,
use shared constants across API and WebMCP, set `additionalProperties: false`,
and put `maxLength`, `maxItems`, and `maxProperties` on every applicable nested
property. Initial category limits are:

| Field category | Normative maximum |
|---|---:|
| Stable ID or enum-like string | 128 Unicode characters |
| URL/template after redaction | 2,048 characters |
| Research need or semantic query | 4,000 characters |
| Clarification answers | 20 answers; 2,000 characters each |
| Filter dimensions/values | 20 dimensions; 20 values each; 128 characters/value |
| Opaque cursor or clarification token | 2,048 characters |
| Maintained explanatory text / source-derived excerpt | 4,000 / 2,000 characters |
| Warnings or limitations | 50 entries per response |
| Evidence references | 100 per ordinary response; 200 per plan |
| Asset nested release/distribution/documentation/schema pages | default 20, maximum 50 per collection |

Tool-specific schemas may impose lower limits. CI fails any public schema with an
unbounded string, array, map, recursive structure, or undeclared property; the
manifest publishes the resolved limit for every input and output collection.

If a pageable collection would exceed either cardinality or byte bounds, the
service returns only complete atomic items, sets `truncated: true`, names every
entry in `omitted_sections`, and supplies an opaque generation-pinned
`next_cursor`. It never slices an item or silently clips JSON. A research plan,
Access Plan, Retrieval Recipe, comparison, truth boundary, human authorization
gate, blocker, warning, or limitation is safety-atomic and may not be prefix
truncated. The construction limits must normally keep those objects in bounds;
otherwise the tool fails closed with `response_limit_exceeded` and corrective
guidance rather than returning an apparently executable partial object.

Cursors are pinned to an index generation. Every follow-up tool also accepts
`expected_generation`; agents should pass the generation returned by browse or
search through the rest of the workflow. An expired or unavailable generation
returns a typed error rather than silently continuing against different data.

Every continuation-bearing response includes `continuation_expires_at` and
`generation_retention_expires_at`. Search/collection cursors live at most 30
minutes; clarification references live at most 24 hours; and every superseded
public generation remains queryable for at least 48 hours after retirement (the
N−1 rollback generation is retained for the longer Stage-5 rollback window).
Continuation expiry can never exceed generation retention. If a continuation is
expired or its generation was exceptionally revoked for a safety incident, the
response sets `restart_required: true` and never restarts silently.

Generation pinning is a shared service/API contract, not a WebMCP-only feature.
GET routes accept `generation`; POST routes accept `expected_generation`; every
response returns the resolved generation. A cursor embeds its generation, and a
conflicting explicit pin returns `generation_mismatch`; a valid but no-longer
queryable pin returns `generation_unavailable`. Publication rollover tests keep
an active cursor and clarification round trip coherent across a pointer flip.

#### 15.6.4 Tool-specific requirements

**`search_assets`**

- Use a discriminated `oneOf` schema on `mode`. `browse` accepts structured
  filters, forbids `research_need`, and omits/nulls relevance, confidence,
  role-candidate, and near-miss fields. `search` requires a natural-language
  need and accepts optional geography, time, grain, access, authority,
  machine-readiness, and negative constraints.
- Browse returns generation-pinned facet counts and source/family/release
  aggregates with exact/estimated status and denominator scope. Its allowed sort
  enum is `title_asc|publisher_title|updated_desc`; each order ends with
  canonical `asset_id` ascending as the unique tie-break. Search uses its frozen
  rank tuple followed by `asset_id` ascending. The opaque cursor binds generation,
  normalized filters, mode, sort/ranker version, grouping, and last complete sort
  tuple, producing a total order with no skips/duplicates across pages.
- Both modes return title, stable ID, geography, grain, time, access class,
  machine readiness, evidence state, `observed_at`, staleness, and bounded
  evidence references. Search mode additionally returns role candidates, why
  relevant, confidence, derivation references, and near-miss reasons.
- In search mode, expose near-miss reasons instead of burying prohibited or
  incompatible records in a generic score.

**`get_asset`**

- Accept one stable canonical or legacy alias ID and optional
  `expected_generation`.
- Return the bounded core asset-oriented public canonical view from that exact
  generation; paginate large release, distribution, documentation, and schema
  collections under the common output contract.
- Distinguish asset, release, distribution, source, family, and identity state.

**`get_access_plan`**

- Return access class, source-documented `eligibility_criteria`,
  account/application/DUA/fee/institutional requirements, human process,
  turnaround category, authoritative links, verified-at time, and evidence.
- Always set `requester_eligibility: not_assessed`; USHSO does not know the
  caller's identity, institution, approvals, or qualification and must never
  infer them from a question.
- Declare `execution_authorized_by_ushso: false` and never submit a step.

**`get_retrieval_recipe`**

- Return interface, request method/template, parameters, authentication type,
  pagination, response formats, compression, size category, update behavior,
  parser hints, expected artifacts, checks, and stop conditions.
- Permit bounded source-provided **sample requests** only. Never return sample
  response rows, response bodies, or payload excerpts.
- Declare `retrieval_executed: false`.

**`get_variables`**

- Resolve an exact schema context whenever more than one schema/release applies.
- Return only matching/page-sized fields with label, description, native name,
  type, unit, allowed values/code system, semantic role, identifier namespace,
  evidence, and limitations.
- Return schema-completeness state; “some fields indexed” must not imply a
  complete dictionary.

**`get_join_routes`**

- Accept `from` and optional `to` stable IDs plus release constraints.
- Return field IDs/namespaces, entity, direction, cardinality, temporal
  applicability, normalization, crosswalk/aggregation requirements, evidence,
  caveats, and exact compatibility state.
- Never label documentation-only evidence as executed/proven.

**`compare_assets`**

- Compare metadata only: role, authority, geography, time, grain, access,
  variables/schema, freshness, machine readiness, and pairwise operation kind,
  evidence, compatibility, requirements, and blockers.
- Explain unknown/incomparable dimensions.
- Never compare observed values or produce analytical rankings.

**`get_coverage_status`**

- Accept geography, subject/source class, and optional time or authority filters.
- Return federal baseline, state/local overlay state, source-scope denominator,
  processing status, completeness state, interpretation, and
  `absence_claim_permitted`.
- `absence_claim_permitted` defaults to false unless a complete, explicitly
  bounded inventory supports the claim.

**`plan_research`**

- Return the canonical research-plan contract from section 14.
- Compose existing capabilities server-side; do not ask the browser agent to
  infer coverage intersections or upgrade join evidence.
- Accept `clarification_answers`, `prior_request_hash`, optional `prior_plan_id`,
  and the required signed `clarification_token` plus `expected_generation` for the
  stateless clarification round trip in section 14.4. Clarification responses
  expose stable question IDs and answer schemas; they never require server-side
  storage of the raw question.

#### 15.6.5 Tool registration and implementation

Replace the one-tool registration helper with a versioned
`registerObservatoryToolkit` that:

- Registers every enabled tool against one provider/service interface.
- Uses one lifecycle `AbortSignal` and cleanly unregisters the complete toolkit.
- Preserves `readOnlyHint: true` and `untrustedContentHint: true` for every tool.
- Contains no Node-only imports in browser modules.
- Makes no authoritative-source network requests and performs no acquisition.
- Propagates caller abort signals.
- Enforces per-tool input/output bounds and structured errors.
- Publishes one machine-readable manifest through the contract API; `/agents`,
  `llms.txt`, and human documentation link to and accurately summarize that
  manifest without pretending to be executable registries.

Tool titles and descriptions must be maintained product text, never copied from
source metadata. Source-derived output remains explicitly untrusted. Keep tools
same-origin by default; any cross-origin exposure or Permissions Policy change
requires a separate security/privacy review. Cap every string, array, page size,
and comparison set to reduce over-parameterization and prompt-injection surface.

The browser provider may call the same-origin USHSO API. “No network” in the
source-safety boundary means no live authoritative-source discovery or payload
fetch from tool execution, not that the browser cannot reach the canonical
USHSO API.

#### 15.6.6 Error model

Define stable errors such as:

- `invalid_input`
- `record_unavailable_in_generation`
- `schema_context_required`
- `generation_mismatch`
- `generation_unavailable`
- `cursor_expired`
- `clarification_token_invalid`
- `clarification_expired`
- `coverage_unknown`
- `route_not_documented`
- `comparison_limit_exceeded`
- `response_limit_exceeded`
- `planner_unavailable`
- `service_unavailable`

Errors include a safe message, retryability, relevant generation/scope, and
corrective input guidance. An empty result is a valid scoped result, not an
exception or absence claim.

`invalid_input` covers malformed IDs; every syntactically valid public record ID
that cannot resolve in the selected generation returns the single
`record_unavailable_in_generation` class. Public errors do not disclose whether
a record never existed, is excluded, quarantined, withdrawn, private, or unknown
outside the requested generation. Authenticated operations views may expose the
internal reason under a separate authorization and audit contract.
The only public lifecycle exception is the evidence-approved HTML 410 tombstone
for a formerly public stable URL defined in section 15.5; API and WebMCP
dereference still use the generic non-resolution error.

Until WebMCP standardizes granular execution-error propagation, return expected
domain errors inside the schema-valid common envelope—for example
`{ "ok": false, "error": {...} }`—rather than depending on rejected promises to
carry structured detail. Reserve rejection for cancellation and unexpected
transport/runtime failures.

#### 15.6.7 Machine-interface parity

For every executable tool, maintain one conformance table linking:

- Canonical service method.
- JSON API route and schema.
- WebMCP tool and schema.
- Human UI consumer, if any.
- Authorization and side-effect classification.
- Contract and fixture tests.

No WebMCP-only truth, ranking, access logic, comparison logic, or plan logic is
permitted. Parity means matching canonical facts, safety fields, evidence states,
generation pins, and decisions—not byte-identical transport envelopes.

The target route/tool mapping is:

| Canonical capability | JSON API | WebMCP |
|---|---|---|
| Asset browse/search | Existing `GET /api/catalog` and `POST /api/discover` during v1; versioned summary route if required by v2 | `observatory.search_assets` |
| Stable asset dereference | `GET /api/datasets/{record_id}` | `observatory.get_asset` |
| Access policy/process | `GET /api/datasets/{record_id}/access-plan` | `observatory.get_access_plan` |
| Technical retrieval | `GET /api/datasets/{record_id}/retrieval-recipe` | `observatory.get_retrieval_recipe` |
| Variables/schema | `GET /api/datasets/{record_id}/variables` | `observatory.get_variables` |
| Join routes | `GET /api/join-routes` | `observatory.get_join_routes` |
| Asset metadata comparison | `POST /api/compare-assets` | `observatory.compare_assets` |
| Coverage scope/status | `GET /api/coverage/status` | `observatory.get_coverage_status` |
| Research planning | `POST /api/plan` | `observatory.plan_research` |

#### 15.6.8 Machine-toolkit rollout

Roll out the toolkit in capability order:

1. **Foundation (not public):** shared provider/service methods, versioned tool
   manifest, common envelope, structured errors, registration lifecycle, and
   parity/security tests.
2. **Search and dereference:** summary-first `search_assets`, `get_asset`, and
   `get_coverage_status`. This establishes the safe search/choose/dereference
   pattern and stops absence overclaims; enable each only after its base and
   capability-specific gates above pass.
3. **Research inspection:** `get_access_plan`, `get_retrieval_recipe`,
   `get_variables`, and `get_join_routes` after their canonical contracts and
   generation-pinned indexes exist.
4. **Decision support:** `compare_assets` after deterministic comparison
   semantics pass metadata-only tests.
5. **Composition:** `plan_research` only after the retrieval, planner safety,
   planner usefulness, coverage, identity-resolution, machine-interface, and
   security/privacy gates pass.

At each phase, publish one versioned executable-capability manifest for the API
and WebMCP registration. API documentation, `/agents`, `llms.txt`, and human docs
link to and accurately summarize that manifest. Disabled or unavailable tools
must not be advertised as active.

Pre-publication receipts for a gated tool are produced through an
Access-protected staging/candidate registration using the release-candidate
build, contracts, read-only roles, and pinned production-like generation. The
candidate tool is absent from the public manifest and public WebMCP registration.
After all applicable receipts pass, one promotion changes the public capability
manifest and feature flag. Thus machine-interface tests for `plan_research` are
preconditions to public enablement, not requirements that assume it is already
public.

## 16. Public coverage accounting

### 16.1 Coverage is not one status

Track orthogonal axes:

- Milestones: discovered, ingested, normalized, schema-indexed, search-indexed.
- Inclusion: included, excluded, quarantined, review-pending.
- Pipeline: healthy, pending, retrying, dead-letter.
- Freshness: fresh, stale, unknown, not-applicable.
- Access: current pass, current typed failure, check-stale, never-checked.
- Identity: resolved, candidate, conflict, review-pending.

An indexed asset can also be stale and have a failed refresh. These metrics do
not form one mutually exclusive pie.

### 16.2 Metric contract

Every public metric includes:

- Metric ID and version.
- Counting unit.
- Numerator count and executable definition version.
- Denominator count and definition.
- Rate, or `null` when no honest denominator exists.
- Denominator status: known, estimated, or unknown.
- Unknown and not-applicable counts.
- As-of time and reporting window.
- Registry, source-scope, policy, connector, and index revisions.
- Cohort filters.
- Membership-manifest hash.
- Non-additivity/overlap note.

The coverage contract defines controlled cohort dimensions for connector and
connector version, source/platform, authority level, jurisdiction, subject,
asset type, access class, format/schema eligibility, cadence, identity state,
first/last-seen bands, and stage/failure/exclusion state. A rate may filter only
on dimensions known at or before its measured stage. If a downstream
classification is not yet known upstream, the member remains in an explicit
`unclassified` bucket rather than disappearing from the denominator.

### 16.3 Required denominators

| Metric | Unit | Numerator | Denominator |
|---|---|---|---|
| Configured scope status | Connector scope | Scopes in each mutually exclusive registry state | All configured scopes under the same registry revision |
| Harvest completion | Connector scope | Due scopes with a complete persisted enumeration | Active non-excluded scopes due in the window |
| Discovered inventory | Native item | Distinct source/native IDs observed | Absolute count; source-reported total only when authoritative and complete |
| Revision ingestion | Native item revision | Raw revisions durably captured | Revision observations emitted by the same bounded runs |
| Normalized outcome | Native item revision | Revisions mapped to canonical IDs | All ingested revisions in the same bounded runs |
| Canonical assets | Asset | Current canonical assets | Absolute count only |
| Canonical releases | Release | Current canonical releases | Absolute count only |
| Canonical families | Family | Current canonical families | Absolute count only |
| Schema-indexed | Release/distribution | Current parsed schema acknowledged by the field index | Current schema-eligible release/distributions |
| Search-indexed | Asset | Current projection acknowledged by active generation | Normalized inclusion-approved current assets |
| Current-check coverage | Endpoint/check target | Targets with non-expired observations | All active targets governed by that exact check policy |
| Due-check timeliness | Scheduled check target | Due targets attempted within the policy grace interval | Active targets due under that policy in the window |
| Check pass | Checked target | Current checks that passed | Targets checked within the SLA |
| Stale | Named layer/unit | Units past policy-derived `stale_at` | Freshness-assessable active units at the same layer |
| Failed | Stage work item | Terminal/dead-letter work items | Work items attempted at that exact stage/window |
| Overdue/not started | Scheduled work item | Due work items not attempted within policy | Work items due at that exact stage/window |
| Excluded native items | Native item | Explicit native-item policy exclusions | Native items evaluated by the same policy/version |
| Excluded canonical assets | Asset | Explicit asset-level policy exclusions | Assets evaluated by the same policy/version |

Never divide native records by canonical assets or fields by distributions.
Confirmed duplicates are not normalization failures. Exclusions remain visible
in upstream denominators so policy changes cannot manufacture better rates.

The normalized-outcome denominator must reconcile as a complete partition:
`normalized + pending + failed + excluded + not_applicable + unknown = ingested`.
USHSO may additionally publish a clearly labeled **eligible-only normalization
rate**, but it is conditional and cannot replace the all-ingested outcome view.
Likewise, current-check coverage and due-check timeliness remain separate: a
target can have a current observation without being due in this window, or be
due and attempted while its new result is still pending.

Configured scope status must reconcile
`active + paused + excluded + retired + unassessed = configured`. Harvest
completion is a conditional operating rate over the active due subset; its
public display always sits beside the full scope-status partition so pausing or
excluding a scope cannot invisibly improve perceived program coverage.

### 16.4 Coverage UI

The public coverage page should contain five panels:

1. **Source operations:** configured scope-state partition, due, attempted,
   complete, `partial_unpublished`, optionally degraded published, and failed.
2. **Native inventory:** distinct discovered/current native items and the
   completeness status of each source enumeration.
3. **Revision-processing funnel:** observed revisions → captured revisions →
   normalized/pending/failed/excluded/not-applicable/unknown revisions, using
   one revision unit and bounded run cohorts.
4. **Canonical inventory:** sources, assets, families, releases,
   distributions, documentation, fields.
5. **Operational health:** search-indexed, schema-indexed, check-current, stale,
   retrying, failed, excluded, and review-pending.

Every ratio displays `n of d`, the unit, as-of time, and “Why this denominator?”
Definitions. Unknown and not-applicable states remain visible.

Revision rates from partial or incomplete enumerations are labeled **observed
processing yield**, never source-inventory completeness. Only a sealed complete
enumeration with an admissible source total may support an inventory-completeness
claim.

The state/federal matrix is part of this coverage system, not a separate
marketing artifact. It must be generated from registry scopes and coverage facts.

## 17. Security, privacy, and access control

### 17.1 Network and capture safety

- Allowlist source hosts and validate every redirect.
- Block private, loopback, link-local, metadata-service, and unapproved IP ranges.
- Bound bytes, decompressed bytes, redirects, duration, pages, and content types.
- Do not follow discovered links indiscriminately.
- Record terms/policy review per source configuration.
- Never store credentials in connector descriptors, queue messages, logs, or R2.

### 17.2 Least privilege

- Public Worker database role reads only published search/canonical views.
- Harvesting roles cannot publish an index generation.
- Projectors cannot make source-network requests.
- Review actions require authenticated, audited operations access.
- Production and staging bindings, databases, queues, buckets, and secrets are
  visibly distinct.

### 17.3 Query privacy

- Do not persist raw public research questions by default.
- Log request IDs, result state, latency, generation, and error class only.
- Do not use production questions for model training or benchmark tuning without
  a separately reviewed privacy change.
- Synthetic and frozen benchmark queries drive routine quality monitoring.

### 17.4 Source access

- Never submit registration, application, DUA, payment, or login flows.
- Never claim access authority from a documented recipe.
- Keep expected restriction outcomes separate from infrastructure or connector
  failures.
- Preserve untrusted-source text as data; it cannot instruct the planner or
  runtime.

## 18. Observability and operations

### 18.1 Structured event fields

Every pipeline event includes:

- `trace_id`
- `run_id`
- `workflow_instance_id`
- `event_id`
- `source_id`
- `endpoint_id`
- `connector_version`
- `stage`
- `attempt`
- `outcome`
- `duration_ms`
- `rows_or_bytes`
- `error_class`
- `worker_version`

Never log raw source bodies, credentials, or public question text.

### 18.2 Required alerts

- Scheduler heartbeat missing.
- Due source overdue beyond grace policy.
- Queue oldest-message age beyond stage SLA.
- Any non-empty DLQ.
- Outbox oldest-pending age beyond SLA.
- Workflow errored or terminated.
- Connector paused for authentication or schema drift.
- Suspicious catalog-count collapse.
- Canonical-to-index lag or generation age beyond SLA.
- PostgreSQL connectivity, storage, backup, or PITR problem.
- R2 checksum/write failure.
- Public coverage snapshot reconciliation failure.
- Excluded/quarantined result leak.

### 18.3 Recovery controls

- Global scheduler enable/disable.
- Per-source pause.
- Per-stage Queue pause.
- Connector-version denylist.
- Index-publication freeze.
- Explicit replay mode preserving `replay_of` lineage.
- Immediate pointer rollback to previous generation.
- Static-corpus public fallback during the migration window.

### 18.4 Initial service objectives

These are provisional release thresholds. Before public cutover, ratify them
against a versioned workload manifest derived from privacy-safe current traffic,
expected growth, public/API/WebMCP route mix, cold/warm cache ratios, projected
asset/release/field cardinalities, plan complexity, and concurrent
harvest/normalize/project activity. Review them again after 30 days of measured
production load; weakening a threshold requires an explicit reliability decision.

| Objective | Initial target |
|---|---|
| Discovery API availability | 99.9% successful responses per valid request monthly |
| Record-search latency | p95 ≤ 600 ms; p99 ≤ 1.5 s |
| Bundle-plan latency | p95 ≤ 1.2 s; p99 ≤ 3 s |
| Canonical-to-index lag | 99% within 10 minutes; 99.9% within 30 minutes |
| Scheduler timeliness | 99% of due scopes start by `scheduled_at + max(15 minutes, 10% of configured cadence)` |
| Normalization timeliness | 99% of eligible revisions resolved within one hour |
| Coverage snapshot timeliness | Daily snapshot within two hours of cutoff, 99% monthly |
| Index consistency | 100% of eligible objects represented at promoted watermark |
| Visibility safety | Zero excluded/quarantined result leaks |
| Generation rollback | Previous generation restored within 15 minutes |
| Coverage reconciliation | 100% of stage partitions reconcile |

External endpoint pass rate is reported, not treated as an internal SLO.

## 19. Repository implementation shape

The exact directories may be adjusted during the first ADR, but the intended
separation is:

```text
contracts/
  core/v2.0.0/
  ingestion/v1.0.0/
  identity/v1.0.0/
  publication/v1.0.0/
  coverage/v1.0.0/
  research-plan/v1.0.0/
  machine-toolkit/v1.0.0/
db/
  migrations/
  seeds/
  queries/
packages/
  registry/
  connectors/
  ingestion/
  normalization/
  identity/
  search/
  coverage/
  planner/
  machine-toolkit/
services/
  scheduler-worker/
  harvest-worker/
  normalize-worker/
  projector-worker/
  ops-worker/
worker/
  public API and HTML delivery
```

### 19.1 Existing seams to preserve

- `createWorker` already accepts injected catalog/engine loaders; evolve this
  into repository/search/planner dependencies before changing behavior.
- Preserve `POST /api/discover`, `GET /api/catalog`, and stable dataset
  dereference contracts during the storage cutover.
- Keep a `StaticAssetCatalogRepository` adapter for tests and emergency rollback.
- Consolidate or explicitly pin the duplicated retrieval implementation before
  attributing result differences to storage changes.
- Retain deterministic fixtures and snapshot exports for offline evaluation.
- Replace client-side full-catalog facets and pagination with server-side cursor
  pagination and facet aggregates before catalog scale exceeds the current cap.

## 20. Work packages

### WP0 — Boundary, baseline, and ADRs

Deliver:

- Product-boundary ADR.
- Production-baseline receipt naming v1.1.0/157 as the migration seed and the
  separate 143-record evaluation corpus with its immutable hashes.
- Pre-tuning 157-record evaluator-v2 bridge run and attribution matrix.
- Exact versioned tester-feedback source copies plus a paragraph-to-requirement
  ledger with verified hashes, requirement IDs, owners, dispositions, and
  planned acceptance receipts.
- Contract/versioning ADR.
- Canonical identity/family/join semantics ADR.
- Cloudflare/PostgreSQL/publication ADR.
- Search backend benchmark decision record.
- Coverage denominator glossary.

Acceptance:

- No ambiguous “current corpus” wording remains between 143-record evaluation
  fixtures and 157-record production.
- Every accepted tester requirement has an owner, status, test ID, and receipt
  target; any rejection has product-owner rationale.
- Plan approval is blocked until both feedback source-copy hashes match and every
  paragraph is reconciled to an ID or explicit non-requirement rationale.
- Existing v1 contracts remain immutable.
- Non-goals are testable release invariants.

### WP1 — Repository abstraction

Deliver:

- `CatalogRepository`, `SearchBackend`, `CoverageRepository`, and
  `PlannerRepository` interfaces.
- Static adapters reproducing current behavior.
- Adapter contract tests running the Worker route suite against injected stores.

Acceptance:

- No public behavior change.
- Existing API, browser, WebMCP, tests, build, and dry-run pass.
- Static rollback remains deployable.

### WP2 — Contracts and semantic validators

Deliver production v2 core and v1 ingestion, identity, publication, coverage,
research-plan, and machine-toolkit packages, plus the frozen retrieval-evaluator
v2 metric/cohort manifest contracts required before WP8 tuning.

Acceptance:

- Schemas compile and reject unexpected properties.
- Valid and adversarial fixtures cover all states.
- Semantic validators reject evidence, access, temporal, identity, join,
  denominator, and plan overclaims.
- Retrieval metric formulas, gold-equivalence policy, corpus bridge matrix,
  present-source eligibility cohort, held-out split, and evaluator version are
  sealed before any retrieval tuning begins.
- CI runs every contract package, not only the current root subset.

### WP3 — PostgreSQL and Cloudflare foundation

Deliver staging/production PostgreSQL, roles, Hyperdrive bindings, private R2,
Queues/DLQs, Workflows, Cron, secrets, and observability through reproducible
configuration. Apply the registry, ingest-run/job, outbox, processed-event, and
durable-dead-letter migrations required by WP4; canonical catalog migrations may
follow in WP6. Include partition/index/autovacuum plans and archive/GC metadata
for every correctness ledger in section 9.11.

Acceptance:

- Public role is read-only and cannot access ingestion secrets.
- Staging/production resources cannot be confused.
- Cache-disabled correctness-sensitive reads pass.
- HA/failover, PITR, connection budget, RPO, and RTO are documented and a
  backup/restore and connection-failure rehearsal is measured.
- The pre-cutover workload manifest, PostgreSQL/Hyperdrive connection budget,
  storage/IO forecast, Queue throughput, and 2× capacity test are reviewed.
- A controlled direct-DB migration/maintenance path exists outside public Worker
  credentials.
- Correctness-ledger partitions and indexes pass production-volume lease,
  reconciliation, autovacuum, archive, and restore tests.

### WP4 — Scheduler, Workflow, outbox, and queues

Deliver due-source leases, run creation, deterministic Workflow IDs, barriers,
Workflow-start outbox/reconciliation, attempt mappings, outbox dispatcher,
processed-event guards, DLQ sink, source pause/drain, shared origin rate limiting,
replay, retention-boundary reconciliation, and audited correctness-ledger GC.

Acceptance:

- Repeated Cron slots create one run.
- Fault injection at commit/send/mark/ack boundaries creates one logical effect.
- A source reaches `paused` only after in-flight work drains or is durably
  re-ledgered; after that point it makes zero new fetches.
- Queue expiry can be recovered from the PostgreSQL job ledger.
- Retention/GC tests prove that no active replay, idempotency key, Workflow,
  rollback generation, evidence lineage, or audit dependency can be pruned.

### WP5 — Connector SDK and first protocol adapters

Deliver bounded HTTP, conditional requests, capture hashing, checkpointing,
fixture playback, contract harness, DCAT, CKAN, Socrata, and HTML inventory
connectors.

Acceptance:

- Mandatory connector fixture matrix passes.
- Interrupted pagination resumes without skips or logical duplicates.
- Every ingested item resolves to an exact source locator and R2 capture.
- The versioned endpoint/object allowlist, outbound-request ledger, and complete
  capture inventory reconcile; adversarial row-shaped/payload-sentinel fixtures
  are blocked before egress; zero capture is classified as a source-data payload
  or healthcare row response.

### WP6 — Canonical normalization and legacy import

Deliver database migrations, normalizers, canonical revisions, aliases, evidence
lineage, and an idempotent import of production corpus v1.1.0.

Acceptance:

- All 157 records and 14 legacy join routes have explicit mappings.
- Reimporting the same manifest creates no new logical rows.
- No silent identity merges occur.
- Database-generated v1 projections preserve stable IDs, access states,
  evidence, joins, warnings, and zero-result semantics.
- Import receipt reconciles every legacy object or explains rejection.

### WP7 — Identity, family, schema, and access enrichment

Deliver candidates, review decisions, families, schema snapshots/fields,
field-bound joins, transformations, access observations, Use Cards, and Access
Recipes.

Acceptance:

- Open candidates remain separately searchable.
- Only exact authoritative evidence auto-resolves identity.
- Reversing a review decision safely rebuilds projections.
- The sealed positive/negative identity benchmark passes section 23.9,
  including zero false automatic merges and complete reversal integrity.
- No route becomes documented without field-level evidence.
- Access freshness expires to stale/unknown, never silently remains current.

### WP8 — Search projections and quality

Deliver Postgres FTS/facets, projection types, generation lifecycle, indexed
hydration, intent decomposition, synonyms, authority priors, negative constraints,
near-miss detection, and graph expansion.

Acceptance:

- Public queries do not load JSONL or scan the full canonical inventory.
- Tuning cannot start without the WP2 evaluator/cohort freeze receipt.
- Deterministic rebuilds have identical checksums.
- A failed build leaves the previous generation live.
- Search quality passes the gates in section 23.
- Production-like query plans use intended indexes and meet latency targets.

### WP9 — Coverage and state/federal matrix

Deliver source scopes, denominator-bearing facts/snapshots, APIs, public coverage
panels, and a registry-derived state/federal matrix.

Acceptance:

- Every public rate exposes numerator, denominator, unit, definition, as-of time,
  and revisions.
- Unknown and not-applicable do not become success or failure.
- The 51/14/157 concepts are displayed as different, non-additive units.
- Navigation-only and evidence-gap jurisdictions cannot appear integrated.
- Every jurisdiction/source-class cell has exactly one canonical
  `coverage_cell_state`.

### WP10 — Research-plan vertical slice and planner evaluator

Deliver in two ordered subpackages. WP10A migrates the planner benchmark, freezes
its dev/validation/held-out manifest, evaluator extension, strata, denominator
floors, and numeric thresholds. Only after the WP10A receipt may WP10B implement
the effective evidence snapshot, deterministic planner, and PA fixture against
the strict plan contracts.

Acceptance:

- Human and JSON critical claims are identical.
- Plan output is deterministic and evidence-complete.
- Zero tolerance for time, access, join, identity, authorization, or analytics
  overclaim.
- PA finance/utilization case returns an honest constrained plan with exact
  assets, releases, distributions, access routes, requirements, and blockers.
- Stateless clarification round trips and generation changes pass their contract
  tests without raw-question persistence.

### WP11 — Public API, UI, and plan surface

Deliver `/api/plan`, contract endpoint, explicit Plan UI, JSON export,
researcher decision summaries, and coverage labels.

Acceptance:

- Browse never generates a plan.
- Plan mode separately displays operation kind, evidence state, compatibility,
  crosswalk/aggregation requirements, and unresolved blockers.
- Existing v1 clients remain compatible.
- All plan states pass accessibility and responsive tests.

### WP12 — WebMCP and machine toolkit

Deliver machine-toolkit contracts, shared canonical service methods, JSON API
routes, `registerObservatoryToolkit`, tool manifest, Agents documentation,
`llms.txt` capability links, and the phased inspection/planning tool set.

Acceptance:

- Search returns bounded summaries and `get_asset` performs explicit
  dereference.
- Access, retrieval, variables, joins, comparison, coverage, and plan tools have
  semantic and critical-field parity with REST and UI over shared services.
- All tools are read-only, preserve untrusted-content annotations, and perform no
  source-network or payload actions.
- Every tool input/output is bounded, generation-pinned, abortable,
  schema-valid, redacted, and carries the common zero-action truth boundary.
- Search-to-plan workflow tests pass with at most one broad search, followed by
  stable-ID operations.
- WebMCP and API manifests agree; `/agents`, `llms.txt`, and human docs point to
  and accurately describe the same active toolkit version.
- Current `discover_sources` compatibility behavior is documented and tested.

### WP13 — Web discoverability

Deliver SEO projections, crawlable dataset HTML, record sitemap generation,
canonical metadata, JSON-LD/DCAT, alias redirects, and crawler tests.

Acceptance:

- A no-JavaScript crawler can read every public dataset page.
- Sitemap contains every public stable record URL and no excluded/quarantined
  object.
- Record titles/descriptions and canonical URLs are specific and correct.
- Structured data validates against supported schema.org/DCAT expectations.
- SEO and API content use the same published generation.

### WP14 — Production cutover and retirement

Deliver shadow comparison, canary reads, gradual public promotion, rollback
receipts, soak, and eventual removal of runtime JSONL loading.

Acceptance:

- At least two connector refresh and two full index rebuild/promotion cycles pass.
- Static fallback and generation rollback are rehearsed.
- Public coverage and search gates pass under production-like load.
- Static JSONL becomes a fixture/export format, not the production store.

## 21. Delivery phases and sequencing

The estimates below assume two to three engineers plus an engaged product owner.
They are planning ranges, not commitments. Connector breadth can continue after
the initial product launch.

| Phase | Indicative duration | Primary work | Exit condition |
|---|---:|---|---|
| 0. Decisions, contracts, and evaluator freeze | 2–3 weeks | WP0 + WP2 | ADRs/contracts complete; 143/157 bridge receipt and retrieval evaluator/cohorts frozen |
| 1. Compatibility seam | 1–2 weeks | WP1 | Static adapter passes all current behavior |
| 2. Platform foundation | 2–4 weeks | WP3–WP4 | Durable run/outbox/queue foundation passes fault tests |
| 3. Legacy parity | 2–3 weeks | WP6 + WP8 projection scaffolding (no tuning) | Registry can regenerate v1 behavior and accepted snapshot |
| 4. Federal and state connector canaries | 3–6 weeks | WP5 + Wave 2 federal subset + Wave 4 state-platform subset | Two full scans and one incremental cycle per federal/state canary |
| 5. Identity/schema/coverage | 3–5 weeks | WP7 + WP9 | Review, field, access, and honest public coverage ready |
| 6. Search shadow and canary | 3–4 weeks | WP8 + WP14 shadow/canary stages | Quality, latency, parity, promotion, rollback gates pass |
| 7. Planner vertical slice | 3–5 weeks, overlaps phases 4–6 | WP10 | PA plan and evaluator pass safety/usefulness gates |
| 8. Product beta | 2–3 weeks | WP11–WP13 + WP14 beta cutover | Plan UI/API, eligible machine tools, crawler pages, coverage messaging pass |
| 9. Soak and runtime retirement | At least the defined rollback window | WP14 completion | Operational soak passes; runtime JSONL retires with rollback receipts |
| 10. Expansion beyond approved canaries | Ongoing | Remaining Connector Waves 3–6 | Source-by-source promotion and state-matrix expansion beyond the launch canaries |

### 21.1 Critical path

The platform critical path is:

`boundary/contracts → repository seam → PostgreSQL/control plane → legacy import → search shadow → read cutover`

The product-value critical path is:

`effective evidence snapshot → plan contracts → benchmark migration → deterministic planner → API/UI beta`

These paths should run in parallel after contracts stabilize. Full national/state
connector breadth is not required to prove the planner, but the planner must
disclose the exact coverage scope of the generation it uses.

### 21.2 Work that may safely run in parallel

- Connector fixture capture and SDK contract design.
- Research-plan schema and benchmark migration.
- SEO projection and crawler-test design.
- Result-card simplification completion.
- State/source-scope registry curation.
- Infrastructure-as-code and local database harness.

### 21.3 Ordering hazards

- Do not build plan UI before the canonical plan contract is stable.
- Do not calculate common coverage before temporal precedence and fiscal/calendar
  semantics are defined.
- Do not tune against the held-out benchmark split.
- Do not let benchmark gold artifacts enter production runtime.
- Do not introduce database/search and retrieval-algorithm changes in one
  unmeasured cutover.
- Do not broaden connector scope before pause, retry, DLQ, and denominator
  accounting work.
- Do not retire the static path before both generation rollback and static
  fallback are rehearsed.
- Do not claim national/state completeness based on registry cells that are only
  navigation candidates.

## 22. Testing strategy

### 22.1 Contract and semantic tests

- JSON Schema compilation and valid/invalid fixtures.
- Referential integrity across evidence, assertions, objects, fields, joins,
  recipes, and plans.
- Supersession-cycle and temporal-history tests.
- Access-state and authorization-boundary tests.
- Coverage unit/denominator tests.
- Plan operation/acquisition graph tests.

### 22.2 Connector tests

- Pure parser/normalizer/checkpoint unit tests.
- Common adapter contract suite.
- Recorded HTTP playback with exact request matching.
- Duplicate, out-of-order, clock-skew, and crash-point property tests.
- 304, pagination, cursor expiry, 429, transient failure, schema drift, redirect,
  auth, size, and deletion fixtures.
- Separate 404/410 fixtures for catalog root, collection/list, pagination cursor,
  exact item, distribution, and documentation targets, including checkpoint/seal
  assertions.
- Bounded live metadata-only smoke outside PR CI.
- Live shadow and source-by-source canary promotion.

### 22.3 Database and control-plane tests

- Clean migrations and N−1 upgrades.
- Unique constraints and idempotent replays.
- Transactional outbox crash matrix.
- Queue redelivery and DLQ persistence.
- Workflow resume and barrier behavior.
- `partial_unpublished` versus `succeeded_with_optional_degradation` barrier
  fixtures; no incomplete generation can become active.
- R2 orphan and checksum behavior.
- PostgreSQL outage and recovery.
- Backup/restore rehearsal.

### 22.4 Search tests

- Projection schema, references, visibility, and checksum tests.
- Full build versus incremental convergence.
- Family-collapse and unresolved-candidate separation.
- Field-level CCN/EIN/NPI/FIPS discovery.
- Authority, negative-constraint, near-miss, and access-gate tests.
- Exact temporal and partial-coverage tests.
- Query-plan and production-like load tests.
- Generation promotion and rollback.

### 22.5 Planner tests

- Single-source, multi-source, clarification, incomplete, and unsupported states.
- One source satisfying multiple roles.
- Exact asset versus family identifier.
- Public metadata versus restricted data.
- Facility versus system grain.
- Fiscal versus calendar period.
- Union coverage incorrectly presented as common coverage.
- Candidate join incorrectly upgraded.
- Crosswalk versus aggregation confusion.
- Current identity snapshot incorrectly used historically.
- Non-additive measures and unsafe aggregation.
- Access workflows with applications, fees, DUAs, and human gates.
- Prompt-like untrusted source metadata.
- Human/JSON parity and deterministic digest stability.
- No-analysis-boundary compliance.

### 22.6 UI and crawler tests

- Result-card decision hierarchy and bounded-count language.
- Coverage matrix preserves all seven canonical `coverage_cell_state` values.
- Detail-page researcher summary and exact verification labels.
- Plan states, JSON export, keyboard access, and responsive behavior.
- No-JavaScript dataset-page crawl.
- Sitemap membership and structured-data validation.
- Canonical alias and withdrawn-record behavior.

### 22.7 WebMCP and machine-interface tests

- Per-tool input/output schema fixtures and structured-error fixtures.
- API/WebMCP critical-field and decision parity from the same service call and
  generation, allowing adapter-specific envelopes.
- Registration/unregistration of the enabled toolkit with one AbortSignal.
- Caller abort propagation.
- Browser modules contain no Node-only imports.
- Per-tool input, cardinality, serialized-byte, truncation, and cursor-bound
  tests for all nine capabilities.
- Variable and catalog cursor/generation-expiry tests.
- API and WebMCP generation-pin, pointer-flip, 30-minute cursor, 24-hour
  clarification, 48-hour retired-generation retention, and restart-required
  tests.
- `search → get_asset → get_access_plan/get_variables/get_join_routes → plan`
  composability scenario with at most one broad search.
- Stateless signed clarification-token round trips, tamper/expiry/key rotation,
  stale generation, changed request hash, and idempotent resubmission.
- Restricted access never becomes authorization or execution.
- Coverage unknown state prevents absence claims.
- Comparison is metadata-only and never ranks analytical performance.
- No tool invokes an authoritative source or downloads a payload.
- Truth-boundary and secret/cookie/signed-URL redaction fixtures for every tool
  and structured error.
- Public non-resolution fixtures prove unknown, excluded, quarantined,
  withdrawn, and private IDs are indistinguishable.
- Generated-schema audit rejects any unbounded nested input/output property and
  reconciles every limit with the published manifest.
- Executable manifest parity across WebMCP and API contracts; `/agents`,
  `llms.txt`, and human docs accurately link to the same active version.

### 22.8 CI/release gate expansion

The root test chain must include:

- Core v2 and all new contract suites.
- Connector contract suites.
- Database migration/integration tests.
- Search projection and benchmark evaluation.
- Planner harness and safety checks.
- Machine-toolkit contract and parity suites.
- Worker contract tests against static and database-backed adapters.
- Web tests, build, Cloudflare dry run, release audit, and crawler smoke.

Keep live source calls out of ordinary CI.

## 23. Quality and release gates

### 23.1 Retrieval gate

On the frozen benchmark, using development and validation splits for tuning,
publish two non-interchangeable cohorts:

1. **Full benchmark:** every gold requirement remains in the denominator,
   including sources the pinned corpus or generation lacks. The historical lane stays directly comparable to
   the published 0.50 must-not-miss recall@10 baseline.
2. **Frozen present-source cohort:** before tuning, seal a manifest classifying
   every gold source/role as present and search-eligible, present but excluded,
   or missing, with a reason and registry/index pin. No item may be reclassified
   merely to improve a score. The primary present-source metric denominator
   contains only `present + search_eligible` requirements; present-but-excluded
   and missing requirements remain in separately reported outcome partitions.

Evaluator v2 freezes metric semantics before tuning. For an eligible question
`q`, essential recall@`k` is `|gold_q ∩ returned_q[1..k]| / |gold_q|`; macro
recall is the unweighted mean across eligible questions and micro recall is the
ratio of summed hits to summed gold requirements. The published 0.50 baseline
and release target use **macro** recall; micro recall is also reported to expose
large-gold-set weighting. Questions with no essential gold source are excluded
from recall, counted as `null_gold`, and evaluated in the scoped-zero/abstention
suite. Returning fewer than `k` items supplies fewer chances for recall and, for
strict precision, missing slots count as nonrelevant: strict precision@`k` is
`relevant_hits / k`. Graded acceptable-source precision uses frozen gains and
also divides by `k`; it is labeled separately and never substituted for strict
precision. Gold equivalences, role weights, partial credit, duplicate-family
handling, prohibited results, and evaluator version are sealed in the cohort
manifest.

Release targets:

- The exact 143-record historical bridge lane does not regress below its 0.50
  must-not-miss recall@10 under the pinned evaluator, while the separately
  labeled current-generation full benchmark reaches at least 0.65 before plan
  beta. This is an end-to-end product target, not an algorithm-only comparison.
- Full-benchmark must-not-miss recall@3 ≥ 0.45 and acceptable-source coverage@3
  ≥ 0.40, each improving by more than 0.10 absolute over the historical
  0.331349/0.288462 baselines.
- Frozen present-source essential recall@10 ≥ 0.90.
- Frozen present-source essential recall@5 ≥ 0.80.
- Frozen present-source essential recall@3 ≥ 0.70.
- Frozen present-source graded acceptable-source precision@5 ≥ 0.70 under the
  sealed gain table; strict exact-gold precision@5 is reported separately and
  must not regress from the frozen pre-tuning bridge run.
- Frozen present-source required multi-source role coverage ≥ 0.90.
- Prohibited-by-access recommendations = 0.
- Unsupported join upgrades = 0.
- Unresolved identity presented as exact = 0.
- Zero-result absence claims = 0.
- Every top-five result includes a defensible match reason or an explicit
  near-miss label.

Run the sealed held-out 20 questions only at the final gate. Threshold changes
require a reviewed decision and cannot be tuned after seeing held-out results.
Every score must publish its numerator, denominator, cohort-manifest hash, corpus
or index generation, evaluator version, macro/micro designation, `null_gold`
count, short-list count, and missing/excluded breakdown.

### 23.2 Planner safety gate

Zero tolerance for:

- Time-coverage overclaim.
- Access or authorization overclaim.
- Candidate join upgraded to documented/proven.
- Identity uncertainty presented as equality.
- Grain change without an explicit aggregation step.
- Missing human authorization gate.
- Unsupported analysis labeled supported.
- Family/source identifier used where an executable asset is required.
- Dataset rows, computed values, rankings, or analytic results in the plan.

The contract ships a versioned JSON-Pointer claim manifest. “Auditable plan
claims” includes every truth-bearing field under `interpreted_need`,
`asset_contributions`, `bundle_assessment`, `operations`, `acquisition_plan`,
`downstream_handoff`, `important_limitations`, `unresolved_gaps`, and
`conditions_not_recommend`. “Critical claims” is the frozen subset containing
status/reason codes, essential roles and exact IDs, requested/source/common
coverage, access class/requirements/human gates, operation kind/evidence/
compatibility/requirements/blockers, downstream support classification, and the
truth boundary. Adding a truth-bearing field requires updating this manifest and
its fixtures; otherwise schema validation fails.

Also require:

- 100% schema validity.
- 100% of auditable plan claims backed by resolvable evidence that is admissible
  for the claim, current under policy, and reviewed where required, with
  observation time, evidence state, staleness, and derivation lineage.
- Every ready recommendation resolves exact assets, releases, distributions,
  and access routes; family- or source-level placeholders force a constrained,
  incomplete, or clarification state.
- Identical canonical plan payload and digest on repeat execution, excluding
  declared transport fields.
- Acyclic operation and acquisition graphs.
- Human/JSON parity for all critical claims.

### 23.3 Planner usefulness gate

The following release targets must be ratified and frozen in the WP10A manifest
before planner implementation or tuning:

- Plan-status accuracy ≥ 95%.
- Plan-status reason-code/precedence accuracy ≥ 95%.
- Essential-role recall ≥ 95%.
- Exact-asset precision ≥ 90%.
- Exact release/distribution/access-route accuracy ≥ 95%.
- Measure-to-source binding accuracy ≥ 90%.
- Common-coverage exactness ≥ 95%.
- Essential operation-kind/evidence/compatibility accuracy ≥ 95%.
- Requirement and blocker completeness ≥ 95%.
- Acquisition-DAG step, order, stop-condition, and human-gate accuracy ≥ 95%.
- Unnecessary-source rate ≤ 10%.
- Clarification completeness ≥ 95%.

Before implementation tuning begins, evaluator v2 must freeze the formula,
allowed tolerance, severity/partial-credit rules, required question strata, and
minimum denominator for every planner measure. Publish overall and per-stratum
numerators/denominators; a target cannot pass on the overall score if any
safety-critical stratum lacks its minimum sample or breaches its declared floor.
Thresholds alone are not an evaluator contract.

The planner benchmark manifest separately hashes development, validation, and
held-out questions, gold statuses/reason codes, required asset contributions,
operations, blockers, coverage, and acquisition DAGs. The held-out set contains
at least 30 questions and at least 10 eligible cases in every safety-critical
stratum, expanding the set when needed rather than waiving the floor. Product,
research-methods, and engineering owners ratify numeric thresholds and stratum
floors before WP10B.

The final held-out set runs once per release candidate after code, prompts (if
ever allowed), policies, thresholds, and evaluator are frozen. Item-level
held-out judgments may not be used for tuning. A failed run remains published
and blocks release; another tuned attempt requires a new versioned replacement
hold-out assembled independently, while the contaminated set remains an
audit-only regression lane. Thresholds may not be lowered after either result.

### 23.4 Coverage gate

- Every rate has a numerator, denominator, unit, definition, timestamp, and
  revision pins.
- Stage partitions reconcile exactly.
- Unknown/not-applicable never fold into pass/fail.
- Connector failures remain in due-source denominators.
- Exclusions remain visible in upstream denominators.
- Multi-jurisdiction and aggregator overlaps are visibly non-additive.
- Failed enumeration never creates a zero-item absence claim.
- State/federal coverage wording passes product-owner review.

### 23.5 Publication and runtime gate

- All eligible public objects have acknowledged current projections.
- All projection references resolve.
- Zero excluded, quarantined, or tombstoned objects are returned.
- Two full builds from the same watermark have identical checksums.
- Incremental updates and full rebuild converge.
- Index rollback and static fallback both pass.
- A production-like 30-minute test at 2× the versioned workload-manifest peak,
  including route mix, cold/warm caches, maximum planned cardinality, and
  concurrent connector/projector load, remains within latency, error,
  connection, Queue-age, and resource-headroom SLOs.
- Existing v1 contracts remain valid until explicit deprecation.
- No raw query persistence is introduced.
- Every accepted tester-feedback requirement ID is `verified` with its named
  receipt, or is formally `rejected` with recorded product-owner approval.

### 23.6 Web discoverability gate

- Every public dataset page is readable without JavaScript.
- Every public stable URL appears in the current sitemap.
- Dataset-specific title, description, canonical URL, and structured data are
  present and valid.
- Excluded/quarantined records do not leak through HTML or sitemap.
- HTML, JSON API, and search result share one publication generation.

### 23.7 Machine-interface gate

- Every public WebMCP tool maps to one canonical service and JSON API contract.
- Every returned factual field and derived decision resolves to in-generation
  evidence/policy, observation time, evidence state, staleness, and derivation;
  every tool returns the complete truth-boundary object.
- All enabled tools register and unregister cleanly in a WebMCP-aware browser.
- Every tool enforces its declared input, cardinality, and serialized-output
  bounds and emits valid truncation metadata.
- Stable IDs support search-then-dereference without repeated broad search.
- GET/POST API and WebMCP adapters honor identical generation pins; cursors and
  clarification references remain usable through their declared TTL across a
  publication flip or return `restart_required` without silent repinning.
- The representative `search → inspect → compare/plan` workflow performs at
  most one broad search; all later operations use stable IDs and pinned
  generations.
- Access and retrieval tools declare that no authorization, request, or download
  was performed.
- Join output preserves `operation_kind`, evidence state (including candidate,
  documented, ambiguous, and unknown), compatibility (including conditional,
  incompatible, and unknown), requirements such as a crosswalk, and blockers as
  separate fields.
- Coverage output includes denominator and absence-claim permission.
- Comparison never contains source-data values or analytical rankings.
- Clarification round trips transition deterministically to ready/incomplete or
  return a typed generation error without persisting the raw question.
- Plan tool is not enabled until every prerequisite gate named in section 15.6
  passes.
- API, WebMCP, Agents documentation, and `llms.txt` advertise the same current
  toolkit version.

### 23.8 Security and privacy gate

- SSRF fixtures cover host allowlists, redirect revalidation, DNS rebinding,
  private/loopback/link-local/metadata addresses, protocol/content-type limits,
  response-byte limits, decompression bombs, and timeouts.
- Public API, WebMCP, HTML, errors, logs, traces, R2 metadata, and coverage
  receipts contain no credentials, cookies, authorization headers, signed URLs,
  private locators, or secret-bearing query parameters.
- Production binding and database-role tests prove least privilege for public,
  scheduler, harvest, normalize, projector, and operations components.
- Telemetry/storage audits prove that raw public questions and user identifiers
  are absent by default, including error and distributed-trace paths.
- Prompt/tool-poisoning fixtures prove that untrusted source metadata cannot
  alter maintained tool text, schemas, truth-boundary fields, routing, or planner
  instructions.
- Clarification tokens contain no raw question/user identifier, reject tampering
  and expiry, and use a separately scoped, rotated signing key that never appears
  in logs, responses, or non-secret bindings.
- Public tools and routes enforce documented request size, concurrency, rate,
  and abuse controls without treating throttling as source absence.
- Egress-deny tests and request counters prove that public API/WebMCP calls make
  zero authoritative-source requests, acquire zero payloads, submit zero access
  workflows, and perform zero identity merges or analysis.

The release receipt records the tested Worker versions, roles/bindings, egress
policy, redaction policy, fixture set, and zero-action counters.

### 23.9 Identity-resolution gate

A sealed, versioned benchmark must contain adjudicated positive pairs, hard
negative pairs, temporal identity changes, parent/campus/system cases, and
source-native identifier conflicts. Release requires:

- Each launch-critical auto-resolution rule/namespace stratum has at least 50
  adjudicated positive and 50 hard-negative pairs plus 20 temporal/reuse/conflict
  cases. If a stratum cannot meet the floor, auto-resolution for that rule stays
  disabled and emits candidates only.

- Zero false automatic merges on the negative set.
- Candidate-generation recall ≥ 95% on eligible positive pairs, reported by
  identifier/entity stratum.
- No candidate or unresolved relationship presented publicly as equality.
- Unresolved and review-pending rates reported with explicit denominators.
- Double-review agreement ≥ 90% and Cohen's kappa ≥ 0.80 on the audited sample,
  which contains at least 100 pairs or the entire eligible set when smaller; an
  approved replacement agreement statistic must be fixed before review.
- 100% reversal integrity: superseding an accepted decision deterministically
  rebuilds clusters, search projections, joins, and plan fixtures without data
  deletion or orphaned lineage.

## 24. Migration, cutover, and rollback

### Stage 1 — Expand

- Add repository interfaces, contracts, migrations, Cloudflare resources, and
  Workers without changing public reads.
- Keep all changes backward compatible.

Rollback: deploy the unchanged static Worker.

### Stage 2 — Backfill

- Import production corpus v1.1.0, live verification evidence, Use Cards, Access
  Recipes, vocabulary, and join routes.
- Preserve aliases and unresolved states.
- Generate an import receipt.

Rollback: mark the import batch rejected and rebuild only its isolated staging
schema/tables or batch-owned canonical proposals. Never discard shared database
state; preserve run, outbox, audit, evidence, and R2-capture references. Public
reads remain static.

### Stage 3 — Shadow

- Run connectors into the ingestion and canonical stores.
- Build search/coverage generations without serving them publicly.
- Compare static and candidate behavior across fixtures and the benchmark.
- Shadow planner output on frozen/synthetic questions only.

Rollback: pause connectors/projectors; public remains static.

### Stage 4 — Canary

- Expose database-backed reads to internal traffic. If Cloudflare version
  overrides are used, the candidate version must first exist in the active
  deployment (normally at 0% traffic).
- Exercise an override only through an Access-protected internal hostname,
  authenticated facade/service binding, or equivalent control that injects the
  version selection after authorization. Do not let an untrusted request to the
  public hostname select a 0% candidate by supplying an override header.
- Canary dataset detail, then browse, then discovery, then plan.
- Monitor contract errors, latency, visibility, result quality, and generation
  consistency.

Rollback: switch repository feature flag or Worker version to static.

### Stage 5 — Public cutover

- Promote the database-backed Worker gradually.
- Retain the complete N−1 rollback bundle: prior Worker/version, every referenced
  binding and physical R2/KV/Queue/DLQ/Workflow resource, compatible additive DB
  schema, immutable assets, publication manifest/generations, and static
  emergency artifact.
- Keep v1 response translation active.
- Select and test one skew-proof asset strategy: request-level Cloudflare Worker
  version affinity across HTML and hashed-asset fetches (using a controlled
  `Cloudflare-Workers-Version-Key` flow), a shared superset of immutable N−1/N
  assets, or static assets served outside the split Worker.
  Merely packaging compatible assets with each Worker version is insufficient
  because gradual-deployment routing is evaluated per request.
- Gate the deployment by fetching every HTML/manifest entry through each served
  Worker version and proving zero asset 404s for N−1→N navigation and cached HTML.
- Before promotion, test N−1 Worker code against the current additive database
  schema and bindings.
- Before any public database-backed traffic, complete measured managed-provider
  failover, Hyperdrive disconnect/reconnect, PostgreSQL PITR recovery into an
  isolated target, and emergency-static activation drills within the declared
  RPO/RTO.

The rollback support window begins with the first public database-backed canary
and ends no earlier than 30 days after 100% cutover **and** two complete launch
connector/reconciliation and index-publication cycles. During that window,
destructive schema changes and deletion/renaming of any N−1 binding or resource
are blocked by IaC/release policy. Rehearse N−1 rollback after every binding or
migration change; Cloudflare Worker rollback does not roll back bound storage.

Rollback is failure-specific:

- Bad search/coverage/SEO generation → publication-manifest pointer rollback.
- Bad Worker code → Worker version rollback with its compatible assets.
- PostgreSQL/Hyperdrive outage → deploy or switch to the co-resident immutable
  static emergency artifact.

Each rollback receipt pins old/new Worker version IDs, binding names and resource
IDs, database compatibility watermark, publication manifest/generations, asset
bundle, static export, support-window expiry, reason, operator, and verification
results. Worker rollback never claims to revert PostgreSQL or R2.

### Stage 6 — Soak

Require at least:

- The complete rollback support window defined in Stage 5.
- Two successful full index rebuild/promote/rollback drills.
- Two successful connector reconciliation cycles.
- No unresolved coverage reconciliation or visibility incident.
- Queue and outbox oldest age remain within SLO; every DLQ item and errored
  Workflow is resolved or explicitly quarantined/accepted with owner and review
  deadline.
- Managed PostgreSQL, backups/PITR, Hyperdrive connectivity, R2, and the static
  emergency artifact remain healthy and their alerts are exercised.
- No unresolved Severity 1 or Severity 2 security, privacy, correctness,
  availability, or visibility incident exists during the final soak interval.

### Stage 7 — Retire production JSONL

- Remove runtime static-corpus loading and production `stage:corpus` dependency.
- Retain immutable JSONL exports as fixtures, evaluation inputs, audit receipts,
  and disaster-recovery artifacts.
- Make generation rollback the normal recovery path.
- Retain a periodically rebuilt, deployable static emergency Worker artifact.
- Complete measured PostgreSQL PITR/failover and emergency-static activation
  drills before removing the old runtime loader.
- Verify the N−1 dependency bundle and correctness-ledger retention/archives are
  still inside policy before removal.

## 25. Risk register

| Risk | Impact | Control | Trigger for intervention |
|---|---|---|---|
| Product drifts into analytics | High | Contract-level truth boundary, no payload fields, safety tests | Any plan contains source-data measures, computed analytical results, rankings, or executed operations |
| Sparse coverage is mistaken for completeness | High | Explicit source scopes, state matrix, denominator UI | “51 jurisdictions covered” or unscoped completeness wording appears |
| Poor top results undermine trust | High | Dedicated retrieval workstream and top-three/top-five gates | Quality metrics miss gate or obvious asset appears below near misses |
| Identity false merge | High | Candidate graph, exact-only auto-resolution, reversible review | Any unresolved pair collapses in search/public IDs |
| Join feasibility overstatement | High | Field/release-bound routes and zero-tolerance gate | Candidate/crosswalk route is described as documented/proven |
| Stale/conflicting coverage | High | Four clocks, precedence rules, effective snapshot, unknown propagation | Common interval exceeds source-supported intersection |
| Access instructions imply authorization | High | Separate recipe/execution state and human gates | Restricted path presented as immediately downloadable |
| Queue duplication corrupts state | High | DB idempotency and outbox fault tests | Duplicate delivery creates duplicate canonical or projection effect |
| Partial enumeration causes false withdrawal | High | Sealed runs and consecutive-miss policy | Record disappears after incomplete/failed run |
| Parser drift pollutes catalog | High | Quarantine, circuit breaker, last-known-good generation | Unexpected count/schema/content shift |
| Search vendor/scale mismatch | Medium | `SearchBackend` abstraction and pre-cutover benchmark | Postgres misses latency/rebuild/load target |
| Benchmark leakage | Medium | Sealed held-out split and runtime import prohibition | Held-out content used during tuning |
| Search/canonical publication mismatch | High | Generation manifest and canonical revision hydration | HTML/API/search use different pins |
| Raw query/privacy leakage | High | No query logging, structured telemetry allowlist | Question text appears in logs/traces/storage |
| State connector program sprawls | Medium | Protocol-first waves and cell registry | New custom connector added before reusable protocol/policy fit |
| Web content remains uncrawlable | Medium | Server-rendered metadata, sitemap, crawler gate | JS-disabled crawl cannot read record content |
| WebMCP drifts from API behavior | High | One service layer, generated manifest, parity tests | Same request/generation produces different critical fields |
| Agent tools exhaust context | Medium | Summary-first search, bounded outputs, pagination | Tool response exceeds declared bounds or encourages repeated broad search |
| Static fallback becomes stale/unusable | Medium | Scheduled rollback drills and immutable exports | Fallback has not been exercised during release window |

## 26. Open decisions and deadlines

These decisions are intentionally not hidden in implementation:

| Decision | Default | Must be settled by |
|---|---|---|
| Managed PostgreSQL provider/region | First satisfy HA, residency, failover, PITR, and provider constraints; then measure and configure Worker Placement near the database for multi-query paths | Before WP3 |
| Search physical backend | PostgreSQL FTS/GIN first, external service only if benchmark requires | Before WP8 public build |
| Ops authentication | Cloudflare Access-protected internal routes | Before live shadow |
| Raw capture retention | Bounded by source/policy class; hashes and lineage retained longer | Before first live connector |
| Consecutive-miss withdrawal policy | Source-specific, never one incomplete run | Before first full reconciliation |
| State canary jurisdictions | Pennsylvania plus representative Socrata/CKAN/ArcGIS/weak-source cases | Before Wave 4 |
| Use Card/Access Recipe reviewer policy | Human-reviewed before recommendation eligibility | Before plan public beta |
| Plan prose assistance | Deterministic templates only in v1 | Revisit only after safety gates |
| WebMCP search tool transition | Prefer `search_assets`; retain tested compatibility for `discover_sources` | Before machine-toolkit v1 freeze |
| Default WebMCP tool count | Eight inspection tools; planner is a gated composed ninth capability | Before machine-toolkit v1 freeze |
| v1 deprecation timeline | No deprecation during initial cutover | After soak and client review |

## 27. Tester-feedback traceability

The two supplied pasted-text attachments are preserved as exact, versioned input
evidence in [`docs/feedback/v1.0.0/`](feedback/v1.0.0/README.md). The validator
recomputes their byte hashes, sizes, line and paragraph counts, ordered semantic
byte ranges, complete paragraph coverage, requirement mappings, owners, tests,
and receipt targets. The source-to-requirement audit passed with 156 literal
paragraphs, 21 topics, 14 accepted/planned requirements, and no rejected or
unreconciled content. Status values remain
`accepted|planned|implemented|verified|rejected`; a rejection requires rationale
and product-owner approval.

- **[Feedback A](feedback/v1.0.0/tester-feedback-a.txt):** tester corpus,
  coverage, retrieval, planning, identity, UX, and crawlability review supplied
  2026-08-30; source SHA-256
  `ed6fec06342115adbec816069381281890aed5ca2a27d4520f6b0f01aa434c17`.
- **[Feedback B](feedback/v1.0.0/tester-feedback-b.txt):** WebMCP
  composable-toolkit review supplied 2026-08-30.
  Source SHA-256
  `3b0270cb42ebc64bcbb89947b915dae9afb9730cc36846626a5262a354585163`.

The verified paragraph/topic reconciliation is: A1 corpus positioning →
TST-COV-01/02; A2 retrieval quality → TST-RET-01; A3 research evidence plan →
TST-PLAN-01; A4 identity → TST-ID-01; A5 practical fitness/access → TST-FIT-01;
A6 result-card hierarchy → TST-UI-01; A7 crawlability → TST-SEO-01; A8 current
trust boundary → TST-TRUST-01. B1–B2 small toolkit/search → TST-MCP-01/02;
B3 dereference → TST-MCP-01; B4 access plan → TST-FIT-01/TST-MCP-01; B5
retrieval recipe → TST-MCP-01/04; B6 variables → TST-MCP-01/02; B7 joins →
TST-ID-01/TST-MCP-01; B8 comparison → TST-MCP-01/03; B9 coverage →
TST-COV-02/TST-MCP-01; B10 composed plan → TST-PLAN-01/TST-MCP-01; B11 machine
readiness → TST-MCP-05; B12 shared API/WebMCP architecture → TST-MCP-03; and
B13 browser-native limitation plus end-state workflow → TST-MCP-01/03. The
machine-readable ranges and dispositions are in
[`reconciliation.json`](feedback/v1.0.0/reconciliation.json), and the passing
receipt is in
[`validation/validation-receipt.json`](feedback/v1.0.0/validation/validation-receipt.json).

| ID | Source | Testable requirement | Plan control | Owner / status | Acceptance test and receipt |
|---|---|---|---|---|---|
| TST-COV-01 | A | Public positioning states the 157-record composition and does not imply exhaustive national/state coverage | §§2, 15.1, 16; WP9 | Product + Data / planned | `coverage-positioning.contract`; `coverage-copy-v1` receipt |
| TST-COV-02 | A | Every jurisdiction/source-class cell distinguishes integrated, candidate, navigation-only, evidence-gap, inaccessible, unknown, and not-assessed states | Connector Wave 4; §16; WP9 | Data / planned | `state-matrix.accounting`; snapshot reconciliation receipt |
| TST-RET-01 | A | Full-benchmark recall/acceptable coverage at rank 3 reach 0.45/0.40, present-source recall@3 reaches 0.70, and the rank-5/10 gates pass under frozen semantics | §13.5; WP8; §23.1 | Search / planned | `retrieval-quality.v2`; evaluator/cohort receipt |
| TST-PLAN-01 | A | A multi-source question returns the smallest defensible evidence plan with exact distributions/routes, not a generic ten-result list | §14; WP10–WP11 | Product + Planner / planned | `planner-pa-vertical`; canonical plan/evidence receipt |
| TST-ID-01 | A | Entity resolution is conservative, reviewable, reversible, and never silently merges uncertainty | §11; WP7; §23.9 | Identity / planned | `identity-resolution-benchmark`; adjudication/reversal receipt |
| TST-FIT-01 | A | Details and plans answer “Can I use this?” with evidence-backed fitness, limits, and access steps | §12; WP7/WP11 | Research UX / planned | `researcher-fitness-decision`; 12-asset dual-review correctness receipt |
| TST-UI-01 | A | Result cards preserve a clear decision hierarchy without returning to the overloaded design | §15.2; WP11 | UX / planned | `result-card-decision-hierarchy`; DOM information-budget + timed researcher-task receipt |
| TST-SEO-01 | A | Every public stable dataset page is crawler-readable without JavaScript and appears in the pinned sitemap | §15.5; WP13; §23.6 | Web / planned | `crawler-record-pages`; sitemap/structured-data receipt |
| TST-TRUST-01 | A | Zero-result and coverage language describes reconnaissance scope, never exhaustive identification without a complete inventory denominator | §§5, 15.1, 16; §23.4 | Product / planned | `scope-language`; generation copy-audit receipt |
| TST-MCP-01 | B | An agent can search once, dereference stable IDs, inspect access/retrieval/variables/joins, compare, and optionally plan | §15.6; WP12 | Machine interfaces / planned | `machine-toolkit-composability`; workflow trace receipt |
| TST-MCP-02 | B | Every tool has enforced input, cardinality, byte, pagination, and truncation bounds | §§15.6.2–15.6.4; §23.7 | Machine interfaces / planned | `machine-toolkit-output-bounds`; per-tool boundary receipt |
| TST-MCP-03 | B | API and WebMCP share critical facts and decisions while docs remain non-executable discovery surfaces | §§15.6.5–15.6.7; WP12 | API + Web / planned | `machine-interface-parity`; conformance-manifest receipt |
| TST-MCP-04 | B | Public tool calls disclose and prove zero source request, authorization, retrieval, payload, analysis, or identity-merge action | §§15.6.2, 17; §23.8 | Security + Machine interfaces / planned | `machine-toolkit-zero-action`; egress/redaction receipt |
| TST-MCP-05 | B | Assets expose evidence-backed machine-readiness capabilities that can filter/prefer executable paths without an opaque quality score | §12.1; §15.6; WP7/WP12 | Metadata + Search / planned | `machine-readiness-classification`; capability-vector/evidence receipt |

## 28. Definition of done

This program is complete when:

- Connector-based harvesting is active for the approved federal and state canary
  sources, with a documented path for the remaining waves.
- PostgreSQL is the canonical and operational source of truth.
- R2 contains only bounded metadata/document evidence captures.
- Workflows, Queues, DLQs, outbox, retries, pauses, and recovery drills pass.
- Canonical Source, Asset, Release, Distribution, Documentation,
  SchemaSnapshot/Field, AccessRoute, and AccessObservation objects are live.
- Identity and family uncertainty remains reviewable and reversible.
- Search reads normalized indexed projections and no longer loads every record in
  a Worker.
- Retrieval quality meets the agreed top-three/top-five/top-ten gates.
- Coverage accounting exposes explicit units and denominators.
- The public state/federal matrix accurately distinguishes integrated,
  navigation-only, candidate, evidence-gap, inaccessible, unknown, and
  not-assessed states.
- Researcher-oriented fitness and practical access guidance are visible.
- `/api/plan`, the plan UI, and agent tool return the same evidence-bound plan.
- The composable WebMCP toolkit exposes bounded search, dereference, access,
  retrieval, variables, joins, comparison, coverage, and plan capabilities over
  the same canonical services as the API.
- Plans contain no source payloads or analytical outputs.
- Every stable dataset page is crawlable and included in the sitemap.
- Every accepted tester-feedback ID is verified with its named receipt or has an
  approved, recorded rejection.
- v1 compatibility, rollback, release, security, privacy, and performance gates
  pass.
- Runtime static JSONL has been retired only after the soak and rollback window.
