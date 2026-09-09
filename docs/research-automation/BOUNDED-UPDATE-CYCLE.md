# Bounded metadata update cycle (review-only)

Run through the host storage wrapper:

`/home/plumbob/bin/with-dev-storage node scripts/research/update-cycle.mjs PLAN_JSON STATE_DIRECTORY RUN_ID`

The state directory must be under `/mnt/d/tmp/plumbob/`. No recurring service is installed. A plan has format `ushso.bounded-update.v1` and at most 100 sources. Each source contains its exact canonical `record`, `generation`, `public_metadata_only: true`, and `locators` keyed by `metadata`, `variables`, `geography` or `documentation`. Locators must pass the existing first-party HTTPS metadata allowlist. Explicitly restricted assets are excluded. Do not provide credentials, patient/restricted data or private correspondence.

The default path invokes existing `capture`, `extractRecord` and `verifyClaim` implementations. Capture is sequential, bounded to 2 MiB per response and 20 seconds per attempt, with at most three attempts and 250/500 ms backoff for transient failures. A run has at most 300 attempts and a conservative 64 MiB charged response budget; failed/incomplete attempts charge the full per-response allowance. Oversized catalogs become typed failures, not permission to remove bounds. No redirects are followed. Successful HTTP retrieval alone is not a verified scientific claim.

Content-addressed capture bodies, capture receipts and proposal objects are append-only. A per-record/generation checkpoint allows the same run ID and exact plan to resume without repeating completed captures. A changed plan cannot reuse the same run ID. Use a new run ID to recheck publisher content. Source URLs are not permanent cache keys: changed content at the same filename creates a new hash and proposal binding. An unchanged body and unchanged parser/record identities produce no scientific field diff; capture timestamps remain in separate receipts rather than creating spurious proposal changes.

State tracks the latest successful proposal for each record/generation. Failed peers retain their earlier successful proposal; failures do not delete healthy records. Field changes include before/after values and evidence identities. New proposals always have pending review, null owner approval and false publication authorization. Parser files and record bytes are hashed; approvals are never inherited.

`runs/RUN_ID/report.json` supplies outcomes and a review packet. External review defaults to `pending_external_review`. An optional fourth positional CLI argument supplies a retained JSON failure receipt with `status: blocked_external_review`; the run records that exact receipt and its hash. The current missing Muse plugin 3.4.2 loader incident belongs in such a run-specific receipt, not permanent behavior. No fallback provider is invoked; a failure receipt is not a Muse finding or approval.

Resume validates record/generation/plan/parser identities, safe SHA256 references, actual referenced capture/proposal bytes, and reconstructed before/after differences. Tampered references, parser identities and capture bodies fail explicitly. Each capture attempt requires the full remaining 2 MiB allowance, preventing the cumulative budget from overshooting. The semantic verifier must return exactly true.

## Deliberate scope limits

This command implements the bounded metadata lane, including real CDC extraction and semantic verification. It does **not yet** orchestrate specialized CMS PDF/XLSX collectors, qualify their geometry/release identities, or automatically compose the complete dictionary package. Continue using their qualified proposal outputs and `compose-dictionary-review.mjs` with a hash-pinned reconciled composition specification. Do not pass unqualified updates directly into that package. Task 14 remains partly open until those parser-family adapters and package handoff are implemented and exercised together. The 2 MiB metadata limit means larger CMS/Census catalogs need an explicitly bounded catalog adapter, not an implicit larger download.

Completed historical checkpoints do not rewrite the latest-state pointer. Resuming run A after successful run B returns A's verified historical receipt with `resume_state: historical_checkpoint_current_preserved` and B's current proposal hash. If latest state is missing, resume reports `latest_state_missing_not_restored`; it does not guess that the requested historical run was latest. Recovery of a lost state index requires a separate verified reconciliation of completed runs.

Normal regression entry: `node tests/update-cycle.test.mjs` (also included by `tests/*.test.mjs`). Three named tests cover the real CDC extractor/verifier plus unchanged/revised publisher definitions, immutable historical proposals, peer failure, repeat-run resume, historical A→B→resume-A pointer preservation, missing-state non-restoration, conflicting resume plans, scoped exclusion and lack of approval inheritance. Tests use synthetic public metadata and make no network requests.
