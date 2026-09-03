# WP3 alert and SLO runbooks

These procedures are configuration-ready, not proof that managed alerts have
been installed or exercised. Every action must preserve the immutable-publication
and public/static fallback boundary. Never paste payloads, credentials, raw
questions, or user identifiers into an incident channel.

## Alert procedures

### ALERT-01 — Scheduler heartbeat missing

Freeze new dispatch, confirm the global scheduler toggle and latest database
slot, distinguish Cron non-delivery from Worker/database failure, then replay
only missing slots by deterministic slot ID. Escalate after 15 minutes.

### ALERT-02 — Due source overdue

Inspect source pause/circuit state and in-flight lease, preserve one-run
idempotency, and schedule a bounded replay only after the cause is classified.

### ALERT-03 — Queue oldest-message age

Pause the affected stage if age is growing, compare consumer health with the
shared origin connection budget, and drain from PostgreSQL job truth. Do not
purge or manufacture attempts.

### ALERT-04 — DLQ non-empty

Freeze the affected publication barrier. The ops sink processes batches of one,
uses retry delays of 30, 60, 120, 240, and 300 seconds, and acknowledges only
after the PostgreSQL durable-dead-letter incident transaction commits. A sink
failure must retry; it must never ACK early or route to a recursive DLQ.

Page on any visible DLQ message and again on the final failed sink delivery.
Cloudflare permanently deletes a message after the initial delivery and five
failed retries because no second DLQ is configured. Reconstruct the incident
from the PostgreSQL control-plane ledger and referenced capture/evidence, then
use an explicit audited replay with `replay_of`. Queue retention is not a
recovery source after terminal sink exhaustion, and history must never reset.

### ALERT-05 — Outbox oldest pending

Stop dependent promotion, compare unsent and sent/unmarked events, run the
idempotent dispatcher/reconciler, and prove one logical effect before recovery.

### ALERT-06 — Workflow errored or terminated

Resolve the deterministic instance mapping, inspect step receipts without source
bodies, reconcile the run/job barrier, and re-enter through an explicit replay.

### ALERT-07 — Connector auth or schema pause

Keep the source paused. Validate the endpoint policy/credential reference or
fixture drift offline; resume only after an audited half-open probe.

### ALERT-08 — Catalog count collapse

Quarantine the candidate snapshot, compare against the last accepted source
inventory and known source events, and require review before sealing.

### ALERT-09 — Canonical/index lag or generation age

Freeze publication, inspect projector/DLQ barriers, rebuild a complete candidate
from its exact revision manifest, and do not mutate the active generation.

### ALERT-10 — PostgreSQL connectivity/storage/backup/PITR

Freeze dispatch and publication, preserve the static public artifact, check
provider status and connection headroom, then follow the authorized failover or
isolated restore drill. Never run a destructive down-migration.

### ALERT-11 — R2 checksum/write failure

Quarantine the capture, do not commit a canonical capture reference, compare the
exact-byte digest, and run the audited orphan/checksum reconciler.

### ALERT-12 — Coverage reconciliation failure

Reject the snapshot/publication candidate, enumerate the failing denominator
partition, and rebuild it from the same exact semantic pins.

### ALERT-13 — Excluded/quarantined result leak

Treat as a safety incident: freeze publication, immediately restore the prior
validated generation or static artifact, preserve evidence, and audit every
affected surface (HTML, search, JSON, WebMCP, coverage, planner).

## SLO procedures

- **SLO-01 Discovery availability:** segment valid requests from expected typed
  errors; activate static fallback when the database path is unavailable.
- **SLO-02 Record-search latency:** compare cold/warm and generation-pinned route
  mixes; never cache or bypass the active-pointer correctness read.
- **SLO-03 Bundle-plan latency:** profile deterministic compile stages under the
  pinned corpus; do not omit evidence checks for speed.
- **SLO-04 Canonical-to-index lag:** freeze stale promotion and reconcile exact
  canonical revision membership.
- **SLO-05 Scheduler timeliness:** replay missing deterministic slots without
  duplicating logical runs.
- **SLO-06 Normalization timeliness:** constrain source and stage concurrency to
  the shared connection budget; never silently accept uncertain identity.
- **SLO-07 Coverage timeliness:** publish no stale snapshot as current; expose
  its actual cutoff and state.
- **SLO-08 Index consistency:** reject promotion on any membership/count mismatch.
- **SLO-09 Visibility safety:** use ALERT-13 and immediate rollback; threshold is
  zero.
- **SLO-10 Generation rollback:** restore the complete prior manifest/Worker/
  asset set and verify all surfaces within 15 minutes.
- **SLO-11 Coverage reconciliation:** block publication until all stage
  partitions reconcile exactly.

External endpoint pass rate is reported separately and is never used as an
internal SLO denominator.
