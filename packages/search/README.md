# USHSO search-generation successor

`@ushso/search-generation` is the untuned successor to the WP1 static search
adapter. Import `index-v2.mjs` (or the package exports) for:

- deterministic W1-pinned projection builders and reconciliation;
- seven-component publication manifests and lifecycle rehearsal;
- PostgreSQL active-pointer resolution, bounded search/browse, and exact
  canonical-revision hydration;
- HMAC-signed generation-pinned keyset cursors; and
- the verifier-bound, durable single-use final-holdout guard.

The legacy `search-backend.mjs` and `static-search-backend.mjs` remain exported
only as compatibility contracts and are byte-pinned by WP1. The successor does
not change either file or the Worker entrypoint.

All search results are immutable `source_of_truth=false` projections. The
package has no source connector, payload retrieval, analysis execution,
identity-merge, market-share, or financial-benchmark capability. Its quality
state is `FAIL_PRE_TUNING`; the ranking implementation is deliberately untuned.

Production final-holdout use requires trusted injected authorization/custody and
terminal-execution verifiers. The guard validates digest bindings, frozen pins,
expiry, and evaluator identity and records no item-level data. It does not by
itself prove independent custody or the absence of external evaluator side
outputs; `AUTH-13` and the external verifier receipts remain authoritative.

The SQL under `sql/` is reviewed input for migration 0010 after migrations
0004–0009 freeze. It is not applied by this package. Run `npm test --prefix
packages/search` for the offline WP8 suite and `npm run validate --prefix
packages/search` for non-mutating manifest, WP1 pin, WP8 receipt, and AUTH-13
boundary verification.
