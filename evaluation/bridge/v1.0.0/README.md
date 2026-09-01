# Retrieval evaluator-v2 bridge v1.0.0

This immutable offline package separates three things that the prior baseline
could not safely conflate:

1. the 143-record historical evaluation corpus (`v1.0.1`);
2. the 157-record production migration seed (`v1.1.0`), including its changed
   vocabulary and regenerated projections; and
3. the two retrieval implementations currently present in the repository: the
   legacy package engine and the materially different production Worker engine.

The bridge evaluates the full 2×2 matrix under evaluator v2. The Worker lane is
an observed pre-WP0 production runtime, not a newly tuned or accepted v2
algorithm. No consolidated post-WP0 algorithm is invented by this package.
The receipt's `PASS` status is limited to deterministic execution and artifact
integrity. The matrix separately records `FAIL_PRE_TUNING`: current retrieval
does not pass the frozen quality or prohibited-access release gates.

Rebuild and verify without network access:

```bash
node evaluation/bridge/v1.0.0/tools/run-bridge.mjs --write
node --test evaluation/harness/v2.0.0/tests/*.test.mjs
node evaluation/harness/v2.0.0/tools/validate-package.mjs
node --test evaluation/bridge/v1.0.0/tests/*.test.mjs
node evaluation/bridge/v1.0.0/tools/validate-bridge.mjs
```

The primary receipts are:

- `manifests/corpus-pins.json`
- `manifests/algorithm-pins.json`
- `cohorts/present-source-v1.json`
- `outputs/corpus-delta.json`
- `outputs/attribution-matrix.json`
- `receipts/bridge-receipt.json`

All outputs are metadata/evaluation artifacts. No source data payload is read,
downloaded, or analyzed.
