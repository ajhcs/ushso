# ADR 0002: Contract versioning and shared semantics

- **Status:** Accepted
- **Decision date:** 2026-08-30
- **Decision owners:** Contracts, Architecture, API, Web, Data, Search, Planner, Machine interfaces
- **Accountable approver role:** Architecture owner
- **Acceptance basis:** Authoritative plan-execution directive dated 2026-08-30
- **Implementation state:** `in_progress`
- **Supersedes:** None
- **Superseded by:** None

## Mapped requirements and tests

| Source | Requirement or test |
|---|---|
| Plan | §5 invariants 8–10; §§6.4, 8, 13.3–13.6, 14.1–14.4, 15.6, 16.2, 19–20 (WP0–WP2, WP8–WP13), 22.1, 22.7–22.8, 23.1–23.8, and 28 |
| Tester requirements | TST-RET-01, TST-PLAN-01, TST-ID-01, TST-FIT-01, TST-SEO-01, TST-TRUST-01, TST-MCP-01–05 |
| Acceptance tests | `contract-package-immutability`, `semantic-validator.adversarial`, `generation-pin.consistency`, `machine-interface-parity`, `planner-determinism`, `coverage-denominator.contract`, `root-ci-coverage.contract`, existing v1 suites |

## Context

USHSO already publishes v1 contracts and deterministic fixtures. The program
adds ingestion, canonical, identity, publication, coverage, research-plan, and
machine-toolkit domains while moving persistence and search behind repository
ports. Modifying v1 in place would make historical receipts unreproducible and
could silently break current clients.

JSON Schema can enforce shape but cannot by itself prove evidence resolution,
temporal consistency, access claims, identity state, graph acyclicity,
denominator units, generation coherence, or product-boundary safety. Meanwhile,
implementing those decisions independently in UI, API routes, WebMCP tools,
coverage code, and planner would create several conflicting truths.

## Decision

### Immutable packages

Release these production packages as new immutable successors:

```text
contracts/core/v2.0.0/
contracts/ingestion/v1.0.0/
contracts/identity/v1.0.0/
contracts/publication/v1.0.0/
contracts/coverage/v1.0.0/
contracts/research-plan/v1.0.0/
contracts/machine-toolkit/v1.0.0/
```

Existing v1 packages and fixtures remain byte-stable. Development contracts may
use explicit `v0.x.y` directories, but no released directory is edited in place.
Every change receives a new SemVer directory and manifest, even during
development. Public promotion requires a stable package, frozen manifest,
positive and adversarial fixtures, semantic validators, and validation receipt.

SemVer meaning is:

- **major:** a previously valid payload can become invalid, a field changes
  meaning, or a consumer must change behavior;
- **minor:** a backward-compatible capability is added under the package's
  declared extensibility rules;
- **patch:** semantics are unchanged and a defect can be corrected without
  changing valid/invalid payload sets or canonical output.

Strict objects reject unexpected properties unless the schema explicitly
defines an extension map. New enum values are breaking unless the field's
contract explicitly defines unknown-value handling. Database schema versions,
wire contract versions, evaluator versions, and projector/planner fingerprints
are independent pins and must never be inferred from one another.

### Package contents and integrity

Each contract package contains:

- machine schemas with stable `$id` values and explicit `contract_version`;
- a manifest listing every artifact hash, schema dialect, package version,
  canonicalization algorithm, and compatibility/deprecation metadata;
- valid, boundary, and adversarial fixtures;
- semantic validators and a public validator entry point;
- generated type artifacts where used, with generator/version fingerprints;
- tests proving schema compilation, fixture disposition, unknown-field policy,
  canonicalization, and backward-compatibility claims;
- a validation receipt naming exact inputs, commands, results, and hashes.

Use JSON Schema 2020-12 for successor JSON contracts. Canonical digests use one
versioned canonical-JSON algorithm; transport-only request IDs, trace IDs, and
response timestamps are excluded only where the contract's claim manifest says
so. Contract manifests and receipts state whether a hash covers raw file bytes
or canonical JSON to prevent ambiguous comparisons.

### Shared semantic services

Implement critical semantics once in domain services behind versioned service
interfaces. The human UI, crawler HTML, JSON API, WebMCP, coverage reports, and
planner are adapters over those services. They may select or format fields but
may not recalculate:

- object identity, family state, or join evidence/compatibility;
- access class, requirements, authorization state, or machine readiness;
- source/release coverage, unknown state, denominator membership, or absence
  permission;
- publication generation and canonical/SEO/coverage pins;
- plan status, critical claims, truth-boundary flags, or evidence resolution.

Every public response resolves one immutable publication manifest through the
cache-disabled control path, then passes all explicit generation, canonical
revision, SEO, and coverage IDs through each query. No cacheable query or
`published_*` view may internally dereference the mutable active pointer.
API/WebMCP parity tests compare a versioned critical-field conformance manifest,
not incidental prose or transport metadata.

### Required validators

Schema validation is followed by deterministic semantic validation for at least:

- evidence and object-reference resolution;
- append-only supersession, effective-time overlap, four-clock separation, and
  cycle rejection;
- visibility/access/requirement/authorization separation and overclaim checks;
- identity candidate/review/family state transitions and exact-identifier policy;
- join field/release applicability, evidence, compatibility, requirements, and
  blockers;
- coverage unit, denominator, membership, partition, unknown, and exclusion
  invariants;
- projection-manifest coherence, checksums, and generation pinning;
- research-plan graph acyclicity, claim/evidence coverage, deterministic digest,
  exact executable IDs, and product-boundary safety;
- machine-tool cardinality, byte, pagination, truncation, action-disclosure, and
  generation-expiry behavior.

Validators fail closed and return bounded, stable reason codes plus JSON
Pointers. They do not silently repair, infer, or upgrade truth-bearing claims.

### Compatibility and deprecation

No v1 deprecation occurs during initial cutover. Successor services keep current
`POST /api/discover`, `GET /api/catalog`, stable dataset dereference, and tested
legacy WebMCP behavior until an explicit deprecation ADR, client review, notice
period, and post-soak receipt approve retirement. Compatibility adapters may
translate only representational differences; they cannot invent evidence,
upgrade unknowns, or weaken the product boundary.

The static adapter and immutable fixtures run the same repository/route contract
suite as database-backed adapters. A successor package is promoted only when
root CI discovers it automatically and both its own validation receipt and all
dependent parity suites pass.

## Alternatives considered

### Edit v1 schemas and fixtures in place

Rejected. Historical releases, evaluation results, rollback behavior, and client
expectations would no longer be reproducible.

### JSON Schema as the sole source of validation

Rejected. Core safety properties are relational, temporal, graph-based, or
cross-object and cannot be expressed reliably by shape validation alone.

### Duplicate validation in each adapter

Rejected. UI, API, WebMCP, coverage, and planner would drift, especially around
unknowns, access, identity, generation pins, and truth-boundary fields.

### A mutable `latest` contract

Rejected. A convenience endpoint may redirect or advertise a version, but every
payload, manifest, cache key, receipt, and client pin resolves to an immutable
version.

### Generate all public payloads directly from database rows

Rejected. Storage is an implementation detail and cannot safely define stable
wire semantics, semantic validation, bounded outputs, or compatibility.

## Consequences

- Contract changes require new packages and explicit compatibility work, which
  is slower but auditable.
- Shared services reduce drift while making their versioning, ownership, and
  test coverage release-critical.
- Strict schemas and reason codes expose previously hidden ambiguity instead of
  accepting permissive payloads.
- A single request carries several explicit pins; this increases envelope size
  but prevents cross-generation mixtures.
- Formatters remain free to present human-readable content, but they cannot
  change critical facts or decisions.

## Compatibility and rollout

WP2 freezes package manifests and the retrieval evaluator/cohort contracts
before tuning. WP1 repository ports and static adapters protect current behavior.
WP3–WP9 populate and publish pinned canonical/search/coverage state. WP10–WP13
consume the same services through planner, API, UI, WebMCP, and crawler adapters.
WP14 retains v1 and static rollback until the explicit retirement gate.

## Implementation and verification

| Control | Owner | State | Receipt target |
|---|---|---|---|
| ADR and package/version policy | Contracts + Architecture | implemented | `verification/wp0/v1.0.0/receipts/contract-versioning-adr.json` |
| Successor schemas, fixtures, manifests, validators | Contracts | not_started | `verification/wp2/v1.0.0/receipts/all-contract-packages.json` |
| Retrieval evaluator/cohort freeze before tuning | Search + Evaluation | in_progress | `verification/wp2/v1.0.0/receipts/retrieval-evaluator-v2-freeze.json` |
| Static/database adapter route parity | Platform | not_started | `verification/wp1/v1.0.0/receipts/repository-adapter-contract.json` |
| API/WebMCP critical-field parity | API + Web + Machine interfaces | not_started | `verification/wp12/v1.0.0/receipts/machine-interface-conformance-manifest.json` |
| Warm-cache generation-pin consistency | Platform + Search | not_started | `verification/wp8/v1.0.0/receipts/warm-cache-pointer-flip.json` |
| v1 compatibility and deprecation protection | Release engineering | not_started | `verification/wp14/v1.0.0/receipts/v1-compatibility.json` |

## Unresolved and externally authorized work

The versioning and semantic-ownership decisions are closed. The public WebMCP
search transition and final default tool count remain scheduled decisions before
machine-toolkit v1 freeze; they must use the same services regardless of naming.
No contract record authorizes production deployment, external publication, or
v1 deprecation. Those actions require the plan's quality gates and explicit
authorization.
