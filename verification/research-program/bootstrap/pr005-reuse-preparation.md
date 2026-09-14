# PR-005 reuse and regression preparation

This is a read-only preparation map for PR-005 (C-005-1 through C-005-3),
prepared from the requested immutable integration commit
`6c5007faa80632864e87d592b695fa2e7d75d47d` (tree
`434a0b977570ad4828bcc7ef03034f5ed462a175`). The shared integration branch
advanced to `601c20c17dc1fea39117e942a061e62bc52ebf2c` (tree
`ec3aa51c041923755e8c91ff78f73da0cbcc90a7`) during setup; no source from that
later commit was used. The resolved inspection worktree was
`/mnt/d/worktrees/plumbob/ushso-research-program-20260910`.

No implementation, Git/repository, runtime, network, provider, or evaluator
input was touched. No tests were run; the matrix in `test-matrix.json` records
planned decisive checks and expected before/after behavior only. Corpus shards
were excluded from broad search; only small fixture/manifest metadata needed to
identify the existing test harness was inspected.

## Planned owned paths

The PR packet names four paths:

* `packages/retrieval/tools/retrieval-core-v1.2.mjs` — current engine and
  response projection. `retrieve(rawQuery, { signal, now, browse })` is at
  lines 528–533; it computes `effectiveNow` from the explicit option or the
  frozen corpus `published_at`/`built_at` fallback, then passes it to
  `freshnessState` at line 621 and receipt `generated_at` at line 685. Unit
  scoring at lines 174–184 uses `record.unit_of_analysis` only as inferred
  search evidence; facets at lines 400–416 are labeled `Inferred unit tag`.
* `worker/public-query-service.mjs` — public request seam. `openRequest` at
  lines 71–74 freezes publication/request/session context; `browse` at
  lines 87–132 and `discover` at lines 168–176 pass the request to the search
  backend. `dataset` at lines 135–166 returns a direct result without derived
  freshness metadata.
* `apps/web/src/lib/researcherGuidance.ts` — detail guidance model. The
  `Typical unit` field at line 138 currently copies `unit_of_analysis` and marks
  it `source_asserted`; the metadata observed time is copied at line 131 and
  update-frequency text is emitted at line 140.
* `tests/research-program/freshness-and-grain.test.mjs` — planned new test
  path, but it does **not** exist at the pinned commit and must be added by the
  eventual PR implementation.

Exact SHA-256 and entrypoint data are in `source-hashes.json`.

## Reuse map and scope gaps

The core already has the correct separation needed for a safe change:
`freshnessState(record, now)` in the adjacent contract helper accepts a clock,
and `metadataDimensions` keeps `observation_grain` unresolved while exposing
`unit_of_analysis:*` as inferred search tags. The direct engine tests already
exercise explicit before/after clock values and immutable source metadata.

The live public path currently loses the request clock. `worker/index.mjs`
creates the session from each API request, but `packages/search/static-search-backend.mjs`
calls `engine.retrieve(query, { signal })` and `engine.browse(query, { signal })`
without forwarding an evaluation time. That adapter and the search-backend
interface are outside the four owned paths. `worker/retrieval-v1.2.0.mjs`
delegates production loading to the owned core, so it is not a second active
engine despite containing older private helper code. Any implementation that
claims live clock propagation must resolve this interface/ownership gap or
record it explicitly.

The frozen v1.2 corpus has `publication.observed_at` but no `published_at` or
`built_at`, so an engine call with no `now` falls back to the 1970 epoch. That
explains F07's live response saying the review deadline has not passed on
September 10. Direct fixture and receipt replay tests depend on stable default
time and must remain frozen when the public path gains a live request clock.

C-005-3 has a second ownership gap. The raw record contract contains
`metadata_observed_at`, historical verification status/method, and
`next_review_due`, but no first-class latest-attempt timestamp/outcome or
payload-check status. `freshnessState` derives `last_checked` and
`failed_refresh_state` (the latter is not validated by the catalog contract),
but does not provide latest attempt or payload-vs-catalog status. The existing
freshness UI is in out-of-scope direct consumers:

* `apps/web/src/components/ResultCard.tsx` shows verification target, overdue
  state, and one “Last checked” value. Its fallback uses browser `Date.now()`.
* `apps/web/src/pages/DatasetDetailsPage.tsx` has the current freshness panel
  and also a `Date.now()` fallback. It shows last checked, historical status,
  failed refresh, and data-through, but no latest attempt and no explicit
  payload-check state. The API dataset direct result does not carry derived
  `metadata.freshness`, so this fallback is active for dereferenced details.
* `apps/web/src/lib/catalogAdapter.ts` maps raw verification fields and keeps
  the canonical response, while `ResearcherDecisionSummary.tsx` renders the
  guidance fields but has no freshness section of its own.

Those consumers, `apps/web/src/types/discovery.ts`, the static search adapter,
and any schema/record extension are direct interface dependencies and need an
ownership decision before C-005-3 can honestly claim all three statuses and
catalog/payload distinction. The current visual components can be retained;
the gap is their data contract and clock source.

## Audit findings

* **F06:** `apps/web/src/lib/researcherGuidance.ts:138` labels inferred
  `unit_of_analysis` tags as source asserted in the Use Card even while the
  card's observation grain remains unresolved. The remediation contract
  already keeps inferred tags separate from observation grain.
* **F07:** `packages/retrieval/tools/retrieval-core-v1.2.mjs:533` uses the
  frozen/default clock, yielding a non-overdue live response after the due
  date. The public request seam must supply evaluation time while direct
  benchmark calls stay deterministic.
* **F08:** the product-data audit records that broad inferred categories can
  expand a question such as maternal mortality into hospital/facility/provider
  concepts without evidence that those are the data grain. C-005-2 should keep
  such categories as search aids and leave grain unresolved; no source claim or
  filter support should be promoted from the tag.

The older 2026-09-06 checklist's F08 text concerns preserving browser/server
result order and is already covered by the existing ordering/component tests;
the C-005-2 target above follows the 2026-09-10 product-data audit and PR-005
packet's inferred-unit wording.

## Existing tests to reuse

`packages/retrieval/tests/release-contract.test.mjs:259–297` covers separate
release/observation ordering, explicit before/after freshness clocks, source
metadata immutability, unresolved grain, inferred-tag facets, and evidence
references. `packages/retrieval/tests/search-receipt-replay.test.mjs:12–29`
protects generation-bound replay and ordering; it should remain stable under a
live public clock. `tests/direct-base-regression.test.mjs:1–4` checks candidate
byte parity and immutable inputs across sorts.

`tests/wp1-repository-abstraction.test.mjs:123–169` covers the public service,
static adapter, and exact API response shapes, but currently has no clock
forwarding assertion. `tests/static-machine-toolkit.test.mjs:28–73` supplies a
fixed runtime/toolkit clock, although the static runtime's `now` option is not
used by its freshness projections. `apps/web/src/lib/researcherGuidance.test.tsx`
checks guidance field/evidence structure; `apps/web/src/components/ResultCard.test.ts`
checks the existing six card regions; `apps/web/src/lib/catalogAdapter.test.ts:55–72`
checks unresolved grain and catalog-vs-payload access wording. None currently
asserts latest-attempt rendering or payload-check distinction.

See `test-matrix.json` for the decisive fixture cases, planned commands, and
the explicit `not_run_preparation_only` status.
