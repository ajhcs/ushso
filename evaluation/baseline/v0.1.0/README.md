# Observatory retrieval baseline v0.1.0

This bounded offline package adapts the immutable
`observatory/retrieval/v1.0.1` result contract to the separately published O8
evaluation runner. It evaluates all 60 frozen questions without changing the
benchmark, optimizing ranking against its judgments, making network requests,
running coverage cells, querying the identity index, or touching the shared
heavy-analysis lock.

The adapter intentionally reports the deterministic compiler's actual output.
It does not copy the benchmark's gold intent or source-specific access wording
into predictions. Consequently, the report is an honest MVP baseline and not a
release claim that the current 143-record corpus covers the full 36-source
benchmark universe.

Run:

```text
npm run build
npm test
npm run validate
```
