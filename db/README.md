# USHSO PostgreSQL foundation

This directory contains the forward-only local PostgreSQL foundation for the
Research Navigator. PostgreSQL is the canonical and operational authority;
these migrations do not deploy, provision, or contact a managed service.

## Safety boundary

- Migrations are additive and have no down-migration path.
- Managed staging or production execution requires a separate, approved
  authorization receipt. The tools fail closed without it.
- Application roles never own schemas or tables.
- The public role receives only `SELECT` on explicit published views.
- Correctness ledgers remain online for at least 90 days and may be archived or
  pruned only after a recorded dependency proof and restore verification.
- Local integration uses an isolated Docker container with `--network none`, no
  host port, a task label, a tmpfs data directory, and an unconditional cleanup
  path. The harness runs `ss -tlnp` immediately before container creation.

The exact Worker database identities are `ushso_public`, `ushso_scheduler`,
`ushso_harvest`, `ushso_normalize`, `ushso_projector`, and `ushso_ops`. They are
independent `LOGIN` roles whose password values are supplied by distinct
managed secrets outside this repository. Schema-owner roles and
`ushso_maintenance` are `NOLOGIN`; a separately secured direct identity assumes
the maintenance/owner capabilities and is never bound to a Worker. The public
identity may resolve the pointer-shaped `search.published_runtime_status` view
through the cache-disabled binding and read the generation-pinned
`search.published_generation_records` view through the immutable-read binding.
It has no registry, ingest, catalog, operations, credential-reference, or write
grant.

## Migration order

1. `0001_registry_sources_endpoints_scopes.sql`
2. `0002_ingest_runs_jobs_captures.sql`
3. `0003_ops_outbox_processed_events_dead_letters.sql`
4. `0004_catalog_objects_identifiers_evidence.sql`
5. `0005_assets_releases_distributions_documentation.sql`
6. `0006_schema_snapshots_fields_access.sql`
7. `0007_assertions_relationships_temporal_history.sql`

`db/tools/migrate.mjs` validates the migration manifest, acquires a row lock
through the direct maintenance connection, checks the immutable environment
fence, applies each migration in a transaction, and records its byte SHA-256.
It never uses PostgreSQL advisory locks and never accepts database credentials
as command-line arguments.

Direct maintenance mode reads `USHSO_MAINTENANCE_DATABASE_URL` from the
process environment. The URL is converted to libpq environment variables and
is never forwarded as a command-line argument. Managed staging or production
commands also require an exact, separately approved authorization receipt;
without it they return `pending_external_authorization` before connecting.

Managed receipts use the fail-closed envelope in
`db/schemas/managed-authorization-receipt.v1.schema.json`. The verifier binds
the exact action, database, deployment fingerprint, canonical parameter object,
reviewer, and a current approval window of no more than 24 hours. The allowed
actions distinguish foundation apply, role reconciliation, partition
management, archive, restore, and direct-maintenance checks. A receipt is an
input to the gate, not evidence that a managed provider or database was
contacted; provider authenticity, role/catalog proof, and managed execution
remain external prerequisites.

The local WP3 result and its database receipts also record the exact Git
commit and tree used for the test run. That identity is captured before the
receipt files are written, so the evidence does not make a self-referential
claim about the final receipt-refresh commit.

## Local verification

From the repository root:

```sh
npm test --prefix verification/wp3/v1.0.0/db
```

The command requires an already-installed local `postgres:16-alpine` image and
uses `docker --pull never`; it performs no network access.
