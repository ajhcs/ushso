# USHSO identity and researcher-guidance engine

This package implements the non-persistent WP7 truth boundary. It consumes the
frozen `core/v2.0.0`, `identity/v1.0.0`, `use-access/v1.0.0`, and
`research-plan/v1.0.0` contracts without modifying them.

The engine is deliberately fail-closed:

- similarity only creates an open candidate;
- exact identifiers resolve automatically only after every namespace,
  entity/grain, normalization/check, temporal, reuse, conflict, and sealed
  benchmark gate passes;
- a human decision is usable only with explicit external review evidence;
- controlled fixtures exercise reversal mechanics but cannot be exported as
  adjudication evidence;
- identity equality, family membership, and join compatibility remain separate;
- schema snapshots and field revisions are immutable and joins pin exact
  release/distribution/snapshot/field revisions;
- access observations age to `stale` or `unknown`, never silently to current;
- guidance recommends and explains. It does not retrieve payloads, submit access
  workflows, execute analysis, calculate market share, or produce benchmarks.

Run the offline suite with:

```sh
npm test --prefix packages/identity
npm run validate --prefix packages/identity
```

`validate` is non-mutating and verifies the immutable package manifest and
validation receipt, including the fail-closed external-human and automatic-rule
fields.

Database migrations are intentionally outside this package. WP7 migrations
`0008` and `0009` may only be appended after the WP6 migration owner releases
the sequence.
