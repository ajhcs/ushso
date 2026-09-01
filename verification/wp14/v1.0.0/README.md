# WP14 local cutover and retirement foundation v1.0.0

This versioned package is a fail-closed release-control foundation for Research Navigator section 24 and WP14. It is fixture-only and zero-traffic. It neither deploys nor authorizes a deployment.

Implemented locally:

- exact candidate, Git base tree, configuration, migration, search, static, coverage, planner, machine-toolkit, SEO, and authorization-register binding;
- sealed state transitions for expand, backfill, shadow, internal canary, gradual public promotion, rollback, soak, and retirement;
- exact candidate/environment authorization receipts in addition to the central register;
- fixture shadow parity for detail, browse, search, coverage, and disabled-plan surfaces;
- two simulated connector refreshes and two simulated rebuild/promote/rollback cycles;
- atomic generation pointer rollback, Worker-plus-asset rollback, and database-independent static fallback;
- N-1/current-schema contract, cross-version asset-skew matrix, rollback bundle, abort thresholds, and failure injection;
- explicit 30-day plus two-live-cycle soak denominators and fail-closed runtime JSONL retirement;
- byte pins proving the current Worker and both JSONL bundles remain intact.

Not implemented or claimed as operational evidence:

- managed staging/production apply;
- production-like load or query-plan measurement;
- live source shadowing, internal canary, or public traffic;
- managed failover, PITR, Hyperdrive reconnect, or live static activation;
- elapsed production soak or qualifying live cycles;
- runtime JSONL retirement.

Run:

```sh
npm test --prefix verification/wp14/v1.0.0
npm run verify --prefix verification/wp14/v1.0.0
npm run inspect --prefix verification/wp14/v1.0.0
npm run rehearse --prefix verification/wp14/v1.0.0
```

`inspect` and `rehearse` only print JSON to stdout. The package has no runtime dependencies, network client, provider CLI, database client, or file-writing path. Its production-mode state machine can be exercised in memory by tests but refuses the checked-in local candidate because the shared worktree is not one clean exact candidate and the external gates are false.

Authoritative operator instructions are in `docs/WP14_CUTOVER_RETIREMENT_RUNBOOK.md`. `evidence-ledger.json` and `requirements-dod-mapping.json` deliberately leave live acceptance and Definition-of-Done items false.
