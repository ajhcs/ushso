# WP9 verification

This receipt package verifies the versioned coverage-accounting successor
without changing production routes, databases, or live source state.

Run in order:

```sh
node packages/coverage/accounting/v1.0.0/tools/build-package.mjs
node packages/coverage/accounting/v1.0.0/tools/validate-package.mjs
npm test --prefix packages/coverage/accounting/v1.0.0
node verification/wp9/v1.0.0/tools/verify-wp9.mjs --tests-passed
npm test --prefix verification/wp9/v1.0.0
```

The technical receipt passes locally. The section 23.4 release gate remains
blocked because product-owner wording review is external and has not been
recorded. The review packet pins the exact copy, public view, and snapshot file
digests and provides attestation language plus a mechanical recorder. Recording
that wording review does not authorize publication, deployment, database
migration, or live source access.

The reviewed 0011 SQL remains outside `db/migrations` and is sequence-blocked
behind 0007–0010. No external authorization was requested or exercised.
