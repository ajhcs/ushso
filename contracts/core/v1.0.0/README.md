# Observatory Core Contract v1.0.0

This package is the canonical metadata truth contract for the United States Health Systems Observatory. It models durable objects and separately addressable claims, access observations, evidence, and typed relationships. It is offline, fixture-first, metadata-only, and immutable.

## Critical distinction: core truth versus search view

`observatory-record.v1.0.0`, currently used by `observatory/index/v1.0.0`, is a **denormalized discovery/search view**. It is useful for retrieval and ranking, but it is not source truth. A search row may be regenerated or replaced from core rows. It must not erase the assertions, access observations, evidence, relationships, native identifiers, or supersession history that produced it.

[examples/denormalized-search-view-projection.json](examples/denormalized-search-view-projection.json) shows the required projection boundary. It declares `source_of_truth: false` and carries pointers back to the core IDs used to make the view.

## Core entities

| Entity | Responsibility |
| --- | --- |
| `ObservatoryObject` | Durable internal node with one or more exact, source-native identifiers |
| `ObservableResource` | Specialized object with role `repository`, `catalog`, `source`, `dataset`, `distribution`, `service`, `documentation`, `version`, or `capture` |
| `Organization` | Object with role `organization`, kept separate from the resources it operates |
| `Assertion` | Subject-predicate-value claim with origin, evidence, confidence, verifier, observation time, status, and non-destructive supersession |
| `AccessObservation` | Time-bound access state separating catalog visibility, data access, requirements, mechanisms, and infrastructure condition |
| `Evidence` | Metadata-only evidence locator/digest/availability record; never a response body or dataset payload |
| `Relationship` | Typed edge between objects with its own origin, evidence, confidence, verifier, status, and supersession history |

The normative schemas are JSON Schema Draft 2020-12 under `schemas/`. All schemas use `additionalProperties: false` at record boundaries.

## Identity rules

- `object_id` is an Observatory address, not a replacement for a source ID.
- Every object has at least one `native_identifiers` entry with `preservation: exact`, the originating object, case behavior, and evidence.
- Repository, catalog, source, dataset, distribution, service, documentation, version, and capture nodes remain distinct even when one portal publishes all of them.
- Possible duplicates use an unresolved `identity_candidate_for` relationship. They are not silently merged or promoted to exact identity.
- Canonical identity resolution remains outside this fixture package and must preserve the shared identity-index precedence and ambiguity rules.

## Supersession without destruction

Assertions, access observations, and relationships have the same status/supersession mechanism:

- The prior record remains present with `status: superseded` and `superseded_by_id`.
- The replacement lists the prior ID in `supersedes_ids`.
- Both directions and a rationale are required.
- The validator rejects missing references, one-way links, and cycles.

The fixture includes both `pos-data-through-2025` and its synthetic replacement `pos-data-through-2026`, plus two generations of the access observation. These values demonstrate lineage mechanics only and are explicitly not live source claims.

## Access and evidence safety

Catalog visibility never proves data access. `AccessObservation` stores these independently alongside typed requirements and infrastructure states. Every fixture says `not_tested_offline`; no endpoint was contacted.

Evidence records contain only locators, optional hashes, availability, descriptions, and origin metadata. Keys such as `payload`, `body`, `response_body`, and `dataset_rows` are rejected. No source payload, raw response, acquired dataset, login, request, or license operation is included.

## Fixture graph

The deterministic CMS Provider of Services fixture graph contains:

- 11 objects covering every requested role, including a separate unresolved source-label candidate;
- 4 assertions, including a bidirectional supersession pair;
- 2 access observations, including a bidirectional supersession pair;
- 4 evidence pointers; and
- 10 typed relationships.

All facts are offline examples. They must be replaced or supplemented by captured evidence and verification before operational use.

## Build and validate

From this directory:

```powershell
node tools/build-fixtures.mjs --fixture
node tools/build-manifest.mjs
node tools/validate-package.mjs --write-receipt
node --test tests/*.test.mjs
```

`--fixture` is mandatory. `--full`, network, fetch, HTTP refresh, and coverage-execution flags fail closed. The builder has a 1,000-row fixture cap, canonicalizes key order, sorts by durable record ID, and publishes by temporary path plus atomic rename. Re-running identical inputs is a verified no-op; conflicting immutable output fails.

This package does not acquire the `heavy-analysis` lock because it performs no large-data analysis. It does not read or edit `observatory/retrieval`, `apps/observatory-web`, coverage execution packages, or release paths.
