# O8 Evaluation Harness v1.0.0

This package deterministically evaluates question-to-data discovery result
bundles against the separately published benchmark at
`observatory/benchmarks/question_to_data/v0.1.0`.

The production runner reads and verifies that benchmark in place. It never
edits the benchmark and has no fallback when the published package is missing
or fails its recorded hashes. A small synthetic benchmark under `fixtures/`
is loaded only by test code.

The harness evaluates:

- compiled intent against the benchmark question;
- acceptable and must-not-miss source coverage at configured `k` values;
- exact preservation of source-specific access implications;
- coverage of important restrictions;
- exact benchmark provenance-reference coverage;
- join-route status and required-crosswalk coverage without upgrading a
  candidate or crosswalk-dependent route to proven;
- recommended sources outside the acceptable set; and
- zero-result behavior.

Zero retrieved results are always treated as a bounded evaluation outcome.
They are never evidence of source or corpus absence. Inputs that make a corpus
absence claim are rejected even when the result list is empty.

The package performs no retrieval, ranking optimization, LLM calls, network
requests, coverage execution, identity work, or heavy-analysis locking. The
CLI prints deterministic JSON to stdout:

```text
node tools/run-evaluation.mjs --input <runner-input.json>
```

Run `npm test` and `npm run validate` for offline verification.
