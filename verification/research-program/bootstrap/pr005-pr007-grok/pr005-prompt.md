Implement the complete bounded PR-005 assignment below using Grok. The controller remains independent reviewer, publisher and merge authority.

Exact clean integration base: 15b351a92af729f9ba07359fd210123fdfd76bb3, tree c46c95ad838b78d4a26c86454be82f3835c49e51. PR003/PR004/PR085 were accepted and integrated through GitHub PR18, merge 548edf64c20f474d6832996ce5ac29e0ff25be0b. This base adds only the accepted evidence and ready-task ledger. Your sole direct dependency is PR-004 at actual component merge 463f092f71c0ed1ef2aa5baa29b186e5697d04ce; its accepted producer head is 78d164e816049c45193b17c2267f64c8fb783399. Do not add unrelated direct dependencies or relabel the producer head as the dependency merge.

Read AGENTS.md, README.md, docs/ARCHITECTURE.md, docs/EVALUATION.md, the exact packet docs/master-plan/2026-09-10/prs/PR-005.md, and docs/master-plan/2026-09-10/EXECUTION.md. Consume verification/research-program/bootstrap/components-463f092/pr-004-integration-handoff.json and its artifact manifest. The final PR003 handoff schemas/checker are already integrated; read docs/research-program/handoffs/schema/README.md and validate your project handoff with node scripts/research-program/check-handoff.mjs docs/research-program/handoffs/PR-005.json.

Owned paths only:
- packages/retrieval/tools/retrieval-core-v1.2.mjs
- worker/public-query-service.mjs
- apps/web/src/lib/researcherGuidance.ts
- tests/research-program/freshness-and-grain.test.mjs
- packages/search/static-search-backend.mjs
- apps/web/src/types/discovery.ts
- apps/web/src/types/catalog.ts
- apps/web/src/lib/catalogAdapter.ts
- apps/web/src/components/ResultCard.tsx
- apps/web/src/pages/DatasetDetailsPage.tsx
- tests/wp1-repository-abstraction.test.mjs
- apps/web/src/lib/researcherGuidance.test.tsx
- apps/web/src/lib/catalogAdapter.test.ts
- apps/web/src/components/ResultCard.test.ts
- apps/web/src/pages/DatasetDetailsPage.test.tsx
- docs/research-program/handoffs/PR-005.json
- verification/research-program/pr-005/

A parallel assignment owns different packages. Do not modify the global execution ledger, root package.json, lockfile, production configuration, historical approvals/evidence, frozen cohorts, shared handoff schemas/checker or another PR's paths. If a contract change outside your scope is necessary, report a concrete proposed delta and continue independent owned work.

Use the managed worktree supplied by Co-Engineer and its already-held writer lifecycle. Never reconstruct its token, copy node_modules, create desktop tasks or use the dirty original workspace. Follow host storage/TMPDIR rules. Use Node >=22.15 and the committed npm lockfile; pinned npm11.19.1 is available at /mnt/d/tmp/plumbob/ushso-research-program-20260910/tooling/node_modules/.bin/npm. Do not run a separate full release build/gate; execute all affected package checks required by the packet. Check listeners before any local server and stop task-owned servers afterward.

For the application-level handoff contract, create verification/research-program/pr-005/task-binding.json from the task schema, using owner Grok, reviewer Astra, your actual managed branch/worktree, base_sha 15b351a92af729f9ba07359fd210123fdfd76bb3, base_tree c46c95ad838b78d4a26c86454be82f3835c49e51, and dependency_merge_shas {"PR-004":"463f092f71c0ed1ef2aa5baa29b186e5697d04ce"}. This is the project's PR evidence binding, separate from the machine-generated Co-Engineer lifecycle receipt. No invented dispatch/bootstrap hashes are required. Record actual provider/model from the interface; do not promote a producer self-label to a serving-model attestation. Use producer_checked status and a typed pending head if needed to avoid embedding a future commit's own hash; the controller binds your final actual head.

Complete all three planned atomic commits with meaningful positive and negative checks and actual command receipts. Keep each committed state reviewable; preserve genuine before-change failures as evidence without committing knowingly failing tests. Add a small reproducible verification script when necessary for decisive CLI/API observations. Evidence must include exact timestamps/exit codes, hashes, original source/generation identities, expected and observed outcomes, failed/skipped checks and downstream instructions. Preserve prior evidence rather than rewriting it after failures. Commit all owned final work and return a clean tree with a concise final report and exact commits. Do not push, open PRs, merge or deploy; the controller handles reviewed publication.

Scientific constraints: generation live-2026-09-03-85b50522b420; manifest85b50522b4209d25dba70ad389d14d8b7e4a640384eb3d0d2a413e920aa67a2e. Preserve all3434baseline records,3430searchable and4isolated; PR002cohorts/tasks/acceptance bytes are frozen. Catalog membership, HTTP200, inferred search tags, captured documentation, successful synthetic fixtures and model agreement do not establish payload access or scientific fitness. Preserve exact publisher field names, typed unknown/conflict/restricted/failed states, source/release identities and disabled-feature boundaries. Use captured public/no-PHI fixtures; no live collection, paid product enrichment, private evaluator labels or external credentials are needed.

Decisive review focus: reproduce F06/F07 on the accepted base. Inject live request evaluation time without changing frozen-clock benchmark determinism or immutable observation hashes. HCRIS grain remains unresolved unless an explicit evidence-backed observation-grain claim exists; inferred unit_of_analysis search tags cannot become source_asserted typical units. Compare card, detail and machine projections for the same record. Distinguish metadata success, latest attempt, stale historical success and payload access; cover an advanced clock without a corpus rebuild, pre-deadline, expired, missing and invalid dates.

Exact assignment packet follows:

# PR-005 — Correct freshness and inferred-unit evidence labels

Phase **P1**, sub-phase **1B**. Status: planned.

The live clock and scientific evidence labels agree across cards, detail and APIs.

**Dependencies:** PR-004

**Implementer:** Luna Max, Grok or DeepSeek; assign one owner at dispatch. **Reviewer:** Astra; named human domain/owner decision when required.

**Acceptance requirements:** R02. **Audit findings:** F06, F07, F08.

## Before editing

Read [EXECUTION.md](../EXECUTION.md), the dependency handoffs and the current repository instructions. Start from the merged integration SHA selected in PR-001, not the stale original workspace. Confirm the paths below in that release; create a new path only when it is named here. If an existing package supplies the required behavior, extend it instead of creating a parallel subsystem.

**Owned scope:**

- `packages/retrieval/tools/retrieval-core-v1.2.mjs`
- `worker/public-query-service.mjs`
- `apps/web/src/lib/researcherGuidance.ts`
- `tests/research-program/freshness-and-grain.test.mjs`
- `packages/search/static-search-backend.mjs`
- `apps/web/src/types/discovery.ts`
- `apps/web/src/types/catalog.ts`
- `apps/web/src/lib/catalogAdapter.ts`
- `apps/web/src/components/ResultCard.tsx`
- `apps/web/src/pages/DatasetDetailsPage.tsx`
- `tests/wp1-repository-abstraction.test.mjs`
- `apps/web/src/lib/researcherGuidance.test.tsx`
- `apps/web/src/lib/catalogAdapter.test.ts`
- `apps/web/src/components/ResultCard.test.ts`
- `apps/web/src/pages/DatasetDetailsPage.test.tsx`

If a shared contract or another owner’s file must change, record the proposed interface change and resolve ownership before editing it. Keep each commit independently understandable and passing the checks appropriate to that change.

## Atomic commits

### C-005-1 — Use an explicit observation clock

Inject request evaluation time through the public service into freshness projection while preserving deterministic frozen-clock evaluation. Do not mutate immutable source observations.

**Verify:** A September 10 fixture with a September 5 deadline is overdue; before-deadline and invalid/missing dates remain distinct.

### C-005-2 — Stop promoting inferred tags

Replace researcherGuidance typical-unit mapping from unit_of_analysis with the explicit observation-grain claim. Show inferred categories only as search aids.

**Verify:** The audited HCRIS fixture keeps grain unresolved until supported evidence exists; card/detail/machine evidence states match.

### C-005-3 — Explain freshness scope in the UI

Render last successful metadata check, latest attempt and stale status together; distinguish catalog metadata from payload checks. Keep the current visual components.

**Verify:** Advance a clock fixture without rebuilding the corpus and verify UI/API status changes while evidence hashes remain stable.

## PR acceptance

- F06 and F07 reproduce before the change and fail to reproduce after it.
- Frozen benchmark results are not accidentally made time-dependent.

Use the existing affected package tests plus the specific fixtures described below. Add meaningful regression/integration tests for behavior changes; documentation-only commits use link, schema or artifact checks. Full npm test/build/cf:dry-run run at the integration/release gate.

Run these commands from the isolated repository root after implementing the specified tests. They are planned verification commands, not checks executed by this planning task:

```bash
node --test tests/research-program/freshness-and-grain.test.mjs
node --test tests/wp1-repository-abstraction.test.mjs
npm run test:web
npm run test:retrieval
npm run test:worker
```

The implementation must demonstrate the behavior above using actual fixtures or retained execution evidence. A source capture is not a payload test; a passing schema is not scientific approval; a successful tool envelope is not a completed research task.

## Handoff and independent review

Write the sanitized evidence index under `verification/research-program/pr-005/` and the task-specific handoff under `docs/research-program/handoffs/PR-005.json`. Follow the [handoff template](../templates/handoff.json). Include exact base/head and dependency SHAs; commands with exit statuses; fixtures and expected/actual results; changed public behavior; source/generation identity; artifact hashes; failures; remaining questions; and the next consumer.

Push the task branch to GitHub and open/update a draft PR using the [PR body template](../templates/pr-body.md). Do not mark it ready until producer checks and handoff validation pass. Astra independently inspects the diff and replays the decisive acceptance checks; producer logs alone are not approval. Retain a failing result when blocked and identify the exact missing input. Do not auto-merge or deploy.
