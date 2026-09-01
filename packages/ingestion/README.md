# USHSO ingestion control plane

This package implements the WP4 scheduler, durable Workflow coordination,
transactional outbox, Queue/DLQ handling, pause/drain, shared-origin pacing,
retention reconciliation, and correctness-ledger GC contracts. It is deliberately
dependency-injected: PostgreSQL, Hyperdrive, Cloudflare Workflows, Queues, time,
and logging are ports. The package includes both an exhaustive in-memory fault
harness and a production PostgreSQL adapter for Cloudflare Hyperdrive.

Production composition uses a fresh `pg.Client` for every database step. The
factory returns the exact `openDatabase` port consumed by the scheduler,
Workflow, Queue, DLQ, source-control, origin-control, replay, and GC services:

```js
import { createHyperdriveOpenDatabase } from '@ushso/ingestion-control-plane';

const openDatabase = createHyperdriveOpenDatabase({
  hyperdrive: env.HYPERDRIVE,
  applicationName: 'ushso-harvest'
});
```

`createPostgresControlStoreFactory({ connectionString, applicationName })` is
the equivalent factory for offline integration tests and non-Worker runtimes.
Neither factory creates a module-global client or pool. `openDatabase()`
connects one client, and `withFreshDatabaseClient` closes it in `finally`.
Queries use positional parameters, transactions roll back on every rejected
callback/commit, and surfaced database errors contain only an operation label,
SQLSTATE, and retryability flag. Connection strings, SQL parameters, upstream
payloads, and PostgreSQL detail/hint text are never logged or copied into the
public error message.

The Worker role intentionally cannot physically delete correctness-ledger
partitions. GC proof reads and proof persistence work under the operations
role; the final detach/drop function is a maintenance-only capability and a
Worker call fails with `GC_PARTITION_DELETE_CAPABILITY_MISSING`.

Key guarantees:

- repeated UTC Cron slots converge on one run and one
  `harvest-<run_id>-<attempt>` Workflow ID;
- run creation and `workflow_start_requested` outbox insertion are one
  transaction;
- Workflow create/get unknown outcomes reconcile the same ID while its retained
  history is valid, and fail the DB run audibly at the retention boundary;
- every Workflow side effect is a stable `step.do`; every step opens and closes
  a fresh DB client;
- checkpoint advancement and normalization outbox work commit only after a
  complete enumeration seal;
- incomplete enumeration, normalization, projection, reference, checksum,
  visibility, or coverage barriers yield `partial_unpublished` and cannot change
  the last-known-good publication;
- network/platform sends never occur inside database transactions;
- Queue handling is per message with explicit first-action `ack`/`retry`, a DB
  processed-event guard, business effect, and downstream outbox in one
  transaction;
- circuit-open retries are durably re-ledgered and acknowledged rather than
  burning transport attempts;
- every DLQ delivery is acknowledged only after the durable incident transaction
  commits; replay creates new run/event lineage without resetting history;
- a source becomes `paused` only after in-flight work is completed or durably
  re-ledgered, and fetch authorization then fails closed;
- one transactional token bucket and circuit state coordinate every connector
  sharing an origin;
- GC requires a checksum-verified, access-controlled, restore-tested archive and
  zero references from active runs, leases, outbox, Workflows, DLQs, replays,
  idempotency keys, publications, rollback, evidence, review, or audit state;
- structured logs use an allowlist and redact secrets, credentials, URLs with
  queries, raw questions, user identifiers, response bodies, and payloads.

The failure policy matches `contracts/ingestion/v1.0.0`: page/normalize/schema/
access/projection total delivery limits are 6/5/4/4/5, with transport retries one
less. Retry delay is bounded exponential full jitter; a bounded `Retry-After`
wins. Terminal observations, quarantine, enumeration failure, source pause, and
exhaustion are distinct.

Run the isolated suite:

```sh
npm test --prefix packages/ingestion
npm run verify --prefix packages/ingestion
```

These commands are offline. They create no server, network request, database,
Queue, Workflow, R2 object, secret, deployment, or paid resource. The receipt in
`verification/wp4/v1.0.0` labels managed Cloudflare/PostgreSQL integration as
pending external authorization.
