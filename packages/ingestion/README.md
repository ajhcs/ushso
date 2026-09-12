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


## Durable local collection fixture

The fixed `catalog-two-page-v1` fixture connects the existing scheduler, connector runner, and actual research `capture` entry point through injected local ports. It exercises synthetic catalog metadata only. It does not activate the public workers, live collection, managed persistence, paid inference, payload acquisition, publication, or production composition. The broader research update-cycle and PDF orchestration remain separate and unintegrated.

Preview the selected records, immutable descriptor digest and maximum reservation without writing files or requesting a source:

```bash
npm run job:preview --prefix packages/ingestion
```

On the Plumbob host, run commands through `/home/plumbob/bin/with-dev-storage`. Choose a new task-owned absolute directory beneath the configured `TMPDIR` (normally `/mnt/d/tmp/plumbob`). CI may use `RUNNER_TEMP`. The store rejects path escapes and symlink components.

```bash
/home/plumbob/bin/with-dev-storage npm run job:fixture --prefix packages/ingestion -- --fixture catalog-two-page-v1 --state-dir /mnt/d/tmp/plumbob/ushso-local-fixture-example
/home/plumbob/bin/with-dev-storage node packages/ingestion/src/local-job-cli.mjs status --state-dir /mnt/d/tmp/plumbob/ushso-local-fixture-example
/home/plumbob/bin/with-dev-storage node packages/ingestion/src/local-job-cli.mjs resume --state-dir /mnt/d/tmp/plumbob/ushso-local-fixture-example
```

Commands emit JSON. Lifecycle states include `selected`, `running`, `partial`, `complete_fixture`, `typed_failure`, and `partial_unresolved`; blocked input emits a safe code and exits with status 2. `complete_fixture` means that this synthetic enumeration and its selected dispositions were durably committed. It does not establish coverage or scientific suitability for any real source. Status and preview do not mutate local state. Mutating commands use an OS-held writer lock; another writer receives `WRITER_BUSY`. The lock is released by close or process death without deleting a PID/lock file.

The journal commits one complete scheduler transaction, page-and-cursor operation, or membership/checkpoint/downstream-intent operation at a time. Synthetic bodies are content-addressed separately; journal values use a strict tagged codec for Maps, undefined values and byte references. Files and containing directories are synced before an operation is acknowledged. After any persistence ambiguity, all store clients are poisoned and the process must close and reopen from a verified disk prefix. In-memory reducers do not constitute durable evidence.

Request intent and its budget charge precede fixture delivery. The response, strict capture, actual collector result and PR009 receipt precede page success. Restart reuses a verified response and its original observation and recording clocks. A delivery intent with no verified response or strict failure remains charged and settles as `partial_unresolved`; it is never automatically delivered again. This is an explicit unresolved-delivery boundary, not an exactly-once request guarantee.

One scheduler parent may own multiple separately identified collection children. Each child has its own connector repository, one logical attempt, and an immutable terminal outcome. Observation time is the child's scheduled slot plus the journal-wide zero-based request-intent ordinal times 1,000 ms; capture recording time is observation plus 1 ms. These are pinned synthetic clocks, including the origin-governor clock. Journal reservations enforce restart bounds; the governor's private in-memory token state is not durable or production pacing evidence.

A state directory is bound to the exact runtime import closure, released schemas, lockfile, fixture, approved descriptor, policy and clock derivation. Changed pins or tampered/missing evidence block replay. Keep the entire directory for a pending review; remove a task-owned fixture directory only after all writers are closed and its evidence is no longer required. No automatic retention, managed-storage migration or source retry service is installed.
