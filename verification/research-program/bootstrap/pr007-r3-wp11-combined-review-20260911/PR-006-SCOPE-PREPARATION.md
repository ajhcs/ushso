# PR-006 scope preparation — no implementation or dispatch

Read against integration a11c675b66b25441355ffc9f66bec0f0b6125bc6. PR-004 is accepted; PR-005 and its new PR-086 integration dependency remain unaccepted. This note prepares a later packet amendment and grants no independent implementation acceptance.

The retained full-corpus read-only audit in pr006-readonly-readiness-preparation.json confirms 3,434 records, 3,430 currently valid, four isolated CDC identities. Each isolate fails solely `description must be a non-empty string`. Preserve every source record/hash and the frozen baseline counts. Classification is distinct from a reviewed migration/new publication. Do not invent description text or silently change the current generation while adding a missing-description representation.

Existing compatibility schema observatory-record-compatibility.v1.0.1 permits an empty description but validates a distinct historical 143-record corpus. It is not recovery of the missing historical v1.0.0 schema and does not by itself authorize relaxing the current browser-record contract. Current catalog-contract.mjs and browser-record.schema.json both require a nonempty description. A versioned current migration must identify its exact representation and compatibility boundary before editing schema or accepting moved records; a typed isolated disposition is preferable to fabricating source text.

The live search facet path differs from the fallback:

1. retrieval-core-v1.2.mjs:facetResponse builds complete-match API facet counts before pagination, with raw canonical values copied into labels.
2. SearchResultsPage.tsx maps discovery.result.facets.sections directly into FacetSectionConfig. It calls buildFacetSections only when those API facets are absent.
3. FacetSidebar renders the supplied labels and supports only per-option disabled. Neither section type currently expresses availability or an explanation.
4. discoveryProvider validates API facet sections/options, but there is no availability contract yet.

Changing only data/facets.ts would not fix live API labels or availability. Canonical values must remain unchanged in URLs, request filters and IDs. Resolve labels from source names and captured capability labels; preserve exact canonical IDs separately. Never infer national data coverage from a publisher jurisdiction or an unresolved geography field. Distinguish evidence support from a mere nonempty value and from whether a facet can discriminate records. Mixed supported/unknown fixtures need a real include-unknown option and unchanged count/filter semantics.

Proposed additions to the existing PR-006 scope, to reconcile with its final accepted dependency interface before dispatch:

- packages/retrieval/tools/retrieval-core-v1.2.mjs for the actual facet projection and matching behavior.
- apps/web/src/types/catalog.ts and apps/web/src/types/discovery.ts for an explicit additive availability contract if needed.
- apps/web/src/providers/discoveryProvider.ts and its existing .test.ts for that actual response contract.
- apps/web/src/pages/SearchResultsPage.tsx and its existing .test.tsx only for required propagation into the live path.
- apps/web/src/data/facets.test.ts, a focused apps/web/src/components/FacetSidebar.test.tsx, and tests/research-program/isolation-and-facets.test.mjs for meaningful source, API, fallback, rendering and round-trip cases.
- Any current browser-record schema successor requires a concrete versioned design first; the historical compatibility schema/receipt, corpus manifest and frozen PR002 artifacts are not generic repin targets.

Validation should use the actual four isolated source rows, retained full-corpus accounting, unknown-only and mixed known/unknown cases, label/value separation, filter round trips, complete counts before pagination and accessible selected/unavailable states. Existing full web/retrieval suites remain required; source bytes and frozen baselines stay bound. This preparation has not changed code, schemas, plan scope, counts or source publication.
