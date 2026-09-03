# WP4 generated receipt boundary

The WP4 receipt is generated from current implementation bytes and executable
offline probes. It is intentionally not pinned while the WP4 implementation is
still changing. Generate the deterministic JSON on standard output with:

```sh
npm run receipt --prefix verification/wp4/v1.0.0
```

The output contains no wall-clock timestamp, credential, source payload, or
managed-resource claim. The same source bytes produce the same receipt. A
digest-bound checked-in receipt may be added only after the implementation and
migration bytes are frozen.

`pass_local` covers synthetic fault injection and static SQL policy. Managed
PostgreSQL, Hyperdrive, Cloudflare Queue, Workflow, deployment, and paid-resource
evidence remains `pending_external_authorization` under `AUTH-03`.
