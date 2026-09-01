# USHSO ingestion contract v1.0.0

This immutable package defines the metadata-only source registry and ingestion
control boundary used by USHSO scheduler, Workflow, Queue, DLQ, capture, and
operations components. It is a wire/domain contract, not a database schema and
not permission to contact a source.

The package implements the decisions in the Research Navigator plan §§5–9,
WP2/WP4, and the accepted PostgreSQL/Cloudflare publication ADR. Every schema is
JSON Schema 2020-12, is compiled with strict Ajv settings, and rejects unexpected
properties. Semantic validation follows shape validation and returns stable
reason codes plus JSON Pointers without repairing truth-bearing input.

## Product and data boundary

Connectors may enumerate and capture bounded catalog metadata, documentation,
and schema descriptions. They may not acquire or embed source dataset payloads,
healthcare rows, query results, archive members, login/form responses,
credentials, cookies, authorization headers, signed query strings, or secret
values. A descriptor stores only a `secret://` or `cloudflare-secret://` locator.
Queue and outbox records contain safe IDs, cursor references, content-addressed
R2 keys, schema versions, and trace IDs—never source response bodies.

The validation receipt's zero-action counters are part of the truth boundary:
fixture validation makes no network requests, downloads no payload, captures no
row, submits no authorization, performs no identity merge or analysis, and
persists no question or secret value.

## Contract surface

- `source-descriptor.schema.json` freezes source policy, organization,
  host/redirect allowlists, labeled route templates, methods and parameters,
  target/content classes, explicit forbidden route classes, exact scope and
  denominator, native namespace, checkpoint/full-sweep policy, refresh and
  staleness policy, bounds, origin pacing/circuit policy, secret locator,
  capabilities, exclusions, legal review, retention, and source state.
- `harvest-plan`, `harvest-run`, `ingest-job`, `ingest-attempt`, and `checkpoint`
  separate scheduling, logical runs, delivery attempts, leases, retry budgets,
  per-run cursors, and committed connector checkpoints.
- `failure-policy` pins every typed failure disposition and all five stage retry,
  delay, transport-attempt, circuit-breaker, quarantine, and DLQ outcomes. A
  catalog/list/cursor absence fails enumeration while an admissible exact-target
  absence becomes a typed observation; terminal classes are never blindly
  retried.
- `capture-reference` represents only a confirmed private content-addressed R2
  metadata/document capture. It records redacted provenance, a safe response
  header allowlist, byte counts, raw and semantic hashes, exact evidence, and
  all four clocks. It never contains captured bytes.
- `metadata-fetch` models conditional HTTP. A `304 not_modified` result must
  contain a request validator, zero response/decompressed bytes, and an exact
  prior capture reference. A captured response is a bounded `200` with a new
  capture reference. Failures create neither.
- `event-ledger` defines transactional outbox, processed-event guards, durable
  DLQ incidents, and immutable replay lineage.
- `enumeration-control` defines population seals, required publication
  barriers, last-known-good behavior, and audited source pause/drain state.

## Exact state machines

Run happy path:

`scheduled → starting → enumerating → enumerated → normalizing → projecting → published → succeeded|succeeded_with_optional_degradation`

Active run states may terminate as `failed` or `cancelled`; enumerating through
projecting may become `partial_unpublished`. Terminal runs are immutable. An
operator recovery is a new `operator_replay` run with `replay_of_run_id`.

Jobs use `pending → leased → succeeded|retry_wait|quarantined|dead`. An expired
lease may return to `pending`; `retry_wait` may return only when due. Outbox
records mirror this with `published` instead of job success/quarantine. Source
control follows `active → pause_requested → draining → paused`, with explicit
`auth_blocked`, `schema_drift`, and terminal `retired` branches. `paused` means a
reconciled drain, zero in-flight work, and zero subsequent fetches.

The complete exact enums and positive/negative edges live in
`fixtures/state-transitions.json` and are checked against the semantic service.
Adding an enum value is a versioned breaking change.

## Idempotency, leases, attempts, and replay

Validators recompute these keys instead of trusting caller labels:

- run: `run:<endpoint>:<scheduled-slot>:<mode>:r<configuration-revision>`
- page: `page:<run>:<cursor-sha256>`
- normalize: `normalize:<capture-sha256>:<normalizer-version>`
- schema: `schema:<canonical-revision>:<recipe-version>`
- access: `access:<distribution>:<recipe-version>:<scheduled-slot>`
- projection: `projection:<canonical-id>:<revision-id>:<projection-version>`

A consumer effect is uniquely guarded by `(consumer_name, event_id)`. A second
delivery is safe only when its business-effect digest and effect key agree.
Lease effects are fenced by active run attempt and lease epoch. Direct Queue
retry cannot follow a committed effect. When a breaker opens, the job is
re-ledgered with `next_eligible_at`, its transaction commits, and the current
transport message is acknowledged. DLQ replay allocates new run/event IDs while
preserving the original dead letter, event, run, attempts, and retry policy.

Delivery-attempt limits are contract data: harvest page 6, normalization 5,
schema enrichment 4, access check 4, and projection 5. Cloudflare transport
`max_retries` is configured as one less than these total delivery attempts.

## Enumeration, checkpoints, and publication

Run-local cursors never become the committed checkpoint by implication. A seal
is valid only when all discovered pages/items are committed, no page DLQ or
cursor expiry exists, and population digest plus completeness evidence are
present. A checkpoint can commit only with that seal and durable downstream
outbox work in the same transaction.

`partial_unpublished` is never a partial publication. Publication requires
complete seals, the checkpoint/membership commit, terminal normalization or
exclusion for every observed revision, a sealed exact-revision W1 manifest,
every eligible projection acknowledgement, resolved references, checksums,
visibility, exact coverage reconciliation, and zero required DLQs. Any missing
barrier leaves `active_publication_id` equal to `last_known_good_publication_id`.
Optional degradation is limited to the four policy-authorized enrichment
classes named in the schema and must cite its policy version and affected ID.

## Four clocks

The capture envelope never substitutes one clock for another:

1. data coverage interval and calendar/fiscal semantics;
2. publisher release/modification time;
3. USHSO observation time;
4. system recording and supersession time.

Known values need evidence-bound fields; unknown and not-applicable states keep
their values null. System recording cannot precede observation, supersession
cannot precede recording, and a publisher timestamp never fills data coverage.

## Integrity and use

The manifest distinguishes exact file-byte SHA-256 from the package's
`ushso-canonical-json.v1` digest (UTF-8, recursively sorted object keys,
preserved array order, no transport exclusions). Those digests are intentionally
different claims and are never compared interchangeably.

Run from the repository root:

```sh
npm run manifest --prefix contracts/ingestion/v1.0.0
npm test --prefix contracts/ingestion/v1.0.0
npm run receipt --prefix contracts/ingestion/v1.0.0
npm run validate --prefix contracts/ingestion/v1.0.0
```

Consumers should import `tools/index.mjs` and call `validateIngestionRecord`
before applying a record, followed by `validateRecordSet` where cross-ledger
references or duplicate delivery matter. Existing v1 package bytes are immutable;
any semantic or valid/invalid-set change requires a new SemVer directory.
