# USHSO managed-platform foundation

This directory is the version-controlled, zero-traffic infrastructure
foundation selected by ADR 0004. It describes isolated staging and production
Neon/Cloudflare environments without creating accounts, resources, secrets,
DNS, routes, or traffic.

The authority boundary is deliberate:

- Terraform owns managed resource identity and environment-scoped state.
- Terraform creates the isolated Neon project/bootstrap owner, but Worker
  logins are created only by audited direct SQL because Neon API-created roles
  receive incompatible `neon_superuser` membership. A catalog attestation gates
  every Hyperdrive origin.
- The Cloudflare manifests own Worker bindings, Queue retry/DLQ topology,
  Workflow/Cron declarations, secret *names*, and the Access policy template.
- The two Hyperdrive cache semantics are applied to role-scoped origin configs:
  six correctness configs plus immutable-read configs for public and projector.
  Public never shares a database login or config ID with a mutation Worker.
- Rendered Wrangler JSON is generated from those manifests and schema-checked
  against the Wrangler version installed in this repository.
- Every rendered `main` points to an inert foundation placeholder and carries
  `FOUNDATION_INERT=true`. These files prove binding shape and bundling only;
  they are not live WP4 Worker composition and must not be deployed.
- Database migrations, Worker implementations, and live credentials are not in
  this directory.

The ops DLQ sink contract is equally fail closed: batch size one, initial plus
five deliveries, delays of 30/60/120/240/300 seconds, ACK only after the durable
PostgreSQL incident commit, and no second DLQ. A final failed delivery pages;
Cloudflare then deletes the message, so recovery reconstructs it from the
PostgreSQL control-plane ledger and evidence rather than Queue retention.

Both environments default to `workers_dev = false` and an empty route list.
Applying the production foundation therefore remains a distinct, zero-traffic
operation under `AUTH-11`; adding DNS or traffic is outside that authorization.

## Offline verification

From the repository root:

```sh
node verification/wp3/v1.0.0/infra/tools/render-wrangler.mjs --check
node --test verification/wp3/v1.0.0/infra/tests/*.test.mjs
node verification/wp3/v1.0.0/infra/tools/validate-foundation.mjs
```

These commands do not use the network. They do not run `terraform init`,
`terraform plan`, `terraform apply`, Wrangler deployment commands, or provider
APIs. The resulting receipts explicitly separate local configuration evidence
from managed-provider rehearsals that remain pending external authorization.

## Authorized apply sequence (not executed here)

1. Complete provider/procurement review (`AUTH-01`).
2. Approve encrypted remote state, scoped identities, resource creation,
   secrets, and Access policy (`AUTH-02`).
3. Populate only the selected environment's backend and Neon organization in
   an approved secret channel; never commit them. With the phase-two gate false,
   review and apply the Neon project/bootstrap owner only.
4. Run database bootstrap and the value-free direct-SQL Worker-login template,
   then run the catalog attestation. Hash its PASS evidence. Do not bind a
   credential if any elevated attribute or membership is present.
5. Supply the exact six-role sensitive origin map and attestation, enable the
   phase-two Cloudflare foundation, and produce a redacted staging plan; review resource names,
   account/project IDs, absence of routes, and destructive changes.
6. Apply and rehearse staging only under `AUTH-03`.
7. Run the 30-minute 2x workload and the managed recovery drills under their
   recorded authorization gates.
8. After staging acceptance, separately review and authorize the zero-traffic
   production foundation under `AUTH-11`.

Production traffic, DNS, and public promotion remain later gates. A failed
foundation apply is recovered by stopping before traffic, retaining the remote
state/audit trail, and either applying a reviewed forward correction or
destroying only newly created empty resources under a separately reviewed
operation. Database rollback is forward-only; destructive down-migrations are
not a recovery mechanism.
