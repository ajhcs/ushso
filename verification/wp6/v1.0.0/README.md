# WP6 verification

This package verifies the canonical normalization and production-corpus
backfill entirely offline. Its PostgreSQL harness performs the required
`ss -tlnp` preflight, starts an ephemeral PostgreSQL 16 container with
`--network none`, no published host ports, and a temporary in-memory data
directory, then removes the container in a `finally` block.

The database suite independently verifies canonical SHA-256 binding, the
maintenance-owned import authority, exact receipt transitions, typed and
logical reference failures, immutable N/N+1 history, cycle and cross-entity
edge rejection, audited head selection and manual revert, automatic fallback
when N+1 is rejected, explicit no-eligible-head events, and preservation of a
later head when an older batch is rejected.

`requirements/evidence-ledger.json` maps each WP6 acceptance, migration,
security, rollback, ingestion-boundary, and product-boundary obligation to its
implementation and local verification evidence. Managed staging and production
steps remain explicitly pending external authorization.

Run the read-only static gate with:

```sh
npm --prefix verification/wp6/v1.0.0 run validate
```

Run the isolated database suite with:

```sh
npm --prefix verification/wp6/v1.0.0 test
```

Seal a receipt only after both gates pass:

```sh
npm --prefix verification/wp6/v1.0.0 run receipt
```

No command contacts a source system or managed database. Staging and production
application remain explicit external-authorization steps.
