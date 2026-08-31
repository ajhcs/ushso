# Database and control-plane test-strategy evidence v1.0.0

This private package maps implementation-plan §22.3 to byte-pinned local database, queue, Workflow, DLQ, outbox, barrier, and R2 evidence. Managed PostgreSQL integration, authorized staging, provider outage recovery, and backup/restore rehearsals remain blocked. Its direct scripts are offline and read-only.

```sh
npm test --prefix verification/testing/control-plane/v1.0.0
npm run validate --prefix verification/testing/control-plane/v1.0.0
```
