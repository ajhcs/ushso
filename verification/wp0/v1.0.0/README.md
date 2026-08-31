# WP0 aggregate verification v1.0.0

This package independently recomputes the Research Navigator WP0 freeze. It
does not treat the presence of a receipt as proof: source bytes, manifests,
reconciliation coverage, package payloads, accepted decisions, documentation,
and immutable legacy snapshots are rehashed and cross-checked.

The aggregate keeps two statuses separate:

- `verification_status` is `PASS` only when every WP0 artifact and prerequisite
  receipt is current and reproducible.
- `retrieval_release_gate_status` is expected to remain
  `FAIL_PRE_TUNING` at WP0. Evaluator and bridge artifact integrity can pass
  while current retrieval quality and prohibited-access safety gates fail.

The initial receipt may be `BLOCKED_STALE_PREREQUISITE` and marked
`provisional` while a centrally owned prerequisite receipt is being refreshed.
The validator remains nonzero in that state. A provisional receipt can be
promoted once, but a final `PASS` receipt is immutable and requires a successor
version for later changes.

## Deferred-seal lifecycle

The product-boundary receipt intentionally covers the rolling public runtime and
schema tree. WP0 never narrows that scope to manufacture a stable hash. While
implementation workstreams are still adding inspected files, the expected and
only provisional blocker is `product-boundary-and-non-goals` with
`BLOCKED_STALE_RECEIPT`; package tests still prove that the dynamic boundary
suite itself passes and that every other prerequisite remains current.

Final promotion is deferred to WP14 sealing. After all implementation
workstreams freeze, the central boundary owner regenerates
`product-boundary.json` exactly once over the complete tree, reruns its dynamic
6/6 gate, and then runs `receipt:finalize`. Promotion is refused if any other
check is blocked, if the receipt still differs from the rolling scope, or if
retrieval's distinct release state is no longer honestly labeled
`FAIL_PRE_TUNING`.

Run locally, with no network or external actions:

```bash
npm test --prefix verification/wp0/v1.0.0
npm run validate --prefix verification/wp0/v1.0.0
```

Receipt operations:

```bash
npm run receipt:provisional --prefix verification/wp0/v1.0.0
npm run receipt:finalize --prefix verification/wp0/v1.0.0
```

The aggregate receipt is
`verification/wp0/v1.0.0/receipts/wp0-aggregate.json`.
