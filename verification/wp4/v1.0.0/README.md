# WP4 offline verification

This package verifies the WP4 ingestion control plane without contacting an
authoritative source or managed provider. Its deterministic probes exercise the
actual dependency-injected implementation and the current additive PostgreSQL
migrations. The receipt is bound to a SHA-256 inventory of the implementation
files, contains no wall-clock timestamp, and is reproduced from scratch on each
run.

The local gate verifies:

- one initial delivery plus five transport retries, with no recursive DLQ;
- deterministic, attempt-qualified, Cloudflare-safe Workflow IDs under the
  `workflow-instance.v1.1` policy;
- one normalization job and outbox identity per unique capture digest and
  normalizer version, explicit cross-run requirements, immutable manifests, and
  a valid zero-capture run;
- pause/drain fail-closed behavior with zero post-pause fetches and zero new
  scheduled work;
- unknown Queue-send outcomes retained through the full Queue horizon without
  an immediate resend;
- the sixth/final DLQ sink delivery page, permanent Queue-message-loss
  assumption, and reconstruction from fenced PostgreSQL evidence;
- parity between the JavaScript control plane and raw SQL for Workflow-start
  ownership, inclusive lease expiry, and caller-supplied Cron slots;
- dependency-injected scheduler, Queue, and Workflow service boundaries;
- production `worker.mjs` composition entrypoints when they are present. Their
  absence is reported as `pending_local_implementation`, never as managed
  evidence.

Run from the repository root:

```sh
npm test --prefix packages/ingestion
npm test --prefix verification/wp4/v1.0.0
npm run validate --prefix verification/wp4/v1.0.0
npm run verify --prefix verification/wp4/v1.0.0
npm run receipt --prefix verification/wp4/v1.0.0
```

All commands are offline and bind no port. They perform no DNS lookup, source
request, database connection, Queue/Workflow/R2 operation, secret access,
deployment, or paid-infrastructure mutation.

Managed PostgreSQL, Hyperdrive, Cloudflare Queue, and Cloudflare Workflow
integration remains `pending_external_authorization` under `AUTH-03`. The local
receipt explicitly records all managed actions as false; it must not be used as
a substitute for an authorized staging integration receipt.
