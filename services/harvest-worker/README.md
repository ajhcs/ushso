# Harvest Worker composition boundary

This directory exports only dependency-injected Queue routing and a Workflow
entrypoint adapter. `worker.mjs` exposes those seams while its default export
remains disabled until an authorized composition supplies the ports. It
performs no source request, binding lookup, deployment, or secret access at
module initialization. Queue consumers explicitly call
exactly one of `ack()` or `retry()` per delivery; per-message handling prevents
one failure from implicitly replaying an entire batch.

The Workflow adapter delegates to the shared control plane. Every durable side
effect is inside a stable `step.do` and every database step opens and closes a
fresh client, so no connection or transaction crosses Workflow hibernation.
Actual Cloudflare classes, bindings, egress, R2, Hyperdrive, Queues, and
Workflows are supplied only by an authorized environment-specific composition
root.
