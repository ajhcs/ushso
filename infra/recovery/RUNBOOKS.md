# WP3 recovery-control runbooks

All managed drills are blocked on `AUTH-05`. These local procedures define the
safe sequence and required evidence; they do not claim that a provider failover,
PITR restore, reconnect, or live activation has occurred.

## REC-01 — Global scheduler toggle

Authenticate through the dedicated ops Access application, append the requested
toggle event, set dispatch disabled transactionally, and verify two Cron slots
create no new work while existing work remains recoverable. Re-enable only after
the incident owner records the cause and half-open validation.

## REC-02 — Per-source pause

Request pause, stop new leases, let in-flight work drain or durably re-ledger it,
then transition to `paused`. Prove zero new fetches after the transition.

## REC-03 — Per-stage Queue pause

Freeze dependent publication barriers, pause the named Queue consumer without
purging messages, record oldest age/backlog, repair the cause, and resume within
the shared connection/concurrency budget.

## REC-04 — Connector-version denylist

Deny the exact version before any source egress, identify affected scheduled and
in-flight work, quarantine its candidates, deploy a reviewed version, and use
explicit replay rather than rewriting attempts.

## REC-05 — Index-publication freeze

Block new active-pointer changes while allowing immutable current reads. Keep
candidate builds isolated, reject incomplete candidates, and audit freeze/unfreeze.

## REC-06 — Explicit replay with lineage

Select an immutable job/run/DLQ record, create a new replay record carrying
`replay_of` plus the original policy version, preserve attempt history, and prove
one logical effect through processed-event/idempotency guards.

For the ops DLQ sink, ACK only after the PostgreSQL incident transaction commits.
Use batch size one and the bounded five-retry schedule; never configure a second
DLQ. A final sink failure pages and Cloudflare permanently deletes the message.
Reconstruct it from the PostgreSQL control-plane ledger and referenced evidence,
then create the explicit replay. Do not claim Queue retention can recover an
already exhausted sink message.

## REC-07 — Immediate pointer rollback

Validate the N-1 manifest, Worker/binding/schema compatibility, assets, coverage,
and static pin; atomically append publication history and restore the singleton
pointer using the cache-disabled binding. Warm-cache checks must show no mixed
generation. Never claim canonical writes were undone.

## REC-08 — Static-corpus public fallback

Select the co-resident immutable static artifact pinned in the rollback bundle,
activate its compatible prior Worker without relying on PostgreSQL/Hyperdrive,
verify HTML/search/JSON/WebMCP/coverage/planner metadata, and retain evidence for
the incident. Return to database-backed reads only through the normal candidate
gates.

## Managed provider drill order

Create a disposable isolated recovery target; record start time and the last
durable transaction; induce only the approved fault; time provider recovery;
reconnect with fresh clients; reconcile run/outbox/publication checksums; measure
RPO/RTO; then destroy the disposable target only under the drill authorization.
Never restore over staging or production, and never use a public Worker credential
for migration, PITR, or maintenance.
