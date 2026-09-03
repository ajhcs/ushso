# WP9 coverage accounting successor

This package is the versioned, read-only WP9 successor to the WP1 coverage
repository abstraction. It does not modify or replace
`packages/coverage/coverage-repository.mjs` or
`packages/coverage/static-coverage-repository.mjs`; both files are verified by
byte hash on every build and validation run.

## Evidence boundary

The build reads only pinned repository artifacts and performs no network or
production action. Repository evidence establishes three different,
non-additive units:

- 14 federal metadata-validated source records, with applicability split 11
  direct, 2 crosswalk-required, and 1 unknown;
- 51 configured jurisdiction labels (50 states and the District of Columbia);
- 157 published corpus records, composed as 52 Harvard Dataverse, 50 DataCite,
  22 Pennsylvania catalog, 15 curated authoritative registry, 14 federal
  baseline, and 4 canonical base records.

The registry also defines six explicit state source classes. Their Cartesian
product with 51 jurisdictions creates 306 assessment cells. The pinned
readiness evidence is jurisdiction-level, not jurisdiction/source-class-level,
so every production matrix cell is honestly `not_assessed`. Legacy navigation,
candidate, and evidence-gap labels remain visible as noncanonical provenance
and cannot promote a cell.

The federal baseline wording is intentionally narrow: metadata-route validation
does not prove payload availability, row coverage, schema completeness, access
authorization, research fitness, or a complete inventory denominator.

## Shared semantic truth

`artifacts/denominator-definition-registry.json` embeds and hashes the frozen
`contracts/coverage/v1.0.0` metric definitions. Validation fails if the embedded
document differs canonically from the contract. The immutable snapshot contains
all 18 required metric envelopes, exact configured-scope and normalization
partitions, revision pins, membership hashes, explicit unknown/not-applicable
accounting, and absence-claim controls.

The snapshot is a migration seed. It imports registry and positioning evidence,
not canonical pipeline facts. Downstream empty cohorts are therefore explicitly
bounded and never presented as source absence or national completeness.

## Service boundary

`CoverageAccountingService` exposes bounded, snapshot-pinned views for an
eventual API adapter:

- overview and five public coverage panels;
- 18 denominator-bearing metrics;
- paged matrix cells (default 25, maximum 100);
- the 14 federal source records and applicability breakdown.

Responses are capped at 128 KiB, validate immutable cursors and snapshot pins,
propagate aborts, return cloned values, and declare zero source requests,
retrieval, payload acquisition, analysis, or identity merge. No web or Worker
route is changed by this package.

## Commands

```sh
node packages/coverage/accounting/v1.0.0/tools/build-package.mjs
node packages/coverage/accounting/v1.0.0/tools/validate-package.mjs
npm test --prefix packages/coverage/accounting/v1.0.0
```

The build is deterministic and verifies all upstream evidence hashes before
writing generated artifacts.

## SQL and rollout

The reviewed forward-only SQL proposal is under `sql/`; it is deliberately not
under `db/migrations`. It must not be moved or applied until migrations 0007
through 0010, the migration manifest, and the applicable authorization gates are
complete. Public serving should read only a sealed projection chosen by the
publication system, never mutable operations rows.

No route or database change has been activated. Rollback is therefore removal
or disengagement of this successor package from a future composition root. A
later database rollback must switch the publication pointer to a prior sealed
coverage snapshot; it must not drop 0011 tables.

Public copy is prepared but remains `pending_product_owner_review` and
`publication_authorized: false`.
