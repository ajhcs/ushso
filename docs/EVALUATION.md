# Retrieval evaluation

The release evaluates the immutable 143-record MVP corpus against 60 frozen
health-systems discovery questions before ranking optimization. The benchmark
contains 36 source identities; 14 are represented by matching source-native IDs
in this initial corpus. Missing benchmark coverage is not treated as evidence
that a source does not exist.

## Release smoke gates

- All 60 questions execute offline through one result contract.
- The Pennsylvania hospital finance/utilization query returns both CMS HCRIS
  and PHC4 assets and surfaces their distinct access routes.
- Explicit join-route objects are returned with compatibility state and caveats.
- A nonsense query containing only a recognized geography returns a bounded
  zero result rather than every asset in that geography.
- The run records zero external requests, zero coverage-cell execution, zero
  identity-index work, no LLM use, and no heavy-analysis lock contact.

## Baseline metrics

| Metric | Value |
| --- | ---: |
| Must-not-miss recall at 1 | 0.216270 |
| Must-not-miss recall at 5 | 0.442460 |
| Must-not-miss recall at 10 | 0.500000 |
| Must-not-miss recall at 20 | 0.547619 |
| Acceptable-source coverage at 10 | 0.459936 |
| Acceptable-source coverage at 20 | 0.533654 |
| Correctly scoped zero-result cases | 1 / 1 |

The exact gold-intent, access-wording, and provenance metrics are currently
zero or near zero by design: the adapter reports the MVP compiler and indexed
record wording as produced; it does not copy benchmark answers into the system
under test. Those measures identify contract work for the next release and are
not disguised as passing ranking results.

Reproduce the published baseline with:

```bash
node evaluation/baseline/v0.1.0/tools/run-baseline.mjs
node evaluation/baseline/v0.1.0/tools/validate-baseline.mjs
```

The machine-readable report is
`evaluation/baseline/v0.1.0/outputs/evaluation-report.json`.
