# Production v1.1.0 import runbook

## Preconditions

1. Verify `packages/normalization` tests, validation, manifest, and receipt.
2. Verify migrations `0001` through `0007` and the WP6 isolated PostgreSQL
   receipt.
3. Confirm the target environment fence and exact deployment fingerprint.
4. Obtain a separately recorded authorization receipt for staging or
   production. Do not place database credentials in repository files or
   command output.
5. Confirm the static v1.1.0 public path remains available; import is not a
   public cutover.

## Local rehearsal

Run the guarded verification harness rather than binding a host port:

```sh
ss -tlnp
npm --prefix verification/wp6/v1.0.0 test
```

The harness uses PostgreSQL 16 with `--network none`, no published ports, a
labelled temporary container, a tmpfs data directory, and explicit cleanup.

The package import command is:

```sh
npm --prefix packages/normalization run import:local -- --database ushso
```

It builds the document from the frozen corpus, validates core v2 semantics,
and invokes the single security-definer database entrypoint as
`ushso_normalize`. Exact replay returns `already_applied` with zero logical
rows. A document, bundle, projection, row, authority, type, or reference
mismatch aborts the whole transaction.

## Managed execution

Managed database migration and import are intentionally not performed by this
repository task. Staging requires an authorization receipt scoped to
`normalization_import_v1_1_0`, followed by verification of counts, selected
heads, exact v1 projection parity, and backup/restore. Production requires a
separate production authorization after staging evidence is approved.

No import command acquires source payloads, submits access workflows, executes
analyses, computes market share, or produces financial benchmarks.

