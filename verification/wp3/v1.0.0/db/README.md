# WP3 local database verification

This package verifies only the local PostgreSQL foundation. It does not claim a
managed Neon, Hyperdrive, staging, production, failover, PITR, or deployment
result. Those fields remain `pending_external_authorization` in every receipt.

The integration harness:

1. records `ss -tlnp` before container creation;
2. requires an already-installed `postgres:16-alpine` image;
3. uses `docker --pull never`, `--network none`, no published port, labeled
   ownership, and tmpfs storage;
4. always removes the exact task-owned container;
5. creates no systemd, Caddy, cron, `/mnt/d/services`, or host database state.

Run:

```sh
npm test --prefix verification/wp3/v1.0.0/db
```

