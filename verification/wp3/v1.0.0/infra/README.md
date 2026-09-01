# WP3 infrastructure verification

This package verifies the local, zero-traffic WP3 infrastructure foundation.
It is intentionally independent of provider credentials and the managed DB
migration suite in the sibling `db/` package.

Run from the repository root:

```sh
node verification/wp3/v1.0.0/infra/tools/render-wrangler.mjs --check
node --test verification/wp3/v1.0.0/infra/tests/*.test.mjs
bash verification/wp3/v1.0.0/infra/tools/run-wrangler-dry-run.sh
node verification/wp3/v1.0.0/infra/tools/validate-foundation.mjs
```

The suite checks:

- exact Terraform 1.16.0, Cloudflare 5.24.0, and Neon 0.15.0 pins and balanced
  offline HCL;
- staging/production state, name, identity, secret, and route fences;
- two cache-semantic profiles over eight role-scoped Hyperdrive configs per
  environment, aligned to the database role matrix with no maintenance/public
  credential crossover;
- one active Neon project per environment with direct default read-write
  endpoint policy and 30-day retention, no API-created Worker roles, value-free
  direct-SQL login bootstrap, and fail-closed six-role privilege attestation;
- private content-addressed capture/archive R2 declarations;
- five Queue/DLQ pairs, attempt arithmetic, one Workflow, one UTC Cron, and six
  least-binding Worker roles;
- five ops DLQ sink consumers with initial-plus-five delivery, explicit
  30/60/120/240/300-second delays, ACK-after-PostgreSQL-commit, terminal paging,
  ledger/evidence reconstruction, and no recursive DLQ;
- deterministic generation, Wrangler schema validation, and actual offline
  `wrangler deploy --dry-run` bundling for all 12 environment/Worker configs;
- strict capacity schemas and arithmetic, 14-field privacy-safe events, 13
  alerts, eight recovery controls, 11 SLOs, Access default deny, and plan
  redaction;
- adversarial rejection of routes, cache drift, retry/DLQ drift, role crossover,
  Neon API Worker-role creation, elevated catalog attestations, early DLQ ACK,
  zero sink retry, recursive DLQ, Queue-retention-only recovery,
  extra privacy-bearing log fields, missing operational controls, capacity
  arithmetic drift, and environment-name collision;
- the seven infrastructure receipts, their status separation, and every input
  digest recorded by those receipts.

The 12 bundles remain an explicitly non-deployable binding/configuration
foundation. Their mains are inert placeholders because WP4 currently exposes
factories but no PostgreSQL/Hyperdrive composition roots. Candidate acceptance
is blocked until WP4 supplies the scheduler default handler, concrete
`HarvestWorkflow` class, and harvest/normalize/projector/ops Queue/DLQ roots;
this suite rejects relabeling the placeholder as deployable.

Passing this package means `local_configuration = pass`. The exact providers
have also passed backend-disabled, credential-free schema validation in both
roots and produced identical tracked locks. This never converts a managed item
to PASS. Procurement, encrypted remote state, real IDs/secrets, staging apply,
30-minute 2x load, alert firing,
failover/PITR/reconnect/static recovery, and the separate zero-traffic
production apply remain `pending_external_authorization` under the receipt's
exact `AUTH-*` gates.
