# WP8 immutable search-generation verification

This package verifies the untuned WP8 successor scaffolding without changing the
WP1 static search seam, reading final-gate item content, applying a database
migration, contacting a source, or switching a public pointer.

Run `npm test --prefix verification/wp8/v1.0.0` for offline projection,
reconciliation, lifecycle, rollback, cursor, adapter, boundary, and static SQL
shape tests. Run `npm run validate --prefix verification/wp8/v1.0.0` to verify
the immutable evidence package and its file inventory.

The reviewed SQL at `packages/search/sql/0010_search_projection_schema.reviewed.sql`
is input to a later migration review. It must be integrated only after migrations
0004–0009 freeze, then exercised through clean-install and N-1 migration tests on
PostgreSQL 16+. Ordinary CI intentionally does not apply it.

## Truth and release boundary

Search documents are replaceable `source_of_truth=false` projections. Public
reads resolve the active publication pointer once through the cache-disabled
lookup and carry exact publication, W1, component-generation, and coverage pins
through candidate retrieval, cursor pagination, and canonical-revision
hydration. Search does not retrieve source payloads, execute analyses, merge
uncertain identities, calculate market share, or produce financial benchmarks.

The quality state is `FAIL_PRE_TUNING`. This package neither tunes ranking nor
opens held-out item content. The old v0.1.0 20-item split was already published
and evaluated and is audit-only. A separate independent owner must create and
seal a new 20-item gold package that has never been published or evaluated. Only
after ranking is tuned and frozen may an explicitly authorized evaluator obtain
one single-use lease. The guard accepts and records only an aggregate terminal
receipt; a failed execution still consumes that package. Production use requires
a durable unique-use ledger plus injected authorization/custody and authenticated
terminal-execution verifiers. The guard validates their digest-bound receipts,
all frozen candidate pins, evaluator identity, and expiry against its trusted
clock and the database clock. It does not independently observe custody or prove
that an external evaluator emitted no side output beyond those verifier receipts.

Authorization register entry `AUTH-13` covers the independently supplied fresh
retrieval holdout and its one-time aggregate-only final run. It is currently a
prerequisite record, not evidence that the package exists or the run occurred.

## Gates intentionally left open

- Integrate the reviewed SQL as migration 0010 after 0004–0009 freeze and run
  clean/N-1 migration, PostgreSQL fault-injection, and rollback rehearsals.
- Run redacted `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` and the required
  30-minute 2× workload on authorized production-like infrastructure.
- Complete post-freeze ranking work, including frozen synonyms, authority
  priors, negative constraints, near-miss policy, and graph expansion.
- Obtain an independently owned replacement final holdout, then run it exactly
  once against the frozen release candidate under `AUTH-13` authorization.
- Obtain public-cutover authorization. No deployment or pointer switch has
  occurred.
