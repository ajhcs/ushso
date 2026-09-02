# Research Navigator reconciliation — 2026-09-02

Status: **not release-eligible**. This addendum is the current candidate ledger;
the 2026-09-01 reconciliation remains historical. The machine-readable ledger is
[`research-navigator-reconciliation-2026-09-02.json`](./research-navigator-reconciliation-2026-09-02.json),
validated by [`research-navigator-reconciliation-2026-09-02.schema.json`](./research-navigator-reconciliation-2026-09-02.schema.json).

The isolated integration candidate is `3a93ff47c185995797cde57264a8ea435a91317b`
with tree `2ac18466e4d1d816f3e9d2d5cae6253c547ab757`. The main worktree’s
pre-existing `RELEASE_PROVENANCE.json` change and `.serena/` directory remain
untouched. The candidate retains the static public path by default and has no
deployment identity, remote mutation, or production eligibility.

## Local completion state

The WP8 v2 ranker is now implemented and tuned only on the development and
validation splits. The frozen evaluator, bridge, cohort, corpus, and metric pins
remain unchanged. The run is deterministic and safety-clean:

- 40 selected questions were evaluated; 20 development and 20 validation;
  no holdout rows were parsed or scored.
- Present-source essential recall is 1.0 at ranks 3, 5, and 10, and required-role
  coverage is 1.0 at those ranks.
- Present-source graded precision at rank 5 is `0.223333` against the frozen
  `0.70` target. Under the fixed five-slot denominator, the selected split has a
  measured maximum ceiling of `0.23`; this remains an open failure with no waiver.
- The v1.0 WP8 compatibility package still passes its 35 tests and validator;
  the v1.1 candidate receipt is separate and does not rewrite the v1 bridge.
- A clean offline `npm ci` restored the locked `pg@8.23.0` dependency, after
  which WP4’s local tests and verifier passed. WP3’s safe offline/static
  aggregate and validator also pass; only its optional Docker rehearsal remains
  unavailable because `postgres:16-alpine` is not installed and pulls are
  forbidden.
- The application-level checks pass: web Vitest (19 files/98 tests), Wrangler
  types, TypeScript/Vite build, 70-file Wrangler artifact dry-run, connector
  package tests/validation, v1.1 ingestion-contract tests/validation, and the
  release audit.

The repository-wide verification aggregator now has only the expected WP0
failure: its immutable v1.0.0 final aggregate receipt is stale for the changed
candidate tree. It was not overwritten or silently repinned.

The exact release gate was already run once for the earlier frozen candidate and
failed on `WP0_AGGREGATE_RECEIPT_STALE`. The immutable v1.0 aggregate is not
overwritten or silently repinned. A new exact gate requires an explicitly frozen
successor candidate and must not be inferred from this focused verification.

## Provenance boundary

The historical `corpus.manifest_sha256` alias in the live snapshot is recorded
as the c157 content fingerprint, not the file hash of `corpus-manifest.json`.
This current ledger uses separate fields for the c157 manifest-file SHA-256
(`23f704…`), content fingerprint (`adcfb5…`), corpus algorithm fingerprint
(`b17c49…`), and the development ranker fingerprint (`799d2d…`). Current static
provenance, integrated-candidate provenance, and future deployment provenance
are separate records; future Cloudflare version and deployment IDs are null.

## External and provider boundaries

All `AUTH-01` through `AUTH-17` entries remain `not_requested` and
`authorized: false`. No managed resource, secret, migration, live connector,
canary, load/recovery drill, human review, protected holdout, public cutover,
remote push, or PR handoff was performed.

The fresh Cursor review `wp8-v2-review-0902` is paused before provider dispatch
at the host’s explicit repository-exposure consent checkpoint. The fresh Grok
review `wp4-grok-review-0902` was rejected before dispatch by the provider-safety
boundary because full private-repository exposure was not explicitly authorized;
no files were sent. Neither lane supplies a review result or release evidence.

The complete machine ledger contains the remaining WP, environment, authorization,
quality, and provider blockers. The required next action is an authorized WP0
successor/reseal and a new exact-candidate freeze; production remains unchanged.
