# WP1 repository abstraction and static rollback

WP1 places the public Worker behind four read-only ports without changing the
published v1 API. The default runtime remains the immutable v1.1.0 static asset
bundle. No PostgreSQL, Hyperdrive, R2-write, Queue, Workflow, connector, or
source-network capability is present in this path.

## Ports and semantic service

| Port | Static implementation | WP1 behavior |
|---|---|---|
| `CatalogRepository` | `StaticAssetCatalogRepository` | Reads records, aliases, families, routes, and corpus counts from staged assets |
| `SearchBackend` | `StaticSearchBackend` | Executes the promoted `worker/retrieval-v1.1.0.mjs` engine |
| `CoverageRepository` | `StaticCoverageRepository` | Returns typed `unknown` with `absence_claim_permitted: false` |
| `PlannerRepository` | `StaticPlannerRepository` | Fails closed with `planner_unavailable` |

`PublicQueryService` is the only semantic dependency of the repository-backed
API routes. At the start of each health, browse, discover, or dataset request it
resolves exactly one deeply frozen `PublicationReadContext`. The identical
object is passed to every repository call made by that request. The context pins
the v1.1.0 corpus content fingerprint and promoted retrieval algorithm but is
not added to the immutable v1 response envelope.

The v1 response adapter preserves the existing property order, retrieval-ID
algorithm, browse ordering, alias handling, family counts, join-route selection,
warning text, cache headers, status codes, and error bodies. Successor APIs may
expose the generation fields after their own contract and rollout gates; WP1
does not mutate v1.

## Production-engine pin

The static search adapter receives its engine through dependency injection. The
default composition uses `worker/retrieval-v1.1.0.mjs`, whose WP1 source SHA-256
is `b1e104055dc5e00b66769773ee33fe8c364aa7d3c7c872367145666bcb06dd5b`
and whose corpus algorithm fingerprint is
`b17c49fcd3f5fd1a09c38902f8733437e366b75f1e764a92cadf3f9788116ae6`.
The static adapter does not import the distinct historical evaluator module.

## Static rollback

`worker/static-entry.mjs` is the explicit emergency-static entry point. It
requires only the existing `ASSETS` binding and uses the same immutable corpus,
verification overlay, contract asset, and response path as the default Worker.
It does not select a repository from an untrusted request parameter or header.

Build the rollback entry without deploying it:

```bash
WRANGLER_LOG_PATH=/tmp/ushso-wp1-wrangler.log \
  node scripts/run-wrangler.mjs deploy worker/static-entry.mjs \
  --dry-run --outdir /tmp/ushso-wp1-static-dry-run
```

The dry run must list only `env.ASSETS`. A source/bundle audit must find no
database client, Hyperdrive, R2-write, Queue, Workflow, connector, or source
credential dependency. The generated bundle is reproducible from repository
source; its run-specific digest is recorded in the WP1 verification receipt.

## Verification

Focused checks are:

```bash
node --test tests/worker-contract.test.mjs \
  tests/release-features.test.mjs \
  tests/wp1-repository-abstraction.test.mjs
npm run release:audit
npm run build
npm run cf:dry-run
```

The WP1 suite compares the repository service with the pre-refactor browse and
dataset response construction, compares discovery directly with the promoted
engine, verifies exact serialized response bytes and cache headers, checks one
publication context per request, tests typed coverage/planner behavior, and
executes the explicit rollback entry with an environment that throws on access
to any binding other than `ASSETS`.

The receipt is
`verification/wp1/v1.0.0/receipts/repository-adapter-contract.json`. It is a
local implementation and dry-run receipt, not evidence of a production deploy,
database cutover, canary, managed-service recovery drill, or completed WP14
rollback window.
