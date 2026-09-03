# USHSO architecture decision records

This directory contains the durable architecture decisions for the USHSO
research-navigator program. The authoritative program specification is the
[Research Navigator implementation plan](../RESEARCH_NAVIGATOR_IMPLEMENTATION_PLAN.md).
An ADR records how that specification is implemented; it does not weaken or
replace a plan invariant.

## Decision index

| ADR | Status | Decision | Primary work packages |
|---|---|---|---|
| [0000](0000-adr-policy-and-repository-shape.md) | Accepted | ADR policy and repository shape | WP0–WP14 |
| [0001](0001-product-and-truth-boundary.md) | Accepted | Product and truth boundary | WP0, WP2, WP10–WP12 |
| [0002](0002-contract-versioning-and-shared-semantics.md) | Accepted | Immutable contracts and shared semantic services | WP0–WP2, WP8–WP13 |
| [0003](0003-identity-family-and-join-semantics.md) | Accepted | Identity, family, and join semantics | WP0, WP2, WP6–WP8, WP10–WP12 |
| [0004](0004-postgresql-cloudflare-and-immutable-publication.md) | Accepted | PostgreSQL, Cloudflare, and immutable publication | WP0, WP3–WP4, WP8, WP14 |
| [0005](0005-postgresql-search-backend-and-benchmark-escalation.md) | Accepted | PostgreSQL search and benchmark escalation | WP0–WP2, WP8, WP14 |
| [0006](0006-retrieval-historical-schema-compatibility.md) | Accepted | Retrieval historical-schema compatibility boundary | WP0, WP2, WP8 |

ADRs 0004 and 0005 are maintained by their respective WP0 decision owners.

## Required record format

Every accepted ADR must state:

- status, decision date, decision owners by role, and accountable approver role;
- plan sections, work packages, tester requirements, and acceptance tests;
- context, decision, alternatives, consequences, and compatibility impact;
- implementation state distinct from decision status;
- verification receipt targets and any unresolved or externally authorized work;
- supersession links when a later decision changes it.

The allowed decision statuses are `Proposed`, `Accepted`, `Rejected`, and
`Superseded`. Implementation state is reported separately as `not_started`,
`in_progress`, `implemented`, or `verified`. An `Accepted` ADR therefore does
not claim that its code, migration, operational, or quality-gate work is done.

## Change and supersession policy

Accepted ADRs are append-only decision history. A material change requires a
new numbered ADR that names the superseded record, explains migration and
rollback consequences, and updates this index. Non-semantic repairs such as a
broken link or spelling correction may edit an accepted ADR but must not alter
the decision. Rejected and superseded records remain in the repository.

Contract releases follow the stricter immutability rules in
[ADR 0002](0002-contract-versioning-and-shared-semantics.md): a released schema,
fixture, manifest, or semantic validator is never edited in place.

## Verification

The WP0 documentation audit verifies that every indexed file exists, every
relative link resolves, all required headings are present, and every mapped
tester requirement has an owner, acceptance test, and receipt target. The
target receipt is
`verification/wp0/v1.0.0/receipts/adr-documentation-audit.json`.
