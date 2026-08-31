# Neon environment foundation

This module creates one environment-named Neon project with one protected
default branch, one direct read-write endpoint, an explicit compute/suspension
policy, and a 30-day history-retention target. It intentionally creates no
Worker role through the Neon API: Neon documents that API-created roles become
members of `neon_superuser`, which is incompatible with the Worker boundary.

The default branch owner is a direct-only bootstrap identity created by
`neon_project`. After the database bootstrap has created the seven NOLOGIN
capability roles, an authorized operator runs the value-free
`bootstrap-role-grants.sql.tftpl` with six generated passwords supplied as
quoted `psql -v` variables from the approved ephemeral secret channel. The SQL
creates six distinct LOGIN roles with all elevated attributes disabled,
revokes any `neon_superuser` membership, grants each login only its matching
capability role, and lets the bootstrap identity assume `ushso_maintenance`.

Before any Hyperdrive apply, run `run-prebinding-attestation.mjs --environment
staging|production`. It accepts no host/project/branch/endpoint override. The
runner resolves those four values, the bootstrap identity/password, database,
and six login names from the exact environment root's sensitive Terraform
outputs, connects to that resolved direct host with TLS `verify-full`, and runs
`prebinding-attestation.sql.tftpl`. The receipt binds the exact environment,
Neon project/branch/endpoint IDs, direct host, six login names and catalog
fields, template digest, evidence digest, and a validity window no longer than
15 minutes. Terraform recomputes SHA-256 over the same versioned canonical
material and uses apply-time `timestamp()` to refuse a changed, future, or
expired receipt, including when a saved plan is applied late. The SQL must be
rerun for a later apply.

The emitted `roles` value is already keyed by the six role names and uses
Terraform's exact `database_role`/`login_user` field names; operators must not
reshape the catalog evidence between SQL and the sensitive Terraform input.
Terraform also refuses every origin unless `rolsuper`,
`rolbypassrls`, `rolreplication`, and `neon_superuser_member` are false and the
receipt digest is present. The sensitive password map is supplied separately;
no password appears in a tracked file or Terraform output. The bootstrap
password/object must never be copied to Wrangler, a Worker secret, Hyperdrive,
a plan log, or a tracked file.

Project creation, SQL login creation, attestation, provider lock resolution, and
all state operations remain external authorization steps. This module creates
no pooled endpoint, route, DNS record, public hostname, or traffic assignment.
