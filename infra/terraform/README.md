# Terraform roots and state boundary

`environments/staging` and `environments/production` are intentionally separate
root modules. They must use different encrypted remote-state buckets/keys,
Cloudflare account scopes or resource prefixes, Neon projects, database roles,
R2 buckets, Queues, DLQs, Hyperdrive configurations, Workflows, Worker names,
Access applications, secrets, and service identities.

Terraform 1.16.0, `cloudflare/cloudflare` 5.24.0, and `kislerdm/neon` 0.15.0
are exact pins because this is a reproducible release candidate, not a floating
development setup. Backend-disabled, credential-free initialization generated
identical reviewed locks in both roots, and provider-backed `validate -json`
returned `valid=true`, zero errors, and zero warnings for staging and production.
That is local provider-schema evidence only: no backend, state, plan, apply,
credential, provider API, or resource behavior was exercised.

Backend example files contain no account IDs, endpoints, access keys, or
credentials. Supply them through the approved CI/environment secret channel.
The state contains sensitive Hyperdrive/Neon origin material and must be
encrypted, access controlled, versioned, recoverable, and isolated before the
first plan with real values.

Terraform creates only the Neon project and its direct-only bootstrap owner.
It does not use `neon_role` for Workers: Neon control-plane-created roles are
automatic `neon_superuser` members. After database bootstrap, the reviewed
direct-SQL template creates the six LOGIN roles with negative privilege options,
revokes `neon_superuser`, and grants only each matching `ushso_<role>` NOLOGIN
capability role. A second catalog template must attest all six roles before the
phase-two Cloudflare module may exist. The attestation digest/fields and the
sensitive exact-key origin map are independent required Terraform inputs.
The attestation runner accepts only an environment name, resolves the exact
project, branch, endpoint, direct host, and bootstrap credential from that
environment's Terraform outputs, and uses TLS `verify-full`. Terraform
recomputes the versioned canonical evidence digest and checks the proof window
with apply-time `timestamp()`, so neither an altered envelope nor a saved plan
applied after expiry can bind credentials.

The roots deliberately support two zero-traffic phases. With
`cloudflare_foundation_enabled = false`, the authorized first apply creates only
the Neon project/bootstrap path and requires no dummy Worker credential. After
SQL role creation and a PASS attestation, the reviewed plan sets the gate true
and supplies `database_origins` only through the secret channel. Each Worker
role then receives a distinct Hyperdrive origin login mapped only to its
matching `ushso_<role>` NOLOGIN capability role. Cache semantics are a separate
axis: all roles have a cache-disabled correctness config; only public and
projector additionally receive a role-scoped immutable-read config. A public
Worker therefore cannot reuse a mutation credential merely because both code
paths call the binding `HD_CORRECTNESS`.

The active modules provision the resource types whose stable provider schema is
captured in the reviewed template. Wrangler deploys Worker versions and
Workflow bindings only after Terraform has produced environment-scoped IDs.
No root declares routes, custom domains, DNS records, or traffic percentages.

Every ops DLQ consumer uses batch size one, an initial delivery plus five
retries, a 30-second Wrangler default delay with the application contract's
30/60/120/240/300-second schedule, ACK only after the PostgreSQL incident
transaction commits, and no recursive DLQ. After final failure Cloudflare
deletes the message; the alert/runbook requires reconstruction from the
PostgreSQL control-plane ledger and referenced evidence, not Queue retention.
