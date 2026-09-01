# USHSO retrieval evaluator v2.0.0

This package freezes the retrieval metric semantics required by the Research
Navigator plan. It evaluates already-produced ranked results; it does not
retrieve, tune, make network requests, execute analyses, or mutate benchmark
gold.

The evaluator reports two non-interchangeable cohorts:

- the full benchmark, where every gold requirement remains in the denominator;
- the frozen present-source cohort supplied by a separately hashed manifest.

Every report carries corpus, projection, vocabulary, algorithm, benchmark,
cohort, and metric-contract pins. Recall is published as macro and micro with
explicit numerators and denominators. Strict precision and graded acceptable
precision divide by `k`, so short result lists do not receive free precision.
Duplicate assets that resolve to the same adjudicated benchmark source can earn
gain once and continue to consume rank slots.

Run the offline package checks with:

```bash
node --test evaluation/harness/v2.0.0/tests/*.test.mjs
node evaluation/harness/v2.0.0/tools/validate-package.mjs
```

The bridge runner in `evaluation/bridge/v1.0.0` is the canonical producer of
real-corpus evaluator inputs and reports.
