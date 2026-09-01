# WP7 verification v1.0.0

This evidence package maps every non-database WP7 requirement to implementation,
tests, and a typed receipt. It validates the frozen core, identity, use/access,
and research-plan contracts in the same offline run.

Run:

```sh
npm test --prefix packages/identity
npm test --prefix evaluation/identity/v1.0.0
npm test --prefix verification/wp7/v1.0.0
npm run verify --prefix verification/wp7/v1.0.0
npm run validate --prefix verification/wp7/v1.0.0
npm run export-reviewer-packet --prefix evaluation/identity/v1.0.0
```

The aggregate runner uses Node's in-process test isolation so it neither binds a
port nor starts a server. It performs no network request and reads no source
payload.
Both `verify` and `validate` recompute the identity, evaluation, and WP7 package
seals and reject any receipt that upgrades pending external evidence.

The receipts distinguish controlled mechanical evidence from real human
adjudication. No reviewer agreement or kappa is claimed: both remain null with
zero externally verified reviews. Every automatic identity rule remains
`disabled_candidate_only` pending real 50/50/20 per-stratum adjudication floors
and an independently authorized enablement receipt. Automatic enablement is
optional and is not a candidate-only release blocker. `AUTH-14` is the recorded
blocker-register reference for the future external identity adjudication. Its
current state is `not_requested` and `authorized:false`; it grants no permission.
The digest-bound blinded reviewer packet and bounded import validator are
prepared, but no reviewer roster, human decision, completed adjudication
receipt, or import receipt is present. An explicit scoped authorization and a
newly reissued packet are required before review begins.

Database migrations are not part of this receipt. `0008` and `0009` remain
`pending_wp6_dependency_clearance`; no file under `db/**` is changed here.
