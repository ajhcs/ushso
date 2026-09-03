# WP3 aggregate verification

This versioned package is the fail-closed, read-only entry point for WP3. It
covers both sibling domains instead of treating the presence of either
`infra/` or `db/` as sufficient.

The generic offline gate is:

```sh
npm test --prefix verification/wp3/v1.0.0
npm run validate --prefix verification/wp3/v1.0.0
```

It runs the infrastructure Node tests, deterministic Wrangler render check,
credential-free Wrangler dry-run for all 12 inert configurations, the full
infrastructure validator, and the database static validator. It also checks the
exact union of seven infrastructure receipts and four database receipts,
including every receipted input digest and the database result/manifest seal.
Missing or stale evidence in either domain fails the package; no domain is
silently skipped.

The following lanes are deliberately excluded from the generic runner:

- `npm run test:db:local-docker --prefix verification/wp3/v1.0.0` uses the
  already-installed `postgres:16-alpine` image, creates an isolated
  network-disabled container, and rewrites the local database result and four
  database receipts. Run it only as the explicit local synthetic database
  rehearsal documented in `db/README.md`.
- Terraform provider-schema validation uses Terraform 1.16.0 with
  `init -backend=false -input=false` and `validate -json` in each isolated
  staging/production root. The exact Cloudflare 5.24.0 and Neon 0.15.0 result
  and identical lock digest are recorded in
  `receipts/provider-capability-review.json`; the generic gate verifies that
  receipt but does not initialize providers or contact a registry.
- Provider plan/apply, managed database behavior, recovery drills, and even the
  zero-traffic production foundation remain behind their recorded `AUTH-*`
  gates. This package never upgrades those pending items to PASS.

All generic commands are verification-only: they do not write receipts, run a
Terraform plan/apply, use credentials, call provider APIs, bind host ports, or
create traffic routes.
