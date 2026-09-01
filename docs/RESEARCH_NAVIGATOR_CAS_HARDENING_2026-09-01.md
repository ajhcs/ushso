# Research Navigator CAS hardening — 2026-09-01

Status: local fixture hardening only. This note records a bounded successor
candidate; it is not an authorization, a managed-database proof, a release
gate, or a production-eligibility claim.

## Scope

The CAS slice updates the WP14 fixture durable transition adapter to keep its
append critical section serialized across asynchronous failure-injection
callbacks. It also binds state history entries to their append-ledger entries,
freezes the fixture durability class, and rejects direct production transitions
through the fixture adapter. The authoritative transactional adapter remains
unimplemented and must not be inferred from this fixture.

## Exact local evidence

The implementation and regression tests are bound to:

- commit: `f2641a3bfd5ae7249d0acffff883b312e4bdb077`
- tree: `dc80d1c0f9ff7d8c4a2a4a8beb01ed2723878675`
- paths: `verification/wp14/v1.0.0/src/durable-transition.mjs`,
  `verification/wp14/v1.0.0/tests/durable-transition.test.mjs`
- receipt: `verification/receipts/research-navigator-cas-hardening-2026-09-01.json`
- receipt digest: `sha256:1bfc1813a2d0383c3b56a626af4c80a90b68150042e979cbfd9b79b1cef37e2d`

The original focused regression command passed 3/3 tests. The repository owner
subsequently authorized an additive v1.1.0 successor attestation. It copies the
authorized implementation and regression-test blobs exactly, exercises them
through compatibility bridges, and passes 12/12 tests plus 24/24 binding and
preservation checks. The historical WP14 v1.0.0 package and receipts remain
bound to `f6edbb0b31530cdcf3391e8bddf85015d5d30265`; they were restored to their
sealed bytes and were not repinned.

## Boundaries and next decision

No provider mutation, deployment, source request, public request, or analysis
was performed. No managed PostgreSQL durability, archive/restore, failover,
PITR, live traffic, or independent review was obtained. The authorization was
strictly limited to local code, tests, documentation, commits, push, and PR #8
updates. The historical release-gate failure remains unchanged and no
successor release gate was run. Any deployment, provider operation, release
gate, or production-eligibility decision requires separate authorization and
evidence.

Production eligibility remains false.
