# ADR 0000: ADR policy and repository shape

- **Status:** Accepted
- **Decision date:** 2026-08-30
- **Decision owners:** Architecture, Platform, Data, Search, Planner, Web, Security
- **Accountable approver role:** Product owner
- **Acceptance basis:** Authoritative plan-execution directive dated 2026-08-30
- **Implementation state:** `in_progress`
- **Supersedes:** None
- **Superseded by:** None

## Mapped requirements and tests

| Source | Requirement or test |
|---|---|
| Plan | §§5, 6, 8, 19, 20 (WP0–WP14), 21, 22.8, 23, 24, and 28 |
| Tester requirements | TST-MCP-03 (one API/Web semantic architecture); all other TST IDs inherit the repository and receipt rules |
| WP0 acceptance | Existing v1 contracts remain immutable; non-goals become release invariants; ADR decisions have durable verification targets |
| Acceptance tests | `adr-documentation.audit`, `repository-boundaries.contract`, `root-ci-coverage.contract`, `release-receipt.completeness` |

## Context

USHSO currently combines immutable static retrieval assets, a Worker, a browser
application, and several independent contract and evaluation packages. The
research-navigator program adds persistent registry, ingestion, identity,
publication, coverage, planning, machine-interface, and operations concerns.
Without a stable package layout and decision policy, shared semantics can split
between the Worker, UI, API, WebMCP adapters, evaluators, and database code.

The implementation plan's proposed shape is deliberately separable by plane.
The existing `createWorker` injection seam, v1 contracts, deterministic fixtures,
and static production corpus are also required compatibility and rollback
assets. The repository must support incremental migration without prematurely
coupling public delivery to source harvesting or mutable control-plane state.

## Decision

### Decision records

Use sequential four-digit ADR numbers under `docs/adr/`. Follow the status,
implementation-state, immutability, and supersession policy in this directory's
[index](README.md). A plan-required material deviation is recorded before the
dependent implementation is promoted. ADR acceptance cannot waive a plan
quality gate or convert an external authorization into implied permission.

### Repository boundaries

Adopt these top-level ownership boundaries:

```text
contracts/                immutable machine contracts, fixtures, validators
db/migrations/            forward-only PostgreSQL migrations
db/seeds/                 deterministic migration and evaluation seeds
db/queries/               reviewed query modules and query-plan fixtures
packages/registry/        canonical read/write domain and repository ports
packages/connectors/      connector SDK, policies, adapters, fixtures
packages/ingestion/       run, checkpoint, outbox, retry, and recovery logic
packages/normalization/   native-to-canonical proposals and lineage
packages/identity/        candidate, review, family, and join semantics
packages/search/          projection and SearchBackend implementations
packages/coverage/        denominator definitions, facts, and snapshots
packages/planner/         deterministic evidence-bound plan compiler
packages/machine-toolkit/ shared bounded machine capabilities and adapters
services/                 least-privilege control-plane Worker entry points
worker/                   read-only public API and HTML delivery
apps/web/                 browser presentation over public services
evaluation/               sealed cohorts, evaluators, and quality fixtures
verification/             immutable, versioned verification receipts
infra/                    declared Cloudflare/database infrastructure
docs/                     product, architecture, operations, and decisions
```

Directories may add internal modules, but code must stay in the plane that owns
its truth. Cross-plane dependencies use explicit ports or versioned contracts;
they do not reach through another package's storage implementation.

### Dependency and runtime rules

1. Public routes depend on `CatalogRepository`, `SearchBackend`,
   `CoverageRepository`, and `PlannerRepository` ports, never directly on static
   JSONL or connector code.
2. Keep `StaticAssetCatalogRepository` as a contract-tested emergency adapter
   until WP14 retirement gates and the rollback window pass.
3. The database is authoritative for accepted canonical and operational state;
   search documents are replaceable, non-authoritative projections.
4. Connector and control-plane services may depend on canonical write ports.
   The public Worker must not depend on connector modules, source credentials,
   source-network clients, R2 write APIs, queues, or workflow mutation APIs.
5. UI, JSON API, WebMCP, crawler HTML, coverage, and planner adapters call shared
   canonical service methods governed by ADR 0002. Presentation layers may not
   reimplement critical truth decisions.
6. Root CI discovers and runs every supported contract, migration, connector,
   search, planner, machine-interface, Worker, web, build, and release gate named
   by plan §22.8. Live source calls remain outside ordinary CI.
7. Generated artifacts include their source manifest and generator fingerprint.
   Versioned receipts identify the exact inputs, commands, code revision when
   available, timestamps, outcomes, and artifact hashes.

### Migration discipline

Database migrations are forward-only and additive through the cutover and
rollback window. Operational rollback switches an immutable publication or the
static read adapter; it never depends on a destructive down-migration. Existing
v1 assets remain byte-stable until their documented deprecation and retirement
gate completes.

## Alternatives considered

### Extend the current Worker/static package in place

Rejected. It preserves short-term simplicity but couples ingestion, truth,
projection, and delivery, keeps full-corpus runtime loading, and makes the
required database/static adapter parity difficult to test.

### One package per deployable Worker only

Rejected. Deployment boundaries are not semantic ownership boundaries. It would
duplicate canonical logic across public, normalization, projection, and ops
Workers and make API/WebMCP parity accidental.

### Split immediately into independent databases and repositories

Rejected for the initial program. It introduces distributed transactions and
cross-service consistency before workload evidence requires them. PostgreSQL
schemas, roles, packages, and explicit ports preserve later extraction options.

### Rewrite the existing public surface before adding repository ports

Rejected. The plan requires unchanged public behavior and a deployable static
fallback while the persistent path is built and proven.

## Consequences

- Ownership and test discovery become explicit, and new runtime services can be
  introduced without changing public contracts.
- Some concepts appear in both a contract package and an implementation package;
  released wire semantics belong to the contract, while behavior belongs to the
  implementation.
- Cross-package changes require deliberate contract/version work instead of
  convenient internal imports.
- Retaining static adapters, fixtures, and v1 packages costs maintenance during
  migration but supplies required differential tests and rollback.
- `verification/` grows as an auditable evidence ledger; receipts are evidence,
  not substitutes for passing gates.

## Compatibility and rollout

WP1 first introduces repository ports and static adapters with no public behavior
change. WP2 adds successor contract packages. WP3–WP13 add implementations behind
the ports. WP14 may retire runtime JSONL only after canary, soak, compatibility,
rollback, performance, privacy, and receipt gates pass. Directory movement must
preserve stable imports through package exports or an explicitly versioned
migration.

## Implementation and verification

| Control | Owner | State | Receipt target |
|---|---|---|---|
| ADR format, index, and supersession policy | Architecture | implemented | `verification/wp0/v1.0.0/receipts/adr-documentation-audit.json` |
| Repository ports and static adapters | Platform | not_started | `verification/wp1/v1.0.0/receipts/repository-adapter-contract.json` |
| Complete root CI package discovery | Release engineering | not_started | `verification/wp2/v1.0.0/receipts/root-ci-package-matrix.json` |
| Forward migration/static rollback discipline | Data + Platform | not_started | `verification/wp14/v1.0.0/receipts/rollback-rehearsal.json` |
| Shared API/WebMCP semantic architecture | API + Web | not_started | `verification/wp12/v1.0.0/receipts/machine-interface-conformance-manifest.json` |

## Unresolved and externally authorized work

No external action is authorized by this ADR. Provider procurement, resource
creation, production migration, canary traffic, deployment, and remote push
remain separate explicit authorization boundaries. Specific infrastructure
choices belong to ADR 0004. Any repository-shape deviation that changes semantic
ownership requires a successor ADR and product-owner review.
