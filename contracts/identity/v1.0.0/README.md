# USHSO identity contract v1.0.0

This immutable contract package defines conservative identity resolution,
family/version grouping, temporal review history, and field-bound join routes.
It implements the semantic boundary in the Research Navigator implementation
plan §§5, 7, 8, and 11, WP2/WP7, and ADR 0003.

The package is metadata-only and validation is offline. It neither contacts an
authoritative source nor reads healthcare payload rows. It never mutates an
identity graph, executes an analysis, or authorizes a production automatic
resolution rule.

## Three independent graphs

The model keeps three questions separate:

1. `relationship-projection` records accepted identity equality or a separately
   typed family edge. Only a current human `same_identity` decision or an exact
   authority policy whose sealed stratum passed every gate can create active
   equality.
2. `family` and `family-membership` represent version, mirror, successor,
   format, and collection relationships. Membership never implies equality.
3. `join-route` and `transformation-step` bind a named research purpose to exact
   releases, distributions, schema snapshots, field revisions, and an identity
   snapshot valid during the route's applicability interval. A join never
   implies identity.

Unresolved, open, deferred, ambiguous, rejected, and superseded records remain
separate and auditable. Source-native observations are retained when an accepted
projection is created or reversed.

## Automatic resolution policy

Automatic equality is disabled by default. A namespace may enable one exact
rule only after it records all of the following:

- issuing authority, source scope, entity types, grains, case behavior,
  normalization/check rules, uniqueness and reuse policy, and effective-date
  policy;
- a sealed identifier/entity stratum with at least 50 adjudicated positives, 50
  hard negatives, and 20 temporal/reuse/conflict cases;
- zero false automatic merges, candidate recall of at least 95%, and an explicit
  enablement receipt.

The two assertions must then have the same namespace and normalized value,
authoritative status, passing checks, compatible entity and grain, complete
overlapping effective periods, and no conflicting authoritative identifier.
Source-local identifiers cannot cross sources. Title, publisher, URL,
description, locator, semantic, or embedding similarity always remains a review
candidate regardless of score.

The enabled CMS CCN namespace in `fixtures/valid-bundle.json` is a synthetic
contract fixture that exercises the positive path. The validation receipt fixes
`production_auto_resolution_authorized` to `false`; it is not a production
namespace approval or benchmark receipt.

## Append-only review and reversal

Review decisions support `same_identity`, `not_same_identity`, `family_member`,
`mirror_of`, `successor_of`, `defer`, and `needs_more_evidence`. Decisions are
immutable, carry reviewer/rationale/evidence/algorithm/time fields, and form an
acyclic reciprocal supersession chain. A current human-review candidate has
exactly one current decision.

`reversal-plan` pins the input and output graph revisions and requires rebuilding
all five downstream targets: identity clusters, aliases, search projections,
join views, and planner fixtures. Both source observations and identifier
assertions are retained; destructive deletion and orphaned lineage are forbidden.

## Join axes

Each transformation step carries independent fields for:

- `operation_kind`: join, crosswalk, aggregate, filter, temporal alignment, or
  measure harmonization;
- `evidence_state`: unknown, candidate, ambiguous, documented, observed,
  executed, or proven;
- `compatibility`: compatible, conditional, incompatible, or unknown;
- typed requirements and their satisfaction state;
- blockers, from which `derived_readiness` is calculated.

Documented routes require field-level documentation, schema, or authoritative
crosswalk evidence. Same-named fields are only candidate evidence. `executed`
and `proven` require controlled-test or external evidence with an explicit
non-public execution context; they never mean USHSO executed a public user's
plan. Aggregation cannot satisfy a crosswalk requirement.

## Schemas and fixtures

All schemas use JSON Schema 2020-12, compile in strict mode, and set
`additionalProperties: false` on every production object. The package contains
schemas for namespace policies, identifier assertions, candidates, review
decisions, accepted projections, families, memberships, transformation steps,
join routes, reversal plans, the package manifest, and the validation receipt.

`fixtures/valid-bundle.json` covers every candidate state, review decision kind,
family kind, operation kind, evidence state, compatibility value, and requirement
state. `fixtures/adversarial-cases.json` includes fuzzy auto-merge, identifier
reuse, entity/grain conflict, family-to-identity, candidate-to-documented,
historical-snapshot, aggregation/crosswalk, supersession-cycle, unresolved
equality, and reversal-integrity failures.

## Deterministic digests

The manifest distinguishes two non-interchangeable digest classes:

- `byte_sha256` hashes exact stored bytes;
- `canonical_json_sha256` hashes parsed JSON using recursively sorted object
  keys, preserved array order, UTF-8, and no terminal newline.

The package payload digest hashes the ordered manifest tuples, not the manifest
file bytes. The manifest excludes itself and the validation receipt to avoid a
self-referential digest. The receipt records the exact manifest byte digest,
package payload digest, and a deterministic validation-input digest.

## Validation

From the repository root:

```sh
npm test --prefix contracts/identity/v1.0.0
npm run validate --prefix contracts/identity/v1.0.0
```

For a new, not-yet-published contract version, build artifacts only after all
payload files are final:

```sh
npm run manifest --prefix contracts/identity/v1.0.0
npm run receipt --prefix contracts/identity/v1.0.0
```

Manifest and receipt writers fail closed if an immutable target already exists.
Any payload change after publication requires a new contract version.
