# USHSO canonical normalization and legacy import

This package deterministically maps the frozen production retrieval corpus
`v1.1.0` into the canonical core `v2.0.0` truth model. It verifies the exact
source-manifest and JSONL byte hashes before normalization. The import is fully
offline: it performs no network requests, dataset downloads, access workflows,
identity-index queries, or analysis.

The immutable legacy `record_id` plus source scope is the asset identity input.
Titles, publishers, descriptions, and URLs never create identity equality.
Similarity collisions produce `same_identity_candidate` relationships in
`pending_review`; all 157 source records remain distinct assets. Legacy public
IDs are permanent aliases.

The explicit reconciliation fixture is `fixtures/import-plan.json`. It maps all
157 records and 14 join routes, pins their source fingerprints, and records any
rejection code (the sealed production corpus currently has zero rejected
items). Legacy join routes become field-bound candidate relationships. A
candidate route never becomes documented, observed, executed, proven, or
compatible merely because field names look alike.

## Commands

```sh
npm --prefix packages/normalization run build:fixtures
npm --prefix packages/normalization run manifest
npm --prefix packages/normalization test
npm --prefix packages/normalization run validate
npm --prefix packages/normalization run receipt
```

`test` and `validate` are byte-read-only. Only `build:fixtures`, `manifest`, and
the explicit `receipt` command write sealed artifacts.

## Import and rollback boundary

The normalizer returns one fingerprinted import document containing canonical
revisions and exact legacy projection rows. The database import function applies
that document atomically and returns `already_applied` with zero new logical
rows on an exact replay. PostgreSQL recomputes canonical document, bundle,
projection, revision, and projection-row digests and matches the result to an
append-only maintenance authority row. A direct Worker invocation cannot mint
its own receipt. Collection/type mismatches and dangling logical references
fail the same transaction.

The ingestion boundary accepts only a complete sealed capture workset: one
`normalize:<capture_sha256>:<normalizer_version>` job for each manifest member.
Aggregate run/scope jobs, missing captures, duplicate capture jobs, unsealed or
unexpected captures, and normalizer-version drift fail closed before any
normalization result is accepted.

Rollback is a batch-state transition to `rejected`. It disables projection
eligibility but never deletes canonical objects, revisions, evidence, permanent
aliases, batch events, or the audit copy of legacy projection rows. Public reads
remain on the unchanged static v1.1.0 path until a later authorized cutover.
If a rejected batch supplies the selected N+1 revision, an audited selection
event restores the nearest eligible predecessor. New entities without one gain
an explicit no-eligible-head audit event.

Operational details are in `docs/IMPORT_RUNBOOK.md`, `docs/ROLLBACK.md`, and
`docs/MODEL_AND_MAPPING.md`.

## Product boundary

The package normalizes public metadata and compiles compatibility projections.
It does not acquire source payloads, execute analyses, calculate market share,
create financial benchmarks, or claim corpus-wide absence from zero results.
