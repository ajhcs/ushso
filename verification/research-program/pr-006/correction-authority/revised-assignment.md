# PR-006 — Account for isolated records and unusable facets

Phase **P1**, sub-phase **1B**. Status: planned.

Source defects are visible without making missing values useful filters.

**Dependencies:** PR-004, PR-005

**Implementer:** Luna Max, Grok or DeepSeek; assign one owner at dispatch. **Reviewer:** Astra; named human domain/owner decision when required.

**Acceptance requirements:** R01, R02. **Audit findings:** F04, F17, F24.

## Before editing

Read [EXECUTION.md](../EXECUTION.md), the dependency handoffs and the current repository instructions. Start from the merged integration SHA selected in PR-001, not the stale original workspace. Confirm the paths below in that release; create a new path only when it is named here. If an existing package supplies the required behavior, extend it instead of creating a parallel subsystem.

**Owned scope:**

- `packages/retrieval/tools/retrieval-core-v1.2.mjs`
- `packages/retrieval/tests/lexical-index.test.mjs`
- `tests/direct-base-regression.test.mjs`
- `tests/research-program/isolation-and-facets.test.mjs`
- `apps/web/src/data/facets.ts`
- `apps/web/src/data/facets.test.ts`
- `apps/web/src/pages/SearchResultsPage.tsx`
- `apps/web/src/pages/SearchResultsPage.test.tsx`
- `apps/web/src/pages/SourcesPage.tsx`
- `apps/web/src/pages/SourcesPage.test.tsx`
- `apps/web/src/components/FacetSidebar.tsx`
- `apps/web/src/components/FacetSidebar.test.tsx`
- `apps/web/src/types/catalog.ts`
- `apps/web/src/providers/discoveryProvider.ts`
- `apps/web/src/providers/discoveryProvider.test.ts`
- `tests/subject-shortcircuit.test.mjs`

If a shared contract or another owner’s file must change, record the proposed interface change and resolve ownership before editing it. Keep each commit independently understandable and passing the checks appropriate to that change.

## Atomic commits

### C-006-1 — Classify the four isolated CDC records

Reuse PR004 typed completeness/isolation accounting and retain the exact four frozen CDC identities, publisher identities, record hashes and sole missing-description validation failure. Add regression evidence for all 3434 baseline rows, 3430 searchable rows and four isolated rows, including partial_results. No source publication, description invention, current browser-schema relaxation or migration is in scope.

**Verify:** The 3434/3430/4 partition and four exact IDs/hashes reconcile against frozen PR002 and accepted PR004 artifacts. Source bytes and denominators remain unchanged; isolated rows remain typed and visible without being promoted into search.

### C-006-2 — Make facet availability informative

Derive browser-only availability and concise reasons from the current facet options/counts and current total_matches. Unknown-only geography and uniform public_catalog access cannot pretend to narrow those current results or imply national coverage/payload access. Keep selected tokens removable when absent from the response. Offer count-free geography:unknown and access_status:unknown controls when omitted, preserving same-dimension OR and cross-dimension AND semantics. Make the fixture fallback apply the same canonical filter traversal, with truthful fixture-scope counts. Preserve the frozen API schema, response shape and actual count scope; no external availability/reason fields or invented disjunctive counts.

**Verify:** Unknown-only, uniform-access and mixed fixtures produce scoped explanations and correct counts. Known plus unknown filters round-trip even after options disappear from a narrowed response; selected filters can always be removed. Missing counts remain absent, never zero or stale broader counts. Live and fixture-fallback page interactions exercise actual filter behavior.

### C-006-3 — Use public labels for facet values

Map source/capability values to captured readable labels and controlled enums to public labels while preserving canonical URL/API values. The live engine may change only existing facet label strings; use complete pre-pagination matches so a label need not depend on the current page. The shared web adapter derives the five canonical dimensions from canonical records and does not expose fallback aliases such as other-states or open-data-api as live filters. Preserve both frozen differential reference engines. In their current comparison tests, isolate only intentional label differences and assert the entire remaining response unchanged, with independent expected-label cases. Do not rewrite frozen fixtures, source artifacts or historical fingerprints. The full combined gate additionally identifies tests/subject-shortcircuit.test.mjs as a frozen-control comparison. Own that current test solely to isolate facets.sections[*].options[*].label differences. Preserve exact JSON byte/order comparison for every other field, all four subject fixtures and four sort modes, frozen engines, corpus input and algorithm fingerprint. Assert the captured public labels independently and prove a non-label mutation still fails parity. Record this as an additive correction, retaining the original failed gate and dispatch packet.

**Verify:** Filter selections retain canonical values and identical record IDs/counts across pagination, live responses and fixture fallback. A facet value absent from the current page still has the correct captured label. Accessible names, checked state and described unavailability remain meaningful; controls without counts render no fabricated count. Differential tests preserve exact parity for every non-label field. All 16 subject/sort comparisons pass with only option-label normalization; counts, values, ordering, scores, reasons and result fields remain checked. The separately asserted expected label map and a non-label negative control pass.

## PR acceptance

- No source row disappears during repair.
- Unknown-only facets cannot pretend to narrow the catalog.

Use the existing affected package tests plus the specific fixtures described below. Add meaningful regression/integration tests for behavior changes; documentation-only commits use link, schema or artifact checks. Full npm test/build/cf:dry-run run at the integration/release gate.

Run these commands from the isolated repository root after implementing the specified tests. They are planned verification commands, not checks executed by this planning task:

```bash
node --test packages/retrieval/tests/lexical-index.test.mjs
node --test tests/direct-base-regression.test.mjs
node --test tests/research-program/isolation-and-facets.test.mjs
node --test tests/subject-shortcircuit.test.mjs
npm run test:web
npm run test:retrieval
```

The implementation must demonstrate the behavior above using actual fixtures or retained execution evidence. A source capture is not a payload test; a passing schema is not scientific approval; a successful tool envelope is not a completed research task.

## Handoff and independent review

Write the sanitized evidence index under `verification/research-program/pr-006/` and the task-specific handoff under `docs/research-program/handoffs/PR-006.json`. Follow the [handoff template](../templates/handoff.json). Include exact base/head and dependency SHAs; commands with exit statuses; fixtures and expected/actual results; changed public behavior; source/generation identity; artifact hashes; failures; remaining questions; and the next consumer.

Push the task branch to GitHub and open/update a draft PR using the [PR body template](../templates/pr-body.md). Do not mark it ready until producer checks and handoff validation pass. Astra independently inspects the diff and replays the decisive acceptance checks; producer logs alone are not approval. Retain a failing result when blocked and identify the exact missing input. Do not auto-merge or deploy.
