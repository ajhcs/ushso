# Scheduler Worker composition boundary

`createSchedulerWorker` is a configuration-only Cloudflare Scheduled handler.
It receives the scheduler, Workflow-start reconciler, and outbox dispatcher as
ports; it has no direct database, Workflow, Queue, source-network, or secret
binding. `worker.mjs` exposes the Cloudflare event adapter and keeps its default
export disabled until an authorized composition supplies those ports. The
deployment composition root must bind cache-disabled PostgreSQL, Workflow, and
Queue adapters with the least-privilege scheduler role.

Cron delivery is treated as at-least-once. `scheduledTime` defines the UTC slot,
while database uniqueness over endpoint, slot, mode, and configuration revision
prevents duplicate logical runs. No `fetch`/`__scheduled` route is exported.
Production binding and managed-integration verification remain outside this
offline package and require authorized WP3 infrastructure.
